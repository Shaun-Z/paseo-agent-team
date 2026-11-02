import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reconnectTeam } from "../server/team";
import { teamReconnectRpc } from "../shared/rpc";
import { parseTeam, serializeTeam, TEAM_FILE, type Team } from "../shared/team";
import { TEAMS_DIR } from "../shared/team-files";

const team = (workspace: string): Team => ({
  version: 1,
  goal: "Ship it",
  orchestrator: { workspace, provider: "claude", model: "m" },
  roles: [{ name: "qa", provider: "codex", model: "n", folders: ["tests"], instructions: "Test it." }],
});

const workspace = (id: string, title: string, archivingAt: string | null = null, projectId = "prj_1") => ({ id, projectId, archivingAt, name: id, title, workspaceKind: "directory" });

describe("reconnectTeam", () => {
  const teamFile = `${TEAMS_DIR}/orchestrator.json`;
  const otherFile = `${TEAMS_DIR}/side.json`;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "reconnect-team-"));
    mkdirSync(join(root, TEAMS_DIR), { recursive: true });
    writeFileSync(join(root, TEAM_FILE), serializeTeam(team("orchestrator")), "utf8");
    writeFileSync(join(root, teamFile), serializeTeam(team("orchestrator")), "utf8");
    writeFileSync(join(root, otherFile), serializeTeam(team("side")), "utf8");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const context = () => ({
    paseo: {
      projects: {
        list: async () => ({ projects: [{ projectId: "prj_1", projectCustomName: null, projectDisplayName: "Demo", projectRootPath: root }] }),
      },
      workspaces: {
        list: async () => ({
          entries: [
            workspace("wks_renamed", "Lead"),
            workspace("wks_going", "Going", "2026-10-31T00:00:00Z"),
            workspace("wks_foreign", "Foreign", null, "prj_2"),
            workspace("wks_side", "Side"),
          ],
        }),
      },
    } as never,
  });
  const unchanged = () => {
    const before = [TEAM_FILE, teamFile, otherFile].map(read);
    return () => expect([TEAM_FILE, teamFile, otherFile].map(read)).toEqual(before);
  };

  it("points the file and an old team.json for the same orchestrator workspace at the new title, changing nothing else", async () => {
    const result = await reconnectTeam({ projectId: "prj_1", file: teamFile, workspaceId: "wks_renamed" }, context());
    expect(result).toEqual({ ok: true, files: [TEAM_FILE, teamFile] });
    expect(parseTeam(read(teamFile))).toEqual({ ok: true, team: team("Lead") });
    expect(parseTeam(read(TEAM_FILE))).toEqual({ ok: true, team: team("Lead") });
    expect(read(otherFile)).toBe(serializeTeam(team("side")));
  });

  it("throws for a file that is not one of the project's team files", async () => {
    await expect(reconnectTeam({ projectId: "prj_1", file: "../outside.json", workspaceId: "wks_renamed" }, context())).rejects.toThrow("is not a team file");
  });

  it.each([
    ["unknown id", "wks_missing"],
    ["archiving workspace", "wks_going"],
    ["workspace of another project", "wks_foreign"],
  ])("returns ok: false and keeps the files for an %s", async (_label, workspaceId) => {
    const check = unchanged();
    const result = await reconnectTeam({ projectId: "prj_1", file: teamFile, workspaceId }, context());
    expect(result).toEqual({ ok: false, errors: [expect.stringContaining(`Workspace ${workspaceId} was not found`)] });
    check();
  });

  it("returns ok: false and keeps the files when another team uses the title", async () => {
    const check = unchanged();
    const result = await reconnectTeam({ projectId: "prj_1", file: teamFile, workspaceId: "wks_side" }, context());
    expect(result).toEqual({ ok: false, errors: [expect.stringContaining("belongs to another team")] });
    check();
  });
});

describe("teamReconnectRpc", () => {
  it("takes a project, a team file and a workspace, and answers ok with files or not ok with errors", () => {
    expect(teamReconnectRpc.name).toBe("team.reconnect");
    expect(teamReconnectRpc.input.safeParse({ projectId: "prj_1", file: ".agents/teams/a.json", workspaceId: "wks_1" }).success).toBe(true);
    expect(teamReconnectRpc.input.safeParse({ projectId: "prj_1", file: ".agents/teams/a.json" }).success).toBe(false);
    expect(teamReconnectRpc.output.safeParse({ ok: true, files: [".agents/teams/a.json"] }).success).toBe(true);
    expect(teamReconnectRpc.output.safeParse({ ok: false, errors: ["x"] }).success).toBe(true);
  });
});
