import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { researchGitCompareRpc, researchGitFetchRpc, researchGitImportRpc } from "../shared/research-rpc";
import { gitChange, gitTeamChanges, mergeGitTeam, type GitChange } from "../shared/git-team";
import { canonical, type ResearchTeam } from "../shared/research-team";
import { workspaceLabel } from "../shared/apply-plan";
import { exclusive, researchContext, researchDefinitionWrites } from "./research-team";
import { projectOf, teamFileFor } from "./team-directory";
import { extractGitTeam, fetchGitSnapshot, gitConfigFiles, promptImportPath, type GitSnapshot } from "./git-source";

type Target = { workspaceId: string } | { projectId: string };
type Source = { snapshot: GitSnapshot; root: string; target: string; expires: number };
type Plan = { sourceId: string; file: string; fileSource: string | null; configSource: string; before: ResearchTeam | null; incoming: ResearchTeam; changes: GitChange[]; prompts: Map<string, string>; baseline: Map<string, string | null>; workspaceId?: string };
const sources = new Map<string, Source>(), plans = new Map<string, Plan>();
const scope = (target: Target) => "workspaceId" in target ? `workspace:${target.workspaceId}` : `project:${target.projectId}`;
export async function cleanupGitImports() {
  const old = [...sources.values()]; sources.clear(); plans.clear();
  await Promise.all([...new Set(old.map(source => source.snapshot.directory))].map(directory => rm(directory, { recursive: true, force: true })));
}
async function expireSources() {
  for (const [id, source] of sources) if (source.expires < Date.now() || sources.size > 10) {
    sources.delete(id);
    for (const [key, plan] of plans) if (plan.sourceId === id) plans.delete(key);
    await rm(source.snapshot.directory, { recursive: true, force: true });
  }
}
async function sourceFor(id: string, target: Target, paseo: PluginHandlerContext["paseo"]) {
  await expireSources();
  const source = sources.get(id), project = await projectOf(paseo, target);
  if (!source || source.target !== scope(target) || source.root !== await realpath(project.root)) throw new Error("Git preview expired or belongs to another Workspace. Fetch and compare again.");
  return source;
}

/** Refuse symlink destinations, including ancestor directories. Missing paths are valid new files. */
export async function projectImportText(root: string, file: string): Promise<string | null> {
  if (!file || file.includes("\\") || file.startsWith("/") || /^[a-z]:/i.test(file) || file.split("/").some(part => !part || part === "." || part === "..") || /[\x00-\x1f]/.test(file)) throw new Error(`Invalid import destination: ${file}`);
  const parts = file.split("/");
  for (let i = 1; i <= parts.length; i++) {
    let info;
    try { info = await lstat(join(root, ...parts.slice(0, i))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    if (info.isSymbolicLink() || (i < parts.length ? !info.isDirectory() : !info.isFile())) throw new Error(`Import destination is not a regular Project path: ${file}`);
    if (i === parts.length && info.size > 512 * 1024) throw new Error(`Local file exceeds 512 KiB: ${file}`);
  }
  return readFile(join(root, file), "utf8");
}

export async function fetchResearchGit(input: RpcInput<typeof researchGitFetchRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchGitFetchRpc>> {
  await expireSources();
  const project = await projectOf(paseo, input), root = await realpath(project.root);
  const snapshot = await fetchGitSnapshot(input.repository, input.ref);
  const sourceId = randomUUID();
  sources.set(sourceId, { snapshot, root, target: scope(input), expires: Date.now() + 20 * 60_000 });
  await expireSources();
  return { sourceId, commit: snapshot.commit, configFiles: gitConfigFiles(snapshot) };
}

export async function compareResearchGit(input: RpcInput<typeof researchGitCompareRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchGitCompareRpc>> {
  const source = await sourceFor(input.sourceId, input, paseo);
  const { team: remote, prompts, source: configSource } = await extractGitTeam(source.snapshot, input.configFile);
  return exclusive(source.root, async () => {
    const { project, workspace, workspaces, listing, own: workspaceTeam } = await researchContext(input, paseo);
    if (listing.errors.length) throw new Error(listing.errors.join("\n"));
    const workspaceName = workspace ? workspaceLabel(workspace) : input.workspaceName || remote.workspace;
    const own = workspaceTeam ?? listing.teams.find(entry => entry.team.workspace.toLowerCase() === workspaceName.toLowerCase());
    const incoming = { ...remote, workspace: workspaceName, id: own?.team.id ?? remote.id };
    if (listing.teams.some(entry => entry.file !== own?.file && entry.team.id.toLowerCase() === incoming.id.toLowerCase())) throw new Error(`Team ID ${incoming.id} already belongs to another Workspace`);
    const before = own?.team ?? null, file = own?.file ?? teamFileFor(incoming, listing.teams, listing.names);
    const fileSource = await projectImportText(source.root, file);
    const changes = gitTeamChanges(before, incoming), baseline = new Map<string, string | null>();
    let localBytes = Buffer.byteLength(fileSource ?? "");
    for (const [path, text] of prompts) {
      const old = await projectImportText(source.root, path);
      localBytes += Buffer.byteLength(old ?? "");
      if (localBytes > 4 * 1024 * 1024) throw new Error("Local configuration and compared prompts exceed 4 MiB");
      baseline.set(path, old);
      const change = gitChange("prompt", path, old ?? undefined, text);
      if (change) { change.before = old; change.after = text; changes.push(change); }
    }
    const planId = randomUUID();
    // Replacing a comparison bounds retained prompt contents without discarding its fetched commit.
    for (const [id, plan] of plans) if (plan.sourceId === input.sourceId) plans.delete(id);
    plans.set(planId, { sourceId: input.sourceId, file, fileSource, configSource: /\.ya?ml$/i.test(input.configFile) ? configSource : "", before, incoming, changes, prompts, baseline, workspaceId: workspace?.id ?? workspaces.find(entry => entry.projectId === project.id && !entry.archivingAt && workspaceLabel(entry).toLowerCase() === workspaceName.toLowerCase())?.id });
    return { planId, commit: source.snapshot.commit, configFile: input.configFile, before, incoming, changes };
  });
}

async function writeTransaction(root: string, writes: { file: string; text: string }[]) {
  const staged: { file: string; temp: string; before: string | null }[] = [], committed: typeof staged = [];
  try {
    for (const write of writes) {
      const before = await projectImportText(root, write.file), file = join(root, write.file), temp = `${file}.${randomUUID()}.tmp`;
      await mkdir(dirname(file), { recursive: true });
      staged.push({ file, temp, before });
      await writeFile(temp, write.text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    }
    for (const entry of staged) if (await projectImportText(root, relative(root, entry.file).replace(/\\/g, "/")) !== entry.before) throw new Error("A local import destination changed while preparing files. Compare again.");
    for (const entry of staged) { await rename(entry.temp, entry.file); committed.push(entry); }
  } catch (error) {
    for (const entry of committed.reverse()) {
      if (entry.before === null) await unlink(entry.file); else {
        await writeFile(entry.temp, entry.before, { encoding: "utf8", mode: 0o600 });
        await rename(entry.temp, entry.file);
      }
    }
    throw error;
  } finally { await Promise.all(staged.map(entry => unlink(entry.temp).catch(() => {}))); }
}

export async function importResearchGit(input: RpcInput<typeof researchGitImportRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchGitImportRpc>> {
  const plan = plans.get(input.planId);
  if (!plan) throw new Error("Git comparison expired. Compare again before importing.");
  const source = await sourceFor(plan.sourceId, input, paseo);
  return exclusive(source.root, async () => {
    if (plans.get(input.planId) !== plan || source.expires < Date.now()) throw new Error("Git comparison expired. Compare again before importing.");
    const { listing, workspace } = await researchContext(input, paseo);
    if (listing.errors.length) throw new Error(listing.errors.join("\n"));
    const own = listing.teams.find(entry => entry.file === plan.file);
    if (canonical(own?.team ?? null) !== canonical(plan.before) || await projectImportText(source.root, plan.file) !== plan.fileSource || workspace && workspaceLabel(workspace) !== plan.incoming.workspace) throw new Error("The local team changed after comparison. Compare again before importing.");
    if (listing.teams.some(entry => entry.file !== plan.file && (entry.team.id.toLowerCase() === plan.incoming.id.toLowerCase() || entry.team.workspace.toLowerCase() === plan.incoming.workspace.toLowerCase()))) throw new Error("Another team now uses this Team ID or Workspace. Compare again.");
    for (const [path, before] of plan.baseline) if (await projectImportText(source.root, path) !== before) throw new Error(`Local prompt changed after comparison: ${path}. Compare again.`);
    if (input.selected.some(id => !plan.changes.some(change => change.id === id))) throw new Error("Unknown Git change selection");
    const team = mergeGitTeam(plan.before, plan.incoming, plan.changes, input.selected);
    const selected = new Set(input.selected);
    const promptWrites = plan.changes.filter(change => change.kind === "prompt" && selected.has(change.id)).map(change => ({ file: change.key, text: plan.prompts.get(change.key)! }));
    const selectedPrompts = new Map(promptWrites.map(write => [write.file, write.text]));
    for (const path of new Set([...team.commonPromptFiles, ...team.roles.flatMap(role => role.promptFiles)].map(promptImportPath))) {
      if (!selectedPrompts.has(path) && await projectImportText(source.root, path) === null) throw new Error(`Required prompt is missing: ${path}. Select its import or keep a valid Role configuration.`);
    }
    const writes = [...promptWrites, ...await researchDefinitionWrites(source.root, plan.workspaceId, plan.file, plan.before, team, plan.fileSource ?? (plan.configSource || undefined))];
    await writeTransaction(source.root, writes);
    plans.delete(input.planId);
    return { file: join(source.root, plan.file), team, changedFiles: writes.map(write => relative(source.root, join(source.root, write.file)).replace(/\\/g, "/")) };
  });
}
