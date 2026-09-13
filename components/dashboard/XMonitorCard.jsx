'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownRight, ArrowUpRight, BarChart3, Clock, Link2, MessageCircle, Quote,
  Repeat2, RefreshCw, ShieldCheck, Sparkles, TrendingUp, UserMinus, UserPlus, Users,
} from 'lucide-react';
import {
  engagementRate,
  snapshotDeltas,
  snapshotSeries,
} from '../../features/x-monitor/audience-diff.js';

// X Monitor — read-only performance dashboard for the connected @bai_ee account.
// Renders entirely from stored Firestore snapshots (free); every button that
// reaches X arms a confirm row naming the exact metered call count first, per
// docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md §0. X spend is invisible
// to the Operating Cost card, so the count IS the budget signal.
//
// Growth is snapshot-derived: nothing here can be backfilled, so the first sync
// is a baseline and deltas appear from the second one on. The UI says that
// rather than drawing a flat line and letting it read as "no growth".
//
// Styling note (this bit is easy to get wrong): the block is `<style jsx global>`
// with EVERY selector prefixed by `#x-monitor-card`. Plain `<style jsx>` scopes
// by stamping a generated class onto JSX written directly in the component body
// — which silently skips anything returned from a helper (`gate()`) or a child
// component (GrowthChart, AudienceRow), leaving those half-styled. The id prefix
// gives the same containment without depending on that pass. The tag itself must
// still sit inline in the returned JSX; handing it a variable fails the compile
// and the card renders as an empty pane.

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_TRIES = 30;
const RANGES = [
  { key: 7, label: '7D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
  { key: 0, label: 'ALL' },
];
const POST_COLUMNS = [
  { key: 'createdAt', label: 'Posted', numeric: false },
  { key: 'impressions', label: 'Impressions', numeric: true },
  { key: 'likes', label: 'Likes', numeric: true },
  { key: 'retweets', label: 'Reposts', numeric: true },
  { key: 'replies', label: 'Replies', numeric: true },
  { key: 'quotes', label: 'Quotes', numeric: true },
  { key: 'bookmarks', label: 'Bookmarks', numeric: true },
  { key: 'er', label: 'Eng. rate', numeric: true },
];

const fmtInt = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString() : '—');
const fmtSigned = (value) => {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`;
};
const fmtPct = (value) => (Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(2)}%` : '—');

function fmtWhen(value) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : Date.parse(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fmtDay(value) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value : Date.parse(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function withinRange(value, days) {
  if (!days) return true;
  const ms = typeof value === 'number' ? value : Date.parse(value || '');
  if (!Number.isFinite(ms)) return false;
  return ms >= Date.now() - days * 86_400_000;
}

// ── Charts (hand-rolled SVG — no chart library in this repo's deps) ──────────

function GrowthChart({ series }) {
  if (series.length < 2) return null;
  const values = series.map((p) => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const W = 720;
  const H = 150;
  const x = (i) => (series.length === 1 ? W : (i / (series.length - 1)) * W);
  const y = (v) => H - ((v - min) / span) * (H - 12) - 6;
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.followers).toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = series[series.length - 1];

  const nets = series.slice(1).map((p) => p.net || 0);
  const netMax = Math.max(1, ...nets.map((n) => Math.abs(n)));

  return (
    <div id="x-monitor-growth-chart-shell">
      <div className="xm-chart-scale">
        <span>{fmtInt(max)}</span>
        <span>{fmtInt(min)}</span>
      </div>
      <svg className="xm-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Follower count over time">
        <path className="xm-chart-area" d={area} />
        <path className="xm-chart-line" d={line} fill="none" vectorEffect="non-scaling-stroke" />
        <circle className="xm-chart-dot" cx={x(series.length - 1)} cy={y(last.followers)} r="3.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div id="x-monitor-growth-bars-row" className="xm-bars" aria-label="Net follower change per snapshot">
        {series.slice(1).map((p) => {
          const net = p.net || 0;
          const height = Math.max(2, (Math.abs(net) / netMax) * 26);
          return (
            <span
              key={p.date}
              className={`xm-bar ${net < 0 ? 'xm-bar-down' : 'xm-bar-up'}`}
              style={{ height: `${height}px` }}
              title={`${p.date}: ${fmtSigned(net)}`}
            />
          );
        })}
      </div>
      <div className="xm-chart-axis">
        <span>{fmtDay(series[0].date)}</span>
        <span>{fmtDay(last.date)}</span>
      </div>
    </div>
  );
}

function AudienceRow({ event }) {
  const user = event.user || {};
  return (
    <li className={`xm-aud-row xm-aud-${event.type}`}>
      {user.avatar
        ? <img className="xm-aud-avatar" src={user.avatar} alt="" loading="lazy" />
        : <span className="xm-aud-avatar xm-aud-avatar-blank" aria-hidden="true" />}
      <span className="xm-aud-main">
        <a className="xm-aud-handle" href={`https://x.com/${user.username}`} target="_blank" rel="noopener noreferrer">
          @{user.username || 'unknown'}
        </a>
        <span className="xm-aud-name">{user.name || ''}</span>
        {user.bio ? <span className="xm-aud-bio">{user.bio}</span> : null}
      </span>
      <span className="xm-aud-meta">
        <span className="xm-aud-count">{fmtInt(user.followers)} followers</span>
        <span className="xm-aud-when">{fmtWhen(event.detectedAt)}</span>
      </span>
    </li>
  );
}

export default function XMonitorCard({ getIdToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [armed, setArmed] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adminBlocked, setAdminBlocked] = useState(false);
  const [range, setRange] = useState(30);
  const [postSort, setPostSort] = useState({ key: 'createdAt', dir: 'desc' });
  const pollRef = useRef(null);

  const apiFetch = useCallback(async (body = null) => {
    const token = await getIdToken();
    const options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      : { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
    const res = await fetch('/api/dashboard/x-monitor', options);
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(payload?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return payload;
  }, [getIdToken]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const payload = await apiFetch();
      setData(payload);
      setAdminBlocked(false);
      return payload;
    } catch (err) {
      if (err.status === 403) setAdminBlocked(true);
      else if (!silent) setNotice({ kind: 'error', text: err.message });
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  async function runGated(key, body) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      const payload = await apiFetch(body);
      setData(payload);
      setNotice({ kind: 'ok', text: syncSummary(body.action, payload) });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
      setArmed(null);
    }
  }

  async function connect() {
    if (busy) return;
    setBusy('connect');
    setNotice(null);
    try {
      const payload = await apiFetch({ action: 'connect-start' });
      window.open(payload.url, '_blank', 'noopener');
      setNotice({ kind: 'ok', text: 'Authorize in the X tab that just opened — this card updates itself when the callback lands.' });
      if (pollRef.current) clearInterval(pollRef.current);
      let tries = 0;
      pollRef.current = setInterval(async () => {
        tries += 1;
        const next = await load({ silent: true });
        if (next?.connection?.connected || tries >= POLL_MAX_TRIES) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  const connection = data?.connection || null;
  const connected = Boolean(connection?.connected);
  const profile = data?.account?.profile || null;
  const sync = data?.account?.sync || null;
  const snapshots = data?.snapshots || [];
  const events = data?.events || [];
  const posts = data?.posts || [];
  const estimate = data?.estimate || null;

  const series = useMemo(() => {
    const all = snapshotSeries(snapshots);
    if (!range) return all;
    return all.filter((p) => withinRange(`${p.date}T00:00:00Z`, range));
  }, [snapshots, range]);

  const deltas = useMemo(() => snapshotDeltas(snapshots), [snapshots]);
  const gained = useMemo(() => events.filter((e) => e.type === 'gained' && withinRange(e.detectedAt, range)), [events, range]);
  const lost = useMemo(() => events.filter((e) => e.type === 'lost' && withinRange(e.detectedAt, range)), [events, range]);

  const sortedPosts = useMemo(() => {
    const rows = posts
      .filter((p) => withinRange(p.createdAt, range))
      .map((p) => ({ ...p, er: engagementRate(p.metrics || {}) }));
    const { key, dir } = postSort;
    const pick = (row) => (key === 'createdAt' ? Date.parse(row.createdAt || 0) || 0
      : key === 'er' ? (row.er ?? -1)
      : Number(row.metrics?.[key] ?? -1));
    rows.sort((a, b) => (dir === 'asc' ? pick(a) - pick(b) : pick(b) - pick(a)));
    return rows;
  }, [posts, postSort, range]);

  const impressionsMissing = posts.length > 0 && posts.every((p) => p.metrics?.impressions == null);
  const audienceCalls = estimate?.pages || 1;
  const totalCalls = 2 + audienceCalls;
  const spinner = <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" />;

  const gate = (key, { label, icon, cost, run, primary = false, disabled = false }) => (
    armed === key ? (
      <span className="xm-gate-row" key={key}>
        <span className="xm-gate-cost">{cost}</span>
        <button type="button" className="xm-primary" onClick={run} disabled={!!busy}>
          {busy === key ? spinner : <ShieldCheck size={13} />} Confirm
        </button>
        <button type="button" onClick={() => setArmed(null)} disabled={!!busy}>Cancel</button>
      </span>
    ) : (
      <button type="button" key={key} className={primary ? 'xm-primary' : ''} onClick={() => setArmed(key)} disabled={!!busy || disabled}>
        {busy === key ? spinner : icon} {label}
      </button>
    )
  );

  // The admin gate is a branch, not an early return: a second return path would
  // need its own <style jsx> tag (see the styling note at the top of the file).
  return (
    <div id="x-monitor-card">
      {adminBlocked ? (
        <section id="x-monitor-admin-gate-panel" className="xm-panel">
          <div className="xm-head"><span className="xm-kicker">X Monitor</span></div>
          <div className="xm-empty">Admin only — this card reads the live @bai_ee X account.</div>
        </section>
      ) : (
      <>
      {/* ── Identity + sync controls ──────────────────────────────────────── */}
      <section id="x-monitor-identity-panel" className="xm-panel">
        {loading ? (
          <div className="xm-empty">Loading stored snapshots…</div>
        ) : !connected ? (
          <>
            <div className="xm-head">
              <span className="xm-kicker"><Link2 size={13} /> Connect an X account</span>
              <small>OAUTH 2.0 · PKCE</small>
            </div>
            <p className="xm-sub">
              Monitoring reads your own account&apos;s numbers — follower roster, per-post impressions, profile clicks — which X
              only serves to the authenticated owner. Connecting is <strong>free</strong>; no metered call runs without a confirm.
            </p>
            <div className="xm-actions">
              <button type="button" className="xm-primary" onClick={connect} disabled={!!busy || !connection?.config?.hasClientId}>
                {busy === 'connect' ? spinner : <Link2 size={14} />} Connect X account
              </button>
              <button type="button" onClick={() => load()} disabled={!!busy}><RefreshCw size={14} /> Refresh status</button>
            </div>
            {!connection?.config?.hasClientId ? (
              <p className="xm-error">
                Server is missing <code>X_OAUTH_CLIENT_ID</code> / <code>X_OAUTH_CLIENT_SECRET</code>. Add them to
                <code>.env.local</code> (and Vercel) with this callback registered: <code>{data?.callbackUrl || '…'}</code>
              </p>
            ) : null}
          </>
        ) : (
          <>
            <div id="x-monitor-identity-row" className="xm-identity">
              {profile?.avatar
                ? <img className="xm-identity-avatar" src={profile.avatar} alt="" />
                : <span className="xm-identity-avatar xm-aud-avatar-blank" aria-hidden="true" />}
              <div className="xm-identity-main">
                <span className="xm-identity-name">{profile?.name || connection.username || 'Connected account'}</span>
                <a className="xm-identity-handle" href={`https://x.com/${connection.username}`} target="_blank" rel="noopener noreferrer">
                  @{connection.username}
                </a>
                {profile?.bio ? <span className="xm-identity-bio">{profile.bio}</span> : null}
              </div>
              <div className="xm-identity-meta">
                <span className="xm-chip">Connected</span>
                <span className="xm-identity-when"><Clock size={11} /> Profile {fmtWhen(sync?.profileAt)}</span>
                <span className="xm-identity-when"><Users size={11} /> Audience {fmtWhen(sync?.audienceAt)}</span>
                <span className="xm-identity-when"><BarChart3 size={11} /> Posts {fmtWhen(sync?.postsAt)}</span>
              </div>
            </div>
            <div id="x-monitor-sync-controls-row" className="xm-actions">
              {gate('sync-all', {
                label: 'Sync now', icon: <RefreshCw size={14} />, primary: true,
                cost: `≈${totalCalls} metered X API calls (1 profile + 1 posts + ${audienceCalls} follower page${audienceCalls === 1 ? '' : 's'}). Reads only — nothing is posted. This spend does NOT appear on the Operating Cost card.`,
                run: () => runGated('sync-all', { action: 'sync-all' }),
              })}
              {gate('sync-profile', {
                label: 'Counters only', icon: <TrendingUp size={14} />,
                cost: '1 metered X API call — refreshes follower/following/post counts and writes today\'s snapshot.',
                run: () => runGated('sync-profile', { action: 'sync-profile' }),
              })}
              {gate('sync-posts', {
                label: 'Posts only', icon: <BarChart3 size={14} />,
                cost: '1 metered X API call — last 30 days of posts with impressions, profile clicks, and link clicks.',
                run: () => runGated('sync-posts', { action: 'sync-posts' }),
              })}
              {gate('sync-audience', {
                label: 'Audience only', icon: <Users size={14} />,
                cost: `≈${audienceCalls} metered X API call${audienceCalls === 1 ? '' : 's'} (1 per 1,000 followers) — pulls the follower roster and diffs it against the stored one.`,
                run: () => runGated('sync-audience', { action: 'sync-audience' }),
              })}
              {gate('sync-posts-deep', {
                label: 'Load older posts', icon: <Sparkles size={14} />,
                cost: '2 metered X API calls — adds your older posts with public metrics only (X serves impressions for the last 30 days only).',
                run: () => runGated('sync-posts-deep', { action: 'sync-posts', deep: true }),
              })}
              <button type="button" onClick={() => load()} disabled={!!busy}>
                <RefreshCw size={14} /> Reload stored (free)
              </button>
            </div>
          </>
        )}
        {notice ? <p className={`xm-notice xm-notice-${notice.kind}`}>{notice.text}</p> : null}
        {/* Persisted so the reason survives a reload — a failed sync used to
            vanish the moment the modal closed. */}
        {sync?.lastError ? (
          <p id="x-monitor-last-error-row" className="xm-error">
            Last {sync.lastError.op} sync failed{sync.lastError.code ? ` (${sync.lastError.code}${sync.lastError.title ? ` ${sync.lastError.title}` : ''})` : ''} at {fmtWhen(sync.lastError.at)} — {sync.lastError.message}
            {String(sync.lastError.code) === '402' ? ' · The enrolled X developer account is out of credits; only you can top it up at console.x.com.' : ''}
          </p>
        ) : null}
      </section>

      {connected ? (
        <>
          {/* ── KPI strip ──────────────────────────────────────────────── */}
          <section id="x-monitor-kpi-row" className="xm-kpis">
            {[
              { key: 'followers', label: 'Followers', value: profile?.followers, delta: deltas.windows },
              { key: 'following', label: 'Following', value: profile?.following, delta: deltas.windows },
              { key: 'posts', label: 'Posts', value: profile?.posts, delta: deltas.windows },
              { key: 'listed', label: 'Listed', value: profile?.listed, delta: null },
            ].map((kpi) => (
              <div id={`x-monitor-kpi-${kpi.key}`} key={kpi.key} className="xm-panel xm-kpi">
                <span className="xm-kpi-label">{kpi.label}</span>
                <span className="xm-kpi-value">{fmtInt(kpi.value)}</span>
                <span className="xm-kpi-deltas">
                  {kpi.delta
                    ? [1, 7, 30].map((days) => {
                        const win = kpi.delta[days];
                        const value = win ? win[kpi.key] : null;
                        return (
                          <span key={days} className={`xm-kpi-delta ${value > 0 ? 'up' : value < 0 ? 'down' : ''}`.trim()}>
                            {days}d {win ? fmtSigned(value) : '—'}
                          </span>
                        );
                      })
                    : <span className="xm-kpi-delta">no history</span>}
                </span>
              </div>
            ))}
          </section>

          {/* ── Growth ─────────────────────────────────────────────────── */}
          <section id="x-monitor-growth-panel" className="xm-panel">
            <div className="xm-head">
              <span className="xm-kicker"><TrendingUp size={13} /> Follower growth</span>
              <span className="xm-range">
                {RANGES.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={`xm-range-btn ${range === r.key ? 'is-on' : ''}`.trim()}
                    onClick={() => setRange(r.key)}
                  >{r.label}</button>
                ))}
              </span>
            </div>
            {series.length >= 2 ? (
              <>
                <GrowthChart series={series} />
                <p className="xm-muted">
                  {series.length} snapshot{series.length === 1 ? '' : 's'} in range · net{' '}
                  <strong>{fmtSigned(series[series.length - 1].followers - series[0].followers)}</strong> followers since {fmtDay(series[0].date)}.
                </p>
              </>
            ) : (
              <div className="xm-empty">
                {snapshots.length === 0
                  ? 'No snapshots yet. Run Sync now to set the baseline — the growth line starts drawing from the second sync.'
                  : 'One snapshot stored. A second sync on a different day draws the first segment of the line.'}
              </div>
            )}
          </section>

          {/* ── Audience changes ───────────────────────────────────────── */}
          <section id="x-monitor-audience-panel" className="xm-panel">
            <div className="xm-head">
              <span className="xm-kicker"><Users size={13} /> Who followed · who left</span>
              <small>
                {sync?.rosterSize ? `${fmtInt(sync.rosterSize)} IN ROSTER` : 'NO ROSTER YET'}
                {sync && sync.rosterComplete === false ? ' · PARTIAL' : ''}
              </small>
            </div>
            {sync && sync.rosterComplete === false ? (
              <p className="xm-error">
                The last roster pull stopped early (page cap or rate limit), so unfollows are not being calculated — a partial
                roster would report everyone it never fetched as an unfollow. Re-run Audience only to complete it.
              </p>
            ) : null}
            <div id="x-monitor-audience-columns" className="xm-aud-cols">
              <div id="x-monitor-audience-gained-column" className="xm-aud-col">
                <div className="xm-aud-col-head xm-aud-col-head-gained">
                  <UserPlus size={13} /> Gained <span>{gained.length}</span>
                </div>
                {gained.length ? (
                  <ul className="xm-aud-list">{gained.map((e) => <AudienceRow key={e.id} event={e} />)}</ul>
                ) : (
                  <div className="xm-empty">{events.length ? 'None in this range.' : 'Run an audience sync twice to see arrivals — the first pull is the baseline.'}</div>
                )}
              </div>
              <div id="x-monitor-audience-lost-column" className="xm-aud-col">
                <div className="xm-aud-col-head xm-aud-col-head-lost">
                  <UserMinus size={13} /> Lost <span>{lost.length}</span>
                </div>
                {lost.length ? (
                  <ul className="xm-aud-list">{lost.map((e) => <AudienceRow key={e.id} event={e} />)}</ul>
                ) : (
                  <div className="xm-empty">None in this range.</div>
                )}
              </div>
            </div>
          </section>

          {/* ── Post performance ───────────────────────────────────────── */}
          <section id="x-monitor-posts-panel" className="xm-panel">
            <div className="xm-head">
              <span className="xm-kicker"><BarChart3 size={13} /> Post performance</span>
              <small>{posts.length ? `${sortedPosts.length} OF ${posts.length} POSTS` : 'NOT SYNCED'}</small>
            </div>
            {impressionsMissing ? (
              <p className="xm-error">
                Impressions came back empty — your X access tier did not serve owner-only metrics, so these rows are public
                metrics only. Likes / reposts / replies / quotes / bookmarks are still exact.
              </p>
            ) : null}
            {sortedPosts.length ? (
              <div id="x-monitor-posts-table-scroll" className="xm-table-scroll">
                <table className="xm-table">
                  <thead>
                    <tr>
                      <th className="xm-th-post">Post</th>
                      {POST_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          className={col.numeric ? 'xm-th-num' : undefined}
                          onClick={() => setPostSort((s) => ({ key: col.key, dir: s.key === col.key && s.dir === 'desc' ? 'asc' : 'desc' }))}
                        >
                          {col.label}{postSort.key === col.key ? (postSort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPosts.map((post) => {
                      const m = post.metrics || {};
                      const d = post.deltas?.deltas || {};
                      return (
                        <tr key={post.id}>
                          <td className="xm-td-post">
                            <a href={post.url} target="_blank" rel="noopener noreferrer">{post.text}</a>
                            <span className="xm-td-kind">
                              {post.kind === 'reply' ? <><MessageCircle size={10} /> reply</>
                                : post.kind === 'quote' ? <><Quote size={10} /> quote</>
                                : <><Repeat2 size={10} /> post</>}
                            </span>
                          </td>
                          <td>{fmtDay(post.createdAt)}</td>
                          <td className="xm-td-num">
                            {fmtInt(m.impressions)}
                            {Number.isFinite(d.impressions) && d.impressions !== 0 ? <em className={d.impressions > 0 ? 'up' : 'down'}>{fmtSigned(d.impressions)}</em> : null}
                          </td>
                          <td className="xm-td-num">{fmtInt(m.likes)}{Number.isFinite(d.likes) && d.likes !== 0 ? <em className={d.likes > 0 ? 'up' : 'down'}>{fmtSigned(d.likes)}</em> : null}</td>
                          <td className="xm-td-num">{fmtInt(m.retweets)}</td>
                          <td className="xm-td-num">{fmtInt(m.replies)}</td>
                          <td className="xm-td-num">{fmtInt(m.quotes)}</td>
                          <td className="xm-td-num">{fmtInt(m.bookmarks)}</td>
                          <td className="xm-td-num">{fmtPct(post.er)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="xm-empty">
                {posts.length ? 'No posts in this range — widen it above.' : 'No posts stored yet. Run Sync now (or Posts only) to pull the last 30 days with impressions.'}
              </div>
            )}
          </section>

          {/* ── What this can and cannot see ───────────────────────────── */}
          <section id="x-monitor-coverage-panel" className="xm-panel">
            <div className="xm-head"><span className="xm-kicker">Data coverage</span><small>HONEST LIMITS</small></div>
            <ul className="xm-recs">
              <li><strong>Growth is snapshot-derived.</strong> X publishes no follower history, so every number here starts the day you first sync. Nothing can be backfilled.</li>
              <li><strong>Impressions, profile clicks and link clicks are owner-only</strong> and X serves them for the last 30 days. Older posts show public metrics only.</li>
              <li><strong>Follower identities cost calls.</strong> One metered call per 1,000 followers, capped at 6 pages per sync. ScrapeCreators — the cheap read path used elsewhere in this repo — has no X followers endpoint at all.</li>
              <li><strong>X spend never reaches the Operating Cost card.</strong> Call counts are logged to <code>usage_events</code> as <code>x-api / x-read</code>; dollars stay on console.x.com.</li>
              <li><strong>Nothing here writes.</strong> No posting, following, or profile edits from this card — that lives in Social Accounts and Copywriter.</li>
            </ul>
          </section>
        </>
      ) : null}
      </>
      )}

      <style jsx global>{`
        /* Single-column stack — white theme, dashboard modal style guide.
           Mirrors the XProfileCard panel idiom so the two X cards read as one system. */
        #x-monitor-card { margin-top: 18px; display: grid; gap: 14px; }
        #x-monitor-card .xm-panel { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.72); border-radius: 16px; padding: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
        #x-monitor-card .xm-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
        #x-monitor-card .xm-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
        #x-monitor-card .xm-head small { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(42,36,32,0.5); text-align: right; }
        #x-monitor-card .xm-sub { margin: -4px 0 12px; font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        #x-monitor-card .xm-sub strong { color: rgba(42,36,32,0.8); }
        #x-monitor-card .xm-muted { font-size: 12px; line-height: 1.4; color: rgba(42,36,32,0.6); margin: 10px 0 0; }
        #x-monitor-card .xm-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
        #x-monitor-card button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.6); color: #2a2420; min-height: 38px; padding: 0 15px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: background 160ms ease, box-shadow 160ms ease, border-color 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
        #x-monitor-card button:hover:not(:disabled) { background: rgba(255,255,255,0.95); border-color: rgba(42,36,32,0.2); box-shadow: 0 4px 14px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); transform: translateY(-1px); }
        #x-monitor-card button:active:not(:disabled) { transform: translateY(0); transition-duration: 80ms; }
        #x-monitor-card button:disabled { opacity: 0.48; cursor: not-allowed; }
        #x-monitor-card .xm-primary { background: #2a2420; color: #ffffff; border-color: #2a2420; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
        #x-monitor-card .xm-primary:hover:not(:disabled) { background: #3a332e; border-color: #3a332e; box-shadow: 0 4px 14px rgba(42,36,32,0.2), inset 0 1px 0 rgba(255,255,255,0.12); }
        #x-monitor-card .xm-gate-row { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid rgba(159,31,23,0.3); border-radius: 12px; background: rgba(159,31,23,0.04); }
        #x-monitor-card .xm-gate-cost { font-size: 11px; line-height: 1.4; font-weight: 600; color: #9f1f17; max-width: 460px; }
        #x-monitor-card .xm-notice, #x-monitor-card .xm-error { margin: 12px 0 0; font-size: 12px; line-height: 1.45; }
        #x-monitor-card .xm-notice-ok { color: #285f3b; }
        #x-monitor-card .xm-notice-error, #x-monitor-card .xm-error { color: #9f1f17; }
        #x-monitor-card .xm-empty { border: 1px dashed rgba(42,36,32,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 20px 16px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        #x-monitor-card .xm-chip { display: inline-flex; align-items: center; min-height: 26px; font-size: 11px; font-weight: 700; padding: 0 11px; border-radius: 999px; background: rgba(47,158,107,0.12); border: 1px solid rgba(47,158,107,0.28); color: #23684a; }
        #x-monitor-card code { font-family: var(--font-mono); font-size: 11px; background: rgba(42,36,32,0.06); padding: 1px 5px; border-radius: 5px; color: #2a2420; }
        #x-monitor-card .xm-recs { margin: 0; padding-left: 16px; display: grid; gap: 6px; }
        #x-monitor-card .xm-recs li { font-size: 12px; line-height: 1.45; color: rgba(42,36,32,0.72); }
        #x-monitor-card .xm-recs strong { color: #2a2420; }

        /* Identity */
        #x-monitor-card .xm-identity { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }
        #x-monitor-card .xm-identity-avatar { width: 52px; height: 52px; border-radius: 999px; object-fit: cover; border: 1px solid rgba(42,36,32,0.14); flex-shrink: 0; }
        #x-monitor-card .xm-identity-main { display: grid; gap: 3px; flex: 1; min-width: 180px; }
        #x-monitor-card .xm-identity-name { font-size: 15px; font-weight: 700; color: #2a2420; letter-spacing: -0.01em; }
        #x-monitor-card .xm-identity-handle { font-family: var(--font-mono); font-size: 12px; color: rgba(42,36,32,0.6); text-decoration: none; }
        #x-monitor-card .xm-identity-handle:hover { color: #2a2420; text-decoration: underline; }
        #x-monitor-card .xm-identity-bio { font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.6); max-width: 560px; }
        #x-monitor-card .xm-identity-meta { display: grid; gap: 4px; justify-items: flex-end; }
        #x-monitor-card .xm-identity-when { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; color: rgba(42,36,32,0.5); }

        /* KPIs */
        #x-monitor-card .xm-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
        #x-monitor-card .xm-kpi { display: grid; gap: 6px; align-content: start; }
        #x-monitor-card .xm-kpi-label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.5); }
        #x-monitor-card .xm-kpi-value { font-family: var(--font-mono); font-size: 30px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: #2a2420; }
        #x-monitor-card .xm-kpi-deltas { display: flex; flex-wrap: wrap; gap: 6px; }
        #x-monitor-card .xm-kpi-delta { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.03em; padding: 2px 7px; border-radius: 999px; background: rgba(42,36,32,0.06); color: rgba(42,36,32,0.6); }
        #x-monitor-card .xm-kpi-delta.up { background: rgba(47,158,107,0.14); color: #23684a; }
        #x-monitor-card .xm-kpi-delta.down { background: rgba(159,31,23,0.1); color: #9f1f17; }

        /* Chart */
        #x-monitor-card .xm-range { display: inline-flex; gap: 4px; }
        #x-monitor-card .xm-range-btn { min-height: 26px; padding: 0 10px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; border-radius: 999px; }
        #x-monitor-card .xm-range-btn.is-on { background: #2a2420; color: #fff; border-color: #2a2420; }
        #x-monitor-card #x-monitor-growth-chart-shell { position: relative; }
        #x-monitor-card .xm-chart { display: block; width: 100%; height: 150px; }
        #x-monitor-card .xm-chart-line { stroke: #2a2420; stroke-width: 1.75px; stroke-linejoin: round; stroke-linecap: round; }
        #x-monitor-card .xm-chart-area { fill: rgba(42,36,32,0.07); }
        #x-monitor-card .xm-chart-dot { fill: #2f9e6b; stroke: #fff; stroke-width: 1.5px; }
        #x-monitor-card .xm-chart-scale { position: absolute; right: 0; top: 0; height: 150px; display: flex; flex-direction: column; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.45); pointer-events: none; }
        #x-monitor-card .xm-bars { display: flex; align-items: flex-end; gap: 2px; height: 30px; margin-top: 6px; }
        #x-monitor-card .xm-bar { flex: 1; min-width: 2px; border-radius: 2px 2px 0 0; background: rgba(47,158,107,0.55); }
        #x-monitor-card .xm-bar-down { background: rgba(159,31,23,0.5); }
        #x-monitor-card .xm-chart-axis { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.45); margin-top: 4px; }

        /* Audience */
        #x-monitor-card .xm-aud-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        #x-monitor-card .xm-aud-col { border: 1px solid rgba(42,36,32,0.12); border-radius: 12px; background: rgba(255,255,255,0.6); overflow: hidden; }
        #x-monitor-card .xm-aud-col-head { display: flex; align-items: center; gap: 6px; padding: 9px 12px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; border-bottom: 1px solid rgba(42,36,32,0.1); }
        #x-monitor-card .xm-aud-col-head span { margin-left: auto; font-variant-numeric: tabular-nums; }
        #x-monitor-card .xm-aud-col-head-gained { color: #23684a; background: rgba(47,158,107,0.08); }
        #x-monitor-card .xm-aud-col-head-lost { color: #9f1f17; background: rgba(159,31,23,0.05); }
        #x-monitor-card .xm-aud-list { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow: auto; }
        #x-monitor-card .xm-aud-row { display: flex; gap: 10px; padding: 10px 12px; border-bottom: 1px solid rgba(42,36,32,0.07); align-items: flex-start; }
        #x-monitor-card .xm-aud-row:last-child { border-bottom: none; }
        #x-monitor-card .xm-aud-avatar { width: 34px; height: 34px; border-radius: 999px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(42,36,32,0.12); }
        #x-monitor-card .xm-aud-avatar-blank { background: rgba(42,36,32,0.08); }
        #x-monitor-card .xm-aud-main { display: grid; gap: 2px; flex: 1; min-width: 0; }
        #x-monitor-card .xm-aud-handle { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: #2a2420; text-decoration: none; }
        #x-monitor-card .xm-aud-handle:hover { text-decoration: underline; }
        #x-monitor-card .xm-aud-name { font-size: 12px; color: rgba(42,36,32,0.7); }
        #x-monitor-card .xm-aud-bio { font-size: 11px; line-height: 1.4; color: rgba(42,36,32,0.5); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        #x-monitor-card .xm-aud-meta { display: grid; gap: 2px; justify-items: flex-end; text-align: right; flex-shrink: 0; }
        #x-monitor-card .xm-aud-count, #x-monitor-card .xm-aud-when { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); white-space: nowrap; }

        /* Posts table */
        #x-monitor-card .xm-table-scroll { overflow-x: auto; border: 1px solid rgba(42,36,32,0.1); border-radius: 12px; background: rgba(255,255,255,0.6); }
        #x-monitor-card .xm-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 720px; }
        #x-monitor-card .xm-table th { text-align: left; padding: 9px 10px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.55); border-bottom: 1px solid rgba(42,36,32,0.12); cursor: pointer; white-space: nowrap; user-select: none; }
        #x-monitor-card .xm-table th:hover { color: #2a2420; }
        #x-monitor-card .xm-th-post { min-width: 240px; cursor: default; }
        #x-monitor-card .xm-th-num, #x-monitor-card .xm-td-num { text-align: right; font-variant-numeric: tabular-nums; }
        #x-monitor-card .xm-table td { padding: 9px 10px; border-bottom: 1px solid rgba(42,36,32,0.06); color: rgba(42,36,32,0.8); vertical-align: top; white-space: nowrap; }
        #x-monitor-card .xm-table tr:last-child td { border-bottom: none; }
        #x-monitor-card .xm-td-post { white-space: normal; max-width: 380px; display: grid; gap: 3px; }
        #x-monitor-card .xm-td-post a { color: #2a2420; text-decoration: none; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        #x-monitor-card .xm-td-post a:hover { text-decoration: underline; }
        #x-monitor-card .xm-td-kind { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.45); }
        #x-monitor-card .xm-td-num em { display: block; font-style: normal; font-family: var(--font-mono); font-size: 9px; color: rgba(42,36,32,0.45); }
        #x-monitor-card .xm-td-num em.up { color: #23684a; }
        #x-monitor-card .xm-td-num em.down { color: #9f1f17; }

        @media (max-width: 1024px) {
          #x-monitor-card .xm-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          #x-monitor-card .xm-aud-cols { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 480px) {
          #x-monitor-card .xm-panel { padding: 12px; border-radius: 12px; }
          #x-monitor-card .xm-kpis { gap: 8px; }
          #x-monitor-card .xm-kpi-value { font-size: 24px; }
          #x-monitor-card .xm-gate-cost { max-width: 100%; }
          #x-monitor-card .xm-identity-meta { justify-items: flex-start; }
          #x-monitor-card .xm-actions button { flex: 1 1 auto; }
        }
      `}</style>
    </div>
  );
}

function syncSummary(action, payload) {
  const calls = payload?.callsMade ?? 0;
  const result = payload?.result || {};
  const audience = result.audience || (action === 'sync-audience' ? result : null);
  const parts = [`${calls} metered call${calls === 1 ? '' : 's'} spent.`];
  if (audience) {
    if (audience.baseline) parts.push(`Baseline roster stored (${audience.rosterSize} followers) — arrivals and unfollows start from the next sync.`);
    else parts.push(`${audience.gained} gained · ${audience.lost} lost.`);
    if (audience.truncated) parts.push('Roster was truncated, so unfollows were not calculated this run.');
  }
  const posts = result.posts || (action === 'sync-posts' ? result : null);
  if (posts?.count != null) parts.push(`${posts.count} posts stored${posts.metricsSource === 'public' ? ' (public metrics only)' : ''}.`);
  return parts.join(' ');
}
