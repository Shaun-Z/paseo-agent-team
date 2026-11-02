import { describe, expect, it } from "vitest";
import { serializeTeam, type Team } from "../shared/team";
import { legacyWorkspacesOf, teamFileFor, teamFileWorkspaces, teamIn, workspaceClashes, workspaceOwnerOf, workspacesOfOtherTeams, type TeamFile } from "../shared/team-files";

const team = (workspace: string, roles: { name: string }[]): Team => ({
  version: 1,
  goal: "",
  orchestrator: { workspace, provider: "claude", model: "claude-opus-5-5" },
  roles: roles.map((role) => ({ ...role, provider: "claude", model: "claude-sonnet-5-5", folders: [], instructions: "" })),
});

const files: TeamFile[] = [
  { file: ".agents/team.json", team: team("orchestrator", [{ name: "design" }, { name: "tests" }]) },
  { file: ".agents/teams/feature-x.json", team: team("Feature X", [{ name: "core" }, { name: "docs" }]) },
];

describe("teamIn", () => {
  it("finds the team whose orchestrator runs in the workspace, ignoring case and spaces", () => {
    expect(teamIn(files, "orchestrator")?.file).toBe(".agents/team.json");
    expect(teamIn(files, " feature x ")?.file).toBe(".agents/teams/feature-x.json");
  });

  it("finds none for an unknown workspace", () => {
    expect(teamIn(files, "main")).toBeUndefined();
  });
});

describe("workspacesOfOtherTeams", () => {
  it("lists the orchestrator workspace of every other team", () => {
    expect(workspacesOfOtherTeams(files, "orchestrator")).toEqual(["Feature X"]);
    expect(workspacesOfOtherTeams(files, "FEATURE X")).toEqual(["orchestrator"]);
  });

  it("lists every team's workspace for a workspace without a team", () => {
    expect(workspacesOfOtherTeams(files, "main")).toEqual(["orchestrator", "Feature X"]);
  });
});

describe("workspaceClashes", () => {
  const taken = ["orchestrator", "design"];

  it("accepts a team that uses none of the taken workspaces", () => {
    expect(workspaceClashes(team("main", [{ name: "a" }, { name: "b" }]), taken)).toEqual([]);
  });

  it("rejects an orchestrator workspace another team uses", () => {
    expect(workspaceClashes(team("Orchestrator", [{ name: "a" }]), taken)).toEqual([
      { target: "orchestrator", message: 'workspace "Orchestrator" belongs to another team' },
    ]);
  });

  it("ignores role names that match a taken workspace", () => {
    expect(workspaceClashes(team("main", [{ name: "design" }]), taken)).toEqual([]);
  });
});

describe("teamFileFor", () => {
  const names = files.map((entry) => entry.file);

  it("keeps a team in the file it already lives in, including the single-team file", () => {
    expect(teamFileFor(team("orchestrator", [{ name: "x" }]), files, names)).toBe(".agents/team.json");
    expect(teamFileFor(team("feature x", [{ name: "x" }]), files, names)).toBe(".agents/teams/feature-x.json");
  });

  it("names a new team's file after its orchestrator's workspace", () => {
    expect(teamFileFor(team("Bug fixes / v2", [{ name: "x" }]), files, names)).toBe(".agents/teams/bug-fixes-v2.json");
    expect(teamFileFor(team("버그 수정", [{ name: "x" }]), files, names)).toBe(".agents/teams/버그-수정.json");
  });

  it("does not reuse a name another file already has", () => {
    expect(teamFileFor(team("feature-x", [{ name: "x" }]), files, names)).toBe(".agents/teams/feature-x-2.json");
    expect(teamFileFor(team("feature-x", [{ name: "x" }]), files, [...names, ".agents/teams/feature-x-2.json"])).toBe(".agents/teams/feature-x-3.json");
  });

  it("falls back to a generic name when the title has no letters or digits", () => {
    expect(teamFileFor(team("***", [{ name: "x" }]), [], [])).toBe(".agents/teams/team.json");
  });
});

describe("legacyWorkspacesOf", () => {
  const raw = (...roles: unknown[]) => ({ roles });

  it("collects the trimmed role workspaces of a legacy team file, deduped case-insensitively", () => {
    expect(legacyWorkspacesOf(raw({ name: "a", workspace: " Design " }, { name: "b", workspace: "design" }, { name: "c", workspace: "sound" }))).toEqual(["design", "sound"]);
  });

  it("skips empty, blank and malformed values", () => {
    expect(legacyWorkspacesOf(raw({ workspace: "" }, { workspace: "   " }, { workspace: 3 }, { workspace: null }, { workspace: ["x"] }, { name: "no-workspace" }, null, "text", 7))).toEqual([]);
  });

  it("is empty when roles are missing or not a list, or the value is not an object", () => {
    expect(legacyWorkspacesOf({})).toEqual([]);
    expect(legacyWorkspacesOf({ roles: "x" })).toEqual([]);
    expect(legacyWorkspacesOf(null)).toEqual([]);
    expect(legacyWorkspacesOf("x")).toEqual([]);
  });

  it("finds nothing in a file written by Apply, so nothing stays reserved", () => {
    const written = team("orchestrator", [{ name: "design" }]);
    expect(legacyWorkspacesOf(JSON.parse(serializeTeam(written)))).toEqual([]);
  });
});

describe("legacy role workspaces", () => {
  const legacy: TeamFile[] = [
    { file: ".agents/teams/old.json", team: team("Old lead", [{ name: "design" }]), legacyWorkspaces: ["design", "Sound"] },
    { file: ".agents/teams/new.json", team: team("New lead", [{ name: "qa" }]) },
  ];

  it("reserves them next to the orchestrator workspace", () => {
    expect(teamFileWorkspaces(legacy[0]!)).toEqual(["Old lead", "design", "Sound"]);
    expect(teamFileWorkspaces(legacy[1]!)).toEqual(["New lead"]);
  });

  it("lists them as taken for other teams, so they can't take them as an orchestrator workspace", () => {
    const taken = workspacesOfOtherTeams(legacy, "New lead");
    expect(taken).toEqual(["Old lead", "design", "Sound"]);
    expect(workspaceClashes(team(" Design ", [{ name: "x" }]), taken)).toEqual([{ target: "orchestrator", message: 'workspace " Design " belongs to another team' }]);
  });

  it("does not list a team's own legacy workspaces as taken for itself", () => {
    expect(workspacesOfOtherTeams(legacy, "old lead")).toEqual(["New lead"]);
  });

  it("finds the owning team for a legacy workspace, ignoring case and spaces", () => {
    expect(workspaceOwnerOf(legacy, " DESIGN ")?.file).toBe(".agents/teams/old.json");
    expect(workspaceOwnerOf(legacy, "sound")?.file).toBe(".agents/teams/old.json");
    expect(workspaceOwnerOf(legacy, "new lead")?.file).toBe(".agents/teams/new.json");
    expect(workspaceOwnerOf(legacy, "main")).toBeUndefined();
  });

  it("prefers the team whose orchestrator runs in the workspace", () => {
    const both: TeamFile[] = [{ file: "a.json", team: team("A", [{ name: "x" }]), legacyWorkspaces: ["B"] }, { file: "b.json", team: team("B", [{ name: "y" }]) }];
    expect(workspaceOwnerOf(both, "B")?.file).toBe("b.json");
  });

  it("reserves nothing once the file is rewritten without them", () => {
    const rewritten: TeamFile = { file: ".agents/teams/old.json", team: legacy[0]!.team, legacyWorkspaces: legacyWorkspacesOf(JSON.parse(serializeTeam(legacy[0]!.team))) };
    expect(teamFileWorkspaces(rewritten)).toEqual(["Old lead"]);
    expect(workspaceOwnerOf([rewritten], "design")).toBeUndefined();
    expect(workspaceClashes(team("design", [{ name: "x" }]), workspacesOfOtherTeams([rewritten, legacy[1]!], "New lead")).length).toBe(0);
  });
});
