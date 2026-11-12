import { describe, expect, it } from "vitest";
import { sessionSettingsDiffer, sessionSettingsOf } from "../shared/member-settings";

const saved = { provider: "codex", model: "model-a", modeId: "ask", thinkingOptionId: "high" };
const agent = { provider: "codex", model: "model-a", currentModeId: "ask", thinkingOptionId: "high", effectiveThinkingOptionId: "high" };
describe("member session settings", () => {
  it("reads model and effective effort from the session rather than the saved snapshot", () => {
    const changed = { ...agent, model: "model-b", thinkingOptionId: "medium", effectiveThinkingOptionId: "low" };
    expect(sessionSettingsOf(changed)).toMatchObject({ model: "model-b", thinkingOptionId: "medium", effectiveThinkingOptionId: "low" });
    expect(sessionSettingsDiffer(saved, changed)).toBe(true);
    expect(sessionSettingsDiffer(saved, agent)).toBe(false);
  });
  it("detects thinking-only changes and clearing an explicit selection", () => {
    expect(sessionSettingsDiffer(saved, { ...agent, thinkingOptionId: "low" })).toBe(true);
    expect(sessionSettingsDiffer(saved, { ...agent, thinkingOptionId: null, effectiveThinkingOptionId: "medium" })).toBe(true);
  });
  it("does not flag provider defaults or auto resolving to a concrete effort", () => {
    expect(sessionSettingsDiffer({ provider: "codex", model: "model-a" }, { ...agent, thinkingOptionId: null })).toBe(false);
    expect(sessionSettingsDiffer({ ...saved, thinkingOptionId: "auto" }, { ...agent, thinkingOptionId: "auto", effectiveThinkingOptionId: "high" })).toBe(false);
    expect(sessionSettingsDiffer({ provider: "codex", model: "model-a" }, { ...agent, thinkingOptionId: "high" })).toBe(true);
  });
  it("represents unreported values without substituting the saved settings", () => {
    expect(sessionSettingsOf({ provider: "codex" })).toEqual({ provider: "codex", model: null, modeId: null, thinkingOptionId: null, effectiveThinkingOptionId: null });
    expect(sessionSettingsDiffer(saved, { provider: "codex" })).toBe(false);
  });
  it("uses runtime reports as a fallback and prefers snapshot values when supplied", () => {
    const runtimeInfo = { model: "reported-model", thinkingOptionId: "medium", modeId: "auto" };
    expect(sessionSettingsOf({ provider: "codex", runtimeInfo })).toMatchObject({ model: "reported-model", effectiveThinkingOptionId: "medium", modeId: "auto" });
    expect(sessionSettingsOf({ ...agent, runtimeInfo })).toMatchObject({ model: "model-a", effectiveThinkingOptionId: "high", modeId: "ask" });
  });
});
