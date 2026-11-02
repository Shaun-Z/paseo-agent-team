import { describe, expect, it } from "vitest";
import type { Team } from "../shared/team";
import { catalogFrom, roleModes, agentModeOf, validateTeam, type ProviderEntry } from "../shared/validate";

const entries: ProviderEntry[] = [
  {
    provider: "claude",
    enabled: true,
    status: "ready",
    models: [{ id: "claude-opus-5-5", label: "Opus 5.5" }],
    modes: [
      { id: "plan", colorTier: "planning" },
      { id: "default", colorTier: "safe" },
      { id: "acceptEdits", colorTier: "moderate" },
      { id: "auto", colorTier: "moderate" },
      { id: "bypassPermissions", colorTier: "dangerous" },
    ],
  },
  {
    provider: "codex",
    enabled: true,
    status: "ready",
    modes: [
      { id: "auto", colorTier: "moderate" },
      { id: "auto-review", colorTier: "moderate" },
      { id: "full-access", colorTier: "dangerous" },
    ],
    models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }, { id: "hidden", label: "Hidden", isSelectable: false }],
  },
  { provider: "antigravity", enabled: true, status: "ready", modes: [{ id: "full-access", isUnattended: true, colorTier: "dangerous" }], models: [{ id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)" }] },
  { provider: "copilot", enabled: true, status: "unavailable", modes: [{ id: "default", colorTier: "safe" }, { id: "bypassPermissions", colorTier: "dangerous" }], models: [{ id: "gpt-x", label: "x" }] },
  { provider: "omp", enabled: false, status: "ready", models: [{ id: "m", label: "m" }] },
];

const team: Team = {
  version: 1,
  goal: "",
  orchestrator: { workspace: "orchestrator", provider: "claude", model: "claude-opus-5-5" },
  roles: [
    { name: "design", provider: "codex", model: "gpt-6.1-sol", folders: [], instructions: "" },
    { name: "sound", provider: "antigravity", model: "gemini-4-argon-high", folders: [], instructions: "" },
  ],
};

describe("catalogFrom", () => {
  it("keeps enabled providers, marks readiness and drops unselectable models", () => {
    const catalog = catalogFrom(entries);
    expect(catalog.map((provider) => provider.id)).toEqual(["claude", "codex", "antigravity", "copilot"]);
    expect(catalog.find((provider) => provider.id === "codex")?.models.map((model) => model.id)).toEqual(["gpt-6.1-sol"]);
    expect(catalog.find((provider) => provider.id === "copilot")?.ready).toBe(false);
  });
});

describe("validateTeam", () => {
  const catalog = catalogFrom(entries);

  it("returns no errors when every provider and model is available", () => {
    expect(validateTeam(team, catalog)).toEqual([]);
  });

  it("reports an unknown provider by role", () => {
    const errors = validateTeam({ ...team, roles: [{ ...team.roles[0], provider: "gemini" }] }, catalog);
    expect(errors).toEqual([{ target: "design", message: 'provider "gemini" is not enabled on this host' }]);
  });

  it("reports a disabled provider as not enabled", () => {
    const errors = validateTeam({ ...team, roles: [{ ...team.roles[0], provider: "omp", model: "m" }] }, catalog);
    expect(errors[0]?.message).toBe('provider "omp" is not enabled on this host');
  });

  it("reports a provider that is enabled but not ready", () => {
    const errors = validateTeam({ ...team, roles: [{ ...team.roles[0], provider: "copilot", model: "gpt-x" }] }, catalog);
    expect(errors).toEqual([{ target: "design", message: 'provider "copilot" is not ready (unavailable)' }]);
  });

  it("reports an unknown or unselectable model", () => {
    const errors = validateTeam({ ...team, roles: [{ ...team.roles[0], model: "hidden" }] }, catalog);
    expect(errors).toEqual([{ target: "design", message: 'model "hidden" is not available for codex' }]);
  });

  it("checks the orchestrator too", () => {
    const errors = validateTeam({ ...team, orchestrator: { ...team.orchestrator, model: "nope" } }, catalog);
    expect(errors).toEqual([{ target: "orchestrator", message: 'model "nope" is not available for claude' }]);
  });
});

describe("agentModeOf", () => {
  it("picks auto for claude", () => {
    expect(agentModeOf(entries, "claude")).toBe("auto");
  });

  it("picks auto-review before auto for codex, whose own auto prompts", () => {
    expect(agentModeOf(entries, "codex")).toBe("auto-review");
  });

  it("falls back to the isUnattended mode", () => {
    expect(agentModeOf(entries, "antigravity")).toBe("full-access");
  });

  it("falls back to the dangerous colorTier mode", () => {
    expect(agentModeOf(entries, "copilot")).toBe("bypassPermissions");
  });

  it("returns undefined when the provider has no modes or is unknown", () => {
    expect(agentModeOf(entries, "omp")).toBeUndefined();
    expect(agentModeOf(entries, "gemini")).toBeUndefined();
  });

  describe("cursor", () => {
    const cursor = (modes: NonNullable<ProviderEntry["modes"]>): ProviderEntry[] => [{ provider: "cursor", enabled: true, status: "ready", modes }];
    const basic = [{ id: "agent" }, { id: "plan" }, { id: "ask" }];

    it("picks auto when cursor offers it", () => {
      expect(agentModeOf(cursor([...basic, { id: "auto" }]), "cursor")).toBe("auto");
    });

    it("returns undefined without auto, so Paseo's default mode applies", () => {
      expect(agentModeOf(cursor(basic), "cursor")).toBeUndefined();
    });
  });

  it("returns undefined when no mode matches any rule", () => {
    const plain: ProviderEntry[] = [{ provider: "plain", enabled: true, status: "ready", modes: [{ id: "default", colorTier: "safe" }, { id: "plan", colorTier: "planning" }] }];
    expect(agentModeOf(plain, "plain")).toBeUndefined();
  });

  describe("precedence", () => {
    const mixed = (modes: NonNullable<ProviderEntry["modes"]>): ProviderEntry[] => [{ provider: "p", enabled: true, status: "ready", modes }];

    it("prefers auto-review over auto, isUnattended and dangerous", () => {
      expect(agentModeOf(mixed([{ id: "risky", colorTier: "dangerous" }, { id: "free", isUnattended: true }, { id: "auto" }, { id: "auto-review" }]), "p")).toBe("auto-review");
    });

    it("prefers auto over isUnattended and dangerous", () => {
      expect(agentModeOf(mixed([{ id: "risky", colorTier: "dangerous" }, { id: "free", isUnattended: true }, { id: "auto" }]), "p")).toBe("auto");
    });

    it.each(["auto_edit", "auto-edit", "autoEdit", "https://agentclientprotocol.com/protocol/session-modes#autopilot"])("picks %s over a default mode", (id) => {
      expect(agentModeOf(mixed([{ id: "default", colorTier: "safe" }, { id }]), "p")).toBe(id);
    });

    it("picks a mode by its label when the id doesn't mention auto", () => {
      expect(agentModeOf(mixed([{ id: "default", label: "Default" }, { id: "yolo", label: "Auto accept" }]), "p")).toBe("yolo");
    });

    it("still prefers exact auto-review over auto and a fuzzy match", () => {
      expect(agentModeOf(mixed([{ id: "auto_edit" }, { id: "auto" }, { id: "auto-review" }]), "p")).toBe("auto-review");
    });

    it("prefers exact auto over a fuzzy match listed earlier", () => {
      expect(agentModeOf(mixed([{ id: "auto_edit" }, { id: "auto" }]), "p")).toBe("auto");
    });

    it("prefers a fuzzy auto mode over isUnattended and dangerous modes", () => {
      expect(agentModeOf(mixed([{ id: "risky", colorTier: "dangerous" }, { id: "free", isUnattended: true }, { id: "autoEdit" }]), "p")).toBe("autoEdit");
    });

    it("ignores auto in the middle of a word", () => {
      expect(agentModeOf(mixed([{ id: "default" }, { id: "noauto", label: "Noauto" }]), "p")).toBeUndefined();
    });

    it("prefers isUnattended over a different dangerous mode", () => {
      expect(agentModeOf(mixed([{ id: "risky", colorTier: "dangerous" }, { id: "chosen", isUnattended: true, colorTier: "moderate" }]), "p")).toBe("chosen");
    });
  });
});

describe("agentModeOf on this host's live snapshot", () => {
  const live: ProviderEntry[] = [
    { provider: "claude", enabled: true, status: "ready", modes: [{ id: "plan", label: "Plan", colorTier: "planning" }, { id: "default", label: "Default", colorTier: "safe" }, { id: "acceptEdits", label: "Accept Edits", colorTier: "moderate" }, { id: "auto", label: "Auto", colorTier: "moderate" }, { id: "bypassPermissions", label: "Bypass Permissions", colorTier: "dangerous" }] },
    { provider: "codex", enabled: true, status: "ready", modes: [{ id: "auto", label: "Default Permissions", colorTier: "moderate" }, { id: "auto-review", label: "Auto-review", colorTier: "moderate" }, { id: "full-access", label: "Full Access", colorTier: "dangerous" }] },
    { provider: "opencode", enabled: true, status: "ready", modes: [{ id: "build", label: "Build" }, { id: "plan", label: "Plan" }] },
    { provider: "antigravity", enabled: true, status: "ready", modes: [{ id: "full-access", label: "Full Access", isUnattended: true, colorTier: "dangerous" }] },
  ];

  it.each([
    ["claude", "auto"],
    ["codex", "auto-review"],
    ["opencode", undefined],
    ["antigravity", "full-access"],
  ])("%s -> %s", (provider, mode) => {
    expect(agentModeOf(live, provider)).toBe(mode);
  });
});

describe("roleModes", () => {
  it("maps each role name to its provider's agent mode", () => {
    expect(roleModes(team, entries)).toEqual({ design: "auto-review", sound: "full-access" });
  });

  it("maps a cursor role to auto when cursor offers it", () => {
    const cursorEntries: ProviderEntry[] = [{ provider: "cursor", enabled: true, status: "ready", modes: [{ id: "agent" }, { id: "plan" }, { id: "ask" }, { id: "auto" }] }];
    const cursorTeam = { ...team, roles: [{ ...team.roles[0]!, provider: "cursor" }] };
    expect(roleModes(cursorTeam, cursorEntries)).toEqual({ design: "auto" });
  });

  it("leaves a role without a mode undefined", () => {
    const noModes = { ...team, roles: [{ ...team.roles[0]!, provider: "omp" }] };
    expect(roleModes(noModes, entries)).toEqual({ design: undefined });
  });
});
