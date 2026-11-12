import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { researchReadRpc } from "../shared/research-rpc";
import { messages } from "./i18n";
import { styles } from "./ui";
import { CurrentMemberSettings, SettingsLine } from "./MemberSettings";

export type ResearchEditTarget = { section: "team" | "roles" | "members"; memberId?: string; roleId?: string };
type Props = Pick<PluginWorkspacePanelProps, "theme" | "layout" | "navigation"> & {
  data: RpcOutput<typeof researchReadRpc>;
  onEdit(target: ResearchEditTarget): void;
  openDashboard?(): void;
};

/** Saved configuration and a session comparison. Activity belongs to Dashboard. */
export function ResearchTeamConfig({ data, theme, layout, navigation, onEdit, openDashboard }: Props) {
  const { t } = useTranslation(messages);
  const [tab, setTab] = useState<"members" | "prompts">("members");
  const c = theme.colors;
  const s = styles(c, layout.compact);
  const team = data.team;
  if (!team) return null;
  const commonPromptFiles = team.commonPromptFiles ?? [];
  const card = { borderWidth: 1, borderColor: c.border, borderRadius: 8, backgroundColor: c.surface1, padding: 14, gap: 10 };
  const action = (label: string, run: () => void) => <Pressable accessibilityRole="button" onPress={run} style={{ paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: c.border, borderRadius: 6 }}><Text style={{ color: c.accent, fontSize: 12 }}>{label}</Text></Pressable>;
  return <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 8, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 160, gap: 4 }}>
          <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "700" }}>{t("research.ui.configuration")}</Text>
          <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{team.workspace}</Text>
        </View>
        {openDashboard && action(t("research.ui.openDashboard"), openDashboard)}
        {action(t("research.ui.edit"), () => onEdit({ section: "team" }))}
      </View>
      {!!team.goal && <Text numberOfLines={2} style={{ color: c.foreground, fontSize: 13 }}>{team.goal}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.memberCount", { count: team.members.length })}</Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.roleCount", { count: team.roles.length })}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 20 }}>{(["members", "prompts"] as const).map(id => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={{ paddingVertical: 9, borderBottomWidth: 2, borderColor: tab === id ? c.accent : "transparent" }}><Text style={{ color: tab === id ? c.foreground : c.foregroundMuted, fontWeight: "600", fontSize: 13 }}>{t(id === "members" ? "research.members" : "research.ui.rolesAndPrompts")}</Text></Pressable>)}</View>
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {data.errors.map(error => <Text key={error} style={{ color: c.statusDanger }}>{error}</Text>)}
      {tab === "members" ? team.members.map(member => {
        const role = team.roles.find(role => role.id === member.roleId)!;
        const profile = data.profiles.find(profile => profile.id === data.bindings[member.id]);
        const state = data.members.find(state => state.id === member.id);
        return <View key={member.id} style={[card, member.id === team.orchestratorMemberId ? s.orchestratorCard : null]}>
          <View style={{ flexDirection: layout.compact ? "column" : "row", alignItems: layout.compact ? "stretch" : "center", gap: 10 }}>
            <View style={{ flex: 1, gap: 5 }}>
              <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 14 }}>{member.name ?? member.id}</Text>
                {member.id === team.orchestratorMemberId && <Text style={{ color: c.accent, fontSize: 11 }}>{t("orchestrator")}</Text>}
                {state?.pending && <Text style={{ color: c.statusWarning, fontSize: 11 }}>{t("research.ui.pending")}</Text>}
              </View>
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{role.name} · {profile?.name ?? member.launchSnapshot.provider}</Text>
              <SettingsLine settings={member.launchSnapshot} saved colors={c} />
              <CurrentMemberSettings state={state} colors={c} />
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {state?.agentId && navigation && action(t("research.history.openConversation"), () => navigation.openAgent({ agentId: state.agentId! }))}
              {action(t("research.ui.editMember"), () => onEdit({ section: "members", memberId: member.id }))}
            </View>
          </View>
          {state?.error && <Text style={{ color: c.statusDanger, fontSize: 12 }}>{state.error}</Text>}
        </View>;
      }) : <>
        <View style={card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: c.foreground, fontWeight: "600", flex: 1 }}>{t("research.ui.commonPromptFiles")}</Text>{action(t("research.ui.edit"), () => onEdit({ section: "team" }))}</View>
          {commonPromptFiles.length ? commonPromptFiles.map(path => <Text key={path} selectable style={{ color: c.foregroundMuted, fontSize: 12 }}>{path}</Text>) : <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.noCommonPrompts")}</Text>}
        </View>
        {team.roles.map(role => <View key={role.id} style={card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.foreground, fontWeight: "600" }}>{role.name}</Text><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.ui.memberCount", { count: team.members.filter(member => member.roleId === role.id).length })}</Text></View>
            {action(t("research.ui.editRole"), () => onEdit({ section: "roles", roleId: role.id }))}
          </View>
          {role.promptFiles.map(path => <Text key={path} selectable style={{ color: c.foregroundMuted, fontSize: 12 }}>{path}</Text>)}
        </View>)}
        {data.file && <View style={{ paddingVertical: 8, gap: 4 }}><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.ui.teamDefinition")}</Text><Text selectable style={{ color: c.foregroundMuted, fontSize: 12 }}>{data.file}</Text></View>}
      </>}
    </ScrollView>
  </View>;
}
