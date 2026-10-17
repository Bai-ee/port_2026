'use client';

import React, { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { XCE_COLORS } from '../content-ui/xce-tokens';

// UndoChip - small "Undo" control for an agent action that carries an undoId.
//   <UndoChip undoId label call clientId />   (calls strategy-action-undo; shows Undone / the error)
const chip = { display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 36, padding: '0 12px', borderRadius: 999, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, fontSize: 12.5, cursor: 'pointer' };

export default function UndoChip({ undoId, label = 'Undo', call, clientId, onUndone }) {
  const [state, setState] = useState({ busy: false, done: false, err: '' });
  const run = async () => {
    if (state.busy || state.done || typeof call !== 'function') return;
    setState({ busy: true, done: false, err: '' });
    try {
      await call('strategy-action-undo', { clientId, undoId });
      setState({ busy: false, done: true, err: '' });
      if (typeof onUndone === 'function') onUndone(undoId);
    } catch (e) {
      setState({ busy: false, done: false, err: e?.data?.error || e?.message || 'Could not undo.' });
    }
  };
  return (
    <div id={`x-strategy-undo-chip-row-${undoId}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 4 }}>
      {state.done ? (
        <span id={`x-strategy-undo-chip-done-${undoId}`} role="status" style={{ fontSize: 12.5, color: XCE_COLORS.green }}>Undone</span>
      ) : (
        <button type="button" id={`x-strategy-undo-chip-${undoId}`} style={chip} disabled={state.busy} onClick={run}>
          <Undo2 size={14} /> {state.busy ? 'Undoing…' : label}
        </button>
      )}
      {state.err ? <span id={`x-strategy-undo-chip-error-${undoId}`} role="alert" style={{ fontSize: 12, color: XCE_COLORS.red }}>{state.err}</span> : null}
    </div>
  );
}
