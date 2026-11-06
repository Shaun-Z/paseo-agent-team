import { describe, expect, it } from "vitest";
import { applyTeamEdit, summarizeTeamEdit } from "../shared/team-edit";
import { extractProposal, teamEditPrompt } from "../shared/proposal";
import { teamApplyRpc, teamEditProposalRpc, teamEditProposeRpc, teamRestoreRpc } from "../shared/rpc";
import type { Team } from "../shared/team";
import type { ProviderInfo } from "../shared/validate";

const catalog: ProviderInfo[] = [
  { id: "claude", ready: true, status: "ready", models: [{ id: "claude-sonnet-5-5", label: "Sonnet 5.5" }] },
  { id: "codex", ready: true, status: "ready", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }] },
  { id: "copilot", ready: false, status: "unavailable", models: [{ id: "hidden-model", label: "x" }] },
];

const draft: Team = {
  version: 1,
  goal: "Ship the web app",
  orchestrator: { workspace: "lead", provider: "claude", model: "claude-sonnet-5-5" },
  roles: [
    { name: "frontend", provider: "claude", model: "claude-sonnet-5-5", folders: ["apps/web", "packages/ui"], instructions: "Builds the UI." },
    { name: "backend", provider: "codex", model: "gpt-6.1-sol", folders: ["apps/api"], instructions: "Builds the API." },
  ],
};

const edited = (over: Partial<Team> = {}): Team => ({ ...draft, ...over });

describe("applyTeamEdit", () => {
  it("keeps the draft's orchestrator workspace and version even when the proposal changes them", () => {
    const proposed = { ...draft, version: 1 as const, orchestrator: { workspace: "other", provider: "codex", model: "gpt-6.1-sol" } };
    const result = applyTeamEdit(draft, proposed);
    expect(result.orchestrator).toEqual({ workspace: "lead", provider: "codex", model: "gpt-6.1-sol" });
    expect(result.version).toBe(1);
    expect(result.goal).toBe("Ship the web app");
  });

  it("makes duplicate role names unique, keeping the first as is", () => {
    const dup = { ...draft.roles[0]!, name: "qa" };
    const result = applyTeamEdit(draft, edited({ roles: [dup, { ...dup }, { ...dup, name: "QA" }] }));
    const names = result.roles.map((role) => role.name);
    expect(names[0]).toBe("qa");
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(3);
    expect(names[1]).toMatch(/^qa#[0-9A-F]{4}$/);
    expect(names[2]).toMatch(/^QA#[0-9A-F]{4}$/);
  });

  it("leaves unique roles untouched", () => {
    expect(applyTeamEdit(draft, draft)).toEqual(draft);
  });
});

describe("summarizeTeamEdit", () => {
  it("reports nothing for an identical team, and nothing for folder order alone", () => {
    const empty = { added: [], removed: [], changed: [], orchestrator: false, goal: false };
    expect(summarizeTeamEdit(draft, draft)).toEqual(empty);
    const reordered = edited({ roles: [{ ...draft.roles[0]!, folders: ["packages/ui", "apps/web"] }, draft.roles[1]!] });
    expect(summarizeTeamEdit(draft, reordered)).toEqual(empty);
  });

  it("lists an added role", () => {
    const qa = { name: "qa", provider: "claude", model: "claude-sonnet-5-5", folders: [], instructions: "" };
    const summary = summarizeTeamEdit(draft, edited({ roles: [...draft.roles, qa] }));
    expect(summary.added).toEqual(["qa"]);
    expect(summary.removed).toEqual([]);
    expect(summary.changed).toEqual([]);
  });

  it("lists a removed role", () => {
    const summary = summarizeTeamEdit(draft, edited({ roles: [draft.roles[0]!] }));
    expect(summary.removed).toEqual(["backend"]);
    expect(summary.added).toEqual([]);
  });

  it("treats a rename as one added and one removed role", () => {
    const summary = summarizeTeamEdit(draft, edited({ roles: [{ ...draft.roles[0]!, name: "web" }, draft.roles[1]!] }));
    expect(summary).toMatchObject({ added: ["web"], removed: ["frontend"], changed: [] });
  });

  it("lists a changed role with exactly the changed fields, and no unchanged role", () => {
    const summary = summarizeTeamEdit(draft, edited({ roles: [
      { ...draft.roles[0]!, model: "other-model", folders: ["apps/web"], instructions: "New." },
      draft.roles[1]!,
    ] }));
    expect(summary.changed).toEqual([{ name: "frontend", fields: ["model", "folders", "instructions"] }]);
    expect(JSON.stringify(summary)).not.toContain("backend");
  });

  it("flags a provider change on a changed role", () => {
    const summary = summarizeTeamEdit(draft, edited({ roles: [draft.roles[0]!, { ...draft.roles[1]!, provider: "claude" }] }));
    expect(summary.changed).toEqual([{ name: "backend", fields: ["provider"] }]);
  });

  it("flags a goal change only when the goal differs", () => {
    expect(summarizeTeamEdit(draft, edited({ goal: "Ship the mobile app" }))).toMatchObject({ goal: true, orchestrator: false });
    expect(summarizeTeamEdit(draft, edited()).goal).toBe(false);
  });

  it("flags an orchestrator provider or model change, not a workspace change", () => {
    const model = summarizeTeamEdit(draft, edited({ orchestrator: { ...draft.orchestrator, model: "gpt-6.1-sol" } }));
    expect(model.orchestrator).toBe(true);
    const provider = summarizeTeamEdit(draft, edited({ orchestrator: { ...draft.orchestrator, provider: "codex" } }));
    expect(provider.orchestrator).toBe(true);
    expect(summarizeTeamEdit(draft, edited({ orchestrator: { ...draft.orchestrator, workspace: "x" } })).orchestrator).toBe(false);
  });
});

describe("teamEditPrompt", () => {
  const prompt = teamEditPrompt("  add a qa role  ", draft, catalog);

  it("contains the trimmed request and the current draft's role names", () => {
    expect(prompt).toContain("User request: add a qa role\n");
    expect(prompt).toContain('"name": "frontend"');
    expect(prompt).toContain('"name": "backend"');
    expect(prompt).toContain('"goal": "Ship the web app"');
  });

  it("lists the ready providers' model ids and leaves out unavailable ones", () => {
    expect(prompt).toContain("- claude: claude-sonnet-5-5");
    expect(prompt).toContain("- codex: gpt-6.1-sol");
    expect(prompt).not.toContain("hidden-model");
  });

  it("states the orchestrator workspace rule and forbids file changes", () => {
    expect(prompt).toContain('Keep the orchestrator workspace exactly "lead" and version 1.');
    expect(prompt).toMatch(/Do not create, change or delete any file/);
    const example = JSON.parse(prompt.slice(prompt.lastIndexOf('{\n  "version"'), prompt.lastIndexOf("}") + 1));
    expect(example.orchestrator.workspace).toBe("lead");
    expect(Object.keys(example)).toEqual(["version", "goal", "orchestrator", "roles"]);
  });
});

describe("teamEditPrompt edit-existing-role rule", () => {
  const prompt = teamEditPrompt("add UI testing to tester", draft, catalog);

  it("tells the planner to change an existing role instead of adding one", () => {
    expect(prompt).toContain("Treat the request as an edit of the existing team.");
    expect(prompt).toContain("change that role's instructions, folders, provider/model or name instead of adding a role");
    expect(prompt).toContain("do not create a new role");
  });

  it("adds a new role only when explicitly requested or when no role fits", () => {
    expect(prompt).toContain("Add a new role only when the request explicitly asks for a new or separate role, or when no existing role can own the work.");
  });

  it("removes a role only when asked or merged, and lets one request change several roles", () => {
    expect(prompt).toContain("Remove a role only when the request asks for it or its work is merged into another role");
    expect(prompt).toContain("change all of them");
  });
});

describe("extractProposal for an edit answer", () => {
  it("reads a valid team from plain JSON or a code fence", () => {
    expect(extractProposal(JSON.stringify(draft))).toEqual({ ok: true, team: draft });
    expect(extractProposal("Done:\n```json\n" + JSON.stringify(draft) + "\n```")).toEqual({ ok: true, team: draft });
  });

  it("rejects invalid JSON and a missing answer", () => {
    expect(extractProposal(null)).toMatchObject({ ok: false });
    expect(extractProposal("{ goal: oops")).toMatchObject({ ok: false });
    expect(extractProposal("no json at all")).toMatchObject({ ok: false });
  });

  it("rejects an invalid team that breaks the schema, naming the field", () => {
    const result = extractProposal(JSON.stringify({ ...draft, roles: [{ ...draft.roles[0]!, model: undefined }] }));
    expect(result).toMatchObject({ ok: false, errors: [expect.stringContaining("model")] });
    expect(extractProposal(JSON.stringify({ ...draft, version: 2 }))).toMatchObject({ ok: false });
  });
});

describe("team edit RPC contracts", () => {
  const input = { request: "add qa", team: draft };

  it("accepts a request with the draft for a workspace or a project", () => {
    expect(teamEditProposeRpc.name).toBe("team.edit.propose");
    expect(teamEditProposeRpc.input.safeParse({ workspaceId: "wks_1", ...input }).success).toBe(true);
    expect(teamEditProposeRpc.input.safeParse({ projectId: "prj_1", ...input }).success).toBe(true);
  });

  it("rejects an invalid blank request", () => {
    expect(teamEditProposeRpc.input.safeParse({ workspaceId: "wks_1", ...input, request: "   " }).success).toBe(false);
    expect(teamEditProposeRpc.input.safeParse({ workspaceId: "wks_1", ...input, request: "" }).success).toBe(false);
  });

  it("accepts an in-progress draft with blank names and no roles", () => {
    const rough = { version: 1, goal: "", orchestrator: { workspace: "", provider: "", model: "" }, roles: [] };
    expect(teamEditProposeRpc.input.safeParse({ workspaceId: "wks_1", request: "start", team: rough }).success).toBe(true);
    const blankName = { ...rough, roles: [{ name: "", provider: "", model: "", folders: [], instructions: "" }] };
    expect(teamEditProposeRpc.input.safeParse({ workspaceId: "wks_1", request: "start", team: blankName }).success).toBe(true);
  });

  it("accepts running, done with team and validation, and failed", () => {
    expect(teamEditProposalRpc.name).toBe("team.edit.proposal");
    expect(teamEditProposalRpc.output.safeParse({ status: "running" }).success).toBe(true);
    expect(teamEditProposalRpc.output.safeParse({ status: "done", team: draft, validation: [{ target: "qa", message: "unknown model" }] }).success).toBe(true);
    expect(teamEditProposalRpc.output.safeParse({ status: "failed", errors: ["x"] }).success).toBe(true);
    expect(teamEditProposalRpc.output.safeParse({ status: "done", team: draft }).success).toBe(false);
  });
});

describe("team restore RPC contract", () => {
  it("requires both projectId and file strings", () => {
    expect(teamRestoreRpc.name).toBe("team.restore");
    expect(teamRestoreRpc.input.safeParse({ projectId: "prj_1", file: ".agents/teams/lead.json" }).success).toBe(true);
    expect(teamRestoreRpc.input.safeParse({ projectId: "prj_1" }).success).toBe(false);
    expect(teamRestoreRpc.input.safeParse({ file: ".agents/teams/lead.json" }).success).toBe(false);
    expect(teamRestoreRpc.input.safeParse({ projectId: "prj_1", file: 3 }).success).toBe(false);
    expect(teamRestoreRpc.input.safeParse({}).success).toBe(false);
  });

  it("accepts ok:false with errors and an ok:true apply result", () => {
    expect(teamRestoreRpc.output.safeParse({ ok: false, errors: ["x"] }).success).toBe(true);
    const applied = { ok: true, file: "/p/.agents/teams/lead.json", workspaces: [{ target: "lead", workspace: "lead", id: "wks_1", created: false }], orchestratorAgentId: "agt_1", cleanup: [], permission: null };
    expect(teamRestoreRpc.output.safeParse(applied).success).toBe(true);
    expect(teamRestoreRpc.output.safeParse({ ...applied, permission: ".claude/settings.local.json" }).success).toBe(true);
  });

  it("rejects results that are neither shape", () => {
    expect(teamRestoreRpc.output.safeParse({ ok: false }).success).toBe(false);
    expect(teamRestoreRpc.output.safeParse({ ok: true, file: "f" }).success).toBe(false);
  });

  it("uses the same output schema object as teamApplyRpc", () => {
    expect(teamRestoreRpc.output).toBe(teamApplyRpc.output);
  });
});
