'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ArrowUpRight, BarChart3, ChevronDown, Database, FileText, MessagesSquare, Pencil, Plus, Quote, RefreshCw, RotateCcw, Sparkles, Trash2,
} from 'lucide-react';
import { DEFAULT_PLAN, PLAN_LIMITS } from '../../../features/x-strategy/index.js';
import {
  PLANNABLE_SLOT_TYPES, freshnessLabel, rowCountOf, indexRowsMeta, cleanHandle, refreshStatusView, refreshIsActive,
  tierComparison, tierText, groupCaveats, comparisonRows, handlesDraftFromProfile, normalizeHandlesDraft, handlesDirty,
  validateHandlesDraft, planDraftFromPlan, planChangesFromDraft, draftTier, historyNewestFirst, historyDiffSummary,
  todayPlanLine, planErrorView, workerHealthLine, trackDraftFromPlan, trackChangesFromDraft, tracksSavedText, trackInsightsView,
} from '../../../features/x-strategy/ui-model.js';
import ContentTracksPanel from './ContentTracksPanel.jsx';
import StrategyDocPanel from './StrategyDocPanel.jsx';
import { profileBenchmarksFromPlan } from '../../../features/x-strategy/track-profile.js';
import StrategyChat, { formatDayTime } from './StrategyChat.jsx';
import { XCE_COLORS, XCE_RADII } from '../content-ui/xce-tokens';
import Accordion from '../content-ui/ui/Accordion';
import Badge from '../content-ui/ui/Badge';
import Card from '../content-ui/ui/Card';
import IconButton from '../content-ui/ui/IconButton';
import SectionLabel from '../content-ui/ui/SectionLabel';
import SegmentedControl from '../content-ui/ui/SegmentedControl';
import WarnRow from '../content-ui/ui/WarnRow';

// StrategyPanel - the Strategy tab of the Content Engine card.
//
// Layout: header chips (client . @handle . Plan vN), then [chat | Details].
//   >=900px  two columns (chat left, Details right)
//   481-899  one column, Details below the chat
//   <=480    a Chat | Details toggle shows one pane at a time (both stay mounted, so the chat keeps its state)
// Details has five sub-tabs: Strategy (the owner's Strategy document, StrategyDocPanel.jsx) . Plan . Accounts .
// Insights . History. All of it is the SAME data and handlers as
// before (strategy-get / strategy-plan-apply / strategy-plan-revert / strategy-refresh / strategy-profile-save /
// strategy-evaluate-handle); this file only arranges them. The "Ask in chat" buttons switch to the chat and
// FILL its composer; they never send.
//
// Styles: inline `style` props plus the card's shared `xce-*` classes. The small <style> below only holds layout
// media queries, every selector prefixed `#x-strategy-root`.
//
// Data: one `strategy-get` per load. Every call goes through `call(action, body)` (the card's quote-targets
// POST helper); each body carries clientId. Failures are shown as text, never thrown.
//
// StrategyChat contract (components/dashboard/x-content/StrategyChat.jsx):
//   <StrategyChat clientId call currentPlan planVersion history prefill onPlanChanged onRefreshed
//                 onViewPlan onViewChange onUndo undoNote />

const POLL_MS = 4000;
const errText = (err, fallback) => String(err?.message || fallback || 'Request failed.');

const S = {
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 },
  note: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: XCE_COLORS.inkSoft },
  warn: { margin: '8px 0', padding: '8px 10px', borderRadius: 10, background: XCE_COLORS.amberBg, border: `1px solid ${XCE_COLORS.amberBorder}`, fontSize: 12, lineHeight: 1.45, color: XCE_COLORS.amber },
  err: { margin: '8px 0', fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.red },
  ok: { margin: '8px 0', fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.green },
  scroll: { overflowX: 'auto', minWidth: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '4px 8px 4px 0', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: XCE_COLORS.inkMuted, whiteSpace: 'nowrap' },
  td: { padding: '5px 8px 5px 0', borderTop: `1px solid ${XCE_COLORS.border}`, verticalAlign: 'top' },
  list: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: XCE_COLORS.inkMuted },
  handleInput: { flex: '1 1 140px', minWidth: 0 },
  caveatBox: { margin: '8px 0', padding: '8px 10px', borderRadius: 10, background: XCE_COLORS.amberBg, border: `1px solid ${XCE_COLORS.amberBorder}` },
  muted: { fontSize: 12.5, color: XCE_COLORS.inkSoft, lineHeight: 1.4 },
  statRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${XCE_COLORS.border}`, borderRadius: XCE_RADII.md + 2, background: XCE_COLORS.surface, minWidth: 0 },
  statIcon: { flex: '0 0 auto', color: XCE_COLORS.inkSoft, display: 'inline-flex' },
  fullBtn: { width: '100%', minHeight: 44 },
};

const LAYOUT_CSS = `
  #x-strategy-root { min-width: 0; }
  #x-strategy-header-chips-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  #x-strategy-actions-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  #x-strategy-actions-row .xce-btn { min-height: 40px; display: inline-flex; align-items: center; gap: 6px; }
  #x-strategy-layout { display: grid; gap: 12px; min-width: 0; }
  #x-strategy-chat-column, #x-strategy-details-column { display: grid; gap: 12px; min-width: 0; align-content: start; }
  #x-strategy-details-panel { display: grid; gap: 12px; min-width: 0; align-content: start; }
  #x-strategy-root input[type=number] { max-width: 90px; -moz-appearance: textfield; appearance: textfield; }
  #x-strategy-root input[type=number]::-webkit-outer-spin-button,
  #x-strategy-root input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  @media (min-width: 900px) { #x-strategy-layout { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); align-items: start; } }
  @media (max-width: 480px) {
    #x-strategy-layout[data-view="chat"] #x-strategy-details-column { display: none; }
    #x-strategy-layout[data-view="details"] #x-strategy-chat-column { display: none; }
  }
`;

const DETAIL_TABS = [
  { value: 'strategy', label: 'Strategy' },
  { value: 'plan', label: 'Plan' },
  { value: 'accounts', label: 'Accounts' },
  { value: 'insights', label: 'Insights' },
  { value: 'history', label: 'History' },
];

const ASK_PROMPTS = {
  accounts: 'Review my tracked accounts and benchmarks.',
  insights: 'Walk me through these insights.',
  history: 'Walk me through my recent plan changes.',
};

function Msg({ id, kind, children }) {
  if (!children || (Array.isArray(children) && !children.length)) return null;
  return <div id={id} role={kind === 'err' ? 'alert' : 'status'} style={S[kind]}>{children}</div>;
}

// Queued time + Re-check for a parked queued request; retry time + Retry for a rate-limited one.
function RefreshFollowUp({ idPrefix, view, onRecheck, onRetry }) {
  if (!view?.queuedAt && !view?.parked && !view?.retryHandles?.length) return null;
  return (
    <div id={`${idPrefix}-follow-up-row`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 }}>
      {view.queuedAt ? <span id={`${idPrefix}-queued-at`}>Queued at {view.queuedAt}.</span> : null}
      {view.parked ? <button type="button" id={`${idPrefix}-recheck-button`} className="xce-btn xce-btn-ghost" style={{ minHeight: 36 }} onClick={onRecheck}>Re-check</button> : null}
      {view.retryHandles?.length ? (
        <>
          {view.retryAt ? <span id={`${idPrefix}-retry-at`}>Retry after ~{view.retryAt}.</span> : null}
          <button type="button" id={`${idPrefix}-retry-button`} className="xce-btn xce-btn-ghost" style={{ minHeight: 36 }} onClick={() => onRetry(view.retryHandles)}>
            Retry {view.retryHandles.map((h) => `@${h}`).join(', ')}
          </button>
        </>
      ) : null}
    </div>
  );
}

// Initials circle (no avatar URL is stored anywhere).
function Avatar({ id, handle, size = 36 }) {
  const initials = String(handle || '?').replace(/^@+/, '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  return (
    <span
      id={id}
      aria-hidden="true"
      style={{
        flex: '0 0 auto', width: size, height: size, borderRadius: XCE_RADII.pill, background: XCE_COLORS.greyBg, border: `1px solid ${XCE_COLORS.border}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: size * 0.34, fontWeight: 700, color: XCE_COLORS.inkSoft,
      }}
    >
      {initials}
    </span>
  );
}

// "- value +" over a REAL number input (keeps the input id + onChange contract). Values stay strings.
function NumField({ id, label, value, onChange, min, max, disabled }) {
  const raw = String(value ?? '').trim();
  const n = Number(raw);
  const cur = raw === '' || !Number.isFinite(n) ? null : n;
  const bump = (d) => onChange(String(Math.min(max, Math.max(min, (cur ?? min) + d))));
  return (
    <div id={`${id}-row`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 0', borderTop: `1px solid ${XCE_COLORS.border}`, flexWrap: 'wrap' }}>
      <label htmlFor={id} style={{ ...S.label, fontSize: 11, letterSpacing: '0.08em', color: XCE_COLORS.inkSoft }}>{label}</label>
      <div id={`${id}-stepper`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <IconButton label={`Decrease ${label}`} icon={<span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>{'−'}</span>} size={36} disabled={disabled || (cur !== null && cur <= min)} onClick={() => bump(-1)} />
        <input
          id={id}
          className="xce-input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          style={{ width: 64, minHeight: 36, height: 36, padding: '0 6px', textAlign: 'center', fontSize: 16 }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <IconButton label={`Increase ${label}`} icon={<Plus size={16} />} size={36} disabled={disabled || (cur !== null && cur >= max)} onClick={() => bump(1)} />
      </div>
    </div>
  );
}

// ---- evaluation pieces (shared by the Details tabs and the ad hoc compare) -------------------------------------
function evaluationFresh(evaluation, r) {
  const e = r.role === 'own' ? evaluation.own : (evaluation.benchmarks || []).find((b) => b.handle === r.handle);
  if (!e) return '—';
  if (e.pulledAt === null || e.ageDays === null || e.ageDays === undefined) return 'committed data';
  return e.stale ? `stale ${Math.floor(e.ageDays)}d` : `fresh ${Math.floor(e.ageDays)}d`;
}

function EvaluationTable({ evaluation, idPrefix }) {
  const rows = comparisonRows(evaluation);
  return (
    <div id={`${idPrefix}-table-scroll`} style={S.scroll}>
      <table id={`${idPrefix}-table`} style={S.table}>
        <thead><tr>
          <th style={S.th}>Account</th><th style={S.th}>Rows</th><th style={S.th}>Window</th>
          <th style={S.th}>Authored/day</th><th style={S.th}>Mix</th><th style={S.th}>Data</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.role}-${r.handle}`} id={`${idPrefix}-row-${r.handle}`}>
              <td style={S.td}><b>@{r.handle}</b> <span style={S.label}>{r.role === 'own' ? 'you' : 'benchmark'}</span></td>
              <td style={S.td}>{r.rows}</td>
              <td style={S.td}>{r.window}</td>
              <td style={S.td}>{r.perDay === null ? '—' : r.perDay}</td>
              <td style={S.td}>{r.types}</td>
              <td style={S.td}>{r.rows === 0 ? 'needs refresh' : evaluationFresh(evaluation, r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvaluationCaveats({ evaluation, idPrefix }) {
  const groups = groupCaveats(evaluation.caveats);
  if (!groups.length) return null;
  return (
    <div id={`${idPrefix}-caveats`} style={S.caveatBox}>
      <div style={{ ...S.label, color: XCE_COLORS.amber }}>Read with caution</div>
      {groups.map((g) => (
        <div key={g.handle || 'general'} id={`${idPrefix}-caveats-${g.handle || 'general'}`} style={{ marginTop: 6 }}>
          <b style={{ fontSize: 12 }}>{g.handle ? `@${g.handle}` : 'General'}</b>
          <ul style={S.list}>
            {g.items.map((c, i) => (
              <li key={`${c.code}-${i}`}><span className="xce-chip xce-chip-warn">{c.code}</span> {c.message || c.title}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EvaluationGaps({ evaluation, idPrefix }) {
  if (!evaluation.gapsAgainst) return <p id={`${idPrefix}-gaps-empty`} style={S.note}>No benchmark has data yet, so there are no gaps to show.</p>;
  return (
    <div id={`${idPrefix}-gaps`} style={{ marginTop: 8 }}>
      <div style={S.label}>Top gaps vs @{evaluation.gapsAgainst}</div>
      {evaluation.gaps?.length ? (
        <ol id={`${idPrefix}-gaps-list`} style={S.list}>
          {evaluation.gaps.map((g) => <li key={g.id}>{g.headline || g.id}</li>)}
        </ol>
      ) : <p style={S.note}>No meaningful gaps found.</p>}
    </div>
  );
}

// Full evaluation block (table + caveats + gaps): used by the ad hoc "compare another account" result.
function EvaluationView({ evaluation, idPrefix }) {
  return (
    <div id={`${idPrefix}-content`}>
      <EvaluationTable evaluation={evaluation} idPrefix={idPrefix} />
      <EvaluationCaveats evaluation={evaluation} idPrefix={idPrefix} />
      <EvaluationGaps evaluation={evaluation} idPrefix={idPrefix} />
    </div>
  );
}

// Per-track Insights: each track vs its own benchmarks (evaluation.byTrack). Separate from the overall pace section.
function TrackInsights({ evaluation, onEditTracks }) {
  const tracks = trackInsightsView(evaluation);
  if (!tracks.length) return null;
  return (
    <section id="x-strategy-track-insights-panel" data-section="track-insights" style={S.stack}>
      <div style={{ ...S.label, fontSize: 11, letterSpacing: '0.08em', color: XCE_COLORS.inkSoft }}>By content track</div>
      {tracks.map((t) => (
        <Card key={t.trackId} id={`x-strategy-track-insights-${t.trackId}-card`} data-state={t.state} padding={14}>
          <div id={`x-strategy-track-insights-${t.trackId}-header`} style={{ ...S.row, justifyContent: 'space-between' }}>
            <b style={{ fontSize: 15 }}>{t.label}</b>
            {t.sharePct !== null ? <Badge tone="grey">{t.sharePct}% of authored</Badge> : null}
          </div>
          <p id={`x-strategy-track-insights-${t.trackId}-headline`} style={{ margin: '6px 0 0', fontSize: 15, fontWeight: 600, color: t.state === 'ok' ? XCE_COLORS.ink : XCE_COLORS.amber }}>{t.headline}</p>
          {t.gapsAgainst ? <p style={{ ...S.muted, margin: '2px 0 0' }}>Compared with @{t.gapsAgainst}.</p> : null}
          {t.benchmarks.length ? (
            <ul id={`x-strategy-track-insights-${t.trackId}-benchmarks`} style={S.list}>
              {t.benchmarks.map((b) => (
                <li key={b.handle}>@{b.handle}: {b.rows ? `${b.rows} posts${b.perDay !== null ? ` · ${b.perDay}/day` : ''} · ${b.types}` : 'no posts yet — needs refresh'}</li>
              ))}
            </ul>
          ) : (
            <button type="button" id={`x-strategy-track-insights-${t.trackId}-add-benchmark-button`} className="xce-btn xce-btn-ghost" style={{ marginTop: 6, minHeight: 36 }} onClick={onEditTracks}>Add a benchmark</button>
          )}
          {t.gaps.length > 1 ? (
            <ol id={`x-strategy-track-insights-${t.trackId}-gaps`} style={S.list}>{t.gaps.slice(1).map((g) => <li key={g}>{g}</li>)}</ol>
          ) : null}
          {t.state !== 'no-benchmark' ? <p style={{ ...S.note, margin: '6px 0 0' }}>{t.ownNote}</p> : null}
        </Card>
      ))}
    </section>
  );
}

const showVal = (v) => {
  if (v === null || v === undefined) return 'none';
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  return typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v);
};

const StrategyPanel = forwardRef(function StrategyPanel({ clientId, call, onPlanChanged, clientName, selected, hideRefresh = false }, ref) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // accounts
  const [handles, setHandles] = useState({ own: '', benchmarks: [] });
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState({ kind: '', text: '' });
  // refresh
  const [refresh, setRefresh] = useState({ requestId: '', request: null, polls: 0, tick: 0, error: '', starting: false });
  // ad hoc evaluate
  const [adhocHandle, setAdhocHandle] = useState('');
  const [adhoc, setAdhoc] = useState({ busy: false, error: '', result: null });
  // plan
  const [planDraft, setPlanDraft] = useState(planDraftFromPlan(DEFAULT_PLAN));
  const [reason, setReason] = useState('');
  const [tracksDraft, setTracksDraft] = useState(trackDraftFromPlan(DEFAULT_PLAN));
  const [tracksMsg, setTracksMsg] = useState({ kind: '', text: '' });
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState({ kind: '', text: '', errors: [], conflict: false });

  // presentation state (no data flow): which pane / Details sub-tab is showing, composer prefill, history UI
  const [view, setView] = useState('chat');
  const [detailTab, setDetailTab] = useState('strategy');
  // The owner's Strategy document (strategy-doc-get), owned here so the chat timeline can show its changes.
  const [stratDoc, setStratDoc] = useState({ doc: null, meta: [], loading: true, error: '' });
  const [reviewRequest, setReviewRequest] = useState(null); // {nonce}: asks the chat to run a strategy review
  const [prefill, setPrefill] = useState(null);
  const [historyFilter, setHistoryFilter] = useState('all');
  const [expandedVersion, setExpandedVersion] = useState(0);
  const [editOwn, setEditOwn] = useState(false);
  const [undoVersion, setUndoVersion] = useState(0);

  const mounted = useRef(true);
  const loadSeq = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const baseBody = useCallback((extra = {}) => ({ clientId, ...extra }), [clientId]);

  /** @param {{keepDrafts?:boolean}} [opts] keepDrafts: refresh data without wiping unsaved edits. */
  const reload = useCallback(async ({ keepDrafts = false } = {}) => {
    if (!clientId || typeof call !== 'function') { setLoading(false); setLoadError('No client selected.'); return null; }
    const seq = ++loadSeq.current;
    setLoading(true);
    setLoadError('');
    try {
      const res = await call('strategy-get', baseBody());
      if (!mounted.current || seq !== loadSeq.current) return null;
      setData(res);
      if (!keepDrafts) {
        setHandles(handlesDraftFromProfile(res.profile));
        setPlanDraft(planDraftFromPlan(res.plan?.plan ?? DEFAULT_PLAN));
        setTracksDraft(trackDraftFromPlan(res.plan?.plan ?? DEFAULT_PLAN));
        setTracksMsg({ kind: '', text: '' });
        setPlanMsg({ kind: '', text: '', errors: [], conflict: false });
      }
      return res;
    } catch (err) {
      if (mounted.current && seq === loadSeq.current) setLoadError(errText(err, 'Could not load the strategy.'));
      return null;
    } finally {
      if (mounted.current && seq === loadSeq.current) setLoading(false);
    }
  }, [call, clientId, baseBody]);

  const loadDoc = useCallback(async () => {
    if (!clientId || typeof call !== 'function') return;
    setStratDoc((d) => ({ ...d, loading: true, error: '' }));
    try {
      const res = await call('strategy-doc-get', baseBody());
      if (mounted.current) setStratDoc({ doc: res.doc, meta: res.sections || [], loading: false, error: '' });
    } catch (err) {
      if (mounted.current) setStratDoc((d) => ({ ...d, loading: false, error: errText(err, 'Could not load the strategy document.') }));
    }
  }, [call, clientId, baseBody]);

  useImperativeHandle(ref, () => ({ reload }), [reload]);
  useEffect(() => { reload(); loadDoc(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

  // ---- refresh + polling ---------------------------------------------------------------------------------
  const startRefresh = useCallback(async (handleList) => {
    setRefresh({ requestId: '', request: null, polls: 0, tick: 0, error: '', starting: true });
    try {
      const res = await call('strategy-refresh', baseBody(handleList ? { handles: handleList } : {}));
      if (!mounted.current) return;
      setRefresh({ requestId: res.requestId, request: { status: res.status, handles: handleList || [], results: {} }, polls: 0, tick: 0, error: '', starting: false });
    } catch (err) {
      if (mounted.current) setRefresh({ requestId: '', request: null, polls: 0, tick: 0, error: errText(err, 'Could not start the refresh.'), starting: false });
    }
  }, [call, baseBody]);

  const refreshStatus = refresh.request?.status || '';
  // A queued request is polled QUEUED_POLL_LIMIT times, then parked (no spinner) until Re-check.
  const pollActive = !!refresh.request && refreshStatusView(refresh.request, { polls: refresh.polls }).active;
  useEffect(() => {
    if (!refresh.requestId || !pollActive) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await call('strategy-refresh-status', baseBody({ requestId: refresh.requestId }));
        if (cancelled || !mounted.current) return;
        const request = res.request || null;
        setRefresh((s) => ({ ...s, request, polls: request?.status === 'queued' ? s.polls + 1 : 0, tick: s.tick + 1 }));
        if (request && !refreshIsActive(request.status)) reload({ keepDrafts: true });
      } catch (err) {
        if (!cancelled && mounted.current) setRefresh((s) => ({ ...s, error: `${errText(err, 'Lost track of the refresh.')} Reload to see the latest data.`, request: { ...(s.request || {}), status: 'failed' } }));
      }
    }, POLL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // tick changes on every poll, which re-arms the timer
  }, [refresh.requestId, refreshStatus, pollActive, refresh.tick, call, baseBody, reload]);

  const recheckRefresh = useCallback(() => setRefresh((s) => ({ ...s, polls: 0, error: '', tick: s.tick + 1 })), []);

  // ---- handles -----------------------------------------------------------------------------------------------
  const profile = data?.profile || null;
  const dirtyHandles = profile ? handlesDirty(profile, handles) : false;
  const handlesProblem = profile ? validateHandlesDraft(handles) : null;
  const metaByHandle = indexRowsMeta(data?.rowsMeta);

  const setBenchmark = (i, v) => setHandles((h) => ({ ...h, benchmarks: h.benchmarks.map((x, j) => (j === i ? v : x)) }));
  const addBenchmark = () => setHandles((h) => (h.benchmarks.length >= PLAN_LIMITS.maxBenchmarkHandles ? h : { ...h, benchmarks: [...h.benchmarks, ''] }));
  const removeBenchmark = (i) => setHandles((h) => ({ ...h, benchmarks: h.benchmarks.filter((_, j) => j !== i) }));

  const saveHandles = async () => {
    const problem = validateHandlesDraft(handles);
    if (problem) { setSaveMsg({ kind: 'err', text: problem }); return; }
    const n = normalizeHandlesDraft(handles);
    setSaveBusy(true);
    setSaveMsg({ kind: '', text: '' });
    try {
      // Tracks own the benchmark list when they exist; this save only changes your own handle then.
      await call('strategy-profile-save', baseBody({ ownHandle: n.own, benchmarkHandles: trackBenchmarks || n.benchmarks }));
      if (!mounted.current) return;
      setSaveMsg({ kind: 'ok', text: 'Handles saved.' });
      await reload();
    } catch (err) {
      if (mounted.current) setSaveMsg({ kind: 'err', text: errText(err, 'Handles were not saved.') });
    } finally {
      if (mounted.current) setSaveBusy(false);
    }
  };

  // ---- ad hoc evaluate ---------------------------------------------------------------------------------------
  const evaluateAdhoc = async () => {
    const h = cleanHandle(adhocHandle);
    if (!h) { setAdhoc({ busy: false, error: 'Enter an X handle.', result: null }); return; }
    setAdhoc({ busy: true, error: '', result: null });
    try {
      const res = await call('strategy-evaluate-handle', baseBody({ handle: h }));
      if (mounted.current) setAdhoc({ busy: false, error: '', result: res });
    } catch (err) {
      if (mounted.current) setAdhoc({ busy: false, error: errText(err, 'Could not evaluate that handle.'), result: null });
    }
  };

  // ---- plan --------------------------------------------------------------------------------------------------
  const planDoc = data?.plan || null;
  const savedPlan = planDoc?.plan ?? DEFAULT_PLAN;
  const expectedVersion = planDoc?.version ?? 0;
  const planCheck = planChangesFromDraft(savedPlan, planDraft);
  const tierNow = draftTier(planDraft.authoredPerDay);

  const setDraftField = (field, v) => setPlanDraft((d) => ({ ...d, [field]: v }));
  const setDraftMap = (field, type, v) => setPlanDraft((d) => ({ ...d, [field]: { ...d[field], [type]: v } }));

  const afterPlanChange = async () => {
    await reload();
    if (typeof onPlanChanged === 'function') onPlanChanged();
  };

  const handlePlanFailure = (err) => {
    const view = planErrorView({ status: err?.status, code: err?.data?.code, error: errText(err, 'Plan was not saved.'), errors: err?.data?.errors });
    setPlanMsg({ kind: 'err', text: view.message, errors: view.errors, conflict: view.conflict });
  };

  const savePlan = async () => {
    if (planCheck.errors.length) { setPlanMsg({ kind: 'err', text: planCheck.errors[0], errors: planCheck.errors.slice(1), conflict: false }); return; }
    if (!planCheck.dirty) return;
    setPlanBusy(true);
    setPlanMsg({ kind: '', text: '', errors: [], conflict: false });
    try {
      await call('strategy-plan-apply', baseBody({ changes: planCheck.changes, expectedVersion, reason: reason.trim() }));
      if (!mounted.current) return;
      setReason('');
      await afterPlanChange();
      if (mounted.current) setPlanMsg({ kind: 'ok', text: 'Plan saved.', errors: [], conflict: false });
    } catch (err) {
      if (mounted.current) handlePlanFailure(err);
    } finally {
      if (mounted.current) setPlanBusy(false);
    }
  };

  // With explicit tracks the benchmark list is derived (tracks own it); null => the Accounts list stays editable.
  const trackBenchmarks = profileBenchmarksFromPlan(planDoc);

  const tracksCheck = trackChangesFromDraft(savedPlan, tracksDraft);
  const savedTrackHandles = trackDraftFromPlan(savedPlan).flatMap((t) => t.benchmarks);
  const saveTracks = async () => {
    if (!tracksCheck.contentTracks) return;
    setPlanBusy(true);
    setTracksMsg({ kind: '', text: '' });
    try {
      const res = await call('strategy-plan-apply', baseBody({ changes: { contentTracks: tracksCheck.contentTracks }, expectedVersion, reason: reason.trim() }));
      if (!mounted.current) return;
      // Save returns as soon as the plan is written: show the new version now, re-read the rest in the background.
      setData((d) => (d && res?.plan ? { ...d, plan: res.plan } : d));
      if (res?.plan) setTracksDraft(trackDraftFromPlan(res.plan.plan ?? DEFAULT_PLAN));
      setTracksMsg(tracksSavedText(res));
      if (res?.refresh?.requestId) {
        setRefresh({ requestId: res.refresh.requestId, request: { status: 'queued', handles: res.refresh.handles || [], results: {}, createdAt: new Date().toISOString() }, polls: 0, tick: 0, error: '', starting: false });
      }
      reload({ keepDrafts: true }).then(() => { if (mounted.current && typeof onPlanChanged === 'function') onPlanChanged(); });
    } catch (err) {
      if (mounted.current) { const v = planErrorView({ status: err?.status, code: err?.data?.code, error: errText(err, 'Tracks were not saved.'), errors: err?.data?.errors }); setTracksMsg({ kind: 'err', text: [v.message, ...v.errors].join(' ') }); }
    } finally {
      if (mounted.current) setPlanBusy(false);
    }
  };

  const revertPlan = async (version) => {
    setPlanBusy(true);
    setPlanMsg({ kind: '', text: '', errors: [], conflict: false });
    try {
      await call('strategy-plan-revert', baseBody({ version }));
      if (!mounted.current) return;
      await afterPlanChange();
      if (mounted.current) setPlanMsg({ kind: 'ok', text: `Restored the plan as it stood after v${version}.`, errors: [], conflict: false });
    } catch (err) {
      if (mounted.current) handlePlanFailure(err);
    } finally {
      if (mounted.current) setPlanBusy(false);
    }
  };



  // ---- presentation helpers (no data flow) -------------------------------------------------------------------
  const goDetails = (tab, version) => {
    setView('details');
    setDetailTab(tab);
    if (version) setExpandedVersion(version);
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => document.getElementById('x-strategy-details-panel')?.scrollIntoView?.({ block: 'nearest' }));
  };
  const goToTracks = () => {
    goDetails('plan');
    if (typeof window !== 'undefined') window.requestAnimationFrame(() => document.getElementById('x-strategy-content-tracks-panel')?.scrollIntoView?.({ block: 'start' }));
  };
  const askInChat = (text) => {
    setPrefill({ text, nonce: Date.now() });
    setView('chat');
  };
  const undoFromChat = async (version) => {
    setUndoVersion(version);
    await revertPlan(version - 1);
  };

  // ---- render ------------------------------------------------------------------------------------------------
  const refreshView = refresh.request ? refreshStatusView(refresh.request, { polls: refresh.polls }) : null;
  const refreshing = refresh.starting || !!refreshView?.active;
  const evaluation = data?.evaluation || null;
  const history = historyNewestFirst(planDoc);
  const ownKey = profile ? cleanHandle(profile.ownHandle) : '';
  const rowsFor = (h) => rowCountOf(metaByHandle[cleanHandle(h)]);
  const needsRefresh = (h) => /refresh/.test(freshnessLabel(metaByHandle[cleanHandle(h)]));
  const staleBenchmarks = profile ? (profile.benchmarkHandles || []).filter((h) => needsRefresh(h)) : [];
  const planVersion = planDoc?.version || 0;
  const chipHandle = ownKey || cleanHandle(handles.own);

  const quoteReactFloor = planDraft.typeFloors['quote-react'];
  const setQuoteReactFloor = (v) => setDraftMap('typeFloors', 'quote-react', v === '0' && String(quoteReactFloor ?? '') === '' ? '' : v);
  const perDayMax = Number.isFinite(Number(planDraft.authoredPerDay)) && String(planDraft.authoredPerDay).trim() !== '' ? Math.max(0, Number(planDraft.authoredPerDay)) : PLAN_LIMITS.authoredPerDayMax;

  // Insights: lift cards from the own account's byType (lift = x your average), posting frequency vs the compared benchmark.
  const liftEntries = evaluation
    ? Object.entries(evaluation.own?.byType || {}).filter(([, v]) => Number.isFinite(v?.lift)).sort((a, b) => b[1].lift - a[1].lift)
    : [];
  const liftCards = liftEntries.slice(0, 2);
  const weakest = liftEntries.length > 2 ? liftEntries[liftEntries.length - 1] : null;
  if (weakest && weakest[1].lift < 1) liftCards.push(weakest);
  const compared = evaluation ? (evaluation.benchmarks || []).find((b) => b.handle === evaluation.gapsAgainst) : null;
  const ownPerDay = evaluation?.own?.cadence?.authoredPerActiveDay;
  const benchPerDay = compared?.cadence?.authoredPerActiveDay;
  const headline = evaluation?.gaps?.[0]?.headline || '';

  const shownHistory = history.filter((h) => historyFilter === 'all' || (h.source || 'manual') === historyFilter);

  // "New data since the last review": the newest corpus pull is later than what the last review looked at.
  const latestDataAt = (data?.rowsMeta || []).map((r) => r?.freshness?.pulledAt).filter(Boolean).sort().pop() || null;
  const lastReview = stratDoc.doc?.lastReview || null;
  const reviewDue = !!latestDataAt && !!stratDoc.doc && (!lastReview || !lastReview.dataAsOf || latestDataAt > lastReview.dataAsOf);
  const askReview = () => { setReviewRequest({ nonce: Date.now() }); setView('chat'); };

  const detailTabsBar = (
    <SegmentedControl
      id="x-strategy-details-tabs"
      ariaLabel="Strategy details"
      value={detailTab}
      onChange={setDetailTab}
      options={DETAIL_TABS}
    />
  );

  return (
    <div id="x-strategy-root" style={S.stack}>
      <style>{LAYOUT_CSS}</style>

      {loadError ? (
        <div id="x-strategy-load-error" role="alert" className="xce-panel">
          <div style={S.err}>{loadError}</div>
          <button type="button" id="x-strategy-load-retry-button" className="xce-btn" disabled={loading} onClick={() => reload()}>Try again</button>
        </div>
      ) : null}

      {/* Phone only: Chat | Details toggle. Both panes stay mounted. */}
      <div id="x-strategy-mobile-view-toggle-shell" className="xce-mobile-only">
        <SegmentedControl
          id="x-strategy-mobile-view-toggle"
          ariaLabel="Strategy view"
          value={view}
          onChange={setView}
          options={[
            { value: 'chat', label: 'Chat', icon: <MessagesSquare size={16} /> },
            { value: 'details', label: 'Details', icon: <BarChart3 size={16} /> },
          ]}
        />
      </div>

      <div id="x-strategy-header-chips-row">
        {clientName ? <Badge id="x-strategy-chip-client" tone="grey">{clientName}</Badge> : null}
        {chipHandle ? <Badge id="x-strategy-chip-handle" tone="grey">@{chipHandle}</Badge> : null}
        <Badge id="x-strategy-chip-plan-version" tone="grey">{planVersion ? `Plan v${planVersion}` : 'Plan default'}</Badge>
        <Badge id="x-strategy-chip-doc-version" tone={stratDoc.doc?.confirmed ? 'grey' : 'amber'}>{stratDoc.doc?.version ? `Strategy v${stratDoc.doc.version}${stratDoc.doc.confirmed ? '' : ' · draft'}` : 'Strategy draft'}</Badge>
      </div>

      {/* Refresh pulls fresh posts for you + every benchmark (free, via the Mac worker); Review asks the agent
          to check the strategy against them and say in the chat what, if anything, should change. */}
      <div id="x-strategy-actions-row">
        {!hideRefresh ? (
          <button type="button" id="x-strategy-refresh-all-button" className="xce-btn xce-btn-ghost" disabled={refreshing || !profile} onClick={() => startRefresh()}>
            <RefreshCw size={15} /> {refreshing ? 'Refreshing…' : 'Refresh data'}
          </button>
        ) : null}
        <button type="button" id="x-strategy-review-button" className="xce-btn" disabled={!stratDoc.doc} onClick={askReview}>
          <Sparkles size={15} /> Review strategy
        </button>
        <span id="x-strategy-review-status" style={S.muted}>
          {refreshView?.active ? refreshView.headline : lastReview?.at ? `Last review ${formatDayTime(lastReview.at)}` : 'Not reviewed yet'}
        </span>
      </div>
      {refresh.error ? <Msg id="x-strategy-refresh-all-error" kind="err">{refresh.error}</Msg> : null}
      {reviewDue && !refreshing ? (
        <WarnRow id="x-strategy-review-due-banner" actionLabel="Review now" onAction={askReview}>
          {lastReview ? 'New data since your last review.' : 'Your strategy has not been reviewed against the data yet.'}
        </WarnRow>
      ) : null}

      <div id="x-strategy-layout" data-view={view}>
        <div id="x-strategy-chat-column">
          <StrategyChat
            clientId={clientId}
            call={call}
            currentPlan={data?.plan?.plan}
            planVersion={planVersion}
            history={planDoc?.history}
            prefill={prefill}
            selected={selected}
            onPlanChanged={() => { reload(); if (typeof onPlanChanged === 'function') onPlanChanged(); }}
            onRefreshed={() => reload({ keepDrafts: true })}
            onViewPlan={() => goDetails('plan')}
            onViewChange={(version) => goDetails('history', version)}
            onUndo={undoFromChat}
            undoNote={undoVersion ? { version: undoVersion, busy: planBusy, text: planMsg.text, kind: planMsg.kind } : null}
            docHistory={stratDoc.doc?.history}
            docSections={stratDoc.doc?.sections}
            reviewRequest={reviewRequest}
            onDocChanged={loadDoc}
            onReviewed={loadDoc}
            onViewDoc={() => goDetails('strategy')}
          />
        </div>

        <div id="x-strategy-details-column">
          <section id="x-strategy-details-panel" className="xce-panel" data-section="details">
            <SectionLabel id="x-strategy-details-header">Details</SectionLabel>
            {detailTabsBar}

            {/* ---------------- STRATEGY DOCUMENT ---------------- */}
            {detailTab === 'strategy' ? (
              <StrategyDocPanel
                clientId={clientId}
                call={call}
                doc={stratDoc.doc}
                meta={stratDoc.meta}
                loading={stratDoc.loading}
                loadError={stratDoc.error}
                onReload={loadDoc}
                onSaved={(doc) => setStratDoc((d) => ({ ...d, doc }))}
                onAskInChat={askInChat}
              />
            ) : null}

            {/* ---------------- PLAN ---------------- */}
            {detailTab === 'plan' ? (
              <div id="x-strategy-details-plan-tab" style={S.stack}>
                <Card id="x-strategy-plan-panel" data-section="plan" padding={14}>
                  <div id="x-strategy-plan-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span style={{ ...S.label, fontSize: 11, letterSpacing: '0.08em', color: XCE_COLORS.inkSoft }}>{planDoc?.version ? `Current plan · v${planDoc.version}` : 'Current plan · default'}</span>
                    {data ? (planCheck.dirty ? <Badge id="x-strategy-plan-saved-badge" tone="amber">Unsaved</Badge> : <Badge id="x-strategy-plan-saved-badge" tone="green">Saved</Badge>) : null}
                  </div>
                  {loading && !data ? <div id="x-strategy-plan-loading" className="xce-loading">Loading plan…</div> : null}

                  {data ? (
                    <div id="x-strategy-plan-content" style={S.stack}>
                      <p id="x-strategy-today-plan-line" style={{ ...S.note, margin: 0 }}>{todayPlanLine(data.todayPlanPreview, planDoc)}</p>

                      <div id="x-strategy-plan-cadence-row">
                        <NumField id="x-strategy-authored-per-day-input" label="Posts per day" value={planDraft.authoredPerDay} onChange={(v) => setDraftField('authoredPerDay', v)} min={PLAN_LIMITS.authoredPerDayMin} max={PLAN_LIMITS.authoredPerDayMax} />
                        <div id="x-strategy-derived-tier-row" style={{ paddingBottom: 8 }}>
                          <span id="x-strategy-derived-tier" className="xce-chip">{tierNow === null ? `enter ${PLAN_LIMITS.authoredPerDayMin}-${PLAN_LIMITS.authoredPerDayMax}` : tierText(tierNow)}</span>
                        </div>
                        <NumField id="x-strategy-quote-react-min-input" label="Quote-react minimum" value={quoteReactFloor ?? ''} onChange={setQuoteReactFloor} min={0} max={perDayMax} />
                      </div>

                      <Accordion id="x-strategy-type-limits-panel" title="Type limits">
                        <div style={S.label}>Per-type floors and caps (blank = none)</div>
                        <div id="x-strategy-type-limits-scroll" style={S.scroll}>
                          <table id="x-strategy-type-limits-table" style={S.table}>
                            <thead><tr><th style={S.th}>Type</th><th style={S.th}>Floor</th><th style={S.th}>Cap</th></tr></thead>
                            <tbody>
                              {PLANNABLE_SLOT_TYPES.map((t) => (
                                <tr key={t} id={`x-strategy-type-row-${t}`}>
                                  <td style={S.td}>{t}</td>
                                  <td style={S.td}>
                                    <input id={`x-strategy-type-floor-input-${t}`} aria-label={`${t} floor`} className="xce-input" type="number" inputMode="numeric" min={0} step={1}
                                      value={planDraft.typeFloors[t] ?? ''} onChange={(e) => setDraftMap('typeFloors', t, e.target.value)} />
                                  </td>
                                  <td style={S.td}>
                                    <input id={`x-strategy-type-cap-input-${t}`} aria-label={`${t} cap`} className="xce-input" type="number" inputMode="numeric" min={0} step={1}
                                      value={planDraft.typeCaps[t] ?? ''} onChange={(e) => setDraftMap('typeCaps', t, e.target.value)} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </Accordion>

                      <Accordion id="x-strategy-plan-notes-accordion" title="Notes">
                        <div id="x-strategy-plan-notes-field" className="xce-field">
                          <label htmlFor="x-strategy-plan-notes-input" className="xce-field-label">Notes</label>
                          <textarea id="x-strategy-plan-notes-input" rows={3} maxLength={1000} style={{ minHeight: 70 }} value={planDraft.notes} onChange={(e) => setDraftField('notes', e.target.value)} />
                        </div>
                      </Accordion>

                      <div id="x-strategy-plan-reason-field" className="xce-field">
                        <label htmlFor="x-strategy-plan-reason-input" className="xce-field-label">Reason (optional, saved in history)</label>
                        <input id="x-strategy-plan-reason-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                      </div>

                      {planDoc?.updatedAt ? <p id="x-strategy-plan-last-updated" style={{ ...S.note, margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}>Last updated {formatDayTime(planDoc.updatedAt)}</p> : null}

                      {planCheck.dirty && planCheck.errors.length ? <Msg id="x-strategy-plan-draft-errors" kind="err">{planCheck.errors.join(' ')}</Msg> : null}

                      <div id="x-strategy-plan-actions-row" style={S.row}>
                        <button type="button" id="x-strategy-plan-save-button" className="xce-btn" style={{ flex: '1 1 160px', minHeight: 44 }} disabled={planBusy || !planCheck.dirty || planCheck.errors.length > 0} onClick={savePlan}>
                          {planBusy ? 'Saving…' : 'Save changes'}
                        </button>
                        <button type="button" id="x-strategy-plan-discard-button" className="xce-btn xce-btn-ghost" style={{ minHeight: 44 }} disabled={planBusy || !planCheck.dirty} onClick={() => setPlanDraft(planDraftFromPlan(savedPlan))}>Discard edits</button>
                      </div>

                      {planMsg.text ? (
                        <div id="x-strategy-plan-message" role={planMsg.kind === 'err' ? 'alert' : 'status'} style={planMsg.kind === 'err' ? S.err : S.ok}>
                          <div>{planMsg.text}</div>
                          {planMsg.errors.length ? <ul id="x-strategy-plan-error-list" style={S.list}>{planMsg.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
                          {planMsg.conflict ? (
                            <button type="button" id="x-strategy-plan-reload-button" className="xce-btn" style={{ marginTop: 6 }} disabled={loading} onClick={() => reload()}>Reload plan</button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </Card>

                <ContentTracksPanel
                  draft={tracksDraft}
                  setDraft={setTracksDraft}
                  savedHandles={savedTrackHandles}
                  rowsMeta={metaByHandle}
                  request={refresh.request}
                  refreshView={refreshView}
                  refreshFollowUp={refreshView ? <RefreshFollowUp idPrefix="x-strategy-content-tracks-refresh" view={refreshView} onRecheck={recheckRefresh} onRetry={startRefresh} /> : null}
                  refreshing={refreshing}
                  profiles={data?.trackProfiles}
                  check={tracksCheck}
                  busy={planBusy}
                  message={tracksMsg}
                  onSave={saveTracks}
                  onDiscard={() => setTracksDraft(trackDraftFromPlan(savedPlan))}
                  onRefreshHandle={(h) => startRefresh([h])}
                  hideRefresh={hideRefresh}
                />

                {staleBenchmarks.length ? (
                  <WarnRow id="x-strategy-benchmark-refresh-banner" actionLabel="Details" onAction={() => setDetailTab('accounts')}>
                    {staleBenchmarks.length === 1 ? 'Benchmark needs refresh' : 'Benchmarks need refresh'}
                  </WarnRow>
                ) : null}
              </div>
            ) : null}

            {/* ---------------- ACCOUNTS ---------------- */}
            {detailTab === 'accounts' ? (
              <section id="x-strategy-accounts-panel" data-section="accounts" style={S.stack}>
                {loading && !profile ? <div id="x-strategy-accounts-loading" className="xce-loading">Loading accounts…</div> : null}

                {profile ? (
                  <div id="x-strategy-accounts-content" style={S.stack}>
                    {profile.defaulted?.length ? (
                      <div id="x-strategy-profile-defaulted-notice" style={S.warn}>
                        Showing default handles @bai_ee vs @seb__design — save to make them yours.
                      </div>
                    ) : null}

                    <Card id="x-strategy-own-account-card" padding={14}>
                      <SectionLabel id="x-strategy-accounts-header">Your account</SectionLabel>
                      <div id="x-strategy-own-handle-row" style={{ ...S.row, marginTop: 8, flexWrap: 'nowrap' }}>
                        <Avatar id="x-strategy-own-avatar" handle={handles.own} />
                        {editOwn || !handles.own ? (
                          <input id="x-strategy-own-handle-input" aria-label="Your handle" className="xce-input" style={S.handleInput} value={handles.own} placeholder="your_handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                            onChange={(e) => setHandles((h) => ({ ...h, own: e.target.value }))} />
                        ) : (
                          <span id="x-strategy-own-handle-text" style={{ flex: 1, minWidth: 0, fontSize: 15, overflowWrap: 'anywhere' }}>@{handles.own}</span>
                        )}
                        {!editOwn && handles.own ? <IconButton id="x-strategy-own-handle-edit-button" label="Edit your handle" icon={<Pencil size={16} />} size={36} onClick={() => setEditOwn(true)} /> : null}
                      </div>
                      <div id="x-strategy-own-handle-status-row" style={{ ...S.muted, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: XCE_RADII.pill, background: needsRefresh(ownKey) ? XCE_COLORS.amber : XCE_COLORS.green, flex: '0 0 auto' }} />
                        <span id="x-strategy-own-handle-status">{rowsFor(ownKey)} posts {'·'} {freshnessLabel(metaByHandle[ownKey])}</span>
                      </div>
                    </Card>

                    {trackBenchmarks ? (
                      <Card id="x-strategy-benchmarks-card" data-source="content-tracks" padding={14}>
                        <SectionLabel id="x-strategy-benchmarks-header">{`Benchmarks · ${trackBenchmarks.length}/${PLAN_LIMITS.maxBenchmarkHandles}`}</SectionLabel>
                        <p id="x-strategy-benchmarks-derived-note" style={{ ...S.note, margin: '6px 0 0' }}>
                          Set by your content tracks (pace benchmark first). Edit them in Plan → Content tracks.
                        </p>
                        <div id="x-strategy-benchmarks-list" style={{ ...S.stack, marginTop: 8 }}>
                          {trackBenchmarks.map((clean, i) => {
                            const n = i + 1;
                            const stale = needsRefresh(clean);
                            return (
                              <div key={clean} id={`x-strategy-benchmark-handle-row-${n}`} style={{ ...S.row, flexWrap: 'nowrap', padding: 10, border: `1px solid ${XCE_COLORS.border}`, borderRadius: XCE_RADII.md }}>
                                <Avatar id={`x-strategy-benchmark-avatar-${n}`} handle={clean} />
                                <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
                                  <span id={`x-strategy-benchmark-handle-text-${n}`} style={{ fontSize: 15, overflowWrap: 'anywhere' }}>@{clean}{clean === cleanHandle(savedPlan.benchmarkPrimary) ? <span style={S.label}> · pace</span> : null}</span>
                                  <span style={S.muted}>{rowsFor(clean)} posts</span>
                                </div>
                                <Badge id={`x-strategy-benchmark-handle-status-${n}`} tone={stale ? 'amber' : 'green'}>{stale ? 'Needs refresh' : freshnessLabel(metaByHandle[clean])}</Badge>
                                {!hideRefresh ? <IconButton id={`x-strategy-benchmark-refresh-button-${n}`} label={`Refresh @${clean}`} icon={<RefreshCw size={16} />} size={40} disabled={refreshing} onClick={() => startRefresh([clean])} /> : null}
                              </div>
                            );
                          })}
                        </div>
                        <button type="button" id="x-strategy-benchmarks-edit-tracks-button" className="xce-btn xce-btn-ghost" style={{ ...S.fullBtn, marginTop: 8 }} onClick={goToTracks}>
                          Edit content tracks <ArrowUpRight size={15} />
                        </button>
                      </Card>
                    ) : (
                    <Card id="x-strategy-benchmarks-card" padding={14}>
                      <SectionLabel id="x-strategy-benchmarks-header">{`Benchmarks · ${handles.benchmarks.length}/${PLAN_LIMITS.maxBenchmarkHandles}`}</SectionLabel>
                      <div id="x-strategy-benchmarks-list" style={{ ...S.stack, marginTop: 8 }}>
                        {handles.benchmarks.map((h, i) => {
                          const n = i + 1;
                          const stale = needsRefresh(h);
                          const clean = cleanHandle(h);
                          return (
                            <div key={n} id={`x-strategy-benchmark-handle-row-${n}`} style={{ ...S.stack, gap: 8, padding: 10, border: `1px solid ${XCE_COLORS.border}`, borderRadius: XCE_RADII.md }}>
                              <div id={`x-strategy-benchmark-identity-row-${n}`} style={{ ...S.row, flexWrap: 'nowrap' }}>
                                <Avatar id={`x-strategy-benchmark-avatar-${n}`} handle={clean} />
                                <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
                                  <input id={`x-strategy-benchmark-handle-input-${n}`} aria-label={`Benchmark ${n} handle`} className="xce-input" value={h} placeholder="benchmark_handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                                    onChange={(e) => setBenchmark(i, e.target.value)} />
                                  <span style={S.muted}>{rowsFor(h)} posts</span>
                                </div>
                              </div>
                              <div style={S.row}>
                                <Badge id={`x-strategy-benchmark-handle-status-${n}`} tone={stale ? 'amber' : 'green'}>{stale ? 'Needs refresh' : freshnessLabel(metaByHandle[clean])}</Badge>
                              </div>
                              <div id={`x-strategy-benchmark-actions-row-${n}`} style={{ ...S.row, flexWrap: 'nowrap' }}>
                                {!hideRefresh ? (
                                  <button type="button" id={`x-strategy-benchmark-refresh-button-${n}`} className="xce-btn xce-btn-ghost" style={{ flex: 1, minHeight: 40 }} disabled={refreshing || !clean} onClick={() => startRefresh([clean])}>
                                    <RefreshCw size={15} /> Refresh
                                  </button>
                                ) : null}
                                <IconButton id={`x-strategy-benchmark-remove-button-${n}`} label={`Remove benchmark ${n}`} icon={<Trash2 size={16} />} size={40} onClick={() => removeBenchmark(i)} />
                              </div>
                            </div>
                          );
                        })}
                        <div id="x-strategy-benchmark-add-row" style={S.stack}>
                          <button type="button" id="x-strategy-benchmark-add-button" className="xce-btn xce-btn-ghost" style={S.fullBtn} disabled={handles.benchmarks.length >= PLAN_LIMITS.maxBenchmarkHandles} onClick={addBenchmark}>
                            <Plus size={16} /> Add benchmark
                          </button>
                          <span style={{ ...S.note, margin: 0 }}>Up to {PLAN_LIMITS.maxBenchmarkHandles}. Changes need Save handles. Refresh pulls the saved handles.</span>
                        </div>
                      </div>
                    </Card>
                    )}

                    <Card id="x-strategy-data-coverage-card" padding={'0 14px'}>
                      <Accordion id="x-strategy-data-coverage" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Database size={16} /> Data coverage</span>}>
                        {evaluation ? <EvaluationTable evaluation={evaluation} idPrefix="x-strategy-evaluation" /> : <p style={{ ...S.note, margin: 0 }}>No evaluation yet. Refresh data to pull posts for your handles.</p>}
                      </Accordion>
                    </Card>

                    {dirtyHandles && handlesProblem ? <Msg id="x-strategy-handles-problem" kind="err">{handlesProblem}</Msg> : null}
                  </div>
                ) : null}

                <Msg id="x-strategy-save-handles-message" kind={saveMsg.kind === 'err' ? 'err' : 'ok'}>{saveMsg.text}</Msg>
                <Msg id="x-strategy-refresh-error" kind="err">{refresh.error}</Msg>
                {refreshView ? (
                  <div id="x-strategy-refresh-status" role="status" style={refreshView.tone === 'error' ? S.err : refreshView.tone === 'warn' ? S.warn : refreshView.tone === 'ok' ? S.ok : S.note}>
                    <div id="x-strategy-refresh-headline">{refreshView.headline}</div>
                    {refreshView.lines.length ? (
                      <ul id="x-strategy-refresh-results-list" style={S.list}>{refreshView.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                    ) : null}
                    {refreshView.hint ? <div id="x-strategy-refresh-hint" style={{ marginTop: 4 }}>{refreshView.hint}</div> : null}
                    <RefreshFollowUp idPrefix="x-strategy-refresh" view={refreshView} onRecheck={recheckRefresh} onRetry={startRefresh} />
                  </div>
                ) : null}

                {workerHealthLine(data?.workerHealth) ? <div id="x-strategy-worker-health-line" style={S.note}>{workerHealthLine(data?.workerHealth)}</div> : null}

                <div id="x-strategy-accounts-actions" style={S.stack}>
                  {!hideRefresh ? (
                    <button type="button" id="x-strategy-refresh-button" className="xce-btn" style={S.fullBtn} disabled={!profile || refreshing} onClick={() => startRefresh()}>
                      {refreshing ? 'Refreshing…' : 'Refresh data'}
                    </button>
                  ) : null}
                  <button type="button" id="x-strategy-save-handles-button" className="xce-btn xce-btn-ghost" style={S.fullBtn} disabled={!dirtyHandles || saveBusy || !!handlesProblem} onClick={saveHandles}>
                    {saveBusy ? 'Saving…' : 'Save handles'}
                  </button>
                  <button type="button" id="x-strategy-accounts-ask-chat-button" className="xce-btn xce-btn-ghost" style={S.fullBtn} onClick={() => askInChat(ASK_PROMPTS.accounts)}>
                    Ask in chat <ArrowUpRight size={15} />
                  </button>
                </div>
              </section>
            ) : null}

            {/* ---------------- INSIGHTS ---------------- */}
            {detailTab === 'insights' ? (
              <section id="x-strategy-evaluation-panel" data-section="evaluation" style={S.stack}>
                <div id="x-strategy-evaluation-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ ...S.label, fontSize: 11, letterSpacing: '0.08em', color: XCE_COLORS.inkSoft }}>Insights</span>
                  <button type="button" id="x-strategy-evaluation-reload-button" className="xce-btn xce-btn-ghost" style={{ minHeight: 34 }} disabled={loading} onClick={() => reload({ keepDrafts: true })}>{loading ? 'Loading…' : 'Reload'}</button>
                </div>

                {loading && !data ? <div id="x-strategy-evaluation-loading" className="xce-loading">Loading evaluation…</div> : null}
                {data && data.evaluationError ? <Msg id="x-strategy-evaluation-error" kind="err">Evaluation failed: {data.evaluationError}</Msg> : null}
                {data && !evaluation && !data.evaluationError ? (
                  <div id="x-strategy-evaluation-empty" className="xce-empty">No evaluation yet. Refresh data to pull posts for your handles.</div>
                ) : null}

                {evaluation ? (
                  <div id="x-strategy-evaluation-content" style={S.stack}>
                    {evaluation.caveats?.length ? (
                      <WarnRow id="x-strategy-evaluation-limited-banner">Limited data {'·'} {evaluation.caveats.length} {evaluation.caveats.length === 1 ? 'caveat' : 'caveats'}</WarnRow>
                    ) : null}

                    <div id="x-strategy-insights-headline-block">
                      {evaluation.byTrack ? <div id="x-strategy-insights-pace-label" style={{ ...S.label, fontSize: 11, letterSpacing: '0.08em', color: XCE_COLORS.inkSoft, marginBottom: 4 }}>Overall pace{evaluation.gapsAgainst ? ` · vs @${evaluation.gapsAgainst}` : ''}</div> : null}
                      {headline ? (
                        <h4 id="x-strategy-insights-headline" style={{ margin: 0, fontSize: 20, lineHeight: 1.25, fontWeight: 600, color: XCE_COLORS.ink }}>{headline}</h4>
                      ) : (
                        <h4 id="x-strategy-insights-headline" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>No headline gap yet</h4>
                      )}
                      {evaluation.gapsAgainst ? <p id="x-strategy-tier-line-compared" style={{ ...S.muted, margin: '4px 0 0' }}>Compared with @{evaluation.gapsAgainst}.</p> : null}
                    </div>

                    <div id="x-strategy-insights-cards" style={S.stack}>
                      {liftCards.map(([type, v]) => (
                        <div key={type} id={`x-strategy-insights-lift-${type}`} style={S.statRow}>
                          <span style={S.statIcon}>{type.includes('quote') ? <Quote size={18} /> : <FileText size={18} />}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{type}</div>
                            <div><b style={{ fontSize: 20, color: v.lift >= 1 ? XCE_COLORS.green : XCE_COLORS.red }}>{v.lift.toFixed(2)}{'×'}</b> <span style={S.muted}>your avg</span></div>
                            <div style={S.muted}>{Number.isFinite(v.n) ? `${v.n} posts` : ''}{Number.isFinite(v.share) ? ` · ${Math.round(v.share)}% of mix` : ''}</div>
                          </div>
                        </div>
                      ))}
                      {Number.isFinite(ownPerDay) ? (
                        <div id="x-strategy-insights-frequency" style={S.statRow}>
                          <span style={S.statIcon}><BarChart3 size={18} /></span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>Posting frequency</div>
                            <div>
                              <b style={{ fontSize: 20, color: Number.isFinite(benchPerDay) && ownPerDay < benchPerDay ? XCE_COLORS.red : XCE_COLORS.green }}>{ownPerDay}</b>
                              {Number.isFinite(benchPerDay) ? <span style={S.muted}> vs {benchPerDay} / day</span> : <span style={S.muted}> / day</span>}
                            </div>
                            {Number.isFinite(benchPerDay) ? <div style={S.muted}>{benchPerDay > ownPerDay ? 'Benchmark posts more often.' : 'You post at least as often as the benchmark.'}</div> : null}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <TrackInsights evaluation={evaluation} onEditTracks={goToTracks} />

                    <Card id="x-strategy-insights-more-card" padding={'0 14px'}>
                      <Accordion id="x-strategy-insights-comparison" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><BarChart3 size={16} /> View comparison</span>}>
                        <p id="x-strategy-tier-line" style={{ ...S.note, marginTop: 0 }}>{tierComparison(evaluation)}</p>
                        <EvaluationGaps evaluation={evaluation} idPrefix="x-strategy-evaluation" />

                        <div id="x-strategy-evaluate-handle-row" style={{ ...S.row, marginTop: 12 }}>
                          <label htmlFor="x-strategy-evaluate-handle-input" style={S.label}>Compare another account</label>
                          <input id="x-strategy-evaluate-handle-input" className="xce-input" style={S.handleInput} value={adhocHandle} placeholder="any_handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                            onChange={(e) => setAdhocHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') evaluateAdhoc(); }} />
                          <button type="button" id="x-strategy-evaluate-handle-button" className="xce-btn" disabled={adhoc.busy} onClick={evaluateAdhoc}>{adhoc.busy ? 'Evaluating…' : 'Evaluate'}</button>
                        </div>
                        <Msg id="x-strategy-evaluate-handle-error" kind="err">{adhoc.error}</Msg>
                        {adhoc.result?.needsRefresh ? (
                          <div id="x-strategy-evaluate-handle-needs-refresh" style={S.warn}>
                            {adhoc.result.missingOwn
                              ? `@${adhoc.result.handle} has data, but your own handle has none yet — needs refresh.`
                              : `@${adhoc.result.handle} needs refresh — no posts pulled yet.`}{' '}
                            {!hideRefresh ? (
                              <button type="button" id="x-strategy-evaluate-refresh-button" className="xce-btn xce-btn-ghost" disabled={refreshing}
                                onClick={() => startRefresh(adhoc.result.missingOwn && adhoc.result.ownHandle ? [adhoc.result.ownHandle] : [adhoc.result.handle])}>
                                Refresh {adhoc.result.missingOwn ? 'your handle' : `@${adhoc.result.handle}`}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {adhoc.result && !adhoc.result.needsRefresh ? (
                          <div id="x-strategy-evaluate-handle-result" style={{ marginTop: 8 }}>
                            {adhoc.result.evaluationError ? <Msg id="x-strategy-evaluate-handle-eval-error" kind="err">Evaluation failed: {adhoc.result.evaluationError}</Msg> : null}
                            {adhoc.result.evaluation ? <EvaluationView evaluation={adhoc.result.evaluation} idPrefix="x-strategy-adhoc" /> : null}
                          </div>
                        ) : null}
                      </Accordion>
                      <Accordion id="x-strategy-insights-sources" title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><FileText size={16} /> Sources &amp; limitations</span>}>
                        {evaluation.caveats?.length ? <EvaluationCaveats evaluation={evaluation} idPrefix="x-strategy-evaluation" /> : <p style={{ ...S.note, margin: 0 }}>No data limitations flagged.</p>}
                      </Accordion>
                    </Card>
                  </div>
                ) : null}

                {data && !evaluation ? (
                  <Card id="x-strategy-insights-compare-card" padding={14}>
                    <div id="x-strategy-evaluate-handle-row" style={S.row}>
                      <label htmlFor="x-strategy-evaluate-handle-input" style={S.label}>Compare another account</label>
                      <input id="x-strategy-evaluate-handle-input" className="xce-input" style={S.handleInput} value={adhocHandle} placeholder="any_handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                        onChange={(e) => setAdhocHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') evaluateAdhoc(); }} />
                      <button type="button" id="x-strategy-evaluate-handle-button" className="xce-btn" disabled={adhoc.busy} onClick={evaluateAdhoc}>{adhoc.busy ? 'Evaluating…' : 'Evaluate'}</button>
                    </div>
                    <Msg id="x-strategy-evaluate-handle-error" kind="err">{adhoc.error}</Msg>
                  </Card>
                ) : null}

                <button type="button" id="x-strategy-insights-discuss-button" className="xce-btn" style={S.fullBtn} onClick={() => askInChat(ASK_PROMPTS.insights)}>
                  Discuss in chat <ArrowUpRight size={15} />
                </button>
              </section>
            ) : null}

            {/* ---------------- HISTORY ---------------- */}
            {detailTab === 'history' ? (
              <section id="x-strategy-plan-history-panel" data-section="history" style={S.stack}>
                <Card id="x-strategy-history-card" padding={14}>
                  <div id="x-strategy-history-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 600 }}>Plan history</span>
                    <select id="x-strategy-history-filter-select" aria-label="Filter plan history" className="xce-input" style={{ width: 'auto', minHeight: 36, fontSize: 14 }} value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)}>
                      <option value="all">All changes</option>
                      <option value="manual">Manual</option>
                      <option value="chat">Chat</option>
                    </select>
                  </div>
                  {shownHistory.length ? (
                    <ul id="x-strategy-plan-history-list" style={{ listStyle: 'none', margin: '0 0 0 5px', padding: 0, borderLeft: `2px solid ${XCE_COLORS.border}`, display: 'grid', gap: 4 }}>
                      {shownHistory.map((h) => {
                        const isCurrent = h.version === planVersion;
                        const open = expandedVersion === h.version;
                        const source = h.source || 'manual';
                        const diff = Array.isArray(h.diff) ? h.diff : [];
                        return (
                          <li key={h.version} id={`x-strategy-plan-history-item-${h.version}`} style={{ position: 'relative', padding: '4px 0 8px 16px', borderBottom: `1px solid ${XCE_COLORS.border}`, minWidth: 0 }}>
                            <span aria-hidden="true" style={{ position: 'absolute', left: -7, top: 12, width: 12, height: 12, borderRadius: XCE_RADII.pill, background: isCurrent ? XCE_COLORS.ink : XCE_COLORS.borderStrong, border: `2px solid ${XCE_COLORS.surface}` }} />
                            <button
                              type="button"
                              id={`x-strategy-plan-history-toggle-${h.version}`}
                              aria-expanded={open}
                              onClick={() => setExpandedVersion(open ? 0 : h.version)}
                              style={{ width: '100%', display: 'grid', gap: 3, padding: 0, minHeight: 44, border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', color: XCE_COLORS.ink }}
                            >
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <b style={{ fontSize: 15 }}>v{h.version}</b>
                                {isCurrent ? <Badge tone="green">CURRENT</Badge> : null}
                                <Badge tone={source === 'chat' ? 'blue' : 'grey'}>{source.toUpperCase()}</Badge>
                                <ChevronDown size={16} style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }} />
                              </span>
                              <span style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{historyDiffSummary(h)}{h.reason ? ` · ${h.reason}` : ''}</span>
                              <span style={S.muted}>{formatDayTime(h.at)}</span>
                            </button>
                            {open ? (
                              <div id={`x-strategy-plan-history-detail-${h.version}`} style={{ ...S.stack, gap: 8, marginTop: 6, padding: 10, borderRadius: XCE_RADII.md, background: XCE_COLORS.surfaceMuted }}>
                                {!isCurrent ? (
                                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button type="button" id={`x-strategy-plan-revert-${h.version}`} className="xce-btn xce-btn-ghost" disabled={planBusy} onClick={() => { setUndoVersion(0); revertPlan(h.version); }}>
                                      <RotateCcw size={15} /> Restore v{h.version}
                                    </button>
                                  </div>
                                ) : null}
                                {diff.length ? (
                                  <div id={`x-strategy-plan-history-diff-${h.version}`} style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                                    {diff.map((d, i) => (
                                      <div key={`${d.path}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, minWidth: 0 }}>
                                        <span style={{ color: XCE_COLORS.inkSoft, overflowWrap: 'anywhere' }}>{d.path}</span>
                                        <span style={{ textAlign: 'right', overflowWrap: 'anywhere' }}>{showVal(d.from)} {'→'} {showVal(d.to)}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : <span style={S.muted}>No field changes.</span>}
                                <span style={S.muted}>by {h.by || 'unknown'}{!isCurrent ? ' · Restoring creates a new version.' : ''}</span>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p id="x-strategy-plan-history-empty" style={{ ...S.note, margin: 0 }}>{history.length ? 'No changes match this filter.' : 'No saved changes yet.'}</p>}
                </Card>
                <button type="button" id="x-strategy-history-ask-chat-button" className="xce-btn xce-btn-ghost" style={S.fullBtn} onClick={() => askInChat(ASK_PROMPTS.history)}>
                  Ask in chat <ArrowUpRight size={15} />
                </button>
              </section>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
});

export default StrategyPanel;
