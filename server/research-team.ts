import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { workspaceLabel } from "../shared/apply-plan";
import { LABEL } from "../shared/cleanup";
import { AgentProfileSchema, canonical, CONFIG_LABEL, legacyView, MEMBER_LABEL, memberPrompt, ResearchTeamSchema, researchFromLegacy, runtimeFile, TEAM_LABEL, validateResearch, type ResearchTeam } from "../shared/research-team";
import type { researchApplyRpc, researchReadRpc, researchResetRpc } from "../shared/research-rpc";
import { teamFileFor } from "../shared/team-files";
import { catalogFrom } from "../shared/validate";
import { projectOf, projectTeams } from "./team";
import { allPages } from "./pagination";

type Api = PluginHandlerContext["paseo"];
type Target = { workspaceId: string } | { projectId: string };
const RuntimeSchema = z.object({
  workspaceId: z.string(), bindings: z.record(z.string(), z.string()).default({}),
  members: z.array(z.object({ id: z.string(), agentId: z.string(), fingerprint: z.string() })).default([]),
});
const queues = new Map<string, Promise<unknown>>();
async function exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
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
async function atomic(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, text, { encoding: "utf8", mode: 0o600 }); await rename(temp, file); }
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
async function context(target: Target, paseo: Api) {
  const project = await projectOf(paseo, target);
  const workspaces = await allWorkspaces(paseo);
  const workspace = "workspaceId" in target ? workspaces.find(entry => entry.id === target.workspaceId && entry.projectId === project.id && !entry.archivingAt) : undefined;
  if ("workspaceId" in target && !workspace) throw new Error("Workspace is not active in this project");
  const listing = await projectTeams(project);
  const own = workspace ? listing.teams.find(entry => entry.team.orchestrator.workspace.trim().toLowerCase() === workspaceLabel(workspace).toLowerCase()) : undefined;
  return { project, workspaces, workspace, listing, own };
}
export async function readResearch(target: RpcInput<typeof researchReadRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchReadRpc>> {
  const { project, workspace, listing, own } = await context(target, paseo);
  const errors = [...listing.errors];
  let profiles: z.infer<typeof AgentProfileSchema>[] = [];
  try {
    const config = await paseo.config.get();
    for (const profile of config.config.agentProfiles ?? []) {
      const parsed = AgentProfileSchema.safeParse(profile);
      if (parsed.success) profiles.push(parsed.data);
    }
  } catch (error) { errors.push(`Could not read Agent Profiles: ${String(error)}`); }
  const team = own?.research ?? null;
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
        error: agents.length > 1 ? "Multiple active sessions for this member; resolve them before applying." : null });
    }
  }
  return { project, workspace: workspace ? workspaceLabel(workspace) : null, file: own?.file ?? null, team, legacy: !!own && !own.research, legacyTeam: own && !own.research ? own.team : null, profiles, bindings, identities, members, errors };
}
async function apply(rootTarget: Target, team: ResearchTeam, bindings: Record<string, string>, paseo: Api, resetId?: string, migrateLegacy = false) {
  const { project, workspaces, workspace, listing } = await context(rootTarget, paseo);
  if (listing.errors.length) throw new Error(listing.errors.join("\n"));
  if (workspace && workspaceLabel(workspace).toLowerCase() !== team.workspace.toLowerCase()) throw new Error("Team workspace must match the current workspace");
  const sameWorkspace = listing.teams.find(entry => entry.team.orchestrator.workspace.toLowerCase() === team.workspace.toLowerCase());
  if (sameWorkspace && (sameWorkspace.research ? sameWorkspace.research.id !== team.id : !migrateLegacy)) throw new Error("Workspace belongs to another team; use a free workspace for a new research team");
  if (listing.teams.some(entry => entry.research?.id === team.id && entry.team.orchestrator.workspace.toLowerCase() !== team.workspace.toLowerCase())) throw new Error("Team ID already belongs to another workspace");
  const catalog = catalogFrom((await paseo.providers.snapshot()).entries);
  const problems = validateResearch(team, catalog);
  if (problems.length) throw new Error(problems.join("\n"));
  const entries = await allAgents(paseo);
  const file = sameWorkspace?.file ?? teamFileFor(legacyView(team), listing.teams, listing.names);
  if (migrateLegacy && sameWorkspace && !sameWorkspace.research) {
    const migration = researchFromLegacy(sameWorkspace.team);
    const base = join(project.root, "prompts");
    await mkdir(base, { recursive: true });
    if (relative(await realpath(project.root), await realpath(base)).startsWith("..")) throw new Error("Prompt directory is outside the project");
    const dir = join(base, "research-team");
    await mkdir(dir, { recursive: true });
    if (relative(await realpath(project.root), await realpath(dir)).startsWith("..")) throw new Error("Prompt directory is outside the project");
    const seeds = [[migration.commonPromptFiles[0]!, "Coordinate shared files and keep research state in the Project.\n"], [migration.roles[0]!.promptFiles[0]!, "Guide the research and discuss direction with the user.\n"], ...sameWorkspace.team.roles.map((role, index) => [migration.roles[index + 1]!.promptFiles[0]!, role.instructions || `Role: ${role.name}\n`])];
    for (const [path, text] of seeds) await writeFile(join(project.root, path!), text!, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
  }
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
  if (migrateLegacy && sameWorkspace && !sameWorkspace.research) {
    const roleNames = new Set(sameWorkspace.team.roles.map(role => role.name));
    for (const { agent } of entries) if (!agent.archivedAt && agent.workspaceId === workspaceId && (agent.labels[LABEL] === "orchestrator" || roleNames.has(agent.labels.role ?? ""))) await paseo.agents.ref(agent.id).archive();
  }
  await ignoreRuntime(project.root);
  await atomic(join(project.root, file), JSON.stringify(team, null, 2) + "\n");
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
export async function applyResearch({ team: input, bindings, migrateLegacy, ...target }: RpcInput<typeof researchApplyRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchApplyRpc>> {
  const team = ResearchTeamSchema.parse(input);
  const project = await projectOf(paseo, target);
  return exclusive(project.root, () => apply(target, team, bindings, paseo, undefined, migrateLegacy));
}
export async function resetResearchMember({ workspaceId, memberId }: RpcInput<typeof researchResetRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof researchResetRpc>> {
  const project = await projectOf(paseo, { workspaceId });
  return exclusive(project.root, async () => {
    const { own } = await context({ workspaceId }, paseo);
    if (!own?.research?.members.some(member => member.id === memberId)) throw new Error("Unknown team member");
    await apply({ workspaceId }, own.research, {}, paseo, memberId);
    const directory = await runtime(project.root, own.research.id);
    return { agentId: directory!.members.find(member => member.id === memberId)!.agentId };
  });
}
