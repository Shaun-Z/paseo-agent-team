import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import type { researchReadRpc } from "../shared/research-rpc";
import type { SessionSettings } from "../shared/member-settings";
import type { Member } from "../shared/research-team";
import { messages } from "./i18n";

type Colors = PluginWorkspacePanelProps["theme"]["colors"];
type MemberState = RpcOutput<typeof researchReadRpc>["members"][number];
export function SettingsLine({ settings, saved = false, colors }: { settings: SessionSettings | Member["launchSnapshot"]; saved?: boolean; colors: Colors }) {
  const { t } = useTranslation(messages);
  const thinking = "effectiveThinkingOptionId" in settings ? settings.effectiveThinkingOptionId ?? settings.thinkingOptionId : settings.thinkingOptionId;
  const missing = t(saved ? "research.ui.providerDefault" : "research.ui.notReported");
  return <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
    {t(saved ? "research.ui.savedSettings" : "research.ui.sessionSettings")}: {settings.provider}/{settings.model ?? missing}{settings.modeId ? ` · ${settings.modeId}` : ""} · {t("research.ui.thinkingLevel")}: {thinking ?? missing}
  </Text>;
}
export function CurrentMemberSettings({ state, colors }: { state?: MemberState; colors: Colors }) {
  const { t } = useTranslation(messages);
  if (!state?.sessionSettings) return null;
  return <View style={{ gap: 4 }}>
    <SettingsLine settings={state.sessionSettings} colors={colors} />
    {state.settingsChanged && <>
      <Text style={{ color: colors.statusWarning, fontSize: 11 }}>{t("research.ui.settingsChanged")}</Text>
      <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>{t("research.ui.resetUsesSaved")}</Text>
    </>}
  </View>;
}
