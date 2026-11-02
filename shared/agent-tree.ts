import { LABEL } from "./cleanup";

/** Label Paseo puts on an agent started by another agent; the snapshot has no parent field. */
const PARENT_LABEL = "paseo.parent-agent-id";

/** The part of a Paseo agent snapshot the dashboard needs. */
export interface DashboardAgent {
  id: string;
  workspaceId?: string | null;
  provider: string;
  model?: string | null;
  title?: string | null;
  status: string;
  currentModeId?: string | null;
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
  parentAgentId?: string | null;
  subagent?: true;
  subagentType?: string | null;
  labels: Record<string, string>;
  archivedAt?: string | null;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  createdAt: string;
}

export type AgentKind = "orchestrator" | "planner" | "role" | "agent" | "subagent";
export type AgentBadge = "attention" | "running" | "done" | null;

export interface AgentNode {
  agent: DashboardAgent;
  kind: AgentKind;
  role: string | null;
  title: string;
  model: string | null;
  effort: string | null;
  /** The effort is the model's default, not one set on the agent. */
  effortDefault: boolean;
  mode: string | null;
  badge: AgentBadge;
  live: boolean;
  /** Not running itself, but a descendant is. */
  delegating: boolean;
  /** A role of the team that has no session yet; its `agent` is a stand-in, not a Paseo agent. */
  waiting: boolean;
  children: AgentNode[];
}

/** A team's roles; each workspaceId is the orchestrator's (null when it doesn't exist yet). */
export interface RosterTeam {
  orchestratorWorkspaceId: string | null;
  roles: { name: string; provider: string; model: string; workspaceId: string | null }[];
}

/** Roots that started other agents, and roots that did not. */
export interface AgentForest {
  trees: AgentNode[];
  solo: AgentNode[];
}

export function parentOf(agent: DashboardAgent): string | undefined {
  return (agent.parentAgentId ?? agent.labels[PARENT_LABEL]) || undefined;
}

/** Closed and archived agents are hidden unless the user asks for them. */
export function isHidden(agent: DashboardAgent): boolean {
  return agent.status === "closed" || !!agent.archivedAt;
}

function kindOf(agent: DashboardAgent): AgentKind {
  if (agent.subagent) return "subagent";
  const job = agent.labels[LABEL];
  if (job === "orchestrator" || job === "planner") return job;
  return agent.labels.role ? "role" : "agent";
}

function badgeOf(agent: DashboardAgent): AgentBadge {
  if (agent.requiresAttention && (agent.attentionReason === "permission" || agent.attentionReason === "error")) return "attention";
  if (agent.status === "error") return "attention";
  if (agent.status === "running") return "running";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "done";
  return null;
}

/** `defaultEffort` is the model's default thinking option, shown when the agent sets none. */
export function agentNode(agent: DashboardAgent, children: AgentNode[] = [], defaultEffort?: string): AgentNode {
  const live = agent.status === "running";
  const effort = agent.effectiveThinkingOptionId ?? agent.thinkingOptionId ?? null;
  return {
    agent,
    kind: kindOf(agent),
    role: agent.labels.role ?? null,
    title: agent.title?.trim() || agent.id.slice(0, 7),
    model: agent.model ?? null,
    effort: effort ?? defaultEffort ?? null,
    effortDefault: effort === null && defaultEffort !== undefined,
    mode: agent.currentModeId ?? null,
    badge: badgeOf(agent),
    live,
    delegating: !live && children.some((child) => child.live || child.delegating),
    waiting: false,
    children,
  };
}

function waitingNode(orchestrator: DashboardAgent, role: RosterTeam["roles"][number]): AgentNode {
  const stand = { id: `waiting:${orchestrator.id}:${role.name}`, workspaceId: orchestrator.workspaceId, provider: role.provider, model: role.model, title: role.name, status: "waiting", labels: { role: role.name }, createdAt: "" };
  return { ...agentNode(stand), waiting: true };
}

/** Only the newest shown orchestrator of the team's workspace gets the team's roles. */
function leadOf(scope: readonly DashboardAgent[], team: RosterTeam): DashboardAgent | undefined {
  return scope
    .filter((agent) => agent.labels[LABEL] === "orchestrator" && agent.workspaceId === team.orchestratorWorkspaceId && team.orchestratorWorkspaceId !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/** Per orchestrator id, the waiting nodes of the roles of its team that no shown agent has taken yet. */
function waitingRoles(scope: readonly DashboardAgent[], roster: readonly RosterTeam[]): Map<string, AgentNode[]> {
  const result = new Map<string, AgentNode[]>();
  for (const team of roster) {
    const lead = leadOf(scope, team);
    if (!lead) continue;
    const taken = (role: RosterTeam["roles"][number]) => scope.some((agent) => agent.labels.role === role.name && team.orchestratorWorkspaceId !== null && agent.workspaceId === team.orchestratorWorkspaceId);
    const nodes = team.roles.filter((role) => !taken(role)).map((role) => waitingNode(lead, role));
    if (nodes.length) result.set(lead.id, nodes);
  }
  return result;
}

const newestFirst = (a: AgentNode, b: AgentNode) => b.agent.createdAt.localeCompare(a.agent.createdAt);

/**
 * The agents in the given workspaces as parent → child trees, with the roster's waiting roles after an orchestrator's children. A child whose parent is not shown becomes a root,
 * and so does an agent caught in a parent cycle; a role session of a roster team is the exception and goes under the team's orchestrator.
 */
export function buildAgentForest(agents: readonly DashboardAgent[], workspaceIds: readonly string[], options: { showClosed: boolean; defaultEfforts?: Record<string, string>; roster?: readonly RosterTeam[] }): AgentForest {
  const workspaces = new Set(workspaceIds);
  const scope = agents.filter((agent) => workspaces.has(agent.workspaceId ?? "") && (options.showClosed || !isHidden(agent)));
  const byId = new Map(scope.map((agent) => [agent.id, agent]));
  // A child when its parent is shown and it is not its own ancestor; the walk stops at a cycle above it.
  const isChild = (agent: DashboardAgent) => {
    const seen = new Set<string>();
    for (let parent = parentOf(agent); parent !== undefined && byId.has(parent) && !seen.has(parent); parent = parentOf(byId.get(parent)!)) {
      if (parent === agent.id) return false;
      seen.add(parent);
    }
    return byId.has(parentOf(agent) ?? "");
  };
  // A role session in a team's workspace whose parent is not shown (say, a cleared orchestrator) goes to the team's current orchestrator.
  const leads = (options.roster ?? []).flatMap((team) => {
    const lead = leadOf(scope, team);
    return lead ? [{ lead, workspaces: new Set([team.orchestratorWorkspaceId]) }] : [];
  });
  const adopter = (agent: DashboardAgent) => (agent.labels.role && parentOf(agent) !== undefined ? leads.find((team) => team.workspaces.has(agent.workspaceId ?? "")) : undefined)?.lead;
  const children = new Map<string, DashboardAgent[]>();
  const roots: DashboardAgent[] = [];
  for (const agent of scope) {
    const parent = isChild(agent) ? parentOf(agent) : adopter(agent)?.id;
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), agent]);
    else roots.push(agent);
  }
  const waiting = waitingRoles(scope, options.roster ?? []);
  const build = (agent: DashboardAgent): AgentNode =>
    agentNode(agent, [...(children.get(agent.id) ?? []).map(build).sort((a, b) => -newestFirst(a, b)), ...(waiting.get(agent.id) ?? [])], options.defaultEfforts?.[`${agent.provider}/${agent.model}`]);
  const nodes = roots.map(build);
  const trees = nodes.filter((node) => node.children.length).sort((a, b) => Number(b.kind === "orchestrator") - Number(a.kind === "orchestrator") || newestFirst(a, b));
  return { trees, solo: nodes.filter((node) => !node.children.length).sort(newestFirst) };
}
