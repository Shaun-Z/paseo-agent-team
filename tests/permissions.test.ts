import { describe, expect, it } from "vitest";
import { needsCreateAgentPermission, needsRunPermission, PASEO_CREATE_AGENT_RULE, PASEO_RUN_RULE, withAllowRule } from "../shared/permissions";
import type { Team } from "../shared/team";
import type { ProviderEntry } from "../shared/validate";

// Modes as the live daemon reports them.
const entries: ProviderEntry[] = [
  { provider: "claude", enabled: true, status: "ready", modes: [{ id: "default", colorTier: "safe" }, { id: "auto", colorTier: "moderate" }, { id: "bypassPermissions", colorTier: "dangerous" }] },
  { provider: "codex", enabled: true, status: "ready", modes: [{ id: "auto", colorTier: "moderate" }, { id: "auto-review", colorTier: "moderate" }, { id: "full-access", colorTier: "dangerous" }] },
  { provider: "antigravity", enabled: true, status: "ready", modes: [{ id: "full-access", colorTier: "dangerous", isUnattended: true }] },
  { provider: "plain", enabled: true, status: "ready", modes: [] },
];

const team = (orchestrator: string, roles: string[]): Team => ({
  version: 1,
  goal: "",
  orchestrator: { workspace: "orchestrator", provider: orchestrator, model: "m" },
  roles: roles.map((provider, at) => ({ name: `r${at}`, workspace: "", provider, model: "m", folders: [], instructions: "" })),
});

describe("needsRunPermission", () => {
  it("is needed when a Claude orchestrator has a role whose chosen mode is unattended", () => {
    expect(needsRunPermission(team("claude", ["claude", "antigravity"]), entries)).toBe(true);
  });

  it("is not needed when every role gets an auto mode or the default", () => {
    expect(needsRunPermission(team("claude", ["claude", "codex", "plain"]), entries)).toBe(false);
  });

  it("is not needed for an orchestrator on another provider", () => {
    expect(needsRunPermission(team("codex", ["antigravity"]), entries)).toBe(false);
  });
});

describe("withAllowRule", () => {
  it("adds the rule to an empty settings file", () => {
    expect(withAllowRule({}, PASEO_RUN_RULE)).toEqual({ permissions: { allow: ["Bash(paseo run *)"] } });
  });

  it("keeps the other settings and rules", () => {
    const settings = { model: "opus", permissions: { allow: ["Bash(npm test)"], deny: ["Read(.env)"] } };
    expect(withAllowRule(settings, PASEO_RUN_RULE)).toEqual({ model: "opus", permissions: { allow: ["Bash(npm test)", "Bash(paseo run *)"], deny: ["Read(.env)"] } });
    expect(settings.permissions.allow).toEqual(["Bash(npm test)"]);
  });

  it("returns null when the rule is already there", () => {
    expect(withAllowRule({ permissions: { allow: ["Bash(paseo run *)"] } }, PASEO_RUN_RULE)).toBeNull();
  });
});

describe("needsCreateAgentPermission", () => {
  it("uses the create_agent tool name as the rule", () => {
    expect(PASEO_CREATE_AGENT_RULE).toBe("mcp__paseo__create_agent");
  });

  it("is needed when a Claude orchestrator has a role with auto_accept", () => {
    expect(needsCreateAgentPermission(team("claude", ["claude", "cursor"]), { r1: { auto_accept: true } })).toBe(true);
  });

  it("is not needed for an orchestrator on another provider", () => {
    expect(needsCreateAgentPermission(team("codex", ["cursor"]), { r0: { auto_accept: true } })).toBe(false);
  });

  it("is not needed when no role has auto_accept", () => {
    expect(needsCreateAgentPermission(team("claude", ["claude", "cursor"]), {})).toBe(false);
    expect(needsCreateAgentPermission(team("claude", ["claude", "cursor"]), { r0: undefined, r1: undefined })).toBe(false);
  });
});
