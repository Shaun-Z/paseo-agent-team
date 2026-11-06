import type { Team } from "./team";

export type DraftHistory = { past: Team[]; future: Team[] };

export const EMPTY_HISTORY: DraftHistory = { past: [], future: [] };

/** Records the draft before applying an AI edit and discards the redo branch. */
export function record(history: DraftHistory, before: Team): DraftHistory {
  return { past: [...history.past, before], future: [] };
}

/** Restores the previous draft, saving the current draft for redo. */
export function undo(history: DraftHistory, current: Team): { history: DraftHistory; draft: Team } | null {
  if (!history.past.length) return null;
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
    draft: history.past[history.past.length - 1]!,
  };
}

/** Restores the next draft, saving the current draft for undo. */
export function redo(history: DraftHistory, current: Team): { history: DraftHistory; draft: Team } | null {
  if (!history.future.length) return null;
  return {
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
    draft: history.future[history.future.length - 1]!,
  };
}
