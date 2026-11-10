/** Read every page; refuse a broken cursor rather than silently losing entries. */
export async function allPages<T>(fetch: (cursor?: string) => Promise<{ entries: T[]; pageInfo?: { hasMore: boolean; nextCursor: string | null } }>): Promise<T[]> {
  const entries: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await fetch(cursor);
    entries.push(...page.entries);
    if (!page.pageInfo?.hasMore) return entries;
    const next = page.pageInfo.nextCursor;
    if (!next || seen.has(next)) throw new Error("Invalid pagination cursor");
    seen.add(next);
    cursor = next;
  }
}
