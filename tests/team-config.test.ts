import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { isTeamConfigFile, parseTeamConfig, serializeTeamConfig } from "../server/team-config";
import { teamFileFor } from "../server/team-directory";
import { teamFixture } from "./fixtures/research";
import { ResearchTeamSchema } from "../shared/research-team";

describe("JSON and YAML team definitions", () => {
  it("ships a complete editable YAML example with existing Role/common prompt paths", async () => {
    const source = await readFile(new URL("../templates/research/team.yaml", import.meta.url), "utf8");
    const team = ResearchTeamSchema.parse(parse(source));
    expect(team.members).toHaveLength(3);
    for (const file of [...team.commonPromptFiles, ...team.roles.flatMap(role => role.promptFiles)]) {
      expect(await readFile(new URL(`../templates/research/${file}`, import.meta.url), "utf8")).not.toBe("");
    }
  });
  it.each(["team.json", "team.yaml", "team.yml"])("reads the same complete configuration from %s", file => {
    const team = teamFixture();
    const source = file.endsWith("json") ? JSON.stringify(team) : `# Research team\n${stringify(team)}`;
    expect(parseTeamConfig(file, source)).toEqual(team);
    expect(isTeamConfigFile(file)).toBe(true);
  });

  it("uses YAML 1.2 strings and keeps explicit false/zero feature settings", () => {
    expect(parseTeamConfig("team.yaml", "model: on\nmode: yes\nfeatures:\n  enabled: false\n  limit: 0\n")).toEqual({ model: "on", mode: "yes", features: { enabled: false, limit: 0 } });
    expect(isTeamConfigFile("team.md")).toBe(false);
  });

  it.each([
    "id: one\nid: two\n",
    "version: [\n",
    "version: 2\n---\nversion: 2\n",
    "feature: .inf\n",
    "feature: !!timestamp 2026-11-16\n",
    "feature: &cycle [*cycle]\n",
  ])("rejects ambiguous, malformed or non-JSON YAML data: %s", source => {
    expect(() => parseTeamConfig("team.yaml", source)).toThrow();
  });

  it("keeps the exact source when reapplying an unchanged YAML definition", () => {
    const team = teamFixture();
    const source = `# Team comment\n${stringify(team)}# Trailing comment\n`;
    expect(serializeTeamConfig("team.yml", team, source)).toBe(source);
  });

  it("retains comments and multiline goals while changing launch settings and member order", () => {
    const team = teamFixture(); team.goal = "Investigate\nValidate\n";
    const source = `# Team comment\n${stringify(team)}`
      .replace("thinkingOptionId: high", "thinkingOptionId: high # reasoning choice")
      .replace("- id: coder-a", "# independent coder\n  - id: coder-a");
    const next = { ...team, members: [team.members[1], team.members[0], team.members[2]].map(member => member.id === "coder-a" ? { ...member, launchSnapshot: { ...member.launchSnapshot, thinkingOptionId: "medium" } } : member) };
    const output = serializeTeamConfig("team.yaml", next, source);
    expect(parse(output)).toEqual(next);
    expect(output).toContain("# Team comment");
    expect(output).toContain("# independent coder");
    expect(output).toContain("thinkingOptionId: medium # reasoning choice");
    expect(output).toContain("goal: |");
  });

  it("does not allow an edited YAML anchor to silently change another member's launch settings", () => {
    const team = teamFixture();
    team.members[2].launchSnapshot = { ...team.members[0].launchSnapshot };
    const source = stringify(team)
      .replace("launchSnapshot:\n      provider: test", "launchSnapshot: &launch\n      provider: test")
      .replace(/(id: coder-b\n\s+roleId: programmer\n\s+)launchSnapshot:[\s\S]*$/, "$1launchSnapshot: *launch\n");
    expect(parse(source)).toEqual(team);
    const next = { ...team, members: team.members.map(member => member.id === "lead" ? { ...member, launchSnapshot: { ...member.launchSnapshot, model: "new-model" } } : member) };
    const output = serializeTeamConfig("team.yaml", next, source);
    expect(parse(output)).toEqual(next);
    expect(parse(output).members[2].launchSnapshot.model).toBe("m");
  });

  it("keeps existing JSON serialization and defaults new files to collision-free YAML paths", () => {
    const team = teamFixture();
    expect(serializeTeamConfig("team.json", team)).toBe(JSON.stringify(team, null, 2) + "\n");
    expect(parse(serializeTeamConfig("team.yaml", team))).toEqual(team);
    expect(teamFileFor(team, [], [])).toBe(".agents/teams/research.yaml");
    expect(teamFileFor(team, [], [".agents/teams/research.yaml"])).toBe(".agents/teams/research-2.yaml");
    expect(teamFileFor(team, [{ file: ".agents/team.json", team }], [])).toBe(".agents/team.json");
  });
});
