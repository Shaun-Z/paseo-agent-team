import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { workspaceLabel } from "../shared/apply-plan";
import { LABEL } from "../shared/cleanup";
import { AgentProfileSchema, canonical, CONFIG_LABEL, MEMBER_LABEL, memberPrompt, ResearchTeamSchema, runtimeFile, TEAM_LABEL, validateResearch, type ResearchTeam } from "../shared/research-team";
import type { researchApplyRpc, researchExportRpc, researchLoadRpc, researchReadRpc, researchResetRpc } from "../shared/research-rpc";
import { catalogFrom } from "../shared/validate";
import { projectOf, projectTeams, teamFileFor } from "./team-directory";
import { allPages } from "./pagination";
import { sessionSettingsDiffer, sessionSettingsOf } from "../shared/member-settings";
import { isTeamConfigFile, parseTeamConfig, serializeTeamConfig } from "./team-config";

type Api = PluginHandlerContext["paseo"];
type Target = { workspaceId: string } | { projectId: string };
const RuntimeSchema = z.object({
  workspaceId: z.string(), bindings: z.record(z.string(), z.string()).default({}),
  members: z.array(z.object({ id: z.string(), agentId: z.string(), fingerprint: z.string() })).default([]),
});
const queues = new Map<string, Promise<unknown>>();
export async function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queues.set(key, next);
  try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
const allAgents = (paseo: Api) => allPages(cursor => paseo.agents.list({ filter: { includeArchived: true, includeBackground: true }, page: { limit: 100, cursor } }));
const allWorkspaces = (paseo: Api) => allPages(cursor => paseo.workspaces.list({ filter: { includeBackground: true }, page: { limit: 100, cursor } }));
async function runtime(root: string, teamId: string) {
  try { return RuntimeSchema.parse(JSON.parse(await readFile(join(root, runtimeFile(teamId)), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function atomic(file: string, text: string, overwrite = true) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, text, { encoding: "utf8", mode: 0o600 }); if (overwrite) await rename(temp, file); else await link(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
}
async function ignoreRuntime(root: string) {
  const file = join(root, ".gitignore");
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return ""; throw error; });
  const rule = "/.agents/.runtime/paseo-agent-team/";
  if (!text.split(/\r?\n/).includes(rule)) await atomic(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${rule}\n`);
}
export async function readPrompt(root: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new Error(`Prompt path must be project-relative: ${path}`);
  const [base, file] = await Promise.all([realpath(root), realpath(join(root, path))]);
  const rel = relative(base, file);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`Prompt is outside the project: ${path}`);
  return readFile(file, "utf8");
}
async function compiled(root: string, team: ResearchTeam, file: string) {
  const common = (await Promise.all(team.commonPromptFiles.map(path => readPrompt(root, path)))).join("\n\n");
  const roles = new Map(await Promise.all(team.roles.map(async role => [role.id, (await Promise.all(role.promptFiles.map(path => readPrompt(root, path)))).join("\n\n")] as const)));
  return new Map(team.members.map(member => {
    const systemPrompt = memberPrompt(team, member, file, common, roles.get(member.roleId)!);
    const fingerprint = createHash("sha256").update(canonical({ config: member.launchSnapshot, systemPrompt })).digest("hex");
    return [member.id, { systemPrompt, fingerprint }];
  }));
}
function candidates(entries: Awaited<ReturnType<typeof allAgents>>, workspaceId: string, teamId: string, memberId: string) {
  return entries.map(entry => entry.agent).filter(agent => !agent.archivedAt && agent.workspaceId === workspaceId && agent.labels[TEAM_LABEL] === teamId && agent.labels[MEMBER_LABEL] === memberId);
}
export async function researchContext(target: Target, paseo: Api) {
  const project = await projectOf(paseo, target);
  const workspaces = await allWorkspaces(paseo);
  const workspace = "workspaceId" in target ? workspaces.find(entry => entry.id === target.workspaceId && entry.projectId === project.id && !entry.archivingAt) : undefined;
  if ("workspaceId" in target && !workspace) throw new Error("Workspace is not active in this project");
  const listing = await projectTeams(project);
  const own = workspace ? listing.teams.find(entry => entry.team.workspace.trim().toLowerCase() === workspaceLabel(workspace).toLowerCase()) : undefined;
  return { project, workspaces, workspace, listing, own };
}
export async function readResearch(target: RpcInput<typeof researchReadRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchReadRpc>> {
  const { project, workspace, listing, own } = await researchContext(target, paseo);
  const errors = [...listing.errors];
  let profiles: z.infer<typeof AgentProfileSchema>[] = [];
  try {
    const config = await paseo.config.get();
    for (const profile of config.config.agentProfiles ?? []) {
      const parsed = AgentProfileSchema.safeParse(profile);
      if (parsed.success) profiles.push(parsed.data);
    }
  } catch (error) { errors.push(`Could not read Agent Profiles: ${String(error)}`); }
  const team = own?.team ?? null;
  const bindings: Record<string, string> = {};
  const identities: Record<string, string> = {};
  const members: RpcOutput<typeof researchReadRpc>["members"] = [];
  if (team && workspace && own) {
    const entries = await allAgents(paseo);
    for (const { agent } of entries) if (agent.workspaceId === workspace.id && agent.labels[TEAM_LABEL] === team.id && team.members.some(member => member.id === agent.labels[MEMBER_LABEL])) identities[agent.id] = agent.labels[MEMBER_LABEL]!;
    let prompts: Awaited<ReturnType<typeof compiled>> | undefined;
    try { prompts = await compiled(project.root, team, own.file); } catch (error) { errors.push(String(error)); }
    try { const saved = await runtime(project.root, team.id); if (saved?.workspaceId === workspace.id) Object.assign(bindings, saved.bindings); } catch (error) { errors.push(`Member directory: ${String(error)}`); }
    for (const member of team.members) {
      const agents = candidates(entries, workspace.id, team.id, member.id);
      const agent = agents[0];
      const pending = !!agent && (!prompts || agent.labels[CONFIG_LABEL] !== prompts.get(member.id)?.fingerprint);
      members.push({ id: member.id, agentId: agent?.id ?? null, status: agent?.requiresAttention ? "attention" : agent?.status ?? "missing", pending,
        sessionSettings: agent ? sessionSettingsOf(agent) : null, settingsChanged: !!agent && sessionSettingsDiffer(member.launchSnapshot, agent),
        error: agents.length > 1 ? "Multiple active sessions for this member; resolve them before applying." : null });
    }
  }
  return { project, workspace: workspace ? workspaceLabel(workspace) : null, file: own?.file ?? null, team, profiles, bindings, identities, members, errors };
}
async function apply(rootTarget: Target, team: ResearchTeam, bindings: Record<string, string>, paseo: Api, resetId?: string) {
  const { project, workspaces, workspace, listing } = await researchContext(rootTarget, paseo);
  if (listing.errors.length) throw new Error(listing.errors.join("\n"));
  if (workspace && workspaceLabel(workspace).toLowerCase() !== team.workspace.toLowerCase()) throw new Error("Team workspace must match the current workspace");
  const sameWorkspace = listing.teams.find(entry => entry.team.workspace.toLowerCase() === team.workspace.toLowerCase());
  if (sameWorkspace && (sameWorkspace.team.id !== team.id)) throw new Error("Workspace belongs to another team; use a free workspace for a new research team");
  if (listing.teams.some(entry => entry.team.id === team.id && entry.team.workspace.toLowerCase() !== team.workspace.toLowerCase())) throw new Error("Team ID already belongs to another workspace");
  const catalog = catalogFrom((await paseo.providers.snapshot()).entries);
  const problems = validateResearch(team, catalog);
  if (problems.length) throw new Error(problems.join("\n"));
  const entries = await allAgents(paseo);
  const file = sameWorkspace?.file ?? teamFileFor(team, listing.teams, listing.names);
  const prompts = await compiled(project.root, team, file);
  let leadWorkspace = workspace ?? workspaces.find(entry => entry.projectId === project.id && !entry.archivingAt && workspaceLabel(entry).toLowerCase() === team.workspace.toLowerCase());
  if (leadWorkspace) {
    for (const member of team.members) if (candidates(entries, leadWorkspace.id, team.id, member.id).length > 1) throw new Error(`Multiple sessions for member ${member.id}`);
  }
  if (!leadWorkspace) {
    const created = await paseo.workspaces.create({ title: team.workspace, source: { kind: "directory", path: project.root, projectId: project.id } });
    leadWorkspace = (await paseo.workspaces.ref(created.id).refresh()) ?? undefined;
    if (!leadWorkspace) throw new Error("Created workspace is not available");
  }
  // Project-root prompt paths are unambiguous only in this shared checkout.
  const workspacePath = leadWorkspace.workspaceDirectory;
  if (workspacePath && await realpath(workspacePath) !== await realpath(project.root)) throw new Error("Research teams require a workspace in the Project checkout");
  const workspaceId = leadWorkspace.id;
  let previous: z.infer<typeof RuntimeSchema> | null = null;
  try { const saved = await runtime(project.root, team.id); if (saved?.workspaceId === workspaceId) previous = saved; }
  catch (error) { if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error; }
  const directory = { workspaceId, bindings: Object.fromEntries(team.members.filter(member => bindings[member.id] ?? previous?.bindings[member.id]).map(member => [member.id, bindings[member.id] ?? previous!.bindings[member.id]!])), members: team.members.flatMap(member => { const agent = candidates(entries, workspaceId, team.id, member.id)[0]; return agent ? [{ id: member.id, agentId: agent.id, fingerprint: agent.labels[CONFIG_LABEL] ?? "" }] : []; }) };
  await ignoreRuntime(project.root);
  const source = sameWorkspace ? await readFile(join(project.root, file), "utf8") : undefined;
  await atomic(join(project.root, file), serializeTeamConfig(file, team, source));
  await atomic(join(project.root, runtimeFile(team.id)), JSON.stringify(directory, null, 2) + "\n");
  for (const { agent } of entries) if (!agent.archivedAt && agent.workspaceId === workspaceId && agent.labels[TEAM_LABEL] === team.id && !team.members.some(member => member.id === agent.labels[MEMBER_LABEL])) await paseo.agents.ref(agent.id).archive();
  // Save routing after each successful create so partial failure is recoverable.
  for (const member of team.members) {
    const prompt = prompts.get(member.id)!;
    directory.members = directory.members.filter(entry => entry.id !== member.id);
    let agent: ReturnType<typeof candidates>[number] | undefined = candidates(entries, workspaceId, team.id, member.id)[0];
    if (member.id === resetId && agent) { await paseo.agents.ref(agent.id).archive(); agent = undefined; }
    if (!agent) {
      const { provider, model, ...settings } = member.launchSnapshot;
      const handle = await paseo.workspaces.ref(workspaceId).agents.create({
        config: { provider: `${provider}/${model}`, ...settings, systemPrompt: prompt.systemPrompt },
        idempotencyKey: resetId === member.id ? randomUUID() : `${project.id}:${team.id}:${member.id}:${prompt.fingerprint}:${entries.filter(entry => entry.agent.labels[TEAM_LABEL] === team.id && entry.agent.labels[MEMBER_LABEL] === member.id && entry.agent.archivedAt).map(entry => entry.agent.id).sort().join(",")}`,
        title: member.name ?? member.id,
        labels: { [TEAM_LABEL]: team.id, [MEMBER_LABEL]: member.id, [CONFIG_LABEL]: prompt.fingerprint, role: member.roleId,
          ...(member.id === team.orchestratorMemberId ? { [LABEL]: "orchestrator" } : {}) },
      });
      directory.members.push({ id: member.id, agentId: handle.id, fingerprint: prompt.fingerprint });
    } else directory.members.push({ id: member.id, agentId: agent.id, fingerprint: agent.labels[CONFIG_LABEL] ?? "" });
    await atomic(join(project.root, runtimeFile(team.id)), JSON.stringify(directory, null, 2) + "\n");
  }
  const coordinator = directory.members.find(member => member.id === team.orchestratorMemberId)!;
  return { workspaceId, orchestratorAgentId: coordinator.agentId, file: join(project.root, file) };
}
export async function applyResearch({ team: input, bindings, ...target }: RpcInput<typeof researchApplyRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchApplyRpc>> {
  const team = ResearchTeamSchema.parse(input);
  const project = await projectOf(paseo, target);
  return exclusive(project.root, () => apply(target, team, bindings, paseo));
}

function transferPath(root: string, path: string) {
  const file = path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(root, path);
  if (!isTeamConfigFile(file)) throw new Error("Choose a .json, .yaml or .yml configuration file");
  return file;
}

/** Shared by file and Git imports; source bindings survive only unchanged launch snapshots. */
export async function researchDefinitionWrites(root: string, workspaceId: string | undefined, file: string, before: ResearchTeam | null, team: ResearchTeam, source?: string) {
  const writes = [{ file, text: serializeTeamConfig(file, team, source) }];
  const saved = await runtime(root, team.id);
  if (workspaceId && saved?.workspaceId === workspaceId) {
    const bindings = Object.fromEntries(Object.entries(saved.bindings).filter(([id]) => {
      const old = before?.members.find(member => member.id === id), next = team.members.find(member => member.id === id);
      return old && next && canonical(old.launchSnapshot) === canonical(next.launchSnapshot);
    }));
    if (canonical(bindings) !== canonical(saved.bindings)) writes.unshift({ file: runtimeFile(team.id), text: JSON.stringify({ ...saved, bindings }, null, 2) + "\n" });
  }
  return writes;
}

/** Replace configuration only. Session lifecycle remains an explicit Apply/reset action. */
export async function loadResearch({ workspaceId, path }: RpcInput<typeof researchLoadRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchLoadRpc>> {
  const project = await projectOf(paseo, { workspaceId });
  return exclusive(project.root, async () => {
    const { workspace, listing, own } = await researchContext({ workspaceId }, paseo);
    if (listing.errors.length) throw new Error(listing.errors.join("\n"));
    const sourceFile = transferPath(project.root, path);
    const source = await readFile(sourceFile, "utf8");
    const incoming = ResearchTeamSchema.parse(parseTeamConfig(sourceFile, source));
    const team = { ...incoming, id: own?.team.id ?? incoming.id, workspace: workspaceLabel(workspace!) };
    if (listing.teams.some(entry => entry.file !== own?.file && entry.team.id.toLowerCase() === team.id.toLowerCase())) throw new Error(`Team ID ${team.id} already belongs to another Workspace`);
    const file = own?.file ?? teamFileFor(team, listing.teams, listing.names);
    for (const write of await researchDefinitionWrites(project.root, workspaceId, file, own?.team ?? null, team, /\.ya?ml$/i.test(sourceFile) ? source : undefined)) await atomic(join(project.root, write.file), write.text);
    return { file: join(project.root, file) };
  });
}

/** Export only the saved definition, never host-local routing or an editor draft. */
export async function exportResearch({ workspaceId, path, overwrite }: RpcInput<typeof researchExportRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchExportRpc>> {
  const project = await projectOf(paseo, { workspaceId });
  return exclusive(project.root, async () => {
    const { listing, own } = await researchContext({ workspaceId }, paseo);
    if (listing.errors.length) throw new Error(listing.errors.join("\n"));
    if (!own) throw new Error("Save the Workspace team configuration before exporting");
    const file = transferPath(project.root, path);
    const parent = await realpath(dirname(file)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return dirname(file); throw error; });
    const locations = [relative(project.root, file), relative(await realpath(project.root), join(parent, basename(file)))];
    if (locations.some(location => {
      const rel = location.replace(/\\/g, "/").toLowerCase();
      return /^\.agents\/team\.(json|ya?ml)$/.test(rel) || /^\.agents\/teams\/[^/]+\.(json|ya?ml)$/.test(rel) || rel.startsWith(".agents/.runtime/paseo-agent-team/");
    })) throw new Error("Choose an export destination outside this Project's active team configuration and runtime locations");
    const source = await readFile(join(project.root, own.file), "utf8");
    const team = ResearchTeamSchema.parse(parseTeamConfig(own.file, source));
    const sameFormat = /\.json$/i.test(file) === /\.json$/i.test(own.file);
    const text = sameFormat ? source : serializeTeamConfig(file, team);
    await atomic(file, text, overwrite);
    return { file };
  });
}
export async function resetResearchMember({ workspaceId, memberId }: RpcInput<typeof researchResetRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchResetRpc>> {
  const project = await projectOf(paseo, { workspaceId });
  return exclusive(project.root, async () => {
    const { own } = await researchContext({ workspaceId }, paseo);
    if (!own?.team.members.some(member => member.id === memberId)) throw new Error("Unknown team member");
    await apply({ workspaceId }, own.team, {}, paseo, memberId);
    const directory = await runtime(project.root, own.team.id);
    return { agentId: directory!.members.find(member => member.id === memberId)!.agentId };
  });
}
