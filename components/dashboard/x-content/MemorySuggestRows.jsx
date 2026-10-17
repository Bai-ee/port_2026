'use client';

import React from 'react';
import { memorySuggestModel } from '../../../features/x-strategy/ui-model.js';

// MemorySuggestRows - the per-row editor inside a pending `memory-suggest` proposal card.
// PRESENTATION ONLY: `state` = {edits:{postId:text}, skip:[postId]} lives in StrategyChat and is sent with the decide call.
// Every line is a SUGGESTION built from the library item's facts (or written by the agent); the owner edits or skips it.

const S = {
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 },
  row: { display: 'grid', gap: 4, padding: 8, border: '1px solid var(--t-control-border)', borderRadius: 8, minWidth: 0 },
  rowSkipped: { opacity: 0.5 },
  head: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', minWidth: 0 },
  title: { fontWeight: 600, fontSize: 13, minWidth: 0, overflowWrap: 'anywhere' },
  tag: { fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--t-text-muted, var(--t-text))', textTransform: 'uppercase' },
  current: { fontSize: 12, opacity: 0.7, margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  input: { width: '100%', boxSizing: 'border-box', minHeight: 44, padding: 6, font: 'inherit', fontSize: 13, color: 'var(--t-text)', background: 'var(--t-surface)', border: '1px solid var(--t-control-border)', borderRadius: 6, resize: 'vertical' },
  skipBtn: { background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 12, textDecoration: 'underline', color: 'var(--t-text)' },
  note: { fontSize: 12, margin: 0, opacity: 0.8 },
};

export default function MemorySuggestRows({ proposal, state, disabled, onChange }) {
  const id = proposal.id;
  const model = memorySuggestModel(proposal, state);
  const set = (next) => onChange({ edits: next.edits ?? state?.edits ?? {}, skip: next.skip ?? state?.skip ?? [] });
  return (
    <div id={`x-strategy-proposal-memory-suggest-${id}`} data-section="chat-proposal-memory-suggest" style={{ display: 'grid', gap: 6 }}>
      <p id={`x-strategy-proposal-memory-suggest-note-${id}`} style={S.note}>
        Suggested lines, not your words. Edit each one or skip it; only the lines you keep replace the placeholder.
      </p>
      <ul id={`x-strategy-proposal-memory-suggest-list-${id}`} style={S.list}>
        {model.rows.map((r) => (
          <li key={r.postId} id={`x-strategy-proposal-memory-row-${id}-${r.postId}`} style={{ ...S.row, ...(r.skipped ? S.rowSkipped : {}) }}>
            <div style={S.head}>
              <span style={S.title}>{r.title || r.postId}</span>
              <button type="button" id={`x-strategy-proposal-memory-skip-${id}-${r.postId}`} style={S.skipBtn} disabled={disabled}
                onClick={() => set({ skip: (state?.skip || []).includes(r.postId) ? (state?.skip || []).filter((x) => x !== r.postId) : [...(state?.skip || []), r.postId] })}>
                {(state?.skip || []).includes(r.postId) ? 'Include' : 'Skip'}
              </button>
            </div>
            <p style={S.current}>{r.currentText}</p>
            <span style={S.tag}>{r.source === 'agent' ? 'Suggested by the assistant' : 'Suggested from the item facts'}{r.edited ? ' - edited' : ''}</span>
            <textarea id={`x-strategy-proposal-memory-input-${id}-${r.postId}`} style={S.input} rows={2} maxLength={200} disabled={disabled}
              value={r.text} aria-label={`Memory line for ${r.title || r.postId}`}
              onChange={(e) => set({ edits: { ...(state?.edits || {}), [r.postId]: e.target.value } })} />
          </li>
        ))}
      </ul>
    </div>
  );
}
