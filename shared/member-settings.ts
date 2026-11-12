import { z } from "zod";
import type { Member } from "./research-team";

export const SessionSettingsSchema = z.object({
  provider: z.string(), model: z.string().nullable(), modeId: z.string().nullable(),
  thinkingOptionId: z.string().nullable(), effectiveThinkingOptionId: z.string().nullable(),
});
export type SessionSettings = z.infer<typeof SessionSettingsSchema>;
/** The current Paseo snapshot, never filled from the saved launch configuration. */
export interface AgentSettings {
  provider: string;
  model?: string | null;
  currentModeId?: string | null;
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
  runtimeInfo?: { model?: string | null; modeId?: string | null; thinkingOptionId?: string | null };
}
export function sessionSettingsOf(agent: AgentSettings): SessionSettings {
  return {
    provider: agent.provider,
    model: agent.model ?? agent.runtimeInfo?.model ?? null,
    modeId: agent.currentModeId ?? agent.runtimeInfo?.modeId ?? null,
    thinkingOptionId: agent.thinkingOptionId ?? null,
    effectiveThinkingOptionId: agent.effectiveThinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? agent.thinkingOptionId ?? null,
  };
}
export function sessionSettingsDiffer(saved: Member["launchSnapshot"], agent: AgentSettings): boolean {
  const current = sessionSettingsOf(agent);
  return current.provider !== saved.provider
    || current.model !== null && current.model !== saved.model
    || saved.modeId !== undefined && current.modeId !== null && current.modeId !== saved.modeId
    // Compare the selection, so auto/default resolving to an effort is not an override.
    || agent.thinkingOptionId !== undefined && agent.thinkingOptionId !== (saved.thinkingOptionId ?? null);
}
