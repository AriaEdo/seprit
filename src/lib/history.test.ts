import { describe, expect, it } from "vitest";
import { createFrame, paintPoints, type Frame } from "./pixels";
import { canRedo, canUndo, emptyHistory, record, redo, undo, HISTORY_LIMIT } from "./history";

const a = createFrame(2, 2);
const b = paintPoints(a, [[0, 0]], [255, 0, 0, 255]);
const c = paintPoints(b, [[1, 1]], [255, 0, 0, 255]);

describe("history", () => {
  it("undo restores the previous frame and redo brings the edit back", () => {
    let h = record(emptyHistory(), a, b);
    h = record(h, b, c);
    const u1 = undo(h, c)!;
    expect(u1.value).toBe(b);
    const u2 = undo(u1.history, u1.value)!;
    expect(u2.value).toBe(a);
    expect(canUndo(u2.history)).toBe(false);
    const r = redo(u2.history, u2.value)!;
    expect(r.value).toBe(b);
  });

  it("a new edit after undo drops the redo branch, like every editor users know", () => {
    let h = record(emptyHistory(), a, b);
    const u = undo(h, b)!;
    h = record(u.history, a, c);
    expect(canRedo(h)).toBe(false);
    expect(undo(h, c)!.value).toBe(a);
  });

  it("ignores gestures that changed nothing (e.g. fill with the same color), so undo never seems dead", () => {
    const h = record(emptyHistory(), a, a);
    expect(canUndo(h)).toBe(false);
  });

  it("returns null at the ends instead of throwing, so keyboard spam is harmless", () => {
    expect(undo(emptyHistory(), a)).toBeNull();
    expect(redo(emptyHistory(), a)).toBeNull();
  });

  it("caps memory by dropping the oldest steps (512² frames are 1 MB each)", () => {
    let h = emptyHistory<Frame>();
    let cur: Frame = a;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      const next = paintPoints(cur, [[0, 0]], [i % 256, 0, 0, 255]);
      h = record(h, cur, next);
      cur = next;
    }
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
