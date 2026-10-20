'use client';

import React from 'react';
import { Check, Clock, Quote, Sparkles, X } from 'lucide-react';
import { FILTERS, APPROVAL_LABEL, rowMark, canApproveRow, canUnapproveRow, isRowWindowClosed, windowLeftLabel } from './calendar-row-model.js';

// One-calendar approval marks, filter chips and the suggestion / requote row.
// Presentation only: handlers come from MonthCalendarPanel. Tokens only (no colour literals).

/** Quick Pass on a Day-list row: off the calendar now, no confirm (content can come back later). */
export function PassRowButton({ row, busy, onPass }) {
  return (
    <button type="button" id={`stage-day-row-pass-${row.id}`} className="xce-mc-icon-btn xce-ap-pass-btn" disabled={busy} title="Pass: take it off this day. It can come back later." aria-label="Pass" onClick={() => onPass(row)}>
      <X size={14} />
    </button>
  );
}

const MARK_LABEL = { ...APPROVAL_LABEL, suggestion: 'Suggestion', requote: 'Requote' };

/** unapproved = hollow, approved = filled, scheduled = clock, posted = check, suggestion = sparkle, requote = quote. */
export function ApprovalMark({ row, id }) {
  const mark = rowMark(row);
  let glyph;
  if (mark === 'scheduled') glyph = <Clock size={11} />;
  else if (mark === 'posted') glyph = <Check size={11} strokeWidth={3} />;
  else if (mark === 'suggestion') glyph = <Sparkles size={11} />;
  else if (mark === 'requote') glyph = <Quote size={11} />;
  else glyph = <span className={`xce-ap-dot xce-ap-dot-${mark}`} />;
  return (
    <span id={id} className={`xce-ap-mark xce-ap-mark-${mark}`} data-approval={mark} title={MARK_LABEL[mark] || mark} aria-label={MARK_LABEL[mark] || mark} role="img">
      {glyph}
    </span>
  );
}

export function FilterChips({ value, onChange, counts }) {
  return (
    <div id="x-content-month-approval-filter-chips" className="xce-ap-chips" role="group" aria-label="Filter by approval">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          id={`x-content-month-approval-filter-${f.value}`}
          className={`xce-mc-text-btn xce-ap-chip${value === f.value ? ' xce-mc-filter-on' : ''}`}
          aria-pressed={value === f.value}
          onClick={() => onChange(f.value)}
        >
          {f.label}{counts && counts[f.value] != null ? <span className="xce-ap-chip-count">{counts[f.value]}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Inline Approve / Unapprove for a saved post row (approving never schedules). */
export function InlineApprovalButtons({ row, busy, onApprove, onUnapprove }) {
  if (canUnapproveRow(row) && onUnapprove) {
    return <button type="button" id={`x-content-month-row-unapprove-${row.id}`} className="xce-mc-text-btn xce-ap-btn" disabled={busy} onClick={() => onUnapprove(row)}>Unapprove</button>;
  }
  if (canApproveRow(row) && onApprove) {
    return <button type="button" id={`x-content-month-row-approve-only-${row.id}`} className="xce-mc-text-btn xce-ap-btn" disabled={busy} title="Approve without scheduling" onClick={() => onApprove(row)}>Approve</button>;
  }
  return null;
}

/** An unsaved daily-run suggestion or an open quote target. Leaving it writes nothing. */
// onView (calendar day view only): adds VIEW POST, which opens the X preview.
export function SuggestionRow({ row, busy, onApprove, nowMs, onView, onPass }) {
  const requote = row.kind === 'requote';
  const closed = isRowWindowClosed(row, nowMs);
  const left = requote ? windowLeftLabel(row, nowMs) : '';
  const handle = row.handle || row.quotedHandle || null;
  const url = row.quotedUrl || row.url || null;
  return (
    <li id={`x-content-month-suggestion-${row.id}`} className={`xce-mc-row xce-ap-suggestion${closed ? ' xce-mc-row-expired' : ''}`} data-kind={row.kind || 'suggestion'}>
      <div className="xce-mc-row-main xce-ap-suggestion-main">
        <span className="xce-mc-row-time">{row.time || row.slot || '—'}</span>
        <ApprovalMark row={row} id={`x-content-month-suggestion-mark-${row.id}`} />
        <span className="xce-mc-row-body">
          <span id={`x-content-month-suggestion-title-${row.id}`} className="xce-mc-row-title">{row.text || row.title || '(no text)'}</span>
          <span className="xce-mc-row-meta">
            {requote ? 'Requote' : 'Suggested'}
            {requote && row.hot ? ` · ${row.hot.lane} · ${row.hot.momentum}${row.slotKind === 'extra' ? ' · extra' : ''}` : ''}
            {row.type ? ` · ${row.type}` : ''}
            {requote && handle ? <> · <span id={`x-content-month-suggestion-handle-${row.id}`}>@{String(handle).replace(/^@/, '')}</span></> : null}
            {requote && url ? <> · <a id={`x-content-month-suggestion-link-${row.id}`} href={url} target="_blank" rel="noopener noreferrer">view post</a></> : null}
            {requote && row.hot?.why ? <span id={`x-content-month-suggestion-why-${row.id}`}> · {row.hot.why}</span> : null}
            {left ? <span id={`x-content-month-suggestion-window-${row.id}`} className={closed ? 'xce-mc-fill-closed' : 'xce-mc-fill-badge'}>{left}</span> : null}
          </span>
        </span>
      </div>
      {onApprove || onView ? (
        <span className="xce-mc-row-actions">
          {onView ? <button type="button" id={`x-content-month-suggestion-view-${row.id}`} className="xce-mc-text-btn xce-ap-btn" onClick={() => onView(row)}>View post</button> : null}
          {onApprove ? <button type="button" id={`x-content-month-suggestion-approve-${row.id}`} className="xce-mc-text-btn xce-ap-btn" disabled={busy || closed} title="Save as a draft and approve. Nothing is scheduled or posted." onClick={() => onApprove(row)}>
            {busy ? 'Saving…' : 'Approve'}
          </button> : null}
        </span>
      ) : null}
      {onPass ? <span className="xce-mc-row-actions"><PassRowButton row={row} busy={busy} onPass={onPass} /></span> : null}
    </li>
  );
}

export function CalendarApprovalStyles() {
  return (
    <style>{`
      .xce-scope .xce-ap-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .xce-scope .xce-ap-chip { display: inline-flex; align-items: center; gap: 6px; }
      .xce-scope .xce-ap-chip-count { font-family: var(--font-mono); font-size: 11px; opacity: 0.7; }
      .xce-scope .xce-ap-mark { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; color: var(--t-text); }
      .xce-scope .xce-ap-dot { width: 9px; height: 9px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid var(--t-text); background: transparent; }
      .xce-scope .xce-ap-dot-approved { background: var(--t-text); }
      .xce-scope .xce-ap-dot-held { border-style: dashed; }
      .xce-scope .xce-ap-mark-failed .xce-ap-dot { border-color: var(--t-danger); background: var(--t-danger); }
      .xce-scope .xce-ap-mark-posted { opacity: 0.6; }
      .xce-scope .xce-ap-suggestion { border-style: dashed; }
      .xce-scope .xce-ap-suggestion-main { display: flex; align-items: flex-start; gap: 8px; flex: 1 1 auto; min-width: 0; text-align: left; }
      .xce-scope .xce-ap-btn { white-space: nowrap; }
      .xce-scope .xce-ap-note { margin: 0; font-size: 12px; color: var(--t-danger); }
      .xce-scope .xce-ap-chip-mark { display: inline-flex; margin-right: 2px; }
    `}</style>
  );
}
