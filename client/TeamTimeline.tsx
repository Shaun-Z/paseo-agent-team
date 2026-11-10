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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picker, setPicker] = useState<"member" | "from" | "to" | "kind" | null>(null);
  const [about, setAbout] = useState(false);
  const [since, setSince] = useState(""), [until, setUntil] = useState("");
  const [limit, setLimit] = useState(20);
  const [newestFirst, setNewestFirst] = useState(true);
  const lower = parseHistoryDate(since), upper = parseHistoryDate(until, true);
  const invalidDates = lower === null || upper === null || (lower !== undefined && upper !== undefined && lower > upper);
  const filtered = invalidDates ? [] : filterHistory(events, { ...filter, since: lower ?? undefined, until: upper ?? undefined });
  const ordered = newestFirst ? [...filtered].reverse() : filtered;
  const external = new Map(events.filter(event => event.from.startsWith("$agent:")).map(event => [event.from, event.fromName ?? t("research.history.externalAgent")]));
  const names = new Map([...members.map(member => [member.id, member.name ?? member.id] as const), [USER_PARTICIPANT, t("research.history.user")] as const, ...external]);
  const nameOf = (id: string) => names.get(id) ?? id;
  const participants = [...members.map(member => member.id), USER_PARTICIPANT, ...external.keys()];
  const input = { borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 8, color: c.foreground, backgroundColor: c.surface0, minWidth: 150, flex: 1 };
  const filterKey = JSON.stringify(filter);
  useEffect(() => setLimit(20), [filterKey, since, until, newestFirst]);
  const chip = (label: string, selected: boolean, action: () => void, key = label) => <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected }} onPress={action}
    style={{ borderWidth: 1, borderColor: selected ? c.accent : c.border, backgroundColor: c.surface0, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 6 }}>
    <Text style={{ color: selected ? c.accent : c.foregroundMuted }}>{label}</Text>
  </Pressable>;
  const selector = (label: string, field: NonNullable<typeof picker>, value: string) => <View style={{ gap: 5, flex: 1, minWidth: 140 }}>
    <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{label}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: picker === field }} onPress={() => setPicker(picker === field ? null : field)} style={{ flexDirection: "row", padding: 8, borderWidth: 1, borderColor: picker === field ? c.accent : c.border, borderRadius: 6, gap: 8 }}><Text numberOfLines={1} style={{ color: c.foreground, flex: 1, fontSize: 12 }}>{value}</Text><Text style={{ color: c.foregroundMuted }}>▾</Text></Pressable>
  </View>;
  const pickerOptions = picker === "kind" ? kinds : picker === "from" ? participants : members.map(member => member.id);
  const selectedValue = picker ? filter[picker] : undefined;
  const extraFilters = [filter.member, filter.from, filter.to, since, until].filter(Boolean).length;
  const sessionButton = (agentId: string, label: string) => navigation && <Pressable accessibilityRole="button" onPress={() => navigation.openAgent({ agentId })} style={{ paddingVertical: 6 }}>
    <Text style={{ color: c.accent }}>{label}</Text>
  </Pressable>;
  return <View style={{ gap: 12 }}>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>{t("research.history.count", { shown: Math.min(limit, ordered.length), total: ordered.length })}</Text>
      {chip(t("research.history.newestFirst"), newestFirst, () => setNewestFirst(value => !value))}
      {chip(extraFilters ? t("research.ui.filtersCount", { count: extraFilters }) : t("research.ui.filters"), filtersOpen, () => setFiltersOpen(value => !value))}
    </View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      {chip(t("research.history.memberMessages"), filter.kind === "message", () => onFilterChange({ ...filter, kind: "message" }))}
      {chip(t("research.ui.allActivity"), !filter.kind, () => onFilterChange({ ...filter, kind: undefined }))}
      <TextInput accessibilityLabel={t("research.history.search")} placeholder={t("research.history.search")} placeholderTextColor={c.foregroundMuted} value={filter.query ?? ""} onChangeText={query => onFilterChange({ ...filter, query })} style={input} />
    </View>
    {filtersOpen && <View style={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1, padding: 12, borderRadius: 8, gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {selector(t("research.history.member"), "member", filter.member ? nameOf(filter.member) : t("research.history.all"))}
        {selector(t("research.history.from"), "from", filter.from ? nameOf(filter.from) : t("research.history.all"))}
        {selector(t("research.history.to"), "to", filter.to ? nameOf(filter.to) : t("research.history.all"))}
        {selector(t("research.history.type"), "kind", filter.kind ? t(kindKeys[filter.kind]) : t("research.history.all"))}
      </View>
      {picker && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {chip(t("research.history.all"), !selectedValue, () => { onFilterChange({ ...filter, [picker]: undefined }); setPicker(null); }, "all")}
        {pickerOptions.map(id => chip(picker === "kind" ? t(kindKeys[id as keyof typeof kindKeys]) : nameOf(id), selectedValue === id, () => { onFilterChange({ ...filter, [picker]: id }); setPicker(null); }, id))}
      </View>}
      <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.history.localTime")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <TextInput accessibilityLabel={t("research.history.since")} placeholder={t("research.history.since")} placeholderTextColor={c.foregroundMuted} value={since} onChangeText={setSince} style={input} />
      <TextInput accessibilityLabel={t("research.history.until")} placeholder={t("research.history.until")} placeholderTextColor={c.foregroundMuted} value={until} onChangeText={setUntil} style={input} />
      </View>
      {chip(t("research.history.clear"), false, () => { onFilterChange({ kind: "message" }); setSince(""); setUntil(""); setPicker(null); })}
    </View>}
    {invalidDates && <Text style={{ color: c.statusDanger }}>{t("research.history.invalidDates")}</Text>}
    {!ordered.length && !invalidDates && <Text style={{ color: c.foregroundMuted }}>{t("research.history.empty")}</Text>}
    {ordered.slice(0, limit).map(event => {
      const open = expanded.has(event.id);
      const sender = nameOf(event.from), receiver = event.to ? nameOf(event.to) : null;
      const time = event.timestamp === null ? t("research.history.noTime") : new Date(event.timestamp).toLocaleString();
      const statusKey = event.status ? stateKeys[event.status as keyof typeof stateKeys] : undefined;
      return <View key={event.id} style={{ borderLeftWidth: 3, borderColor: event.kind === "message" ? c.accent : c.border, backgroundColor: c.surface1, borderRadius: 6, padding: 10, gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={t(open ? "research.history.collapse" : "research.history.expand")} onPress={() => setExpanded(value => { const next = new Set(value); if (open) next.delete(event.id); else next.add(event.id); return next; })} style={{ gap: 5 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: c.accent, fontWeight: "600", flex: 1, fontSize: 12 }}>{receiver ? `${sender} → ${receiver}` : sender}</Text><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{open ? "▾" : "▸"}</Text></View>
          <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{time} · {t(kindKeys[event.kind])}{!activeIds.has(event.agentId) ? ` · ${t("research.history.archived")}` : ""}</Text>
          {event.kind !== "tool" && !open && <Text numberOfLines={2} style={{ color: c.foreground, fontSize: 12 }}>{event.text}</Text>}
        </Pressable>
        {event.toolName && <Text style={{ color: c.foreground }}>{event.toolName}</Text>}
        {statusKey && <Text style={{ color: event.status === "failed" || event.status === "error" || event.status === "errored" ? c.statusDanger : c.foregroundMuted }}>{t(statusKey)}</Text>}
        {event.kind !== "tool" && open && <Text selectable style={{ color: c.foreground, fontSize: 13 }}>{event.text}</Text>}
        {open && event.details && <Text selectable style={{ color: c.foreground, fontSize: 12 }}>{event.details}</Text>}
        {open && <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16 }}>
          {sessionButton(event.agentId, t("research.history.openConversation"))}
          {event.fromAgentId && event.fromAgentId !== event.agentId && sessionButton(event.fromAgentId, t("research.history.openSender"))}
          <Pressable accessibilityRole="button" onPress={() => onFilterChange(event.to ? { from: event.from, to: event.to, kind: event.kind } : { member: event.memberId, kind: event.kind })} style={{ paddingVertical: 6 }}><Text style={{ color: c.accent }}>{t("research.ui.exchange")}</Text></Pressable>
        </View>}
      </View>;
    })}
    {ordered.length > limit && chip(t("research.history.loadMore"), false, () => setLimit(value => value + 20))}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: about }} onPress={() => setAbout(value => !value)}><Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{t("research.ui.aboutHistory")}{about ? " ▾" : " ▸"}</Text></Pressable>
    {about && <View style={{ gap: 6 }}><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.history.hint")}</Text><Text style={{ color: c.foregroundMuted, fontSize: 12 }}>{t("research.history.timeHint")}</Text></View>}
  </View>;
}
