import { usePaseo, useTranslation } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import type { HistoryPage } from "../shared/team-history";
import { HistoryPageError, readHistoryPages, type HistoryCache } from "../shared/history-pages";
import { messages } from "./i18n";

/** Archived sessions are fetched once; current sessions also receive live updates. */
export function useTeamHistory(sources: readonly { agentId: string; live: boolean }[]) {
  const paseo = usePaseo();
  const { t } = useTranslation(messages);
  const [pages, setPages] = useState<HistoryPage[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const signature = JSON.stringify(sources);
  useEffect(() => {
    let active = true, remaining = sources.length;
    const cleanups: (() => void)[] = [];
    const content = new Map<string, HistoryPage & HistoryCache>();
    setPages([]); setErrors({}); setLoading(remaining > 0);
    for (const { agentId, live } of sources) {
      const handle = paseo.agents.ref(agentId);
      let running = false, again = false, replacement = false, first = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: unknown) => { if (active) setErrors(value => ({ ...value, [agentId]: String(error) })); };
      const load = async () => {
        if (!active) return;
        if (running) { again = true; return; }
        running = true;
        try {
          if (replacement) { content.delete(agentId); replacement = false; }
          const next = await readHistoryPages(options => handle.timeline.refetch(options), content.get(agentId), () => active);
          if (active) {
            content.set(agentId, { recipient: agentId, ...next });
            setErrors(value => { const next = { ...value }; delete next[agentId]; return next; });
            setPages([...content.values()]);
          }
        } catch (error) { if (error instanceof HistoryPageError) { replacement = true; fail(t("research.timelineError")); } else fail(error); }
        finally {
          running = false;
          if (first) { first = false; remaining--; if (active) setLoading(remaining > 0); }
          if (again && active) { again = false; void load(); }
        }
      };
      if (live) {
        const off = handle.timeline.subscribe(event => {
          if (event.event.type === "error") { fail(event.event.error); return; }
          if (event.event.type === "replacement") replacement = true;
          if (!timer) timer = setTimeout(() => { timer = undefined; void load(); }, 300);
        });
        void off.ready.then(load).catch(error => { fail(error); void load(); });
        cleanups.push(() => { off(); if (timer) clearTimeout(timer); });
      } else void load();
    }
    return () => { active = false; cleanups.forEach(fn => fn()); };
  }, [paseo, signature, retry]);
  return { pages, errors, loading, retry: () => setRetry(value => value + 1) };
}
