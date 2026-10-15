// Undo/redo history for the theme draft (contract §7.5). Pure, no React, no DOM.
//
// Model: a linear list of definitions with a cursor. `entries[0]` is the starting state, so
// canUndo === (index > 0). Definitions are immutable, so entries are stored by reference.
//
// Granularity rules:
//   - A pointer drag is ONE entry: the store applies transient updates without touching history
//     and calls push() once on commitTransient().
//   - Keyboard nudges pass a coalesceKey; pushes with the same key within `coalesceMs` (default
//     400 ms) of the previous one REPLACE the top entry instead of adding a new one.
//   - Pushing after an undo drops the redo branch. The list is capped at `cap` undo steps (default 100).

export const HISTORY_CAP = 100;
export const COALESCE_MS = 400;

export function createHistory({ cap = HISTORY_CAP, coalesceMs = COALESCE_MS, now = () => Date.now() } = {}) {
  let entries = [];
  let index = -1;
  let lastKey = null;
  let lastAt = 0;

  function reset(definition, label = 'start') {
    entries = [{ definition, label }];
    index = 0;
    lastKey = null;
    lastAt = 0;
  }

  return {
    reset,
    get size() { return entries.length; },
    get index() { return index; },
    get canUndo() { return index > 0; },
    get canRedo() { return index >= 0 && index < entries.length - 1; },
    current() { return index >= 0 ? entries[index].definition : null; },
    currentLabel() { return index >= 0 ? entries[index].label : null; },

    /**
     * Record a new state. Returns 'pushed' | 'coalesced' | 'noop'.
     * `opts.coalesceKey` merges consecutive pushes with the same key within the window.
     */
    push(definition, opts = {}) {
      if (index < 0) { reset(definition, opts.label); return 'pushed'; }
      if (entries[index].definition === definition) return 'noop';
      const t = now();
      const key = opts.coalesceKey || null;
      // Coalescing only applies at the tip (never rewrites history behind a redo branch).
      if (key && key === lastKey && t - lastAt <= coalesceMs && index === entries.length - 1 && index > 0) {
        entries[index] = { definition, label: opts.label || entries[index].label };
        lastAt = t;
        return 'coalesced';
      }
      entries = entries.slice(0, index + 1);
      entries.push({ definition, label: opts.label || '' });
      if (entries.length > cap + 1) entries = entries.slice(entries.length - (cap + 1));
      index = entries.length - 1;
      lastKey = key;
      lastAt = t;
      return 'pushed';
    },

    undo() {
      if (index <= 0) return null;
      index -= 1;
      lastKey = null;
      return entries[index].definition;
    },
    redo() {
      if (index < 0 || index >= entries.length - 1) return null;
      index += 1;
      lastKey = null;
      return entries[index].definition;
    },
  };
}
