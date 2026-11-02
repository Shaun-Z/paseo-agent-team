import { describe, expect, it } from "vitest";
import { ensureWorkspaces, freeWorkspace, planWorkspaces, withFreeWorkspaces, workspaceLabel } from "../shared/apply-plan";
import type { Team } from "../shared/team";

const team: Team = {
  version: 1,
  goal: "",
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [
    { name: "design", provider: "codex", model: "gpt-6.1-sol", folders: [], instructions: "" },
    { name: "sound", provider: "antigravity", model: "gemini-4-argon-high", folders: [], instructions: "" },
  ],
};

describe("workspaceLabel", () => {
  it("prefers the user-set title and falls back to the name", () => {
    expect(workspaceLabel({ id: "w1", name: "main", title: "Design" })).toBe("Design");
    expect(workspaceLabel({ id: "w1", name: "main", title: null })).toBe("main");
  });
});

describe("planWorkspaces", () => {
  it("plans only the orchestrator's workspace, however many roles the team has", () => {
    expect(planWorkspaces(team, [])).toEqual([{ target: "orchestrator", workspace: "orchestrator", existingId: null }]);
  });

  it("reuses an existing workspace matched by trimmed, case-insensitive title", () => {
    const existing = [
      { id: "wks_a", name: "main", title: " design " },
      { id: "wks_b", name: "other", title: " ORCHESTRATOR " },
    ];
    expect(planWorkspaces(team, existing)).toEqual([{ target: "orchestrator", workspace: "orchestrator", existingId: "wks_b" }]);
  });

  it("matches a workspace by its name when it has no title", () => {
    expect(planWorkspaces(team, [{ id: "wks_b", name: "orchestrator", title: null }])[0]?.existingId).toBe("wks_b");
  });

  it("uses the first match when two workspaces share a title", () => {
    const existing = [
      { id: "wks_1", name: "x", title: "orchestrator" },
      { id: "wks_2", name: "y", title: "Orchestrator" },
    ];
    expect(planWorkspaces(team, existing)[0]?.existingId).toBe("wks_1");
  });
});

describe("ensureWorkspaces", () => {
  it("creates a missing workspace", async () => {
    const created: string[] = [];
    const result = await ensureWorkspaces(planWorkspaces(team, []), async (title) => {
      created.push(title);
      return `new_${title}`;
    });
    expect(created).toEqual(["orchestrator"]);
    expect(result).toEqual([{ target: "orchestrator", workspace: "orchestrator", id: "new_orchestrator", created: true }]);
  });

  it("reuses an existing workspace without creating one", async () => {
    const result = await ensureWorkspaces(planWorkspaces(team, [{ id: "wks_o", name: "orchestrator", title: null }]), async () => {
      throw new Error("must not create");
    });
    expect(result).toEqual([{ target: "orchestrator", workspace: "orchestrator", id: "wks_o", created: false }]);
  });
});

describe("freeWorkspace", () => {
  it("keeps a free name and numbers a taken one, ignoring case and spaces", () => {
    expect(freeWorkspace("orchestrator", ["main"])).toBe("orchestrator");
    expect(freeWorkspace("orchestrator", [" Orchestrator ", "orchestrator-2"])).toBe("orchestrator-3");
  });
});

describe("withFreeWorkspaces", () => {
  it("gives a new team's orchestrator a workspace the project doesn't have yet", () => {
    const fresh: Team = { ...team, roles: [] };
    expect(withFreeWorkspaces(fresh, ["orchestrator", "main"], { orchestrator: true }).orchestrator.workspace).toBe("orchestrator-2");
  });

  it("keeps the orchestrator's workspace when it is fixed", () => {
    const draft: Team = { ...team, orchestrator: { ...team.orchestrator, workspace: "main" } };
    expect(withFreeWorkspaces(draft, ["main"], { orchestrator: false })).toEqual(draft);
  });

  it("leaves the roles untouched", () => {
    const result = withFreeWorkspaces(team, ["orchestrator"], { orchestrator: true });
    expect(result.orchestrator.workspace).toBe("orchestrator-2");
    expect(result.roles).toEqual(team.roles);
  });
});
