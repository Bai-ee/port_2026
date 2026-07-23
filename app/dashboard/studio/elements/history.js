// Generic, pure undo/redo stack — snapshot-shape-agnostic. Backs ClothStudio's
// element-system undo/redo (Elements rail card): every undoable mutation
// (duplicate, remove, randomize, reset, toggle visibility/lock, apply preset)
// pushes a pre-mutation snapshot; undo/redo replay them. Pure so the exact
// push/undo/redo semantics (cap, clear-redo-on-push, pop order) are directly
// unit-testable without a React harness.

const DEFAULT_CAP = 50;

export function createHistory() {
  return { undo: [], redo: [] };
}

// A new mutation always invalidates redo — there's no coherent "redo" once
// the timeline has forked.
export function pushHistory(history, snapshot, cap = DEFAULT_CAP) {
  const undo = [...history.undo, snapshot];
  if (undo.length > cap) undo.shift();
  return { undo, redo: [] };
}

// Returns { history, snapshot }. `snapshot` is null (history unchanged) when
// there's nothing to undo. `currentSnapshot` — what the caller was just
// looking at — is pushed onto the other stack so the operation is reversible.
export function undoHistory(history, currentSnapshot) {
  if (!history.undo.length) return { history, snapshot: null };
  const restored = history.undo[history.undo.length - 1];
  const undo = history.undo.slice(0, -1);
  const redo = [...history.redo, currentSnapshot];
  return { history: { undo, redo }, snapshot: restored };
}

export function redoHistory(history, currentSnapshot) {
  if (!history.redo.length) return { history, snapshot: null };
  const restored = history.redo[history.redo.length - 1];
  const redo = history.redo.slice(0, -1);
  const undo = [...history.undo, currentSnapshot];
  return { history: { undo, redo }, snapshot: restored };
}
