import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { access, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { workspaceLabel } from "../shared/apply-plan";
import { MEMBER_LABEL, ResearchTeamSchema, runtimeFile, TEAM_LABEL, type ResearchTeam } from "../shared/research-team";
import type { teamDeleteRpc, teamProjectsRpc, teamReconnectRpc, teamRestoreRpc } from "../shared/research-rpc";
import { allPages } from "./pagination";
import { applyResearch } from "./research-team";

type Api = PluginHandlerContext["paseo"];
type Target = { workspaceId: string } | { projectId: string };
type Project = { id: string; name: string; root: string };
export type TeamFile = { file: string; team: ResearchTeam };
const key = (value: string) => value.trim().toLowerCase();
const workspaces = (paseo: Api) => allPages(cursor => paseo.workspaces.list({ filter: { includeBackground: true }, page: { limit: 100, cursor } }));

async function projects(paseo: Api): Promise<Project[]> {
  return (await paseo.projects.list()).projects.map(project => ({ id: project.projectId, name: project.projectCustomName || project.projectDisplayName, root: project.projectRootPath }));
}
export async function projectOf(paseo: Api, target: Target): Promise<Project> {
  if ("projectId" in target) {
    const project = (await projects(paseo)).find(project => project.id === target.projectId);
    if (!project) throw new Error(`Project ${target.projectId} was not found.`);
    return project;
  }
  const workspace = await paseo.workspaces.ref(target.workspaceId).refresh();
  if (!workspace) throw new Error(`Workspace ${target.workspaceId} was not found.`);
  return { id: workspace.projectId, name: workspace.projectCustomName || workspace.projectDisplayName, root: workspace.projectRootPath };
}

/** Only member/Profile team definitions participate in the current workflow. */
export async function projectTeams(project: Project): Promise<{ teams: TeamFile[]; names: string[]; errors: string[] }> {
  const single = await access(join(project.root, ".agents/team.json")).then(() => [".agents/team.json"], () => []);
  const entries = await readdir(join(project.root, ".agents/teams")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const names = [...single, ...entries.filter(name => name.endsWith(".json")).sort().map(name => `.agents/teams/${name}`)];
  const teams: TeamFile[] = [], errors: string[] = [];
  for (const file of names) {
    try {
      const value: unknown = JSON.parse(await readFile(join(project.root, file), "utf8"));
      // Retired definitions stay on disk; they are neither converted nor managed.
      if (value && typeof value === "object" && "version" in value && value.version === 1) continue;
      const parsed = ResearchTeamSchema.safeParse(value);
      if (parsed.success) teams.push({ file, team: parsed.data });
      else errors.push(...parsed.error.issues.map(issue => `${file}: ${issue.path.join(".")}: ${issue.message}`));
    } catch (error) { errors.push(`${file}: ${String(error)}`); }
  }
  const ids = new Set<string>(), owners = new Set<string>();
  for (const { file, team } of teams) {
    if (ids.has(key(team.id))) errors.push(`${file}: duplicate team ID ${team.id}`);
    if (owners.has(key(team.workspace))) errors.push(`${file}: multiple teams use workspace ${team.workspace}`);
    ids.add(key(team.id)); owners.add(key(team.workspace));
  }
  return { teams, names, errors };
}
export function teamFileFor(team: ResearchTeam, files: readonly TeamFile[], names: readonly string[]): string {
  const existing = files.find(entry => key(entry.team.workspace) === key(team.workspace));
  if (existing) return existing.file;
  const base = key(team.workspace).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "team";
  const taken = new Set(names.map(key));
  let file = `.agents/teams/${base}.json`;
  for (let n = 2; taken.has(key(file)); n++) file = `.agents/teams/${base}-${n}.json`;
  return file;
}
export async function projectTeamsList(_input: RpcInput<typeof teamProjectsRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProjectsRpc>> {
  const [allProjects, entries] = await Promise.all([projects(paseo), workspaces(paseo)]);
  return Promise.all(allProjects.map(async project => {
    const { teams, errors } = await projectTeams(project);
    const own = entries.filter(entry => entry.projectId === project.id && !entry.archivingAt);
    return { ...project, workspaces: own.map(entry => ({ id: entry.id, title: workspaceLabel(entry) })), errors,
      teams: teams.map(({ file, team }) => ({ file, goal: team.goal, orchestratorWorkspace: team.workspace,
        workspaceId: own.find(entry => key(workspaceLabel(entry)) === key(team.workspace))?.id ?? null, roles: team.roles.length, members: team.members.length })) };
  }));
}
export async function deleteTeam({ projectId, file }: RpcInput<typeof teamDeleteRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamDeleteRpc>> {
  const project = await projectOf(paseo, { projectId });
  const listing = await projectTeams(project);
  if (listing.errors.length) throw new Error(listing.errors.join("\n"));
  const own = listing.teams.find(entry => entry.file === file);
  if (!own) throw new Error(`${file} is not a team file of ${project.name}.`);
  const scope = new Set((await workspaces(paseo)).filter(entry => entry.projectId === projectId && key(workspaceLabel(entry)) === key(own.team.workspace)).map(entry => entry.id));
  const agents = await allPages(cursor => paseo.agents.list({ filter: { includeBackground: true }, page: { limit: 100, cursor } }));
  const members = agents.map(entry => entry.agent).filter(agent => !agent.archivedAt && scope.has(agent.workspaceId ?? "") && agent.labels[TEAM_LABEL] === own.team.id && !!agent.labels[MEMBER_LABEL]);
  const failures: string[] = [], fileFailures: string[] = [], files: string[] = [];
  for (const agent of members) { try { await paseo.agents.ref(agent.id).archive(); } catch (error) { failures.push(`agent ${agent.id}: ${String(error)}`); } }
  if (failures.length) return { files, archived: members.length - failures.length, failures, fileFailures };
  for (const path of [file, runtimeFile(own.team.id)]) {
    try { await unlink(join(project.root, path)); if (path === file) files.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") fileFailures.push(`${path}: ${String(error)}`); }
  }
  return { files, archived: members.length, failures, fileFailures };
}
export async function reconnectTeam({ projectId, file, workspaceId }: RpcInput<typeof teamReconnectRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamReconnectRpc>> {
  const project = await projectOf(paseo, { projectId });
  const listing = await projectTeams(project);
  if (listing.errors.length) return { ok: false, errors: listing.errors };
  const own = listing.teams.find(entry => entry.file === file);
  if (!own) throw new Error(`${file} is not a team file of ${project.name}.`);
  const workspace = (await workspaces(paseo)).find(entry => entry.id === workspaceId && entry.projectId === projectId && !entry.archivingAt);
  if (!workspace) return { ok: false, errors: [`Workspace ${workspaceId} was not found in ${project.name}.`] };
  const title = workspaceLabel(workspace);
  if (listing.teams.some(entry => entry.file !== file && key(entry.team.workspace) === key(title))) return { ok: false, errors: [`Workspace "${title}" belongs to another team.`] };
  await writeFile(join(project.root, file), JSON.stringify({ ...own.team, workspace: title }, null, 2) + "\n", "utf8");
  return { ok: true, files: [file] };
}
export async function restoreTeam({ projectId, file }: RpcInput<typeof teamRestoreRpc>, ctx: PluginHandlerContext): Promise<RpcOutput<typeof teamRestoreRpc>> {
  const project = await projectOf(ctx.paseo, { projectId });
  const listing = await projectTeams(project);
  if (listing.errors.length) throw new Error(listing.errors.join("\n"));
  const own = listing.teams.find(entry => entry.file === file);
  if (!own) throw new Error(`${file} is not a team file of ${project.name}.`);
  return applyResearch({ projectId, team: own.team, bindings: {} }, ctx);
}
