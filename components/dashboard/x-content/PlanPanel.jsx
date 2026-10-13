'use client';

import { usePlanProps } from './standalone.js';
import React from 'react';
import { Skeleton, RetryError } from '../content-ui/Feedback.jsx';
import { AlertTriangle, ArrowUpRight, CalendarDays, Image as ImageIcon, PenSquare, Plus, RefreshCw, Search } from 'lucide-react';
import Accordion from '../content-ui/ui/Accordion.jsx';
import Badge from '../content-ui/ui/Badge.jsx';
import Card from '../content-ui/ui/Card.jsx';
import { XCE_COLORS, XCE_RADII, XCE_TYPE } from '../content-ui/xce-tokens';

// PlanPanel — one day of the posting plan, rendered.
//
// PURE PRESENTATION. It fetches nothing, owns no data state, and never decides
// what goes in a slot: `plan` is whatever `buildDayPlan` (features/x-content-
// inventory/plan-day.js) returned, and every row here is a readout of the match
// that module already made. Fetch/refresh/draft state lives in the parent card.
//
// STYLING: inline style props built from the ui/* primitives + xce-tokens (the
// Today restyle, mock 06). Only the header controls (tier picker, refresh) and
// the draft read-out still use the card's shared `xce-*` classes. One
// `<style jsx global>` block (selectors prefixed `.xce-scope`) covers the
// gaps accordion header; no scoped `<style jsx>` (it skips helper/mapped markup).
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

const S = {
  panel: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 },
  mono: { fontFamily: XCE_TYPE.mono },
  btnSolid: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, padding: '0 14px',
    border: `1px solid ${XCE_COLORS.ink}`, borderRadius: XCE_RADII.md, background: XCE_COLORS.ink, color: XCE_COLORS.onInk,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  btnOutline: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, padding: '0 14px',
    border: `1px solid ${XCE_COLORS.borderStrong}`, borderRadius: XCE_RADII.md, background: XCE_COLORS.surface, color: XCE_COLORS.ink,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  text: { margin: 0, fontSize: 14, lineHeight: 1.35, color: XCE_COLORS.ink, overflowWrap: 'anywhere' },
  muted: { margin: 0, fontSize: 12.5, lineHeight: 1.4, color: XCE_COLORS.inkSoft, overflowWrap: 'anywhere' },
  toggle: {
    alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 28, padding: 0, border: 0,
    background: 'none', cursor: 'pointer', fontFamily: XCE_TYPE.mono, fontSize: 11.5, color: XCE_COLORS.inkSoft,
  },
};

function Thumb({ gap, code }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto', width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: XCE_RADII.md,
        border: `1px solid ${gap ? XCE_COLORS.amberBorder : XCE_COLORS.border}`,
        background: gap ? XCE_COLORS.amberBg : XCE_COLORS.surfaceMuted,
        color: gap ? XCE_COLORS.amber : XCE_COLORS.ink,
        ...S.mono, fontSize: 12, fontWeight: 700,
      }}
    >
      {gap ? <ImageIcon size={18} /> : (code || '—')}
    </span>
  );
}

// One slot. A real component (not inlined in the map) so each row owns its Details toggle state.
function SlotRow({ slot, rowId, gapRow, onDraft, onOpenContent, busy, draft }) {
  const [open, setOpen] = React.useState(false);
  const gap = isGapSlot(slot);
  const code = seriesCode(slot);
  const check = draft?.check || null;
  const hasScore = Number.isFinite(Number(slot?.matchScore)) && slot?.matchScore != null;
  const isInventoryFill = !gap && slot?.source === 'inventory' && !!slot?.packageId;
  const hasDetails = !!slot?.lane || !!slot?.adopted || hasScore
    || (!gap && !!slot?.matchReason)
    || (isInventoryFill && (!!slot?.asset || !!slot?.selfReply || !!slot?.packageId));
  const canDraft = !!onDraft && (!!slot?.packageId || (slot?.source === 'ledger' && !!slot?.story));

  let title = null;
  if (gap) title = gapRow?.need || slot?.matchReason || 'nothing in inventory fills this slot';
  else if (slot?.source === 'none') title = 'Skipped (engine quota)';
  else if (slot?.source === 'scan') title = 'From the daily scan';
  else if (slot?.story) title = excerpt(slot.story, isInventoryFill ? 160 : 220);

  return (
    <li
      id={`x-content-plan-slot-${rowId}`}
      className={`xce-slot-${slot?.source || 'unknown'}`}
      style={{ listStyle: 'none', margin: 0 }}
    >
      <Card padding={12} tone={gap ? 'amber' : undefined} id={`x-plan-slot-card-${rowId}`}>
        <div id={`x-plan-slot-row-${rowId}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <div id={`x-plan-slot-time-${rowId}`} style={{ flex: '0 0 52px', minWidth: 0, ...S.mono, fontSize: 12, color: XCE_COLORS.inkSoft }}>
            <div style={{ color: XCE_COLORS.ink, fontWeight: 600 }}>{slot?.timeCT || '—'}</div>
            <div style={{ marginTop: 2, fontSize: 10.5, overflowWrap: 'anywhere' }}>{slot?.type || '—'}</div>
          </div>
          <Thumb gap={gap} code={code} />
          <div id={`x-plan-slot-detail-${rowId}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {gap ? <div><Badge tone="amber">Needs content</Badge></div> : null}
            {title ? <p style={gap ? S.muted : S.text}>{title}</p> : null}
            {!gap && slot?.source === 'ledger' && slot?.asset ? (
              <a href={slot.asset} target="_blank" rel="noopener noreferrer" style={{ ...S.muted, textDecoration: 'underline' }}>↗ post</a>
            ) : null}
            {hasDetails ? (
              <button type="button" id={`x-plan-slot-details-toggle-${rowId}`} aria-expanded={open} style={S.toggle} onClick={() => setOpen((v) => !v)}>
                <Plus size={12} style={{ transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 120ms ease' }} /> Details
              </button>
            ) : null}
          </div>
        </div>

        {(gap && onOpenContent) || canDraft ? (
          <div id={`x-plan-slot-actions-${rowId}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10, paddingLeft: 62 }}>
          {gap && onOpenContent ? (
            <button type="button" id={`x-plan-find-content-button-${rowId}`} style={{ ...S.btnSolid, minHeight: 36 }} onClick={onOpenContent}>
              Find content
            </button>
          ) : null}
          {canDraft ? (
            <button
              type="button"
              id={`x-content-plan-draft-button-${rowId}`}
              style={{ ...S.btnOutline, minHeight: 36, opacity: busy ? 0.6 : 1 }}
              onClick={() => onDraft(slot)}
              disabled={busy}
            >
              {busy
                ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" />
                : <PenSquare size={14} />}
              Draft copy
            </button>
          ) : null}
          </div>
        ) : null}

        {hasDetails && open ? (
          <div id={`x-content-plan-slot-details-${rowId}`} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${XCE_COLORS.border}`, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {slot?.lane ? <Badge tone="grey">{slot.lane}</Badge> : null}
            {slot?.adopted ? (
              <Badge tone="blue"><span title={slot.adoptReason || 'adopted from the benchmark mix'}>adopted slot</span></Badge>
            ) : null}
            {hasScore ? <Badge tone="grey">score {Number(slot.matchScore).toFixed(2)}</Badge> : null}
            {isInventoryFill ? (
              <p style={{ ...S.muted, flexBasis: '100%', ...S.mono }}>
                {slot.packageId}{code ? <> · <Badge tone="grey">{code}</Badge></> : null}
              </p>
            ) : null}
            {isInventoryFill && slot?.asset ? <p style={{ ...S.muted, flexBasis: '100%' }}>{slot.asset}</p> : null}
            {isInventoryFill && slot?.selfReply ? (
              <p style={{ ...S.muted, flexBasis: '100%' }}><strong>Self-reply</strong> {excerpt(slot.selfReply, 120)}</p>
            ) : null}
            {slot?.matchReason && !gap ? <p style={{ ...S.muted, flexBasis: '100%' }}>{slot.matchReason}</p> : null}
          </div>
        ) : null}

        {/* The draft is a deterministic truncation of the author's own story —
            no model wrote it, and nothing here posts or saves it. */}
        {draft ? (
          <div id={`x-content-plan-draft-${rowId}`} style={{ marginTop: 10, padding: 10, borderRadius: XCE_RADII.md, background: XCE_COLORS.surfaceMuted }}>
            <p style={S.text}>{draft.text}</p>
            <p className={`xce-draft-meta${check && check.ok === false ? ' xce-draft-bad' : ''}`} style={{ ...S.muted, ...S.mono, marginTop: 6, color: check && check.ok === false ? XCE_COLORS.red : undefined }}>
              {Number.isFinite(Number(check?.chars)) ? `${Number(check.chars)} chars` : '— chars'}
              {' · '}
              {check && check.ok === false && Array.isArray(check.violations) && check.violations.length
                ? check.violations.join('; ')
                : 'rules ok'}
            </p>
            <p id={`x-content-plan-draft-details-${rowId}`} style={{ ...S.muted, marginTop: 4 }}>Preview only. Cut from your story, not model-written.</p>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function PlanPanelView({
  plan,
  loading,
  error,
  posts,
  onPostsChange,
  onRefresh,
  hideRefresh = false,
  planSource,
  planVersion,
  onOpenStrategy,
  onOpenContent,
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
    <div id="x-content-plan-panel" className="xce-panel" style={S.panel}>
      <style jsx global>{`
        .xce-scope #x-plan-gaps-accordion { border-top: 0 !important; }
        .xce-scope #x-plan-gaps-accordion > button { color: ${XCE_COLORS.amber} !important; font-weight: 600; }
      `}</style>

      <Card id="x-plan-summary-card" padding={12}>
        <div id="x-content-plan-header" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div id="x-plan-summary-title" style={{ fontSize: 16, fontWeight: 700, color: XCE_COLORS.ink }}>
              {total} planned slot{total === 1 ? '' : 's'}
            </div>
            <div style={{ ...S.mono, fontSize: 11.5, color: XCE_COLORS.inkSoft, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <CalendarDays size={12} /> {plan?.date || '—'} · {filled}/{total} filled
            </div>
          </div>
          {onRefresh && !hideRefresh ? (
            <button
              type="button"
              id="x-content-plan-refresh-button"
              style={{ ...S.btnOutline, opacity: loading ? 0.6 : 1 }}
              onClick={onRefresh}
              disabled={!!loading}
            >
              {loading
                ? <span className="comet-spinner" style={{ width: 13, height: 13, ['--comet-ring']: '2px' }} aria-hidden="true" />
                : <RefreshCw size={13} />}
              Refresh
            </button>
          ) : null}
          {onOpenStrategy ? (
            <button type="button" id="x-plan-strategy-link-button" style={S.btnOutline} onClick={onOpenStrategy}>
              Strategy <ArrowUpRight size={14} />
            </button>
          ) : null}
        </div>

        {planSource === 'plan-doc' ? (
          // A Strategy plan doc decides the cadence: the picker is a read-out, the change happens in the Strategy tab.
          <div id="x-content-plan-cadence-readout" style={{ marginTop: 10 }}>
            <span id="x-content-plan-cadence-text" style={S.muted}>
              {total}/day from Strategy plan v{planVersion ?? '?'} — change it in the Strategy tab
            </span>
            {onOpenStrategy ? (
              <button type="button" id="x-content-plan-open-strategy-button" style={{ ...S.toggle, marginLeft: 8, textDecoration: 'underline', display: 'inline-flex' }} onClick={onOpenStrategy}>
                Open Strategy
              </button>
            ) : null}
          </div>
        ) : (
          <div
            id="x-content-plan-tier-selector"
            className="xce-tier-selector"
            role="group"
            aria-label="Posts per day"
            style={{ marginTop: 10 }}
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
        )}
      </Card>

      {error ? (
        <RetryError id="x-content-plan-error" message={typeof error === 'string' ? error : (error?.message || 'Could not load the plan.')} onRetry={onRefresh} busy={!!loading} />
      ) : null}

      {loading ? (
        <Skeleton id="x-content-plan-loading" rows={4} variant="row" />
      ) : null}

      {!loading && !error && !total ? (
        <div id="x-content-plan-empty-state" className="xce-empty">
          <p>No slots in this plan.</p>
          <p className="xce-empty-note">Nothing has been generated for this day yet.</p>
        </div>
      ) : null}

      {!loading && total && unfilled > 0 ? (
        <Card id="x-plan-gaps-card" tone="amber" padding="0 14px">
          <Accordion
            id="x-plan-gaps-accordion"
            title={
              <span id="x-content-plan-shortfall-note" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} /> {unfilled} slot{unfilled === 1 ? '' : 's'} need content
              </span>
            }
          >
            <p style={{ ...S.muted, color: XCE_COLORS.amber }}>
              {unfilled} of {total} slots unfilled — the inventory is short, not broken.
            </p>
            {onOpenContent ? (
              <button type="button" id="x-plan-gaps-find-content-button" style={{ ...S.btnOutline, marginTop: 8 }} onClick={onOpenContent}>
                <Search size={14} /> Find content
              </button>
            ) : null}
          </Accordion>
        </Card>
      ) : null}

      {!loading && total ? (
        <ol id="x-content-plan-slot-list" style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
          {slots.map((slot, index) => {
            const key = rowKey(slot, index);
            const gapRow = isGapSlot(slot) ? gapByKey.get(`${slot?.slot ?? ''}|${slot?.type ?? ''}`) : null;
            return (
              <SlotRow
                key={key}
                slot={slot}
                rowId={key}
                gapRow={gapRow}
                onDraft={onDraft}
                onOpenContent={onOpenContent}
                busy={draftingId != null && String(draftingId) === String(key)}
                draft={drafts ? drafts[key] : null}
              />
            );
          })}
        </ol>
      ) : null}

      {!loading && total ? (
        <Card id="x-plan-details-card" padding="0 14px">
          <Accordion id="x-plan-details-accordion" title="Plan details">
            <p id="x-content-plan-audit-line" style={S.muted}>
              {plan?.audit ? `${plan.audit.valid ?? 0}/${plan.audit.total ?? 0} packages valid` : 'No package audit for this plan.'}
            </p>
          </Accordion>
        </Card>
      ) : null}
    </div>
  );
}

function PlanPanelStandalone({ clientId, call, onNavigate, hideRefresh }) {
  return <PlanPanelView {...usePlanProps(call, clientId, onNavigate)} hideRefresh={hideRefresh} />;
}

// Content Center passes `plan` (even null); a standalone host passes only { clientId, call, onNavigate }.
export default function PlanPanel(props) {
  return props.plan === undefined ? <PlanPanelStandalone {...props} /> : <PlanPanelView {...props} />;
}
