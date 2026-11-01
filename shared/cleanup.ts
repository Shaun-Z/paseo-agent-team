import { planWorkspaces, workspaceLabel, type WorkspaceRef } from "./apply-plan";
import type { Team } from "./team";

/** Label key on the agents this plugin starts; the value is the agent's job. */
export const LABEL = "workspace-agents";

/** Label key on a team planner naming the workspace or project its proposal is for, so a reopened screen can find it again. */
export const PROPOSAL_FOR = "workspace-agents-proposal-for";

/** The id a team proposal is filed under: the workspace's, or the project's when no workspace is open. */
export function proposalTarget(target: { workspaceId: string } | { projectId: string }): string {
  return "workspaceId" in target ? target.workspaceId : target.projectId;
}

/** The unarchived team planners proposing for the target, newest first. */
export function pendingPlanners(agents: readonly (AgentRef & { createdAt: string })[], targetId: string): string[] {
  return agents
    .filter((agent) => agent.labels[LABEL] === "planner" && agent.labels[PROPOSAL_FOR] === targetId && !agent.archivedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((agent) => agent.id);
}

/** Title of the workspace the planner gets when its project has none. */
export const PLANNER_WORKSPACE = "Team planner";

/** The part of a Paseo agent that cleanup needs. */
export interface AgentRef {
  id: string;
  workspaceId?: string | null;
  labels: Record<string, string>;
  archivedAt?: string | null;
}

/**
 * What to archive once a team is applied: every unarchived planner in the project's workspaces, and a
 * Team planner workspace the team doesn't use and that has no other agents left.
 */
export function plannerCleanup(workspaces: readonly WorkspaceRef[], agents: readonly AgentRef[], team: Team): { agents: string[]; workspaces: string[] } {
  const ids = new Set(workspaces.map((workspace) => workspace.id));
  const live = agents.filter((agent) => ids.has(agent.workspaceId ?? "") && !agent.archivedAt);
  const planners = live.filter((agent) => agent.labels[LABEL] === "planner");
  const emptied = workspaces.filter(
    (workspace) =>
      workspaceLabel(workspace) === PLANNER_WORKSPACE &&
      planWorkspaces(team, [workspace]).every((step) => step.existingId === null) &&
      live.every((agent) => agent.workspaceId !== workspace.id || planners.includes(agent)),
  );
  return { agents: planners.map((agent) => agent.id), workspaces: emptied.map((workspace) => workspace.id) };
}

/** An agent as orchestrator reuse needs it. */
export interface OrchestratorCandidate extends AgentRef {
  provider: string;
  model: string | null;
  currentModeId?: string | null;
}

/** The running orchestrator in the lead workspace on the team's provider/model and, when given, mode. */
export function findOrchestrator(agents: readonly OrchestratorCandidate[], workspaceId: string, team: Team, modeId: string | undefined): OrchestratorCandidate | undefined {
  return agents.find(
    (agent) =>
      agent.workspaceId === workspaceId &&
      agent.labels[LABEL] === "orchestrator" &&
      !agent.archivedAt &&
      agent.provider === team.orchestrator.provider &&
      agent.model === team.orchestrator.model &&
      (modeId === undefined || agent.currentModeId === modeId),
  );
}

/** The unarchived orchestrators of the workspace, whatever their provider, model or mode; a restart archives them all. */
export function orchestratorsToArchive(agents: readonly AgentRef[], workspaceId: string): string[] {
  return agents.filter((agent) => agent.workspaceId === workspaceId && agent.labels[LABEL] === "orchestrator" && !agent.archivedAt).map((agent) => agent.id);
}

/** What a deleted team leaves to archive: its orchestrators and labelled roles in its workspaces, and planners proposing for them anywhere. */
export function teamAgentsToArchive(agents: readonly AgentRef[], workspaceIds: readonly string[], roles: readonly string[]): string[] {
  const names = new Set(roles.map((role) => role.toLowerCase()));
  return agents
    .filter((agent) => !agent.archivedAt && ((workspaceIds.includes(agent.workspaceId ?? "") && (agent.labels[LABEL] === "orchestrator" || names.has((agent.labels.role ?? "").toLowerCase()))) || (agent.labels[LABEL] === "planner" && workspaceIds.includes(agent.labels[PROPOSAL_FOR] ?? ""))))
    .map((agent) => agent.id);
}
