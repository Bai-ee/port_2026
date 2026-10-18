'use client';

import { useCalendarProps } from './standalone.js';
import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { Skeleton, RetryError } from '../content-ui/Feedback.jsx';
import StagePostLevel from '../calendar-stage/StagePostLevel.jsx';
import { ENGINE_TAG, STATE_LABEL, StateDot, dayHeading } from './calendar-bits.jsx';
import { ApprovalMark, FilterChips, InlineApprovalButtons, SuggestionRow, CalendarApprovalStyles } from './CalendarApprovalBits.jsx';
import { dayRows, filterRows, withOverride, approveRequest, unapproveRequest, isSuggestionRow, matchesFilter } from './calendar-row-model.js';

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
// state dots. This panel feeds the three levels of the Calendar Stage
// (components/dashboard/calendar-stage/): MONTH (the grid below), DAY (that day's
// items by category; Today also gets the host's Plan / Recommendations via
// `renderTodayExtras`) and POST (StagePostLevel -> PostEditor). The stage shows one
// level at a time, so there is no overlay, backdrop or drawer in here. One mounted
// instance serves all three levels so the loaded month and the filters survive.
//
// STYLING: classNames only (`xce-mc-`); the stage host mounts ContentUiStyles
// (the single `<style jsx global>` block, prefixed `.xce-scope`).

const UNPLACED_REASON = {
  'needs-story': 'Needs its story',
  'out-of-range': 'Open a current month to place it',
  'window-closed': 'Its timing window closes before the next open slot',
  held: 'Held for review',
  'no-slot': 'No open slot this month',
};
const NEEDS_ATTENTION = ['pending', 'awaiting', 'held', 'suggested'];
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

const FILL_KIND_LABEL = { quote: 'Quote', narrative: 'Narrative', 'client-work': 'Client work', baseline: 'Baseline' };

// A daily-fill quote draft is only useful inside its window; past expiresAt it renders muted.
export function isQuoteWindowClosed(post, nowMs = Date.now()) {
  const t = post?.fillKind === 'quote' && post?.expiresAt ? Date.parse(post.expiresAt) : NaN;
  return Number.isFinite(t) && t < nowMs;
}

// onView (calendar day view only): the row and its VIEW POST button open the X preview instead of the editor.
function PostRow({ post, busy, onOpen, onApprove, onReject, onApproveOnly, onUnapprove, onView }) {
  const windowClosed = isQuoteWindowClosed(post);
  // Once the data layer sends `approval`, the row's Approve button approves WITHOUT scheduling; the legacy approve-and-schedule check is kept only before that.
  const approvalAware = !!post.approval && !!onApproveOnly;
  const pending = (post.state === 'pending' || post.state === 'awaiting') && !approvalAware;
  const rejectOnly = post.state === 'held';
  return (
    <li id={`x-content-month-row-${post.id}`} className={`xce-mc-row xce-mc-state-${post.state}${windowClosed ? ' xce-mc-row-expired' : ''}`}>
      <button type="button" className="xce-mc-row-main" data-bucket={post.bucketColor ? post.bucketId || 'none' : undefined} data-thumb={post.thumbUrl ? '' : undefined}
        style={post.bucketColor ? { '--mc-bucket': post.bucketColor } : undefined} onClick={() => (onView ? onView(post) : onOpen(post.id))}>
        <span className="xce-mc-row-time">{post.time || '—'}</span>
        {approvalAware ? <ApprovalMark row={post} id={`x-content-month-row-mark-${post.id}`} /> : <StateDot state={post.state} />}
        <span className="xce-mc-row-body">
          <span className="xce-mc-row-title">{post.title || '(no text)'}</span>
          <span className="xce-mc-row-meta">
            {STATE_LABEL[post.state]}
            {post.reviewOn ? ' · review day' : post.proposed ? ' · proposed' : ''}
            {post.engine ? ` · ${ENGINE_TAG[post.engine]}` : ''}
            {post.needsStory ? (post.reviewOn ? ' · needs your memory' : ' · needs story') : ''}
            {FILL_KIND_LABEL[post.fillKind] ? (
              <span id={`x-content-month-row-fill-kind-${post.id}`} className="xce-mc-fill-badge" data-fill-kind={post.fillKind}>{FILL_KIND_LABEL[post.fillKind]}</span>
            ) : null}
            {windowClosed ? <span id={`x-content-month-row-window-closed-${post.id}`} className="xce-mc-fill-closed">window closed</span> : null}
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
      {onView ? (
        <span className="xce-mc-row-actions">
          <button type="button" id={`x-content-month-row-view-${post.id}`} className="xce-mc-text-btn xce-ap-btn" onClick={() => onView(post)}>View post</button>
        </span>
      ) : null}
      {approvalAware ? (
        <span className="xce-mc-row-actions">
          <InlineApprovalButtons row={post} busy={busy} onApprove={onApproveOnly} onUnapprove={onUnapprove} />
        </span>
      ) : null}
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

// A "film this" reminder (content_tasks) on its due day. Presentation only: the toggle hands back to the host.
function TaskRow({ task, busy, onToggle }) {
  const done = task.status === 'done';
  return (
    <li id={`x-content-month-task-${task.id}`} className={`xce-mc-task${done ? ' xce-mc-task-done' : ''}`}>
      <span id={`x-content-month-task-badge-${task.id}`} className="xce-mc-task-badge">{task.badge}</span>
      <span className="xce-mc-task-title">{task.title}</span>
      {onToggle ? (
        <button type="button" id={`x-content-month-task-toggle-${task.id}`} className="xce-mc-text-btn" disabled={busy} aria-pressed={done} onClick={() => onToggle(task, done ? 'open' : 'done')}>
          {done ? 'Reopen' : 'Done'}
        </button>
      ) : null}
    </li>
  );
}

// Category for a day-view row: quote retweets, suggestions, else the post's Content Center bucket.
function rowCategory(r, names) {
  if (r.kind === 'requote') return { key: 'requote', label: 'Quote retweets', color: null };
  if (r.kind === 'suggestion') return { key: 'suggestion', label: 'Suggestions', color: null };
  const id = r.bucketId || 'none';
  return { key: `bucket-${id}`, label: names.get(r.bucketId) || (r.bucketId ? r.bucketId : 'No bucket'), color: r.bucketColor || null };
}

// DAY LEVEL of the Calendar Stage: one day's items by category. No overlay, backdrop or blur of its own: the stage
// owns the page and the top bar owns the title / close.
function DayBody({ day, rows, legend, pendingOnly, renderRow, onTaskToggle, busyId, todayExtras }) {
  const names = new Map((legend || []).map((b) => [b.id, b.name]));
  const groups = [];
  const byKey = new Map();
  for (const r of rows) {
    const c = rowCategory(r, names);
    if (!byKey.has(c.key)) { const g = { ...c, rows: [] }; byKey.set(c.key, g); groups.push(g); }
    byKey.get(c.key).rows.push(r);
  }
  groups.sort((a, b) => (a.key === 'requote' ? -1 : b.key === 'requote' ? 1 : 0));
  const c = day.counts || {};
  const stats = [
    { label: 'DRAFTS', value: (c.pending || 0) + (c.awaiting || 0) + (c.held || 0) },
    { label: 'SCHEDULED', value: (c.approved || 0) + (c.scheduled || 0) + (c.manual || 0) },
    { label: 'POSTED', value: c.posted || 0 },
    { label: 'QUOTES', value: c.requote || 0 },
  ];
  const total = rows.length + (day.tasks?.length || 0);
  const pad2 = (n) => String(n).padStart(2, '0');
  const openTasks = (day.tasks || []).filter((t) => t.status === 'open');

  return (
    <div id="x-content-day-view-root" className="xce-panel">
      <div id="x-content-day-view-content">
        <div id="x-content-day-view-summary-row">
          <div id="x-content-day-view-summary-count">
            <span id="x-content-day-view-summary-count-value">{pad2(total)}</span>
            <span className="xce-dv-caps">{day.isToday ? 'TODAY' : day.isPast ? 'PAST DAY' : 'UPCOMING'} · ON THIS DAY</span>
          </div>
          <div id="x-content-day-view-stats" className="xce-dv-stats">
            {stats.map((x) => (
              <span key={x.label} className="xce-dv-stat" data-zero={x.value ? 'false' : 'true'}>
                <span className="xce-dv-stat-value">{pad2(x.value)}</span> {x.label}
              </span>
            ))}
          </div>
        </div>
        {day.flags?.length ? (
          <ul id="x-content-day-view-flags" className="xce-mc-flags">
            {day.flags.map((f, i) => <li key={`${f.kind}-${i}`}>{f.message}</li>)}
          </ul>
        ) : null}
        {groups.map((g) => (
          <section key={g.key} id={`x-content-day-view-group-${g.key.replace(/[^a-z0-9-]/gi, '-')}`} className="xce-dv-group">
            <h3 className="xce-dv-group-head">
              <span className="xce-dv-dot" aria-hidden="true" style={g.color ? { background: g.color } : undefined} />
              {g.label}
              <span className="xce-dv-group-count">{pad2(g.rows.length)}</span>
            </h3>
            <ul className="xce-mc-rows">{g.rows.map((r) => renderRow(r))}</ul>
          </section>
        ))}
        {openTasks.length || day.tasks?.length ? (
          <section id="x-content-day-view-group-tasks" className="xce-dv-group">
            <h3 className="xce-dv-group-head">
              <span className="xce-dv-dot" aria-hidden="true" />
              Media tasks
              <span className="xce-dv-group-count">{pad2(day.tasks.length)}</span>
            </h3>
            <ul className="xce-mc-rows">
              {day.tasks.map((t) => <TaskRow key={t.id} task={t} busy={busyId === t.id} onToggle={onTaskToggle} />)}
            </ul>
          </section>
        ) : null}
        {!groups.length && !day.tasks?.length ? (
          <p id="x-content-day-view-empty" className="xce-dv-caps xce-dv-empty">{pendingOnly ? '[NOTHING PENDING ON THIS DAY]' : '[NOTHING ON THIS DAY]'}</p>
        ) : null}
        {day.isToday ? (todayExtras ? (
          <section id="x-content-day-view-today-extras" className="xce-dv-today">{todayExtras}</section>
        ) : null) : (
          <p id="x-content-day-view-today-only-note" className="xce-dv-caps xce-dv-note">PLAN AND RECOMMENDATIONS ARE BUILT FOR TODAY ONLY</p>
        )}
      </div>
      <style>{`
        #x-content-day-view-root { width: 100%; max-width: 960px; margin: 0 auto; box-sizing: border-box; }
        #x-content-day-view-content { display: flex; flex-direction: column; gap: 22px; padding: 6px 8px 10px; }
        #x-content-day-view-root .xce-dv-caps { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-secondary); }
        /* Nothing-style (matches the Refresh modal): one Doto hero, mono caps metadata, flat single-line rows,
           colour only on values (bucket dot, stale/failed). Overrides below are scoped to this level only. */
        #x-content-day-view-summary-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--t-border-faint); }
        #x-content-day-view-summary-count { display: flex; align-items: baseline; gap: 8px; }
        #x-content-day-view-summary-count-value { font-family: "Doto", var(--font-mono); font-weight: 700; font-size: 56px; line-height: 0.85; letter-spacing: -0.02em; color: var(--t-text-strong); }
        #x-content-day-view-root .xce-dv-stats { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px 18px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-secondary); }
        #x-content-day-view-root .xce-dv-stat-value { color: var(--t-text-strong); }
        #x-content-day-view-root .xce-dv-stat[data-zero="true"] { color: var(--t-text-disabled); }
        #x-content-day-view-root .xce-dv-stat[data-zero="true"] .xce-dv-stat-value { color: var(--t-text-disabled); }
        #x-content-day-view-root .xce-dv-group { display: flex; flex-direction: column; gap: 4px; }
        #x-content-day-view-root .xce-dv-group-head { display: flex; align-items: center; gap: 8px; margin: 0; padding-bottom: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-secondary); }
        #x-content-day-view-root .xce-dv-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--t-text-secondary); flex-shrink: 0; }
        #x-content-day-view-root .xce-dv-group-count { margin-left: auto; color: var(--t-text-strong); }
        #x-content-day-view-root .xce-mc-rows { border-top: 1px solid var(--t-border-faint); }
        #x-content-day-view-root .xce-mc-row { gap: 10px; border-top: 0; border-bottom: 1px solid var(--t-border-faint); }
        #x-content-day-view-root .xce-mc-row-main,
        #x-content-day-view-root .xce-mc-row-main[data-bucket] { min-height: 48px; padding: 6px 0; gap: 12px; grid-template-columns: 44px 12px minmax(0, 1fr); background: transparent; box-shadow: none; border-radius: 0; }
        #x-content-day-view-root .xce-mc-row-main[data-thumb] { grid-template-columns: 44px 12px minmax(0, 1fr) 32px; }
        #x-content-day-view-root .xce-mc-row-main:hover { background: transparent; }
        #x-content-day-view-root .xce-mc-row-main:hover .xce-mc-row-title { color: var(--t-text-strong); text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--t-border-subtle); }
        #x-content-day-view-root .xce-mc-row-time { font-weight: 400; font-size: 11px; letter-spacing: 0.04em; color: var(--t-text-secondary); }
        #x-content-day-view-root .xce-mc-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-ui); font-size: 15px; color: var(--t-text); }
        #x-content-day-view-root .xce-mc-row-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-secondary); }
        #x-content-day-view-root .xce-mc-fill-badge { margin-left: 6px; padding: 0 6px; font-size: 10px; border-color: var(--t-border-subtle); }
        #x-content-day-view-root .xce-mini-thumb { width: 32px; height: 32px; border-radius: 4px; }
        #x-content-day-view-root .xce-mc-text-btn,
        #x-content-day-view-root .xce-mc-icon-btn { min-height: 28px; padding: 0 12px; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-secondary); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; transition: color 150ms ease-out, border-color 150ms ease-out; }
        #x-content-day-view-root .xce-mc-text-btn:hover:not(:disabled),
        #x-content-day-view-root .xce-mc-icon-btn:hover:not(:disabled) { color: var(--t-text-strong); border-color: var(--t-control-border-strong); }
        #x-content-day-view-root .xce-dv-empty { margin: 0; padding: 8px 0; }
        #x-content-day-view-root .xce-dv-note { margin: 0; padding-top: 14px; border-top: 1px solid var(--t-border-faint); color: var(--t-text-disabled); }
        #x-content-day-view-root .xce-dv-today { padding-top: 18px; border-top: 1px solid var(--t-border-faint); }
        @media (prefers-reduced-motion: reduce) {
          #x-content-day-view-root .xce-mc-text-btn, #x-content-day-view-root .xce-mc-icon-btn { transition: none; }
        }
        @media (max-width: 620px) {
          #x-content-day-view-summary-row { flex-direction: column; align-items: flex-start; gap: 10px; }
          #x-content-day-view-root .xce-dv-stats { justify-content: flex-start; }
          #x-content-day-view-summary-count-value { font-size: 44px; }
          #x-content-day-view-root .xce-mc-row-main, #x-content-day-view-root .xce-mc-row-main[data-bucket] { grid-template-columns: 40px 12px minmax(0, 1fr); }
        }
        @media (max-width: 480px) {
          #x-content-day-view-root { max-width: none; padding: 8px var(--mobile-gutter, 8px); border-radius: 12px; }
          #x-content-day-view-content { padding: 4px 0 8px; }
        }
      `}</style>
    </div>
  );
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
  onTaskToggle,
  call,
  renderTodayExtras,
  onSetMonth,
  stage,
}) {
  const [view, setView] = useState('month');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [filter, setFilter] = useState('all');
  const [overrides, setOverrides] = useState({});
  const [inlineBusyId, setInlineBusyId] = useState(null);
  const [inlineNote, setInlineNote] = useState('');
  const [selected, setSelected] = useState(null);
  // Stage navigation: the Calendar Stage owns which level is visible (month | day | post).
  const nav = stage?.nav;
  const level = nav?.state?.level || 'month';
  const stageDate = nav?.state?.date || null;
  const stagePostId = nav?.state?.postId || null;
  const setOpenId = (id) => { if (id && nav) nav.openPost(id); };
  const openDay = (date) => { setSelected(date); if (nav) nav.openDay(date); };
  // A day / post deep link (reload, Open Today) can be in another month than the one loaded: load that month.
  const wantMonth = level === 'month' ? null : (stageDate || '').slice(0, 7) || null;
  useEffect(() => {
    if (wantMonth && calendar && !loading && calendar.month !== wantMonth && onSetMonth) onSetMonth(wantMonth);
  }, [wantMonth, calendar?.month]); // eslint-disable-line react-hooks/exhaustive-deps

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
    for (const d of days) for (const p of dayRows(d)) if (!map.has(p.id)) map.set(p.id, { ...p, date: p.date || d.date });
    for (const p of unplaced) if (!map.has(p.id)) map.set(p.id, { ...p, date: null });
    return map;
  }, [days, unplaced]);

  // Optimistic approve/unapprove marks live only until the next calendar load.
  useEffect(() => { setOverrides({}); }, [calendar]);
  const visible = (rows) => (pendingOnly ? rows.filter((p) => NEEDS_ATTENTION.includes(p.state)) : rows);
  // Everything a day shows: saved posts + suggestions + requotes, with optimistic overrides and the approval filter applied.
  const rowsFor = (d) => visible(filterRows(dayRows(d).map((r) => withOverride({ ...r, date: r.date || d.date }, overrides)), filter));
  const chipCounts = useMemo(() => {
    const all = days.filter((d) => d.inMonth).flatMap((d) => dayRows(d).map((r) => withOverride(r, overrides)));
    const n = (f) => all.filter((r) => matchesFilter(r, f)).length;
    return { all: all.length, unapproved: n('unapproved'), approved: n('approved'), suggestions: n('suggestions') };
  }, [days, overrides]);

  // Inline Approve / Unapprove (never schedules). Optimistic; reverts with a note on failure, reloads on success.
  const inlineDecide = async (row, req, next) => {
    if (typeof call !== 'function') return;
    setInlineNote('');
    setInlineBusyId(row.id);
    setOverrides((o) => ({ ...o, [row.id]: next }));
    try {
      await call(req.action, req.body);
      if (onRefresh) await onRefresh();
    } catch (err) {
      setOverrides((o) => { const c = { ...o }; delete c[row.id]; return c; });
      setInlineNote(err?.message || 'Could not update the calendar.');
    } finally {
      setInlineBusyId(null);
    }
  };
  const onApproveOnly = (row) => inlineDecide(row, approveRequest(row), 'approved');
  const onUnapprove = (row) => inlineDecide(row, unapproveRequest(row), 'unapproved');
  const rowBusy = (id) => busyId === id || inlineBusyId === id;
  // A row opens the editor (PostEditor handles saved posts, daily suggestions and requotes alike).
  const renderRow = (p) => (isSuggestionRow(p)
    ? <SuggestionRow key={p.id} row={p} busy={rowBusy(p.id)} onApprove={onApproveOnly} onView={() => setOpenId(p.id)} />
    : <PostRow key={p.id} post={p} busy={rowBusy(p.id)} onOpen={setOpenId} onApprove={quickApprove} onReject={onReject} onApproveOnly={onApproveOnly} onUnapprove={onUnapprove} />);
  const selectedDayFor = (date) => days.find((d) => d.date === date) || null;
  const quickApprove = (post) => onApprove(post, { content: post.content, scheduledAt: post.proposedAt || post.scheduledAt, expectedRevision: post.revision ?? null });

  const agendaDays = days.filter((d) => d.inMonth && (rowsFor(d).length || d.tasks?.length));

  // DAY level: that day's items. Waits for the month to load; a failed load shows the same retry as the month.
  if (level === 'day') {
    const dayRowsNow = selectedDayFor(stageDate);
    return (
      <>
        {error ? <RetryError id="x-content-day-view-error" message={typeof error === 'string' ? error : 'Could not load the calendar.'} onRetry={onRefresh} busy={!!loading} /> : null}
        {!dayRowsNow && !error ? <Skeleton id="x-content-day-view-loading" rows={4} variant="tile" /> : null}
        {dayRowsNow ? (
          <DayBody
            day={dayRowsNow}
            rows={rowsFor(dayRowsNow)}
            legend={calendar?.legend}
            pendingOnly={pendingOnly}
            renderRow={renderRow}
            onTaskToggle={onTaskToggle}
            busyId={busyId}
            todayExtras={dayRowsNow.isToday && typeof renderTodayExtras === 'function' ? renderTodayExtras() : null}
          />
        ) : null}
        {inlineNote ? <p id="x-content-day-view-inline-note" className="xce-ap-note" role="alert">{inlineNote}</p> : null}
        <CalendarApprovalStyles />
      </>
    );
  }

  // POST level: the single View & Edit Post editor (components/dashboard/calendar-stage/StagePostLevel.jsx).
  if (level === 'post') {
    return (
      <StagePostLevel
        key={stagePostId}
        postId={stagePostId}
        row={stagePostId ? byId.get(stagePostId) || null : null}
        calendarReady={!!calendar || !loading}
        stage={stage}
        onRefresh={onRefresh}
      />
    );
  }

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
            {totals.tasksOpen ? <span id="x-content-month-summary-tasks"><strong>{totals.tasksOpen}</strong> to film</span> : null}
            {totals.suggested ? <span id="x-content-month-summary-suggested"><strong>{totals.suggested}</strong> suggested</span> : null}
            {totals.requote ? <span id="x-content-month-summary-requote"><strong>{totals.requote}</strong> requote{totals.requote === 1 ? '' : 's'}</span> : null}
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

      <div id="x-content-month-approval-filter-row" className="xce-ap-filter-row">
        <FilterChips value={filter} onChange={setFilter} counts={chipCounts} />
      </div>
      {inlineNote ? <p id="x-content-month-inline-note" className="xce-ap-note" role="alert">{inlineNote}</p> : null}

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
                  const posts = rowsFor(d);
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
                      onClick={() => openDay(d.date)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(d.date); } }}
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
                            onClick={(e) => { e.stopPropagation(); setSelected(d.date); if (isSuggestionRow(p)) openDay(d.date); else setOpenId(p.id); }}
                            title={`${p.time || ''} · ${STATE_LABEL[p.state] || (p.kind === 'requote' ? 'Requote' : 'Suggested')}${p.proposed ? ' (proposed)' : ''} · ${p.title || p.text || ''}`}
                          >
                            {p.approval ? <ApprovalMark row={p} /> : <StateDot state={p.state} />}
                            <span className="xce-mc-chip-time">{p.time || ''}</span>
                            <span className="xce-mc-chip-text">{p.title || p.text || '(no text)'}</span>
                          </button>
                        ))}
                        {extra > 0 ? <span className="xce-mc-more">+{extra} more</span> : null}
                      </span>
                      <span className="xce-mc-dots" aria-hidden="true">
                        {posts.slice(0, DOT_MAX).map((p) => (p.approval ? <ApprovalMark key={p.id} row={p} /> : <StateDot key={p.id} state={p.state} />))}
                        {posts.length > DOT_MAX ? <span className="xce-mc-dots-more">+</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

        </>
      ) : null}

      {calendar && view === 'agenda' ? (
        <section id="x-content-month-agenda" className="xce-mc-agenda">
          {agendaDays.length ? agendaDays.map((d) => (
            <div key={d.date} id={`x-content-month-agenda-day-${d.date}`} className={`xce-mc-agenda-day${d.isToday ? ' xce-mc-agenda-today' : ''}`}>
              <p className="xce-mc-kicker">{dayHeading(d.date)}{d.isToday ? ' · today' : ''}</p>
              <ul className="xce-mc-rows">
                {(d.tasks || []).map((t) => <TaskRow key={t.id} task={t} busy={busyId === t.id} onToggle={onTaskToggle} />)}
                {rowsFor(d).map(renderRow)}
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

      <CalendarApprovalStyles />
    </div>
  );
}

function MonthCalendarPanelStandalone({ clientId, call, hideRefresh, renderTodayExtras, stage }) {
  return <MonthCalendarPanelView {...useCalendarProps(call, clientId)} hideRefresh={hideRefresh} renderTodayExtras={renderTodayExtras} stage={stage} />;
}

// Content Center passes `calendar` (even null); a standalone host passes only { clientId, call, onNavigate }.
export default function MonthCalendarPanel(props) {
  return props.calendar === undefined ? <MonthCalendarPanelStandalone {...props} /> : <MonthCalendarPanelView {...props} />;
}
