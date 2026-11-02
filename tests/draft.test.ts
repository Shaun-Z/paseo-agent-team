import { afterEach, describe, expect, it, vi } from "vitest";
import { foldersText, newRole, parseFolders, uniqueName } from "../shared/draft";
import type { ProviderInfo } from "../shared/validate";

const catalog: ProviderInfo[] = [
  { id: "copilot", ready: false, status: "unavailable", models: [{ id: "x", label: "x" }] },
  { id: "codex", ready: true, status: "ready", models: [{ id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }] },
];

describe("parseFolders / foldersText", () => {
  it("splits on commas, trims and drops empty entries", () => {
    expect(parseFolders(" src/ui, ,assets/images ,")).toEqual(["src/ui", "assets/images"]);
  });

  it("joins folders back for editing", () => {
    expect(foldersText(["src/ui", "assets"])).toBe("src/ui, assets");
  });
});

describe("uniqueName", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the trimmed base when it is free", () => {
    expect(uniqueName("  ui  ", ["api"])).toBe("ui");
  });

  it("adds a #XXXX suffix when the base is taken, ignoring case", () => {
    expect(uniqueName("ui", ["UI"])).toMatch(/^ui#[0-9A-F]{4}$/);
  });

  it("does not return the base when a taken name only differs by surrounding spaces", () => {
    expect(uniqueName("ui", ["ui "])).not.toBe("ui");
  });

  it("regenerates the suffix until the name is free", () => {
    // 0xADB2 -> "ADB2" (taken), then 0x0001 -> "0001" (free)
    vi.spyOn(Math, "random").mockReturnValueOnce(0xadb2 / 0x10000).mockReturnValueOnce(1 / 0x10000);
    expect(uniqueName("ui", ["ui", "ui#ADB2"])).toBe("ui#0001");
  });
});

describe("newRole", () => {
  it("uses the first ready provider and its first model, with a name not already taken", () => {
    expect(newRole(catalog, ["role"])).toEqual({ name: expect.stringMatching(/^role#[0-9A-F]{4}$/), provider: "codex", model: "gpt-6.1-sol", folders: [], instructions: "" });
  });

  it("leaves provider and model empty when nothing is ready", () => {
    expect(newRole([], [])).toMatchObject({ name: "role", provider: "", model: "" });
  });

  it("has no workspace: the role runs in the orchestrator's", () => {
    expect(newRole(catalog, [])).not.toHaveProperty("workspace");
    expect(newRole([], [])).not.toHaveProperty("workspace");
  });
});
