// Edit session: the single place that decides how a UI gesture becomes draft
// store calls, so "one drag = one undo entry" is enforced (and tested) in one spot.
//
//   kind 'drag' -> updateDraft(..., { transient:true })   (no history), closed by end()
//   kind 'key'  -> updateDraft(..., { coalesceKey })       (store merges presses within 400 ms)
//   kind 'set'  -> updateDraft(...)                         (one discrete history entry)

export function createEditSession(store) {
  let open = false;
  return {
    apply(updater, { kind = 'set', coalesceKey, label } = {}) {
      if (kind === 'drag') {
        open = true;
        store.updateDraft(updater, { transient: true, label });
        return;
      }
      // A discrete edit during an open drag must not leave a dangling transient.
      if (open) this.end();
      if (kind === 'key') store.updateDraft(updater, { coalesceKey: coalesceKey || label || 'key', label });
      else store.updateDraft(updater, { label });
    },
    /** pointerup / pointercancel / blur / keyup: close the drag (no-op when none is open). */
    end() {
      if (!open) return false;
      open = false;
      store.commitTransient();
      return true;
    },
    get isOpen() {
      return open;
    },
  };
}
