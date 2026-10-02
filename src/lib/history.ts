// Undo/redo as stacks of immutable snapshots; each entry is one user gesture.

export const HISTORY_LIMIT = 100;

export interface History<T> {
  readonly past: readonly T[];
  readonly future: readonly T[];
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });
export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;

// Records that `before` was replaced by `after`; no-op gestures are skipped.
export function record<T>(h: History<T>, before: T, after: T): History<T> {
  if (before === after) return h;
  return { past: [...h.past, before].slice(-HISTORY_LIMIT), future: [] };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (!canUndo(h)) return null;
  return { history: { past: h.past.slice(0, -1), future: [current, ...h.future] }, value: h.past.at(-1)! };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; value: T } | null {
  if (!canRedo(h)) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(1) }, value: h.future[0] };
}
