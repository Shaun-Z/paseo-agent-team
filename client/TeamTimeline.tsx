import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { filterHistory, parseHistoryDate, USER_PARTICIPANT, type HistoryEvent, type HistoryFilter } from "../shared/team-history";
import { messages } from "./i18n";

type Props = Pick<PluginWorkspacePanelProps, "theme" | "navigation"> & {
  events: HistoryEvent[]; members: { id: string; name?: string }[]; activeIds: ReadonlySet<string>;
  filter: HistoryFilter; onFilterChange(filter: HistoryFilter): void;
};
const kinds = ["message", "user", "assistant", "tool", "event"] as const;
const kindKeys = { message: "research.history.memberMessages", user: "research.history.userInstructions", assistant: "research.history.replies", tool: "research.history.tools", event: "research.history.events" } as const;
const stateKeys = {
  running: "research.status.running", completed: "research.history.completed", failed: "research.history.failed", canceled: "research.history.canceled",
  finished: "research.history.completed", closed: "research.status.closed", errored: "research.status.error", "permission-required": "research.status.attention",
  error: "research.status.error", notification: "research.history.events",
} as const;

export function TeamTimeline({ events, members, activeIds, filter, onFilterChange, theme, navigation }: Props) {
  const { t } = useTranslation(messages);
  const c = theme.colors;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [since, setSince] = useState(""), [until, setUntil] = useState("");
  const [limit, setLimit] = useState(100);
  const [newestFirst, setNewestFirst] = useState(false);
  const lower = parseHistoryDate(since), upper = parseHistoryDate(until, true);
  const invalidDates = lower === null || upper === null || (lower !== undefined && upper !== undefined && lower > upper);
  const filtered = invalidDates ? [] : filterHistory(events, { ...filter, since: lower ?? undefined, until: upper ?? undefined });
  const ordered = newestFirst ? [...filtered].reverse() : filtered;
  const external = new Map(events.filter(event => event.from.startsWith("$agent:")).map(event => [event.from, event.fromName ?? t("research.history.externalAgent")]));
  const names = new Map([...members.map(member => [member.id, member.name ?? member.id] as const), [USER_PARTICIPANT, t("research.history.user")] as const, ...external]);
  const nameOf = (id: string) => names.get(id) ?? id;
  const participants = [...members.map(member => member.id), USER_PARTICIPANT, ...external.keys()];
  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8, color: c.foreground, backgroundColor: c.surface0, minWidth: 160, flexGrow: 1 };
  const filterKey = JSON.stringify(filter);
  useEffect(() => setLimit(100), [filterKey, since, until, newestFirst]);
  const chip = (label: string, selected: boolean, action: () => void, key = label) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} onPress={action}
    style={{ borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: c.surface0, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6 }}>
    <Text style={{ color: selected ? c.accent : c.foregroundMuted }}>{label}</Text>
  </Pressable>;
  const participantFilter = (label: string, field: "member" | "from" | "to", options: string[]) => <View style={{ gap: 6 }}>
    <Text style={{ color: c.foregroundMuted }}>{label}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {chip(t("research.history.all"), !filter[field], () => onFilterChange({ ...filter, [field]: undefined }), "all")}
      {options.map(id => chip(nameOf(id), filter[field] === id, () => onFilterChange({ ...filter, [field]: id }), id))}
    </View>
  </View>;
  const sessionButton = (agentId: string, label: string) => navigation && <Pressable accessibilityRole="button" onPress={() => navigation.openAgent({ agentId })} style={{ paddingVertical: 6 }}>
    <Text style={{ color: c.accent }}>{label}</Text>
  </Pressable>;
  return <View style={{ gap: 12 }}>
    <Text style={{ color: c.foreground, fontSize: 18, fontWeight: "600" }}>{t("research.history.title")}</Text>
    <Text style={{ color: c.foregroundMuted }}>{t("research.history.hint")}</Text>
    <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.history.timeHint")}</Text>
    {participantFilter(t("research.history.member"), "member", members.map(member => member.id))}
    {participantFilter(t("research.history.from"), "from", participants)}
    {participantFilter(t("research.history.to"), "to", members.map(member => member.id))}
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.foregroundMuted }}>{t("research.history.type")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {chip(t("research.history.all"), !filter.kind, () => onFilterChange({ ...filter, kind: undefined }), "all")}
        {kinds.map(kind => chip(t(kindKeys[kind]), filter.kind === kind, () => onFilterChange({ ...filter, kind }), kind))}
      </View>
    </View>
    <Text style={{ color: c.foregroundMuted }}>{t("research.history.localTime")}</Text>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <TextInput accessibilityLabel={t("research.history.since")} placeholder={t("research.history.since")} placeholderTextColor={c.foregroundMuted} value={since} onChangeText={setSince} style={input} />
      <TextInput accessibilityLabel={t("research.history.until")} placeholder={t("research.history.until")} placeholderTextColor={c.foregroundMuted} value={until} onChangeText={setUntil} style={input} />
    </View>
    {invalidDates && <Text style={{ color: c.statusDanger }}>{t("research.history.invalidDates")}</Text>}
    <TextInput accessibilityLabel={t("research.history.search")} placeholder={t("research.history.search")} placeholderTextColor={c.foregroundMuted} value={filter.query ?? ""} onChangeText={query => onFilterChange({ ...filter, query })} style={input} />
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {chip(t("research.history.newestFirst"), newestFirst, () => setNewestFirst(value => !value))}
      {chip(t("research.history.clear"), false, () => { onFilterChange({}); setSince(""); setUntil(""); })}
    </View>
    <Text style={{ color: c.foregroundMuted }}>{t("research.history.count", { shown: Math.min(limit, ordered.length), total: ordered.length })}</Text>
    {!ordered.length && !invalidDates && <Text style={{ color: c.foregroundMuted }}>{t("research.history.empty")}</Text>}
    {ordered.slice(0, limit).map(event => {
      const open = expanded.has(event.id);
      const sender = nameOf(event.from), receiver = event.to ? nameOf(event.to) : null;
      const time = event.timestamp === null ? t("research.history.noTime") : new Date(event.timestamp).toLocaleString();
      const statusKey = event.status ? stateKeys[event.status as keyof typeof stateKeys] : undefined;
      return <View key={event.id} style={{ borderLeftWidth: 3, borderColor: event.kind === "message" ? c.accent : c.border, backgroundColor: c.surface1, borderRadius: 6, padding: 12, gap: 6 }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{time} · {t(kindKeys[event.kind])}{!activeIds.has(event.agentId) ? ` · ${t("research.history.archived")}` : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("research.history.filterParticipants")} onPress={() => onFilterChange(event.to ? { from: event.from, to: event.to, kind: event.kind } : { member: event.memberId, kind: event.kind })}>
          <Text style={{ color: c.accent, fontWeight: "600" }}>{receiver ? `${sender} → ${receiver}` : sender}</Text>
        </Pressable>
        {event.toolName && <Text style={{ color: c.foreground }}>{event.toolName}</Text>}
        {statusKey && <Text style={{ color: event.status === "failed" || event.status === "error" || event.status === "errored" ? c.statusDanger : c.foregroundMuted }}>{t(statusKey)}</Text>}
        {event.kind !== "tool" && <Text selectable={open} numberOfLines={open ? undefined : 3} style={{ color: c.foreground }}>{event.text}</Text>}
        {open && event.details && <Text selectable style={{ color: c.foreground, fontSize: 12 }}>{event.details}</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setExpanded(value => { const next = new Set(value); if (open) next.delete(event.id); else next.add(event.id); return next; })} style={{ paddingVertical: 6 }}>
            <Text style={{ color: c.accent }}>{t(open ? "research.history.collapse" : "research.history.expand")}</Text>
          </Pressable>
          {sessionButton(event.agentId, t("research.history.openConversation"))}
          {event.fromAgentId && event.fromAgentId !== event.agentId && sessionButton(event.fromAgentId, t("research.history.openSender"))}
        </View>
      </View>;
    })}
    {ordered.length > limit && chip(t("research.history.loadMore"), false, () => setLimit(value => value + 100))}
  </View>;
}
