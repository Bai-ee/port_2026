'use client';

import React from 'react';
import { AlertTriangle, CalendarDays, Image as ImageIcon, PenSquare, RefreshCw } from 'lucide-react';

// PlanPanel — one day of the posting plan, rendered.
//
// PURE PRESENTATION. It fetches nothing, owns no data state, and never decides
// what goes in a slot: `plan` is whatever `buildDayPlan` (features/x-content-
// inventory/plan-day.js) returned, and every row here is a readout of the match
// that module already made. Fetch/refresh/draft state lives in the parent card.
//
// ⚠️ STYLING: this file emits className strings only — NO `<style jsx>` block.
// The parent card owns every rule in ONE `<style jsx global>` block prefixed by
// its own id, because scoped styled-jsx silently skips markup returned from a
// helper or a mapped array (the trap documented in XCalendarCard.jsx and
// XMonitorCard.jsx). Every class here starts with `xce-`.
//
// The thumbnails are deliberately CSS-only placeholders: the archive is not
// populated yet, so a tile showing the series code is an honest stand-in
// rather than a broken <img>.

/** The two cadence tiers `buildDayPlan` understands (`posts` → tier). */
const TIERS = [
  { posts: 5, label: 'Foundation' },
  { posts: 8, label: 'Competitive' },
];

/** Slot types that are filled outside the inventory still belong to a series —
 * C8 runs the quote-react slots, C9 the self-quote ones (features/x-content-
 * inventory/categories.js). Mapping them here keeps every content row's tile
 * labelled instead of leaving the automated slots blank. */
const TYPE_TO_SERIES = {
  'quote-react': 'C8',
  'quote-commentary': 'C8',
  'self-quote': 'C9',
};

function seriesCode(slot) {
  return slot?.series || TYPE_TO_SERIES[slot?.type] || null;
}

function rowKey(slot, index) {
  return slot?.slot ?? `s${index}`;
}

function excerpt(value, max = 160) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A gap is an inventory slot that came back without a package. Scan and ledger
 * slots also lack `packageId` by design, so the source has to be checked too —
 * calling those gaps would report a shortfall that does not exist. */
function isGapSlot(slot) {
  return slot?.source === 'inventory' && !slot?.packageId;
}

export default function PlanPanel({
  plan,
  loading,
  error,
  posts,
  onPostsChange,
  onRefresh,
  onDraft,
  draftingId,
  drafts,
}) {
  const slots = Array.isArray(plan?.slots) ? plan.slots : [];
  const gaps = Array.isArray(plan?.gaps) ? plan.gaps : [];
  const total = slots.length;
  const filled = Number.isFinite(plan?.filled) ? plan.filled : slots.filter((s) => s?.packageId).length;
  const unfilled = Number.isFinite(plan?.unfilled) ? plan.unfilled : gaps.length;

  // `gaps` carries the "what would have filled this" string; the slot row only
  // knows it is empty. Keyed on slot + type, which is what match.js writes.
  const gapByKey = new Map(gaps.map((g) => [`${g?.slot ?? ''}|${g?.type ?? ''}`, g]));

  return (
    <div id="x-content-plan-panel" className="xce-panel">
      <div id="x-content-plan-header" className="xce-head">
        <span className="xce-head-date">
          <CalendarDays size={13} /> {plan?.date || '—'}
        </span>
        <span className="xce-head-count">{filled}/{total} slots</span>

        <div
          id="x-content-plan-tier-selector"
          className="xce-tier-selector"
          role="group"
          aria-label="Posts per day"
        >
          {TIERS.map((tier) => (
            <button
              key={tier.posts}
              type="button"
              id={`x-content-plan-tier-${tier.posts}`}
              className={`xce-tier-option${Number(posts) === tier.posts ? ' xce-tier-option-active' : ''}`}
              aria-pressed={Number(posts) === tier.posts}
              disabled={!onPostsChange || loading}
              onClick={() => onPostsChange && onPostsChange(tier.posts)}
            >
              {tier.posts} · {tier.label}
            </button>
          ))}
        </div>

        {onRefresh ? (
          <button
            type="button"
            id="x-content-plan-refresh-button"
            className="xce-refresh"
            onClick={onRefresh}
            disabled={!!loading}
          >
            {loading
              ? <span className="comet-spinner" style={{ width: 13, height: 13, ['--comet-ring']: '2px' }} aria-hidden="true" />
              : <RefreshCw size={13} />}
            Refresh
          </button>
        ) : null}
      </div>

      {error ? (
        <p id="x-content-plan-error" className="xce-error">
          <AlertTriangle size={13} /> {typeof error === 'string' ? error : (error?.message || 'Could not load the plan.')}
        </p>
      ) : null}

      {loading ? (
        <div id="x-content-plan-loading" className="xce-loading">Loading the plan…</div>
      ) : null}

      {!loading && !error && !total ? (
        <div id="x-content-plan-empty-state" className="xce-empty">
          <p>No slots in this plan.</p>
          <p className="xce-empty-note">Nothing has been generated for this day yet.</p>
        </div>
      ) : null}

      {!loading && total && unfilled > 0 ? (
        <p id="x-content-plan-shortfall-note" className="xce-shortfall">
          {unfilled} of {total} slots unfilled — the inventory is short, not broken.
        </p>
      ) : null}

      {!loading && total ? (
        <ol id="x-content-plan-slot-list" className="xce-slot-list">
          {slots.map((slot, index) => {
            const key = rowKey(slot, index);
            const gap = isGapSlot(slot);
            const gapRow = gap ? gapByKey.get(`${slot?.slot ?? ''}|${slot?.type ?? ''}`) : null;
            const code = seriesCode(slot);
            const busy = draftingId != null && String(draftingId) === String(key);
            const draft = drafts ? drafts[key] : null;
            const check = draft?.check || null;
            const canDraft = !!onDraft && (!!slot?.packageId || (slot?.source === 'ledger' && !!slot?.story));

            return (
              <li
                key={key}
                id={`x-content-plan-slot-${key}`}
                className={`xce-slot xce-slot-${slot?.source || 'unknown'}${gap ? ' xce-gap' : ''}`}
              >
                <div className="xce-slot-head">
                  <span className="xce-slot-time">{slot?.timeCT || '—'}</span>
                  <span className="xce-slot-type">{slot?.type || '—'}</span>
                  {slot?.lane ? <span className="xce-slot-lane">{slot.lane}</span> : null}
                  {slot?.adopted ? (
                    <span
                      className="xce-chip xce-chip-adopted"
                      title={slot.adoptReason || 'adopted from the benchmark mix'}
                    >
                      adopted slot
                    </span>
                  ) : null}
                  {Number.isFinite(Number(slot?.matchScore)) && slot?.matchScore != null ? (
                    <span className="xce-slot-score">{Number(slot.matchScore).toFixed(2)}</span>
                  ) : null}
                </div>

                <div className="xce-slot-body">
                  <span
                    className={`xce-thumb${gap ? ' xce-thumb-gap' : ''}`}
                    aria-hidden="true"
                  >
                    {gap ? <ImageIcon size={16} /> : <span className="xce-thumb-code">{code || '—'}</span>}
                  </span>

                  <div className="xce-slot-detail">
                    {gap ? (
                      <>
                        <p className="xce-gap-label">Gap</p>
                        <p className="xce-gap-need">{gapRow?.need || slot?.matchReason || 'nothing in inventory fills this slot'}</p>
                      </>
                    ) : null}

                    {!gap && slot?.source === 'scan' ? (
                      <p className="xce-muted">From the daily scan</p>
                    ) : null}

                    {!gap && slot?.source === 'ledger' ? (
                      <>
                        {slot?.story ? <p className="xce-post-text">{excerpt(slot.story, 220)}</p> : null}
                        {slot?.asset ? (
                          <p className="xce-asset">
                            <a href={slot.asset} target="_blank" rel="noopener noreferrer">↗ post</a>
                          </p>
                        ) : null}
                        {slot?.matchReason ? <p className="xce-reason">{slot.matchReason}</p> : null}
                      </>
                    ) : null}

                    {!gap && slot?.source === 'inventory' && slot?.packageId ? (
                      <>
                        <p className="xce-pkg-line">
                          <span className="xce-pkg-id">{slot.packageId}</span>
                          {code ? <span className="xce-chip xce-chip-series">{code}</span> : null}
                        </p>
                        {slot?.story ? <p className="xce-story">{excerpt(slot.story)}</p> : null}
                        {slot?.asset ? <p className="xce-asset">{slot.asset}</p> : null}
                        {slot?.selfReply ? (
                          <p className="xce-self-reply">
                            <span className="xce-self-reply-label">Self-reply</span> {excerpt(slot.selfReply, 120)}
                          </p>
                        ) : null}
                        {slot?.matchReason ? <p className="xce-reason">{slot.matchReason}</p> : null}
                      </>
                    ) : null}
                  </div>
                </div>

                {canDraft ? (
                  <div className="xce-slot-actions">
                    <button
                      type="button"
                      id={`x-content-plan-draft-button-${key}`}
                      className="xce-draft-button"
                      onClick={() => onDraft(slot)}
                      disabled={busy}
                    >
                      {busy
                        ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" />
                        : <PenSquare size={14} />}
                      Draft copy
                    </button>
                  </div>
                ) : null}

                {/* The draft is a deterministic truncation of the author's own
                    story — no model wrote it, and nothing here posts or saves
                    it, so there is no action beyond reading it. */}
                {draft ? (
                  <div id={`x-content-plan-draft-${key}`} className="xce-draft">
                    <p className="xce-draft-text">{draft.text}</p>
                    <p className={`xce-draft-meta${check && check.ok === false ? ' xce-draft-bad' : ''}`}>
                      {Number.isFinite(Number(check?.chars)) ? `${Number(check.chars)} chars` : '— chars'}
                      {' · '}
                      {check && check.ok === false && Array.isArray(check.violations) && check.violations.length
                        ? check.violations.join('; ')
                        : 'rules ok'}
                    </p>
                    <p className="xce-muted">Preview only. Cut from your story, not model-written.</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {!loading && plan?.audit ? (
        <p id="x-content-plan-audit-line" className="xce-audit">
          {plan.audit.valid ?? 0}/{plan.audit.total ?? 0} packages valid
        </p>
      ) : null}
    </div>
  );
}
