'use client';

import React, { useCallback, useEffect, useState } from 'react';

// Admin · Operating Cost — live per-run / per-client expense breakdown.
// Reads /api/admin/cost-report (brief_runs + usage_events, live each open) and
// renders an expandable table: client → run → stage line items, plus a fixed /
// subscription section, provider rollup, the Anthropic org cost block (dormant
// until an Admin key + team org exist), and deep links to the Console.
// Read-only: this card never spends or mutates.
//
// STYLING: renders inside `.vrk-scope` (the shared modal panel scope used by the
// Email Digest card) and uses its structural classes — section / section-head /
// index / label / segmented. Line items follow the dashboard-modal style guide's
// data-table / metric-card / stat-row treatment, replicated in the scoped
// <style> below on the --vrk-* tokens (warm-paper theme) so they stay consistent
// with the rest of the modal system. See public/docs/dashboard-modal-component-style-guide.html.

async function authFetch(user, path, options = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const usd = (n, dp = 2) => `$${(Number(n) || 0).toFixed(dp)}`;
const tok = (n) => (Number(n) || 0).toLocaleString();
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const STATUS_LABEL = { tracked: 'Tracked', estimate: 'Estimate', 'not-instrumented': 'Not instrumented' };
// Run source → short label. Legacy runs (pre-tagging) recorded a bare 'cron' for
// both scheduled + manual, so show 'cron?' to flag the ambiguity honestly.
const SOURCE_LABEL = { 'cron-scheduled': 'cron', 'manual-admin': 'manual', cron: 'cron?' };

// Scoped styles — replicate the style guide's line-item components (.data-table,
// .metric-card, .stat-row, .list-card, .chip) on the --vrk-* tokens, with hex
// fallbacks so it renders correctly even outside .vrk-scope.
const OC_CSS = `
#operating-cost-view-shell {
  --oc-ink: var(--vrk-ink, #2a2420);
  --oc-soft: var(--vrk-ink-soft, rgba(42,36,32,0.72));
  --oc-muted: var(--vrk-ink-muted, rgba(42,36,32,0.52));
  --oc-line: var(--vrk-line, rgba(42,36,32,0.12));
  --oc-line-soft: rgba(42,36,32,0.14);
  --oc-surface: var(--vrk-surface-strong, rgba(255,255,255,0.78));
  --oc-radius: var(--vrk-radius, 8px);
  --oc-mono: var(--vrk-mono, "Space Mono", ui-monospace, monospace);
  --oc-ui: var(--vrk-ui, "Space Grotesk", system-ui, sans-serif);
  --oc-danger: var(--vrk-danger, #9f1f17);
  color: var(--oc-ink);
}
#operating-cost-view-shell .oc-metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr)); gap: 10px; }
#operating-cost-view-shell .oc-metric { display: grid; gap: 5px; min-height: 62px; padding: 12px; border: 1px solid var(--oc-line); border-radius: var(--oc-radius); background: rgba(255,255,255,0.78); }
#operating-cost-view-shell .oc-metric-value { font: 700 21px/1 var(--oc-mono); font-variant-numeric: tabular-nums; color: var(--oc-ink); }
#operating-cost-view-shell .oc-metric-label { font: 700 10px/1.2 var(--oc-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--oc-muted); }
#operating-cost-view-shell .oc-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
#operating-cost-view-shell .oc-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid var(--oc-line); border-radius: 999px; background: rgba(255,255,255,0.5); font: 600 11px/1.5 var(--oc-mono); color: var(--oc-soft); }
#operating-cost-view-shell .oc-chip.is-warn { color: var(--oc-danger); border-color: rgba(159,31,23,0.4); }
#operating-cost-view-shell .oc-chip.oc-status-tracked { color: var(--vrk-success, #285f3b); border-color: rgba(40,95,59,0.4); }
#operating-cost-view-shell .oc-chip.oc-status-estimate { color: #8a6d1f; border-color: rgba(138,109,31,0.45); }
#operating-cost-view-shell .oc-chip.oc-status-not-instrumented { color: var(--oc-muted); }
#operating-cost-view-shell .oc-btn { padding: 8px 13px; border: 1px solid var(--oc-line); border-radius: var(--oc-radius); background: rgba(255,255,255,0.6); color: var(--oc-ink); font: 700 12px/1 var(--oc-mono); cursor: pointer; transition: background 140ms ease; }
#operating-cost-view-shell .oc-btn:hover:not(:disabled) { background: #fff; }
#operating-cost-view-shell .oc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
#operating-cost-view-shell .oc-link { padding: 7px 12px; border: 1px solid var(--oc-line); border-radius: var(--oc-radius); background: rgba(255,255,255,0.6); color: var(--oc-ink); font: 700 12px/1 var(--oc-mono); text-decoration: none; display: inline-block; transition: background 140ms ease; }
#operating-cost-view-shell .oc-link:hover { background: #fff; }
#operating-cost-view-shell details.oc-card { border: 1px solid var(--oc-line); border-radius: var(--oc-radius); background: var(--oc-surface); overflow: hidden; }
#operating-cost-view-shell details.oc-card + details.oc-card { margin-top: 8px; }
#operating-cost-view-shell .oc-card > summary, #operating-cost-view-shell .oc-run > summary { list-style: none; cursor: pointer; }
#operating-cost-view-shell .oc-card > summary::-webkit-details-marker, #operating-cost-view-shell .oc-run > summary::-webkit-details-marker { display: none; }
#operating-cost-view-shell .oc-card > summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; }
#operating-cost-view-shell .oc-card[open] > summary { border-bottom: 1px solid var(--oc-line-soft); background: rgba(255,255,255,0.4); }
#operating-cost-view-shell .oc-card > summary:hover { background: rgba(42,36,32,0.03); }
#operating-cost-view-shell .oc-client-name { font: 700 14px/1.3 var(--oc-ui); color: var(--oc-ink); display: flex; align-items: center; gap: 8px; min-width: 0; }
#operating-cost-view-shell .oc-client-name::before { content: "▸"; color: var(--oc-muted); font-size: 10px; transition: transform 160ms ease; }
#operating-cost-view-shell .oc-card[open] > summary .oc-client-name::before { transform: rotate(90deg); }
#operating-cost-view-shell .oc-meta { font: 600 11px/1.4 var(--oc-mono); color: var(--oc-muted); }
#operating-cost-view-shell .oc-amt { font: 700 14px/1 var(--oc-mono); font-variant-numeric: tabular-nums; color: var(--oc-ink); }
#operating-cost-view-shell details.oc-run { border-top: 1px solid var(--oc-line-soft); }
#operating-cost-view-shell .oc-run > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; }
#operating-cost-view-shell .oc-run > summary:hover { background: rgba(42,36,32,0.03); }
#operating-cost-view-shell .oc-run-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
#operating-cost-view-shell .oc-table { width: 100%; border-collapse: collapse; }
#operating-cost-view-shell .oc-table th { text-align: left; padding: 7px 14px; font: 700 10px/1 var(--oc-mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--oc-muted); background: rgba(255,255,255,0.36); border-top: 1px solid var(--oc-line-soft); }
#operating-cost-view-shell .oc-table td { padding: 7px 14px; border-top: 1px solid var(--oc-line-soft); color: var(--oc-soft); font-size: 13px; vertical-align: top; }
#operating-cost-view-shell .oc-table tbody tr:hover td { background: rgba(42,36,32,0.02); color: var(--oc-ink); }
#operating-cost-view-shell .oc-table .r { text-align: right; font-variant-numeric: tabular-nums; }
#operating-cost-view-shell .oc-table .mono { font-family: var(--oc-mono); font-size: 11px; color: var(--oc-ink); }
#operating-cost-view-shell .oc-table .strong { color: var(--oc-ink); font-weight: 600; }
#operating-cost-view-shell .oc-sub { font: 700 10px/1.2 var(--oc-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--oc-muted); padding: 9px 14px 3px; }
#operating-cost-view-shell .oc-note { font: 500 11px/1.5 var(--oc-mono); color: var(--oc-muted); }
#operating-cost-view-shell .oc-err { padding: 10px 12px; border: 1px solid var(--oc-danger); border-radius: var(--oc-radius); background: rgba(159,31,23,0.06); color: var(--oc-danger); font-size: 12px; }
#operating-cost-view-shell .oc-headline { font: 700 20px/1 var(--oc-mono); font-variant-numeric: tabular-nums; color: var(--oc-ink); }
@media (max-width: 560px) {
  #operating-cost-view-shell .oc-metric-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
`;

function StageTable({ stages }) {
  if (!stages?.length) return <div className="oc-note" style={{ padding: '8px 14px' }}>No per-stage breakdown (cost stored as a single number).</div>;
  return (
    <table className="oc-table">
      <thead><tr>
        <th>Stage</th><th>Model</th>
        <th className="r">In tok</th><th className="r">Out tok</th><th className="r">USD</th>
      </tr></thead>
      <tbody>
        {stages.map((s, i) => (
          <tr key={`${s.stage}-${i}`}>
            <td className="strong">{s.stage}</td>
            <td className="mono">{s.model}</td>
            <td className="r">{tok(s.inTok)}</td>
            <td className="r">{tok(s.outTok)}</td>
            <td className="r strong">{usd(s.usd, 4)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClientBlock({ c }) {
  return (
    <details className="oc-card">
      <summary>
        <span className="oc-client-name">{c.name}</span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span className="oc-meta">{c.runs.length} run{c.runs.length === 1 ? '' : 's'} · runs {usd(c.runUsd)} · mods {usd(c.moduleUsd)}{c.estUsd > 0 ? ` · est ${usd(c.estUsd)}` : ''}</span>
          <span className="oc-amt">{usd(c.totalUsd)}</span>
        </span>
      </summary>

      {c.runs.map((r) => (
        <details className="oc-run" key={r.runId}>
          <summary>
            <span className="oc-run-left">
              <span className="oc-chip">{r.trigger}</span>
              {r.source ? <span className="oc-chip" title={r.requestedByUid ? `uid ${r.requestedByUid}` : 'no interactive user'}>{SOURCE_LABEL[r.source] || r.source}</span> : null}
              <span className="oc-meta">{fmtDate(r.date)}</span>
              {r.status !== 'succeeded' ? <span className="oc-chip is-warn">{r.status}</span> : null}
            </span>
            <span className="oc-amt" style={{ fontSize: 13 }}>{usd(r.costUsd, 4)}</span>
          </summary>
          <StageTable stages={r.stages} />
        </details>
      ))}

      {c.modules?.length ? (
        <div style={{ borderTop: '1px solid var(--oc-line-soft)' }}>
          <div className="oc-sub">Per-call · usage_events</div>
          <table className="oc-table"><tbody>
            {c.modules.map((m, i) => (
              <tr key={i}>
                <td className="strong">{m.module}</td>
                <td className="mono">{m.provider}/{m.model}</td>
                <td className="r">{m.events}×</td>
                <td className="r strong">{usd(m.usd, 4)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      ) : null}
    </details>
  );
}

export function AdminOperatingCostView({ user }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (d, force = false) => {
    setLoading(true); setError('');
    try {
      const res = await authFetch(user, `/api/admin/cost-report?days=${d}${force ? '&refresh=1' : ''}`);
      setData(res);
    } catch (e) {
      setError(e.message || 'Failed to load cost report.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(days); }, [days, load]);

  const t = data?.totals || {};
  const a = data?.anthropic;
  const anthropicBreakdown = a?.byDescription || a?.byModel || [];
  const sc = data?.scrapeCreators;

  return (
    <div className="tile-detail-tab-content">
      <div className="vrk-scope" id="operating-cost-view-shell" style={{ display: 'grid', gap: 14, padding: 16, alignContent: 'start', overflowY: 'auto' }}>
        <style>{OC_CSS}</style>

        {/* ── Header: title · window · refresh · totals · providers ─────────── */}
        <section className="section">
          <div className="section-head">
            <span className="index">OC</span>
            <div>
              <h3>Operating Cost</h3>
              <p>Live per-run and per-client spend from brief_runs + usage_events.</p>
            </div>
            <button type="button" className="oc-btn" onClick={() => load(days)} disabled={loading}>{loading ? '…' : '⟳'}</button>
          </div>

          <div className="segmented" role="tablist" aria-label="Window">
            {[1, 7, 30, 90].map((d) => (
              <button key={d} type="button" className={days === d ? 'is-active' : ''} onClick={() => setDays(d)}>{d === 1 ? 'DAILY' : `${d}D`}</button>
            ))}
          </div>

          {error ? <div className="oc-err">{error}</div> : null}

          {data ? (
            <>
              <div className="oc-metric-grid">
                <div className="oc-metric"><span className="oc-metric-value">{usd(t.trackedUsd)}</span><span className="oc-metric-label">Tracked {data.windowDays === 1 ? '24h' : `${data.windowDays}d`}</span></div>
                <div className="oc-metric"><span className="oc-metric-value">{usd(t.runUsd)}</span><span className="oc-metric-label">Runs</span></div>
                <div className="oc-metric"><span className="oc-metric-value">{usd(t.moduleUsd)}</span><span className="oc-metric-label">Per-call</span></div>
                <div className="oc-metric"><span className="oc-metric-value">{usd(t.estimatedUsd)}</span><span className="oc-metric-label">Est · infra</span></div>
                <div className="oc-metric"><span className="oc-metric-value">{usd(t.fixedMonthlyUsd)}</span><span className="oc-metric-label">Fixed /mo</span></div>
              </div>
              {data.byProvider?.length ? (
                <div className="oc-chip-row">
                  {data.byProvider.map((p) => <span key={p.provider} className="oc-chip">{p.provider} · {usd(p.usd, 4)}</span>)}
                </div>
              ) : null}
              <p style={{ margin: 0 }} className="oc-note">{data.note}</p>
            </>
          ) : (!error && <p className="oc-note" style={{ margin: 0 }}>Loading…</p>)}
        </section>

        {data ? (
          <>
            {/* ── Anthropic account (org-level ground truth) ─────────────────── */}
            <section className="section">
              <div className="section-head">
                <span className="index">AN</span>
                <div>
                  <h3>Anthropic account</h3>
                  <p>Org-level cost — includes the web_search surcharge our ledgers can&apos;t see.</p>
                </div>
              </div>
              {a?.available ? (
                <div>
                  <span className="oc-headline">{usd(a.totalUsd)}</span> <span className="oc-note">last {data.windowDays}d</span>
                  <div className="oc-chip-row" style={{ marginTop: 8 }}>
                    {anthropicBreakdown.map((m) => {
                      const label = m.description || m.model || 'unknown';
                      return <span key={label} className="oc-chip">{label} · {usd(m.usd, 4)}</span>;
                    })}
                  </div>
                </div>
              ) : (
                <p className="oc-note" style={{ margin: 0 }}>{a?.reason || 'Not connected.'}</p>
              )}
            </section>

            {/* ── ScrapeCreators account (last30days scraper credits) ────────── */}
            <section className="section" id="operating-cost-scrapecreators-section">
              <div className="section-head">
                <span className="index">SC</span>
                <div>
                  <h3>ScrapeCreators account</h3>
                  <p>last30days social-scraper credits — the spend behind Reddit / Instagram / X signals.</p>
                </div>
                {sc?.available ? (
                  <button type="button" className="oc-btn" onClick={() => load(days, true)} disabled={loading} title="Fetch live — bypasses the 1h cache (costs 2 credits)">{loading ? '…' : '↻ live'}</button>
                ) : null}
              </div>
              {sc?.available ? (
                <div>
                  <div className="oc-metric-grid">
                    <div className="oc-metric"><span className="oc-metric-value">{tok(sc.creditsRemaining)}</span><span className="oc-metric-label">Credits left</span></div>
                    <div className="oc-metric"><span className="oc-metric-value">{tok(sc.creditsUsedInWindow)}</span><span className="oc-metric-label">Used {data.windowDays === 1 ? '24h' : `${data.windowDays}d`}</span></div>
                    <div className="oc-metric"><span className="oc-metric-value">{tok(sc.requestsInWindow)}</span><span className="oc-metric-label">Requests</span></div>
                    <div className="oc-metric"><span className="oc-metric-value">{usd(sc.estUsd)}</span><span className="oc-metric-label">Est spend</span></div>
                  </div>
                  <p className="oc-note" style={{ marginTop: 8 }}>
                    {usd(sc.usdPerCredit, 4)}/credit · {sc.cached ? 'cached (≤1h)' : 'live'} · scraper credits only — last30days LLM planning not included
                  </p>
                  {sc.byDay?.length ? (
                    <div className="oc-chip-row" style={{ marginTop: 8 }}>
                      {sc.byDay.slice(0, 14).map((d) => (
                        <span key={d.date} className="oc-chip">{fmtDay(d.date)} · {tok(d.credits)}c</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="oc-note" style={{ margin: 0 }}>{sc?.reason || 'Not connected.'}</p>
              )}
            </section>

            {/* ── By client → run → stage line items ─────────────────────────── */}
            <section className="section">
              <div className="section-head">
                <span className="index">CL</span>
                <div>
                  <h3>By client</h3>
                  <p>Last {data.windowDays} days · expand a client for its runs, expand a run for per-stage tokens and cost.</p>
                </div>
              </div>
              {data.clients?.length
                ? <div>{data.clients.map((c) => <ClientBlock key={c.clientId} c={c} />)}</div>
                : <p className="oc-note" style={{ margin: 0 }}>No tracked spend in this window.</p>}
            </section>

            {/* ── Cost sources · coverage ────────────────────────────────────── */}
            {data.sources?.length ? (
              <section className="section">
                <div className="section-head">
                  <span className="index">SR</span>
                  <div>
                    <h3>Cost sources</h3>
                    <p>Every operating-cost stream and how completely it&apos;s captured. &ldquo;Not instrumented&rdquo; = the spend happens but isn&apos;t logged yet.</p>
                  </div>
                </div>
                <div style={{ border: '1px solid var(--oc-line)', borderRadius: 'var(--oc-radius)', overflow: 'hidden' }}>
                  <table className="oc-table">
                    <thead><tr><th>Source</th><th>Status</th><th className="r">USD</th></tr></thead>
                    <tbody>
                      {data.sources.map((s) => (
                        <tr key={s.key}>
                          <td className="strong">{s.label}<div className="oc-note" style={{ marginTop: 2 }}>{s.note}</div></td>
                          <td><span className={`oc-chip oc-status-${s.status}`}>{STATUS_LABEL[s.status] || s.status}</span></td>
                          <td className="r strong">{s.status === 'not-instrumented' ? '—' : usd(s.usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {/* ── Fixed / subscription ───────────────────────────────────────── */}
            {data.fixed?.length ? (
              <section className="section">
                <div className="section-head">
                  <span className="index">FX</span>
                  <div>
                    <h3>Fixed / subscription</h3>
                    <p>Flat monthly spend — not per-client attributable.</p>
                  </div>
                </div>
                <div style={{ border: '1px solid var(--oc-line)', borderRadius: 'var(--oc-radius)', overflow: 'hidden' }}>
                  <table className="oc-table"><tbody>
                    {data.fixed.map((f, i) => (
                      <tr key={i}>
                        <td className="strong">{f.name}</td>
                        <td>{f.note}</td>
                        <td className="r strong">{usd(f.monthlyUsd)}/mo</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </section>
            ) : null}

            {/* ── Accounts & limits ──────────────────────────────────────────── */}
            <section className="section">
              <div className="section-head">
                <span className="index">$</span>
                <div>
                  <h3>Accounts &amp; limits</h3>
                  <p>Manage spend caps and billing in the Anthropic Console.</p>
                </div>
              </div>
              <div className="oc-chip-row">
                {data.accountLinks?.map((l) => (
                  <a key={l.url} className="oc-link" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>
                ))}
              </div>
              <span className="oc-note">Generated {fmtDate(data.generatedAt)}</span>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default AdminOperatingCostView;
