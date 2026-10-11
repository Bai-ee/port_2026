'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DEFAULT_PLAN, PLAN_LIMITS } from '../../../features/x-strategy/index.js';
import {
  PLANNABLE_SLOT_TYPES, freshnessLabel, rowCountOf, indexRowsMeta, cleanHandle, refreshStatusView, refreshIsActive,
  tierComparison, tierText, groupCaveats, comparisonRows, handlesDraftFromProfile, normalizeHandlesDraft, handlesDirty,
  validateHandlesDraft, planDraftFromPlan, planChangesFromDraft, draftTier, historyNewestFirst, historyDiffSummary,
  formatWhen, todayPlanLine, planErrorView,
} from '../../../features/x-strategy/ui-model.js';
import StrategyChat from './StrategyChat.jsx';

// StrategyPanel - the Strategy tab of the Content Engine card.
//
// Layout: accounts (full width) -> [evaluation + plan | chat]. Desktop = two columns, <=480px = one stack
// with the chat last. Inline `style` props are primary; shared look comes from the card's `xce-*` classes
// (the card owns the single `<style jsx global>` block). The tiny <style> below only holds the layout
// media query, prefixed `#x-strategy-*`.
//
// Data: one `strategy-get` per load. Every call goes through `call(action, body)` (the card's quote-targets
// POST helper); each body carries clientId. Failures are shown as text, never thrown.
//
// StrategyChat contract (built by another track, components/dashboard/x-content/StrategyChat.jsx):
//   <StrategyChat clientId call currentPlan onPlanChanged onRefreshed />  (T4c, mounted in the chat column below)

const POLL_MS = 4000;
const errText = (err, fallback) => String(err?.message || fallback || 'Request failed.');

const S = {
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  head: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'space-between', marginBottom: 8 },
  h: { margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.7)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 },
  note: { margin: '6px 0 0', fontSize: 12, lineHeight: 1.45, color: 'rgba(42,36,32,0.6)' },
  warn: { margin: '8px 0', padding: '8px 10px', borderRadius: 10, background: 'rgba(183,121,31,0.08)', border: '1px solid rgba(183,121,31,0.24)', fontSize: 12, lineHeight: 1.45, color: '#8a5a15' },
  err: { margin: '8px 0', fontSize: 12, lineHeight: 1.4, color: '#9f1f17' },
  ok: { margin: '8px 0', fontSize: 12, lineHeight: 1.4, color: '#1f6b3a' },
  scroll: { overflowX: 'auto', minWidth: 0 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '4px 8px 4px 0', fontFamily: 'var(--font-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(42,36,32,0.55)', whiteSpace: 'nowrap' },
  td: { padding: '5px 8px 5px 0', borderTop: '1px solid rgba(42,36,32,0.08)', verticalAlign: 'top' },
  list: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.55)' },
  narrow: { maxWidth: 140 },
  handleInput: { flex: '1 1 140px', minWidth: 0 },
  caveatBox: { margin: '8px 0', padding: '8px 10px', borderRadius: 10, background: 'rgba(183,121,31,0.1)', border: '1px solid rgba(183,121,31,0.35)' },
};

const LAYOUT_CSS = `
  #x-strategy-layout { display: grid; gap: 12px; min-width: 0; }
  #x-strategy-main-column, #x-strategy-chat-column { display: grid; gap: 12px; min-width: 0; align-content: start; }
  #x-strategy-root input[type=number] { max-width: 90px; }
  @media (min-width: 900px) { #x-strategy-layout { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
`;

function Msg({ id, kind, children }) {
  if (!children || (Array.isArray(children) && !children.length)) return null;
  return <div id={id} role={kind === 'err' ? 'alert' : 'status'} style={S[kind]}>{children}</div>;
}

// ---- evaluation table (shared by the main evaluation and the ad hoc one) ----------------------------------
function EvaluationView({ evaluation, idPrefix }) {
  const rows = comparisonRows(evaluation);
  const groups = groupCaveats(evaluation.caveats);
  return (
    <div id={`${idPrefix}-content`}>
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

      {groups.length ? (
        <div id={`${idPrefix}-caveats`} style={S.caveatBox}>
          <div style={{ ...S.label, color: '#8a5a15' }}>Read with caution</div>
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
      ) : null}

      {evaluation.gapsAgainst ? (
        <div id={`${idPrefix}-gaps`} style={{ marginTop: 8 }}>
          <div style={S.label}>Top gaps vs @{evaluation.gapsAgainst}</div>
          {evaluation.gaps?.length ? (
            <ol id={`${idPrefix}-gaps-list`} style={S.list}>
              {evaluation.gaps.map((g) => <li key={g.id}>{g.headline || g.id}</li>)}
            </ol>
          ) : <p style={S.note}>No meaningful gaps found.</p>}
        </div>
      ) : <p id={`${idPrefix}-gaps-empty`} style={S.note}>No benchmark has data yet, so there are no gaps to show.</p>}
    </div>
  );
}

function evaluationFresh(evaluation, r) {
  const e = r.role === 'own' ? evaluation.own : (evaluation.benchmarks || []).find((b) => b.handle === r.handle);
  if (!e) return '—';
  if (e.pulledAt === null || e.ageDays === null || e.ageDays === undefined) return 'committed data';
  return e.stale ? `stale ${Math.floor(e.ageDays)}d` : `fresh ${Math.floor(e.ageDays)}d`;
}

const StrategyPanel = forwardRef(function StrategyPanel({ clientId, call, onPlanChanged }, ref) {
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
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState({ kind: '', text: '', errors: [], conflict: false });

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

  useImperativeHandle(ref, () => ({ reload }), [reload]);
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clientId]);

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
  useEffect(() => {
    if (!refresh.requestId || !refreshIsActive(refreshStatus)) return undefined;
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
  }, [refresh.requestId, refreshStatus, refresh.tick, call, baseBody, reload]);

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
      await call('strategy-profile-save', baseBody({ ownHandle: n.own, benchmarkHandles: n.benchmarks }));
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

  // ---- render ------------------------------------------------------------------------------------------------
  const refreshView = refresh.request ? refreshStatusView(refresh.request, { polls: refresh.polls }) : null;
  const refreshing = refresh.starting || !!refreshView?.active;
  const evaluation = data?.evaluation || null;
  const history = historyNewestFirst(planDoc);
  const ownKey = profile ? cleanHandle(profile.ownHandle) : '';
  const rowsFor = (h) => rowCountOf(metaByHandle[cleanHandle(h)]);

  return (
    <div id="x-strategy-root" style={S.stack}>
      <style>{LAYOUT_CSS}</style>

      {loadError ? (
        <div id="x-strategy-load-error" role="alert" className="xce-panel">
          <div style={S.err}>{loadError}</div>
          <button type="button" id="x-strategy-load-retry-button" className="xce-btn" disabled={loading} onClick={() => reload()}>Try again</button>
        </div>
      ) : null}

      {/* ---------------- accounts ---------------- */}
      <section id="x-strategy-accounts-panel" className="xce-panel" data-section="accounts">
        <div id="x-strategy-accounts-header" style={S.head}>
          <h3 style={S.h}>Accounts</h3>
          <div style={S.row}>
            <button type="button" id="x-strategy-refresh-button" className="xce-btn" disabled={!profile || refreshing} onClick={() => startRefresh()}>
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
            <button type="button" id="x-strategy-save-handles-button" className="xce-btn xce-btn-ghost" disabled={!dirtyHandles || saveBusy || !!handlesProblem} onClick={saveHandles}>
              {saveBusy ? 'Saving…' : 'Save handles'}
            </button>
          </div>
        </div>

        {loading && !profile ? <div id="x-strategy-accounts-loading" className="xce-loading">Loading accounts…</div> : null}

        {profile ? (
          <div id="x-strategy-accounts-content" style={S.stack}>
            {profile.defaulted?.length ? (
              <div id="x-strategy-profile-defaulted-notice" style={S.warn}>
                Showing default handles @bai_ee vs @seb__design — save to make them yours.
              </div>
            ) : null}

            <div id="x-strategy-own-handle-row" style={S.row}>
              <label htmlFor="x-strategy-own-handle-input" style={{ ...S.label, minWidth: 64 }}>You</label>
              <input id="x-strategy-own-handle-input" className="xce-input" style={S.handleInput} value={handles.own} placeholder="your_handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onChange={(e) => setHandles((h) => ({ ...h, own: e.target.value }))} />
              <span id="x-strategy-own-handle-status" className="xce-chip">{rowsFor(ownKey)} rows · {freshnessLabel(metaByHandle[ownKey])}</span>
            </div>

            {handles.benchmarks.map((h, i) => {
              const n = i + 1;
              return (
                <div key={n} id={`x-strategy-benchmark-handle-row-${n}`} style={S.row}>
                  <label htmlFor={`x-strategy-benchmark-handle-input-${n}`} style={{ ...S.label, minWidth: 64 }}>Benchmark {n}</label>
                  <input id={`x-strategy-benchmark-handle-input-${n}`} className="xce-input" style={S.handleInput} value={h} placeholder="benchmark_handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                    onChange={(e) => setBenchmark(i, e.target.value)} />
                  <span id={`x-strategy-benchmark-handle-status-${n}`} className="xce-chip">{rowsFor(h)} rows · {freshnessLabel(metaByHandle[cleanHandle(h)])}</span>
                  <button type="button" id={`x-strategy-benchmark-remove-button-${n}`} className="xce-btn xce-btn-ghost" aria-label={`Remove benchmark ${n}`} onClick={() => removeBenchmark(i)}>Remove</button>
                </div>
              );
            })}

            <div id="x-strategy-benchmark-add-row" style={S.row}>
              <button type="button" id="x-strategy-benchmark-add-button" className="xce-btn xce-btn-ghost" disabled={handles.benchmarks.length >= PLAN_LIMITS.maxBenchmarkHandles} onClick={addBenchmark}>Add benchmark</button>
              <span style={S.note}>Up to {PLAN_LIMITS.maxBenchmarkHandles}. Refresh pulls the saved handles.</span>
            </div>
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
          </div>
        ) : null}
      </section>

      <div id="x-strategy-layout">
        <div id="x-strategy-main-column">
          {/* ---------------- evaluation ---------------- */}
          <section id="x-strategy-evaluation-panel" className="xce-panel" data-section="evaluation">
            <div id="x-strategy-evaluation-header" style={S.head}>
              <h3 style={S.h}>Evaluation</h3>
              <button type="button" id="x-strategy-evaluation-reload-button" className="xce-btn xce-btn-ghost" disabled={loading} onClick={() => reload({ keepDrafts: true })}>{loading ? 'Loading…' : 'Reload'}</button>
            </div>

            {loading && !data ? <div id="x-strategy-evaluation-loading" className="xce-loading">Loading evaluation…</div> : null}
            {data && data.evaluationError ? <Msg id="x-strategy-evaluation-error" kind="err">Evaluation failed: {data.evaluationError}</Msg> : null}
            {data && !evaluation && !data.evaluationError ? (
              <div id="x-strategy-evaluation-empty" className="xce-empty">No evaluation yet. Refresh data to pull posts for your handles.</div>
            ) : null}
            {evaluation ? (
              <>
                <p id="x-strategy-tier-line" style={{ ...S.note, marginTop: 0, color: '#2a2420' }}>{tierComparison(evaluation)}</p>
                <EvaluationView evaluation={evaluation} idPrefix="x-strategy-evaluation" />
              </>
            ) : null}

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
                <button type="button" id="x-strategy-evaluate-refresh-button" className="xce-btn xce-btn-ghost" disabled={refreshing}
                  onClick={() => startRefresh(adhoc.result.missingOwn && adhoc.result.ownHandle ? [adhoc.result.ownHandle] : [adhoc.result.handle])}>
                  Refresh {adhoc.result.missingOwn ? 'your handle' : `@${adhoc.result.handle}`}
                </button>
              </div>
            ) : null}
            {adhoc.result && !adhoc.result.needsRefresh ? (
              <div id="x-strategy-evaluate-handle-result" style={{ marginTop: 8 }}>
                {adhoc.result.evaluationError ? <Msg id="x-strategy-evaluate-handle-eval-error" kind="err">Evaluation failed: {adhoc.result.evaluationError}</Msg> : null}
                {adhoc.result.evaluation ? <EvaluationView evaluation={adhoc.result.evaluation} idPrefix="x-strategy-adhoc" /> : null}
              </div>
            ) : null}
          </section>

          {/* ---------------- plan ---------------- */}
          <section id="x-strategy-plan-panel" className="xce-panel" data-section="plan">
            <div id="x-strategy-plan-header" style={S.head}>
              <h3 style={S.h}>Plan{planDoc?.version ? ` · v${planDoc.version}` : ' · default'}</h3>
            </div>
            {loading && !data ? <div id="x-strategy-plan-loading" className="xce-loading">Loading plan…</div> : null}

            {data ? (
              <div id="x-strategy-plan-content" style={S.stack}>
                <p id="x-strategy-today-plan-line" style={{ ...S.note, margin: 0, color: '#2a2420' }}>{todayPlanLine(data.todayPlanPreview, planDoc)}</p>

                <div id="x-strategy-plan-cadence-row" style={S.row}>
                  <label htmlFor="x-strategy-authored-per-day-input" style={S.label}>Posts per day</label>
                  <input id="x-strategy-authored-per-day-input" className="xce-input" type="number" inputMode="numeric" min={PLAN_LIMITS.authoredPerDayMin} max={PLAN_LIMITS.authoredPerDayMax} step={1}
                    style={S.narrow} value={planDraft.authoredPerDay} onChange={(e) => setDraftField('authoredPerDay', e.target.value)} />
                  <span id="x-strategy-derived-tier" className="xce-chip">{tierNow === null ? `enter ${PLAN_LIMITS.authoredPerDayMin}-${PLAN_LIMITS.authoredPerDayMax}` : tierText(tierNow)}</span>
                </div>

                <div id="x-strategy-type-limits-panel">
                  <div style={S.label}>Per-type floors and caps (blank = none)</div>
                  <div id="x-strategy-type-limits-scroll" style={S.scroll}>
                    <table id="x-strategy-type-limits-table" style={S.table}>
                      <thead><tr><th style={S.th}>Type</th><th style={S.th}>Floor</th><th style={S.th}>Cap</th></tr></thead>
                      <tbody>
                        {PLANNABLE_SLOT_TYPES.map((t) => (
                          <tr key={t} id={`x-strategy-type-row-${t}`}>
                            <td style={S.td}>{t}</td>
                            <td style={S.td}>
                              <input id={`x-strategy-type-floor-input-${t}`} aria-label={`${t} floor`} className="xce-input" type="number" inputMode="numeric" min={0} step={1} style={S.narrow}
                                value={planDraft.typeFloors[t] ?? ''} onChange={(e) => setDraftMap('typeFloors', t, e.target.value)} />
                            </td>
                            <td style={S.td}>
                              <input id={`x-strategy-type-cap-input-${t}`} aria-label={`${t} cap`} className="xce-input" type="number" inputMode="numeric" min={0} step={1} style={S.narrow}
                                value={planDraft.typeCaps[t] ?? ''} onChange={(e) => setDraftMap('typeCaps', t, e.target.value)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div id="x-strategy-plan-notes-field" className="xce-field">
                  <label htmlFor="x-strategy-plan-notes-input" className="xce-field-label">Notes</label>
                  <textarea id="x-strategy-plan-notes-input" rows={3} maxLength={1000} style={{ minHeight: 70 }} value={planDraft.notes} onChange={(e) => setDraftField('notes', e.target.value)} />
                </div>

                <div id="x-strategy-plan-reason-field" className="xce-field">
                  <label htmlFor="x-strategy-plan-reason-input" className="xce-field-label">Reason (optional, saved in history)</label>
                  <input id="x-strategy-plan-reason-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                </div>

                {planCheck.dirty && planCheck.errors.length ? <Msg id="x-strategy-plan-draft-errors" kind="err">{planCheck.errors.join(' ')}</Msg> : null}

                <div id="x-strategy-plan-actions-row" style={S.row}>
                  <button type="button" id="x-strategy-plan-save-button" className="xce-btn" disabled={planBusy || !planCheck.dirty || planCheck.errors.length > 0} onClick={savePlan}>
                    {planBusy ? 'Saving…' : 'Save plan'}
                  </button>
                  <button type="button" id="x-strategy-plan-discard-button" className="xce-btn xce-btn-ghost" disabled={planBusy || !planCheck.dirty} onClick={() => setPlanDraft(planDraftFromPlan(savedPlan))}>Discard edits</button>
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

                <div id="x-strategy-plan-history-panel">
                  <div style={S.label}>History</div>
                  {history.length ? (
                    <ul id="x-strategy-plan-history-list" style={{ ...S.list, listStyle: 'none', paddingLeft: 0 }}>
                      {history.map((h) => (
                        <li key={h.version} id={`x-strategy-plan-history-item-${h.version}`} style={{ padding: '6px 0', borderTop: '1px solid rgba(42,36,32,0.08)' }}>
                          <div style={S.row}>
                            <b>v{h.version}</b>
                            <span>{formatWhen(h.at)}</span>
                            <span>by {h.by || 'unknown'}</span>
                            <span className="xce-chip">{h.source || 'manual'}</span>
                            <button type="button" id={`x-strategy-plan-revert-${h.version}`} className="xce-btn xce-btn-ghost" disabled={planBusy} onClick={() => revertPlan(h.version)}>Restore v{h.version}</button>
                          </div>
                          <div style={S.note}>{historyDiffSummary(h)}{h.reason ? ` · ${h.reason}` : ''}</div>
                        </li>
                      ))}
                    </ul>
                  ) : <p id="x-strategy-plan-history-empty" style={S.note}>No saved changes yet.</p>}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div id="x-strategy-chat-column">
          <StrategyChat
            clientId={clientId}
            call={call}
            currentPlan={data?.plan?.plan}
            onPlanChanged={() => { reload(); if (typeof onPlanChanged === 'function') onPlanChanged(); }}
            onRefreshed={() => reload({ keepDrafts: true })}
          />
        </div>
      </div>
    </div>
  );
});

export default StrategyPanel;
