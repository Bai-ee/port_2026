'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarDays, Clock, PenSquare, Quote, RefreshCw, Send, Trash2 } from 'lucide-react';
import { readImpersonateClientId, withImpersonation } from '../../lib/dashboard/bootstrap-session.js';

// X Calendar — surfaces posts worth quote-reacting to, ranked by a local,
// zero-cost scan (see scripts/x-content/scan-quote-targets.mjs). The scan runs
// on the operator's machine (bird needs live x.com cookies, so it cannot run
// serverless) and pushes its result to Firestore; this card only ever reads
// that stored result plus two write actions (draft-quote / dismiss) against
// /api/dashboard/quote-targets. There is nothing for the browser to trigger —
// no refresh button here, only the command to run locally.
//
// Styling note (same trap as XMonitorCard): this uses `<style jsx global>`
// with EVERY selector prefixed by `#x-calendar-card`, because plain
// `<style jsx>` only scopes JSX written directly in this component's return —
// it silently skips markup rendered from a mapped array's inline JSX when
// that JSX lives in a helper — and handing the tag a variable instead of
// writing it inline fails the compile and renders an empty pane.

const MAX_CAPTION_TOTAL = 280;
const STALE_HOURS = 12;

function formatRelative(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function hoursSince(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3_600_000;
}

function fmtInt(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—';
}

// hasMedia tells us *whether* there's something to react to; `reasons` (from
// features/x-quote-targets/rank.js) is the only place that says *what kind*
// (it pushes the literal strings 'video' or 'image'). Falling back to a plain
// "image" label when only `hasMedia` is true keeps the chip honest without a
// dedicated media-type field on the candidate contract.
function mediaLabel(candidate) {
  const reasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
  if (reasons.includes('video')) return 'video';
  if (reasons.includes('image')) return 'image';
  if (candidate.hasMedia) return 'image';
  return 'no media';
}

// A gap's `unit` decides how its number reads. perDay is about how much you
// publish, perPost about what a post earns, shape about a finding with no
// modelled effect — they are deliberately not comparable, so each is labelled
// rather than merged into one "impact" column. See features/x-benchmark/compare.js.
const UNIT_LABEL = { perDay: 'per day', perPost: 'per post', shape: 'finding' };

function impactLabel(gap) {
  if (!gap || gap.unit === 'shape' || !Number.isFinite(Number(gap.impact)) || Number(gap.impact) === 0) return null;
  const value = Number(gap.impact);
  if (gap.unit === 'perDay') return `${(1 + value).toFixed(2)}× output`;
  return `${value > 0 ? '+' : ''}${Math.round(value * 100)}% per post`;
}

export default function XCalendarCard({ getIdToken, activeClientId, clientName, hideRefresh = false }) {
  const [quoteTargets, setQuoteTargets] = useState(null);
  const [dayPlan, setDayPlan] = useState(null);
  const [gapReport, setGapReport] = useState(null);
  const [analysisComputedAt, setAnalysisComputedAt] = useState(null);
  const [calendarSource, setCalendarSource] = useState('');
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [analysisNotice, setAnalysisNotice] = useState(null);
  const [responseClientId, setResponseClientId] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [captions, setCaptions] = useState({});
  const [rowBusy, setRowBusy] = useState({});
  const [rowNotice, setRowNotice] = useState({});
  const [dismissedLocal, setDismissedLocal] = useState(() => new Set());

  const apiFetch = useCallback(async (body = null) => {
    const token = await getIdToken();
    const options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      : { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
    const res = await fetch(withImpersonation('/api/dashboard/quote-targets', readImpersonateClientId()), options);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }, [getIdToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { ok, status, data } = await apiFetch();
      if (!ok) throw Object.assign(new Error(data?.hint || data?.error || `HTTP ${status}`), { status });
      setQuoteTargets(data?.quoteTargets || null);
      setDayPlan(data?.dayPlan || null);
      setGapReport(data?.gapReport || null);
      setAnalysisComputedAt(data?.analysisComputedAt || null);
      setCalendarSource(data?.calendarSource || '');
      setResponseClientId(data?.clientId || '');
      setNotice(null);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not load quote targets.' });
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  // Recomputing is free and offline — it reads corpus stat blocks already in
  // Firestore and runs two pure functions. The step that costs anything (the
  // corpus ingest) is a separate local script, which is why this button exists
  // and a "re-scan" button does not.
  const refreshAnalysis = useCallback(async () => {
    if (analysisBusy) return;
    setAnalysisBusy(true);
    setAnalysisNotice(null);
    try {
      const { ok, status, data } = await apiFetch({ action: 'refresh-analysis' });
      if (!ok) {
        setAnalysisNotice({ kind: 'error', text: data?.error || `HTTP ${status}` });
        return;
      }
      setGapReport(data?.report || null);
      setAnalysisNotice({ kind: 'ok', text: 'Recomputed from the stored corpora.' });
      await load();
    } catch (err) {
      setAnalysisNotice({ kind: 'error', text: err.message || 'Could not recompute.' });
    } finally {
      setAnalysisBusy(false);
    }
  }, [apiFetch, analysisBusy, load]);

  useEffect(() => {
    load();
  }, [load]);

  const clientIdForCommand = responseClientId || activeClientId || '<clientId>';

  const staleHours = useMemo(() => hoursSince(quoteTargets?.generatedAt), [quoteTargets]);
  const isStale = !quoteTargets || staleHours == null || staleHours > STALE_HOURS;

  const candidates = useMemo(() => {
    const list = Array.isArray(quoteTargets?.candidates) ? quoteTargets.candidates : [];
    const dismissedIds = new Set([...(quoteTargets?.dismissed || []), ...dismissedLocal]);
    return list
      .filter((c) => c && !dismissedIds.has(c.id))
      .slice()
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [quoteTargets, dismissedLocal]);

  function setCaption(id, value) {
    setCaptions((s) => ({ ...s, [id]: value }));
  }

  async function draftQuote(candidate) {
    const id = candidate.id;
    if (rowBusy[id]) return;
    setRowBusy((s) => ({ ...s, [id]: 'draft' }));
    setRowNotice((s) => ({ ...s, [id]: null }));
    try {
      const { ok, status, data } = await apiFetch({
        action: 'draft-quote',
        candidateId: id,
        caption: captions[id] || '',
        quotedUrl: candidate.url,
      });
      if (!ok) {
        if (status === 422) {
          setRowNotice((s) => ({
            ...s,
            [id]: {
              kind: 'blocked',
              text: data?.error || 'The guard blocked this draft.',
              concerns: Array.isArray(data?.verdict?.concerns) ? data.verdict.concerns : [],
            },
          }));
        } else {
          setRowNotice((s) => ({ ...s, [id]: { kind: 'error', text: data?.error || data?.hint || `HTTP ${status}` } }));
        }
        return;
      }
      const postId = data?.post?.id;
      setRowNotice((s) => ({
        ...s,
        [id]: {
          kind: 'ok',
          text: `Saved as draft${postId ? ` (${postId})` : ''}.${data?.truncated ? ' Caption was shortened to fit.' : ''}`,
        },
      }));
    } catch (err) {
      setRowNotice((s) => ({ ...s, [id]: { kind: 'error', text: err.message || 'Could not draft quote.' } }));
    } finally {
      setRowBusy((s) => ({ ...s, [id]: null }));
    }
  }

  async function dismissCandidate(candidate) {
    const id = candidate.id;
    if (rowBusy[id]) return;
    setRowBusy((s) => ({ ...s, [id]: 'dismiss' }));
    setRowNotice((s) => ({ ...s, [id]: null }));
    try {
      const { ok, status, data } = await apiFetch({ action: 'dismiss', candidateId: id });
      if (!ok) {
        setRowNotice((s) => ({ ...s, [id]: { kind: 'error', text: data?.error || `HTTP ${status}` } }));
        return;
      }
      setDismissedLocal((s) => new Set(s).add(id));
    } catch (err) {
      setRowNotice((s) => ({ ...s, [id]: { kind: 'error', text: err.message || 'Could not dismiss.' } }));
    } finally {
      setRowBusy((s) => ({ ...s, [id]: null }));
    }
  }

  return (
    <div id="x-calendar-card">
      {/* ── Scan freshness / status ────────────────────────────────────── */}
      <section id="x-calendar-scan-status-row" className="xc-panel">
        <div className="xc-head">
          <span className="xc-kicker"><Quote size={13} /> Quote-react targets{clientName ? ` · ${clientName}` : ''}</span>
          {quoteTargets?.generatedAt ? <small><Clock size={11} /> {formatRelative(quoteTargets.generatedAt)}</small> : null}
        </div>
        {loading ? (
          <div className="xc-empty">Loading the last stored scan…</div>
        ) : (
          <>
            {quoteTargets ? (
              <p className="xc-stats">
                <span>{fmtInt(quoteTargets.succeeded)}/{fmtInt(quoteTargets.scanned)} accounts scanned</span>
                <span>{fmtInt(quoteTargets.pooled)} posts pooled</span>
              </p>
            ) : null}
            {isStale ? (
              <div id="x-calendar-scan-stale-notice" className="xc-notice-box">
                <p className="xc-notice-box-head"><AlertTriangle size={13} /> {quoteTargets ? 'This scan is over 12h old.' : 'No scan on record yet.'}</p>
                <p className="xc-notice-box-body">
                  The scan reads live x.com via an authenticated local session, so it can only run on the operator&apos;s
                  machine — there is nothing for this card to trigger. Run it locally, then reload this card:
                </p>
                <pre id="x-calendar-scan-command-block" className="xc-command"><code>node scripts/x-content/scan-quote-targets.mjs --client {clientIdForCommand} --write</code></pre>
              </div>
            ) : null}
          </>
        )}
        {notice ? <p className={`xc-notice xc-notice-${notice.kind}`}>{notice.text}</p> : null}
      </section>

      {/* ── Benchmark gap report ───────────────────────────────────────── */}
      {!loading ? (
        <section id="x-calendar-gap-report-panel" className="xc-panel">
          <div className="xc-head">
            <span className="xc-kicker"><BarChart3 size={13} /> Against {gapReport?.benchmarkHandle ? `@${gapReport.benchmarkHandle}` : 'benchmark'}</span>
            {!hideRefresh ? (
              <button type="button" id="x-calendar-recompute-button" className="xc-ghost" onClick={refreshAnalysis} disabled={analysisBusy}>
                {analysisBusy
                  ? <span className="comet-spinner" style={{ width: 13, height: 13, ['--comet-ring']: '2px' }} aria-hidden="true" />
                  : <RefreshCw size={13} />}
                Recompute
              </button>
            ) : null}
          </div>

          {gapReport ? (
            <>
              <div id="x-calendar-projection-row" className="xc-projection">
                <span><strong>{gapReport.projection?.volumeRatio ?? '—'}×</strong> their authored output</span>
                <span><strong>{gapReport.projection?.mixMultiplier ?? '—'}×</strong> per post if the mix moves</span>
                <span className="xc-tier">Tier {gapReport.tier?.tier ?? '—'} · {gapReport.tier?.authoredPerDay ?? '—'}/day</span>
              </div>

              <ol id="x-calendar-gap-list" className="xc-gap-list">
                {(Array.isArray(gapReport.gaps) ? gapReport.gaps : []).slice(0, 6).map((gap) => (
                  <li id={`x-calendar-gap-${String(gap.id).replace(/[^a-z0-9]+/gi, '-')}`} key={gap.id} className="xc-gap">
                    <div className="xc-gap-head">
                      <span className={`xc-chip xc-dir-${gap.direction || gap.unit}`}>{gap.direction || UNIT_LABEL[gap.unit] || gap.unit}</span>
                      {impactLabel(gap) ? <span className="xc-gap-impact">{impactLabel(gap)}</span> : null}
                      <span className={`xc-gap-conf xc-conf-${gap.confidence}`}>{gap.confidence}</span>
                    </div>
                    <p className="xc-gap-text">{gap.headline}</p>
                  </li>
                ))}
              </ol>

              {Array.isArray(gapReport.warnings) && gapReport.warnings.length ? (
                <details id="x-calendar-gap-warnings" className="xc-warnings">
                  <summary>{gapReport.warnings.length} caveat{gapReport.warnings.length === 1 ? '' : 's'} on this comparison</summary>
                  <ul>{gapReport.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </details>
              ) : null}

              <p className="xc-foot">
                {analysisComputedAt ? `Computed ${formatRelative(new Date(analysisComputedAt).toISOString())}` : 'Never computed'}
                {gapReport.corpora?.own?.lastDate ? ` · corpus through ${gapReport.corpora.own.lastDate}` : ''}
              </p>
            </>
          ) : (
            <div id="x-calendar-gap-empty" className="xc-empty">
              <p>No comparison yet. Ingest the account and its benchmark, then recompute:</p>
              <pre className="xc-command"><code>node scripts/x-content/ingest-corpus.mjs --handle &lt;account&gt; --write</code></pre>
            </div>
          )}
          {analysisNotice ? <p className={`xc-notice xc-notice-${analysisNotice.kind}`}>{analysisNotice.text}</p> : null}
        </section>
      ) : null}

      {/* ── Today's slots ──────────────────────────────────────────────── */}
      {!loading && dayPlan && Array.isArray(dayPlan.slots) && dayPlan.slots.length ? (
        <section id="x-calendar-day-plan-section" className="xc-panel">
          <div className="xc-head">
            <span className="xc-kicker"><CalendarDays size={13} /> Day {dayPlan.day ?? 1} plan{dayPlan.theme ? ` · ${dayPlan.theme}` : ''}</span>
            <small>
              {dayPlan.coverage ? `${dayPlan.coverage.quoteSlotsFilled}/${dayPlan.coverage.quoteSlots} quote slots filled · ` : ''}
              {calendarSource === 'generated' ? 'generated' : 'standing calendar'}
            </small>
          </div>
          <ol id="x-calendar-day-slot-list" className="xc-slots">
            {dayPlan.slots.map((slot, i) => (
              <li
                id={`x-calendar-day-slot-${slot.slot || i}`}
                key={`${slot.slot || i}-${slot.timeCT || i}`}
                className={`xc-slot xc-slot-${slot.status || 'planned'}`}
              >
                <span className="xc-slot-time">{slot.timeCT || '—'}</span>
                <span className="xc-slot-type">{slot.type}</span>
                <span className="xc-slot-body">
                  {slot.candidate
                    ? <>@{slot.candidate.author} · {Number(slot.candidate.score ?? 0).toFixed(2)}{slot.copy ? <em className="xc-slot-copy"> “{slot.copy}”</em> : null}</>
                    : (slot.copy || slot.brief || slot.fillReason || '—')}
                </span>
                <span className="xc-slot-status">{slot.status || 'planned'}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {/* ── Candidates ─────────────────────────────────────────────────── */}
      {!loading ? (
        candidates.length ? (
          <section id="x-calendar-candidate-list" className="xc-stack">
            {candidates.map((c) => {
              const caption = captions[c.id] || '';
              const composedTotal = caption.length + 2 + (c.url ? c.url.length : 0);
              const overLimit = composedTotal > MAX_CAPTION_TOTAL;
              const busy = rowBusy[c.id] || '';
              const result = rowNotice[c.id];
              const media = mediaLabel(c);
              return (
                <article id={`x-calendar-candidate-${c.id}`} key={c.id} className="xc-card">
                  <div id={`x-calendar-candidate-meta-${c.id}`} className="xc-cand-head">
                    <span className="xc-cand-author">
                      @{c.author || 'unknown'}{c.authorName ? <span className="xc-cand-author-name"> · {c.authorName}</span> : null}
                    </span>
                    <span className="xc-cand-score" title="quote-target score">{Number(c.score ?? 0).toFixed(2)}</span>
                  </div>
                  <p className="xc-cand-text">{c.text}</p>
                  <p className="xc-cand-link"><a href={c.url} target="_blank" rel="noopener noreferrer">↗ post</a></p>
                  <div className="xc-cand-facts">
                    <span>{Number.isFinite(c.ageHours) ? `${c.ageHours}h old` : '—'}</span>
                    <span>{Number.isFinite(c.velocity) ? `${c.velocity}/h velocity` : '—'}</span>
                    <span>{fmtInt(c.engagement)} engagement</span>
                  </div>
                  <div className="xc-chips">
                    {c.vein ? <span className="xc-chip">{c.vein}</span> : null}
                    <span className="xc-chip">{media}</span>
                    {c.windowOpen === false ? <span className="xc-chip xc-chip-muted">window closed</span> : null}
                  </div>
                  {Array.isArray(c.reasons) && c.reasons.length ? (
                    <p className="xc-reasons">{c.reasons.join(' · ')}</p>
                  ) : null}

                  <div id={`x-calendar-caption-row-${c.id}`} className="xc-caption-row">
                    <label htmlFor={`x-calendar-caption-${c.id}`}>Caption</label>
                    <textarea
                      id={`x-calendar-caption-${c.id}`}
                      value={caption}
                      onChange={(e) => setCaption(c.id, e.target.value)}
                      placeholder="six words, lowercase — the post does the work"
                      rows={2}
                    />
                    <span id={`x-calendar-char-count-${c.id}`} className={`xc-char-count ${overLimit ? 'xc-char-over' : ''}`.trim()}>
                      {caption.length} chars · quote total {composedTotal}/{MAX_CAPTION_TOTAL}
                    </span>
                  </div>

                  <div id={`x-calendar-candidate-actions-${c.id}`} className="xc-actions">
                    <button type="button" className="xc-primary" onClick={() => draftQuote(c)} disabled={!!busy || overLimit}>
                      {busy === 'draft' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <PenSquare size={14} />}
                      Draft quote-react
                    </button>
                    <button type="button" onClick={() => dismissCandidate(c)} disabled={!!busy}>
                      {busy === 'dismiss' ? <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" /> : <Trash2 size={14} />}
                      Dismiss
                    </button>
                  </div>

                  {result ? (
                    <div id={`x-calendar-candidate-result-${c.id}`} className={`xc-result xc-result-${result.kind}`}>
                      <p>{result.text}</p>
                      {result.kind === 'blocked' && result.concerns.length ? (
                        <ul>{result.concerns.map((concern, i) => <li key={i}>{concern}</li>)}</ul>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : (
          <div id="x-calendar-empty-state" className="xc-empty">
            {!quoteTargets
              ? 'The local scan hasn’t been run yet, so there’s nothing to show. Run the command above, then reload this card.'
              : 'The last local scan found nothing worth quoting in its window — not a data problem, just a quiet window. Re-run the scan later.'}
          </div>
        )
      ) : null}

      <style jsx global>{`
        #x-calendar-card { margin-top: 18px; display: grid; gap: 14px; }
        #x-calendar-card .xc-panel { border: 1px solid var(--t-border-subtle); background: color-mix(in srgb, var(--t-surface) 72%, transparent); border-radius: 16px; padding: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
        #x-calendar-card .xc-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
        #x-calendar-card .xc-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: color-mix(in srgb, var(--t-text) 62%, transparent); }
        #x-calendar-card .xc-head small { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: color-mix(in srgb, var(--t-text) 50%, transparent); }
        #x-calendar-card .xc-stats { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 10px; font-family: var(--font-mono); font-size: 11px; color: color-mix(in srgb, var(--t-text) 60%, transparent); }
        #x-calendar-card .xc-empty { border: 1px dashed color-mix(in srgb, var(--t-text) 16%, transparent); border-radius: 12px; background: color-mix(in srgb, var(--t-surface) 40%, transparent); padding: 20px 16px; text-align: center; font-size: 13px; line-height: 1.5; color: color-mix(in srgb, var(--t-text) 55%, transparent); }
        #x-calendar-card .xc-notice-box { border: 1px solid var(--t-warning-border); border-radius: 12px; background: var(--t-warning-bg); padding: 12px 14px; }
        #x-calendar-card .xc-notice-box-head { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font-size: 12px; font-weight: 700; color: var(--t-warning); }
        #x-calendar-card .xc-notice-box-body { margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: color-mix(in srgb, var(--t-text) 68%, transparent); }
        #x-calendar-card .xc-command { margin: 0; padding: 10px 12px; border-radius: 8px; background: color-mix(in srgb, var(--t-text) 6%, transparent); overflow-x: auto; }
        #x-calendar-card .xc-command code { font-family: var(--font-mono); font-size: 11.5px; color: var(--t-text); white-space: pre; user-select: all; }
        #x-calendar-card .xc-notice { margin: 10px 0 0; font-size: 12px; line-height: 1.4; }
        #x-calendar-card .xc-notice-error { color: var(--t-danger); }
        #x-calendar-card .xc-notice-ok { color: var(--t-success); }

        #x-calendar-card .xc-ghost { min-height: 30px; padding: 0 12px; font-size: 11px; }
        #x-calendar-card .xc-projection { display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 12px; font-size: 12px; color: color-mix(in srgb, var(--t-text) 70%, transparent); }
        #x-calendar-card .xc-projection strong { font-family: var(--font-mono); font-size: 13px; color: var(--t-text); }
        #x-calendar-card .xc-tier { margin-left: auto; font-family: var(--font-mono); font-size: 11px; color: color-mix(in srgb, var(--t-text) 55%, transparent); }
        #x-calendar-card .xc-gap-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        #x-calendar-card .xc-gap { border: 1px solid color-mix(in srgb, var(--t-text) 10%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--t-surface) 60%, transparent); padding: 9px 11px; }
        #x-calendar-card .xc-gap-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; flex-wrap: wrap; }
        #x-calendar-card .xc-gap-impact { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--t-text); }
        #x-calendar-card .xc-gap-conf { margin-left: auto; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: color-mix(in srgb, var(--t-text) 45%, transparent); }
        #x-calendar-card .xc-conf-low { color: var(--t-warning); }
        #x-calendar-card .xc-gap-text { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--t-text); }
        /* Direction is the recommendation, so it carries the colour: act on
           increase/decrease, leave hold alone, look into investigate. */
        #x-calendar-card .xc-dir-increase { background: var(--t-success-bg); border-color: var(--t-success-border); color: var(--t-success); }
        #x-calendar-card .xc-dir-decrease { background: var(--t-danger-bg); border-color: var(--t-danger-border); color: var(--t-danger); }
        #x-calendar-card .xc-dir-hold { background: color-mix(in srgb, var(--t-text) 5%, transparent); color: color-mix(in srgb, var(--t-text) 60%, transparent); }
        #x-calendar-card .xc-dir-investigate { background: var(--t-warning-bg); border-color: var(--t-warning-border); color: var(--t-warning); }
        #x-calendar-card .xc-warnings { margin-top: 10px; font-size: 11.5px; color: color-mix(in srgb, var(--t-text) 60%, transparent); }
        #x-calendar-card .xc-warnings summary { cursor: pointer; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.04em; }
        #x-calendar-card .xc-warnings ul { margin: 8px 0 0; padding-left: 16px; display: grid; gap: 6px; line-height: 1.5; }
        #x-calendar-card .xc-foot { margin: 10px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: color-mix(in srgb, var(--t-text) 45%, transparent); }

        #x-calendar-card .xc-slots { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        #x-calendar-card .xc-slot { display: grid; grid-template-columns: 52px 130px 1fr auto; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--t-border-faint); background: color-mix(in srgb, var(--t-surface) 55%, transparent); font-size: 12px; }
        #x-calendar-card .xc-slot-ready { border-color: color-mix(in srgb, var(--t-success-solid) 32%, transparent); background: var(--t-success-bg); }
        #x-calendar-card .xc-slot-time { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: var(--t-text); }
        #x-calendar-card .xc-slot-type { font-family: var(--font-mono); font-size: 11px; color: color-mix(in srgb, var(--t-text) 60%, transparent); }
        #x-calendar-card .xc-slot-body { color: color-mix(in srgb, var(--t-text) 78%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #x-calendar-card .xc-slot-copy { color: color-mix(in srgb, var(--t-text) 55%, transparent); font-style: italic; }
        #x-calendar-card .xc-slot-status { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: color-mix(in srgb, var(--t-text) 45%, transparent); }

        #x-calendar-card .xc-stack { display: grid; gap: 12px; }
        #x-calendar-card .xc-card { border: 1px solid var(--t-border-subtle); background: var(--t-glass-strong); border-radius: 14px; padding: 14px 16px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); }
        #x-calendar-card .xc-cand-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
        #x-calendar-card .xc-cand-author { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--t-text); }
        #x-calendar-card .xc-cand-author-name { font-weight: 500; color: color-mix(in srgb, var(--t-text) 55%, transparent); }
        #x-calendar-card .xc-cand-score { font-family: var(--font-mono); font-size: 12px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: color-mix(in srgb, var(--t-text) 7%, transparent); color: var(--t-text); }
        #x-calendar-card .xc-cand-text { margin: 0 0 6px; font-size: 13.5px; line-height: 1.5; color: var(--t-text); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        #x-calendar-card .xc-cand-link { margin: 0 0 8px; }
        #x-calendar-card .xc-cand-link a { font-family: var(--font-mono); font-size: 11.5px; color: color-mix(in srgb, var(--t-text) 60%, transparent); text-decoration: none; }
        #x-calendar-card .xc-cand-link a:hover { color: var(--t-text); text-decoration: underline; }
        #x-calendar-card .xc-cand-facts { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 8px; font-family: var(--font-mono); font-size: 11px; color: color-mix(in srgb, var(--t-text) 60%, transparent); }
        #x-calendar-card .xc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
        #x-calendar-card .xc-chip { display: inline-flex; align-items: center; min-height: 24px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; padding: 0 10px; border-radius: 999px; background: color-mix(in srgb, var(--t-text) 6%, transparent); border: 1px solid var(--t-border-faint); color: var(--t-text); text-transform: capitalize; }
        #x-calendar-card .xc-chip-muted { background: var(--t-glass-soft); border-color: color-mix(in srgb, var(--t-text) 14%, transparent); color: color-mix(in srgb, var(--t-text) 50%, transparent); }
        #x-calendar-card .xc-reasons { margin: 0 0 10px; font-size: 11px; line-height: 1.45; color: color-mix(in srgb, var(--t-text) 50%, transparent); }

        #x-calendar-card .xc-caption-row { display: grid; gap: 6px; margin-bottom: 10px; }
        #x-calendar-card .xc-caption-row label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: color-mix(in srgb, var(--t-text) 55%, transparent); }
        #x-calendar-card textarea { width: 100%; resize: vertical; min-height: 56px; border: 1px solid color-mix(in srgb, var(--t-text) 14%, transparent); border-radius: 10px; padding: 10px 12px; background: color-mix(in srgb, var(--t-surface) 98%, transparent); color: var(--t-text); font: inherit; line-height: 1.5; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); }
        #x-calendar-card textarea:focus { border-color: color-mix(in srgb, var(--t-text) 36%, transparent); box-shadow: 0 0 0 3px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.65); }
        #x-calendar-card .xc-char-count { font-family: var(--font-mono); font-size: 10px; color: color-mix(in srgb, var(--t-text) 50%, transparent); justify-self: end; }
        #x-calendar-card .xc-char-over { color: var(--t-danger); font-weight: 700; }

        #x-calendar-card .xc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        #x-calendar-card button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--t-border-subtle); border-radius: 999px; background: color-mix(in srgb, var(--t-surface) 60%, transparent); color: var(--t-text); min-height: 38px; padding: 0 15px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: background 160ms ease, box-shadow 160ms ease, border-color 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
        #x-calendar-card button:hover:not(:disabled) { background: color-mix(in srgb, var(--t-surface) 95%, transparent); border-color: color-mix(in srgb, var(--t-text) 20%, transparent); box-shadow: 0 4px 14px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); transform: translateY(-1px); }
        #x-calendar-card button:active:not(:disabled) { transform: translateY(0); transition-duration: 80ms; }
        #x-calendar-card button:disabled { opacity: 0.48; cursor: not-allowed; }
        #x-calendar-card button:focus-visible { outline: 2px solid color-mix(in srgb, var(--t-text) 55%, transparent); outline-offset: 2px; }
        #x-calendar-card textarea:focus-visible { outline: 2px solid color-mix(in srgb, var(--t-text) 40%, transparent); outline-offset: 1px; }
        #x-calendar-card .xc-primary { background: var(--t-text); color: var(--t-surface); border-color: var(--t-text); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
        #x-calendar-card .xc-primary:hover:not(:disabled) { background: var(--t-text); border-color: var(--t-text); box-shadow: 0 4px 14px rgba(42,36,32,0.2), inset 0 1px 0 rgba(255,255,255,0.12); }

        #x-calendar-card .xc-result { margin-top: 10px; padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 1.45; }
        #x-calendar-card .xc-result p { margin: 0; }
        #x-calendar-card .xc-result ul { margin: 6px 0 0; padding-left: 16px; }
        #x-calendar-card .xc-result-ok { background: var(--t-success-bg); color: var(--t-success); }
        #x-calendar-card .xc-result-error { background: var(--t-danger-bg); color: var(--t-danger); }
        #x-calendar-card .xc-result-blocked { background: var(--t-danger-bg); color: var(--t-danger); }

        @media (max-width: 480px) {
          #x-calendar-card .xc-panel, #x-calendar-card .xc-card { padding: 12px; border-radius: 12px; }
          #x-calendar-card .xc-actions button { flex: 1 1 auto; }
          /* The four-column slot row cannot hold its shape at phone width —
             stack time+type on one line and let the body wrap under it. */
          #x-calendar-card .xc-slot { grid-template-columns: 52px 1fr; grid-template-areas: 'time type' 'body body' 'status status'; row-gap: 4px; }
          #x-calendar-card .xc-slot-time { grid-area: time; }
          #x-calendar-card .xc-slot-type { grid-area: type; }
          #x-calendar-card .xc-slot-body { grid-area: body; white-space: normal; }
          #x-calendar-card .xc-slot-status { grid-area: status; }
          #x-calendar-card .xc-tier { margin-left: 0; }
        }
      `}</style>
    </div>
  );
}
