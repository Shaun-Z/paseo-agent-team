import type { DashboardAgent } from "./agent-tree";

export type ProviderSubagent = {
  id: string;
  parentAgentId: string;
  parentSubagentId: string | null;
  title: string | null;
  description: string | null;
  status: "running" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
};

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableText = (value: unknown): string | null => typeof value === "string" ? value : null;
const statusOf = (value: unknown): ProviderSubagent["status"] => value === "running" || value === "failed" || value === "canceled" ? value : "completed";
const keyOf = (agent: ProviderSubagent) => `${agent.parentAgentId}:${agent.id}`;
const dashboardId = (parentAgentId: string, id: string) => `subagent:${parentAgentId}:${id}`;

/** Tool-call history is a fallback until live sub-agent updates arrive. */
export function subagentsFromTimeline(parentAgentId: string, entries: readonly unknown[]): ProviderSubagent[] {
  return entries.flatMap((entry) => {
    const value = record(entry);
    const item = record(value?.item);
    const detail = record(item?.detail);
    if (item?.type !== "tool_call" || detail?.type !== "sub_agent" || typeof item.callId !== "string" || typeof value?.timestamp !== "string") return [];
    return [{ id: item.callId, parentAgentId, parentSubagentId: null, title: nullableText(detail.subAgentType), description: nullableText(detail.description), status: statusOf(item.status), createdAt: value.timestamp, updatedAt: value.timestamp }];
  });
}

/** Applies a provider sub-agent event without mutating the previous snapshot. */
export function applySubagentUpdate(current: Record<string, ProviderSubagent>, payload: unknown): Record<string, ProviderSubagent> {
  const value = record(payload);
  if (value?.kind === "upsert") {
    const agent = record(value.subagent);
    if (!agent || typeof agent.id !== "string" || typeof agent.parentAgentId !== "string" || typeof agent.createdAt !== "string" || typeof agent.updatedAt !== "string" || !["running", "completed", "failed", "canceled"].includes(String(agent.status))) return current;
    const next: ProviderSubagent = { id: agent.id, parentAgentId: agent.parentAgentId, parentSubagentId: nullableText(agent.parentSubagentId), title: nullableText(agent.title), description: nullableText(agent.description), status: statusOf(agent.status), createdAt: agent.createdAt, updatedAt: agent.updatedAt };
    return { ...current, [keyOf(next)]: next };
  }
  if (typeof value?.parentAgentId !== "string" || typeof value.subagentId !== "string") return current;
  const key = `${value.parentAgentId}:${value.subagentId}`;
  if (value.kind === "remove") {
    if (!Object.hasOwn(current, key)) return current;
    const next = { ...current };
    delete next[key];
    return next;
  }
  if (value.kind === "timeline" && typeof value.timestamp === "string") {
    const previous = current[key];
    const agent: ProviderSubagent = previous ?? { id: value.subagentId, parentAgentId: value.parentAgentId, parentSubagentId: null, title: null, description: null, status: "running", createdAt: value.timestamp, updatedAt: value.timestamp };
    return { ...current, [key]: { ...agent, status: "running", updatedAt: value.timestamp } };
  }
  return current;
}

/** Live status takes precedence over the tool-call fallback. */
export function mergeSubagents(bootstrap: ProviderSubagent[], live: Record<string, ProviderSubagent>): ProviderSubagent[] {
  return Object.values({ ...Object.fromEntries(bootstrap.map((agent) => [keyOf(agent), agent])), ...live });
}

/** Adapts provider sessions to dashboard children of their Paseo agent. */
export function subagentAgents(subagents: readonly ProviderSubagent[], parents: readonly DashboardAgent[]): DashboardAgent[] {
  const byId = new Map(parents.map((agent) => [agent.id, agent]));
  return subagents.flatMap((agent): DashboardAgent[] => {
    const parent = byId.get(agent.parentAgentId);
    if (!parent) return [];
    return [{ id: dashboardId(agent.parentAgentId, agent.id), parentAgentId: agent.parentSubagentId ? dashboardId(agent.parentAgentId, agent.parentSubagentId) : agent.parentAgentId, provider: parent.provider, model: parent.model, workspaceId: parent.workspaceId, title: agent.description ?? agent.title ?? agent.id, status: agent.status === "running" ? "running" : "idle", archivedAt: agent.status === "running" ? null : agent.updatedAt, labels: {}, createdAt: agent.createdAt, subagent: true, subagentType: agent.title }];
  });
}
