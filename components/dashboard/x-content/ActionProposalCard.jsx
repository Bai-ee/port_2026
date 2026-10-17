'use client';

import React, { useState } from 'react';
import { actionCardModel, typedMatches } from '../../../features/x-strategy/action-ui-model.js';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';
import Badge from '../content-ui/ui/Badge';

// ActionProposalCard - confirm card for proposal.kind === 'action' (generic run_action tier 1-3).
//   <ActionProposalCard proposal deciding onDecide(proposal, decision, extra) />
// Danger tone for destructive/external actions; typed confirm input when the model asks for it. The typed
// text is sent as `typed` in the decide body (the server re-checks it). Presentation only; StrategyChat owns the call.

const TONES = {
  danger: { border: XCE_COLORS.redBorder, bg: XCE_COLORS.redBg, ink: XCE_COLORS.red },
  warn: { border: XCE_COLORS.amberBorder, bg: XCE_COLORS.amberBg, ink: XCE_COLORS.amber },
  info: { border: XCE_COLORS.border, bg: XCE_COLORS.surface, ink: XCE_COLORS.inkSoft },
};

const S = {
  card: { padding: '12px 14px', borderRadius: XCE_RADII.md + 2, display: 'grid', gap: 8, minWidth: 0 },
  head: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  kind: { fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
  title: { fontSize: 14, fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere' },
  lines: { margin: 0, paddingLeft: 16, fontSize: 12.5, lineHeight: 1.5, overflowWrap: 'anywhere' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  label: { fontSize: 12.5, lineHeight: 1.4, color: XCE_COLORS.inkSoft },
  input: { boxSizing: 'border-box', width: '100%', minHeight: 44, padding: '10px 12px', borderRadius: XCE_RADII.md, border: `1px solid ${XCE_COLORS.border}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, font: 'inherit', fontSize: 16 },
  result: { margin: 0, fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.inkSoft },
};

export default function ActionProposalCard({ proposal, deciding, onDecide }) {
  const id = proposal.id;
  const model = actionCardModel(proposal);
  const tone = TONES[model.tone] || TONES.info;
  const [typed, setTyped] = useState('');
  const pending = proposal.status === 'pending';
  const confirmed = proposal.status === 'confirmed';
  const canConfirm = pending && !deciding && typedMatches(model, typed);
  const statusLabel = pending ? 'Needs your OK' : confirmed ? 'Done' : proposal.status === 'rejected' ? 'Rejected' : String(proposal.status || '');
  const resultText = !pending && (proposal.result?.message || proposal.resultText || proposal.error);

  return (
    <div id={`x-strategy-action-card-${id}`} data-section="chat-proposal-action" data-tone={model.tone} style={{ ...S.card, background: tone.bg, border: `1px solid ${tone.border}` }}>
      <div id={`x-strategy-action-card-header-${id}`} style={S.head}>
        <span style={{ ...S.kind, color: tone.ink }}>{model.tone === 'danger' ? 'Needs careful OK' : 'Action'}</span>
        <Badge id={`x-strategy-action-card-status-${id}`} tone={pending ? 'amber' : confirmed ? 'green' : 'grey'}>{statusLabel}</Badge>
      </div>
      <div id={`x-strategy-action-card-title-${id}`} style={S.title}>{model.title}</div>
      {model.warningLines.length ? (
        <ul id={`x-strategy-action-card-warnings-${id}`} style={{ ...S.lines, color: model.tone === 'danger' ? tone.ink : XCE_COLORS.ink }}>
          {model.warningLines.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      ) : null}
      {pending && model.needsTyped ? (
        <label id={`x-strategy-action-card-typed-row-${id}`} style={{ display: 'grid', gap: 4 }}>
          <span style={S.label}>Type <b style={{ color: XCE_COLORS.ink }}>{model.confirmText}</b> to confirm</span>
          <input
            id={`x-strategy-action-card-typed-input-${id}`}
            style={S.input}
            value={typed}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={deciding}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
      ) : null}
      {pending ? (
        <div id={`x-strategy-action-card-actions-${id}`} style={S.row}>
          <button type="button" id={`x-strategy-action-card-confirm-${id}`} className="xce-btn" disabled={!canConfirm} onClick={() => onDecide(proposal, 'confirm', model.needsTyped ? { typed: typed.trim() } : undefined)}>
            {deciding ? 'Working…' : model.confirmLabel}
          </button>
          <button type="button" id={`x-strategy-action-card-reject-${id}`} className="xce-btn xce-btn-ghost" disabled={deciding} onClick={() => onDecide(proposal, 'reject')}>
            Reject
          </button>
        </div>
      ) : null}
      {resultText ? <p id={`x-strategy-action-card-result-${id}`} role="status" style={S.result}>{String(resultText)}</p> : null}
    </div>
  );
}
