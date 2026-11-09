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
/** "question" waits on the user's answer to a permission prompt; "attention" stopped on an error. */
export type AgentBadge = "question" | "attention" | "running" | "done" | null;

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

/** Closed and archived Paseo agents are hidden; a sub-agent's archive timestamp only means finished. */
export function isHidden(agent: DashboardAgent): boolean {
  return agent.status === "closed" || (!agent.subagent && !!agent.archivedAt);
}

/** Only finished, inactive sessions that need nothing from the user can be dismissed from this dashboard tab. */
export function canDismiss(node: AgentNode): boolean {
  return !node.waiting && !node.live && !node.delegating && node.badge !== "attention" && node.badge !== "question" &&
    (isHidden(node.agent) || (node.agent.subagent === true && node.agent.status !== "running"));
}

/** A Paseo agent that stopped on an error and is not archived yet can be archived; permission prompts and provider sub-agents cannot. */
export function canArchive(node: AgentNode): boolean {
  const { agent } = node;
  return !agent.subagent && !agent.archivedAt && !node.waiting && !node.live && !node.delegating &&
    (agent.status === "error" || (agent.requiresAttention === true && agent.attentionReason === "error"));
}

/** Like the card badge, agents waiting on a permission prompt or stopped on an error await the user even while running; other running agents are working. */
export function agentActivity(agent: DashboardAgent): "working" | "awaiting" | "idle" {
  if (agent.status === "error" || (agent.requiresAttention && (agent.attentionReason === "permission" || agent.attentionReason === "error"))) return "awaiting";
  if (agent.status === "running") return "working";
  return "idle";
}

/** Activity totals of Paseo agents that are not archived; provider sub-agents are not counted. */
export function activityCounts(agents: readonly DashboardAgent[]): { working: number; awaiting: number; idle: number } {
  const counts = { working: 0, awaiting: 0, idle: 0 };
  for (const agent of agents) {
    if (!agent.archivedAt && !agent.subagent) counts[agentActivity(agent)]++;
  }
  return counts;
}

export type ActivityFilter = "all" | "working" | "awaiting" | "idle";

/** The activities of a tree's root and all its descendants; waiting roster nodes are not agents and are skipped. */
export function treeActivities(node: AgentNode): Set<"working" | "awaiting" | "idle"> {
  const result = new Set<"working" | "awaiting" | "idle">();
  const visit = (current: AgentNode) => {
    if (!current.waiting) result.add(agentActivity(current.agent));
    current.children.forEach(visit);
  };
  visit(node);
  return result;
}

/** Whole trees and solo roots with at least one agent of the filtered activity; "all" keeps the forest as is. */
export function filterForest(forest: AgentForest, filter: ActivityFilter): AgentForest {
  if (filter === "all") return forest;
  const keep = (node: AgentNode) => treeActivities(node).has(filter);
  return { trees: forest.trees.filter(keep), solo: forest.solo.filter(keep) };
}

/** Root counts across forests: all roots, and per activity the roots whose tree contains it (a tree can count in several). */
export function forestActivityCounts(forests: readonly AgentForest[]): { all: number; working: number; awaiting: number; idle: number } {
  const counts = { all: 0, working: 0, awaiting: 0, idle: 0 };
  for (const forest of forests) {
    for (const node of [...forest.trees, ...forest.solo]) {
      counts.all++;
      for (const activity of treeActivities(node)) counts[activity]++;
    }
  }
  return counts;
}

/** Dismissible sessions in depth-first tree order, followed by solo trees, without duplicate ids. */
export function dismissibleIds(forest: AgentForest): string[] {
  const ids = new Set<string>();
  const visit = (node: AgentNode) => {
    if (canDismiss(node)) ids.add(node.agent.id);
    node.children.forEach(visit);
  };
  forest.trees.forEach(visit);
  forest.solo.forEach(visit);
  return [...ids];
}

function kindOf(agent: DashboardAgent): AgentKind {
  if (agent.subagent) return "subagent";
  const job = agent.labels[LABEL];
  if (job === "orchestrator" || job === "planner") return job;
  return agent.labels.role ? "role" : "agent";
}

function badgeOf(agent: DashboardAgent): AgentBadge {
  if (agent.requiresAttention && agent.attentionReason === "permission") return "question";
  if (agent.requiresAttention && agent.attentionReason === "error") return "attention";
  if (agent.status === "error") return "attention";
  if (agent.status === "running") return "running";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "done";
  return null;
}

/** Separates the generated uppercase hex suffix from the name for display only. */
export function formatAgentTitle(title: string): string {
  return title.trim().replace(/(\S)\s*(#[0-9A-F]{4})$/, "$1 $2");
}

/** Splits a formatted title so its generated id can be styled separately. */
export function titleParts(title: string): { name: string; id: string | null } {
  const match = /^(.*\S) (#[0-9A-F]{4})$/.exec(title);
  return match ? { name: match[1]!, id: match[2]! } : { name: title, id: null };
}

/** `defaultEffort` is the model's default thinking option, shown when the agent sets none. */
export function agentNode(agent: DashboardAgent, children: AgentNode[] = [], defaultEffort?: string): AgentNode {
  const live = agent.status === "running";
  const effort = agent.effectiveThinkingOptionId ?? agent.thinkingOptionId ?? null;
  return {
    agent,
    kind: kindOf(agent),
    role: agent.labels.role ?? null,
    title: formatAgentTitle(agent.title ?? "") || agent.id.slice(0, 7),
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
 * The agents in the given workspaces as parent → child trees, with waiting roles after an orchestrator's children.
 * Role adoption happens before filtering. Without showClosed, unclosed/unarchived roots with no parent are shown;
 * children keep active branches and the newest idle session per sibling type. Promoted orphans compete by original parent.
 * Branches dropped by this filtering never become roots.
 * Dismissed sessions and their descendants are excluded first in both modes; waiting nodes are unaffected.
 * With showClosed, all remaining sessions are shown, promoting missing parents and parent cycles to roots as before.
 */
export function buildAgentForest(agents: readonly DashboardAgent[], workspaceIds: readonly string[], options: { showClosed: boolean; defaultEfforts?: Record<string, string>; roster?: readonly RosterTeam[]; dismissed?: readonly string[] }): AgentForest {
  const workspaces = new Set(workspaceIds);
  const dismissed = new Set(options.dismissed);
  if (dismissed.size) {
    const descendants = new Map<string, string[]>();
    for (const agent of agents) {
      const parent = parentOf(agent);
      if (parent !== undefined) descendants.set(parent, [...(descendants.get(parent) ?? []), agent.id]);
    }
    const pending = [...dismissed];
    for (let index = 0; index < pending.length; index++) {
      for (const id of descendants.get(pending[index]!) ?? []) {
        if (dismissed.has(id)) continue;
        dismissed.add(id);
        pending.push(id);
      }
    }
  }
  const scope = agents.filter((agent) => !dismissed.has(agent.id) && workspaces.has(agent.workspaceId ?? "") && (options.showClosed || !isHidden(agent)));
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
  const active = (node: AgentNode) => node.live || node.badge === "attention" || node.badge === "question";
  const typeOf = (node: AgentNode) => node.role ?? (node.agent.subagent ? node.agent.subagentType : null) ?? node.kind;
  const activeBranches = new Set<string>();
  const build = (agent: DashboardAgent): AgentNode => {
    let kids = (children.get(agent.id) ?? []).map(build).sort((a, b) => -newestFirst(a, b));
    if (!options.showClosed) {
      const newest = new Map<string, AgentNode>();
      for (const kid of kids) {
        if (!active(kid)) newest.set(typeOf(kid), kid);
      }
      kids = kids.filter((kid) => activeBranches.has(kid.agent.id) || newest.get(typeOf(kid)) === kid);
    }
    const node = agentNode(agent, [...kids, ...(waiting.get(agent.id) ?? [])], options.defaultEfforts?.[`${agent.provider}/${agent.model}`]);
    if (active(node) || kids.some((kid) => activeBranches.has(kid.agent.id))) activeBranches.add(agent.id);
    return node;
  };
  let nodes = roots.map(build);
  if (!options.showClosed) {
    const newest = new Map<string | undefined, Map<string, AgentNode>>();
    for (const node of nodes) {
      const parent = parentOf(node.agent);
      if ((parent === undefined && !node.agent.subagent) || active(node)) continue;
      const group = newest.get(parent) ?? new Map<string, AgentNode>();
      const previous = group.get(typeOf(node));
      if (!previous || newestFirst(node, previous) <= 0) group.set(typeOf(node), node);
      newest.set(parent, group);
    }
    nodes = nodes.filter((node) =>
      (parentOf(node.agent) === undefined && !node.agent.subagent) ||
      activeBranches.has(node.agent.id) ||
      newest.get(parentOf(node.agent))?.get(typeOf(node)) === node);
  }
  const trees = nodes.filter((node) => node.children.length).sort((a, b) => Number(b.kind === "orchestrator") - Number(a.kind === "orchestrator") || newestFirst(a, b));
  return { trees, solo: nodes.filter((node) => !node.children.length).sort(newestFirst) };
}
