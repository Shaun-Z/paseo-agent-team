import { describe, expect, it } from "vitest";
import { extractRole, ROLE_JSON_SCHEMA, rolePrompt, type TeamOutline } from "../shared/proposal";
import { teamRoleProposalRpc, teamRoleProposeRpc } from "../shared/rpc";
import type { ProviderInfo } from "../shared/validate";

const catalog: ProviderInfo[] = [
  { id: "claude", ready: true, status: "ready", models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }] },
  { id: "codex", ready: true, status: "ready", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }] },
  { id: "copilot", ready: false, status: "unavailable", models: [{ id: "x", label: "x" }] },
];

const outline: TeamOutline = {
  orchestratorWorkspace: "orchestrator",
  roles: [
    { name: "frontend", folders: ["apps/web"] },
    { name: "backend", folders: [] },
  ],
};

const role = { name: "qa", provider: "claude", model: "claude-sonnet-5-5", folders: ["tests/e2e"], instructions: "Writes end-to-end tests." };

describe("rolePrompt", () => {
  const prompt = rolePrompt("someone who writes end-to-end tests", outline, catalog);

  it("includes the description and only ready providers with their model ids", () => {
    expect(prompt).toContain("someone who writes end-to-end tests");
    expect(prompt).toContain("- claude: claude-sonnet-5-5");
    expect(prompt).toContain("- codex: gpt-6.1-sol");
    expect(prompt).not.toContain("copilot");
  });

  it("lists the existing roles and the orchestrator workspace so the new role does not overlap them", () => {
    expect(prompt).toContain("- frontend (folders apps/web)");
    expect(prompt).toContain("- backend (folders any)");
    expect(prompt).toContain('"orchestrator"');
  });

  it("says the role runs in the orchestrator's workspace and offers no workspace of its own", () => {
    const example = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1));
    expect(example).not.toHaveProperty("workspace");
    expect(prompt).toMatch(/orchestrator's workspace/);
    expect(prompt).not.toMatch(/separate/);
    expect(prompt).not.toMatch(/empty string/);
    expect(prompt).not.toMatch(/its own Paseo workspace/);
  });

  it("forbids file changes and shows the exact JSON shape of one role", () => {
    expect(prompt).toMatch(/Do not create, change or delete any file/);
    const example = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1));
    expect(Object.keys(example).sort()).toEqual(["folders", "instructions", "model", "name", "provider"]);
  });
});

describe("ROLE_JSON_SCHEMA", () => {
  it("requires every role field", () => {
    expect(ROLE_JSON_SCHEMA.required).toEqual(["name", "provider", "model", "folders", "instructions"]);
  });

  it("has no workspace property", () => {
    expect(ROLE_JSON_SCHEMA.properties).not.toHaveProperty("workspace");
  });
});

describe("extractRole", () => {
  it("reads a role from plain JSON or JSON wrapped in a code fence and text", () => {
    expect(extractRole(JSON.stringify(role))).toEqual({ ok: true, role });
    expect(extractRole("Here it is:\n```json\n" + JSON.stringify(role) + "\n```")).toEqual({ ok: true, role });
  });

  it("drops a workspace the planner gave anyway", () => {
    expect(extractRole(JSON.stringify({ ...role, workspace: "qa" }))).toEqual({ ok: true, role });
  });

  it("reports a missing answer, missing JSON, broken JSON and a missing field", () => {
    expect(extractRole(null)).toEqual({ ok: false, errors: ["the planner finished without an answer"] });
    expect(extractRole("no json here")).toEqual({ ok: false, errors: ["the planner's answer has no JSON role"] });
    const broken = extractRole("{ name: qa }");
    expect(broken.ok).toBe(false);
    const missing = extractRole(JSON.stringify({ ...role, model: undefined }));
    expect(missing).toEqual({ ok: false, errors: [expect.stringContaining("model")] });
  });
});

describe("role RPC contracts", () => {
  it("accepts a description with the team outline for a workspace or a project", () => {
    expect(teamRoleProposeRpc.input.safeParse({ workspaceId: "wks_1", description: "qa", team: outline }).success).toBe(true);
    expect(teamRoleProposeRpc.input.safeParse({ projectId: "prj_1", description: "qa", team: outline }).success).toBe(true);
  });

  it("rejects an empty description", () => {
    expect(teamRoleProposeRpc.input.safeParse({ workspaceId: "wks_1", description: "   ", team: outline }).success).toBe(false);
  });

  it("returns running, done with a role, or failed", () => {
    expect(teamRoleProposalRpc.output.safeParse({ status: "running" }).success).toBe(true);
    expect(teamRoleProposalRpc.output.safeParse({ status: "done", role }).success).toBe(true);
    expect(teamRoleProposalRpc.output.safeParse({ status: "failed", errors: ["x"] }).success).toBe(true);
  });
});
