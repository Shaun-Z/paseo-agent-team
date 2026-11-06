import { describe, expect, it } from "vitest";
import { extractInstructions, INSTRUCTIONS_JSON_SCHEMA, instructionsPrompt, type TeamOutline } from "../shared/proposal";
import { teamInstructionsImproveRpc, teamInstructionsProposalRpc } from "../shared/rpc";

const outline: TeamOutline = {
  orchestratorWorkspace: "orchestrator",
  roles: [
    { name: "frontend", folders: ["apps/web"] },
    { name: "backend", folders: [] },
  ],
};

describe("instructionsPrompt", () => {
  const team = { ...outline, goal: "Ship the web app" };
  const target = { name: "frontend", folders: ["apps/web"], instructions: "Builds the UI." };
  const prompt = instructionsPrompt(target, "make it shorter", team);

  it("includes the role, folders, current instructions, goal and orchestrator workspace", () => {
    expect(prompt).toContain("Role: frontend");
    expect(prompt).toContain("Folders: apps/web");
    expect(prompt).toContain("Current instructions: Builds the UI.");
    expect(prompt).toContain("Team goal: Ship the web app");
    expect(prompt).toContain("Orchestrator workspace: orchestrator");
  });

  it("says folders are any when the role has none", () => {
    expect(instructionsPrompt({ ...target, folders: [] }, "", team)).toContain("Folders: any");
  });

  it("adds the user request only when it is not blank, trimmed", () => {
    expect(prompt).toContain("User request: make it shorter");
    expect(instructionsPrompt(target, "  \n ", team)).not.toContain("User request");
    expect(instructionsPrompt(target, "  more tests  ", team)).toContain("User request: more tests\n");
  });

  it("lists the other roles without the role itself", () => {
    expect(prompt).toContain("- backend (folders any)");
    expect(prompt).not.toContain("- frontend (folders");
  });

  it("says (none) when there are no other roles", () => {
    const alone = instructionsPrompt(target, "", { ...team, roles: [{ name: "frontend", folders: ["apps/web"] }] });
    expect(alone).toContain("- (none)");
    expect(prompt).not.toContain("(none)");
  });

  it("forbids file changes and shows the exact JSON shape", () => {
    expect(prompt).toMatch(/Do not create, change or delete any file/);
    const example = JSON.parse(prompt.slice(prompt.lastIndexOf("{"), prompt.lastIndexOf("}") + 1));
    expect(Object.keys(example)).toEqual(["instructions"]);
  });
});

describe("INSTRUCTIONS_JSON_SCHEMA", () => {
  it("requires only instructions", () => {
    expect(INSTRUCTIONS_JSON_SCHEMA.required).toEqual(["instructions"]);
    expect(Object.keys(INSTRUCTIONS_JSON_SCHEMA.properties)).toEqual(["instructions"]);
  });
});

describe("extractInstructions", () => {
  it("reads plain JSON or JSON wrapped in a code fence and text", () => {
    const json = JSON.stringify({ instructions: "Do the thing." });
    expect(extractInstructions(json)).toEqual({ ok: true, instructions: "Do the thing." });
    expect(extractInstructions("Here:\n```json\n" + json + "\n```\nDone.")).toEqual({ ok: true, instructions: "Do the thing." });
  });

  it("trims the result", () => {
    expect(extractInstructions(JSON.stringify({ instructions: "  \n Do it.  " }))).toEqual({ ok: true, instructions: "Do it." });
  });

  it("reports a missing answer and missing JSON", () => {
    expect(extractInstructions(null)).toEqual({ ok: false, errors: ["the planner finished without an answer"] });
    expect(extractInstructions("no json here").ok).toBe(false);
  });

  it("rejects a missing key, a non-string and a blank string", () => {
    const bad = { ok: false, errors: ["instructions: expected a non-empty string"] };
    expect(extractInstructions(JSON.stringify({ other: "x" }))).toEqual(bad);
    expect(extractInstructions(JSON.stringify({ instructions: 5 }))).toEqual(bad);
    expect(extractInstructions(JSON.stringify({ instructions: "  " }))).toEqual(bad);
  });
});

describe("instructions RPC contracts", () => {
  const team = { ...outline, goal: "g" };
  const target = { name: "qa", folders: [], instructions: "" };

  it("accepts a role, a possibly empty request and the team for a workspace or a project", () => {
    expect(teamInstructionsImproveRpc.input.safeParse({ workspaceId: "wks_1", role: target, request: "", team }).success).toBe(true);
    expect(teamInstructionsImproveRpc.input.safeParse({ projectId: "prj_1", role: target, request: "x", team }).success).toBe(true);
  });

  it("returns running, done with instructions, or failed", () => {
    expect(teamInstructionsProposalRpc.output.safeParse({ status: "running" }).success).toBe(true);
    expect(teamInstructionsProposalRpc.output.safeParse({ status: "done", instructions: "x" }).success).toBe(true);
    expect(teamInstructionsProposalRpc.output.safeParse({ status: "failed", errors: ["x"] }).success).toBe(true);
  });
});
