/** Read-only projections of Paseo timelines. No model calls or message delivery. */
export type HistoryPage = { recipient: string; epoch?: string; entries: readonly unknown[] };
export type HistoryKind = "message" | "user" | "assistant" | "tool" | "event";
export const USER_PARTICIPANT = "$user";
export type HistoryEvent = {
  id: string; kind: HistoryKind; agentId: string; memberId: string;
  from: string; to?: string; fromAgentId?: string; fromName?: string;
  timestamp: number | null; sequence: number; text: string;
  toolName?: string; status?: string; details?: string;
};
type Item = {
  type?: string; callId?: string; messageId?: string; clientMessageId?: string;
  text?: string; message?: string; name?: string; status?: string; detail?: unknown; error?: unknown;
  agentMessage?: { event?: string; sender?: { id?: string; title?: string }; text?: string };
};
type Entry = { seq?: number; seqStart?: number; timestamp?: string; sourceSeqRanges?: { startSeq: number; endSeq: number }[]; item: Item };
function entryOf(raw: unknown): Entry | null {
  if (!raw || typeof raw !== "object" || !("item" in raw) || !raw.item || typeof raw.item !== "object") return null;
  return raw as Entry;
}
/** seqStart is the SDK's projected row identity; seq exists on older timelines. */
export function historyEntryKey(raw: unknown): string | null {
  const entry = entryOf(raw);
  if (!entry) return null;
  const item = entry.item;
  if (item.callId) return `call:${item.callId}`;
  if (typeof entry.seqStart === "number") return `seq:${entry.seqStart}`;
  if (item.messageId || item.clientMessageId) return `message:${item.messageId ?? item.clientMessageId}`;
  const seq = entry.seqStart ?? entry.seq;
  return typeof seq === "number" ? `seq:${seq}` : null;
}
export function mergeHistoryEntries(previous: readonly unknown[], incoming: readonly unknown[]): unknown[] {
  const entries = new Map<string, unknown>();
  for (const raw of [...previous, ...incoming]) {
    const key = historyEntryKey(raw);
    if (key !== null) {
      const next = entryOf(raw)!;
      if (next.item.type === "assistant_message" && next.sourceSeqRanges && (next.sourceSeqRanges.length > 1 || next.sourceSeqRanges.some(range => range.endSeq > range.startSeq))) {
        for (const [oldKey, oldRaw] of entries) {
          const old = entryOf(oldRaw)!;
          if (old.item.type === next.item.type && old.seqStart !== undefined && next.sourceSeqRanges.some(range => old.seqStart! >= range.startSeq && old.seqStart! <= range.endSeq)) entries.delete(oldKey);
        }
      }
      entries.set(key, raw);
    }
  }
  return [...entries.values()].sort((a, b) => {
    const x = entryOf(a)!, y = entryOf(b)!;
    return (x.seqStart ?? x.seq ?? 0) - (y.seqStart ?? y.seq ?? 0);
  });
}
function detailsOf(item: Item): string {
  return JSON.stringify({ detail: item.detail, ...(item.error != null ? { error: item.error } : {}) }, null, 2);
}
export function teamHistory(pages: readonly HistoryPage[], identities: ReadonlyMap<string, string>): HistoryEvent[] {
  const events = new Map<string, HistoryEvent>();
  for (const page of pages) {
    const memberId = identities.get(page.recipient);
    if (!memberId) continue;
    for (const raw of page.entries) {
      const entry = entryOf(raw), key = historyEntryKey(raw);
      if (!entry || key === null) continue;
      const item = entry.item;
      const parsedTime = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
      const event: HistoryEvent = {
        id: JSON.stringify([page.recipient, page.epoch ?? "", key]), agentId: page.recipient, memberId,
        kind: "event", from: memberId, timestamp: Number.isFinite(parsedTime) ? parsedTime : null,
        sequence: entry.seqStart ?? entry.seq ?? 0, text: "",
      };
      // Provenance takes precedence over the provider envelope (often tool_call).
      if (item.agentMessage) {
        const message = item.agentMessage, sender = message.sender?.id;
        if (!sender) continue;
        event.kind = message.event === "message" ? "message" : "event";
        event.from = identities.get(sender) ?? `$agent:${sender}`;
        event.fromAgentId = sender; event.fromName = message.sender?.title;
        event.to = memberId; event.text = message.text ?? "";
        if (event.kind === "event") event.status = message.event;
      } else if (item.type === "user_message") {
        event.kind = "user"; event.from = USER_PARTICIPANT; event.to = memberId; event.text = item.text ?? "";
      } else if (item.type === "assistant_message") {
        // A local reply is not evidence of a routed message to another member.
        event.kind = "assistant"; event.text = item.text ?? "";
      } else if (item.type === "tool_call") {
        event.kind = "tool"; event.toolName = item.name; event.status = item.status;
        event.details = detailsOf(item);
      } else if (item.type === "error" || item.type === "notification") {
        event.text = item.message ?? ""; event.status = item.type;
      } else continue;
      events.set(event.id, event);
    }
  }
  return [...events.values()].sort((a, b) =>
    (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity) || a.agentId.localeCompare(b.agentId) || a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export type HistoryFilter = { member?: string; from?: string; to?: string; kind?: HistoryKind; since?: number; until?: number; query?: string };
export function filterHistory(events: readonly HistoryEvent[], filter: HistoryFilter): HistoryEvent[] {
  const query = filter.query?.trim().toLocaleLowerCase();
  return events.filter(event => {
    if (filter.member && event.memberId !== filter.member && event.from !== filter.member && event.to !== filter.member) return false;
    if (filter.from && event.from !== filter.from) return false;
    if (filter.to && event.to !== filter.to) return false;
    if (filter.kind && event.kind !== filter.kind) return false;
    if (filter.since !== undefined && (event.timestamp === null || event.timestamp < filter.since)) return false;
    if (filter.until !== undefined && (event.timestamp === null || event.timestamp > filter.until)) return false;
    return !query || `${event.text}\n${event.toolName ?? ""}\n${event.details ?? ""}`.toLocaleLowerCase().includes(query);
  });
}
/** Local dates entered by the user; reject overflow rather than silently rolling dates. */
export function parseHistoryDate(value: string, endOfDay = false): number | undefined | null {
  if (!value.trim()) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d, h, min] = match;
  const year = Number(y), month = Number(m) - 1, day = Number(d);
  const hour = h === undefined && endOfDay ? 23 : Number(h ?? 0), minute = min === undefined && endOfDay ? 59 : Number(min ?? 0);
  const date = new Date(year, month, day, hour, minute, h === undefined && endOfDay ? 59 : 0, h === undefined && endOfDay ? 999 : 0);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day && date.getHours() === hour && date.getMinutes() === minute ? date.getTime() : null;
}
