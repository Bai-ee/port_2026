'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { CalendarDays, CalendarRange, ChevronDown, Ellipsis, FolderTree, History, Library, LineChart, MessagesSquare, Users } from 'lucide-react';
import BottomNav from './x-content/ui/BottomNav';
import SegmentedControl from './x-content/ui/SegmentedControl';
import { fallbackDraft, validateDraft } from '../../features/x-content-inventory/draft.js';
import { Toast } from './x-content/Feedback';

// Content Engine — the supply side of the posting plan.
//
// The X Calendar card answers WHEN to post and WHAT TYPE. This one answers
// WHICH PIECE OF CONTENT and, once there is copy, WHAT IT SAYS. Two panels:
// PLAN (today's slots with content matched into them) and INVENTORY (the
// ContentPackage rows those matches come from).
//
// Everything here is Firestore-only. The plan is computed server-side by
// features/x-content-inventory/plan-day.js — pure, no network, no spend — and
// the draft preview below is computed IN THE BROWSER from the author's own
// story text. The model-written draft is deliberately NOT here: it costs money
// per call, so it stays a local command the way the quote scan does.
//
// ⚠️ Styling trap (same as XCalendarCard / XMonitorCard): this uses
// `<style jsx global>` with EVERY selector prefixed `#x-content-card`, because
// plain `<style jsx>` only scopes JSX written directly in THIS component's
// return — markup rendered by the child panels never receives the generated
// class. Handing the tag a variable instead of an inline template literal
// fails the compile and renders an empty pane. All panel CSS therefore lives
// in this one block, and the panels emit classNames only.

const PlanPanel = dynamic(() => import('./x-content/PlanPanel'), { ssr: false });
const InventoryPanel = dynamic(() => import('./x-content/InventoryPanel'), { ssr: false });
const MonthCalendarPanel = dynamic(() => import('./x-content/MonthCalendarPanel'), { ssr: false });
const PerformancePanel = dynamic(() => import('./x-content/PerformancePanel'), { ssr: false });
const ClientCapturePanel = dynamic(() => import('./x-content/ClientCapturePanel'), { ssr: false });
const BucketsPanel = dynamic(() => import('./x-content/BucketsPanel'), { ssr: false });
const DailySuggestionsPanel = dynamic(() => import('./x-content/DailySuggestionsPanel'), { ssr: false });
const TimelinePanel = dynamic(() => import('./x-content/TimelinePanel'), { ssr: false });
const StrategyPanel = dynamic(() => import('./x-content/StrategyPanel'), { ssr: false });

const TABS = ['strategy', 'plan', 'today', 'inventory', 'buckets', 'calendar', 'clients', 'performance', 'timeline'];
const TAB_STORAGE_KEY = 'xce-last-tab';

// Labels only: ids are the unchanged TABS ids (inventory -> "Content", performance -> "Results").
const PRIMARY_TABS = [
  { id: 'strategy', label: 'Strategy', Icon: LineChart },
  { id: 'plan', label: 'Plan', Icon: CalendarDays },
  { id: 'today', label: 'Today', Icon: MessagesSquare },
  { id: 'inventory', label: 'Content', Icon: Library },
  { id: 'buckets', label: 'Buckets', Icon: FolderTree },
  { id: 'calendar', label: 'Calendar', Icon: CalendarRange },
];
const MORE_TABS = [
  { id: 'clients', label: 'Clients', Icon: Users },
  { id: 'performance', label: 'Results', Icon: LineChart },
  { id: 'timeline', label: 'Timeline', Icon: History },
];
const MOBILE_MORE_TABS = [
  { id: 'buckets', label: 'Buckets', Icon: FolderTree },
  { id: 'clients', label: 'Clients', Icon: Users },
  { id: 'performance', label: 'Results', Icon: LineChart },
  { id: 'timeline', label: 'Timeline', Icon: History },
];
const TOAST_MS = 3200;

// Per-viewer convenience only: any storage failure just means "start on Plan".
function readSavedTab() {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(TAB_STORAGE_KEY) : null;
    return TABS.includes(saved) ? saved : 'plan';
  } catch {
    return 'plan';
  }
}

const ENDPOINT = '/api/dashboard/quote-targets';
// Approve/schedule reuse the EXISTING social-posting route. There is no post-now
// control anywhere in this card.
const SOCIAL_ENDPOINT = '/api/social-posting';

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}

function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

export default function XContentEngineCard({ getIdToken, activeClientId, clientName }) {
  const [tab, setTab] = useState(readSavedTab);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const showToast = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    try { window.localStorage.setItem(TAB_STORAGE_KEY, tab); } catch { /* storage unavailable */ }
  }, [tab]);
  // Shell-only UI state: which More menu is open. No data flow.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const moreMobileRef = useRef(null);
  const pickTab = useCallback((id) => { setTab(id); setMoreOpen(false); }, []);
  const onMobileNav = useCallback((v) => {
    if (v === 'more') { setMoreOpen((o) => !o); return; }
    if (v === 'today') { setTab((t) => (t === 'plan' || t === 'today' ? t : 'plan')); setMoreOpen(false); return; }
    pickTab(v);
  }, [pickTab]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onDown = (e) => {
      const inside = (moreRef.current && moreRef.current.contains(e.target)) || (moreMobileRef.current && moreMobileRef.current.contains(e.target));
      if (!inside) setMoreOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [moreOpen]);
  const [posts, setPosts] = useState(5);

  const [plan, setPlan] = useState(null);
  // Which plan decided the cadence: a Strategy plan doc ('plan-doc') or the picker's own request ('default').
  const [planMeta, setPlanMeta] = useState({ source: 'default', version: null });
  const [packages, setPackages] = useState([]);
  const [audit, setAudit] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [draftingId, setDraftingId] = useState(null);
  const [drafts, setDrafts] = useState({});

  const [calMonth, setCalMonth] = useState(() => todayCT().slice(0, 7));
  const [calendar, setCalendar] = useState(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarBusyId, setCalendarBusyId] = useState(null);
  const [clientError, setClientError] = useState('');
  const [perf, setPerf] = useState(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [perfError, setPerfError] = useState('');

  const call = useCallback(async (action, body = {}) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data?.error || `${action} failed.`), { status: res.status, data });
    return data;
  }, [getIdToken]);

  const load = useCallback(async (nextPosts = posts) => {
    setLoading(true);
    setError('');
    try {
      const [planRes, invRes] = await Promise.all([
        call('content-plan', { posts: nextPosts }),
        call('inventory-list'),
      ]);
      setPlan(planRes?.plan || null);
      setPlanMeta({ source: planRes?.planSource || 'default', version: planRes?.planVersion ?? null });
      setPackages(Array.isArray(invRes?.packages) ? invRes.packages : []);
      setAudit(invRes?.audit || null);
    } catch (err) {
      setError(err.message || 'Could not load the content engine.');
    } finally {
      setLoading(false);
    }
  }, [call, posts]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeClientId]);
  useEffect(() => {
    if (tab === 'calendar') loadCalendar();
    if (tab === 'performance') loadPerformance();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab, activeClientId]);

  const callSocial = useCallback(async (body) => {
    const token = getIdToken ? await getIdToken() : null;
    const res = await fetch(SOCIAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `${body.action} failed.`);
    return data;
  }, [getIdToken]);

  const loadCalendar = useCallback(async (month = calMonth) => {
    setCalendarLoading(true);
    setCalendarError('');
    try {
      const res = await call('month-calendar', { month });
      setCalendar(res?.calendar || null);
    } catch (err) {
      setCalendarError(err.message || 'Could not load the calendar.');
    } finally {
      setCalendarLoading(false);
    }
  }, [call, calMonth]);

  const loadPerformance = useCallback(async () => {
    setPerfLoading(true);
    setPerfError('');
    try {
      setPerf(await call('engine-performance', { windowDays: 30 }));
    } catch (err) {
      setPerfError(err.message || 'Could not load performance.');
    } finally {
      setPerfLoading(false);
    }
  }, [call]);

  const onShiftMonth = useCallback((delta) => {
    const next = shiftMonth(calMonth, delta);
    setCalMonth(next);
    loadCalendar(next);
  }, [calMonth, loadCalendar]);

  const onCalendarToday = useCallback(() => {
    const now = todayCT().slice(0, 7);
    setCalMonth(now);
    loadCalendar(now);
  }, [loadCalendar]);

  // Every calendar action: one social-posting call, reload the month, toast.
  // Returns true on success so the sheet can advance to the next post.
  const runCalendarAction = useCallback(async (post, body, okText) => {
    setCalendarBusyId(post.id);
    try {
      await callSocial({ postId: post.id, ...body });
      await loadCalendar();
      showToast(okText);
      return true;
    } catch (err) {
      showToast(err.message || 'Could not update the post.', 'error');
      return false;
    } finally {
      setCalendarBusyId(null);
    }
  }, [callSocial, loadCalendar, showToast]);

  // Approve = approved + scheduled at the shown CT time (the go-live step: the sweeper publishes scheduled
  // posts). One server call, no half state. Clearance / reply / collision / expiry rules apply server-side.
  const onCalendarApprove = useCallback((post, { content, scheduledAt }) => {
    if (!scheduledAt) { showToast('Set a publish time first.', 'error'); return Promise.resolve(false); }
    const when = new Date(scheduledAt).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return runCalendarAction(post, { action: 'approve-and-schedule', content, scheduledAt }, `Scheduled for ${when} CT`);
  }, [runCalendarAction, showToast]);

  const onCalendarReject = useCallback((post) => runCalendarAction(post, { action: 'reject-draft' }, 'Rejected'), [runCalendarAction]);

  // `update` edits in place (never mints a second post). scheduledAt is only sent when the reviewer changed it.
  const onCalendarSave = useCallback((post, { content, scheduledAt }) => (
    runCalendarAction(post, { action: 'update', content, ...(scheduledAt ? { scheduledAt } : {}) }, 'Saved')
  ), [runCalendarAction]);

  const onCalendarUnschedule = useCallback((post) => (
    runCalendarAction(post, { action: 'update', content: post.content, scheduledAt: '' }, 'Unscheduled')
  ), [runCalendarAction]);

  // Live score in the sheet: deterministic scoreXPost, no LLM, no cost.
  const onCalendarScore = useCallback(async (content) => {
    const res = await callSocial({ action: 'score', content });
    return res?.score || null;
  }, [callSocial]);

  const onCaptureClient = useCallback(async (capture) => {
    setSavingId('capture');
    setClientError('');
    try {
      await call('capture-client-story', { capture });
      await load();
      showToast('Story captured');
      return true;
    } catch (err) {
      setClientError(err.message || 'Could not capture.');
      showToast(err.message || 'Could not capture.', 'error');
      return false;
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  const onDecidePackage = useCallback(async (action, id) => {
    setSavingId(id);
    setClientError('');
    try {
      await call(action, { id });
      await load();
      showToast(action === 'reject-package' ? 'Rejected' : 'Approved');
    } catch (err) {
      setClientError(err.message || 'Could not update approval.');
      showToast(err.message || 'Could not update approval.', 'error');
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  const onPostsChange = useCallback((next) => {
    setPosts(next);
    load(next);
  }, [load]);

  const onSave = useCallback(async (pkg) => {
    setSavingId(pkg?.id || 'new');
    setError('');
    try {
      await call('inventory-save', { pkg });
      await load();
      showToast('Saved');
    } catch (err) {
      setError(err.message || 'Could not save.');
      showToast(err.message || 'Could not save.', 'error');
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  const onDelete = useCallback(async (id) => {
    setSavingId(id);
    setError('');
    try {
      await call('inventory-delete', { id });
      await load();
      showToast('Deleted');
    } catch (err) {
      setError(err.message || 'Could not delete.');
      showToast(err.message || 'Could not delete.', 'error');
    } finally {
      setSavingId(null);
    }
  }, [call, load, showToast]);

  // The draft preview is deterministic and local: it truncates the author's
  // own story rather than paraphrasing it, and runs the same mechanical rules
  // the CLI runs. A model-written version costs a call per slot, so it stays
  // in `scripts/x-content/draft-day.mjs --execute`.
  const onDraft = useCallback((slot) => {
    const key = slot?.slot || slot?.packageId;
    if (!key) return;
    setDraftingId(key);
    try {
      const pkg = packages.find((p) => p.id === slot.packageId) || { story: slot.story, series: slot.series };
      const text = fallbackDraft({ pkg, slot });
      setDrafts((s) => ({ ...s, [key]: { text, check: validateDraft(text, { series: slot.series, slotType: slot.type }) } }));
    } finally {
      setDraftingId(null);
    }
  }, [packages]);

  return (
    <div id="x-content-card">
      {clientName ? (
        <header id="x-content-header" className="xce-header">
          <p id="x-content-client-line" className="xce-client">{clientName}</p>
        </header>
      ) : null}

      {/* Desktop + tablet (>=481px): tab row. Owns the canonical x-content-tab-<id> ids at every width. */}
      <div id="x-content-tabs" className="xce-tabs" role="tablist">
        {PRIMARY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            id={`x-content-tab-${t.id}`}
            className={`xce-tab${tab === t.id ? ' xce-tab-active' : ''}`}
            onClick={() => pickTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
          >
            <t.Icon size={13} /> {t.label}{t.id === 'inventory' && packages.length ? ` (${packages.length})` : ''}
          </button>
        ))}
        <div id="x-content-more-menu-shell" className="xce-more-shell" ref={moreRef}>
          <button
            type="button"
            id="x-content-more-trigger"
            className={`xce-tab xce-more-trigger${MORE_TABS.some((t) => t.id === tab) ? ' xce-tab-active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((o) => !o)}
          >
            More <ChevronDown size={13} />
          </button>
          <div id="x-content-more-menu" className={`xce-more-menu${moreOpen ? ' is-open' : ''}`} role="menu">
            {MORE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                id={`x-content-tab-${t.id}`}
                role="menuitem"
                className={`xce-more-item${tab === t.id ? ' xce-more-item-active' : ''}`}
                onClick={() => pickTab(t.id)}
              >
                <t.Icon size={13} /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Phone (<=480px): Today = Plan | Discover over the existing plan/today bodies. */}
      {tab === 'plan' || tab === 'today' ? (
        <div id="x-content-today-segmented-shell" className="xce-mobile-only">
          <SegmentedControl
            id="x-content-today-segmented"
            ariaLabel="Today view"
            value={tab}
            onChange={pickTab}
            options={[{ value: 'plan', label: 'Plan' }, { value: 'today', label: 'Discover' }]}
          />
        </div>
      ) : null}

      {tab === 'strategy' ? (
        <StrategyPanel clientId={activeClientId} clientName={clientName} call={call} onPlanChanged={() => load()} />
      ) : tab === 'plan' ? (
        <PlanPanel
          plan={plan}
          loading={loading}
          error={error}
          posts={posts}
          onPostsChange={onPostsChange}
          planSource={planMeta.source}
          planVersion={planMeta.version}
          onOpenStrategy={() => setTab('strategy')}
          onOpenContent={() => setTab('inventory')}
          onRefresh={() => load()}
          onDraft={onDraft}
          draftingId={draftingId}
          drafts={drafts}
        />
      ) : tab === 'today' ? (
        <DailySuggestionsPanel call={call} showToast={showToast} />
      ) : tab === 'timeline' ? (
        <TimelinePanel call={call} />
      ) : tab === 'buckets' ? (
        <BucketsPanel call={call} packages={packages} loading={loading} error={error} onReload={() => load()} />
      ) : tab === 'calendar' ? (
        <MonthCalendarPanel
          calendar={calendar}
          loading={calendarLoading}
          error={calendarError}
          busyId={calendarBusyId}
          onRefresh={() => loadCalendar()}
          onShiftMonth={onShiftMonth}
          onToday={onCalendarToday}
          onApprove={onCalendarApprove}
          onReject={onCalendarReject}
          onSave={onCalendarSave}
          onUnschedule={onCalendarUnschedule}
          onScore={onCalendarScore}
        />
      ) : tab === 'performance' ? (
        <PerformancePanel
          stats={perf?.stats}
          lastCapturedAt={perf?.lastCapturedAt}
          loading={perfLoading}
          error={perfError}
          onRefresh={loadPerformance}
        />
      ) : tab === 'clients' ? (
        <ClientCapturePanel
          packages={packages}
          loading={loading}
          error={clientError || error}
          savingId={savingId}
          onCapture={onCaptureClient}
          onApprove={(id) => onDecidePackage('approve-package', id)}
          onReject={(id) => onDecidePackage('reject-package', id)}
        />
      ) : (
        <InventoryPanel
          packages={packages}
          audit={audit}
          loading={loading}
          error={error}
          savingId={savingId}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}

      <Toast toast={toast} />

      {/* Phone (<=480px): sticky bottom nav. In flow after the panels, so it never covers content. */}
      <div id="x-content-mobile-bottom-nav-shell" className="xce-bottom-shell" ref={moreMobileRef}>
        <div id="x-content-mobile-more-sheet" className={`xce-more-sheet${moreOpen ? ' is-open' : ''}`} role="menu">
          {MOBILE_MORE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              id={`x-content-mobile-more-${t.id}`}
              role="menuitem"
              className={`xce-more-item${tab === t.id ? ' xce-more-item-active' : ''}`}
              onClick={() => pickTab(t.id)}
            >
              <t.Icon size={14} /> {t.label}
            </button>
          ))}
        </div>
        <BottomNav
          id="x-content-mobile-bottom-nav"
          value={moreOpen || MOBILE_MORE_TABS.some((t) => t.id === tab) ? 'more' : tab === 'plan' || tab === 'today' ? 'today' : tab}
          onChange={onMobileNav}
          items={[
            { value: 'strategy', label: 'Chat', icon: <MessagesSquare size={18} /> },
            { value: 'today', label: 'Today', icon: <CalendarDays size={18} /> },
            { value: 'inventory', label: 'Content', icon: <Library size={18} /> },
            { value: 'calendar', label: 'Calendar', icon: <CalendarRange size={18} /> },
            { value: 'more', label: 'More', icon: <Ellipsis size={18} /> },
          ]}
        />
      </div>

      <style jsx global>{`
        /* Mobile first: every rule below is the phone layout. Widening happens
           only in the one min-width block at the bottom. */
        #x-content-card { margin-top: 18px; display: grid; gap: 12px; }

        #x-content-card .xce-tabs { position: relative; display: flex; gap: 6px; padding-bottom: 12px; }
        #x-content-card .xce-tabs::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #22c7e8 0%, #8a5cf0 55%, #e23fb8 100%); }
        #x-content-card .xce-tab { flex: 1; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.62); cursor: pointer; }
        #x-content-card .xce-tab-active { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        #x-content-card .xce-client { margin: 0; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(31,29,27,0.5); }

        #x-content-card .xce-panel { border: 1px solid rgba(31,29,27,0.12); background: #fff; border-radius: 16px; padding: 14px; box-shadow: 0 1px 2px rgba(31,29,27,0.04); }
        #x-content-card .xce-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        #x-content-card .xce-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.62); }
        #x-content-card .xce-sub { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-empty { border: 1px dashed rgba(31,29,27,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 18px 14px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-error { margin: 0 0 10px; font-size: 12px; line-height: 1.4; color: #9f1f17; }

        /* Buttons */
        #x-content-card .xce-btn { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 12px; border: 1px solid #1f1d1b; background: #1f1d1b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn:disabled { opacity: 0.5; cursor: default; }
        #x-content-card .xce-ghost { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.16); background: #fff; color: #1f1d1b; font-size: 11px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-danger { border-color: rgba(159,31,23,0.3); color: #9f1f17; background: rgba(159,31,23,0.05); }

        /* Tier selector */
        #x-content-card .xce-tier { display: inline-flex; gap: 4px; }
        #x-content-card .xce-tier button { min-height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(31,29,27,0.14); background: #fff; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); cursor: pointer; }
        #x-content-card .xce-tier button[aria-pressed="true"] { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }

        /* Header bits */
        #x-content-card .xce-head-date { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-head-count { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-tier-selector { display: inline-flex; flex: 1 1 100%; border: 1px solid rgba(31,29,27,0.12); border-radius: 999px; padding: 2px; background: #fff; }
        #x-content-card .xce-tier-option { flex: 1 1 0; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; font-size: 11.5px; font-weight: 700; color: rgba(31,29,27,0.6); cursor: pointer; }
        #x-content-card .xce-tier-option-active { background: #1f1d1b; color: #fff; }
        #x-content-card .xce-plan-readout { display: flex; flex: 1 1 100%; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border: 1px solid rgba(31,29,27,0.12); border-radius: 12px; padding: 6px 10px; background: #fff; font-size: 11.5px; font-weight: 700; color: rgba(31,29,27,0.75); }
        #x-content-card .xce-plan-readout button { min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid #1f1d1b; background: #1f1d1b; color: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-tier-option:disabled { opacity: 0.48; cursor: not-allowed; }
        #x-content-card .xce-refresh { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(31,29,27,0.12); border-radius: 999px; background: #fff; font-size: 11px; font-weight: 700; color: #1f1d1b; cursor: pointer; }
        #x-content-card .xce-refresh:disabled { opacity: 0.48; cursor: not-allowed; }

        /* States */
        #x-content-card .xce-loading { padding: 14px; text-align: center; font-size: 12.5px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-empty-note { font-size: 11.5px; color: rgba(31,29,27,0.45); }
        /* An unfilled slot is an inventory shortfall, not a failure — amber, not red. */
        #x-content-card .xce-shortfall { margin: 0; padding: 8px 10px; border-radius: 10px; background: rgba(183,121,31,0.08); border: 1px solid rgba(183,121,31,0.24); font-size: 12px; line-height: 1.45; color: #8a5a15; }
        #x-content-card .xce-audit { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.45); }

        /* Slot rows — stacked on a phone, never a horizontal scroll */
        #x-content-card .xce-slot-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        #x-content-card .xce-slot { display: grid; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: #fff; }
        #x-content-card .xce-slot-scan { background: rgba(255,255,255,0.45); }
        #x-content-card .xce-slot-ledger { border-color: rgba(47,158,107,0.24); }
        #x-content-card .xce-gap { border-style: dashed; border-color: rgba(183,121,31,0.4); background: rgba(183,121,31,0.05); }
        #x-content-card .xce-slot-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
        #x-content-card .xce-slot-time { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-slot-type { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); }
        #x-content-card .xce-slot-lane { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.45); }
        #x-content-card .xce-slot-score { font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(31,29,27,0.07); color: #1f1d1b; }
        #x-content-card .xce-slot-body { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
        #x-content-card .xce-slot-detail { min-width: 0; max-width: 100%; display: grid; gap: 4px; }
        #x-content-card .xce-slot-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-draft-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-size: 12px; font-weight: 700; color: #1f1d1b; cursor: pointer; }
        #x-content-card .xce-draft-button:disabled { opacity: 0.48; cursor: not-allowed; }

        /* Row content */
        #x-content-card .xce-muted { margin: 0; font-size: 12px; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-post-text { margin: 0; font-size: 12.5px; line-height: 1.5; color: #1f1d1b; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        /* Package ids and post URLs are long and unbroken; without this they
           widen the row and reintroduce horizontal scrolling on a phone. */
        #x-content-card .xce-asset { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); overflow-wrap: anywhere; }
        #x-content-card .xce-asset a { color: inherit; text-decoration: none; }
        #x-content-card .xce-asset a:hover { text-decoration: underline; }
        #x-content-card .xce-reason { margin: 0; font-size: 11px; line-height: 1.45; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-pkg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; min-width: 0; }
        #x-content-card .xce-pkg-id { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-story { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(31,29,27,0.78); }
        #x-content-card .xce-self-reply { margin: 0; font-size: 11.5px; line-height: 1.45; color: rgba(31,29,27,0.6); }
        #x-content-card .xce-self-reply-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.45); }
        #x-content-card .xce-gap-label { margin: 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a5a15; }
        #x-content-card .xce-gap-need { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(31,29,27,0.7); }

        /* Placeholder artwork — CSS only. The archive is not populated yet, so
           nothing here loads an image or reaches the network. */
        #x-content-card .xce-thumb { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(31,29,27,0.12); background: linear-gradient(135deg, rgba(31,29,27,0.10), rgba(31,29,27,0.04)); color: rgba(31,29,27,0.6); }
        #x-content-card .xce-thumb-code { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #1f1d1b; }
        #x-content-card .xce-thumb-gap { background: transparent; border-style: dashed; border-color: rgba(183,121,31,0.4); color: rgba(183,121,31,0.7); }

        /* Chips */
        #x-content-card .xce-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid rgba(31,29,27,0.1); background: rgba(31,29,27,0.05); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #3a332e; }
        #x-content-card .xce-chip-adopted { border-color: rgba(47,158,107,0.3); background: rgba(47,158,107,0.1); color: #23684a; }
        #x-content-card .xce-chip-blue { border-color: rgba(40,105,200,0.28); background: rgba(40,105,200,0.1); color: #1f55a6; }
        #x-content-card .xce-chip-warn { border-color: rgba(183,121,31,0.3); background: rgba(183,121,31,0.08); color: #8a5a15; }

        /* Draft preview */
        #x-content-card .xce-draft { margin-top: 8px; padding: 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: rgba(255,255,255,0.85); }
        #x-content-card .xce-draft-text { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: #1f1d1b; }
        #x-content-card .xce-draft-meta { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-draft-bad { color: #9f1f17; }

        /* ── Inventory ────────────────────────────────────────────────── */
        #x-content-card .xce-inv { display: grid; gap: 12px; }
        #x-content-card .xce-inv-section { display: grid; gap: 8px; }
        #x-content-card .xce-inv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-inv-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.62); }
        #x-content-card .xce-inv-count { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-inv-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        #x-content-card .xce-inv-row-item { min-width: 0; }
        #x-content-card .xce-inv-row { display: grid; grid-template-columns: 44px 1fr; align-items: start; gap: 10px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: #fff; text-align: left; cursor: pointer; width: 100%; font: inherit; }
        #x-content-card .xce-inv-row-active { border-color: #1f1d1b; }
        #x-content-card .xce-inv-row-main { min-width: 0; display: grid; gap: 4px; }
        #x-content-card .xce-inv-row-title { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.35; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-inv-row-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; }
        #x-content-card .xce-inv-meta-item { font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-inv-row-flags { display: flex; flex-wrap: wrap; gap: 6px; }
        #x-content-card .xce-inv-thumb { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(31,29,27,0.12); background: linear-gradient(135deg, rgba(31,29,27,0.10), rgba(31,29,27,0.04)); font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-inv-title { margin: 0; font-size: 13px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-inv-meta { margin: 2px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }

        /* Editor form */
        #x-content-card .xce-editor { display: grid; gap: 10px; padding-top: 4px; border-top: 1px solid rgba(31,29,27,0.1); }
        #x-content-card .xce-form { display: grid; gap: 10px; }
        #x-content-card .xce-form-grid { display: grid; gap: 10px; }
        #x-content-card .xce-field { display: grid; gap: 4px; min-width: 0; }
        #x-content-card .xce-field-label,
        #x-content-card .xce-field label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-field-hint,
        #x-content-card .xce-field-note { margin: 0; font-size: 11px; line-height: 1.4; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-hint-strong { font-weight: 700; color: rgba(31,29,27,0.72); }
        /* 16px inputs: anything smaller makes iOS zoom the whole modal on focus. */
        #x-content-card .xce-input,
        #x-content-card .xce-select,
        #x-content-card .xce-textarea,
        #x-content-card .xce-field input,
        #x-content-card .xce-field select,
        #x-content-card .xce-field textarea { width: 100%; min-height: 38px; border: 1px solid rgba(31,29,27,0.14); border-radius: 12px; padding: 8px 12px; background: rgba(255,255,255,0.98); color: #1f1d1b; font-family: inherit; font-size: 16px; line-height: 1.45; outline: none; }
        #x-content-card .xce-textarea,
        #x-content-card .xce-field textarea { min-height: 120px; resize: vertical; }
        #x-content-card .xce-input:focus,
        #x-content-card .xce-select:focus,
        #x-content-card .xce-textarea:focus,
        #x-content-card .xce-field input:focus,
        #x-content-card .xce-field select:focus,
        #x-content-card .xce-field textarea:focus { border-color: rgba(31,29,27,0.36); box-shadow: 0 0 0 3px rgba(31,29,27,0.08); }
        #x-content-card .xce-toggle-row { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(31,29,27,0.14); background: #fff; font-size: 12px; color: rgba(31,29,27,0.75); cursor: pointer; }
        #x-content-card .xce-toggle input { width: auto; min-height: 0; margin: 0; }

        /* Actions */
        #x-content-card .xce-actions,
        #x-content-card .xce-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
        #x-content-card .xce-btn-primary { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 12px; border: 1px solid #1f1d1b; background: #1f1d1b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn-ghost { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.16); background: #fff; color: #1f1d1b; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn-danger { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.3); background: rgba(159,31,23,0.05); color: #9f1f17; font-size: 12px; font-weight: 700; cursor: pointer; }
        #x-content-card .xce-btn-primary:disabled,
        #x-content-card .xce-btn-ghost:disabled,
        #x-content-card .xce-btn-danger:disabled { opacity: 0.48; cursor: not-allowed; }

        /* Validation feedback. Errors block the save; warnings are advice and
           must never look like failures, or nobody reads either. */
        #x-content-card .xce-feedback { border-radius: 10px; padding: 8px 10px; border: 1px solid transparent; }
        #x-content-card .xce-feedback-head { margin: 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        #x-content-card .xce-feedback-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; }
        #x-content-card .xce-feedback-error { border-color: rgba(159,31,23,0.24); background: rgba(159,31,23,0.05); color: #9f1f17; }
        #x-content-card .xce-feedback-warn { border-color: rgba(183,121,31,0.24); background: rgba(183,121,31,0.06); color: #8a5a15; }
        #x-content-card .xce-warn-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; color: #8a5a15; }
        #x-content-card .xce-err-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; color: #9f1f17; }
        #x-content-card .xce-notice { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(31,29,27,0.6); }
        #x-content-card .xce-notice-error { color: #9f1f17; }
        #x-content-card .xce-chip-series { font-family: var(--font-mono); letter-spacing: 0.04em; }
        #x-content-card .xce-chip-status { background: #fff; border-color: rgba(31,29,27,0.14); color: rgba(31,29,27,0.55); }
        #x-content-card .xce-chip-error { border-color: rgba(159,31,23,0.28); background: rgba(159,31,23,0.07); color: #9f1f17; }
        #x-content-card .xce-checks { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-check { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; font-size: 12px; color: rgba(31,29,27,0.75); }
        #x-content-card .xce-check input { width: auto; min-height: 0; }

        /* State modifiers the panels emit alongside their base classes. */
        #x-content-card .xce-inv-row.is-active { border-color: rgba(31,29,27,0.4); background: rgba(255,255,255,0.95); }
        #x-content-card .xce-inv-row.is-busy { opacity: 0.6; pointer-events: none; }
        #x-content-card .xce-toggle.is-on { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        #x-content-card .xce-input.is-locked { background: rgba(31,29,27,0.04); color: rgba(31,29,27,0.6); cursor: default; }
        /* A long series label ("C1 · Record of the Day") is the one chip that
           can push a row wider than the phone and bring back horizontal scroll. */
        #x-content-card .xce-chip-series { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #x-content-card .xce-inv-row-flags { grid-column: 1 / -1; }

        /* MOBILE WIDTH STANDARD — at ≤480px the padding chain collapses to the
           single shared gutter so content spans the viewport.
           See docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md. */
        @media (max-width: 480px) {
          #x-content-card .xce-panel,
          #x-content-card .xce-inv-section { padding: 12px var(--mobile-gutter, 8px); border-radius: 12px; }
          #x-content-card .xce-actions .xce-btn,
          #x-content-card .xce-actions .xce-btn-primary,
          #x-content-card .xce-actions .xce-btn-ghost,
          #x-content-card .xce-actions .xce-btn-danger { flex: 1 1 auto; }
        }

        /* The only widening rule. Below this everything is one column. */
        @media (min-width: 640px) {
          #x-content-card .xce-inv-row { grid-template-columns: 44px minmax(0,1fr) auto; }
          #x-content-card .xce-inv-row-flags { grid-column: auto; justify-content: flex-end; }
          #x-content-card .xce-tier-selector { flex: 0 0 auto; margin-left: auto; }
          #x-content-card .xce-slot-score { margin-left: auto; }
          #x-content-card .xce-thumb { width: 56px; height: 56px; }
          #x-content-card .xce-panel { padding: 16px; }
          #x-content-card .xce-slot { grid-template-columns: 44px 1fr; }
          #x-content-card .xce-form-grid { grid-template-columns: 1fr 1fr; }
          #x-content-card .xce-field-wide { grid-column: 1 / -1; }
        }
        /* ── Calendar + Clients ───────────────────────────────────────── */
        #x-content-card .xce-tabs { flex-wrap: wrap; }
        #x-content-card .xce-tab { flex: 1 1 auto; min-width: 0; }
        #x-content-card .xce-engine-counts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        #x-content-card .xce-engine-count { display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); background: #fff; border-left-width: 4px; min-width: 0; }
        #x-content-card .xce-engine-short { background: rgba(183,121,31,0.06); }
        #x-content-card .xce-engine-name { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.6); }
        #x-content-card .xce-engine-num { font-family: var(--font-mono); font-size: 16px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-engine-limit { font-size: 10.5px; color: rgba(31,29,27,0.5); overflow-wrap: anywhere; }
        #x-content-card .xce-engine-record { border-left-color: #b7791f; }
        #x-content-card .xce-engine-ue { border-left-color: #3b6fd4; }
        #x-content-card .xce-engine-client { border-left-color: #2f9e6b; }
        #x-content-card .xce-engine-identity { border-left-color: #7a4bd0; }
        #x-content-card .xce-engine-untagged { border-left-color: rgba(31,29,27,0.3); }
        #x-content-card .xce-engine-chip { border-left-width: 1px; background: rgba(31,29,27,0.05); }
        #x-content-card .xce-flag-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        #x-content-card .xce-week-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        #x-content-card .xce-week-day { display: grid; gap: 6px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: rgba(255,255,255,0.5); min-width: 0; }
        #x-content-card .xce-week-day-head { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-week-slots { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        #x-content-card .xce-week-slot { display: grid; gap: 6px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); border-left-width: 4px; background: #fff; min-width: 0; }
        #x-content-card .xce-skipped-label { color: rgba(31,29,27,0.55); }
        #x-content-card .xce-textarea-short { min-height: 64px; }
        #x-content-card .xce-week-slot .xce-input { max-width: 100%; }

        /* ── Month calendar (MonthCalendarPanel + PostSheet) ─────────────
           Status is weight, never a colour strip: scheduled = solid outline +
           filled dot, pending = grey dashed + hollow dot, posted = muted +
           check, failed = the only red. Grid lines are neutral structure. */
        #x-content-card .xce-mc { display: grid; gap: 14px; }
        #x-content-card .xce-mc-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
        #x-content-card .xce-mc-title-block { display: grid; gap: 6px; min-width: 0; }
        #x-content-card .xce-mc-title { margin: 0; font-size: 28px; line-height: 1; font-weight: 500; letter-spacing: -0.02em; color: #2a2420; }
        #x-content-card .xce-mc-summary { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-summary strong { color: #2a2420; font-weight: 700; }
        #x-content-card .xce-mc-summary-failed,
        #x-content-card .xce-mc-summary-failed strong { color: #9f1f17; }
        #x-content-card .xce-mc-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-mc-nav { display: inline-flex; align-items: center; gap: 2px; }
        #x-content-card .xce-mc-icon-btn { width: 34px; height: 34px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #2a2420; cursor: pointer; transition: background 120ms ease-out, border-color 120ms ease-out; }
        #x-content-card .xce-mc-icon-btn:hover:not(:disabled) { border-color: rgba(42,36,32,0.16); background: rgba(255,255,255,0.85); }
        #x-content-card .xce-mc-icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        #x-content-card .xce-mc-text-btn,
        #x-content-card .xce-mc-seg { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
        #x-content-card .xce-mc-text-btn { min-height: 34px; padding: 0 12px; border: 1px solid rgba(42,36,32,0.16); border-radius: 999px; background: rgba(255,255,255,0.7); color: #2a2420; }
        #x-content-card .xce-mc-text-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        #x-content-card .xce-mc-filter-on { background: #2a2420; border-color: #2a2420; color: #fff; }
        #x-content-card .xce-mc-segmented { display: inline-flex; padding: 2px; border: 1px solid rgba(42,36,32,0.14); border-radius: 999px; background: rgba(255,255,255,0.6); }
        #x-content-card .xce-mc-seg { min-height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-mc-seg-active { background: #2a2420; color: #fff; }
        #x-content-card .xce-mc-review { min-height: 34px; border-radius: 999px; }
        #x-content-card .xce-mc button:focus-visible,
        #x-content-card .xce-mc-sheet button:focus-visible { outline: 2px solid rgba(42,36,32,0.55); outline-offset: 2px; }

        #x-content-card .xce-mc-grid { display: grid; border-top: 1px solid rgba(42,36,32,0.12); border-bottom: 1px solid rgba(42,36,32,0.08); transition: opacity 120ms ease-out; }
        #x-content-card .xce-mc-grid-loading { opacity: 0.5; }
        #x-content-card .xce-mc-weekdays,
        #x-content-card .xce-mc-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
        #x-content-card .xce-mc-weekday { padding: 8px 6px 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.45); }
        #x-content-card .xce-mc-weekday-short { display: none; }
        #x-content-card .xce-mc-week { border-top: 1px solid rgba(42,36,32,0.08); }
        #x-content-card .xce-mc-day { position: relative; min-width: 0; min-height: 112px; padding: 6px 4px; border-left: 1px solid rgba(42,36,32,0.08); display: flex; flex-direction: column; gap: 4px; cursor: pointer; outline: none; transition: background 120ms ease-out; }
        #x-content-card .xce-mc-week > .xce-mc-day:first-child { border-left: 0; }
        #x-content-card .xce-mc-day:hover { background: rgba(42,36,32,0.025); }
        #x-content-card .xce-mc-day:focus-visible { box-shadow: inset 0 0 0 2px rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-day-selected { background: rgba(42,36,32,0.045); }
        #x-content-card .xce-mc-date { align-self: flex-start; min-width: 24px; height: 24px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #2a2420; }
        #x-content-card .xce-mc-day-past .xce-mc-date { color: rgba(42,36,32,0.42); }
        #x-content-card .xce-mc-day-out .xce-mc-date { color: rgba(42,36,32,0.22); }
        #x-content-card .xce-mc-day-today .xce-mc-date { background: #2a2420; color: #fff; }
        #x-content-card .xce-mc-flag { position: absolute; top: 9px; right: 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: #8a5a15; }
        #x-content-card .xce-mc-chips { display: grid; gap: 3px; min-width: 0; }
        #x-content-card .xce-mc-chip { display: flex; align-items: center; gap: 5px; width: 100%; min-width: 0; min-height: 22px; padding: 0 6px; border: 1px solid rgba(42,36,32,0.5); border-radius: 6px; background: #fff; color: #2a2420; font-size: 11px; text-align: left; cursor: pointer; transition: border-color 120ms ease-out; }
        #x-content-card .xce-mc-chip:hover { border-color: #2a2420; }
        #x-content-card .xce-mc-chip-time { flex: 0 0 auto; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; }
        #x-content-card .xce-mc-chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #x-content-card .xce-mc-chip.xce-mc-state-pending { border-style: dashed; border-color: rgba(42,36,32,0.3); background: transparent; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-chip.xce-mc-state-pending:hover { border-color: rgba(42,36,32,0.6); }
        #x-content-card .xce-mc-chip.xce-mc-state-posted { border-color: transparent; background: rgba(42,36,32,0.05); color: rgba(42,36,32,0.6); }
        #x-content-card .xce-mc-chip.xce-mc-state-failed { border-color: rgba(159,31,23,0.5); color: #9f1f17; }
        #x-content-card .xce-mc-more { padding: 0 6px; font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-dots { display: none; }
        #x-content-card .xce-mc-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: #2a2420; color: #2a2420; }
        #x-content-card .xce-mc-dot-pending { background: transparent; box-shadow: inset 0 0 0 1.5px rgba(42,36,32,0.4); }
        #x-content-card .xce-mc-dot-posted { width: 10px; height: 10px; background: rgba(42,36,32,0.14); }
        #x-content-card .xce-mc-dot-failed { background: #9f1f17; }

        #x-content-card .xce-mc-dayview,
        #x-content-card .xce-mc-agenda-day { display: grid; gap: 6px; }
        #x-content-card .xce-mc-agenda { display: grid; gap: 20px; }
        #x-content-card .xce-mc-kicker { margin: 0; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-mc-agenda-today > .xce-mc-kicker { color: #2a2420; }
        #x-content-card .xce-mc-rows { list-style: none; margin: 0; padding: 0; display: grid; }
        #x-content-card .xce-mc-row { display: flex; align-items: center; gap: 4px; min-width: 0; border-top: 1px solid rgba(42,36,32,0.08); }
        #x-content-card .xce-mc-row:first-child { border-top: 0; }
        #x-content-card .xce-mc-row-main { flex: 1 1 auto; min-width: 0; display: grid; grid-template-columns: 46px 10px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 52px; padding: 8px 4px; border: 0; border-radius: 8px; background: transparent; color: #2a2420; text-align: left; cursor: pointer; transition: background 120ms ease-out; }
        #x-content-card .xce-mc-row-main:hover { background: rgba(42,36,32,0.035); }
        #x-content-card .xce-mc-row-time { font-family: var(--font-mono); font-size: 12px; font-weight: 700; }
        #x-content-card .xce-mc-row-body { display: grid; gap: 2px; min-width: 0; }
        #x-content-card .xce-mc-row-title { font-size: 13px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        #x-content-card .xce-mc-row-meta { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-row.xce-mc-state-pending .xce-mc-row-time,
        #x-content-card .xce-mc-row.xce-mc-state-pending .xce-mc-row-title { color: rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-row.xce-mc-state-posted .xce-mc-row-title { color: rgba(42,36,32,0.6); }
        #x-content-card .xce-mc-row.xce-mc-state-failed .xce-mc-row-meta { color: #9f1f17; }
        #x-content-card .xce-mc-row-actions { display: inline-flex; gap: 2px; flex: 0 0 auto; }
        #x-content-card .xce-mc-empty { margin: 0; padding: 14px 0; font-size: 12.5px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-mc-flags { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 11.5px; color: #8a5a15; }
        #x-content-card .xce-mc-unplaced { padding-top: 10px; border-top: 1px solid rgba(42,36,32,0.1); }
        #x-content-card .xce-mc-unplaced > summary { cursor: pointer; list-style: none; min-height: 28px; display: flex; align-items: center; }
        #x-content-card .xce-mc-unplaced > summary::-webkit-details-marker { display: none; }

        /* Phone: dots in the grid, the selected day's list carries the content. */
        @media (max-width: 639px) {
          #x-content-card .xce-mc-title { font-size: 22px; }
          #x-content-card .xce-mc-controls { width: 100%; }
          #x-content-card .xce-mc-review { margin-left: auto; }
          #x-content-card .xce-mc-weekday { padding: 6px 0; text-align: center; }
          #x-content-card .xce-mc-weekday-long { display: none; }
          #x-content-card .xce-mc-weekday-short { display: inline; }
          #x-content-card .xce-mc-day { min-height: 54px; padding: 4px 0; align-items: center; gap: 4px; border-left: 0; }
          #x-content-card .xce-mc-date { align-self: center; min-width: 28px; height: 28px; }
          #x-content-card .xce-mc-day-selected { background: transparent; }
          #x-content-card .xce-mc-day-selected .xce-mc-date { box-shadow: inset 0 0 0 1.5px #2a2420; }
          #x-content-card .xce-mc-day-today.xce-mc-day-selected .xce-mc-date { box-shadow: none; }
          #x-content-card .xce-mc-flag { top: 2px; right: 2px; }
          #x-content-card .xce-mc-chips { display: none; }
          #x-content-card .xce-mc-dots { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 3px; min-height: 10px; }
          #x-content-card .xce-mc-dots-more { font-family: var(--font-mono); font-size: 9px; line-height: 1; color: rgba(42,36,32,0.5); }
          #x-content-card .xce-mc-row-main { min-height: 56px; }
          #x-content-card .xce-mc-icon-btn { width: 44px; height: 44px; }
          #x-content-card .xce-mc-text-btn { min-height: 40px; }
        }
        /* Tablet: time-only chips so a 7-column row still reads. */
        @media (min-width: 640px) and (max-width: 1023px) {
          #x-content-card .xce-mc-day { min-height: 92px; }
          #x-content-card .xce-mc-chip-text { display: none; }
        }
        @media (min-width: 1024px) {
          #x-content-card .xce-mc-day { min-height: 124px; padding: 6px; }
        }

        /* PostSheet: full-screen on phones, right sheet from 481px. */
        #x-content-card .xce-mc-sheet-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: flex-end; background: rgba(42,36,32,0.32); animation: xce-mc-fade 140ms ease-out; }
        #x-content-card .xce-mc-sheet { width: 100%; height: 100%; display: flex; flex-direction: column; background: #fbfaf8; outline: none; animation: xce-mc-rise 180ms cubic-bezier(0.2, 0, 0, 1); }
        #x-content-card .xce-mc-sheet-head { display: flex; align-items: center; gap: 6px; padding: 8px var(--mobile-gutter, 8px); border-bottom: 1px solid rgba(42,36,32,0.1); }
        #x-content-card .xce-mc-sheet-state { margin-right: auto; display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #2a2420; }
        #x-content-card .xce-mc-sheet-state.xce-mc-state-pending { color: rgba(42,36,32,0.55); }
        #x-content-card .xce-mc-sheet-state.xce-mc-state-failed { color: #9f1f17; }
        #x-content-card .xce-mc-sheet-queue { display: inline-flex; align-items: center; }
        #x-content-card .xce-mc-sheet-queue-pos { min-width: 44px; text-align: center; font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-mc-sheet-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 18px var(--mobile-gutter, 8px) 24px; display: grid; gap: 18px; align-content: start; }
        #x-content-card .xce-mc-sheet-when { margin: 0; font-size: 22px; line-height: 1.15; font-weight: 500; letter-spacing: -0.01em; color: #2a2420; }
        #x-content-card .xce-mc-sheet-media { border-radius: 10px; overflow: hidden; background: #141210; }
        #x-content-card .xce-mc-sheet-media video,
        #x-content-card .xce-mc-sheet-media img { display: block; width: 100%; max-height: 360px; object-fit: contain; }
        #x-content-card .xce-mc-field { display: grid; gap: 6px; min-width: 0; }
        #x-content-card .xce-mc-sheet-body > * { min-width: 0; }
        #x-content-card .xce-mc-sheet textarea,
        #x-content-card .xce-mc-sheet input { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; }
        #x-content-card .xce-mc-sheet-text { min-height: 168px; font-size: 15px; line-height: 1.5; }
        #x-content-card .xce-mc-sheet-meta-line { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-mc-over { margin: 0; font-size: 12px; font-weight: 700; color: #9f1f17; }
        #x-content-card .xce-mc-sheet-meta-line .xce-mc-over { font-size: inherit; }
        #x-content-card .xce-mc-when-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 8px; }
        #x-content-card .xce-mc-notice { margin: 0; font-size: 12.5px; line-height: 1.5; color: #8a5a15; }
        #x-content-card .xce-mc-facts { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; }
        #x-content-card .xce-mc-facts dt { padding-top: 1px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.45); }
        #x-content-card .xce-mc-facts dd { margin: 0; font-family: var(--font-mono); font-size: 11.5px; color: #2a2420; overflow-wrap: anywhere; }
        #x-content-card .xce-mc-facts a { color: inherit; }
        #x-content-card .xce-mc-sheet-foot { display: grid; gap: 8px; padding: 12px var(--mobile-gutter, 8px) calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(42,36,32,0.1); background: #fbfaf8; }
        #x-content-card .xce-mc-sheet-consequence { margin: 0; font-size: 12px; line-height: 1.4; color: rgba(42,36,32,0.65); }
        #x-content-card .xce-mc-sheet-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-mc-sheet-buttons .xce-btn-primary { margin-left: auto; }
        #x-content-card .xce-mc-sheet-keys { display: none; margin: 0; font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.4); }
        @media (max-width: 480px) {
          #x-content-card .xce-mc-sheet-buttons > button { flex: 1 1 0; min-height: 44px; }
          #x-content-card .xce-mc-sheet-buttons .xce-btn-primary { order: -1; flex-basis: 100%; margin-left: 0; }
        }
        @media (min-width: 481px) {
          #x-content-card .xce-mc-sheet { max-width: 480px; border-left: 1px solid rgba(42,36,32,0.14); animation-name: xce-mc-slide; }
          #x-content-card .xce-mc-sheet-head { padding: 10px 16px; }
          #x-content-card .xce-mc-sheet-body { padding: 22px 20px 28px; }
          #x-content-card .xce-mc-sheet-foot { padding: 14px 20px; }
        }
        @media (min-width: 1024px) and (pointer: fine) {
          #x-content-card .xce-mc-sheet-keys { display: block; }
        }
        @keyframes xce-mc-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes xce-mc-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes xce-mc-slide { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          #x-content-card .xce-mc-sheet,
          #x-content-card .xce-mc-sheet-backdrop { animation: none; }
        }

        /* ── Results (performance) ────────────────────────────────────── */
        #x-content-card .xce-perf-list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 8px; }
        #x-content-card .xce-perf-row { display: grid; gap: 6px; padding: 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); border-left-width: 4px; background: #fff; min-width: 0; }
        #x-content-card .xce-perf-name { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #x-content-card .xce-perf-flag { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: #b7791f; }
        #x-content-card .xce-perf-rank { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-perf-grid { margin: 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
        #x-content-card .xce-perf-grid dt { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-perf-grid dd { margin: 0; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-perf-meaning { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(31,29,27,0.7); overflow-wrap: anywhere; }
        @media (max-width: 480px) {
          #x-content-card .xce-perf-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        }

        /* ── Buckets ──────────────────────────────────────────────────── */
        #x-content-card .xce-bk { display: grid; gap: 10px; }
        #x-content-card .xce-bk-search { display: grid; gap: 4px; }
        #x-content-card .xce-bk-search > svg { display: none; }
        #x-content-card .xce-bk-layout { display: grid; gap: 10px; min-width: 0; }
        #x-content-card .xce-bk-main { display: grid; gap: 10px; min-width: 0; align-content: start; }
        /* Rail: fixed-height rows that never stretch with the grid beside them
           (the grid grows as content populates; the rail must not). Buttons
           follow the card's established button spec: 38px, 10px radius. */
        #x-content-card .xce-bk-rail { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-self: start; }
        #x-content-card .xce-bk-rail > * { flex: 0 0 auto; }
        #x-content-card .xce-bk-list { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; overflow-x: auto; max-width: 100%; align-items: flex-start; }
        #x-content-card .xce-bk-item { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; min-width: 0; }
        #x-content-card .xce-bk-item.is-inactive { opacity: 0.55; }
        #x-content-card .xce-bk-chip { display: inline-flex; align-items: center; gap: 8px; height: 38px; min-height: 38px; padding: 0 12px; box-sizing: border-box; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-size: 12px; font-weight: 700; color: #1f1d1b; cursor: pointer; white-space: nowrap; text-align: left; }
        #x-content-card .xce-bk-chip.is-active { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        #x-content-card .xce-bk-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
        #x-content-card .xce-bk-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
        #x-content-card .xce-bk-count { flex: 0 0 auto; font-family: var(--font-mono); font-size: 10.5px; opacity: 0.65; }
        #x-content-card .xce-bk-share { display: none; padding-left: 12px; font-family: var(--font-mono); font-size: 10px; line-height: 1.2; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-bk-tools { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
        #x-content-card .xce-bk-rename { display: grid; grid-template-columns: minmax(0,1fr) 38px 38px; gap: 6px; align-items: center; }
        #x-content-card .xce-bk-icon { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-width: 38px; height: 38px; box-sizing: border-box; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; color: #1f1d1b; cursor: pointer; }
        #x-content-card #x-content-bucket-add { width: 100%; }
        /* Rail row = bucket button + fixed 38px "⋯" menu on EVERY row (no row ever grows or shifts). */
        #x-content-card .xce-bk-row { display: grid; grid-template-columns: minmax(0,1fr) 38px; gap: 6px; align-items: center; width: 100%; }
        #x-content-card .xce-bk-more-spacer { width: 38px; height: 38px; }
        #x-content-card .xce-bk-more .xce-pop-trigger { border-color: transparent; background: transparent; color: rgba(31,29,27,0.45); }
        #x-content-card .xce-bk-more .xce-pop-trigger:hover, #x-content-card .xce-bk-more .xce-pop-trigger.is-open { border-color: rgba(31,29,27,0.12); background: #fff; color: #1f1d1b; }
        /* Toolbar: one fixed-height row, identical for every bucket. */
        #x-content-card .xce-bk-toolbar { display: flex; align-items: center; gap: 8px; height: 38px; min-width: 0; }
        #x-content-card .xce-bk-view { height: 38px; min-height: 38px; flex: 0 1 260px; min-width: 0; border-radius: 10px; font-size: 12px; font-weight: 700; }
        #x-content-card .xce-bk-toolbar-count { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-bk-toolbar-icons { display: inline-flex; gap: 6px; flex: 0 0 auto; }
        #x-content-card .xce-bk-toolbar-icons .xce-bk-icon { width: 38px; }
        #x-content-card .xce-spin { animation: xce-spin 0.9s linear infinite; }
        @keyframes xce-spin { to { transform: rotate(360deg); } }
        /* Popovers float over content — opening one never moves the layout. */
        #x-content-card .xce-pop { position: relative; display: inline-flex; }
        #x-content-card .xce-pop-panel { position: absolute; top: calc(100% + 6px); z-index: 40; min-width: 220px; max-width: min(320px, 86vw); max-height: 60vh; overflow-y: auto; padding: 6px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fbfaf8; box-shadow: 0 10px 28px rgba(0,0,0,0.12); box-sizing: border-box; }
        #x-content-card .xce-pop-panel.align-right { right: 0; }
        #x-content-card .xce-pop-panel.align-left { left: 0; }
        #x-content-card .xce-pop-panel .xce-bk-form { border: 0; background: transparent; padding: 4px; }
        #x-content-card .xce-pop-panel .xce-bk-legend { display: grid; gap: 8px; padding: 6px; }
        #x-content-card .xce-pop-list { display: grid; gap: 2px; }
        #x-content-card .xce-pop-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 12px; font-weight: 600; color: #1f1d1b; text-align: left; cursor: pointer; }
        #x-content-card .xce-pop-item:hover:not(:disabled) { background: rgba(31,29,27,0.06); }
        #x-content-card .xce-pop-item:disabled { opacity: 0.4; cursor: default; }
        #x-content-card .xce-pop-item.is-danger { color: #9f1f17; }
        #x-content-card .xce-pop-item .xce-bk-count { margin-left: auto; }
        #x-content-card .xce-bk-results { display: grid; gap: 16px; }
        #x-content-card .xce-bk-result-group { display: grid; gap: 8px; }
        #x-content-card .xce-bk-result-head { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; font-weight: 700; color: #1f1d1b; }
        #x-content-card .xce-bk-result-head .xce-bk-count { margin-left: 2px; }
        #x-content-card .xce-pop-label { margin: 4px 10px; font-family: var(--font-mono); font-size: 10px; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-bk-icon:disabled { opacity: 0.4; cursor: default; }
        #x-content-card .xce-bk-link { border: 0; background: none; padding: 0; font: inherit; color: #9f1f17; cursor: pointer; text-decoration: underline; }
        #x-content-card .xce-bk-form { display: grid; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: rgba(255,255,255,0.5); }
        #x-content-card .xce-bk-share-row { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; }
        #x-content-card .xce-bk-folder-section { display: grid; gap: 6px; }
        #x-content-card .xce-bk-folders { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        #x-content-card .xce-bk-folder { display: inline-flex; align-items: center; gap: 6px; height: 38px; min-height: 38px; box-sizing: border-box; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-size: 11.5px; font-weight: 700; color: #1f1d1b; cursor: pointer; max-width: 100%; }
        #x-content-card .xce-bk-folder.is-active { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        #x-content-card .xce-bk-folder-add, #x-content-card .xce-bk-suggest { border-style: dashed; }
        #x-content-card .xce-bk-rule { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #x-content-card .xce-bk-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
        #x-content-card .xce-bk-card-li { min-width: 0; }
        #x-content-card .xce-bk-card { display: grid; gap: 6px; width: 100%; padding: 6px 6px 8px; text-align: left; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); background: #fff; font: inherit; cursor: pointer; align-content: start; }
        #x-content-card .xce-bk-card.is-active { border-color: #1f1d1b; }
        #x-content-card .xce-bk-thumb { display: block; aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; background: linear-gradient(135deg, rgba(31,29,27,0.10), rgba(31,29,27,0.04)); }
        #x-content-card .xce-bk-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        #x-content-card .xce-bk-thumb-ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 100%; height: 100%; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-bk-card-title { padding: 0 2px; font-size: 12px; font-weight: 600; line-height: 1.35; color: #1f1d1b; overflow-wrap: break-word; hyphens: auto; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: calc(1.35em * 2); }
        #x-content-card .xce-bk-card-meta { display: flex; flex-wrap: wrap; gap: 4px; }
        /* Status as dots, not text pills: bucket · status · story · rights · daily-auto. Meaning on hover + in the legend. */
        #x-content-card .xce-bk-card-dots { display: flex; align-items: center; gap: 5px; padding: 0 2px; min-height: 10px; }
        #x-content-card .xce-bk-dotmark { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid transparent; box-sizing: border-box; flex: 0 0 auto; }
        #x-content-card .xce-bk-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-size: 10px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-bk-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        #x-content-card .xce-bk-drawer-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(31,29,27,0.35); display: flex; justify-content: flex-end; }
        #x-content-card .xce-bk-drawer { width: 100%; max-width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; background: #fbfaf8; padding: 14px var(--mobile-gutter, 8px) 24px; display: grid; gap: 12px; align-content: start; box-sizing: border-box; }
        #x-content-card .xce-bk-drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        #x-content-card .xce-bk-facets { display: grid; gap: 8px; }
        #x-content-card .xce-bk-media-preview { width: 100%; border-radius: 12px; overflow: hidden; background: #1f1b18; display: flex; justify-content: center; }
        #x-content-card .xce-bk-media-preview video, #x-content-card .xce-bk-media-preview img { display: block; width: 100%; max-width: 100%; max-height: 52vh; object-fit: contain; }
        #x-content-card .xce-bk-source { margin: 0; font-size: 12px; line-height: 1.4; color: rgba(31,29,27,0.7); overflow-wrap: anywhere; min-width: 0; }
        #x-content-card .xce-bk-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
        #x-content-card .xce-chip-ok { border-color: rgba(31,122,76,0.3); background: rgba(31,122,76,0.08); color: #1f6b44; }
        #x-content-card .xce-bk-sync-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
        #x-content-card .xce-bk-sync-row .xce-sub { margin: 0; overflow-wrap: anywhere; min-width: 0; }
        #x-content-card .xce-bk-sync-row .xce-error { flex: 1 0 100%; margin: 0; }
        #x-content-card .xce-bk-thumb { position: relative; }
        #x-content-card .xce-bk-thumb-flag { position: absolute; right: 6px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: #d97706; box-shadow: 0 0 0 2px rgba(255,255,255,0.9); }
        #x-content-card .xce-bk-action-row { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-content-card .xce-bk-action-row > button { min-height: 38px; border-radius: 10px; box-sizing: border-box; }
        #x-content-card .xce-bk-thumb-summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; padding: 8px; box-sizing: border-box; text-align: center; font-size: 11px; line-height: 1.3; font-weight: 600; }
        #x-content-card #x-content-nas-preview .xce-field-hint { color: rgba(255,255,255,0.8); padding: 12px; margin: 0; }
        #x-content-card .xce-nas-panel { display: grid; gap: 12px; min-width: 0; }
        #x-content-card .xce-nas-status { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 12px; font-weight: 600; color: #1f1d1b; }
        #x-content-card .xce-nas-status .xce-bk-dotmark { flex: 0 0 auto; margin-top: 3px; }
        #x-content-card .xce-nas-browser { display: grid; gap: 6px; min-width: 0; }
        #x-content-card .xce-nas-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: 11px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-nas-crumb { border: 0; background: transparent; padding: 4px 6px; border-radius: 6px; font: inherit; font-weight: 700; color: #1f1d1b; cursor: pointer; }
        #x-content-card .xce-nas-crumb:hover { background: rgba(31,29,27,0.06); }
        #x-content-card .xce-nas-list { list-style: none; margin: 0; padding: 4px; height: 240px; overflow-y: auto; overflow-x: hidden; border: 1px solid rgba(31,29,27,0.12); border-radius: 10px; background: #fff; box-sizing: border-box; }
        #x-content-card .xce-nas-row { display: flex; align-items: center; gap: 8px; min-height: 36px; min-width: 0; }
        #x-content-card .xce-nas-name { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; height: 36px; border: 0; background: transparent; padding: 0 6px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600; color: #1f1d1b; text-align: left; cursor: pointer; }
        #x-content-card .xce-nas-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #x-content-card .xce-nas-name.is-file { cursor: default; font-weight: 500; color: rgba(31,29,27,0.75); }
        #x-content-card button.xce-nas-name:hover { background: rgba(31,29,27,0.06); }
        #x-content-card .xce-nas-empty { padding: 12px; font-size: 12px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-nas-empty.is-error { color: #9f1f17; }
        #x-content-card .xce-nas-controls { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
        #x-content-card .xce-nas-cap { flex: 1 1 120px; min-width: 0; }
        #x-content-card .xce-nas-estimate { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.7); overflow-wrap: anywhere; }
        #x-content-card .xce-nas-connect-row { display: grid; gap: 8px; min-width: 0; }
        #x-content-card .xce-nas-cmd { display: block; padding: 8px 10px; border-radius: 8px; background: rgba(31,29,27,0.06); font-family: var(--font-mono); font-size: 11px; user-select: all; overflow-wrap: anywhere; }
        #x-content-card .xce-nas-selall { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 12px; font-weight: 600; cursor: pointer; }
        #x-content-card .xce-nas-meta { margin-left: auto; padding-left: 8px; flex: 0 0 auto; font-style: normal; font-size: 10px; font-weight: 500; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-nas-selected { margin: 0; font-size: 11px; color: rgba(31,29,27,0.7); }
        #x-content-card .xce-nas-clear { border: 0; background: transparent; padding: 0; font: inherit; font-weight: 700; color: #1f1d1b; text-decoration: underline; cursor: pointer; }
        #x-content-card .xce-nas-crumb:disabled { opacity: 0.35; cursor: default; }
        #x-content-card .xce-nas-start { width: 100%; }
        #x-content-card .xce-nas-jobs { display: grid; gap: 8px; }
        #x-content-card .xce-nas-job { display: grid; gap: 4px; padding: 8px; border: 1px solid rgba(31,29,27,0.12); border-radius: 10px; background: #fff; }
        #x-content-card .xce-nas-job-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
        #x-content-card .xce-nas-job-state { font-size: 11px; font-weight: 700; text-transform: capitalize; }
        #x-content-card .xce-nas-job-head .xce-bk-count { margin-left: auto; }
        #x-content-card .xce-nas-cancel { width: 38px; min-width: 38px; flex: 0 0 auto; }
        #x-content-card .xce-nas-bar { height: 6px; border-radius: 3px; background: rgba(31,29,27,0.1); overflow: hidden; }
        #x-content-card .xce-nas-bar > span { display: block; height: 100%; background: #1f1d1b; transition: width 0.3s; }
        #x-content-card .xce-bk-usage { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); }
        @media (min-width: 481px) {
          #x-content-card .xce-bk-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
          #x-content-card .xce-bk-drawer { max-width: 440px; padding: 16px; box-shadow: -8px 0 24px rgba(0,0,0,0.12); }
        }
        @media (min-width: 640px) {
          #x-content-card .xce-bk-layout { grid-template-columns: 220px minmax(0,1fr); align-items: start; }
          #x-content-card .xce-bk-rail { position: sticky; top: 12px; }
          #x-content-card .xce-bk-list { flex-direction: column; align-items: stretch; overflow: visible; }
          #x-content-card .xce-bk-item { flex: 0 0 auto; }
          #x-content-card .xce-bk-chip { width: 100%; }
          #x-content-card .xce-bk-share { display: block; }
          #x-content-card .xce-bk-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
        }

        @media (max-width: 480px) {
          #x-content-card .xce-tab { padding: 0 6px; font-size: 10px; }
        }

        /* ── Layout pass: full width, fluid grids, collapsed details ──── */
        #x-content-card { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
        #x-content-card .xce-panel { width: 100%; box-sizing: border-box; min-width: 0; }
        /* Counts and week days fill whatever width the modal gives them, so
           there is no breakpoint to get wrong. */
        #x-content-card .xce-engine-counts { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
        #x-content-card .xce-week-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); align-items: start; }
        #x-content-card .xce-slot-list,
        #x-content-card .xce-inv-list { grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); align-items: start; }
        /* Phone width pass (≤480px): same structure, less side chrome. The
           modal already contributes overlay + content-cell gutters, so the card
           pulls 6px into them, the panel drops its side border/padding, and
           nested row cards tighten to 6px so text gets the full line. */
        @media (max-width: 480px) {
          #x-content-card { margin-left: -6px; margin-right: -6px; width: calc(100% + 12px); max-width: calc(100% + 12px); gap: 8px; }
          #x-content-card .xce-panel,
          #x-content-card .xce-inv-section { padding: 8px 0; border-left: 0; border-right: 0; border-radius: 0; background: transparent; backdrop-filter: none; box-shadow: none; }
          #x-content-card .xce-slot,
          #x-content-card .xce-week-day,
          #x-content-card .xce-perf-row,
          #x-content-card .xce-inv-row,
          #x-content-card .xce-bk-form,
          #x-content-card .xce-nas-job { padding: 8px 6px; }
          #x-content-card .xce-week-slot { padding: 6px; }
          #x-content-card .xce-engine-count { padding: 6px 8px; }
          #x-content-card .xce-slot-list,
          #x-content-card .xce-inv-list,
          #x-content-card .xce-week-grid,
          #x-content-card .xce-week-slots,
          #x-content-card .xce-engine-counts,
          #x-content-card .xce-bk-layout,
          #x-content-card .xce-bk-main { gap: 6px; }
          #x-content-card .xce-head { margin-bottom: 6px; gap: 6px; }
          #x-content-card .xce-bk-card { padding: 4px 4px 6px; }
          #x-content-card .xce-bk-grid { gap: 6px; }
          #x-content-card .xce-bk-drawer { padding-left: 6px; padding-right: 6px; }
        }
        /* Tabs: one scrollable row on a phone instead of wrapping to two. */
        @media (max-width: 480px) {
          #x-content-card .xce-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
          #x-content-card .xce-tab { flex: 0 0 auto; }
        }
        /* Item drawer: full card width; thumbnail left (sticky), every field right. */
        @media (min-width: 481px) {
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) { max-width: 100%; width: 100%; box-shadow: none; padding-left: 16px; padding-right: 16px; }
        }
        @media (min-width: 900px) {
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) { grid-template-columns: minmax(300px, 38%) minmax(0, 1fr); column-gap: 20px; }
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) > * { grid-column: 2; }
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) > .xce-bk-drawer-head { grid-column: 1 / -1; }
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) > .xce-bk-media-preview { grid-column: 1; grid-row: 2 / span 40; position: sticky; top: 0; align-self: start; }
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) .xce-bk-media-preview video,
          #x-content-card .xce-bk-drawer:has(.xce-bk-media-preview) .xce-bk-media-preview img { max-height: calc(100vh - 160px); }
        }
        /* NAS plain-language status */
        #x-content-card .xce-nas-plan { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; }
        #x-content-card .xce-nas-plan-main { margin: 0; font-size: 13px; line-height: 1.5; color: #1f1d1b; font-weight: 600; }
        #x-content-card .xce-nas-plan-cap { margin: 0; font-size: 12.5px; line-height: 1.5; color: #8a5a15; font-weight: 600; }
        #x-content-card .xce-nas-now { margin: 0; padding: 8px 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; background: rgba(31,29,27,0.05); color: rgba(31,29,27,0.7); }
        #x-content-card .xce-nas-now.is-busy { background: rgba(31,107,68,0.1); color: #1f6b44; }
        #x-content-card .xce-nas-job { border-left-width: 4px; }
        #x-content-card .xce-nas-job-complete { border-left-color: #1f7a4c; }
        #x-content-card .xce-nas-job-cancelled, #x-content-card .xce-nas-job-estimate { border-left-color: rgba(31,29,27,0.3); }
        #x-content-card .xce-nas-job-failed, #x-content-card .xce-nas-job-estimate-failed { border-left-color: #9f1f17; }
        #x-content-card .xce-nas-job-running, #x-content-card .xce-nas-job-queued, #x-content-card .xce-nas-job-estimate-running { border-left-color: #b7791f; }
        /* Tap targets: 44px minimum on touch screens. */
        @media (pointer: coarse) {
          #x-content-card .xce-btn,
          #x-content-card .xce-btn-primary,
          #x-content-card .xce-btn-ghost,
          #x-content-card .xce-btn-danger,
          #x-content-card .xce-ghost,
          #x-content-card .xce-draft-button,
          #x-content-card .xce-refresh,
          #x-content-card .xce-tab,
          #x-content-card .xce-tier button,
          #x-content-card .xce-tier-option,
          #x-content-card .xce-toggle,
          #x-content-card .xce-check,
          #x-content-card .xce-bk-icon,
          #x-content-card .xce-bk-chip,
          #x-content-card .xce-bk-folder,
          #x-content-card .xce-pop-item { min-height: 44px; }
          #x-content-card .xce-bk-icon { min-width: 44px; }
          #x-content-card .xce-more-summary { min-height: 40px; }
        }
        /* Two-step destructive confirm */
        #x-content-card .xce-confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.3); background: rgba(159,31,23,0.05); }
        #x-content-card .xce-confirm-prompt { font-size: 12px; font-weight: 700; color: #9f1f17; }
        /* Loading skeletons: hold the layout so nothing jumps on arrival. */
        #x-content-card .xce-skeleton { display: grid; gap: 8px; }
        #x-content-card .xce-skeleton-item { display: block; height: 64px; border-radius: 12px; background: linear-gradient(90deg, rgba(31,29,27,0.05) 25%, rgba(31,29,27,0.10) 50%, rgba(31,29,27,0.05) 75%); background-size: 200% 100%; animation: xce-shimmer 1.2s ease-in-out infinite; }
        #x-content-card .xce-skeleton-card { grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); }
        #x-content-card .xce-skeleton-card .xce-skeleton-item { height: auto; aspect-ratio: 1 / 1.2; }
        #x-content-card .xce-skeleton-tile .xce-skeleton-item { height: 52px; }
        @keyframes xce-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { #x-content-card .xce-skeleton-item { animation: none; } #x-content-card .xce-spin { animation: none; } }
        /* Error + Retry */
        #x-content-card .xce-retry { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.24); background: rgba(159,31,23,0.05); }
        #x-content-card .xce-retry-text { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; line-height: 1.4; color: #9f1f17; overflow-wrap: anywhere; }
        /* Toast: floats at the bottom so it never moves the layout. */
        #x-content-card .xce-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 80; max-width: min(92vw, 420px); padding: 10px 14px; border-radius: 12px; font-size: 12.5px; font-weight: 700; line-height: 1.4; color: #fff; box-shadow: 0 10px 28px rgba(0,0,0,0.2); pointer-events: none; }
        #x-content-card .xce-toast-ok { background: #1f6b44; }
        #x-content-card .xce-toast-error { background: #9f1f17; }
        /* NAS setup checklist */
        #x-content-card .xce-checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        #x-content-card .xce-checklist-item { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.4; color: rgba(31,29,27,0.75); }
        #x-content-card .xce-checklist-item.is-ok { color: #1f6b44; }
        #x-content-card .xce-checklist-item.is-todo { color: #8a5a15; }
        /* Collapsed detail disclosure shared by every tab. */
        #x-content-card .xce-more { border-radius: 10px; }
        #x-content-card .xce-more-summary { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 2px; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.5); cursor: pointer; list-style: none; }
        #x-content-card .xce-more-summary::-webkit-details-marker { display: none; }
        #x-content-card .xce-more-summary::before { content: '+'; display: inline-block; width: 10px; text-align: center; }
        #x-content-card .xce-more[open] > .xce-more-summary::before { content: '−'; }
        #x-content-card .xce-more-summary:hover { color: #1f1d1b; }
        #x-content-card .xce-more-body { display: grid; gap: 6px; padding: 4px 0 2px; min-width: 0; }
        #x-content-card .xce-week-hint { margin: 0; font-size: 11px; color: rgba(31,29,27,0.5); }
        /* ---- NAS copy/move panel (NasCopyMovePanel.jsx) ---- */
        #x-content-card .xce-nasops-panel { display: grid; gap: 8px; min-width: 0; padding: 8px 0; }
        /* Layout fixes: the Copy/Move bar must stay visible while you browse and tick items. */
        #x-content-card .xce-nasops-panel { position: sticky; bottom: 0; z-index: 6; background: #fbfaf8; border-top: 1px solid rgba(31,29,27,0.12); padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -8px 16px -12px rgba(0,0,0,0.18); }
        #x-content-card .xce-bk-drawer-head .xce-bk-icon { width: 38px; min-width: 38px; flex: 0 0 auto; }
        #x-content-card .xce-nas-list { height: auto; min-height: 220px; max-height: min(52vh, 520px); }
        @media (min-width: 481px) {
          /* NAS source drawer: full width of the card, covering the bucket rail. */
          #x-content-card .xce-bk-drawer:has(.xce-nas-panel) { max-width: 100%; width: 100%; box-shadow: none; padding-left: 16px; padding-right: 16px; }
        }
        #x-content-card .xce-nasops-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-nasops-count { font-size: 12px; font-weight: 600; color: #1f1d1b; margin-right: auto; }
        #x-content-card .xce-nasops-picker,
        #x-content-card .xce-nasops-preview,
        #x-content-card .xce-nasops-job { display: grid; gap: 8px; min-width: 0; padding: 10px; border: 1px solid rgba(31,29,27,0.12); border-radius: 8px; }
        #x-content-card .xce-nasops-line { margin: 0; font-size: 12px; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-nasops-buttons { display: flex; flex-direction: column; gap: 8px; }
        #x-content-card .xce-nasops-dest-list { max-height: 200px; overflow-y: auto; }
        @media (min-width: 481px) {
          #x-content-card .xce-nasops-buttons { flex-direction: row; flex-wrap: wrap; align-items: center; }
        }

        /* ---- Daily suggestions (DailySuggestionsPanel.jsx) ---- */
        #x-content-card .xce-tabs { flex-wrap: wrap; }
        #x-content-card .xce-dl-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-dl-model { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); }
        #x-content-card .xce-sub code, #x-content-card .xce-dl-gaps code { font-size: 10.5px; overflow-wrap: anywhere; }
        #x-content-card .xce-dl-inputs { display: grid; gap: 4px; margin: 10px 0; }
        #x-content-card .xce-dl-input { display: grid; grid-template-columns: 1fr; gap: 2px; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(31,29,27,0.08); font-family: var(--font-mono); font-size: 11px; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-dl-input > span:first-child { font-weight: 700; }
        #x-content-card .xce-dl-input-missing, #x-content-card .xce-dl-input-excluded, #x-content-card .xce-dl-input-draft { background: rgba(196,128,20,0.08); border-color: rgba(196,128,20,0.3); }
        #x-content-card .xce-dl-list { display: grid; gap: 12px; }
        #x-content-card .xce-dl-card { display: grid; gap: 10px; min-width: 0; padding: 12px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: rgba(255,255,255,0.8); }
        #x-content-card .xce-dl-blocked { border-color: rgba(159,31,23,0.35); }
        #x-content-card .xce-dl-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-dl-type { padding: 2px 8px; border-radius: 999px; background: #1f1d1b; color: #fff; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        #x-content-card .xce-dl-tier { padding: 2px 8px; border-radius: 999px; background: rgba(196,128,20,0.12); color: #7a4e08; font-size: 10.5px; font-weight: 700; }
        #x-content-card .xce-dl-slot { margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }
        #x-content-card .xce-dl-convo { display: grid; gap: 6px; }
        #x-content-card .xce-dl-post { display: grid; gap: 2px; padding: 8px; border-radius: 8px; background: rgba(31,29,27,0.04); color: #1f1d1b; text-decoration: none; min-width: 0; }
        #x-content-card .xce-dl-post-meta { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-dl-post-text { font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }
        #x-content-card .xce-dl-why { display: grid; grid-template-columns: 1fr; gap: 2px 10px; margin: 0; font-size: 12px; line-height: 1.4; }
        #x-content-card .xce-dl-why dt { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.5); margin-top: 4px; }
        #x-content-card .xce-dl-why dd { margin: 0; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-dl-content { font-size: 12px; color: #1f1d1b; overflow-wrap: anywhere; }
        #x-content-card .xce-dl-content ul { margin: 4px 0 0; padding-left: 16px; }
        #x-content-card .xce-dl-content em { color: rgba(31,29,27,0.5); font-style: normal; }
        #x-content-card .xce-dl-draft-label { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.55); }
        #x-content-card .xce-dl-draft-label span { font-weight: 400; text-transform: none; letter-spacing: 0; }
        #x-content-card .xce-dl-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(31,29,27,0.18); font-size: 14px; line-height: 1.4; resize: vertical; }
        #x-content-card .xce-dl-checks { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.6); }
        #x-content-card .xce-dl-ok { color: #1f6b3a; font-weight: 700; }
        #x-content-card .xce-dl-bad { color: #9f1f17; font-weight: 700; }
        #x-content-card .xce-dl-muted { color: rgba(31,29,27,0.5); font-size: 12px; }
        #x-content-card .xce-dl-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        #x-content-card .xce-dl-actions .xce-btn-primary, #x-content-card .xce-dl-actions .xce-btn-ghost { flex: 1 1 auto; }
        #x-content-card .xce-dl-gaps { margin-top: 12px; display: grid; gap: 6px; }
        #x-content-card .xce-dl-gaps ul { margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.45; color: #1f1d1b; overflow-wrap: anywhere; }
        @media (min-width: 481px) {
          #x-content-card .xce-dl-input { grid-template-columns: 170px 150px 1fr; }
          #x-content-card .xce-dl-why { grid-template-columns: 110px 1fr; }
          #x-content-card .xce-dl-why dt { margin-top: 0; }
          #x-content-card .xce-dl-actions .xce-btn-primary, #x-content-card .xce-dl-actions .xce-btn-ghost { flex: 0 0 auto; }
        }

        /* ── Shell (U2): header, tab row + More, phone bottom nav ─────── */
        #x-content-card .xce-header { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #x-content-card .xce-mobile-only,
        #x-content-card .xce-bottom-shell { display: none; }
        #x-content-card .xce-more-shell { position: relative; flex: 0 0 auto; display: inline-flex; }
        #x-content-card .xce-more-trigger { flex: 0 0 auto; }
        #x-content-card .xce-more-menu { display: none; position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 160px; padding: 6px; gap: 2px; flex-direction: column; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fff; box-shadow: 0 8px 24px rgba(31,29,27,0.12); }
        #x-content-card .xce-more-menu.is-open { display: flex; }
        #x-content-card .xce-more-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.7); cursor: pointer; text-align: left; }
        #x-content-card .xce-more-item:hover { background: rgba(31,29,27,0.05); }
        #x-content-card .xce-more-item-active { background: #1f1d1b; color: #fff; }
        #x-content-card .xce-more-item-active:hover { background: #1f1d1b; }
        @media (max-width: 480px) {
          #x-content-card .xce-tabs { display: none; }
          #x-content-card .xce-header { padding-bottom: 8px; }
          #x-content-card .xce-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #22c7e8 0%, #8a5cf0 55%, #e23fb8 100%); }
          #x-content-card .xce-client { font-size: 12px; font-weight: 700; color: #1f1d1b; }
          #x-content-card .xce-mobile-only { display: block; }
          #x-content-card .xce-bottom-shell { display: block; position: sticky; bottom: 0; z-index: 10; margin: 0 calc(-1 * var(--mobile-gutter, 8px)); background: #fff; border-top: 1px solid rgba(31,29,27,0.1); }
          /* Sticky needs the modal's scrollport to be the nearest scroll container: neutralise the two intermediate overflow clips (clip still clips, but is not a scroll container). */
          #x-content-modal-panel:has(#x-content-card) { overflow: clip; }
          .tile-detail-tab-content:has(#x-content-card) { overflow: visible; }
          #x-content-card .xce-more-sheet { display: none; position: absolute; left: 8px; right: 8px; bottom: calc(100% + 8px); flex-direction: column; gap: 2px; padding: 6px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fff; box-shadow: 0 8px 24px rgba(31,29,27,0.14); }
          #x-content-card .xce-more-sheet.is-open { display: flex; }
        }
        @media (min-width: 481px) {
          #x-content-card .xce-more-sheet { display: none !important; }
        }
        /* ---- Timeline tab (TimelinePanel.jsx) + ItemDrawer posted copy ---- */
        #x-content-card .xce-timeline-search { display: grid; grid-template-columns: 1fr; gap: 8px; min-width: 0; }
        #x-content-card .xce-timeline-section { display: grid; gap: 8px; min-width: 0; margin-top: 10px; }
        #x-content-card .xce-timeline-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-timeline-window { font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.5); }
        #x-content-card .xce-timeline-days,
        #x-content-card .xce-timeline-entries,
        #x-content-card .xce-timeline-archives { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; min-width: 0; }
        #x-content-card .xce-timeline-day-button { display: grid; gap: 4px; width: 100%; min-width: 0; padding: 10px; text-align: left; border: 1px solid rgba(42,36,32,0.12); border-radius: 10px; background: rgba(255,255,255,0.6); color: #2a2420; cursor: pointer; }
        #x-content-card .xce-timeline-day-button:hover { border-color: rgba(42,36,32,0.35); }
        #x-content-card .xce-timeline-day-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        #x-content-card .xce-timeline-day-date { font-family: var(--font-mono); font-size: 12px; font-weight: 700; }
        #x-content-card .xce-timeline-day-total { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #2a2420; color: #fff; }
        #x-content-card .xce-timeline-day-platforms { display: inline-flex; gap: 8px; margin-left: auto; }
        #x-content-card .xce-timeline-day-kinds { font-size: 11px; color: rgba(42,36,32,0.55); }
        #x-content-card .xce-timeline-snippet { font-size: 12px; line-height: 1.35; color: rgba(42,36,32,0.8); overflow-wrap: anywhere; }
        #x-content-card .xce-timeline-pdot { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; }
        #x-content-card .xce-timeline-pdot-mark { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        #x-content-card .xce-timeline-day-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        #x-content-card .xce-timeline-entry { display: grid; gap: 4px; min-width: 0; padding: 8px 10px; border: 1px solid rgba(42,36,32,0.12); border-radius: 10px; background: #fff; }
        #x-content-card .xce-timeline-entry-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; color: rgba(42,36,32,0.6); }
        #x-content-card .xce-timeline-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 18px; padding: 0 5px; border-radius: 5px; font-size: 10px; font-weight: 700; color: #fff; }
        #x-content-card .xce-timeline-kind { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
        #x-content-card .xce-timeline-text { margin: 0; font-size: 12.5px; line-height: 1.4; color: #2a2420; overflow-wrap: anywhere; }
        #x-content-card .xce-timeline-thumbs { display: flex; gap: 6px; }
        #x-content-card .xce-timeline-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; background: rgba(42,36,32,0.06); }
        #x-content-card .xce-timeline-archive { display: grid; gap: 2px; font-size: 12px; }
        #x-content-card .xce-timeline-archive-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
        #x-content-card .xce-timeline-archive-line { color: rgba(42,36,32,0.6); }
        #x-content-card .xce-timeline-posted-copy { display: grid; gap: 6px; min-width: 0; padding: 10px; border: 1px solid rgba(42,36,32,0.12); border-radius: 10px; background: rgba(255,255,255,0.6); }
        #x-content-card .xce-timeline-posted-text { margin: 0; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
        @media (min-width: 481px) {
          #x-content-card .xce-timeline-search { grid-template-columns: 150px 1fr 150px auto; align-items: center; }
        }
      `}</style>
    </div>
  );
}
