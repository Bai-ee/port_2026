'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';

// Dev preview — fetches the signed-in user's scoutConfig from Firestore and
// renders it readable. Mirrors /preview/brief's pattern. User-authed; no
// admin role required.

export default function ScoutConfigPreviewRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [regenState, setRegenState] = useState({ running: false, message: '' });
  const [scoutRun, setScoutRun] = useState({ running: false, message: '', result: null });

  useEffect(() => {
    if (!loading && !user) router.replace('/login?redirect=/preview/scout-config');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setState({ status: 'loading', data: null, error: '' });
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/dashboard/scout-config-preview', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (!cancelled) setState({ status: 'ready', data: body, error: '' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || !user) {
    return <div style={{ padding: 24, fontFamily: 'system-ui' }}>Resolving session…</div>;
  }

  const data = state.data;
  const cfg = data?.scoutConfig;
  const currentUrl = data?.currentWebsiteUrl;
  const cachedUrl = cfg?._meta?.websiteUrl;
  // Stale when either the cached URL is missing (pre-patch doc) or
  // doesn't match the current site.
  const stale = cfg && currentUrl && (!cachedUrl || cachedUrl !== currentUrl);

  async function runScouts() {
    if (!user || scoutRun.running) return;
    setScoutRun({ running: true, message: '', result: null });
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/dashboard/scout-run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setScoutRun({
        running: false,
        message: `Run complete · ${body.totalMs}ms · $${Number(body.totalCostUsd || 0).toFixed(4)}`,
        result: body,
      });
    } catch (err) {
      setScoutRun({ running: false, message: `Error: ${err.message || err}`, result: null });
    }
  }

  async function regenerate() {
    if (!user || regenState.running) return;
    setRegenState({ running: true, message: '' });
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/dashboard/scout-config-regenerate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // Refetch the preview so the new config appears.
      const prevRes = await fetch('/api/dashboard/scout-config-preview', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const prev = await prevRes.json();
      setState({ status: 'ready', data: prev, error: '' });
      const cost = body?.cost?.estimatedCostUsd;
      setRegenState({ running: false, message: `Regenerated${cost != null ? ` · $${Number(cost).toFixed(4)}` : ''}` });
    } catch (err) {
      setRegenState({ running: false, message: `Error: ${err.message || err}` });
    }
  }

  return (
    <div style={pageStyle}>
      <style>{`
        .sc-root { max-width: 960px; margin: 0 auto; padding: 24px; color: #2a2420; font-family: "Space Grotesk", system-ui, sans-serif; }
        .sc-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #1a1614; color: #F5F1DF; font-family: "Space Mono", monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: -24px -24px 24px -24px; }
        .sc-stale { background: rgba(215,25,33,0.1); border: 1px solid rgba(215,25,33,0.4); color: #b61319; padding: 12px 14px; border-radius: 10px; margin-bottom: 20px; font-family: "Space Mono", monospace; font-size: 12px; letter-spacing: 0.08em; }
        .sc-section { padding: 16px 18px; background: rgba(255,252,244,0.85); border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 14px; margin-bottom: 14px; }
        .sc-label { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(42,36,32,0.55); margin-bottom: 10px; }
        .sc-row { display: grid; grid-template-columns: 180px 1fr; gap: 14px; padding: 6px 0; border-bottom: 1px dashed rgba(42,36,32,0.1); }
        .sc-row:last-child { border-bottom: 0; }
        .sc-row .k { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(42,36,32,0.5); padding-top: 3px; }
        .sc-row .v { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: #2a2420; word-break: break-word; }
        .sc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .sc-chip { font-family: "Space Mono", monospace; font-size: 11px; padding: 4px 10px; border: 1px solid rgba(212, 196, 171, 0.82); background: #fff; border-radius: 999px; }
        .sc-plan { padding: 12px 0; border-top: 1px solid rgba(42,36,32,0.1); }
        .sc-plan:first-child { border-top: 0; }
        .sc-plan .num { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.14em; color: rgba(42,36,32,0.55); margin-bottom: 4px; }
        .sc-plan .title { font-family: "Space Grotesk"; font-weight: 600; font-size: 15px; margin-bottom: 4px; }
        .sc-plan .query { font-family: "Space Mono", monospace; font-size: 12px; background: #fff; border: 1px solid rgba(212, 196, 171, 0.82); padding: 6px 10px; border-radius: 8px; margin-bottom: 4px; word-break: break-word; }
        .sc-plan .goal { font-size: 13px; color: rgba(42,36,32,0.65); }
        .sc-empty { color: rgba(42,36,32,0.4); font-style: italic; }
      `}</style>
      <div className="sc-root">
        <div className="sc-bar">
          <span>Scout Config Preview</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ opacity: 0.6 }}>{state.status.toUpperCase()}</span>
            {state.status === 'ready' && (
              <>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={regenState.running}
                  style={{
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '6px 12px',
                    background: regenState.running ? 'rgba(245,241,223,0.25)' : '#F5F1DF',
                    color: regenState.running ? 'rgba(245,241,223,0.7)' : '#1a1614',
                    border: '1px solid rgba(245,241,223,0.4)',
                    borderRadius: 6,
                    cursor: regenState.running ? 'default' : 'pointer',
                  }}
                >
                  {regenState.running ? 'Regenerating…' : 'Regenerate Now'}
                </button>
                <button
                  type="button"
                  onClick={runScouts}
                  disabled={scoutRun.running || !data?.hasConfig}
                  style={{
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '6px 12px',
                    background: scoutRun.running ? 'rgba(74,158,92,0.25)' : '#4A9E5C',
                    color: scoutRun.running ? 'rgba(245,241,223,0.7)' : '#F5F1DF',
                    border: '1px solid rgba(74,158,92,0.6)',
                    borderRadius: 6,
                    cursor: scoutRun.running ? 'default' : 'pointer',
                  }}
                >
                  {scoutRun.running ? 'Running Scouts…' : 'Run Scouts'}
                </button>
              </>
            )}
          </span>
        </div>
        {regenState.message && (
          <div style={{
            padding: '8px 14px',
            fontFamily: '"Space Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: regenState.message.startsWith('Error') ? '#b61319' : 'rgba(42,36,32,0.7)',
          }}>
            {regenState.message}
          </div>
        )}

        {scoutRun.message && (
          <div style={{
            padding: '10px 14px',
            marginBottom: 14,
            fontFamily: '"Space Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: scoutRun.message.startsWith('Error') ? '#b61319' : 'rgba(42,36,32,0.7)',
            background: 'rgba(74,158,92,0.08)',
            border: '1px solid rgba(74,158,92,0.3)',
            borderRadius: 10,
          }}>
            {scoutRun.message}
          </div>
        )}

        {scoutRun.result && (
          <div className="sc-section">
            <div className="sc-label">Scout Run · {scoutRun.result.runAt}</div>
            {scoutRun.result.runs.map((r, i) => (
              <div key={i} className="sc-row">
                <div className="k">{r.key}</div>
                <div className="v">
                  <strong style={{ color: r.status === 'ok' ? '#166534' : r.status === 'error' ? '#b61319' : 'rgba(42,36,32,0.5)' }}>{r.status}</strong>
                  {' · '}{r.ranMs}ms
                  {r.cost != null ? ` · $${Number(r.cost).toFixed(4)}` : ''}
                  {r.error ? ` · ${r.error}` : ''}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
              </div>
            ))}
            {scoutRun.result.externalSignals?.reddit && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                <div className="sc-label">Reddit · {scoutRun.result.externalSignals.reddit.mentionCount} mentions · {scoutRun.result.externalSignals.reddit.participationOpportunityCount} opportunities</div>
                {(scoutRun.result.externalSignals.reddit.mentions || []).slice(0, 3).map((m, i) => (
                  <div key={i} style={{ padding: '8px 0', borderBottom: '1px dashed rgba(42,36,32,0.1)' }}>
                    <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: 'rgba(42,36,32,0.5)' }}>{m.subreddit}</div>
                    <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 13 }}>{m.title}</div>
                    {m.summary && <div style={{ fontSize: 12, color: 'rgba(42,36,32,0.7)', marginTop: 2 }}>{m.summary}</div>}
                    {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#4A7C7E' }}>open →</a>}
                  </div>
                ))}
              </div>
            )}
            {scoutRun.result.externalSignals?.weather && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                <div className="sc-label">Weather · {scoutRun.result.externalSignals.weather.neighborhoods?.length || 0} neighborhood(s)</div>
                <div className="sc-row">
                  <div className="k">overall</div>
                  <div className="v">{scoutRun.result.externalSignals.weather.overall?.summary || '—'}</div>
                </div>
              </div>
            )}
            {scoutRun.result.externalSignals?.reviews && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                <div className="sc-label">Reviews · {scoutRun.result.externalSignals.reviews.overallStatus}</div>
                {(scoutRun.result.externalSignals.reviews.sources || []).slice(0, 3).map((s, i) => (
                  <div key={i} className="sc-row">
                    <div className="k">{s.label || s.key}</div>
                    <div className="v">{s.rating != null ? `${s.rating} stars` : ''}{s.count != null ? ` · ${s.count} reviews` : ''}{s.lastReviewedAt ? ` · ${s.lastReviewedAt}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {state.status === 'loading' && <div style={{ padding: 24 }}>Loading…</div>}
        {state.status === 'error' && (
          <div className="sc-stale">Error: {state.error}</div>
        )}

        {state.status === 'ready' && !data?.hasConfig && (
          <div className="sc-section">
            <div className="sc-label">No scoutConfig yet</div>
            <div>Run the pipeline once to generate it. You'll see the config here after the next successful run.</div>
          </div>
        )}

        {state.status === 'ready' && (
          <div style={{ padding: '10px 14px', marginBottom: 14, background: 'rgba(42,36,32,0.04)', border: '1px solid rgba(42,36,32,0.1)', borderRadius: 10, fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
            <span style={{ color: 'rgba(42,36,32,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 10 }}>Currently crawling</span>
            <div style={{ fontSize: 15, marginTop: 4, color: '#2a2420' }}>{currentUrl || <em>(no websiteUrl on clients/{data?.clientId})</em>}</div>
            <div style={{ fontSize: 10, color: 'rgba(42,36,32,0.5)', marginTop: 4 }}>Client id: {data?.clientId}</div>
          </div>
        )}

        {state.status === 'ready' && cfg && (
          <>
            {stale && (
              <div className="sc-stale">
                {!cachedUrl
                  ? <>Stale — this config was generated before the URL-tracking patch. Click <strong>Regenerate Now</strong> above to re-crawl and rebuild against the current site ({currentUrl}).</>
                  : <>Stale — cached for <strong>{cachedUrl}</strong> but current site is <strong>{currentUrl}</strong>. Click <strong>Regenerate Now</strong> above or reseed from the dashboard.</>}
              </div>
            )}

            <Section label="Meta">
              <Row k="clientType"       v={cfg._meta?.clientType} />
              <Row k="websiteUrl (cached)" v={cachedUrl} />
              <Row k="generatedAt"      v={cfg._meta?.generatedAt} />
              <Row k="genCost"          v={cfg._meta?.runCostData?.estimatedCostUsd != null ? `$${Number(cfg._meta.runCostData.estimatedCostUsd).toFixed(4)}` : '—'} />
              <Row k="capabilities on"  v={(cfg._meta?.capabilitiesActive || []).join(' · ')} />
              <Row k="capabilities off" v={(cfg._meta?.capabilitiesInactive || []).map((x) => `${x.id}(${x.reason})`).join(' · ')} />
            </Section>

            <Section label="Identity">
              <Row k="clientName" v={cfg.clientName} />
              <Row k="timeZone"   v={cfg.timeZone} />
            </Section>

            <ChipSection label="Brand Keywords" items={cfg.brandKeywords} />
            <ChipSection label="Competitors (inferred)" items={cfg.competitors} />
            <ChipSection label="Category Terms" items={cfg.categoryTerms} />
            <ChipSection label="KOLs" items={cfg.kols} />

            {cfg.reddit && (
              <Section label="Reddit">
                <Row k="subreddits"         v={cfg.reddit.subreddits?.join(' · ')} />
                <Row k="mentionQueries"     v={cfg.reddit.mentionQueries?.join(' · ')} />
                <Row k="opportunityQueries" v={cfg.reddit.opportunityQueries?.join(' · ')} />
              </Section>
            )}

            <Capability label="Weather" data={cfg.weather}>
              {(w) => (
                <>
                  <Row k="provider"      v={w.provider} />
                  <Row k="neighborhoods" v={(w.serviceNeighborhoods || []).map((n) => `${n.name} (${n.latitude?.toFixed(3)}, ${n.longitude?.toFixed(3)})`).join(' · ')} />
                  <Row k="window"        v={`${w.operationalWindowStartHour}h → +${w.operationalWindowHours}h`} />
                </>
              )}
            </Capability>

            <Capability label="Reviews" data={cfg.reviews}>
              {(r) => (
                <>
                  <Row k="provider" v={r.provider} />
                  {(r.sources || []).map((s, i) => <Row key={i} k={s.label || s.key} v={s.query} />)}
                </>
              )}
            </Capability>

            <Capability label="Instagram" data={cfg.instagram}>
              {(ig) => (
                <>
                  <Row k="provider"   v={ig.provider} />
                  <Row k="handle"     v={`@${ig.handle}`} />
                  <Row k="profileUrl" v={ig.profileUrl} />
                </>
              )}
            </Capability>

            {cfg.scout && (
              <Section label="Scout · Search Plan">
                <Row k="freshnessDays"        v={cfg.scout.freshnessDays} />
                <Row k="sourceFocus"          v={cfg.scout.sourceFocus} />
                <Row k="analysisInstructions" v={cfg.scout.analysisInstructions} />
                <div style={{ marginTop: 12 }}>
                  {(cfg.scout.searchPlan || []).map((p, i) => (
                    <div className="sc-plan" key={i}>
                      <div className="num">{String(i + 1).padStart(2, '0')}</div>
                      <div className="title">{p.label}</div>
                      <div className="query">{p.query}</div>
                      <div className="goal">goal: {p.goal}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="sc-section">
      <div className="sc-label">{label}</div>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="sc-row">
      <div className="k">{k}</div>
      <div className="v">{v == null || v === '' ? <span className="sc-empty">—</span> : v}</div>
    </div>
  );
}

function ChipSection({ label, items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="sc-section">
      <div className="sc-label">{label} ({list.length})</div>
      {list.length ? (
        <div className="sc-chips">
          {list.map((item, i) => <span className="sc-chip" key={i}>{item}</span>)}
        </div>
      ) : (
        <span className="sc-empty">(empty)</span>
      )}
    </div>
  );
}

function Capability({ label, data, children }) {
  return (
    <Section label={label}>
      {data ? children(data) : <span className="sc-empty">inactive for this client</span>}
    </Section>
  );
}

const pageStyle = {
  minHeight: '100dvh',
  background:
    'radial-gradient(600px 380px at 0% 6%, rgba(255,120,90,0.18) 0%, transparent 65%), radial-gradient(520px 340px at 100% 14%, rgba(176,90,255,0.14) 0%, transparent 65%), linear-gradient(180deg, #fefdf9 0%, #fbf8f0 50%, #fdfaf2 100%)',
  padding: 24,
};
