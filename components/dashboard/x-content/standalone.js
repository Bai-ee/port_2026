'use client';

// Standalone-mount helpers for the x-content panels. Each panel keeps its Content Center props; when those are
// absent (a new host passing only { clientId, call, onNavigate }) the panel's wrapper uses these hooks to load its
// own data through the same quote-targets / social-posting actions the card uses. Nothing here spends money.

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '../../../firebase';
import { fallbackDraft, validateDraft } from '../../../features/x-content-inventory/draft.js';

export async function standaloneCallSocial(body) {
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : null;
  const res = await fetch('/api/social-posting', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `${body.action} failed.`), { code: data?.code || null });
  return data;
}

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
}
function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

// Props for PlanPanel (today's plan + local draft preview).
export function usePlanProps(call, clientId, onNavigate) {
  const [posts, setPosts] = useState(5);
  const [plan, setPlan] = useState(null);
  const [planMeta, setPlanMeta] = useState({ source: 'default', version: null });
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draftingId, setDraftingId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const load = useCallback(async (nextPosts = posts) => {
    setLoading(true);
    setError('');
    try {
      const [planRes, invRes] = await Promise.all([call('content-plan', { posts: nextPosts }), call('inventory-list')]);
      setPlan(planRes?.plan || null);
      setPlanMeta({ source: planRes?.planSource || 'default', version: planRes?.planVersion ?? null });
      setPackages(Array.isArray(invRes?.packages) ? invRes.packages : []);
    } catch (err) {
      setError(err.message || 'Could not load the content engine.');
    } finally {
      setLoading(false);
    }
  }, [call, posts]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);
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
  return {
    plan, loading, error, posts,
    onPostsChange: (next) => { setPosts(next); load(next); },
    planSource: planMeta.source,
    planVersion: planMeta.version,
    onOpenStrategy: () => onNavigate?.('strategy'),
    onOpenContent: () => onNavigate?.('inventory'),
    onRefresh: () => load(),
    onDraft, draftingId, drafts,
  };
}

// Handlers PostSheet/MonthCalendarPanel expect, backed by social-posting. `onDone` runs after each successful write.
export function useCalendarActions(callSocial, onDone) {
  const [busyId, setBusyId] = useState(null);
  const run = useCallback(async (post, body) => {
    setBusyId(post.id);
    try {
      await callSocial({ postId: post.id, ...body });
      if (onDone) await onDone();
      return true;
    } catch (err) {
      const code = err.code || '';
      if (code === 'revision-conflict' || code.startsWith('plan-')) return { ok: false, errorClass: code, error: err.message };
      return { ok: false, errorClass: code || 'error', error: err.message || 'Could not update the post.' };
    } finally {
      setBusyId(null);
    }
  }, [callSocial, onDone]);
  return {
    busyId,
    onApprove: (post, { content, scheduledAt, expectedRevision, planOverride }) => (
      scheduledAt
        ? run(post, { action: 'approve-and-schedule', content, scheduledAt, expectedRevision, ...(planOverride ? { planOverride } : {}) })
        : Promise.resolve({ ok: false, errorClass: 'error', error: 'Set a publish time first.' })
    ),
    onReject: (post, opts = {}) => run(post, { action: 'reject-draft', expectedRevision: opts.expectedRevision }),
    onSave: (post, { content, scheduledAt, expectedRevision }) => run(post, { action: 'update', content, expectedRevision, ...(scheduledAt ? { scheduledAt } : {}) }),
    onUnschedule: (post, opts = {}) => run(post, { action: 'update', content: post.content, scheduledAt: '', expectedRevision: opts.expectedRevision }),
    onReconcile: (post, { outcome, platformId }) => run(post, { action: 'reconcile-post', outcome, platformId }),
    onScore: async (content) => (await callSocial({ action: 'score', content }))?.score || null,
  };
}

// Props for MonthCalendarPanel.
export function useCalendarProps(call, clientId) {
  const [month, setMonth] = useState(() => todayCT().slice(0, 7));
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const monthRef = useRef(month);
  monthRef.current = month;
  const load = useCallback(async (m = monthRef.current) => {
    setLoading(true);
    setError('');
    try { setCalendar((await call('month-calendar', { month: m }))?.calendar || null); } catch (err) { setError(err.message || 'Could not load the calendar.'); } finally { setLoading(false); }
  }, [call]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);
  const actions = useCalendarActions(standaloneCallSocial, () => load());
  const [taskBusyId, setTaskBusyId] = useState(null);
  // "Film this" task done/open toggle (content-task-update). Reloads the month on success; a failure shows as the panel error.
  const onTaskToggle = useCallback(async (task, status) => {
    setTaskBusyId(task.id);
    try { await call('content-task-update', { taskId: task.id, status }); await load(); } catch (err) { setError(err.message || 'Could not update the task.'); } finally { setTaskBusyId(null); }
  }, [call, load]);
  return {
    calendar, loading, error, busyId: actions.busyId || taskBusyId, call,
    onRefresh: () => load(),
    onShiftMonth: (d) => { const next = shiftMonth(monthRef.current, d); setMonth(next); load(next); },
    onToday: () => { const now = todayCT().slice(0, 7); setMonth(now); load(now); },
    onApprove: actions.onApprove, onReject: actions.onReject, onSave: actions.onSave,
    onUnschedule: actions.onUnschedule, onReconcile: actions.onReconcile, onScore: actions.onScore, onTaskToggle,
  };
}

// Props for PerformancePanel.
export function usePerformanceProps(call, clientId) {
  const [perf, setPerf] = useState(null);
  const [postResults, setPostResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [stats, results] = await Promise.all([call('engine-performance', { windowDays: 30 }), call('post-results').catch(() => null)]);
      setPerf(stats);
      setPostResults(results?.results || null);
    } catch (err) {
      setError(err.message || 'Could not load performance.');
    } finally {
      setLoading(false);
    }
  }, [call]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);
  return { postResults, stats: perf?.stats, lastCapturedAt: perf?.lastCapturedAt, loading, error, onRefresh: load };
}
