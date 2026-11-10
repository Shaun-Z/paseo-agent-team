import { mergeHistoryEntries } from "./team-history";

type Cursor = { epoch: string; seq: number };
type Options = { direction?: "before" | "after"; cursor?: Cursor; limit: number };
type Page = {
  epoch: string; entries: readonly unknown[]; startCursor: Cursor | null; endCursor: Cursor | null;
  hasOlder: boolean; hasNewer: boolean; reset?: boolean; staleCursor?: boolean; gap?: boolean;
};
export type HistoryCache = { epoch: string; entries: unknown[]; cursor: Cursor | null };
export class HistoryPageError extends Error {}
/** Backfill once, then fetch after the last cursor. Replacement never mixes epochs. */
export async function readHistoryPages(fetchPage: (options: Options) => Promise<Page>, previous?: HistoryCache, active: () => boolean = () => true): Promise<HistoryCache> {
  let old = previous;
  let page = await fetchPage(old?.cursor ? { direction: "after", cursor: old.cursor, limit: 200 } : { limit: 200 });
  if (old && (old.epoch !== page.epoch || page.reset || page.staleCursor || page.gap)) {
    old = undefined;
    page = await fetchPage({ limit: 200 });
  }
  const epoch = page.epoch;
  let entries = mergeHistoryEntries(old?.entries ?? [], page.entries);
  let cursor = page.endCursor ?? old?.cursor ?? null;
  const seen = new Set<string>();
  const check = (next: Cursor | null) => {
    if (!next || next.epoch !== epoch) throw new HistoryPageError("Invalid history cursor");
    const key = JSON.stringify(next);
    if (seen.has(key)) throw new HistoryPageError("Repeated history cursor");
    seen.add(key);
    return next;
  };
  if (!old) {
    while (page.hasOlder && active()) {
      page = await fetchPage({ direction: "before", cursor: check(page.startCursor), limit: 200 });
      if (epoch !== page.epoch || page.reset || page.staleCursor || page.gap) throw new HistoryPageError("History changed during backfill");
      entries = mergeHistoryEntries(page.entries, entries);
    }
  } else {
    while (page.hasNewer && active()) {
      page = await fetchPage({ direction: "after", cursor: check(page.endCursor), limit: 200 });
      if (epoch !== page.epoch || page.reset || page.staleCursor || page.gap) throw new HistoryPageError("History changed during catch-up");
      entries = mergeHistoryEntries(entries, page.entries);
      cursor = page.endCursor ?? cursor;
    }
  }
  return { epoch, entries, cursor };
}
