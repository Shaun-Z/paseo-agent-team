import { describe, expect, it } from "vitest";
import { findOrchestrator, orchestratorsToArchive, plannerCleanup, type OrchestratorCandidate } from "../shared/cleanup";
import type { Team } from "../shared/team";

const team: Team = {
  version: 1,
  goal: "",
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [{ name: "design", provider: "codex", model: "gpt-6.1-sol", folders: [], instructions: "" }],
};

const workspace = (id: string, title: string) => ({ id, name: id, title });
const agent = (id: string, workspaceId: string, role: string, archivedAt: string | null = null) => ({ id, workspaceId, labels: { "workspace-agents": role }, archivedAt });

describe("plannerCleanup", () => {
  it("archives the project's planners and an emptied Team planner workspace", () => {
    const result = plannerCleanup(
      [workspace("wks_main", "main"), workspace("wks_plan", "Team planner")],
      [agent("a1", "wks_main", "planner"), agent("a2", "wks_plan", "planner"), agent("a3", "wks_main", "orchestrator")],
      team,
    );
    expect(result).toEqual({ agents: ["a1", "a2"], workspaces: ["wks_plan"] });
  });

  it("ignores planners outside the project's workspaces and ones already archived", () => {
    const result = plannerCleanup([workspace("wks_main", "main")], [agent("a1", "wks_other", "planner"), agent("a2", "wks_main", "planner", "2026-10-29T00:00:00Z")], team);
    expect(result).toEqual({ agents: [], workspaces: [] });
  });

  it("keeps a workspace that is not titled Team planner", () => {
    expect(plannerCleanup([workspace("wks_plan", "Team planners")], [agent("a1", "wks_plan", "planner")], team).workspaces).toEqual([]);
  });

  it("keeps a Team planner workspace the team uses", () => {
    const uses = { ...team, orchestrator: { ...team.orchestrator, workspace: "Team planner" } };
    expect(plannerCleanup([workspace("wks_plan", "Team planner")], [agent("a1", "wks_plan", "planner")], uses)).toEqual({ agents: ["a1"], workspaces: [] });
  });

  it("keeps a Team planner workspace that still has other agents", () => {
    const result = plannerCleanup([workspace("wks_plan", "Team planner")], [agent("a1", "wks_plan", "planner"), { id: "a2", workspaceId: "wks_plan", labels: {}, archivedAt: null }], team);
    expect(result).toEqual({ agents: ["a1"], workspaces: [] });
  });

  it("archives an empty Team planner workspace", () => {
    expect(plannerCleanup([workspace("wks_plan", "Team planner")], [], team)).toEqual({ agents: [], workspaces: ["wks_plan"] });
  });
});

describe("findOrchestrator", () => {
  const orchestrator = (over: Partial<OrchestratorCandidate> = {}): OrchestratorCandidate => ({
    id: "o1",
    workspaceId: "wks_lead",
    labels: { "workspace-agents": "orchestrator" },
    archivedAt: null,
    provider: "claude",
    model: "claude-opus-5-5",
    currentModeId: "bypassPermissions",
    ...over,
  });

  it("reuses an orchestrator whose provider, model and mode match", () => {
    expect(findOrchestrator([orchestrator()], "wks_lead", team, "bypassPermissions")?.id).toBe("o1");
  });

  it("returns undefined when only the mode differs", () => {
    expect(findOrchestrator([orchestrator({ currentModeId: "default" })], "wks_lead", team, "bypassPermissions")).toBeUndefined();
  });

  it("ignores the mode when modeId is undefined", () => {
    expect(findOrchestrator([orchestrator({ currentModeId: "default" })], "wks_lead", team, undefined)?.id).toBe("o1");
    expect(findOrchestrator([orchestrator({ currentModeId: null })], "wks_lead", team, undefined)?.id).toBe("o1");
  });

  it("returns undefined when provider or model differ", () => {
    expect(findOrchestrator([orchestrator({ provider: "codex" })], "wks_lead", team, undefined)).toBeUndefined();
    expect(findOrchestrator([orchestrator({ model: "other" })], "wks_lead", team, undefined)).toBeUndefined();
  });

  it("ignores archived, other-workspace and non-orchestrator agents", () => {
    const agents = [
      orchestrator({ id: "archived", archivedAt: "2026-10-29T00:00:00Z" }),
      orchestrator({ id: "elsewhere", workspaceId: "wks_other" }),
      orchestrator({ id: "planner", labels: { "workspace-agents": "planner" } }),
      orchestrator({ id: "unlabeled", labels: {} }),
      orchestrator({ id: "good" }),
    ];
    expect(findOrchestrator(agents, "wks_lead", team, "bypassPermissions")?.id).toBe("good");
    expect(findOrchestrator(agents.slice(0, 4), "wks_lead", team, "bypassPermissions")).toBeUndefined();
  });
});

describe("orchestratorsToArchive", () => {
  it("picks the unarchived orchestrators of the workspace, both when there are two", () => {
    const agents = [agent("a1", "wks_main", "orchestrator"), agent("a2", "wks_main", "orchestrator")];
    expect(orchestratorsToArchive(agents, "wks_main")).toEqual(["a1", "a2"]);
  });

  it("leaves out agents without the label, in another workspace or already archived", () => {
    const agents = [
      { id: "plain", workspaceId: "wks_main", labels: {}, archivedAt: null },
      agent("other", "wks_other", "orchestrator"),
      agent("old", "wks_main", "orchestrator", "2026-10-29T00:00:00Z"),
      agent("a1", "wks_main", "orchestrator"),
    ];
    expect(orchestratorsToArchive(agents, "wks_main")).toEqual(["a1"]);
  });

  it("leaves out planners and role sessions", () => {
    const agents = [agent("p", "wks_main", "planner"), { id: "r", workspaceId: "wks_main", labels: { role: "design" }, archivedAt: null }];
    expect(orchestratorsToArchive(agents, "wks_main")).toEqual([]);
  });
});
