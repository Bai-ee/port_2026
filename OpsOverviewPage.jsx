'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

const REFRESH_INTERVAL_SECONDS = 30;

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatCurrency(value, digits = 4) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `$${value.toFixed(digits)}`;
}

function formatDurationMs(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${Math.round(value)}ms`;
}

function formatBytes(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function extractCost(run) {
  const usage = run?.providerUsage;
  if (!usage) return null;
  if (typeof usage.estimatedCostUsd === 'number') return usage.estimatedCostUsd;
  if (Array.isArray(usage.stageCosts)) {
    return usage.stageCosts.reduce((sum, stage) => sum + (stage?.estimatedCostUsd || 0), 0);
  }
  return null;
}

function badgeClass(status) {
  return `badge badge-${String(status || 'unknown').toLowerCase()}`;
}

function safeJson(value) {
  return JSON.stringify(value ?? null, null, 2);
}

export default function OpsOverviewPage({ initialData = null, initialError = '' }) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initialData && !initialError);
  const [statusLine, setStatusLine] = useState(
    initialError
      ? `Error: ${initialError}`
      : initialData
        ? `Loaded ${new Date().toLocaleTimeString('en-US', { hour12: false })} · ${initialData.collectionCounts?.briefRuns || 0} runs · ${initialData.collectionCounts?.clients || 0} clients`
        : 'Connecting…'
  );
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_SECONDS);

  const loadAll = useCallback(async () => {
    setStatusLine('Refreshing…');
    setError('');
    try {
      const res = await fetch('/api/ops/overview', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
      const time = new Date().toLocaleTimeString('en-US', { hour12: false });
      setStatusLine(
        `Updated ${time} · ${json.collectionCounts?.briefRuns || 0} runs · ${json.collectionCounts?.clients || 0} clients`
      );
      setCountdown(REFRESH_INTERVAL_SECONDS);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load ops overview.';
      setError(message);
      setStatusLine(`Error: ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialData && !initialError) {
      loadAll();
    }
  }, [loadAll]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          loadAll();
          return REFRESH_INTERVAL_SECONDS;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [loadAll]);

  const statusText = useMemo(() => {
    if (statusLine.startsWith('Error:') || statusLine === 'Refreshing…') return statusLine;
    return `${statusLine} · refresh in ${countdown}s`;
  }, [statusLine, countdown]);

  const clients = data?.clients || [];
  const runs = data?.runs || [];
  const clientConfigs = data?.clientConfigs || [];
  const dashboardStates = data?.dashboardStates || [];
  const browserlessRequests = data?.browserlessRequests || [];
  const latest = data?.latest || {};
  const latestClient = latest.clientRecord || null;
  const latestRun = latest.latestRun || null;

  const clientMap = useMemo(
    () =>
      Object.fromEntries(
        clients.map((client) => [
          client.clientId || client.id,
          client.companyName || client.normalizedHost || client.websiteUrl || client.clientId || client.id,
        ])
      ),
    [clients]
  );

  const configMap = useMemo(
    () => Object.fromEntries(clientConfigs.map((config) => [config.clientId || config.id, config])),
    [clientConfigs]
  );

  const dashboardMap = useMemo(
    () => Object.fromEntries(dashboardStates.map((state) => [state.clientId || state.id, state])),
    [dashboardStates]
  );

  return (
    <div id="ops-overview-page">
      <style>{opsOverviewCss}</style>
      <header id="founders-top-strip">
        <div id="founders-top-strip-inner">
          <Link id="founders-brand" href="/" aria-label="Back to homepage">
            <img src="/img/sig.png" alt="" />
          </Link>
          <span id="nav-sep">·</span>
          <span id="nav-page-label">Ops Dashboard</span>
          <div id="nav-right">
            <span id="nav-refresh-status">{statusText}</span>
            <button className="nav-btn" type="button" onClick={loadAll}>Refresh</button>
            <Link className="nav-btn" href="/admin/control">Admin Controls</Link>
          </div>
        </div>
      </header>

      <main id="ops-main">
        <section id="hero-summary">
          <div className="detail-card" id="hero-copy">
            <span className="eyebrow">Public technical surface</span>
            <h1>Live intake complexity, costs, and stored dashboard state.</h1>
            <p>
              This route is part of the Next app now, so it loads with the regular site instead of depending on a
              separately opened static file. It reads the live ops overview endpoint and surfaces run cost, payload
              visibility, and pipeline stages in one place.
            </p>
          </div>
          <div className="detail-card">
            <div className="card-topline">
              <span>Current focus</span>
              <span className={badgeClass(latestRun?.status || latestClient?.status || 'unknown')}>
                {latestRun?.status || latestClient?.status || 'unknown'}
              </span>
            </div>
            <div id="hero-meta">
              <div className="hero-meta-item">
                <span className="label">Client</span>
                <span className="value">{latestClient?.companyName || latestClient?.normalizedHost || latestClient?.clientId || '—'}</span>
              </div>
              <div className="hero-meta-item">
                <span className="label">Website</span>
                <span className="value">{latestClient?.websiteUrl || latest.clientConfig?.sourceInputs?.websiteUrl || '—'}</span>
              </div>
              <div className="hero-meta-item">
                <span className="label">Latest Run</span>
                <span className="value">{latestRun?.id || '—'}</span>
              </div>
              <div className="hero-meta-item">
                <span className="label">Pipeline</span>
                <span className="value">{latestRun?.pipelineType || latestClient?.pipelineType || 'free-tier-intake'}</span>
              </div>
            </div>
          </div>
        </section>

        <section id="stat-grid">
          <div className="stat-card"><div className="stat-label">Clients</div><div className="stat-value">{data?.stats?.clients ?? '—'}</div></div>
          <div className="stat-card green"><div className="stat-label">Active</div><div className="stat-value">{data?.stats?.activeClients ?? '—'}</div></div>
          <div className="stat-card amber"><div className="stat-label">Provisioning</div><div className="stat-value">{data?.stats?.provisioningClients ?? '—'}</div></div>
          <div className="stat-card red"><div className="stat-label">Client Errors</div><div className="stat-value">{data?.stats?.erroredClients ?? '—'}</div></div>
          <div className="stat-card"><div className="stat-label">Total Runs</div><div className="stat-value">{data?.stats?.totalRuns ?? '—'}</div></div>
          <div className="stat-card green"><div className="stat-label">Succeeded</div><div className="stat-value">{data?.stats?.succeededRuns ?? '—'}</div></div>
          <div className="stat-card red"><div className="stat-label">Failed</div><div className="stat-value">{data?.stats?.failedRuns ?? '—'}</div></div>
          <div className="stat-card amber"><div className="stat-label">Queued</div><div className="stat-value">{data?.stats?.queuedRuns ?? '—'}</div></div>
          <div className="stat-card blue"><div className="stat-label">Running</div><div className="stat-value">{data?.stats?.runningRuns ?? '—'}</div></div>
          <div className="stat-card purple">
            <div className="stat-label">Total Cost To Date</div>
            <div className="stat-value">{formatCurrency(data?.stats?.totalCostUsd, 3)}</div>
            <div className="stat-sub">{`${data?.stats?.pricedRunCount || 0} priced run${data?.stats?.pricedRunCount === 1 ? '' : 's'}`}</div>
          </div>
          <div className="stat-card purple">
            <div className="stat-label">Last Run Cost</div>
            <div className="stat-value">{formatCurrency(data?.stats?.lastRunCostUsd, 4)}</div>
            <div className="stat-sub">{data?.stats?.lastRunCostUsd == null ? 'Latest run has no cost payload' : 'Latest run only'}</div>
          </div>
          <div className="stat-card purple">
            <div className="stat-label">Avg / Priced Run</div>
            <div className="stat-value">{formatCurrency(data?.stats?.averageRunCostUsd, 4)}</div>
            <div className="stat-sub">{`${data?.stats?.pricedRunCount || 0} priced run${data?.stats?.pricedRunCount === 1 ? '' : 's'}`}</div>
          </div>
          <div className="stat-card"><div className="stat-label">Configs Tracked</div><div className="stat-value">{data?.stats?.configsTracked ?? '—'}</div></div>
          <div className="stat-card"><div className="stat-label">Dashboards Tracked</div><div className="stat-value">{data?.stats?.dashboardStatesTracked ?? '—'}</div></div>
          <div className="stat-card"><div className="stat-label">SEO Audits</div><div className="stat-value">{data?.stats?.seoAuditsTracked ?? '—'}</div></div>
          <div className="stat-card blue"><div className="stat-label">Browserless Requests</div><div className="stat-value">{data?.stats?.browserlessRequests ?? '—'}</div></div>
          <div className="stat-card green"><div className="stat-label">Browserless OK</div><div className="stat-value">{data?.stats?.browserlessSucceeded ?? '—'}</div></div>
          <div className="stat-card red"><div className="stat-label">Browserless Failed</div><div className="stat-value">{data?.stats?.browserlessFailed ?? '—'}</div></div>
          <div className="stat-card blue"><div className="stat-label">Avg Capture Time</div><div className="stat-value">{formatDurationMs(data?.stats?.averageBrowserlessDurationMs)}</div></div>
          <div className="stat-card blue"><div className="stat-label">Bytes Returned</div><div className="stat-value">{formatBytes(data?.stats?.browserlessBytesReturned)}</div></div>
        </section>

        {error ? (
          <section className="section">
            <div className="detail-card">
              <span className="eyebrow">Load error</span>
              <h3>Ops data unavailable</h3>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">Pipeline Stack <div className="section-head-line" /></div>
          <div id="stack-grid">
            {loading && !data ? (
              <div className="stack-card"><span className="eyebrow">Loading…</span></div>
            ) : (
              (data?.techStack || []).map((item) => (
                <article className="stack-card" key={`${item.stage}-${item.file}`}>
                  <div className="card-topline">
                    <span>{item.stage}</span>
                    <span className={badgeClass(item.status)}>{item.status}</span>
                  </div>
                  <h3>{item.layer}</h3>
                  <p>{item.detail}</p>
                  <span className="file-chip">{item.file}</span>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">Data Inventory <div className="section-head-line" /></div>
          <div id="inventory-grid">
            {loading && !data ? (
              <div className="inventory-card"><span className="eyebrow">Loading…</span></div>
            ) : (
              (data?.dataInventory || []).map((item) => (
                <article className="inventory-card" key={item.label}>
                  <div className="card-topline">
                    <span>{item.label}</span>
                    <span className={badgeClass(item.present ? 'present' : 'missing')}>
                      {item.present ? 'present' : 'missing'}
                    </span>
                  </div>
                  <h3>{item.label}</h3>
                  <p>{item.detail}</p>
                  <div className="inventory-list">
                    <div className="inventory-row">
                      <span className="label">Status</span>
                      <span className="value">{item.present ? 'Stored in latest client payload.' : 'Not stored for latest client.'}</span>
                    </div>
                    <div className="inventory-row">
                      <span className="label">Keys</span>
                      <span className="value">{(item.keys || []).join(' · ') || 'None'}</span>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">Cost by Client <div className="section-head-line" /></div>
          <div className="card-shell" id="cost-shell">
            <div id="cost-bar-inner">
              {!data?.costByClient?.length ? (
                <span className="eyebrow">{loading ? 'Loading…' : 'No cost data yet'}</span>
              ) : (
                data.costByClient.map((entry) => {
                  const max = data.costByClient[0]?.totalCostUsd || 1;
                  return (
                    <div className="cost-row" key={entry.name}>
                      <div className="cost-name" title={entry.name}>{entry.name}</div>
                      <div className="cost-track"><div className="cost-fill" style={{ width: `${((entry.totalCostUsd || 0) / max * 100).toFixed(1)}%` }} /></div>
                      <div className="cost-val">{formatCurrency(entry.totalCostUsd, 4)}</div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">Browserless Requests <div className="section-head-line" /></div>
          <div className="card-shell">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Endpoint</th>
                  <th>Variant</th>
                  <th>HTTP</th>
                  <th>Duration</th>
                  <th>Bytes</th>
                  <th>URL</th>
                  <th>Started</th>
                  <th>Request ID</th>
                </tr>
              </thead>
              <tbody>
                {!browserlessRequests.length ? (
                  <tr className="empty-row"><td colSpan={10}>{loading ? 'Loading…' : 'No Browserless requests recorded'}</td></tr>
                ) : (
                  browserlessRequests.map((request) => (
                    <tr key={request.id}>
                      <td className="cell-primary">{clientMap[request.clientId] || request.clientId || '—'}</td>
                      <td><span className={badgeClass(request.status)}>{request.status || 'unknown'}</span></td>
                      <td className="cell-dim">{request.endpoint || '—'}</td>
                      <td className="cell-dim">{request.viewportLabel || request.variant || '—'}</td>
                      <td className="cell-dim">{request.httpStatus || '—'}</td>
                      <td className="cell-dim">{formatDurationMs(request.durationMs)}</td>
                      <td className="cell-dim">{formatBytes(request.bytesReturned)}</td>
                      <td className="cell-dim">{request.sourceUrl || '—'}</td>
                      <td className="cell-dim">{fmtDate(request.createdAt)}</td>
                      <td className="cell-dim">{request.requestId ? request.requestId.slice(0, 12) : request.id?.slice(0, 12) || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head">Recent Runs <div className="section-head-line" /></div>
          <div className="card-shell">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Pipeline</th>
                  <th>Provider</th>
                  <th>Cost</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Run ID</th>
                </tr>
              </thead>
              <tbody>
                {!runs.length ? (
                  <tr className="empty-row"><td colSpan={8}>{loading ? 'Loading…' : 'No runs found'}</td></tr>
                ) : (
                  runs.slice(0, 80).map((run) => (
                    <tr key={run.id}>
                      <td className="cell-primary">{clientMap[run.clientId] || run.clientId || '—'}</td>
                      <td><span className={badgeClass(run.status)}>{run.status || 'unknown'}</span></td>
                      <td className="cell-dim">{run.pipelineType || 'free-tier-intake'}</td>
                      <td className="cell-dim">{run.providerUsage?.model || run.summary?.providerName || run.providerName || '—'}</td>
                      <td style={{ color: 'var(--purple)' }}>{formatCurrency(extractCost(run), 4)}</td>
                      <td className="cell-dim">{fmtDate(run.startedAt || run.createdAt)}</td>
                      <td className="cell-dim">{fmtDate(run.completedAt)}</td>
                      <td className="cell-dim">{run.id ? run.id.slice(0, 12) : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head">Clients <div className="section-head-line" /></div>
          <div className="card-shell">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Host</th>
                  <th>Status</th>
                  <th>Tier</th>
                  <th>Latest Run</th>
                  <th>Dashboard Modules</th>
                  <th>SEO Audit</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {!clients.length ? (
                  <tr className="empty-row"><td colSpan={8}>{loading ? 'Loading…' : 'No clients found'}</td></tr>
                ) : (
                  clients.map((client) => {
                    const clientId = client.clientId || client.id;
                    const config = configMap[clientId] || {};
                    const state = dashboardMap[clientId] || {};
                    const moduleCount = [
                      state.snapshot,
                      state.signals,
                      state.strategy,
                      state.outputsPreview,
                      state.systemPreview,
                      state.seoAudit,
                    ].filter(Boolean).length;

                    return (
                      <tr key={clientId}>
                        <td className="cell-primary">{client.companyName || '—'}</td>
                        <td className="cell-dim">{client.normalizedHost || client.websiteUrl || config.sourceInputs?.websiteUrl || '—'}</td>
                        <td><span className={badgeClass(client.status)}>{client.status || 'unknown'}</span></td>
                        <td className="cell-dim">{client.pricingTier || '—'}</td>
                        <td><span className={badgeClass(client.latestRunStatus)}>{client.latestRunStatus || 'unknown'}</span></td>
                        <td className="cell-dim">{moduleCount ? `${moduleCount} stored sections` : 'No dashboard modules yet'}</td>
                        <td><span className={badgeClass(state.seoAudit?.status || (state.seoAudit ? 'present' : 'missing'))}>{state.seoAudit?.status || (state.seoAudit ? 'present' : 'missing')}</span></td>
                        <td className="cell-dim">{fmtDate(client.createdAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head">Latest Payloads <div className="section-head-line" /></div>
          <div id="payload-grid">
            {[
              {
                title: 'Latest Client Record',
                label: 'clients/{clientId}',
                note: 'Top-level client document with owner, tier, latest run pointers, and provisioning state.',
                value: latest.clientRecord,
              },
              {
                title: 'Latest Client Config',
                label: 'client_configs/{clientId}',
                note: 'Source inputs and runtime/provider configuration currently feeding intake.',
                value: latest.clientConfig,
              },
              {
                title: 'Latest Dashboard State',
                label: 'dashboard_state/{clientId}',
                note: 'Projected dashboard modules written by the pipeline and read by the client dashboard.',
                value: latest.dashboardState,
              },
              {
                title: 'Latest Brief Run',
                label: 'brief_runs/{runId}',
                note: 'Full run-level record including provider usage, module snapshot, and summary fields.',
                value: latest.latestRun,
              },
              {
                title: 'Latest Browserless Request',
                label: 'browserless_requests/{requestId}',
                note: 'Per-request telemetry for homepage screenshot capture, including timing, HTTP result, and source URL.',
                value: latest.browserlessRequest,
              },
              ...(latest.seoAudit ? [{
                title: 'Latest SEO Audit',
                label: 'dashboard_state/{clientId}.seoAudit',
                note: 'Supplemental Google PageSpeed Insights payload stored alongside dashboard state.',
                value: latest.seoAudit,
              }] : []),
            ].map((card) => (
              <article className="detail-card" key={card.label}>
                <div className="card-topline">
                  <span>{card.label}</span>
                  <span className={badgeClass(card.value ? 'present' : 'missing')}>
                    {card.value ? 'present' : 'missing'}
                  </span>
                </div>
                <h3>{card.title}</h3>
                <p>{card.note}</p>
                <pre>{safeJson(card.value)}</pre>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

const opsOverviewCss = `
  :root {
    --page: #f5f1df;
    --card: rgba(255, 255, 255, 0.5);
    --card-border: rgba(212, 196, 171, 0.82);
    --card-shadow: 0 1px 0 rgba(255, 255, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.4);
    --nav-bg: rgba(245, 241, 223, 0.18);
    --text: #2a2420;
    --text2: rgba(42, 36, 32, 0.7);
    --text3: rgba(42, 36, 32, 0.48);
    --text4: rgba(42, 36, 32, 0.22);
    --divider: rgba(42, 36, 32, 0.1);
    --divider2: rgba(42, 36, 32, 0.06);
    --green: #22763a;
    --green-bg: rgba(34, 118, 58, 0.08);
    --green-bdr: rgba(34, 118, 58, 0.2);
    --red: #b91c1c;
    --red-bg: rgba(185, 28, 28, 0.08);
    --red-bdr: rgba(185, 28, 28, 0.2);
    --amber: #92400e;
    --amber-bg: rgba(146, 64, 14, 0.08);
    --amber-bdr: rgba(146, 64, 14, 0.18);
    --blue: #1d4ed8;
    --blue-bg: rgba(29, 78, 216, 0.07);
    --blue-bdr: rgba(29, 78, 216, 0.18);
    --purple: #6d28d9;
    --purple-bg: rgba(109, 40, 217, 0.07);
    --purple-bdr: rgba(109, 40, 217, 0.18);
    --font-ui: "Space Grotesk", system-ui, sans-serif;
    --font-mono: "Space Mono", monospace;
  }
  #ops-overview-page {
    min-height: 100dvh;
    background: var(--page);
    color: var(--text);
    font-family: var(--font-ui);
  }
  #ops-overview-page * { box-sizing: border-box; }
  #ops-overview-page::before {
    content: "";
    position: fixed;
    inset: 0;
    background: radial-gradient(circle, rgba(42, 36, 32, 0.08) 0.8px, transparent 0.8px);
    background-size: 16px 16px;
    pointer-events: none;
    z-index: 0;
  }
  #founders-top-strip {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    z-index: 200;
    min-height: 64px;
    background: var(--nav-bg);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.45), inset 0 -1px 0 rgba(42, 36, 32, 0.08);
  }
  #founders-top-strip-inner {
    display: flex;
    align-items: center;
    gap: 20px;
    min-height: 64px;
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 clamp(1.5rem, 5vw, 3rem);
  }
  #founders-brand img {
    display: block;
    width: auto;
    height: clamp(2rem, 4vw, 2.8rem);
  }
  #nav-sep {
    color: var(--text4);
    font-size: 18px;
  }
  #nav-page-label,
  #nav-refresh-status,
  .stat-label,
  .stat-sub,
  .section-head,
  .eyebrow,
  .card-topline,
  .badge,
  th,
  .file-chip,
  .inventory-row .label,
  .hero-meta-item .label {
    font-family: var(--font-mono);
  }
  #nav-page-label {
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
  }
  #nav-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  #nav-refresh-status {
    font-size: 10px;
    color: var(--text3);
    white-space: nowrap;
  }
  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    padding: 0.45rem 1rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.36);
    border: 1px solid rgba(42, 36, 32, 0.1);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    text-decoration: none;
  }
  #ops-main {
    position: relative;
    z-index: 1;
    max-width: 1440px;
    margin: 0 auto;
    padding: calc(64px + 2rem) clamp(1.5rem, 5vw, 3rem) 4rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .section-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
  }
  .section-head-line {
    flex: 1;
    height: 1px;
    background: var(--divider);
  }
  .card-shell,
  .stat-card,
  .detail-card,
  .stack-card,
  .inventory-card {
    background: var(--card);
    border: 1px solid var(--card-border);
    box-shadow: var(--card-shadow);
    backdrop-filter: blur(28px);
    -webkit-backdrop-filter: blur(28px);
    border-radius: 0.9rem;
  }
  #hero-summary {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.9fr);
    gap: 0.8rem;
  }
  #hero-copy,
  .stack-card,
  .inventory-card,
  .detail-card {
    padding: 1rem 1.1rem;
  }
  #hero-copy {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .eyebrow {
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text3);
  }
  #hero-copy h1 {
    font-size: clamp(1.8rem, 2.9vw, 2.9rem);
    line-height: 0.95;
    letter-spacing: -0.04em;
  }
  #hero-copy p,
  .stack-card p,
  .inventory-card p,
  .detail-card p {
    color: var(--text2);
  }
  #hero-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.6rem;
    padding-top: 0.8rem;
  }
  .hero-meta-item {
    padding: 0.75rem 0.85rem;
    border-radius: 0.8rem;
    background: rgba(255, 255, 255, 0.3);
    border: 1px solid rgba(42, 36, 32, 0.08);
  }
  .hero-meta-item .label {
    display: block;
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
    margin-bottom: 0.35rem;
  }
  .hero-meta-item .value {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text2);
    word-break: break-word;
  }
  #stat-grid,
  #stack-grid,
  #inventory-grid,
  #payload-grid {
    display: grid;
    gap: 0.7rem;
  }
  #stat-grid {
    grid-template-columns: repeat(auto-fit, minmax(156px, 1fr));
  }
  #stack-grid,
  #inventory-grid,
  #payload-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  .stat-card {
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .stat-label {
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
  }
  .stat-value {
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 700;
    line-height: 1;
  }
  .stat-sub {
    font-size: 9.5px;
    color: var(--text3);
  }
  .stat-card.green .stat-value { color: var(--green); }
  .stat-card.red .stat-value { color: var(--red); }
  .stat-card.amber .stat-value { color: var(--amber); }
  .stat-card.blue .stat-value { color: var(--blue); }
  .stat-card.purple .stat-value { color: var(--purple); }
  .card-topline {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
  }
  .stack-card h3,
  .inventory-card h3,
  .detail-card h3 {
    font-size: 18px;
    line-height: 1.05;
    letter-spacing: -0.03em;
    margin-top: 0.2rem;
  }
  .file-chip {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    max-width: 100%;
    border-radius: 999px;
    padding: 0.35rem 0.65rem;
    background: rgba(255, 255, 255, 0.42);
    border: 1px solid rgba(42, 36, 32, 0.08);
    font-size: 10px;
    color: var(--text2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inventory-list {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .inventory-row {
    display: grid;
    grid-template-columns: minmax(0, 140px) minmax(0, 1fr);
    gap: 0.7rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--divider2);
  }
  .inventory-row:first-child {
    border-top: none;
    padding-top: 0;
  }
  .inventory-row .label {
    font-size: 10px;
    color: var(--text3);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .inventory-row .value {
    color: var(--text2);
    font-size: 12px;
    min-width: 0;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    border: 1px solid;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 9.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .badge-succeeded, .badge-active, .badge-ok, .badge-present { background: var(--green-bg); color: var(--green); border-color: var(--green-bdr); }
  .badge-failed, .badge-error, .badge-missing { background: var(--red-bg); color: var(--red); border-color: var(--red-bdr); }
  .badge-queued, .badge-provisioning, .badge-available { background: var(--amber-bg); color: var(--amber); border-color: var(--amber-bdr); }
  .badge-running, .badge-started { background: var(--blue-bg); color: var(--blue); border-color: var(--blue-bdr); }
  .badge-cancelled { background: transparent; color: var(--text3); border-color: var(--divider); }
  .badge-unknown { background: transparent; color: var(--text4); border-color: var(--divider2); }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    padding: 0.7rem 0.9rem 0.6rem;
    background: rgba(255, 255, 255, 0.28);
    border-bottom: 1px solid var(--divider);
    text-align: left;
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
  }
  tbody tr {
    border-bottom: 1px solid var(--divider2);
  }
  tbody tr:last-child {
    border-bottom: none;
  }
  td {
    padding: 0.6rem 0.9rem;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text2);
    vertical-align: top;
  }
  .cell-primary {
    font-family: var(--font-ui);
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
  }
  .cell-dim {
    color: var(--text3);
    font-size: 11px;
  }
  .empty-row td {
    padding: 2rem !important;
    text-align: center;
    color: var(--text3) !important;
    font-size: 11px !important;
  }
  #cost-bar-inner {
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .cost-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .cost-name {
    width: 180px;
    flex-shrink: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text2);
  }
  .cost-track {
    flex: 1;
    height: 5px;
    background: rgba(42, 36, 32, 0.06);
    border-radius: 3px;
    overflow: hidden;
  }
  .cost-fill {
    height: 100%;
    background: var(--purple);
    border-radius: 3px;
  }
  .cost-val {
    width: 74px;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--purple);
  }
  pre {
    width: 100%;
    overflow: auto;
    border-radius: 0.8rem;
    padding: 0.95rem 1rem;
    background: rgba(255, 255, 255, 0.34);
    border: 1px solid rgba(42, 36, 32, 0.08);
    color: var(--text2);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  @media (max-width: 960px) {
    #hero-summary { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    #founders-top-strip-inner {
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 0.8rem;
      padding-bottom: 0.8rem;
    }
    #nav-sep,
    #nav-page-label {
      display: none;
    }
    #nav-right {
      width: 100%;
      justify-content: space-between;
      flex-wrap: wrap;
    }
    #ops-main {
      padding-top: calc(92px + 2rem);
    }
    #hero-meta {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 620px) {
    #stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .inventory-row {
      grid-template-columns: 1fr;
    }
    .cost-row {
      flex-wrap: wrap;
    }
    .cost-name,
    .cost-val {
      width: auto;
    }
  }
`;
