import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteTeam } from "../server/team";
import { LABEL, PROPOSAL_FOR, teamAgentsToArchive } from "../shared/cleanup";
import { sameTeamFiles, TEAMS_DIR } from "../shared/team-files";
import { serializeTeam, TEAM_FILE, type Team } from "../shared/team";
import { teamDeleteRpc } from "../shared/rpc";

const agent = (id: string, workspaceId: string, labels: Record<string, string>, archivedAt: string | null = null) => ({ id, workspaceId, labels, archivedAt });

describe("teamAgentsToArchive", () => {
  const agents = [
    agent("orch", "wks_lead", { [LABEL]: "orchestrator" }),
    agent("shared-role", "wks_lead", { role: "qa" }),
    agent("own-role", "wks_design", { role: "design" }),
    agent("archived", "wks_lead", { [LABEL]: "orchestrator" }, "2026-10-31T00:00:00Z"),
    agent("planner", "wks_lead", { [LABEL]: "planner" }),
    agent("unlabelled", "wks_lead", {}),
    agent("other-role", "wks_lead", { role: "sound" }),
    agent("other-team", "wks_other", { [LABEL]: "orchestrator" }),
  ];

  it("archives the team's orchestrators and its roles' labelled sessions in its workspaces only", () => {
    expect(teamAgentsToArchive(agents, ["wks_lead", "wks_design"], ["qa", "design"])).toEqual(["orch", "shared-role", "own-role"]);
  });

  it("matches the role label case-insensitively", () => {
    const labelled = [agent("lower", "wks_lead", { role: "ui" }), agent("upper", "wks_lead", { role: "UI" })];
    expect(teamAgentsToArchive(labelled, ["wks_lead"], ["UI"])).toEqual(["lower", "upper"]);
  });

  it("leaves agents in a workspace left out of the ids passed in", () => {
    const shared = [agent("kept-orch", "wks_kept", { [LABEL]: "orchestrator" }), agent("kept-role", "wks_kept", { role: "qa" }), agent("mine", "wks_lead", { role: "qa" })];
    expect(teamAgentsToArchive(shared, ["wks_lead"], ["qa"])).toEqual(["mine"]);
  });

  it("archives nothing when the team's workspaces are gone", () => {
    expect(teamAgentsToArchive(agents, [], ["qa"])).toEqual([]);
  });

  it("archives unarchived planners proposing for one of the team's workspaces wherever they run, leaving archived and other planners", () => {
    const planners = [
      agent("in-lead", "wks_lead", { [LABEL]: "planner", [PROPOSAL_FOR]: "wks_lead" }),
      agent("elsewhere", "wks_other", { [LABEL]: "planner", [PROPOSAL_FOR]: "wks_design" }),
      agent("archived-planner", "wks_lead", { [LABEL]: "planner", [PROPOSAL_FOR]: "wks_lead" }, "2026-10-31T00:00:00Z"),
      agent("for-other-wks", "wks_lead", { [LABEL]: "planner", [PROPOSAL_FOR]: "wks_other" }),
      agent("for-project", "wks_lead", { [LABEL]: "planner", [PROPOSAL_FOR]: "prj_1" }),
      agent("role-planner", "wks_lead", { [LABEL]: "planner" }),
    ];
    expect(teamAgentsToArchive(planners, ["wks_lead", "wks_design"], [])).toEqual(["in-lead", "elsewhere"]);
  });
});

const team = (workspace: string): Team => ({
  version: 1,
  goal: "",
  orchestrator: { workspace, provider: "claude", model: "m" },
  roles: [{ name: "qa", workspace: "", provider: "claude", model: "m", folders: [], instructions: "" }],
});

describe("sameTeamFiles", () => {
  const files = [
    { file: ".agents/team.json", team: team("orchestrator") },
    { file: ".agents/teams/orchestrator.json", team: team("Orchestrator ") },
    { file: ".agents/teams/side.json", team: team("side") },
  ];

  it("deletes the old single-team file along with a new file for the same orchestrator workspace, and the other way round", () => {
    expect(sameTeamFiles(files, ".agents/teams/orchestrator.json").map((entry) => entry.file)).toEqual([".agents/team.json", ".agents/teams/orchestrator.json"]);
    expect(sameTeamFiles(files, ".agents/team.json").map((entry) => entry.file)).toEqual([".agents/team.json", ".agents/teams/orchestrator.json"]);
  });

  it("leaves other teams' files alone and finds nothing for an unknown file", () => {
    expect(sameTeamFiles(files, ".agents/teams/side.json").map((entry) => entry.file)).toEqual([".agents/teams/side.json"]);
    expect(sameTeamFiles(files, "../outside.json")).toEqual([]);
  });
});

describe("deleteTeam", () => {
  const teamFile = `${TEAMS_DIR}/orchestrator.json`;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "delete-team-"));
    mkdirSync(join(root, TEAMS_DIR), { recursive: true });
    writeFileSync(join(root, TEAM_FILE), serializeTeam(team("orchestrator")), "utf8");
    writeFileSync(join(root, teamFile), serializeTeam(team("orchestrator")), "utf8");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const fakeContext = ({ archiveWorkspace = () => ({}), archiveAgent = async () => ({}) }: { archiveWorkspace?: (id: string) => unknown; archiveAgent?: () => Promise<unknown> } = {}) => ({
    paseo: {
      projects: {
        list: async () => ({ projects: [{ projectId: "prj_1", projectCustomName: null, projectDisplayName: "Demo", projectRootPath: root }] }),
      },
      workspaces: {
        list: async () => ({ entries: [{ id: "wks_lead", projectId: "prj_1", archivingAt: null, name: "wks_lead", title: "orchestrator", workspaceKind: "directory" }] }),
        archive: async (id: string) => archiveWorkspace(id),
      },
      agents: {
        list: async () => ({ entries: [{ agent: agent("orch", "wks_lead", { [LABEL]: "orchestrator" }) }] }),
        ref: () => ({ archive: archiveAgent }),
      },
    } as never,
  });

  it("deletes every file of the team once its agents are archived", async () => {
    const result = await deleteTeam({ projectId: "prj_1", file: teamFile }, fakeContext());
    expect(result).toEqual({ files: [TEAM_FILE, teamFile], archived: 1, failures: [], fileFailures: [] });
    expect(existsSync(join(root, TEAM_FILE))).toBe(false);
    expect(existsSync(join(root, teamFile))).toBe(false);
  });

  it("returns files: [] and keeps every team file when archiving an agent fails", async () => {
    const result = await deleteTeam({ projectId: "prj_1", file: teamFile }, fakeContext({ archiveAgent: async () => { throw new Error("agent is busy"); } }));
    expect(result).toEqual({ files: [], archived: 0, failures: ["agent orch: Error: agent is busy"], fileFailures: [] });
    expect(existsSync(join(root, TEAM_FILE))).toBe(true);
    expect(existsSync(join(root, teamFile))).toBe(true);
  });

  it("never archives workspaces", async () => {
    const archived: string[] = [];
    await deleteTeam({ projectId: "prj_1", file: teamFile }, fakeContext({ archiveWorkspace: (id) => archived.push(id) }));
    expect(archived).toEqual([]);
  });

  it("counts a file already missing at unlink time (ENOENT) as deleted without throwing", async () => {
    const result = await deleteTeam(
      { projectId: "prj_1", file: teamFile },
      fakeContext({ archiveAgent: async () => { unlinkSync(join(root, TEAM_FILE)); return {}; } }),
    );
    expect(result).toEqual({ files: [TEAM_FILE, teamFile], archived: 1, failures: [], fileFailures: [] });
    expect(existsSync(join(root, TEAM_FILE))).toBe(false);
    expect(existsSync(join(root, teamFile))).toBe(false);
  });

  it("records non-ENOENT unlink errors per file and still deletes the remaining files", async () => {
    const result = await deleteTeam(
      { projectId: "prj_1", file: teamFile },
      fakeContext({ archiveAgent: async () => { unlinkSync(join(root, TEAM_FILE)); mkdirSync(join(root, TEAM_FILE)); return {}; } }),
    );
    expect(result).toEqual({
      files: [teamFile],
      archived: 1,
      failures: [],
      fileFailures: [expect.stringMatching(/^file \.agents\/team\.json: /)],
    });
    expect(existsSync(join(root, teamFile))).toBe(false);
  });
});

describe("teamDeleteRpc", () => {
  it("takes a project and one of its team files", () => {
    expect(teamDeleteRpc.name).toBe("team.delete");
    expect(teamDeleteRpc.input.safeParse({ projectId: "prj_1", file: ".agents/teams/orchestrator.json" }).success).toBe(true);
    expect(teamDeleteRpc.input.safeParse({ projectId: "prj_1" }).success).toBe(false);
    expect(teamDeleteRpc.output.safeParse({ files: [".agents/team.json"], archived: 2, failures: [], fileFailures: [] }).success).toBe(true);
  });
});
