import { fitMemberGraph, MEMBER_CARD_HEIGHT, MEMBER_CARD_WIDTH, memberCommunicationGraph } from "../shared/member-graph";
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { researchApplyRpc, researchReadRpc, researchResetRpc } from "../shared/research-rpc";
import { canonical, launchFromProfile, messageEdges, ResearchTeamSchema, type ResearchTeam } from "../shared/research-team";
import { messages } from "./i18n";
import { teamHistory, type HistoryFilter } from "../shared/team-history";
import { TeamTimeline } from "./TeamTimeline";
import { useTeamHistory } from "./useTeamHistory";
import { CurrentMemberSettings, SettingsLine } from "./MemberSettings";
import { MemberConnectionCounts, MemberConnectionPaths } from "./MemberConnections";
import { TeamConfigTransfer } from "./TeamConfigTransfer";
import { PromptFilePicker } from "./PromptFilePicker";
import { TeamAction } from "./TeamControls";
import { MemberLaunchEditor } from "./MemberLaunchEditor";
import { GitTeamImport } from "./GitTeamImport";

function nextId(prefix: string, used: string[]) { let n = 1; while (used.includes(`${prefix}-${n}`)) n++; return `${prefix}-${n}`; }
type Target = { workspaceId: string } | { projectId: string };
type Surface = Pick<PluginWorkspacePanelProps, "theme" | "layout" | "navigation">;
type State = RpcOutput<typeof researchReadRpc>;
type Applied = RpcOutput<typeof researchApplyRpc>;
function PromptFilesInput({ label, files, onChange, colors, target }: { label: string; files: string[]; onChange(files: string[]): void; colors: Surface["theme"]["colors"]; target: Target }) {
  const [value, setValue] = useState(files.join(", "));
  const own = useRef(JSON.stringify(files));
  const key = JSON.stringify(files);
  useEffect(() => { if (key !== own.current) { own.current = key; setValue(files.join(", ")); } }, [key]);
  return <View style={{ gap: 6 }}><Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" }}>{label}</Text>
    <PromptFilePicker target={target} selected={files} onChange={onChange} colors={colors} input={<TextInput accessibilityLabel={label} value={value}
      onChangeText={text => { const next = text.split(/[,\n]/).map(path => path.trim()).filter(Boolean); own.current = JSON.stringify(next); setValue(text); onChange(next); }}
      style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 10, fontSize: 13, color: colors.foreground, backgroundColor: colors.surface0 }} />} /></View>;

}
export function useResearch(target: Target) {
  const read = useRpc(researchReadRpc);
  const paseo = usePaseo();
  const query = useQuery({ queryKey: ["research", target], queryFn: () => read(target), refetchInterval: 5000 });
  useEffect(() => { let timer: ReturnType<typeof setTimeout> | undefined; const off = paseo.agents.subscribe(() => {
    if (!timer) timer = setTimeout(() => { timer = undefined; void query.refetch(); }, 1000);
  }); return () => { off(); if (timer) clearTimeout(timer); }; }, [paseo, JSON.stringify(target)]);
  return query;
}

export function ResearchGraph({ data, theme, navigation, openConfiguration }: Surface & { data: State; openConfiguration?(): void }) {
  const { t } = useTranslation(messages);
  const c = theme.colors;
  const [tab, setTab] = useState<"overview" | "timeline">("overview");
  const [contentWidth, setContentWidth] = useState(0);
  const [graphViewportWidth, setGraphViewportWidth] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>({ kind: "message" });
  const activeIds = new Set(data.members.flatMap(member => member.agentId ? [member.agentId] : []));
  const sources = [...new Set([...Object.keys(data.identities), ...activeIds])].sort().map(agentId => ({ agentId, live: activeIds.has(agentId) }));
  const history = useTeamHistory(sources);
  const pages = history.pages.filter(page => activeIds.has(page.recipient));
  const team = data.team;
  if (!team) return null;
  const events = teamHistory(history.pages, new Map(Object.entries(data.identities)));
  const edges = messageEdges(pages, new Map(Object.entries(data.identities)));
  const selectedEdge = (from: string, to: string) => (!historyFilter.from || historyFilter.from === from) && (!historyFilter.to || historyFilter.to === to) && (!historyFilter.member || historyFilter.member === from || historyFilter.member === to);
  const focused = !!(historyFilter.from || historyFilter.to || historyFilter.member);
  const selectEdge = (from: string, to: string) => { setHistoryFilter({ from, to, kind: "message" }); setTab("timeline"); };
  const memberName = (id: string) => team.members.find(member => member.id === id)?.name ?? id;
  const lead = team.members.find(member => member.id === team.orchestratorMemberId)!;
  const graph = memberCommunicationGraph(team.members.map(member => member.id), lead.id, edges);
  const fittedGraph = fitMemberGraph(graph, graphViewportWidth);
  const leadState = data.members.find(member => member.id === lead.id);
  const working = data.members.filter(member => member.status === "running" || member.status === "initializing").length;
  const attention = data.members.filter(member => member.status === "attention" || member.status === "error" || member.error).length;
  const pending = data.members.filter(member => member.pending).length;
  const recent = events.filter(event => event.kind === "message").slice(-5).reverse();
  const wide = contentWidth >= 1040;
  const requests = new Map(pages.map(page => {
    const entries = page.entries as { item?: { type?: string; text?: string; agentMessage?: { event?: string; text?: string } } }[];
    const latest = [...entries].reverse().find(entry => entry.item?.type === "user_message" || entry.item?.agentMessage?.event === "message");
    return [page.recipient, latest?.item?.text ?? latest?.item?.agentMessage?.text ?? ""];
  }));
  const statusKeys = { missing: "research.status.missing", initializing: "research.status.initializing", idle: "research.status.idle", running: "research.status.running", closed: "research.status.closed", error: "research.status.error", attention: "research.status.attention" } as const;
  const node = (member: ResearchTeam["members"][number]) => {
    const state = data.members.find(entry => entry.id === member.id);
    const current = state?.sessionSettings;
    const thinking = current?.effectiveThinkingOptionId ?? current?.thinkingOptionId;
    return <Pressable key={member.id} disabled={!state?.agentId || !navigation} onPress={() => state?.agentId && navigation?.openAgent({ agentId: state.agentId })}
      accessibilityRole="button" accessibilityLabel={t("research.openMember", { member: member.name ?? member.id })}
      style={{ borderWidth: 1, borderColor: member.id === team.orchestratorMemberId || [historyFilter.from, historyFilter.to, historyFilter.member].includes(member.id) ? c.accent : c.border, borderLeftWidth: member.id === team.orchestratorMemberId ? 5 : 1, borderRadius: 8, padding: 10, width: MEMBER_CARD_WIDTH, height: MEMBER_CARD_HEIGHT, overflow: "hidden", backgroundColor: c.surface1, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontWeight: "600", flex: 1 }}>{member.name ?? member.id}</Text>
        <Text style={{ color: state?.status === "error" ? c.statusDanger : state?.status === "attention" ? c.statusWarning : state?.status === "running" ? c.accent : c.foregroundMuted, fontSize: 10 }}>{t(statusKeys[(state?.status ?? "missing") as keyof typeof statusKeys] ?? statusKeys.error)}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11 }}>{member.id === lead.id ? t("orchestrator") : team.roles.find(role => role.id === member.roleId)?.name} · {current?.provider ?? member.launchSnapshot.provider}</Text>
      <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 11 }}>{current ? `${current.model ?? t("research.ui.notReported")} · ${t("research.ui.thinkingLevel")}: ${thinking ?? t("research.ui.notReported")}` : `${t("research.ui.savedSettings")}: ${member.launchSnapshot.model}`}</Text>
      {state?.settingsChanged && <Text numberOfLines={1} style={{ color: c.statusWarning, fontSize: 10 }}>{t("research.ui.settingsChanged")}</Text>}
      {state?.pending ? <Text numberOfLines={1} style={{ color: c.accent, fontSize: 11 }}>{t("research.ui.pending")}</Text> : state?.error ? <Text numberOfLines={state.settingsChanged ? 1 : 2} style={{ color: c.statusDanger, fontSize: 11 }}>{state.error}</Text> : !state?.settingsChanged && state?.agentId && requests.get(state.agentId) ? <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 11 }}>{requests.get(state.agentId)}</Text> : null}
    </Pressable>;
  };
  return <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 8, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 160, gap: 4 }}><Text style={{ color: c.foreground, fontSize: 18, fontWeight: "700" }}>{t("research.ui.activity")}</Text><Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{team.workspace}</Text></View>
        <Pressable accessibilityRole="button" disabled={!leadState?.agentId || !navigation} onPress={() => leadState?.agentId && navigation?.openAgent({ agentId: leadState.agentId })} style={{ padding: 8, opacity: leadState?.agentId && navigation ? 1 : 0.5 }}><Text style={{ color: c.accent, fontSize: 12 }}>{t("research.ui.openCoordinator")}</Text></Pressable>
        {openConfiguration && <Pressable accessibilityRole="button" onPress={openConfiguration} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.openConfiguration")}</Text></Pressable>}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.memberCount", { count: team.members.length })}</Text>
        {!!working && <Text style={{ color: c.accent, fontSize: 12 }}>{t("research.ui.workingCount", { count: working })}</Text>}
        {!!attention && <Text style={{ color: c.statusWarning, fontSize: 12 }}>{t("research.ui.attentionCount", { count: attention })}</Text>}
        {!!pending && <Text style={{ color: c.accent, fontSize: 12 }}>{t("research.ui.pendingCount", { count: pending })}</Text>}
      </View>
      <View style={{ flexDirection: "row", gap: 20 }}>{(["overview", "timeline"] as const).map(id => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: tab === id }} onPress={() => setTab(id)} style={{ paddingVertical: 9, borderBottomWidth: 2, borderColor: tab === id ? c.accent : "transparent" }}><Text style={{ color: tab === id ? c.foreground : c.foregroundMuted, fontWeight: "600", fontSize: 13 }}>{t(id === "overview" ? "research.ui.overview" : "research.ui.timeline")}</Text></Pressable>)}</View>
    </View>
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
    {data.errors.map(message => <Text key={message} style={{ color: c.statusDanger }}>{message}</Text>)}
    {tab === "overview" ? <View onLayout={event => setContentWidth(Math.round(event.nativeEvent.layout.width))} style={{ width: "100%", minWidth: 0, flexDirection: wide ? "row" : "column", gap: 16, alignItems: "flex-start" }}>
    <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : "100%", minWidth: 0, maxWidth: "100%", overflow: "hidden", gap: 8 }}>
    <Text style={{ color: c.foreground, fontWeight: "600", fontSize: 14 }}>{t("research.graph")}</Text>
    <View onLayout={event => setGraphViewportWidth(Math.floor(event.nativeEvent.layout.width))} style={{ width: "100%", minWidth: 0, overflow: "hidden" }}>
      <View style={{ width: fittedGraph.width, height: fittedGraph.height, alignSelf: "center" }}>
      <View style={{ position: "absolute", left: fittedGraph.left, top: fittedGraph.top, width: graph.width, height: graph.height, backgroundColor: c.surface0, transform: [{ scale: fittedGraph.scale }] }}>
        <MemberConnectionPaths connections={graph.connections} colors={c} selected={edge => selectedEdge(edge.from, edge.to)} focused={focused} />
        {team.members.map(member => { const pos = graph.nodes.get(member.id)!; return <View key={member.id} style={{ position: "absolute", left: pos.x, top: pos.y }}>{node(member)}</View>; })}
        <MemberConnectionCounts connections={graph.connections} colors={c} selected={edge => selectedEdge(edge.from, edge.to)} focused={focused}
          onSelect={edge => selectEdge(edge.from, edge.to)} label={edge => `${t("research.history.filterDirection", { from: memberName(edge.from), to: memberName(edge.to) })} (${edge.count})`} />
      </View>
      </View>
    </View>
    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.ui.graphHint")}</Text>
    </View>
    <View style={{ width: wide ? 340 : "100%", flexShrink: 0, borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, gap: 10, backgroundColor: c.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: c.foreground, fontWeight: "600", flex: 1 }}>{t("research.ui.recent")}</Text><Pressable accessibilityRole="button" onPress={() => { setHistoryFilter({ kind: "message" }); setTab("timeline"); }}><Text style={{ color: c.accent, fontSize: 12 }}>{t("research.ui.viewHistory")}</Text></Pressable></View>
      {recent.map(event => <Pressable key={event.id} accessibilityRole="button" onPress={() => selectEdge(event.from, event.to!)} style={{ paddingVertical: 8, gap: 5, borderBottomWidth: 1, borderColor: c.border }}>
        <View style={{ flexDirection: "row", gap: 8 }}><Text numberOfLines={1} style={{ color: c.accent, fontSize: 12, flex: 1 }}>{memberName(event.from)} → {memberName(event.to!)}</Text><Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{event.timestamp === null ? "" : new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text></View>
        <Text numberOfLines={2} style={{ color: c.foreground, fontSize: 12 }}>{event.text}</Text>
      </Pressable>)}
      {!recent.length && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.noMessages")}</Text>}
    </View>
    </View> : <TeamTimeline key={`${data.project.id}:${team.id}:${data.workspace}`} events={events} members={team.members} activeIds={activeIds} filter={historyFilter} onFilterChange={setHistoryFilter} theme={theme} navigation={navigation} />}
    {history.loading && <Text style={{ color: c.foregroundMuted }}>{t("research.history.loading")}</Text>}
    {Object.entries(history.errors).map(([agentId, error]) => <Text key={agentId} style={{ color: c.statusDanger }}>{memberName(data.identities[agentId] ?? agentId)}: {error}</Text>)}
    {!!Object.keys(history.errors).length && <Pressable accessibilityRole="button" onPress={history.retry}><Text style={{ color: c.accent }}>{t("research.retryMessages")}</Text></Pressable>}
    </ScrollView>
  </View>;
}

export function ResearchTeamEditor({ target, onBack, onApplied, openDashboard, ...surface }: Surface & { target: Target; onBack?(): void; onApplied?(result: Applied): void; openDashboard?(): void }) {
  const { t } = useTranslation(messages);
  const c = surface.theme.colors;
  const query = useResearch(target);
  const apply = useRpc(researchApplyRpc);
  const reset = useRpc(researchResetRpc);
  const cache = useQueryClient();
  const [draft, setDraft] = useState<ResearchTeam | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [profilePicker, setProfilePicker] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [section, setSection] = useState<"team" | "roles" | "members">("team");
  const [openRole, setOpenRole] = useState<number | null>(null);
  const [openMember, setOpenMember] = useState<number | null>(null);
  const [transferring, setTransferring] = useState(false);
  const data = query.data;
  useEffect(() => setSaved(false), [draft]);
  useEffect(() => {
    if (!data?.team || draft) return;
    setDraft(data.team);
    setBindings(data.bindings);
  }, [data, draft]);
  const refresh = async () => { await query.refetch(); void cache.invalidateQueries({ queryKey: ["workspace-agents"] }); void cache.invalidateQueries({ queryKey: ["dashboard"] }); };
  const save = useMutation({ mutationFn: () => apply({ ...target, team: draft!, bindings }), onSuccess: async result => { setSaved(true); await refresh(); onApplied?.(result); } });
  const restart = useMutation({ mutationFn: (memberId: string) => reset({ workspaceId: "workspaceId" in target ? target.workspaceId : save.data!.workspaceId, memberId }), onSuccess: () => { setResetId(null); refresh(); } });
  const discard = () => {
    setDraft(null); setOpenRole(null); setOpenMember(null); setProfilePicker(null); setResetId(null);
    setSection("team");
    save.reset(); restart.reset();
  };
  const reload = useMutation({ mutationFn: async () => {
    const result = await query.refetch();
    if (result.error) throw result.error;
    if (result.data?.errors.length && !result.data.team) throw new Error(result.data.errors.join("\n"));
    return result.data;
  }, onSuccess: fresh => { discard(); setDraft(fresh?.team ?? null); setBindings(fresh?.bindings ?? {}); void cache.invalidateQueries({ queryKey: ["workspace-agents"] }); } });
  const card = { borderWidth: 1, borderColor: c.border, borderRadius: 12, padding: 18, gap: 14, backgroundColor: c.surface1 };
  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 10, fontSize: 13, color: c.foreground, backgroundColor: c.surface0 };
  const button = (label: string, action: () => void, disabled = false, icon = "Plus", iconOnly = false, primary = false, danger = false) => <TeamAction label={label} onPress={action} disabled={disabled} icon={icon} iconOnly={iconOnly} primary={primary} danger={danger} colors={c} />;
  const field = (label: string, value: string, change: (value: string) => void, editable = true) => <View style={{ gap: 6 }}><Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "500" }}>{label}</Text><TextInput accessibilityLabel={label} editable={editable} value={value} onChangeText={change} style={input} /></View>;
  if (!data) return <Text style={{ color: query.error ? c.statusDanger : c.foregroundMuted }}>{query.error ? String(query.error) : t("loading")}</Text>;
  if (!draft) {
    if (data.team) return <Text style={{ color: c.foregroundMuted }}>{t("loading")}</Text>;
    return <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: surface.layout.compact ? 16 : 28, gap: 20 }}>
      <View style={{ width: "100%", maxWidth: 620, alignSelf: "center", gap: 18, paddingTop: 30 }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: c.surface2, alignItems: "center", justifyContent: "center" }}><Icon name="Users" size={24} color={c.accent} /></View>
        <View style={{ gap: 6 }}><Text style={{ color: c.foreground, fontSize: 24, fontWeight: "600" }}>{t("research.create")}</Text><Text selectable numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{data.project.root}</Text></View>
        {data.errors.map(error => <Text key={error} style={{ color: c.statusDanger }}>{error}</Text>)}
        <Text style={{ color: c.foregroundMuted, fontSize: 13, lineHeight: 20 }}>{t("research.setup.createHint")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          {button(t("research.setup.createConfiguration"), () => {
            discard(); reload.reset(); setBindings({});
            setDraft({ version: 2, id: "research-team", workspace: data.workspace ?? "research", goal: "", commonPromptFiles: [], roles: [], members: [], orchestratorMemberId: "" });
          }, reload.isPending || transferring, "Plus", false, true)}
          {"workspaceId" in target && <TeamConfigTransfer workspaceId={target.workspaceId} hasFile={!!data.file} fileName={data.file ?? "team.yaml"} disabled={reload.isPending} theme={surface.theme} onLoaded={() => reload.mutateAsync()} onBusyChange={setTransferring} />}
        <GitTeamImport target={target} theme={surface.theme} disabled={reload.isPending || transferring} onBusyChange={setTransferring} onImported={async result => { await reload.mutateAsync(); if ("projectId" in target) setDraft(ResearchTeamSchema.parse(result.team)); }} />
        </View>
        {reload.error && <Text style={{ color: c.statusDanger }}>{String(reload.error)}</Text>}
        {onBack && button(t("review.cancel"), onBack, false, "ArrowLeft", true)}
      </View>
    </ScrollView>;
  }
  const parsed = ResearchTeamSchema.safeParse(draft);
  const needsLaunchSettings = draft.members.some(member => !member.launchSnapshot.provider || !member.launchSnapshot.model);
  return <View style={{ flex: 1, backgroundColor: c.surface0 }}>
    <View style={{ paddingHorizontal: surface.layout.compact ? 12 : 20, paddingTop: 14, paddingBottom: 12, gap: 14, borderBottomWidth: 1, borderColor: c.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <Text style={{ color: c.foreground, fontSize: 20, fontWeight: "600", flex: 1, minWidth: 140 }}>{t(data.team ? "research.ui.configuration" : "research.create")}</Text>
        {openDashboard && data.team && button(t("research.ui.openDashboard"), openDashboard, false, "Network", true)}
      {"workspaceId" in target && <TeamConfigTransfer workspaceId={target.workspaceId} hasFile={!!data.file} fileName={data.file ?? "team.yaml"} disabled={save.isPending || restart.isPending || reload.isPending} theme={surface.theme} onLoaded={() => reload.mutateAsync()} onBusyChange={setTransferring} />}
        <GitTeamImport target={target} workspaceName={draft.workspace} theme={surface.theme} disabled={save.isPending || restart.isPending || reload.isPending || transferring} onBusyChange={setTransferring} onImported={async result => { await reload.mutateAsync(); if ("projectId" in target) setDraft(ResearchTeamSchema.parse(result.team)); }} />
        {button(t("research.ui.reloadFile"), () => reload.mutate(), save.isPending || restart.isPending || reload.isPending || transferring, "RotateCw", true)}
        {button(t("review.cancel"), discard, save.isPending || restart.isPending || reload.isPending || transferring, "X", true)}
        {button(t("review.apply"), () => { setSaved(false); save.mutate(); }, !parsed.success || save.isPending || restart.isPending || reload.isPending || transferring, "Check", false, true)}
      </View>
      <View style={{ flexDirection: "row", alignSelf: "flex-start", padding: 3, gap: 3, borderRadius: 10, backgroundColor: c.surface1 }}>{(["team", "roles", "members"] as const).map(id => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: section === id }} onPress={() => setSection(id)} style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 7, backgroundColor: section === id ? c.surface2 : "transparent" }}><Text style={{ color: section === id ? c.foreground : c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>{t(id === "team" ? "research.ui.general" : id === "roles" ? "research.roles" : "research.members")}</Text>{id !== "team" && <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{id === "roles" ? draft.roles.length : draft.members.length}</Text>}</Pressable>)}</View>
    </View>
    <ScrollView contentContainerStyle={{ padding: surface.layout.compact ? 12 : 20, gap: 14, width: "100%", maxWidth: 980, alignSelf: "center" }}>
    {section !== "members" && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.promptHint")}</Text>}
    {data.errors.map(error => <Text key={error} style={{ color: c.statusDanger }}>{error}</Text>)}
    {section === "team" && <View style={card}>
      {field(t("research.teamId"), draft.id, id => setDraft({ ...draft, id }), !data.team)}
      {field(t("role.workspace"), draft.workspace, workspace => setDraft({ ...draft, workspace }), !data.workspace && !data.team)}
      {field(t("research.goal"), draft.goal, goal => setDraft({ ...draft, goal }))}
      <PromptFilesInput target={target} label={t("research.commonPrompts")} files={draft.commonPromptFiles} colors={c} onChange={commonPromptFiles => setDraft({ ...draft, commonPromptFiles })} />
      {data.file && <Text selectable style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.ui.teamDefinition")}: {data.file}</Text>}
      {data.file && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.ui.fileHint")}</Text>}
    </View>}
    {section === "roles" && <>
    {!draft.roles.length && <View style={{ ...card, alignItems: "center", paddingVertical: 30 }}><Icon name="Layers" size={24} color={c.foregroundMuted} /><Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{t("research.ui.emptyRoles")}</Text></View>}
    {draft.roles.map((role, index) => <View key={index} style={card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: openRole === index }} onPress={() => setOpenRole(openRole === index ? null : index)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.foreground, fontWeight: "600" }}>{role.name || role.id}</Text><Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{role.promptFiles.join(", ") || t("research.rolePrompts")}</Text></View><Text style={{ color: c.foregroundMuted }}>{openRole === index ? "▾" : "▸"}</Text>
      </Pressable>
      {openRole === index && <View style={{ gap: 10, paddingTop: 6 }}>
      {field(t("research.roleId"), role.id, id => setDraft({ ...draft, roles: draft.roles.map((r, i) => i === index ? { ...r, id } : r), members: draft.members.map(m => m.roleId === role.id ? { ...m, roleId: id } : m) }))}
      {field(t("role.name"), role.name, name => setDraft({ ...draft, roles: draft.roles.map((r, i) => i === index ? { ...r, name } : r) }))}
      <PromptFilesInput target={target} label={t("research.rolePrompts")} files={role.promptFiles} colors={c} onChange={promptFiles => setDraft({ ...draft, roles: draft.roles.map((r, i) => i === index ? { ...r, promptFiles } : r) })} />
      {button(t("role.remove"), () => { setOpenRole(null); setDraft({ ...draft, roles: draft.roles.filter((_, i) => i !== index) }); }, false, "Trash2", true, false, true)}
      </View>}
    </View>)}
    {button(t("review.addRole"), () => { setOpenRole(draft.roles.length); setDraft({ ...draft, roles: [...draft.roles, { id: nextId("role", draft.roles.map(role => role.id)), name: "", promptFiles: [] }] }); })}
    </>}
    {section === "members" && <>
    {!draft.members.length && <View style={{ ...card, alignItems: "center", paddingVertical: 30 }}><Icon name="Users" size={24} color={c.foregroundMuted} /><Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{t("research.ui.emptyMembers")}</Text></View>}
    {draft.members.map((member, index) => <View key={index} style={card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: openMember === index }} onPress={() => { setOpenMember(openMember === index ? null : index); setProfilePicker(null); }} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.foreground, fontWeight: "600" }}>{member.name ?? member.id}{member.id === draft.orchestratorMemberId ? ` · ${t("orchestrator")}` : ""}</Text><Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>{draft.roles.find(role => role.id === member.roleId)?.name} · {member.launchSnapshot.provider} / {member.launchSnapshot.model || t("research.selectProfile")}</Text></View><Text style={{ color: c.foregroundMuted }}>{openMember === index ? "▾" : "▸"}</Text>
      </Pressable>
      {openMember === index && <View style={{ gap: 10, paddingTop: 6 }}>
      {field(t("research.memberId"), member.id, id => { const next = { ...bindings, [id]: bindings[member.id] ?? "" }; delete next[member.id]; setBindings(next); setDraft({ ...draft, orchestratorMemberId: draft.orchestratorMemberId === member.id ? id : draft.orchestratorMemberId, members: draft.members.map((m, i) => i === index ? { ...m, id } : m) }); }, !data.team?.members.some(m => m.id === member.id))}
      {field(t("research.memberName"), member.name ?? member.id, name => setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, name } : m) }))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{draft.roles.map(role => <Pressable key={role.id} accessibilityRole="button" accessibilityState={{ selected: member.roleId === role.id }} onPress={() => setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, roleId: role.id } : m) })} style={{ paddingHorizontal: 11, paddingVertical: 7, borderRadius: 16, backgroundColor: member.roleId === role.id ? c.surface2 : c.surface0, borderWidth: 1, borderColor: member.roleId === role.id ? c.accent : c.border }}><Text style={{ color: member.roleId === role.id ? c.accent : c.foregroundMuted, fontSize: 12 }}>{role.name || role.id}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("research.selectProfile")} accessibilityState={{ expanded: profilePicker === member.id }} onPress={() => setProfilePicker(profilePicker === member.id ? null : member.id)} style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 10, backgroundColor: c.surface0 }}><Icon name="Settings2" size={15} color={c.foregroundMuted} /><Text style={{ flex: 1, color: c.foreground, fontSize: 13 }}>{data.profiles.find(profile => profile.id === bindings[member.id])?.name ?? t("research.selectProfile")}</Text><Icon name={profilePicker === member.id ? "ChevronUp" : "ChevronDown"} size={14} color={c.foregroundMuted} /></Pressable>
      {profilePicker === member.id && <View style={{ gap: 2, borderWidth: 1, borderColor: c.border, borderRadius: 9, padding: 4, backgroundColor: c.surface0 }}><Pressable accessibilityRole="button" onPress={() => { setBindings({ ...bindings, [member.id]: "" }); setProfilePicker(null); }} style={{ padding: 10 }}><Text style={{ color: c.foregroundMuted, fontSize: 13 }}>{t("research.launch.manual")}</Text></Pressable>{!data.profiles.length && <Text style={{ color: c.foregroundMuted }}>{t("research.noProfiles")}</Text>}{data.profiles.map(profile => <Pressable key={profile.id} accessibilityRole="button" onPress={() => { setBindings({ ...bindings, [member.id]: profile.id }); setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, launchSnapshot: launchFromProfile(profile) } : m) }); setProfilePicker(null); }} style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 6, backgroundColor: bindings[member.id] === profile.id ? c.surface2 : "transparent" }}><View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.foreground, fontSize: 13 }}>{profile.name}</Text><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{profile.provider}/{profile.model ?? "—"}</Text></View>{bindings[member.id] === profile.id && <Icon name="Check" size={14} color={c.accent} />}</Pressable>)}</View>}
      <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.launch.profileHint")}</Text>
      {data.profiles.some(profile => profile.id === bindings[member.id] && canonical(launchFromProfile(profile)) !== canonical(member.launchSnapshot)) && <Text style={{ color: c.accent, fontSize: 11 }}>{t("research.launch.customized")}</Text>}
      <MemberLaunchEditor key={member.id} value={member.launchSnapshot} cwd={data.project.root} colors={c} onChange={launchSnapshot => setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, launchSnapshot } : m) })} />
      <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.launch.sessionHint")}</Text>
      {data.team?.members.filter(saved => saved.id === member.id).map(saved => <SettingsLine key={saved.id} settings={saved.launchSnapshot} saved colors={c} />)}
      <CurrentMemberSettings state={data.members.find(state => state.id === member.id)} colors={c} />
      {(() => { const state = data.members.find(m => m.id === member.id); return <>
        {state?.pending && <Text style={{ color: c.statusWarning, fontSize: 11 }}>{t("research.ui.pending")}</Text>}
        {state?.error && <Text style={{ color: c.statusDanger, fontSize: 12 }}>{state.error}</Text>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, borderTopWidth: 1, borderColor: c.border, paddingTop: 8 }}>
          <TeamAction label={t("research.coordinator")} icon="Crown" iconOnly selected={draft.orchestratorMemberId === member.id} colors={c} onPress={() => setDraft({ ...draft, orchestratorMemberId: member.id })} />
          {state?.agentId && surface.navigation && button(t("research.history.openConversation"), () => surface.navigation?.openAgent({ agentId: state.agentId! }), false, "MessageSquare", true)}
          {state && button(t("research.resetMember"), () => setResetId(member.id), restart.isPending || transferring, "RotateCcw", true)}
          <View style={{ flex: 1 }} />
          {button(t("role.remove"), () => { setOpenMember(null); setDraft({ ...draft, members: draft.members.filter((_, i) => i !== index) }); }, false, "Trash2", true, false, true)}
        </View>
      </>; })()}
      {resetId === member.id && <View style={{ gap: 6 }}><Text style={{ color: c.foreground }}>{t("research.resetHint")}</Text>{button(t("current.restartConfirm"), () => restart.mutate(member.id), restart.isPending || transferring, "RotateCcw", false, false, true)}{button(t("review.cancel"), () => setResetId(null), false, "X", true)}</View>}
      </View>}
    </View>)}
    {button(t("research.addMember"), () => { setOpenMember(draft.members.length); setDraft({ ...draft, members: [...draft.members, { id: nextId("member", draft.members.map(member => member.id)), roleId: draft.roles[0]?.id ?? "", launchSnapshot: { provider: "", model: "" } }] }); })}
    </>}
    {!parsed.success && <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t(needsLaunchSettings ? "research.ui.chooseProfiles" : "research.ui.requiredSettings")}</Text>}
    {save.isPending && <Text style={{ color: c.foregroundMuted }}>{t("research.applying")}</Text>}
    {saved && <Text style={{ color: c.statusSuccess }}>{t("research.saved")}</Text>}
    {(save.error || restart.error || reload.error) && <Text style={{ color: c.statusDanger }}>{String(save.error ?? restart.error ?? reload.error)}</Text>}
    </ScrollView>
  </View>;
}
