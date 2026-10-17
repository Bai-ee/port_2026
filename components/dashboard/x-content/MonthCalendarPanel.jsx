'use client';

import { useCalendarProps } from './standalone.js';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { Skeleton, RetryError } from '../content-ui/Feedback.jsx';
import PostSheet from './PostSheet.jsx';
import { classifyResult } from '../../../features/x-content-inventory/month-calendar.js';
import { ENGINE_TAG, STATE_LABEL, StateDot, dayHeading } from './calendar-bits.jsx';

// MonthCalendarPanel — the Content Engine's month-to-month calendar over
// social_posts.
//
// PURE PRESENTATION. `calendar` is the output of features/x-content-inventory/
// month-calendar.js (days, states, proposals, review queue); this file
// re-derives nothing. Approve / Reject / Save / Unschedule / Reconcile hand the work back
// to the card, which calls the social-posting route. No post-now control.
//
// Status is carried by weight, not colour: scheduled = solid outline + filled
// dot, pending (unapproved, incl. engine proposals) = grey dashed + hollow dot,
// posted = muted + check, failed = the only red. Engines are a mono text tag.
//
// Layout: one grid at every width. ≥640 cells list post chips; <640 cells show
// state dots and the selected day's list below carries the content (the
// Apple Calendar phone pattern). Clicking a post opens the PostSheet editor.
//
// STYLING: classNames only (`xce-mc-`); the parent card owns the single
// `<style jsx global>` block, prefixed `.xce-scope`.

const UNPLACED_REASON = {
  'needs-story': 'Needs its story',
  'out-of-range': 'Open a current month to place it',
  'window-closed': 'Its timing window closes before the next open slot',
  held: 'Held for review',
  'no-slot': 'No open slot this month',
};
const NEEDS_ATTENTION = ['pending', 'awaiting', 'held'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIEW_KEY = 'xce-cal-view';
const CHIP_MAX = 3;
const DOT_MAX = 4;

const monthTitle = (month) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function readView() {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'agenda' ? 'agenda' : 'month';
  } catch {
    return 'month';
  }
}

function PostRow({ post, busy, onOpen, onApprove, onReject }) {
  const pending = (post.state === 'pending' || post.state === 'awaiting') && !post.needsStory;
  const rejectOnly = post.state === 'held';
  return (
    <li id={`x-content-month-row-${post.id}`} className={`xce-mc-row xce-mc-state-${post.state}`}>
      <button type="button" className="xce-mc-row-main" data-bucket={post.bucketColor ? post.bucketId || 'none' : undefined} data-thumb={post.thumbUrl ? '' : undefined}
        style={post.bucketColor ? { '--mc-bucket': post.bucketColor } : undefined} onClick={() => onOpen(post.id)}>
        <span className="xce-mc-row-time">{post.time || '—'}</span>
        <StateDot state={post.state} />
        <span className="xce-mc-row-body">
          <span className="xce-mc-row-title">{post.title || '(no text)'}</span>
          <span className="xce-mc-row-meta">
            {STATE_LABEL[post.state]}
            {post.reviewOn ? ' · review day' : post.proposed ? ' · proposed' : ''}
            {post.engine ? ` · ${ENGINE_TAG[post.engine]}` : ''}
            {post.needsStory ? (post.reviewOn ? ' · needs your memory' : ' · needs story') : ''}
          </span>
          {post.state === 'held' ? (
            <span id={`x-content-month-row-held-${post.id}`} className="xce-mc-row-note">{post.heldReason} {post.heldNext}</span>
          ) : null}
          {post.state === 'failed' ? (
            <span id={`x-content-month-row-failed-${post.id}`} className="xce-mc-row-note xce-mc-row-note-failed">{post.error ? `${post.error} · ` : ''}Not retried automatically.</span>
          ) : null}
        </span>
        {post.thumbUrl ? <span id={`x-content-month-row-thumb-${post.id}`} className="xce-mini-thumb"><img src={post.thumbUrl} alt="" loading="lazy" /></span> : null}
      </button>
      {(pending && onApprove) || (rejectOnly && onReject) ? (
        <span className="xce-mc-row-actions">
          {pending ? <button
            type="button"
            id={`x-content-month-row-approve-${post.id}`}
            className="xce-mc-icon-btn"
            disabled={busy}
            title={`Approve & schedule for ${post.time} CT`}
            aria-label={`Approve and schedule for ${post.time} CT`}
            onClick={() => onApprove(post)}
          >
            <Check size={15} />
          </button> : null}
          <button
            type="button"
            id={`x-content-month-row-reject-${post.id}`}
            className="xce-mc-icon-btn"
            disabled={busy}
            title="Reject"
            aria-label="Reject"
            onClick={() => onReject(post, { expectedRevision: post.revision ?? null })}
          >
            <X size={15} />
          </button>
        </span>
      ) : null}
    </li>
  );
}

// Sheet portal target: the Content Center card root when present, else the nearest .xce-scope, else body (standalone host).
function sheetHost() {
  return document.getElementById('x-content-card') || document.querySelector('.xce-scope') || document.body;
}

function MonthCalendarPanelView({
  calendar,
  loading,
  error,
  busyId,
  onShiftMonth,
  onToday,
  onRefresh,
  hideRefresh = false,
  onApprove,
  onReject,
  onSave,
  onUnschedule,
  onScore,
  onReconcile,
}) {
  const [view, setView] = useState('month');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const [openId, setOpenId] = useState(null);

  useEffect(() => { setView(readView()); }, []);
  useEffect(() => {
    try { window.localStorage.setItem(VIEW_KEY, view); } catch { /* per-viewer convenience only */ }
  }, [view]);

  const weeks = Array.isArray(calendar?.weeks) ? calendar.weeks : [];
  const days = useMemo(() => weeks.flat(), [weeks]);
  const totals = calendar?.totals || {};
  const unplaced = Array.isArray(calendar?.unplaced) ? calendar.unplaced : [];
  const reviewQueue = Array.isArray(calendar?.reviewQueue) ? calendar.reviewQueue : [];

  // Keep the selected day inside the visible month; default to today.
  useEffect(() => {
    if (!calendar) return;
    const inMonth = (d) => d && d.slice(0, 7) === calendar.month;
    setSelected((cur) => (inMonth(cur) ? cur : inMonth(calendar.today) ? calendar.today : `${calendar.month}-01`));
  }, [calendar]);

  const byId = useMemo(() => {
    const map = new Map();
    for (const d of days) for (const p of d.posts) map.set(p.id, { ...p, date: d.date });
    for (const p of unplaced) if (!map.has(p.id)) map.set(p.id, { ...p, date: null });
    return map;
  }, [days, unplaced]);

  const visible = (posts) => (pendingOnly ? posts.filter((p) => NEEDS_ATTENTION.includes(p.state)) : posts);
  const selectedDay = days.find((d) => d.date === selected) || null;
  const openPost = openId ? byId.get(openId) || null : null;

  // Approve/Reject then move on to the next post awaiting review (triage flow).
  const nextAfter = (id) => {
    const i = reviewQueue.indexOf(id);
    if (i === -1) return null;
    return reviewQueue[i + 1] || reviewQueue[i - 1] || null;
  };
  const decide = async (fn, post, extra) => {
    const next = nextAfter(post.id);
    const res = await fn(post, extra);
    // Only a clean result advances; conflicts / plan rejections keep the sheet (and the user's edit) open.
    if (res && classifyResult(res).kind === 'ok' && openId) setOpenId(next && next !== post.id ? next : null);
    return res;
  };
  const quickApprove = (post) => onApprove(post, { content: post.content, scheduledAt: post.proposedAt || post.scheduledAt, expectedRevision: post.revision ?? null });

  const agendaDays = days.filter((d) => d.inMonth && visible(d.posts).length);

  return (
    <div id="x-content-month-calendar-panel" className="xce-panel xce-mc">
      <header id="x-content-month-header" className="xce-mc-header">
        <div id="x-content-month-title-block" className="xce-mc-title-block">
          <h3 id="x-content-month-title" className="xce-mc-title">{calendar ? monthTitle(calendar.month) : '—'}</h3>
          <p id="x-content-month-summary" className="xce-mc-summary">
            <span><strong>{totals.pending ?? 0}</strong> pending</span>
            {totals.awaiting ? <span><strong>{totals.awaiting}</strong> awaiting approval</span> : null}
            {totals.held ? <span className="xce-mc-summary-held"><strong>{totals.held}</strong> held for review</span> : null}
            {totals.review ? <span id="x-content-month-summary-review"><strong>{totals.review}</strong> review day{totals.review === 1 ? '' : 's'}{totals.needsMemory ? ` (${totals.needsMemory} need your memory)` : ''}</span> : null}
            <span><strong>{totals.scheduled ?? 0}</strong> scheduled</span>
            <span><strong>{totals.posted ?? 0}</strong> posted</span>
            {totals.failed ? <span className="xce-mc-summary-failed"><strong>{totals.failed}</strong> failed</span> : null}
            <span>CT</span>
          </p>
          {Array.isArray(calendar?.legend) && calendar.legend.length ? (
            <ul id="x-content-month-bucket-legend" className="xce-mc-legend" aria-label="Bucket colors">
              {calendar.legend.map((b) => (
                <li key={b.id} id={`x-content-month-bucket-legend-${b.id}`} className="xce-mc-legend-item" style={{ '--mc-bucket': b.color }}>
                  <span className="xce-mc-legend-swatch" aria-hidden="true" />
                  {b.name}<span className="xce-mc-legend-count">{b.count}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div id="x-content-month-controls-row" className="xce-mc-controls">
          <div id="x-content-month-nav-group" className="xce-mc-nav" role="group" aria-label="Month">
            <button type="button" id="x-content-month-prev-button" className="xce-mc-icon-btn" disabled={loading} onClick={() => onShiftMonth(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
            <button type="button" id="x-content-month-today-button" className="xce-mc-text-btn" disabled={loading} onClick={onToday}>Today</button>
            <button type="button" id="x-content-month-next-button" className="xce-mc-icon-btn" disabled={loading} onClick={() => onShiftMonth(1)} aria-label="Next month"><ChevronRight size={16} /></button>
          </div>
          <div id="x-content-month-view-toggle" className="xce-mc-segmented" role="tablist" aria-label="View">
            {['month', 'agenda'].map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} id={`x-content-month-view-${v}`} className={`xce-mc-seg${view === v ? ' xce-mc-seg-active' : ''}`} onClick={() => setView(v)}>
                {v === 'month' ? 'Month' : 'Agenda'}
              </button>
            ))}
          </div>
          <button
            type="button"
            id="x-content-month-pending-filter"
            className={`xce-mc-text-btn xce-mc-filter${pendingOnly ? ' xce-mc-filter-on' : ''}`}
            aria-pressed={pendingOnly}
            onClick={() => setPendingOnly((v) => !v)}
          >
            Pending only
          </button>
          {reviewQueue.length ? (
            <button type="button" id="x-content-month-review-button" className="xce-btn-primary xce-mc-review" onClick={() => setOpenId(reviewQueue[0])}>
              Review {reviewQueue.length}
            </button>
          ) : null}
          {onRefresh && !hideRefresh ? (
            <button type="button" id="x-content-month-refresh-button" className="xce-mc-icon-btn" onClick={onRefresh} disabled={!!loading} aria-label="Refresh"><RefreshCw size={15} /></button>
          ) : null}
        </div>
      </header>

      {error ? <RetryError id="x-content-month-error" message={typeof error === 'string' ? error : 'Could not load the calendar.'} onRetry={onRefresh} busy={!!loading} /> : null}
      {loading && !calendar ? <Skeleton id="x-content-month-loading" rows={5} variant="tile" /> : null}

      {calendar && view === 'month' ? (
        <>
          <div id="x-content-month-grid" className={`xce-mc-grid${loading ? ' xce-mc-grid-loading' : ''}`} role="grid" aria-label={monthTitle(calendar.month)}>
            <div id="x-content-month-weekday-row" className="xce-mc-weekdays" role="row">
              {WEEKDAYS.map((w) => (
                <span key={w} role="columnheader" className="xce-mc-weekday" aria-label={w}>
                  <span className="xce-mc-weekday-long">{w}</span>
                  <span className="xce-mc-weekday-short">{w[0]}</span>
                </span>
              ))}
            </div>
            {weeks.map((week) => (
              <div key={week[0].date} className="xce-mc-week" role="row">
                {week.map((d) => {
                  const posts = visible(d.posts);
                  const extra = posts.length - CHIP_MAX;
                  const cls = [
                    'xce-mc-day',
                    d.inMonth ? '' : 'xce-mc-day-out',
                    d.isPast ? 'xce-mc-day-past' : '',
                    d.isToday ? 'xce-mc-day-today' : '',
                    d.date === selected ? 'xce-mc-day-selected' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div
                      key={d.date}
                      id={`x-content-month-day-${d.date}`}
                      role="gridcell"
                      tabIndex={0}
                      aria-selected={d.date === selected}
                      aria-label={`${dayHeading(d.date)}, ${posts.length} post${posts.length === 1 ? '' : 's'}`}
                      className={cls}
                      onClick={() => setSelected(d.date)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(d.date); } }}
                    >
                      <span className="xce-mc-date">{Number(d.date.slice(8))}</span>
                      {d.flags?.length ? <span className="xce-mc-flag" title={d.flags.map((f) => f.message).join('\n')}>!</span> : null}
                      <span className="xce-mc-chips">
                        {posts.slice(0, CHIP_MAX).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            id={`x-content-month-chip-${p.id}`}
                            className={`xce-mc-chip xce-mc-state-${p.state}`}
                            data-bucket={p.bucketColor ? p.bucketId || 'none' : undefined}
                            style={p.bucketColor ? { '--mc-bucket': p.bucketColor } : undefined}
                            onClick={(e) => { e.stopPropagation(); setSelected(d.date); setOpenId(p.id); }}
                            title={`${p.time} · ${STATE_LABEL[p.state]}${p.proposed ? ' (proposed)' : ''} · ${p.title}`}
                          >
                            <StateDot state={p.state} />
                            <span className="xce-mc-chip-time">{p.time}</span>
                            <span className="xce-mc-chip-text">{p.title || '(no text)'}</span>
                          </button>
                        ))}
                        {extra > 0 ? <span className="xce-mc-more">+{extra} more</span> : null}
                      </span>
                      <span className="xce-mc-dots" aria-hidden="true">
                        {posts.slice(0, DOT_MAX).map((p) => <StateDot key={p.id} state={p.state} />)}
                        {posts.length > DOT_MAX ? <span className="xce-mc-dots-more">+</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <section id="x-content-month-selected-day" className="xce-mc-dayview" aria-live="polite">
            <p id="x-content-month-selected-day-heading" className="xce-mc-kicker">
              {selected ? dayHeading(selected) : '—'}
              {selectedDay?.isToday ? ' · today' : ''}
            </p>
            {selectedDay?.flags?.length ? (
              <ul id="x-content-month-selected-day-flags" className="xce-mc-flags">
                {selectedDay.flags.map((f, i) => <li key={`${f.kind}-${i}`}>{f.message}</li>)}
              </ul>
            ) : null}
            {selectedDay && visible(selectedDay.posts).length ? (
              <ul className="xce-mc-rows">
                {visible(selectedDay.posts).map((p) => (
                  <PostRow key={p.id} post={p} busy={busyId === p.id} onOpen={setOpenId} onApprove={quickApprove} onReject={onReject} />
                ))}
              </ul>
            ) : (
              <p className="xce-mc-empty">{pendingOnly ? 'Nothing pending on this day.' : 'Nothing on this day.'}</p>
            )}
          </section>
        </>
      ) : null}

      {calendar && view === 'agenda' ? (
        <section id="x-content-month-agenda" className="xce-mc-agenda">
          {agendaDays.length ? agendaDays.map((d) => (
            <div key={d.date} id={`x-content-month-agenda-day-${d.date}`} className={`xce-mc-agenda-day${d.isToday ? ' xce-mc-agenda-today' : ''}`}>
              <p className="xce-mc-kicker">{dayHeading(d.date)}{d.isToday ? ' · today' : ''}</p>
              <ul className="xce-mc-rows">
                {visible(d.posts).map((p) => (
                  <PostRow key={p.id} post={p} busy={busyId === p.id} onOpen={setOpenId} onApprove={quickApprove} onReject={onReject} />
                ))}
              </ul>
            </div>
          )) : <p className="xce-mc-empty">{pendingOnly ? 'Nothing pending this month.' : 'Nothing on the calendar this month.'}</p>}
        </section>
      ) : null}

      {calendar && unplaced.length ? (
        <details id="x-content-month-unplaced" className="xce-mc-unplaced">
          <summary className="xce-mc-kicker">{unplaced.length} draft{unplaced.length === 1 ? '' : 's'} not on a day</summary>
          <ul className="xce-mc-rows">
            {unplaced.map((p) => (
              <li key={p.id} id={`x-content-month-unplaced-${p.id}`} className={`xce-mc-row xce-mc-state-${p.state}`}>
                <button type="button" className="xce-mc-row-main" onClick={() => setOpenId(p.id)}>
                  <span className="xce-mc-row-time">—</span>
                  <StateDot state={p.state} />
                  <span className="xce-mc-row-body">
                    <span className="xce-mc-row-title">{p.title || '(no text)'}</span>
                    <span className="xce-mc-row-meta">
                      {UNPLACED_REASON[p.reason] || UNPLACED_REASON['no-slot']}
                      {p.engine ? ` · ${ENGINE_TAG[p.engine]}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {/* Portalled to the card root: `.xce-panel` has backdrop-filter, which
          makes it the containing block for position:fixed and clips the sheet.
          The card root keeps every `.xce-scope` style applying. */}
      {openPost && typeof document !== 'undefined' && sheetHost() ? createPortal(
        <PostSheet
          post={openPost}
          busy={busyId === openPost.id}
          queue={reviewQueue}
          onNavigate={setOpenId}
          onClose={() => setOpenId(null)}
          onApprove={(post, extra) => decide(onApprove, post, extra)}
          onReject={(post, extra) => decide(onReject, post, extra)}
          onSave={onSave}
          onUnschedule={onUnschedule}
          onScore={onScore}
          onReconcile={onReconcile ? (post, extra) => decide(onReconcile, post, extra) : undefined}
          onRefresh={onRefresh}
        />,
        sheetHost(),
      ) : null}
    </div>
  );
}

function MonthCalendarPanelStandalone({ clientId, call, hideRefresh }) {
  return <MonthCalendarPanelView {...useCalendarProps(call, clientId)} hideRefresh={hideRefresh} />;
}

// Content Center passes `calendar` (even null); a standalone host passes only { clientId, call, onNavigate }.
export default function MonthCalendarPanel(props) {
  return props.calendar === undefined ? <MonthCalendarPanelStandalone {...props} /> : <MonthCalendarPanelView {...props} />;
}
