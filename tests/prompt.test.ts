import { describe, expect, it } from "vitest";
import { orchestratorPrompt, teamChangedMessage } from "../shared/prompt";
import type { Team } from "../shared/team";

const team: Team = {
  version: 1,
  goal: "2D platformer game",
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [
    { name: "design", workspace: "design", provider: "codex", model: "gpt-6.1-sol", folders: ["src/ui", "assets/images"], instructions: "Owns UI and art." },
    { name: "sound", workspace: "sound", provider: "antigravity", model: "gemini-4-argon-high", folders: [], instructions: "" },
  ],
};

const modes = { design: "full-access", sound: undefined };

const sharedTeam: Team = { ...team, roles: [team.roles[0]!, { name: "tests", workspace: "", provider: "claude", model: "claude-sonnet-5-5", folders: ["tests"], instructions: "" }, { name: "docs", workspace: "  ", provider: "claude", model: "claude-haiku-5-5", folders: [], instructions: "" }] };
const sharedModes = { design: "full-access", tests: "auto", docs: undefined };

describe("orchestratorPrompt", () => {
  const prompt = orchestratorPrompt(team, modes, ".agents/teams/orchestrator.json");

  it("states the goal and the team's own file", () => {
    expect(prompt).toContain("2D platformer game");
    expect(prompt).toContain("The team is defined in .agents/teams/orchestrator.json at the project root.");
  });

  it("tells it to ignore the other teams of the project", () => {
    expect(prompt).toMatch(/other teams/i);
  });

  it("lists every role with its workspace, provider/model, mode and folders", () => {
    expect(prompt).toContain("| Role | Workspace | Provider/model | Mode | Folders |");
    expect(prompt).toContain("| design | design | codex/gpt-6.1-sol | full-access | src/ui, assets/images |");
    expect(prompt).toContain("| sound | sound | antigravity/gemini-4-argon-high | default | (any) |");
    expect(prompt).toContain("- design: Owns UI and art.");
  });

  it("tells it how to delegate with the role's own provider and model", () => {
    expect(prompt).toContain("paseo run --workspace <workspace-id> --provider <provider>/<model>");
    expect(prompt).toContain("--mode <mode>");
    expect(prompt).toMatch(/omit `--mode` when the Mode is `default`/i);
    expect(prompt).not.toContain("Add `--mode auto` when the provider offers");
    expect(prompt).toMatch(/already has an agent.*send/s);
    expect(prompt).toMatch(/wait/);
  });

  it("forbids swapping the role's mode or provider when a start is denied", () => {
    expect(prompt).toMatch(/never substitute another mode or provider/i);
    expect(prompt).toMatch(/denied.*tell the user/is);
  });

  it("marks roles without a workspace as sharing the orchestrator's", () => {
    const shared = orchestratorPrompt(sharedTeam, sharedModes, ".agents/team.json");
    expect(shared).toContain("| tests | orchestrator (shared) | claude/claude-sonnet-5-5 | auto | tests |");
    expect(shared).toContain("| docs | orchestrator (shared) | claude/claude-haiku-5-5 | default | (any) |");
    expect(shared).toContain("| design | design | codex/gpt-6.1-sol | full-access | src/ui, assets/images |");
  });

  it("does not mark roles with their own workspace as shared", () => {
    expect(prompt).not.toMatch(/\| (design|sound) \| [^|]*\(shared\)/);
  });

  it("tells it how to run a shared role in its own workspace", () => {
    expect(prompt).toContain("(shared)");
    expect(prompt).toContain("role=<role>");
    expect(prompt).toContain("--workspace <orchestrator-workspace-id>");
    expect(prompt).toMatch(/unarchived agent.*send/s);
  });

  it("titles started agents <role>#<id> and still labels them with the role", () => {
    expect(prompt).toContain("--title <role>#<id>");
    expect(prompt).toContain("role=<role>");
  });

  it("omits the role notes section when no role has instructions", () => {
    const bare = orchestratorPrompt({ ...team, roles: [team.roles[1]!] }, modes, ".agents/team.json");
    expect(bare).not.toContain("Role notes");
  });
});

describe("teamChangedMessage", () => {
  it("starts with the re-read sentence", () => {
    const message = teamChangedMessage(team, modes, ".agents/team.json");
    expect(message.startsWith("The team in .agents/team.json changed. Re-read it and use it from now on.")).toBe(true);
  });

  it("contains the team table with the Mode column", () => {
    const message = teamChangedMessage(team, modes, ".agents/team.json");
    expect(message).toContain("| Role | Workspace | Provider/model | Mode | Folders |");
    expect(message).toContain("| design | design | codex/gpt-6.1-sol | full-access | src/ui, assets/images |");
    expect(message).toContain("| sound | sound | antigravity/gemini-4-argon-high | default | (any) |");
  });

  it("marks shared roles in the table", () => {
    const message = teamChangedMessage(sharedTeam, sharedModes, ".agents/team.json");
    expect(message).toContain("| tests | orchestrator (shared) | claude/claude-sonnet-5-5 | auto | tests |");
    expect(message).toContain("| docs | orchestrator (shared) | claude/claude-haiku-5-5 | default | (any) |");
    expect(message).toContain("| design | design | codex/gpt-6.1-sol | full-access | src/ui, assets/images |");
  });

  it("repeats the --mode rule", () => {
    const message = teamChangedMessage(team, modes, ".agents/team.json");
    expect(message).toContain("--mode");
    expect(message).toContain("`default`");
    expect(message).toMatch(/never substitute another mode or provider/i);
  });
});
