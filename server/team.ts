import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ensureWorkspaces, planWorkspaces, workspaceLabel } from "../shared/apply-plan";
import { findOrchestrator, orchestratorsToArchive, teamAgentsToArchive, LABEL, pendingPlanners, PLANNER_WORKSPACE, plannerCleanup, PROPOSAL_FOR, proposalTarget } from "../shared/cleanup";
import { CLAUDE_LOCAL_SETTINGS, needsCreateAgentPermission, needsRunPermission, PASEO_CREATE_AGENT_RULE, PASEO_RUN_RULE, withAllowRule } from "../shared/permissions";
import { orchestratorPrompt, teamChangedMessage } from "../shared/prompt";
import { extractInstructions, extractProposal, INSTRUCTIONS_JSON_SCHEMA, instructionsPrompt, plannerPrompt, teamEditPrompt, TEAM_JSON_SCHEMA } from "../shared/proposal";
import { plannerWorkspace, teamWorkspaceId, type ProjectRef } from "../shared/projects";
import type { teamApplyRpc, teamDeleteRpc, teamInstructionsImproveRpc, teamInstructionsProposalRpc, teamPendingProposalRpc, teamProjectsRpc, teamProposalCancelRpc, teamProposalRpc, teamProposeRpc, teamReadRpc, teamReconnectRpc, teamRestartOrchestratorRpc, teamRestoreRpc, teamEditProposalRpc, teamEditProposeRpc, teamRosterRpc } from "../shared/rpc";
import { checkTeam, parseTeam, serializeTeam, TEAM_FILE, type Team } from "../shared/team";
import { legacyWorkspacesOf, sameTeamFiles, teamFileFor, teamFileWorkspaces, teamIn, workspaceOwnerOf, TEAMS_DIR, workspaceClashes, workspacesOfOtherTeams, type TeamFile } from "../shared/team-files";
import { agentFeaturesOf, catalogFrom, roleModes, agentModeOf, type AgentFeatures, validateTeam, type ProviderEntry } from "../shared/validate";


type PaseoApi = PluginHandlerContext["paseo"];
type Target = { workspaceId: string } | { projectId: string };

/** Feature discovery is optional: an unavailable provider must not prevent applying a team. */
async function featuresFor(paseo: PaseoApi, entries: readonly ProviderEntry[], provider: string, cwd: string): Promise<AgentFeatures> {
  const id = provider.split("/")[0]!;
  if (agentModeOf(entries, id) !== undefined) return undefined;
  try {
    const result = await paseo.providers.listFeatures({ provider, cwd });
    return agentFeaturesOf(entries, id, result.features ?? []);
  } catch {
    return undefined;
  }
}

async function roleFeaturesFor(paseo: PaseoApi, entries: readonly ProviderEntry[], team: Team, cwd: string): Promise<Record<string, AgentFeatures>> {
  return Object.fromEntries(await Promise.all(team.roles.map(async (role) => [role.name, await featuresFor(paseo, entries, `${role.provider}/${role.model}`, cwd)])));
}

async function allProjects(paseo: PaseoApi): Promise<ProjectRef[]> {
  const { projects } = await paseo.projects.list();
  return projects.map((project) => ({ id: project.projectId, name: project.projectCustomName || project.projectDisplayName, root: project.projectRootPath }));
}

async function projectOf(paseo: PaseoApi, target: Target): Promise<ProjectRef> {
  if ("projectId" in target) {
    const project = (await allProjects(paseo)).find((candidate) => candidate.id === target.projectId);
    if (!project) throw new Error(`Project ${target.projectId} was not found.`);
    return project;
  }
  const workspace = await paseo.workspaces.ref(target.workspaceId).refresh();
  if (!workspace) throw new Error(`Workspace ${target.workspaceId} was not found.`);
  return { id: workspace.projectId, name: workspace.projectCustomName || workspace.projectDisplayName, root: workspace.projectRootPath };
}

/** The workspace to start the planner in: the given one, else one of the project's, else a new "Team planner". */
async function plannerWorkspaceOf(paseo: PaseoApi, target: Target): Promise<string> {
  if ("workspaceId" in target) return target.workspaceId;
  const project = await projectOf(paseo, target);
  const { entries } = await paseo.workspaces.list();
  return plannerWorkspace(entries, project.id) ?? (await paseo.workspaces.create({ title: PLANNER_WORKSPACE, source: { kind: "directory", path: project.root, projectId: project.id } })).id;
}

async function providerEntries(paseo: PaseoApi): Promise<ProviderEntry[]> {
  const snapshot = await paseo.providers.snapshot();
  return snapshot.entries as unknown as ProviderEntry[];
}

/** The planner runs on Claude when it's ready, else the first ready provider, with that provider's default model. */
function plannerProvider(entries: readonly ProviderEntry[]): string {
  const ready = entries.filter((entry) => entry.enabled && entry.status === "ready");
  const entry = ready.find((candidate) => candidate.provider === "claude") ?? ready[0];
  if (!entry) throw new Error("No provider is ready on this host.");
  const models = (entry.models ?? []) as readonly { id: string; isDefault?: boolean }[];
  const model = models.find((candidate) => candidate.isDefault) ?? models[0];
  return model ? `${entry.provider}/${model.id}` : entry.provider;
}

export async function projectTeamsList(_input: RpcInput<typeof teamProjectsRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProjectsRpc>> {
  const [projects, { entries }] = await Promise.all([allProjects(paseo), paseo.workspaces.list()]);
  return Promise.all(projects.map(async (project) => {
    const { teams, errors } = await projectTeams(project);
    return {
      ...project,
      workspaces: entries.filter((entry) => entry.projectId === project.id && !entry.archivingAt).map((entry) => ({ id: entry.id, title: workspaceLabel(entry) })),
      teams: teams.map(({ file, team }) => ({
        file,
        goal: team.goal,
        orchestratorWorkspace: team.orchestrator.workspace,
        workspaceId: teamWorkspaceId(entries, project.id, team.orchestrator.workspace),
        roles: team.roles.length,
      })),
      errors,
    };
  }));
}

/** Archives the team's agents in workspaces no other team uses, then deletes its files only if archiving succeeds. */
export async function deleteTeam({ projectId, file }: RpcInput<typeof teamDeleteRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamDeleteRpc>> {
  const project = await projectOf(paseo, { projectId });
  const [{ teams }, { entries }, { entries: agentEntries }] = await Promise.all([projectTeams(project), paseo.workspaces.list(), paseo.agents.list()]);
  // Only a file the listing showed can be deleted, so the path can't point anywhere else.
  const own = sameTeamFiles(teams, file);
  if (!own.length) throw new Error(`${file} is not a team file of ${project.name}.`);
  const idOf = (title: string) => teamWorkspaceId(entries, project.id, title);
  const workspaceIds = own.flatMap(teamFileWorkspaces).map(idOf).filter((id): id is string => id !== null);
  const keep = workspacesOfOtherTeams(teams, own[0]!.team.orchestrator.workspace).map(idOf).filter((id): id is string => id !== null);
  const agents = agentEntries.map((entry) => entry.agent);
  const ids = teamAgentsToArchive(agents, workspaceIds.filter((id) => !keep.includes(id)), own.flatMap(({ team }) => team.roles.map((role) => role.name)));
  const failures = await archiveAgents(paseo, ids, "agent");
  // Keep the files after an agent failure so deletion can be retried from the same team row.
  if (failures.length) return { files: [], archived: ids.length - failures.length, failures, fileFailures: [] };
  const fileFailures: string[] = [];
  const files: string[] = [];
  for (const entry of own) {
    try { await unlink(join(project.root, entry.file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { fileFailures.push(`file ${entry.file}: ${String(error)}`); continue; }
    }
    files.push(entry.file);
  }
  return { files, archived: ids.length, failures, fileFailures };
}

/** Reconnects every file for the team to the selected workspace's current title. */
export async function reconnectTeam({ projectId, file, workspaceId }: RpcInput<typeof teamReconnectRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamReconnectRpc>> {
  const project = await projectOf(paseo, { projectId });
  const [{ teams }, { entries }] = await Promise.all([projectTeams(project), paseo.workspaces.list()]);
  const own = sameTeamFiles(teams, file);
  if (!own.length) throw new Error(`${file} is not a team file of ${project.name}.`);
  const workspace = entries.find((entry) => entry.id === workspaceId && entry.projectId === project.id && !entry.archivingAt);
  if (!workspace) return { ok: false, errors: [`Workspace ${workspaceId} was not found in ${project.name}.`] };
  const title = workspaceLabel(workspace);
  const key = (value: string) => value.trim().toLowerCase();
  const taken = workspacesOfOtherTeams(teams, own[0]!.team.orchestrator.workspace);
  if (taken.some((name) => key(name) === key(title))) return { ok: false, errors: [`Workspace "${title}" belongs to another team.`] };
  for (const { file, team } of own) await writeFile(join(project.root, file), serializeTeam({ ...team, orchestrator: { ...team.orchestrator, workspace: title } }), "utf8");
  return { ok: true, files: own.map((entry) => entry.file) };
}

export async function teamRoster({ workspaceId }: RpcInput<typeof teamRosterRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamRosterRpc>> {
  const { entries } = await paseo.workspaces.list();
  const workspace = entries.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} was not found.`);
  const project: ProjectRef = { id: workspace.projectId, name: workspace.projectCustomName || workspace.projectDisplayName, root: workspace.projectRootPath };
  const { teams, errors } = await projectTeams(project);
  const idOf = (title: string) => teamWorkspaceId(entries, project.id, title);
  return {
    teams: teams.map(({ team }) => {
      const orchestratorWorkspaceId = idOf(team.orchestrator.workspace);
      return {
        orchestratorWorkspaceId,
        roles: team.roles.map((role) => ({ name: role.name, provider: role.provider, model: role.model, workspaceId: orchestratorWorkspaceId })),
      };
    }),
    errors,
  };
}

/** The project's team files, relative to its root: the single-team file first, then the teams folder by name. */
async function teamFileNames(project: ProjectRef): Promise<string[]> {
  const legacy = await access(join(project.root, TEAM_FILE)).then(() => [TEAM_FILE], () => []);
  const names = await readdir(join(project.root, TEAMS_DIR)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return [...legacy, ...names.filter((name) => name.endsWith(".json")).sort().map((name) => `${TEAMS_DIR}/${name}`)];
}

/** Every team of the project, the names of all its team files, and the problems of those that don't parse. */
async function projectTeams(project: ProjectRef): Promise<{ teams: TeamFile[]; names: string[]; errors: string[] }> {
  const names = await teamFileNames(project);
  const teams: TeamFile[] = [];
  const errors: string[] = [];
  for (const file of names) {
    const text = await readFile(join(project.root, file), "utf8");
    const parsed = parseTeam(text);
    if (parsed.ok) teams.push({ file, team: parsed.team, legacyWorkspaces: legacyWorkspacesOf(JSON.parse(text)) });
    else errors.push(...parsed.errors.map((error) => `${file}: ${error}`));
  }
  return { teams, names, errors };
}

async function workspaceTitle(paseo: PaseoApi, workspaceId: string): Promise<string> {
  const workspace = (await paseo.workspaces.list()).entries.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new Error(`Workspace ${workspaceId} was not found.`);
  return workspaceLabel(workspace);
}

export async function readTeam(target: RpcInput<typeof teamReadRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamReadRpc>> {
  const project = await projectOf(paseo, target);
  const catalog = catalogFrom(await providerEntries(paseo));
  const [{ teams, errors }, { entries }] = await Promise.all([projectTeams(project), paseo.workspaces.list()]);
  const workspace = "workspaceId" in target ? await workspaceTitle(paseo, target.workspaceId) : null;
  const own = workspace === null ? undefined : workspaceOwnerOf(teams, workspace);
  return {
    project,
    workspace,
    file: own?.file ?? null,
    team: own?.team ?? null,
    takenWorkspaces: workspacesOfOtherTeams(teams, own?.team.orchestrator.workspace ?? workspace ?? ""),
    projectWorkspaces: entries.filter((entry) => entry.projectId === project.id && !entry.archivingAt).map(workspaceLabel),
    errors,
    validation: own ? validateTeam(own.team, catalog) : [],
    catalog,
  };
}

/** The target's unarchived team planners, newest first. */
async function plannersFor(paseo: PaseoApi, target: Target): Promise<string[]> {
  return pendingPlanners((await paseo.agents.list()).entries.map((entry) => entry.agent), proposalTarget(target));
}

/** A new proposal replaces the target's earlier ones, so only one can ever come back to the screen. */
async function archivePlannersFor(paseo: PaseoApi, target: Target): Promise<void> {
  for (const id of await plannersFor(paseo, target)) await paseo.agents.ref(id).archive();
}

export async function proposeTeam({ goal, ...target }: RpcInput<typeof teamProposeRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProposeRpc>> {
  // A leftover earlier planner can't shadow this one (the newest is restored), so failing to archive it doesn't block proposing.
  await archivePlannersFor(paseo, target).catch(() => undefined);
  const entries = await providerEntries(paseo);
  const provider = plannerProvider(entries);
  const featureValues = await featuresFor(paseo, entries, provider, (await projectOf(paseo, target)).root);
  const agent = await paseo.workspaces.ref(await plannerWorkspaceOf(paseo, target)).agents.create({
    config: { provider, modeId: agentModeOf(entries, provider.split("/")[0]!), ...(featureValues ? { featureValues } : {}) },
    title: "Team planner",
    prompt: plannerPrompt(goal, catalogFrom(entries)),
    outputSchema: TEAM_JSON_SCHEMA,
    labels: { [LABEL]: "planner", [PROPOSAL_FOR]: proposalTarget(target) },
  });
  return { agentId: agent.id };
}

export async function pendingProposal(target: RpcInput<typeof teamPendingProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamPendingProposalRpc>> {
  return { agentId: (await plannersFor(paseo, target))[0] ?? null };
}

export async function cancelProposal(target: RpcInput<typeof teamProposalCancelRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProposalCancelRpc>> {
  await archivePlannersFor(paseo, target);
  return {};
}

/** Waits up to a second for a planner; its final message once it has finished. */
async function plannerAnswer(paseo: PaseoApi, agentId: string): Promise<{ status: "running" } | { status: "failed"; errors: string[] } | { status: "finished"; message: string | null }> {
  const result = await paseo.agents.ref(agentId).waitForFinish(1000);
  if (result.status === "timeout") return { status: "running" };
  if (result.status === "error") return { status: "failed", errors: [result.error ?? "the planner stopped with an error"] };
  if (result.status === "permission") return { status: "failed", errors: ["the planner is waiting for a permission; answer it in the planner's chat, then try again"] };
  return { status: "finished", message: result.lastMessage };
}

export async function teamProposal({ agentId }: RpcInput<typeof teamProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamProposalRpc>> {
  const result = await plannerAnswer(paseo, agentId);
  if (result.status !== "finished") return result;
  const parsed = extractProposal(result.message);
  if (!parsed.ok) return { status: "failed", errors: parsed.errors };
  return { status: "done", team: parsed.team, validation: validateTeam(parsed.team, catalogFrom(await providerEntries(paseo))) };
}

export async function proposeTeamEdit({ request, team, ...target }: RpcInput<typeof teamEditProposeRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamEditProposeRpc>> {
  const entries = await providerEntries(paseo);
  const provider = plannerProvider(entries);
  const featureValues = await featuresFor(paseo, entries, provider, (await projectOf(paseo, target)).root);
  const agent = await paseo.workspaces.ref(await plannerWorkspaceOf(paseo, target)).agents.create({
    config: { provider, modeId: agentModeOf(entries, provider.split("/")[0]!), ...(featureValues ? { featureValues } : {}) },
    title: "Team editor",
    prompt: teamEditPrompt(request, team, catalogFrom(entries)),
    outputSchema: TEAM_JSON_SCHEMA,
    labels: { [LABEL]: "planner" },
  });
  return { agentId: agent.id };
}

export async function teamEditProposal({ agentId }: RpcInput<typeof teamEditProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamEditProposalRpc>> {
  const result = await plannerAnswer(paseo, agentId);
  if (result.status !== "finished") return result;
  const parsed = extractProposal(result.message);
  if (!parsed.ok) return { status: "failed", errors: parsed.errors };
  await paseo.agents.ref(agentId).archive().catch(() => undefined);
  return { status: "done", team: parsed.team, validation: validateTeam(parsed.team, catalogFrom(await providerEntries(paseo))) };
}

export async function improveInstructions({ role, request, team, ...target }: RpcInput<typeof teamInstructionsImproveRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamInstructionsImproveRpc>> {
  const entries = await providerEntries(paseo);
  const provider = plannerProvider(entries);
  const featureValues = await featuresFor(paseo, entries, provider, (await projectOf(paseo, target)).root);
  const agent = await paseo.workspaces.ref(await plannerWorkspaceOf(paseo, target)).agents.create({
    config: { provider, modeId: agentModeOf(entries, provider.split("/")[0]!), ...(featureValues ? { featureValues } : {}) },
    title: "Instructions planner",
    prompt: instructionsPrompt(role, request, team),
    outputSchema: INSTRUCTIONS_JSON_SCHEMA,
    labels: { [LABEL]: "planner" },
  });
  return { agentId: agent.id };
}

export async function instructionsProposal({ agentId }: RpcInput<typeof teamInstructionsProposalRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamInstructionsProposalRpc>> {
  const result = await plannerAnswer(paseo, agentId);
  if (result.status !== "finished") return result;
  const parsed = extractInstructions(result.message);
  return parsed.ok ? { status: "done", instructions: parsed.instructions } : { status: "failed", errors: parsed.errors };
}

/** Archives agents, returning failures with the caller's label. */
async function archiveAgents(paseo: PaseoApi, ids: readonly string[], prefix: string): Promise<string[]> {
  const failures: string[] = [];
  for (const id of ids) await paseo.agents.ref(id).archive().catch((error: unknown) => failures.push(`${prefix} ${id}: ${String(error)}`));
  return failures;
}

/** Archives the planners, then their emptied workspaces; returns what failed instead of throwing. */
async function archivePlanners(paseo: PaseoApi, targets: { agents: string[]; workspaces: string[] }): Promise<string[]> {
  const failures = await archiveAgents(paseo, targets.agents, "planner");
  for (const id of targets.workspaces) {
    const result = await paseo.workspaces.archive(id).catch((error: unknown) => ({ error: String(error) }));
    if (result.error) failures.push(`workspace ${id}: ${result.error}`);
  }
  return failures;
}

/**
 * Lets the project's Claude orchestrator start agents with `paseo run`, so its Auto-mode reviewer can't deny a role
 * that runs unattended. Returns the settings file when the rule was added, null when it was already there.
 */
async function allowPaseoRun(project: ProjectRef, rules: string[] = [PASEO_RUN_RULE]): Promise<{ ok: true; file: string | null } | { ok: false; errors: string[] }> {
  const file = join(project.root, CLAUDE_LOCAL_SETTINGS);
  const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "{}";
    throw error;
  });
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`${CLAUDE_LOCAL_SETTINGS} is not valid JSON: ${(error as Error).message}`] };
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return { ok: false, errors: [`${CLAUDE_LOCAL_SETTINGS} is not a JSON object`] };
  let next = settings as Record<string, unknown>;
  for (const rule of rules) next = withAllowRule(next, rule) ?? next;
  if (next === settings) return { ok: true, file: null };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return { ok: true, file };
}

/** Starts an orchestrator with the same configuration for apply and restart. */
async function startOrchestrator(paseo: PaseoApi, workspaceId: string, team: Team, modes: ReturnType<typeof roleModes>, orchestratorMode: ReturnType<typeof agentModeOf>, relative: string, features: Record<string, AgentFeatures>, featureValues: AgentFeatures) {
  return paseo.workspaces.ref(workspaceId).agents.create({
    config: { provider: `${team.orchestrator.provider}/${team.orchestrator.model}`, modeId: orchestratorMode, ...(featureValues ? { featureValues } : {}), systemPrompt: orchestratorPrompt(team, modes, relative, features) },
    title: "Orchestrator",
    prompt: `Read ${relative}, then reply with a short summary of the team (role, workspace, provider/model) and say you are ready for a request. Do not start any agents yet. In your ready reply, tell the user that /clear makes you lose your orchestrator role and that the team panel's "Reset session" button gives a fresh conversation that keeps the role.`,
    labels: { [LABEL]: "orchestrator" },
  });
}

export async function restartOrchestrator(target: RpcInput<typeof teamRestartOrchestratorRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamRestartOrchestratorRpc>> {
  const project = await projectOf(paseo, target);
  const { teams, errors } = await projectTeams(project);
  const workspace = "workspaceId" in target ? await workspaceTitle(paseo, target.workspaceId) : null;
  const own = workspace === null ? undefined : teamIn(teams, workspace);
  if (!own) return { ok: false, errors: [...errors, "No team was found for the target workspace."] };
  const { team, file } = own;
  const providers = await providerEntries(paseo);
  const problems = validateTeam(team, catalogFrom(providers));
  if (problems.length) return { ok: false, errors: problems.map((problem) => `${problem.target}: ${problem.message}`) };
  const { entries } = await paseo.workspaces.list();
  const workspaceId = teamWorkspaceId(entries, project.id, team.orchestrator.workspace);
  if (!workspaceId) return { ok: false, errors: [`Workspace ${team.orchestrator.workspace} was not found.`] };
  const features = await roleFeaturesFor(paseo, providers, team, project.root);
  const featureValues = await featuresFor(paseo, providers, `${team.orchestrator.provider}/${team.orchestrator.model}`, project.root);
  const rules = [ ...(needsRunPermission(team, providers) ? [PASEO_RUN_RULE] : []), ...(needsCreateAgentPermission(team, features) ? [PASEO_CREATE_AGENT_RULE] : []) ];
  const permission = rules.length ? await allowPaseoRun(project, rules) : { ok: true as const, file: null };
  if (!permission.ok) return { ok: false, errors: permission.errors };
  const agents = (await paseo.agents.list()).entries.map((entry) => entry.agent);
  const archived = orchestratorsToArchive(agents, workspaceId);
  const failures: string[] = [];
  for (const id of archived) {
    await paseo.agents.ref(id).archive().catch((error: unknown) => failures.push(`orchestrator ${id}: ${String(error)}`));
  }
  if (failures.length) return { ok: false, errors: failures };
  const orchestrator = await startOrchestrator(paseo, workspaceId, team, roleModes(team, providers), agentModeOf(providers, team.orchestrator.provider), file, features, featureValues);
  return { ok: true, orchestratorAgentId: orchestrator.id, archived };
}

/** Restores a saved team through the same validation and workspace setup as Apply. */
export async function restoreTeam({ projectId, file }: RpcInput<typeof teamRestoreRpc>, ctx: PluginHandlerContext): Promise<RpcOutput<typeof teamRestoreRpc>> {
  const project = await projectOf(ctx.paseo, { projectId });
  const { teams } = await projectTeams(project);
  const saved = teams.find((entry) => entry.file === file);
  if (!saved) return { ok: false, errors: [`Team file ${file} was not found.`] };
  return applyTeam({ projectId, team: saved.team }, ctx);
}

export async function applyTeam({ team: input, ...target }: RpcInput<typeof teamApplyRpc>, { paseo }: PluginHandlerContext): Promise<RpcOutput<typeof teamApplyRpc>> {
  const checked = checkTeam(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const team = checked.team;
  const providers = await providerEntries(paseo);
  const problems = validateTeam(team, catalogFrom(providers));
  if (problems.length) return { ok: false, errors: problems.map((problem) => `${problem.target}: ${problem.message}`) };

  const project = await projectOf(paseo, target);
  const { teams, names } = await projectTeams(project);
  // Teams never share a workspace, so one team's role sessions can't mix with another's.
  const clashes = workspaceClashes(team, workspacesOfOtherTeams(teams, team.orchestrator.workspace));
  if (clashes.length) return { ok: false, errors: clashes.map((problem) => `${problem.target}: ${problem.message}`) };
  const features = await roleFeaturesFor(paseo, providers, team, project.root);
  const featureValues = await featuresFor(paseo, providers, `${team.orchestrator.provider}/${team.orchestrator.model}`, project.root);
  const rules = [ ...(needsRunPermission(team, providers) ? [PASEO_RUN_RULE] : []), ...(needsCreateAgentPermission(team, features) ? [PASEO_CREATE_AGENT_RULE] : []) ];
  const permission = rules.length ? await allowPaseoRun(project, rules) : { ok: true as const, file: null };
  if (!permission.ok) return { ok: false, errors: permission.errors };
  const relative = teamFileFor(team, teams, names);
  const file = join(project.root, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, serializeTeam(team), "utf8");

  const { entries } = await paseo.workspaces.list();
  const existing = entries.filter((workspace) => workspace.projectId === project.id && !workspace.archivingAt);
  const workspaces = await ensureWorkspaces(planWorkspaces(team, existing), async (title) => (await paseo.workspaces.create({ title, source: { kind: "directory", path: project.root, projectId: project.id } })).id);

  const lead = workspaces[0]!;
  const modes = roleModes(team, providers);
  const orchestratorMode = agentModeOf(providers, team.orchestrator.provider);
  // Applying again keeps the orchestrator already running on the same model and mode and tells it to re-read the team.
  const agents = (await paseo.agents.list()).entries.map((entry) => entry.agent);
  const running = findOrchestrator(agents, lead.id, team, orchestratorMode);
  if (running) {
    await paseo.agents.ref(running.id).send(teamChangedMessage(team, modes, relative, features));
    return { ok: true, file, workspaces, orchestratorAgentId: running.id, cleanup: await archivePlanners(paseo, plannerCleanup(existing, agents, team)), permission: permission.file };
  }
  const orchestrator = await startOrchestrator(paseo, lead.id, team, modes, orchestratorMode, relative, features, featureValues);
  return { ok: true, file, workspaces, orchestratorAgentId: orchestrator.id, cleanup: await archivePlanners(paseo, plannerCleanup(existing, agents, team)), permission: permission.file };
}
