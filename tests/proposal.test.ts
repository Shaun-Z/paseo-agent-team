import { describe, expect, it } from "vitest";
import { extractProposal, plannerPrompt, ROLE_JSON_SCHEMA, TEAM_JSON_SCHEMA } from "../shared/proposal";
import type { ProviderInfo } from "../shared/validate";

const catalog: ProviderInfo[] = [
  { id: "claude", ready: true, status: "ready", models: [{ id: "claude-opus-5-5", label: "Opus 5.5" }] },
  { id: "codex", ready: true, status: "ready", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }] },
  { id: "copilot", ready: false, status: "unavailable", models: [{ id: "x", label: "x" }] },
];

const proposal = {
  version: 1,
  goal: "2D platformer game",
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [{ name: "design", provider: "codex", model: "gpt-6.1-sol", folders: ["src/ui"], instructions: "UI" }],
};

describe("plannerPrompt", () => {
  const prompt = plannerPrompt("2D platformer game", catalog);

  it("includes the goal and only ready providers with their model ids", () => {
    expect(prompt).toContain("2D platformer game");
    expect(prompt).toContain("- claude: claude-opus-5-5");
    expect(prompt).toContain("- codex: gpt-6.1-sol");
    expect(prompt).not.toContain("copilot");
  });

  it("shows the exact JSON shape with every key the team file needs", () => {
    const start = prompt.indexOf("{");
    const example = JSON.parse(prompt.slice(start, prompt.lastIndexOf("}") + 1));
    expect(Object.keys(example)).toEqual(["version", "goal", "orchestrator", "roles"]);
    expect(Object.keys(example.orchestrator)).toEqual(["workspace", "provider", "model"]);
    expect(Object.keys(example.roles[0])).toEqual(["name", "provider", "model", "folders", "instructions"]);
  });

  it("forbids changing files", () => {
    expect(prompt).toMatch(/do not (create|change|edit)/i);
  });

  it("shows roles without a workspace in the example", () => {
    const example = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1));
    expect(example.roles[0]).not.toHaveProperty("workspace");
  });

  it("says every role runs in the orchestrator's workspace and offers no role workspace", () => {
    expect(prompt).toMatch(/orchestrator's workspace/);
    expect(prompt).not.toMatch(/empty string/);
    expect(prompt).not.toMatch(/own short lowercase workspace/);
    expect(prompt).not.toMatch(/its own Paseo workspace/);
  });
});

describe("TEAM_JSON_SCHEMA", () => {
  it("requires the fields the team file needs", () => {
    expect(TEAM_JSON_SCHEMA.required).toEqual(["version", "goal", "orchestrator", "roles"]);
  });

  it("has no workspace property on a role", () => {
    const role = TEAM_JSON_SCHEMA.properties.roles.items;
    expect(role.required).not.toContain("workspace");
    expect(role.properties).not.toHaveProperty("workspace");
    expect(ROLE_JSON_SCHEMA.properties).not.toHaveProperty("workspace");
  });

  it("still requires the orchestrator's workspace to be non-empty", () => {
    expect(TEAM_JSON_SCHEMA.properties.orchestrator.properties.workspace).toEqual({ type: "string", minLength: 1 });
  });
});

describe("extractProposal", () => {
  it("parses a bare JSON answer", () => {
    expect(extractProposal(JSON.stringify(proposal))).toMatchObject({ ok: true, team: { roles: [{ name: "design" }] } });
  });

  it("parses JSON wrapped in a code fence with text around it", () => {
    const text = "Here is the team:\n```json\n" + JSON.stringify(proposal, null, 2) + "\n```\nDone.";
    expect(extractProposal(text).ok).toBe(true);
  });

  it("drops role workspaces the planner gave anyway, even the same one twice, and keeps the orchestrator's", () => {
    const named = { ...proposal, roles: [{ ...proposal.roles[0], workspace: "qa" }, { ...proposal.roles[0], name: "qa", workspace: "qa" }] };
    const result = extractProposal(JSON.stringify(named));
    expect(result).toMatchObject({ ok: true, team: { orchestrator: { workspace: "orchestrator" } } });
    if (result.ok) for (const role of result.team.roles) expect(role).not.toHaveProperty("workspace");
  });

  it("fails clearly when there is no answer", () => {
    expect(extractProposal(null)).toEqual({ ok: false, errors: ["the planner finished without an answer"] });
    expect(extractProposal("I could not decide").ok).toBe(false);
  });
});
