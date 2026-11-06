import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, record, redo, undo, type DraftHistory } from "../shared/draft-history";
import type { Team } from "../shared/team";

const draft = (goal: string): Team => ({
  version: 1,
  goal,
  orchestrator: { workspace: "lead", provider: "claude", model: "m" },
  roles: [{ name: "qa", provider: "claude", model: "m", folders: [], instructions: "" }],
});
const [a, b, c, d] = ["a", "b", "c", "d"].map(draft) as [Team, Team, Team, Team];

describe("record", () => {
  it("pushes the draft onto past", () => {
    expect(record(EMPTY_HISTORY, a)).toEqual({ past: [a], future: [] });
    expect(record({ past: [a], future: [] }, b)).toEqual({ past: [a, b], future: [] });
  });

  it("clears the redo branch", () => {
    expect(record({ past: [a], future: [c, d] }, b)).toEqual({ past: [a, b], future: [] });
  });
});

describe("undo", () => {
  it("restores the last past draft and moves the current one to future", () => {
    expect(undo({ past: [a, b], future: [] }, c)).toEqual({ draft: b, history: { past: [a], future: [c] } });
  });

  it("appends to an existing future", () => {
    expect(undo({ past: [a], future: [d] }, c)).toEqual({ draft: a, history: { past: [], future: [d, c] } });
  });

  it("returns null with nothing to undo", () => {
    expect(undo(EMPTY_HISTORY, a)).toBeNull();
    expect(undo({ past: [], future: [b] }, a)).toBeNull();
  });
});

describe("redo", () => {
  it("restores the last future draft and moves the current one to past", () => {
    expect(redo({ past: [a], future: [d, c] }, b)).toEqual({ draft: c, history: { past: [a, b], future: [d] } });
  });

  it("returns null with nothing to redo", () => {
    expect(redo(EMPTY_HISTORY, a)).toBeNull();
    expect(redo({ past: [a], future: [] }, b)).toBeNull();
  });

  it("reverses an undo", () => {
    const undone = undo({ past: [a, b], future: [] }, c)!;
    const redone = redo(undone.history, undone.draft)!;
    expect(redone.draft).toBe(c);
    expect(redone.history).toEqual({ past: [a, b], future: [] });
  });
});

describe("history sequences", () => {
  it("record → record → undo → undo → redo returns the expected drafts", () => {
    // Drafts a → b → c; each edit records the draft before it.
    let history = record(record(EMPTY_HISTORY, a), b);
    const first = undo(history, c)!;
    expect(first.draft).toBe(b);
    const second = undo(first.history, first.draft)!;
    expect(second.draft).toBe(a);
    expect(second.history).toEqual({ past: [], future: [c, b] });
    const third = redo(second.history, second.draft)!;
    expect(third.draft).toBe(b);
    expect(third.history).toEqual({ past: [a], future: [c] });
    history = third.history;
    expect(redo(history, third.draft)!.draft).toBe(c);
  });

  it("a record after an undo clears redo", () => {
    const undone = undo(record(EMPTY_HISTORY, a), b)!;
    expect(undone.history.future).toEqual([b]);
    const next = record(undone.history, undone.draft);
    expect(next).toEqual({ past: [a], future: [] });
    expect(redo(next, d)).toBeNull();
  });

  it("does not mutate its inputs", () => {
    const history: DraftHistory = { past: [a, b], future: [d] };
    const snapshot = structuredClone(history);
    const current = structuredClone(c);
    record(history, c);
    undo(history, c);
    redo(history, c);
    expect(history).toEqual(snapshot);
    expect(c).toEqual(current);
    expect(EMPTY_HISTORY).toEqual({ past: [], future: [] });
    record(EMPTY_HISTORY, a);
    expect(EMPTY_HISTORY).toEqual({ past: [], future: [] });
  });
});
