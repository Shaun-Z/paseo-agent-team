import { graphLine, memberGraph } from "../shared/member-graph";
import type { RpcOutput } from "@getpaseo/plugin";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { usePaseo, useRpc, useTranslation } from "@getpaseo/plugin/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { researchApplyRpc, researchReadRpc, researchResetRpc } from "../shared/research-rpc";
import { launchFromProfile, messageEdges, ResearchTeamSchema, researchFromLegacy, type ResearchTeam } from "../shared/research-team";
import { messages } from "./i18n";
import { teamHistory, type HistoryFilter } from "../shared/team-history";
import { TeamTimeline } from "./TeamTimeline";
import { useTeamHistory } from "./useTeamHistory";

function nextId(prefix: string, used: string[]) { let n = 1; while (used.includes(`${prefix}-${n}`)) n++; return `${prefix}-${n}`; }
type Target = { workspaceId: string } | { projectId: string };
type Surface = Pick<PluginWorkspacePanelProps, "theme" | "layout" | "navigation">;
type State = RpcOutput<typeof researchReadRpc>;
function PromptFilesInput({ label, files, onChange, colors }: { label: string; files: string[]; onChange(files: string[]): void; colors: Surface["theme"]["colors"] }) {
  const [value, setValue] = useState(files.join(", "));
  const own = useRef(JSON.stringify(files));
  const key = JSON.stringify(files);
  useEffect(() => { if (key !== own.current) { own.current = key; setValue(files.join(", ")); } }, [key]);
  return <View style={{ gap: 4 }}><Text style={{ color: colors.foregroundMuted }}>{label}</Text><TextInput accessibilityLabel={label} value={value}
    onChangeText={text => { const next = text.split(/[,\n]/).map(path => path.trim()).filter(Boolean); own.current = JSON.stringify(next); setValue(text); onChange(next); }}
    style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 8, color: colors.foreground, backgroundColor: colors.surface0 }} /></View>;
}
function useResearch(target: Target) {
  const read = useRpc(researchReadRpc);
  const paseo = usePaseo();
  const query = useQuery({ queryKey: ["research", target], queryFn: () => read(target), refetchInterval: 5000 });
  useEffect(() => { let timer: ReturnType<typeof setTimeout> | undefined; const off = paseo.agents.subscribe(() => {
    if (!timer) timer = setTimeout(() => { timer = undefined; void query.refetch(); }, 1000);
  }); return () => { off(); if (timer) clearTimeout(timer); }; }, [paseo, JSON.stringify(target)]);
  return query;
}
export function ResearchGraph({ data, theme, navigation }: Surface & { data: State }) {
  const { t } = useTranslation(messages);
  const c = theme.colors;
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>({});
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
  const selectEdge = (from: string, to: string) => setHistoryFilter({ from, to, kind: "message" });
  const memberName = (id: string) => team.members.find(member => member.id === id)?.name ?? id;
  const lead = team.members.find(member => member.id === team.orchestratorMemberId)!;
  const graph = memberGraph(team.members.map(member => member.id), lead.id);
  const requests = new Map(pages.map(page => {
    const entries = page.entries as { item?: { type?: string; text?: string; agentMessage?: { event?: string; text?: string } } }[];
    const latest = [...entries].reverse().find(entry => entry.item?.type === "user_message" || entry.item?.agentMessage?.event === "message");
    return [page.recipient, latest?.item?.text ?? latest?.item?.agentMessage?.text ?? ""];
  }));
  const statusKeys = { missing: "research.status.missing", initializing: "research.status.initializing", idle: "research.status.idle", running: "research.status.running", closed: "research.status.closed", error: "research.status.error", attention: "research.status.attention" } as const;
  const node = (member: ResearchTeam["members"][number]) => {
    const state = data.members.find(entry => entry.id === member.id);
    return <Pressable key={member.id} disabled={!state?.agentId || !navigation} onPress={() => state?.agentId && navigation?.openAgent({ agentId: state.agentId })}
      accessibilityRole="button" accessibilityLabel={t("research.openMember", { member: member.name ?? member.id })}
      style={{ borderWidth: 1, borderColor: member.id === team.orchestratorMemberId || [historyFilter.from, historyFilter.to, historyFilter.member].includes(member.id) ? c.accent : c.border, borderRadius: 8, padding: 12, width: 260, height: 190, overflow: "hidden", backgroundColor: c.surface1, gap: 5 }}>
      <Text numberOfLines={1} style={{ color: c.foreground, fontWeight: "600" }}>{member.name ?? member.id}</Text>
      <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 12 }}>{team.roles.find(role => role.id === member.roleId)?.name} · {member.launchSnapshot.provider}/{member.launchSnapshot.model}</Text>
      <Text style={{ color: c.foregroundMuted }}>{t(statusKeys[(state?.status ?? "missing") as keyof typeof statusKeys] ?? statusKeys.error)}</Text>
      {state?.pending && <Text style={{ color: c.accent }}>{t("research.pending")}</Text>}
      {state?.agentId && requests.get(state.agentId) && <Text numberOfLines={2} style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.task")}: {requests.get(state.agentId)}</Text>}
      {state?.error && <Text numberOfLines={2} style={{ color: c.statusDanger }}>{state.error}</Text>}
    </Pressable>;
  };
  return <View style={{ padding: 16, gap: 12 }}>
    <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>{t("research.graph")}</Text>
    {data.errors.map(message => <Text key={message} style={{ color: c.statusDanger }}>{message}</Text>)}
    <Text style={{ color: c.foregroundMuted }}>{t("research.coordination")}</Text>
    <ScrollView horizontal>
      <View style={{ width: graph.width + (edges.length ? 40 + edges.length * 12 : 0), height: graph.height + 64, backgroundColor: c.surface0 }}>
        {[...team.members.filter(member => member.id !== lead.id).map(member => ({ from: lead.id, to: member.id, count: 0, lastText: "" })), ...edges].map((edge, index) => {
          const line = graphLine(graph.nodes.get(edge.from)!, graph.nodes.get(edge.to)!);
          if (!line) return null;
          const a = graph.nodes.get(edge.from)!, b = graph.nodes.get(edge.to)!;
          const peer = edge.count > 0 && edge.from !== lead.id && edge.to !== lead.id;
          const lane = graph.width + 20 + (index - team.members.length + 1) * 8;
          const belowA = a.y + a.height + 28 + index % 3 * 10, belowB = b.y + b.height + 28 + index % 3 * 10;
          const points = peer
            ? [{ x: a.x + a.width / 2, y: a.y + a.height }, { x: a.x + a.width / 2, y: belowA },
              ...(a.y === b.y ? [] : [{ x: lane, y: belowA }, { x: lane, y: belowB }]),
              { x: b.x + b.width / 2, y: belowB }, { x: b.x + b.width / 2, y: b.y + b.height }]
            : [{ x: line.x, y: line.y }, { x: line.endX, y: line.endY }];
          const last = points.at(-1)!, beforeLast = points.at(-2)!;
          const arrowAngle = Math.atan2(last.y - beforeLast.y, last.x - beforeLast.x) * 180 / Math.PI;
          const label = peer ? { x: (a.x + b.x + a.width) / 2, y: belowA } : { x: (line.x + line.endX) / 2, y: (line.y + line.endY) / 2 };
          const color = edge.count && (!focused || selectedEdge(edge.from, edge.to)) ? c.accent : c.border;
          return <View key={index} pointerEvents="box-none" style={{ position: "absolute", left: 0, top: 0, width: graph.width + 40 + edges.length * 12, height: graph.height + 64 }}>
            {points.slice(1).map((point, segment) => {
              const previous = points[segment]!, dx = point.x - previous.x, dy = point.y - previous.y;
              const length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx) * 180 / Math.PI;
              return <View key={segment} pointerEvents="none" style={{ position: "absolute", left: (previous.x + point.x) / 2 - length / 2, top: (previous.y + point.y) / 2, width: length, height: edge.count ? 2 : 1, backgroundColor: color, transform: [{ rotate: `${angle}deg` }] }} />;
            })}
            {edge.count > 0 && <>
              <View pointerEvents="none" style={{ position: "absolute", left: last.x - 5, top: last.y - 5, width: 10, height: 10, borderTopWidth: 2, borderRightWidth: 2, borderColor: color, transform: [{ rotate: `${arrowAngle + 45}deg` }] }} />
              <Pressable accessibilityRole="button" accessibilityLabel={t("research.history.filterDirection", { from: memberName(edge.from), to: memberName(edge.to) })} onPress={() => selectEdge(edge.from, edge.to)} style={{ position: "absolute", left: label.x, top: label.y - 24, padding: 6, backgroundColor: c.surface0 }}><Text style={{ color }}>{edge.count}</Text></Pressable>
            </>}
          </View>;
        })}
        {team.members.map(member => { const pos = graph.nodes.get(member.id)!; return <View key={member.id} style={{ position: "absolute", left: pos.x, top: pos.y }}>{node(member)}</View>; })}
      </View>
    </ScrollView>
    <Text style={{ color: c.foregroundMuted }}>{t("research.intervene")}</Text>
    <Text style={{ color: c.foreground, fontWeight: "600" }}>{t("research.communications")}</Text>
    {edges.map(edge => <Pressable key={`${edge.from}:${edge.to}`} accessibilityRole="button" accessibilityState={{ selected: focused && selectedEdge(edge.from, edge.to) }} onPress={() => selectEdge(edge.from, edge.to)} style={{ borderBottomWidth: 1, borderColor: c.border, paddingVertical: 6 }}>
      <Text style={{ color: c.accent }}>{memberName(edge.from)} → {memberName(edge.to)} · {t("research.messageCount", { count: edge.count })}</Text>
      <Text numberOfLines={3} style={{ color: c.foregroundMuted }}>{edge.lastText}</Text>
    </Pressable>)}
    {!edges.length && <Text style={{ color: c.foregroundMuted }}>{t("research.noMessages")}</Text>}
    {history.loading && <Text style={{ color: c.foregroundMuted }}>{t("research.history.loading")}</Text>}
    {Object.entries(history.errors).map(([agentId, error]) => <Text key={agentId} style={{ color: c.statusDanger }}>{memberName(data.identities[agentId] ?? agentId)}: {error}</Text>)}
    {!!Object.keys(history.errors).length && <Pressable accessibilityRole="button" onPress={history.retry}><Text style={{ color: c.accent }}>{t("research.retryMessages")}</Text></Pressable>}
    <TeamTimeline key={`${data.project.id}:${team.id}:${data.workspace}`} events={events} members={team.members} activeIds={activeIds} filter={historyFilter} onFilterChange={setHistoryFilter} theme={theme} navigation={navigation} />
  </View>;
}

export function ResearchTeamEditor({ target, onBack, onApplied, ...surface }: Surface & { target: Target; onBack?(): void; onApplied?(result: Extract<RpcOutput<typeof import("../shared/rpc").teamApplyRpc>, { ok: true }>): void }) {
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
  const data = query.data;
  useEffect(() => setSaved(false), [draft]);
  useEffect(() => {
    if (!data || draft) return;
    setDraft(data.team ?? (data.legacyTeam ? researchFromLegacy(data.legacyTeam) : { version: 2, id: "research-team", goal: "", workspace: data.workspace ?? "research", commonPromptFiles: ["prompts/research-team-common.md"], orchestratorMemberId: "anchor-main",
      roles: [{ id: "anchor", name: "Anchor", promptFiles: ["prompts/anchor.md"] }, { id: "programmer", name: "Programmer", promptFiles: ["prompts/programmer.md"] }, { id: "mathematician", name: "Mathematician", promptFiles: ["prompts/mathematician.md"] }],
      members: ["anchor", "programmer", "mathematician"].map(roleId => ({ id: `${roleId}-main`, roleId, launchSnapshot: { provider: "", model: "" } })) }));
    setBindings(data.bindings);
  }, [data, draft]);
  const refresh = () => { void query.refetch(); void cache.invalidateQueries({ queryKey: ["workspace-agents"] }); void cache.invalidateQueries({ queryKey: ["dashboard"] }); };
  const save = useMutation({ mutationFn: () => apply({ ...target, team: draft!, bindings, migrateLegacy: data?.legacy ?? false }), onSuccess: result => { setSaved(true); refresh(); onApplied?.({ ok: true, file: result.file, workspaces: [{ id: result.workspaceId, workspace: draft!.workspace, target: "orchestrator", created: false }], orchestratorAgentId: result.orchestratorAgentId, cleanup: [], permission: null }); } });
  const restart = useMutation({ mutationFn: (memberId: string) => reset({ workspaceId: "workspaceId" in target ? target.workspaceId : save.data!.workspaceId, memberId }), onSuccess: () => { setResetId(null); refresh(); } });
  const card = { borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, gap: 8, backgroundColor: c.surface1 };
  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8, color: c.foreground, backgroundColor: c.surface0 };
  const button = (label: string, action: () => void, disabled = false) => <Pressable disabled={disabled} onPress={action} accessibilityRole="button" style={{ borderWidth: 1, borderColor: c.border, padding: 8, borderRadius: 6, opacity: disabled ? 0.5 : 1 }}><Text style={{ color: c.accent }}>{label}</Text></Pressable>;
  const field = (label: string, value: string, change: (value: string) => void, editable = true) => <View style={{ gap: 4 }}><Text style={{ color: c.foregroundMuted }}>{label}</Text><TextInput accessibilityLabel={label} editable={editable} value={value} onChangeText={change} style={input} /></View>;
  if (!draft || !data) return <Text style={{ color: query.error ? c.statusDanger : c.foregroundMuted }}>{query.error ? String(query.error) : t("loading")}</Text>;
  const parsed = ResearchTeamSchema.safeParse(draft);
  const errors = parsed.success ? [] : parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
  return <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
    <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>{t("research.title")}</Text>
    {onBack && button(t("review.cancel"), onBack)}
    <Text style={{ color: c.foregroundMuted }}>{t("research.promptHint")}</Text>
    {data.errors.map(error => <Text key={error} style={{ color: c.statusDanger }}>{error}</Text>)}
    {data.legacy && <Text style={{ color: c.statusDanger }}>{t("research.legacyHint")}</Text>}
    <View style={card}>
      {field(t("research.teamId"), draft.id, id => setDraft({ ...draft, id }), !data.team)}
      {field(t("role.workspace"), draft.workspace, workspace => setDraft({ ...draft, workspace }), !data.workspace && !data.team)}
      {field(t("research.goal"), draft.goal, goal => setDraft({ ...draft, goal }))}
      <PromptFilesInput label={t("research.commonPrompts")} files={draft.commonPromptFiles} colors={c} onChange={commonPromptFiles => setDraft({ ...draft, commonPromptFiles })} />
    </View>
    <Text style={{ color: c.foreground, fontWeight: "600" }}>{t("research.roles")}</Text>
    {draft.roles.map((role, index) => <View key={index} style={card}>
      {field(t("research.roleId"), role.id, id => setDraft({ ...draft, roles: draft.roles.map((r, i) => i === index ? { ...r, id } : r), members: draft.members.map(m => m.roleId === role.id ? { ...m, roleId: id } : m) }))}
      {field(t("role.name"), role.name, name => setDraft({ ...draft, roles: draft.roles.map((r, i) => i === index ? { ...r, name } : r) }))}
      <PromptFilesInput label={t("research.rolePrompts")} files={role.promptFiles} colors={c} onChange={promptFiles => setDraft({ ...draft, roles: draft.roles.map((r, i) => i === index ? { ...r, promptFiles } : r) })} />
      {button(t("role.remove"), () => setDraft({ ...draft, roles: draft.roles.filter((_, i) => i !== index) }))}
    </View>)}
    {button(t("review.addRole"), () => setDraft({ ...draft, roles: [...draft.roles, { id: nextId("role", draft.roles.map(role => role.id)), name: "", promptFiles: [] }] }))}
    <Text style={{ color: c.foreground, fontWeight: "600" }}>{t("research.members")}</Text>
    {draft.members.map((member, index) => <View key={index} style={card}>
      {field(t("research.memberId"), member.id, id => { const next = { ...bindings, [id]: bindings[member.id] ?? "" }; delete next[member.id]; setBindings(next); setDraft({ ...draft, orchestratorMemberId: draft.orchestratorMemberId === member.id ? id : draft.orchestratorMemberId, members: draft.members.map((m, i) => i === index ? { ...m, id } : m) }); }, !data.team?.members.some(m => m.id === member.id))}
      {field(t("research.memberName"), member.name ?? member.id, name => setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, name } : m) }))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{draft.roles.map(role => <View key={role.id}>{button(`${member.roleId === role.id ? "● " : ""}${role.name || role.id}`, () => setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, roleId: role.id } : m) }))}</View>)}</View>
      {button(t("research.selectProfile"), () => setProfilePicker(profilePicker === member.id ? null : member.id))}
      {profilePicker === member.id && <View style={{ gap: 6 }}>{!data.profiles.length && <Text style={{ color: c.foregroundMuted }}>{t("research.noProfiles")}</Text>}{data.profiles.map(profile => <View key={profile.id}>{button(`${profile.name} · ${profile.provider}/${profile.model ?? "—"}`, () => { setBindings({ ...bindings, [member.id]: profile.id }); setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, launchSnapshot: launchFromProfile(profile) } : m) }); setProfilePicker(null); })}</View>)}</View>}
      <Text style={{ color: c.foregroundMuted }}>{data.profiles.find(p => p.id === bindings[member.id])?.name} · {member.launchSnapshot.provider}/{member.launchSnapshot.model}</Text>
      <Text selectable style={{ color: c.foregroundMuted }}>{JSON.stringify(member.launchSnapshot, null, 2)}</Text>
      {!data.profiles.find(profile => profile.id === bindings[member.id])?.model && field(t("role.model"), member.launchSnapshot.model, model => setDraft({ ...draft, members: draft.members.map((m, i) => i === index ? { ...m, launchSnapshot: { ...m.launchSnapshot, model } } : m) }))}
      {button(t("research.coordinator"), () => setDraft({ ...draft, orchestratorMemberId: member.id }), draft.orchestratorMemberId === member.id)}
      {button(t("role.remove"), () => setDraft({ ...draft, members: draft.members.filter((_, i) => i !== index) }))}
      {data.members.some(m => m.id === member.id) && button(t("research.resetMember"), () => setResetId(member.id), restart.isPending)}
      {resetId === member.id && <View style={{ gap: 6 }}><Text style={{ color: c.foreground }}>{t("research.resetHint")}</Text>{button(t("current.restartConfirm"), () => restart.mutate(member.id), restart.isPending)}{button(t("review.cancel"), () => setResetId(null))}</View>}
    </View>)}
    {button(t("research.addMember"), () => setDraft({ ...draft, members: [...draft.members, { id: nextId("member", draft.members.map(member => member.id)), roleId: draft.roles[0]?.id ?? "", launchSnapshot: { provider: "", model: "" } }] }))}
    {errors.map(error => <Text key={error} style={{ color: c.statusDanger }}>{error}</Text>)}
    {button(t("review.apply"), () => { setSaved(false); save.mutate(); }, !parsed.success || save.isPending || restart.isPending)}
    {save.isPending && <Text style={{ color: c.foregroundMuted }}>{t("research.applying")}</Text>}
    {saved && <Text style={{ color: c.statusSuccess }}>{t("research.saved")}</Text>}
    {(save.error || restart.error) && <Text style={{ color: c.statusDanger }}>{String(save.error ?? restart.error)}</Text>}
    {data.team && <ResearchGraph {...surface} data={data} />}
  </ScrollView>;
}
