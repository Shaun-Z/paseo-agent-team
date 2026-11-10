import { describe, expect, it, vi } from "vitest";
import { filterHistory, historyEntryKey, mergeHistoryEntries, parseHistoryDate, teamHistory, USER_PARTICIPANT } from "../shared/team-history";
import { HistoryPageError, readHistoryPages } from "../shared/history-pages";

const identities = new Map([["lead-agent", "anchor"], ["old-coder", "coder-a"], ["new-coder", "coder-a"], ["coder-b-agent", "coder-b"]]);
const row = (seq: number, item: object, timestamp = "2026-11-10T03:00:00Z") => ({ seqStart: seq, seqEnd: seq, timestamp, item });
const delivery = (id: string, sender: string, text: string, event = "message") => ({ type: "tool_call", callId: id, name: "agent_message", status: "completed", agentMessage: { event, sender: { id: sender }, text } });

describe("team history provenance", () => {
  it("reads the real SDK envelope, deduplicates deliveries and keeps member identities across reset", () => {
    const entries = [row(1, delivery("d1", "old-coder", "curated report")), row(2, delivery("d2", "new-coder", "follow-up")), row(3, delivery("d3", "coder-b-agent", "other programmer"))];
    const events = teamHistory([{ recipient: "lead-agent", entries }, { recipient: "lead-agent", entries }], identities);
    expect(events).toHaveLength(3);
    expect(events.map(event => [event.kind, event.from, event.to])).toEqual([["message", "coder-a", "anchor"], ["message", "coder-a", "anchor"], ["message", "coder-b", "anchor"]]);
  });
  it("distinguishes user input, local replies, callbacks and actual routed messages", () => {
    const events = teamHistory([{ recipient: "lead-agent", entries: [
      row(1, { type: "user_message", text: "Start the experiment" }),
      row(2, { type: "assistant_message", text: "I told coder-a to start" }),
      row(3, delivery("callback", "new-coder", "finished", "finished")),
      row(4, { type: "reasoning", text: "not a team message" }),
      row(5, { type: "notification", message: "Connection restored" }),
    ] }], identities);
    expect(events.map(event => event.kind)).toEqual(["user", "assistant", "event", "event"]);
    expect(events[0]).toMatchObject({ from: USER_PARTICIPANT, to: "anchor" });
    expect(events[1]?.to).toBeUndefined();
    expect(filterHistory(events, { kind: "message" })).toEqual([]);
    expect(JSON.stringify(events)).not.toContain("not a team message");
  });
  it("retains failed tool details and treats unknown agent provenance as external, never as a user", () => {
    const events = teamHistory([{ recipient: "lead-agent", entries: [
      row(1, { type: "tool_call", callId: "tool", name: "read_file", status: "failed", detail: { path: "THEORY.md" }, error: "File missing" }),
      row(2, delivery("external", "unconfigured-agent", "external question")),
    ] }], identities);
    expect(events[0]).toMatchObject({ kind: "tool", status: "failed", toolName: "read_file" });
    expect(events[0]?.details).toContain("File missing");
    expect(events[1]?.from).toBe("$agent:unconfigured-agent");
    expect(teamHistory([{ recipient: "unrelated-agent", entries: [row(1, { type: "user_message", text: "unrelated" })] }], identities)).toEqual([]);
  });
  it("keeps epoch and session identities separate, even when a provider reuses call IDs", () => {
    const entries = [row(1, delivery("same", "lead-agent", "question"))];
    expect(teamHistory([{ recipient: "old-coder", epoch: "a", entries }, { recipient: "new-coder", epoch: "a", entries }, { recipient: "new-coder", epoch: "b", entries }], identities)).toHaveLength(3);
  });
});

describe("history order and projection updates", () => {
  it("orders timestamps with deterministic within-session ties and puts unknown times last", () => {
    const pages = [{ recipient: "lead-agent", entries: [row(3, { type: "assistant_message", text: "third" }), row(1, { type: "user_message", text: "first" }), row(4, { type: "assistant_message", text: "unknown time" }, "invalid")] },
      { recipient: "old-coder", entries: [row(2, { type: "user_message", text: "earlier" }, "2026-11-10T02:00:00Z")] }];
    const events = teamHistory(pages, identities);
    expect(events.map(event => event.text)).toEqual(["earlier", "first", "third", "unknown time"]);
    expect(teamHistory([...pages].reverse(), identities)).toEqual(events);
  });
  it("replaces streamed text and tool lifecycles without duplicate rows", () => {
    const before = [row(1, { type: "assistant_message", text: "partial" }), row(2, { type: "tool_call", callId: "call", status: "running" })];
    const after = [row(1, { type: "assistant_message", messageId: "provider-id", text: "complete" }), row(4, { type: "tool_call", callId: "call", status: "completed" })];
    const merged = mergeHistoryEntries(before, after);
    expect(merged).toHaveLength(2);
    expect(merged).toEqual(after);
    expect(historyEntryKey({ item: { type: "assistant_message", messageId: "legacy" } })).toBe("message:legacy");
  });
  it("removes fragments superseded by a projected assistant merge, preserving unrelated rows", () => {
    const earlier = [row(1, { type: "assistant_message", text: "hello" }), row(2, { type: "tool_call", callId: "call" }), row(3, { type: "assistant_message", text: "world" })];
    const combined = { ...row(1, { type: "assistant_message", text: "hello world" }), seqEnd: 3, sourceSeqRanges: [{ startSeq: 1, endSeq: 1 }, { startSeq: 3, endSeq: 3 }] };
    expect(mergeHistoryEntries(earlier, [combined])).toEqual([combined, earlier[1]]);
  });
});

describe("history filters", () => {
  const events = teamHistory([{ recipient: "lead-agent", entries: [row(1, delivery("a", "old-coder", "Key conclusion: bound is tight")), row(2, delivery("b", "coder-b-agent", "Blocked by dataset"), "2026-11-10T04:00:00Z"), row(3, { type: "user_message", text: "Retry" }, "invalid"), row(4, { type: "tool_call", callId: "read", name: "read_file", detail: { path: "THEORY.md" } })] }], identities);
  it("combines member, direction, type, inclusive time range and text filters", () => {
    expect(filterHistory(events, { member: "anchor", from: "coder-a", to: "anchor", kind: "message", query: "CONCLUSION", since: Date.parse("2026-11-10T03:00:00Z"), until: Date.parse("2026-11-10T03:00:00Z") }).map(event => event.text)).toEqual(["Key conclusion: bound is tight"]);
    expect(filterHistory(events, { member: "coder-a" })).toHaveLength(1);
    expect(filterHistory(events, { member: "coder-b", from: "coder-a" })).toEqual([]);
    expect(filterHistory(events, { from: USER_PARTICIPANT })).toHaveLength(1);
    expect(filterHistory(events, { since: Date.parse("2026-11-10T03:30:00Z") }).map(event => event.text)).toEqual(["Blocked by dataset"]);
    expect(filterHistory(events, { kind: "tool", query: "THEORY.md" })).toHaveLength(1);
  });
  it("accepts local dates with inclusive end-of-day and rejects malformed or overflowing dates", () => {
    expect(parseHistoryDate(" ")).toBeUndefined();
    const end = parseHistoryDate("2026-11-10", true)!;
    expect(new Date(end).getHours()).toBe(23);
    expect(new Date(end).getMilliseconds()).toBe(999);
    expect(parseHistoryDate("2026-11-10 14:35")).toBe(new Date(2026, 10, 10, 14, 35).getTime());
    for (const invalid of ["2026-02-29", "2026-04-31", "2026-11-10 24:01", "2026-11-10 13:60", "11/10/2026"]) expect(parseHistoryDate(invalid)).toBeNull();
  });
});

const cursor = (seq: number, epoch = "epoch") => ({ seq, epoch });
const page = (entries: ReturnType<typeof row>[], options: Partial<{ epoch: string; hasOlder: boolean; hasNewer: boolean; startCursor: ReturnType<typeof cursor> | null; endCursor: ReturnType<typeof cursor> | null; staleCursor: boolean; reset: boolean; gap: boolean }> = {}) => ({ epoch: "epoch", entries, startCursor: cursor(entries[0]?.seqStart ?? 0), endCursor: cursor(entries.at(-1)?.seqStart ?? 0), hasOlder: false, hasNewer: false, ...options });

describe("history pagination and reconnect", () => {
  it("backfills all older pages and retains the newest cursor for reconnect", async () => {
    const newest = row(3, { type: "user_message", text: "newest" }), oldest = row(1, { type: "user_message", text: "oldest" });
    const fetch = vi.fn().mockResolvedValueOnce(page([newest], { hasOlder: true })).mockResolvedValueOnce(page([oldest]));
    const result = await readHistoryPages(fetch);
    expect(result.entries).toEqual([oldest, newest]);
    expect(result.cursor).toEqual(cursor(3));
    expect(fetch.mock.calls[1]?.[0]).toMatchObject({ direction: "before", cursor: cursor(3) });
  });
  it("catches up all pages after reconnect and updates existing lifecycle rows", async () => {
    const running = row(1, { type: "tool_call", callId: "call", status: "running" });
    const done = row(3, { type: "tool_call", callId: "call", status: "completed" });
    const reply = row(4, { type: "assistant_message", text: "done" });
    const fetch = vi.fn().mockResolvedValueOnce(page([done], { hasNewer: true })).mockResolvedValueOnce(page([reply]));
    const result = await readHistoryPages(fetch, { epoch: "epoch", entries: [running], cursor: cursor(1) });
    expect(result.entries).toEqual([done, reply]);
    expect(fetch.mock.calls[0]?.[0]).toMatchObject({ direction: "after", cursor: cursor(1) });
    expect(result.cursor).toEqual(cursor(4));
  });
  it.each(["epoch", "reset", "staleCursor", "gap"])("discards stale contents on %s", async reason => {
    const replacement = row(1, { type: "user_message", text: "replacement" });
    const fetch = vi.fn().mockResolvedValueOnce(page([], reason === "epoch" ? { epoch: "new" } : { [reason]: true })).mockResolvedValueOnce(page([replacement], { epoch: "new", startCursor: cursor(1, "new"), endCursor: cursor(1, "new") }));
    const result = await readHistoryPages(fetch, { epoch: "epoch", entries: [row(1, { type: "user_message", text: "old" })], cursor: cursor(1) });
    expect(result.entries).toEqual([replacement]);
    expect(result.epoch).toBe("new");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("refuses missing or repeated cursors and epoch changes instead of silently truncating", async () => {
    await expect(readHistoryPages(vi.fn().mockResolvedValue(page([], { hasOlder: true, startCursor: null })))).rejects.toBeInstanceOf(HistoryPageError);
    await expect(readHistoryPages(vi.fn().mockResolvedValue(page([row(1, {})], { hasOlder: true })))).rejects.toBeInstanceOf(HistoryPageError);
    await expect(readHistoryPages(vi.fn().mockResolvedValueOnce(page([row(2, {})], { hasOlder: true })).mockResolvedValueOnce(page([row(1, {})], { epoch: "changed" })))).rejects.toBeInstanceOf(HistoryPageError);
  });
});
