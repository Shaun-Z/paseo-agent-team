import { describe, expect, it } from "vitest";
import { buildAgentForest, type DashboardAgent } from "../shared/agent-tree";
import { applySubagentUpdate, mergeSubagents, subagentAgents, subagentsFromTimeline, type ProviderSubagent } from "../shared/subagents";

const CALL = "toolu_01CKWAz597mosAMtsUgcZT5f";
const T0 = "2026-11-01T14:27:33.409Z";
const T1 = "2026-11-01T14:30:00.000Z";

/** A timeline entry shaped like the daemon's: the sub-agent call is a tool_call item with a sub_agent detail. */
const entry = (over: Record<string, unknown> = {}, detail: Record<string, unknown> = {}) => ({
  provider: "claude",
  item: { type: "tool_call", callId: CALL, name: "Agent", detail: { type: "sub_agent", subAgentType: "general-purpose", description: "Research image consistency APIs", ...detail }, status: "completed", error: null, ...over },
  timestamp: T0,
});

const sub = (over: Partial<ProviderSubagent> = {}): ProviderSubagent => ({ id: "s1", parentAgentId: "a1", parentSubagentId: null, title: "general-purpose", description: "Research", status: "running", createdAt: T0, updatedAt: T0, ...over });
const keyed = (...agents: ProviderSubagent[]) => Object.fromEntries(agents.map((agent) => [`${agent.parentAgentId}:${agent.id}`, agent]));

const parent = (id: string, over: Partial<DashboardAgent> = {}): DashboardAgent => ({ id, workspaceId: "wks_a", provider: "claude", model: "claude-opus-5-5", title: "Lead", status: "running", labels: {}, archivedAt: null, createdAt: "2026-11-01T00:00:00Z", ...over });

describe("subagentsFromTimeline", () => {
  it("maps a sub_agent tool call to a sub-agent of the parent", () => {
    expect(subagentsFromTimeline("a1", [entry()])).toEqual([
      { id: CALL, parentAgentId: "a1", parentSubagentId: null, title: "general-purpose", description: "Research image consistency APIs", status: "completed", createdAt: T0, updatedAt: T0 },
    ]);
  });

  it("ignores junk, non-objects, other tool calls and entries without a call id or timestamp", () => {
    const shell = entry({ name: "Bash", detail: { type: "shell", command: "ls" } });
    const { timestamp: _timestamp, ...undated } = entry();
    expect(subagentsFromTimeline("a1", [null, "text", 7, [], {}, { item: null, timestamp: T0 }, { item: { type: "assistant_message", text: "hi" }, timestamp: T0 }, shell, entry({ callId: 5 }), undated, entry()])).toHaveLength(1);
  });

  it("keeps running, failed and canceled, and turns unknown statuses into completed", () => {
    const statuses = ["running", "failed", "canceled", "weird", undefined].map((status) => subagentsFromTimeline("a1", [entry({ status })])[0]!.status);
    expect(statuses).toEqual(["running", "failed", "canceled", "completed", "completed"]);
  });

  it("leaves title and description null when the detail has no text for them", () => {
    expect(subagentsFromTimeline("a1", [entry({}, { subAgentType: undefined, description: 3 })])[0]).toMatchObject({ title: null, description: null });
  });
});

describe("applySubagentUpdate", () => {
  it("adds a sub-agent on upsert and replaces it on a second upsert", () => {
    const added = applySubagentUpdate({}, { kind: "upsert", subagent: sub() });
    expect(added).toEqual(keyed(sub()));
    const replaced = applySubagentUpdate(added, { kind: "upsert", subagent: sub({ status: "completed", updatedAt: T1 }) });
    expect(replaced).toEqual(keyed(sub({ status: "completed", updatedAt: T1 })));
  });

  it("keeps the same id under different parents apart", () => {
    const next = applySubagentUpdate(keyed(sub()), { kind: "upsert", subagent: sub({ parentAgentId: "a2" }) });
    expect(Object.keys(next)).toEqual(["a1:s1", "a2:s1"]);
  });

  it("removes a sub-agent, and returns the same object when the key is missing", () => {
    const current = keyed(sub());
    expect(applySubagentUpdate(current, { kind: "remove", parentAgentId: "a1", subagentId: "s1" })).toEqual({});
    expect(applySubagentUpdate(current, { kind: "remove", parentAgentId: "a1", subagentId: "nope" })).toBe(current);
  });

  it("sets a known sub-agent to running on a timeline event and bumps updatedAt", () => {
    const current = keyed(sub({ status: "completed" }));
    const next = applySubagentUpdate(current, { kind: "timeline", parentAgentId: "a1", subagentId: "s1", timestamp: T1 });
    expect(next["a1:s1"]).toEqual(sub({ status: "running", updatedAt: T1 }));
  });

  it("adds a minimal running entry for an unknown sub-agent on a timeline event", () => {
    const next = applySubagentUpdate({}, { kind: "timeline", parentAgentId: "a1", subagentId: "s9", timestamp: T1 });
    expect(next["a1:s9"]).toEqual({ id: "s9", parentAgentId: "a1", parentSubagentId: null, title: null, description: null, status: "running", createdAt: T1, updatedAt: T1 });
  });

  it.each([
    ["null", null],
    ["a string", "upsert"],
    ["an unknown kind", { kind: "explode", parentAgentId: "a1", subagentId: "s1" }],
    ["an upsert without a sub-agent", { kind: "upsert" }],
    ["an upsert with a bad status", { kind: "upsert", subagent: sub({ status: "weird" as never }) }],
    ["an upsert without timestamps", { kind: "upsert", subagent: { id: "s1", parentAgentId: "a1", status: "running" } }],
    ["a remove without ids", { kind: "remove" }],
    ["a timeline event without a timestamp", { kind: "timeline", parentAgentId: "a1", subagentId: "s1" }],
  ])("returns the current snapshot unchanged for %s", (_label, payload) => {
    const current = keyed(sub());
    expect(applySubagentUpdate(current, payload)).toBe(current);
  });

  it("never mutates the input record", () => {
    const current = keyed(sub());
    const frozen = structuredClone(current);
    applySubagentUpdate(current, { kind: "upsert", subagent: sub({ id: "s2" }) });
    applySubagentUpdate(current, { kind: "remove", parentAgentId: "a1", subagentId: "s1" });
    applySubagentUpdate(current, { kind: "timeline", parentAgentId: "a1", subagentId: "s1", timestamp: T1 });
    expect(current).toEqual(frozen);
  });
});

describe("mergeSubagents", () => {
  it("lets the live entry beat the bootstrap one for the same parent:id key and keeps the rest", () => {
    const bootstrap = [sub({ status: "completed" }), sub({ id: "s2" })];
    const live = keyed(sub({ status: "running", updatedAt: T1 }));
    expect(mergeSubagents(bootstrap, live)).toEqual([sub({ status: "running", updatedAt: T1 }), sub({ id: "s2" })]);
  });
});

describe("subagentAgents", () => {
  const parents = [parent("a1")];

  it("drops sub-agents whose parent agent isn't given", () => {
    expect(subagentAgents([sub({ parentAgentId: "gone" })], parents)).toEqual([]);
  });

  it("maps a running sub-agent to a dashboard agent of its parent", () => {
    const [mapped] = subagentAgents([sub()], [parent("a1", { model: "m", workspaceId: "wks_x", provider: "codex" })]);
    expect(mapped).toMatchObject({ id: "subagent:a1:s1", parentAgentId: "a1", provider: "codex", model: "m", workspaceId: "wks_x", status: "running", archivedAt: null, labels: {}, createdAt: T0, subagent: true, subagentType: "general-purpose" });
  });

  it("titles by description, then title, then id", () => {
    const titles = subagentAgents([sub({ id: "x" }), sub({ id: "y", description: null }), sub({ id: "z", description: null, title: null })], parents).map((agent) => agent.title);
    expect(titles).toEqual(["Research", "general-purpose", "z"]);
  });

  it("marks finished sub-agents idle and archived at their last update", () => {
    const mapped = subagentAgents(["completed", "failed", "canceled"].map((status, index) => sub({ id: `s${index}`, status: status as ProviderSubagent["status"], updatedAt: T1 })), parents);
    expect(mapped.map((agent) => [agent.status, agent.archivedAt])).toEqual([["idle", T1], ["idle", T1], ["idle", T1]]);
  });

  it("points a nested sub-agent at the mapped id of its parent sub-agent", () => {
    const mapped = subagentAgents([sub(), sub({ id: "s2", parentSubagentId: "s1" })], parents);
    expect(mapped.map((agent) => [agent.id, agent.parentAgentId])).toEqual([["subagent:a1:s1", "a1"], ["subagent:a1:s2", "subagent:a1:s1"]]);
  });
});

describe("buildAgentForest with sub-agents", () => {
  const parents = [parent("a1")];
  const forest = (subagents: ProviderSubagent[], showClosed: boolean) => buildAgentForest([...parents, ...subagentAgents(subagents, parents)], ["wks_a"], { showClosed });

  it("shows a running sub-agent as a child of its parent with kind subagent", () => {
    const { trees } = forest([sub()], false);
    expect(trees).toHaveLength(1);
    expect(trees[0]!.agent.id).toBe("a1");
    expect(trees[0]!.children.map((child) => [child.agent.id, child.kind, child.live])).toEqual([["subagent:a1:s1", "subagent", true]]);
  });

  it("hides a finished sub-agent unless showClosed", () => {
    const finished = [sub({ status: "completed", updatedAt: T1 })];
    const hidden = forest(finished, false);
    expect(hidden.trees).toEqual([]);
    expect(hidden.solo.map((node) => [node.agent.id, node.children])).toEqual([["a1", []]]);
    const shown = forest(finished, true).trees[0]!;
    expect(shown.children.map((child) => [child.agent.id, child.kind])).toEqual([["subagent:a1:s1", "subagent"]]);
  });
});
