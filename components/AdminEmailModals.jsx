'use client';

// AdminEmailModals.jsx — admin-only modal content for the dashboard "Admin"
// bucket. The Email Digest card is the single control surface, mirroring the
// Market Signals card pattern: a SETTINGS tab that sets the params, then a
// PREVIEW tab that renders + sends the resulting email.
//   • AdminEmailDigestView — SETTINGS (config) + PREVIEW (email + send)
//   • AdminCreateClientView — website-less client workspace
// The SETTINGS tab is styled with the dashboard-modal style guide primitives
// (scoped under `.vrk-scope`: .section / .toggle-grid / .segmented / .field-grid),
// the same kit the Video Remix modal uses. See
// public/docs/dashboard-modal-component-style-guide.html.

import React, { useCallback, useEffect, useRef, useState } from 'react';

async function authFetch(user, path, options = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

// Granular email section toggles, grouped. Each entry is
// [include key, card title, card description, customize cardId]. One key = one
// rendered section in the digest's buildEmailHtml, so the EMAIL PREVIEW and the
// sent email match. The 4th element opens the dashboard card that owns that
// section's own settings (null = no card). Creative Brief is opt-in (off).
// Grouped by the brief each section belongs to — mirrors the email's top-down
// order (STAND UP: agenda/weather context → executive summary → one section per
// brief). Each entry: [include key, card title, description, customize cardId].
const SECTION_GROUPS = [
  ['Top of email', [
    ['agenda', 'Calendar Agenda', 'Up to 5 days of events', 'calendar-connect'],
    ['weather', 'Weather', 'Local forecast (today + 3-day)', null],
  ]],
  ['Executive Summary', [
    ['execSummary', 'Executive summary', 'The “Today” callout summary', null],
  ]],
  ['Post Content', [
    ['videoPosts', 'Video Remix Post', 'Latest remix video + X promo post', 'video-remix'],
    ['videoPromo', 'Video Promo Post', 'Latest Video Promo (mockup) + X post', null],
  ]],
  ['Call to action', [
    ['execBriefLink', 'Executive Brief link', 'The “Open Executive Brief” button', null],
    ['contactHuman', 'Contact Your Human', 'CTA → your booking link (Calendly)', null],
  ]],
  ['Market Signals brief', [
    ['humanBrief', 'Human Brief', 'The strategist’s opening blurb', 'signals'],
    ['opportunities', 'Post Opportunities', 'Conversation / angle to enter', 'signals'],
    ['suggestedReplies', 'Suggested Replies', 'Drafted reply per opportunity', 'signals'],
    ['signals', 'Signals', 'KOLs, competitors, narratives', 'signals'],
    ['watchlistAccounts', 'Watchlist Accounts', 'Tracked accounts, name-for-name', 'signals'],
    ['suggestedPosts', 'Suggested Posts', 'Drafted posts for today', 'signals'],
    ['planPreview', '30-Day Plan', 'Upcoming scheduled posts', 'signals'],
    ['watchlist', 'Happening on X', 'Watchlist analysis', 'signals'],
    ['followerPosts', 'Follower Posts', '1 post from each followed handle', 'signals'],
  ]],
  ['Creative brief', [
    ['creativeBrief', 'Creative cover', 'Creative assets of the day', 'onboarding-brief'],
  ]],
  ['Web Performance', [
    ['ga4Traffic', 'GA4 Traffic', 'Sessions, views, bounce', null],
    ['topPages', 'Top Pages', 'Most-viewed pages', null],
    ['trafficSources', 'Traffic Sources', 'Source / medium', null],
    ['keyEvents', 'Key Events', 'Tracked GA4 events', null],
    ['homepage', 'Homepage Activity', 'Clicks, scroll, web vitals', null],
  ]],
  ['Platform', [
    ['platformOverview', 'Platform Overview', 'Sign-ups, users, dashboards', null],
    ['signups', 'New Sign-ups', 'Recent user table', null],
    ['dashboards', 'Dashboards', 'Recent brief runs', null],
    ['pipeline', 'Pipeline Status', 'Run status breakdown', null],
  ]],
  ['Deployments', [
    ['deployments', 'Deployments', 'Vercel deploys', null],
    ['runtimeErrors', 'Runtime Errors', 'Vercel error logs', null],
  ]],
];
const ALL_SECTION_KEYS = SECTION_GROUPS.flatMap(([, items]) => items.map(([k]) => k));
// Groups whose cards can be shuffled up/down to set the email order. The CTA
// group isn't part of the section flow, so it stays fixed.
const NON_ORDERABLE_GROUPS = new Set(['Call to action']);
// Display labels for suggested-post platforms; the list itself comes from the
// server (form.postPlatforms keys), so adding a platform in _digest-config
// surfaces a checkbox here automatically. Unknown keys fall back to capitalized.
const PLATFORM_LABELS = { x: 'X', thread: 'Thread opener', discord: 'Discord', reddit: 'Reddit', instagram: 'Instagram' };

// ── Email Digest: SETTINGS (params) + PREVIEW (rendered email + send) ─────────
export function AdminEmailDigestView({ user, onOpenCard }) {
  const [tab, setTab] = useState('settings'); // 'settings' | 'preview'
  const [clientsExpanded, setClientsExpanded] = useState(false); // "Include client briefs" collapsible — default collapsed

  // ── Settings state (params that drive the email) ──
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [form, setForm] = useState(null);
  const [docs, setDocs] = useState([]);
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [saveStatus, setSaveStatus] = useState(null);
  const [runState, setRunState] = useState({}); // { [clientId]: 'running' | 'done' | 'error: msg' }

  const loadSettings = useCallback(async () => {
    if (!user) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      const data = await authFetch(user, '/api/admin/digest-config');
      setForm(data.config || null);
      setDocs(data.docs || []);
      setClientId(data.clientId || '');
      setClients(data.clients || []);
    } catch (e) {
      setSettingsError(e.message);
    } finally {
      setSettingsLoading(false);
    }
  }, [user]);

  const toggleInclude = useCallback((cid) => {
    setForm((f) => {
      const cur = Array.isArray(f.includeClientIds) ? f.includeClientIds : [];
      return { ...f, includeClientIds: cur.includes(cid) ? cur.filter((x) => x !== cid) : [...cur, cid] };
    });
  }, []);

  const runBrief = useCallback(async (cid) => {
    if (!user || !cid) return;
    setRunState((s) => ({ ...s, [cid]: 'running' }));
    try {
      await authFetch(user, `/api/dashboard/marketing-brief/run?as=${encodeURIComponent(cid)}`, { method: 'POST', body: '{}' });
      setRunState((s) => ({ ...s, [cid]: 'done' }));
    } catch (e) {
      setRunState((s) => ({ ...s, [cid]: `error: ${e.message}` }));
    }
  }, [user]);

  const save = useCallback(async () => {
    if (!user || !form) return;
    setSaveStatus({ kind: 'pending', msg: 'Saving…' });
    try {
      const data = await authFetch(user, '/api/admin/digest-config', { method: 'POST', body: JSON.stringify(form) });
      setForm(data.config);
      setSaveStatus({ kind: 'ok', msg: 'Saved.' });
    } catch (e) {
      setSaveStatus({ kind: 'error', msg: e.message });
    }
  }, [user, form]);

  // ── Preview state (the rendered email) ──
  // Default to LIVE so the preview = exactly what sends (same route code path,
  // same toggles, real data). Template is an opt-in "layout only" view.
  const [previewMode, setPreviewMode] = useState('live'); // 'live' | 'template'
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState(null); // { html, paragraph, placeholder }
  const [sendStatus, setSendStatus] = useState(null);
  // Run & Send terminal — same shell/CSS as the other cards' run terminals.
  // Closeable + reopenable; lines persist so you can return to confirm the run.
  const [termLines, setTermLines] = useState([]);
  const [termOpen, setTermOpen] = useState(false);
  const termRef = useRef(null);
  const appendTerm = useCallback((type, text) => setTermLines((p) => [...p, { type, text }]), []);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [termLines]);

  // Render the preview honoring the current (even unsaved) include toggles, so
  // flipping a section off in SETTINGS and tabbing over shows it drop out.
  const loadPreview = useCallback(async (nextMode = 'template', includeFlags, contactUrl, order, postPlatforms) => {
    if (!user) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewMode(nextMode);
    try {
      const param = nextMode === 'live' ? '1' : 'template';
      let path = `/api/admin/daily-digest?preview=${param}`;
      if (includeFlags) {
        const on = Object.entries(includeFlags).filter(([, v]) => v !== false).map(([k]) => k).join(',');
        path += `&include=${encodeURIComponent(on)}`;
      }
      // Live preview honors the typed (even unsaved) Calendly URL so the
      // "Contact Your Human" button shows before saving (preview-only override).
      if (nextMode === 'live' && contactUrl) path += `&contactUrl=${encodeURIComponent(contactUrl)}`;
      // Live preview honors the current (even unsaved) section order.
      if (nextMode === 'live' && Array.isArray(order) && order.length) path += `&order=${encodeURIComponent(order.join(','))}`;
      // Live preview honors the current (even unsaved) suggested-post platforms.
      if (nextMode === 'live' && postPlatforms) {
        const on = Object.entries(postPlatforms).filter(([, v]) => v).map(([k]) => k).join(',');
        path += `&posts=${encodeURIComponent(on)}`;
      }
      const data = await authFetch(user, path);
      setPreview({ html: data.html || '', paragraph: data.paragraph || data.summary?.paragraph || '', placeholder: Boolean(data.placeholder) });
    } catch (e) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [user]);

  const runAndSend = useCallback(async () => {
    if (!user) return;
    if (typeof window !== 'undefined' && !window.confirm('Generate fresh digest data first, then send the email to the configured recipient? Saves your current settings and runs the refresh worker (LLM cost).')) return;
    setTermOpen(true);
    setTermLines([{ type: 'info', text: '▶ Generate & Send — starting…' }]);
    setSendStatus({ kind: 'pending', msg: 'Saving settings…' });
    let refreshHeartbeat = null;
    try {
      // Persist current toggles first so the send uses exactly what you configured
      // (the send reads saved config, not unsaved form state).
      if (form) {
        const saved = await authFetch(user, '/api/admin/digest-config', { method: 'POST', body: JSON.stringify(form) });
        if (saved?.config) setForm(saved.config);
      }
      appendTerm('success', 'Saved config ✓');
      appendTerm('info', 'Step 1/2 · Refreshing Scout, watchlist timelines, and Strategy Builder…');
      appendTerm('info', 'This can take a few minutes; the email will wait for this job to finish.');
      setSendStatus({ kind: 'pending', msg: 'Refreshing digest data…' });
      const refreshStartedAt = Date.now();
      if (typeof window !== 'undefined') {
        refreshHeartbeat = window.setInterval(() => {
          const elapsed = Math.round((Date.now() - refreshStartedAt) / 1000);
          appendTerm('info', `Refresh still running… ${elapsed}s elapsed`);
        }, 30000);
      }
      const refresh = await authFetch(user, '/api/worker/pre-digest-refresh', { method: 'POST', body: '{}' });
      if (refreshHeartbeat) {
        window.clearInterval(refreshHeartbeat);
        refreshHeartbeat = null;
      }
      const refreshResults = Array.isArray(refresh?.results) ? refresh.results : [];
      refreshResults.forEach((r) => {
        const scout = r?.scout?.ok ? 'scout ok' : `scout issue${r?.scout?.error ? `: ${r.scout.error}` : ''}`;
        const watch = r?.watchlist?.ok ? `watchlist ok${Number.isFinite(r?.watchlist?.handles) ? ` (${r.watchlist.handles} handles)` : ''}` : (r?.watchlist?.skipped ? `watchlist skipped (${r.watchlist.skipped})` : `watchlist issue${r?.watchlist?.error ? `: ${r.watchlist.error}` : ''}`);
        const strategy = r?.strategy?.ok ? 'strategy ok' : `strategy issue${r?.strategy?.error ? `: ${r.strategy.error}` : ''}`;
        const hasWatchlistWarning = Array.isArray(r?.warnings) && r.warnings.some((warning) => warning?.source === 'watchlist');
        appendTerm(r?.ok ? (hasWatchlistWarning ? 'info' : 'success') : 'error', `Refresh · ${r?.clientId || 'client'} · ${scout} · ${watch} · ${strategy}`);
      });
      if (!refresh?.ok) {
        appendTerm('error', 'Refresh did not complete cleanly. Email not sent; fix the refresh issue or send latest saved data from a separate fallback control.');
        setSendStatus({ kind: 'error', msg: 'Refresh failed; email not sent.' });
        return;
      }
      appendTerm('success', 'Fresh digest data saved ✓');

      appendTerm('info', 'Step 2/2 · Rendering and sending email from saved data…');
      setSendStatus({ kind: 'pending', msg: 'Sending email from saved data…' });
      const res = await authFetch(user, '/api/admin/daily-digest?send=1&skipRefresh=1');
      (Array.isArray(res?.log) ? res.log : []).forEach((l) => appendTerm(l.type || 'info', l.text));
      if (res?.subject) appendTerm('info', `Subject · ${res.subject}`);
      appendTerm('success', 'Done ✓ — refreshed first, then sent');
      setSendStatus({ kind: 'ok', msg: 'Sent with freshly saved data.' });
    } catch (e) {
      if (refreshHeartbeat && typeof window !== 'undefined') window.clearInterval(refreshHeartbeat);
      appendTerm('error', `Error: ${e.message}`);
      setSendStatus({ kind: 'error', msg: e.message });
    }
  }, [user, form, appendTerm]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Reload the LIVE preview each time the PREVIEW tab is opened, so it reflects
  // the latest include toggles AND real data — i.e. what will actually send.
  useEffect(() => {
    if (tab === 'preview') loadPreview('live', form?.include, form?.contactUrl, form?.order, form?.postPlatforms);
  }, [tab, form, loadPreview]);

  const isTemplate = previewMode === 'template';

  return (
    <div className="tile-detail-bento-cell tile-detail-tabbed-container">
      <div className="tile-detail-tabs">
        <button type="button" className={`tile-detail-tab${tab === 'settings' ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab('settings')}>SETTINGS</button>
        <button type="button" className={`tile-detail-tab${tab === 'preview' ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab('preview')}>EMAIL PREVIEW</button>
      </div>

      {tab === 'settings' ? (
        // ── SETTINGS tab — the params that drive the email (style-guide kit) ──
        settingsLoading ? (
          <div style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Loading settings…</span></div>
        ) : settingsError ? (
          <div style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Settings failed</span><span style={emptyBody}>{settingsError}</span></div>
        ) : !form ? (
          <div style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>No config</span></div>
        ) : (
          <div className="tile-detail-tab-content">
            <div className="vrk-scope" id="email-digest-settings-shell" style={{ display: 'grid', gap: 16, padding: 16, alignContent: 'start', overflowY: 'auto' }}>

              <section className="section">
                <div className="section-head">
                  <span className="index">01</span>
                  <div>
                    <h3>Client data sources</h3>
                    <p>Home client feeds your brain + primary brief. Include others to fold their latest brief into the email.</p>
                  </div>
                  <span className="label">{(form.includeClientIds || []).length + 1} feeding</span>
                </div>
                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Home client (brain + brief)</span>
                  <select value={form.homeClientId || ''} onChange={(e) => setForm((f) => ({ ...f, homeClientId: e.target.value || null }))}>
                    <option value="">Default ({clientId || 'email-resolved'})</option>
                    {clients.map((c) => (
                      <option key={c.clientId} value={c.clientId}>{c.name}{c.websiteUrl ? '' : ' · no site'}</option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <button
                    type="button"
                    aria-expanded={clientsExpanded}
                    onClick={() => setClientsExpanded((v) => !v)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0', border: 0, background: 'none', cursor: 'pointer', minHeight: 0 }}
                  >
                    <span className="label" style={{ margin: 0 }}>Include client briefs ({(form.includeClientIds || []).length} on)</span>
                    <span className="label" style={{ margin: 0 }}>{clientsExpanded ? '▲ Hide' : '▼ Show'}</span>
                  </button>
                  {clientsExpanded ? (
                    <>
                      <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                        {clients.length ? clients.map((c) => {
                          const checked = (form.includeClientIds || []).includes(c.clientId);
                          const rs = runState[c.clientId];
                          return (
                            <div key={c.clientId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1, minWidth: 0, fontSize: 14, color: 'var(--vrk-ink, #2a2420)' }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleInclude(c.clientId)} style={{ width: 18, minHeight: 18 }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}{c.websiteUrl ? '' : ' · no site'}</span>
                              </label>
                              {rs && rs.startsWith('error') ? <span style={{ fontSize: 10, color: 'var(--danger, #9f1f17)', whiteSpace: 'nowrap' }} title={rs}>failed</span> : null}
                              {rs === 'done' ? <span style={{ fontSize: 10, color: 'var(--success, #285f3b)', whiteSpace: 'nowrap' }}>done</span> : null}
                              <button type="button" className="btn btn-outline" onClick={() => runBrief(c.clientId)} disabled={rs === 'running'} style={{ whiteSpace: 'nowrap' }}>
                                {rs === 'running' ? 'Running…' : 'Run brief'}
                              </button>
                            </div>
                          );
                        }) : <span className="hint">No clients.</span>}
                      </div>
                      <span className="hint">Run brief generates today&apos;s strategy for that client (~1 min). Switch to EMAIL PREVIEW to see it.</span>
                    </>
                  ) : null}
                </div>
              </section>

              <section className="section">
                <div className="section-head">
                  <span className="index">02</span>
                  <div>
                    <h3>Summary generation</h3>
                    <p>The LLM writes the opening paragraph from your brief, calendar, analytics, and recent uploads.</p>
                  </div>
                  <span className="label">{clientId || 'no client'}</span>
                </div>
                <div className="field-grid">
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">LLM summary</span>
                    <select value={form.summaryEnabled ? 'on' : 'off'} onChange={(e) => setForm((f) => ({ ...f, summaryEnabled: e.target.value === 'on' }))}>
                      <option value="on">Enabled</option>
                      <option value="off">Disabled</option>
                    </select>
                  </label>
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Recent docs fed</span>
                    <input type="number" min="1" max="20" value={form.recentDocsCount} onChange={(e) => setForm((f) => ({ ...f, recentDocsCount: Number(e.target.value) }))} />
                  </label>
                </div>
                <label className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Tone</span>
                  <input value={form.tone || ''} onChange={(e) => setForm((f) => ({ ...f, tone: e.target.value }))} />
                </label>
                <label className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Extra instructions</span>
                  <textarea rows={4} placeholder="Optional steering (e.g. flag overdue tasks, highlight revenue)…" value={form.extraInstructions || ''} onChange={(e) => setForm((f) => ({ ...f, extraInstructions: e.target.value }))} />
                </label>
              </section>

              <section className="section">
                <div className="section-head">
                  <span className="index">03</span>
                  <div>
                    <h3>Sections included in the email</h3>
                    <p>Every section of the email is on/off here. The EMAIL PREVIEW hides/shows exactly what the sent email will.</p>
                  </div>
                  <span className="label">{ALL_SECTION_KEYS.filter((k) => form.include?.[k]).length}/{ALL_SECTION_KEYS.length} on</span>
                </div>

                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Executive Brief link target</span>
                  <div className="segmented" role="group" aria-label="Brief link target">
                    {['fresh', 'latest', 'off'].map((m) => (
                      <button key={m} type="button" className={(form.briefLinkMode || 'fresh') === m ? 'is-active' : ''} onClick={() => setForm((p) => ({ ...p, briefLinkMode: m }))}>{m}</button>
                    ))}
                  </div>
                  <span className="hint">fresh = run a new brief on send (LLM cost) · latest = newest published brief · off = no hosted link. Requires the “Executive Brief link” toggle on.</span>
                </div>

                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Contact Your Human link (Calendly)</span>
                  <input
                    type="url"
                    placeholder="https://calendly.com/your-human/intro"
                    value={form.contactUrl || ''}
                    onChange={(e) => setForm((f) => ({ ...f, contactUrl: e.target.value }))}
                  />
                  <span className="hint">Where the “Contact Your Human” CTA points. Button only shows when this is set and its toggle is on. Falls back to the DIGEST_CONTACT_URL env var.</span>
                </div>

                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Suggested-post platforms</span>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {Object.keys(form.postPlatforms || {}).map((k) => {
                      const on = !!form.postPlatforms[k];
                      const lbl = PLATFORM_LABELS[k] || (k.charAt(0).toUpperCase() + k.slice(1));
                      return (
                        <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox" checked={on} onChange={() => setForm((f) => ({ ...f, postPlatforms: { ...(f.postPlatforms || {}), [k]: !on } }))} style={{ width: 16, minHeight: 16 }} />
                          {lbl}
                        </label>
                      );
                    })}
                  </div>
                  <span className="hint">Which platforms’ drafted posts are included in the Suggested Posts section (no own header — just in or out).</span>
                </div>

                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Auto-post to X on send</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.autoPostX !== false}
                      onChange={() => setForm((f) => ({ ...f, autoPostX: f.autoPostX === false }))}
                      style={{ width: 16, minHeight: 16 }}
                    />
                    Queue the suggested X post on a real send
                  </label>
                  <span className="hint">On Run &amp; Send / the daily cron, the suggested x_post is queued to the social-posting system (published when “Post due” runs). Off = never queued. Previews never post.</span>
                </div>

                {SECTION_GROUPS.map(([groupLabel, items]) => {
                  const orderable = !NON_ORDERABLE_GROUPS.has(groupLabel);
                  const ord = Array.isArray(form.order) ? form.order : [];
                  const oi = (k) => { const i = ord.indexOf(k); return i === -1 ? 999 : i; };
                  // Cards shown in saved order (orderable groups); fixed otherwise.
                  const ordered = orderable ? [...items].sort((a, b) => oi(a[0]) - oi(b[0])) : items;
                  // Swap two keys' positions in form.order (move a card up/down within its group).
                  const move = (key, dir) => setForm((f) => {
                    const base = Array.isArray(f.order) && f.order.length ? [...f.order] : ALL_SECTION_KEYS.filter((k) => !['execBriefLink', 'contactHuman'].includes(k));
                    const groupKeys = [...items].map(([k]) => k).sort((a, b) => base.indexOf(a) - base.indexOf(b));
                    const gi = groupKeys.indexOf(key);
                    const swapWith = groupKeys[gi + dir];
                    if (!swapWith) return f;
                    const ia = base.indexOf(key); const ib = base.indexOf(swapWith);
                    if (ia === -1 || ib === -1) return f;
                    [base[ia], base[ib]] = [base[ib], base[ia]];
                    return { ...f, order: base };
                  });
                  return (
                  <div key={groupLabel} style={{ display: 'grid', gap: 8 }}>
                    <span className="label" style={{ marginTop: 4 }}>{groupLabel}</span>
                    <div className="toggle-grid" role="group" aria-label={`${groupLabel} sections`} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                      {ordered.map(([key, title, desc, cardId], idx) => {
                        const on = !!form.include?.[key];
                        const toggle = () => setForm((f) => ({ ...f, include: { ...(f.include || {}), [key]: !on } }));
                        return (
                          <div
                            key={key}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            className={`toggle-card${on ? ' is-on' : ''}`}
                            style={{ position: 'relative' }}
                            onClick={toggle}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                          >
                            <span className="check">{on ? '✓' : ''}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="toggle-title">{title}</span>
                              <span className="toggle-desc">{desc}</span>
                              {cardId && onOpenCard ? (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onOpenCard(cardId); }}
                                  style={{ marginTop: 9, padding: 0, border: 0, background: 'none', cursor: 'pointer', font: '700 11px/1 var(--vrk-mono, monospace)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--vrk-ink, #2a2420)' }}
                                >
                                  Customize ↗
                                </button>
                              ) : null}
                            </span>
                            {orderable ? (
                              <span style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                                <button type="button" aria-label={`Move ${title} up`} disabled={idx === 0} onClick={(e) => { e.stopPropagation(); move(key, -1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1, fontSize: 11 }}>↑</button>
                                <button type="button" aria-label={`Move ${title} down`} disabled={idx === ordered.length - 1} onClick={(e) => { e.stopPropagation(); move(key, 1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: idx === ordered.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === ordered.length - 1 ? 0.4 : 1, fontSize: 11 }}>↓</button>
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  );
                })}
              </section>

              <section className="section">
                <div className="section-head">
                  <span className="index">04</span>
                  <div>
                    <h3>Schedule</h3>
                    <p>When the digest sends. Stored now; the daily cron still fires until per-recipient dispatch ships.</p>
                  </div>
                  <span className="label">{form.schedule?.frequency || 'daily'}</span>
                </div>
                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Frequency</span>
                  <div className="segmented" role="group" aria-label="Frequency">
                    {['daily', 'weekly', 'off'].map((fq) => (
                      <button key={fq} type="button" className={(form.schedule?.frequency || 'daily') === fq ? 'is-active' : ''} onClick={() => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), frequency: fq } }))}>{fq}</button>
                    ))}
                  </div>
                </div>
                <div className="field-grid">
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Send hour (0–23)</span>
                    <input type="number" min="0" max="23" value={form.schedule?.sendHour ?? 7} onChange={(e) => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), sendHour: Number(e.target.value) } }))} />
                  </label>
                  {form.schedule?.frequency === 'weekly' ? (
                    <label className="field" style={{ display: 'grid', gap: 6 }}>
                      <span className="label">Weekday</span>
                      <select value={form.schedule?.weekday ?? 1} onChange={(e) => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), weekday: Number(e.target.value) } }))}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (<option key={i} value={i}>{d}</option>))}
                      </select>
                    </label>
                  ) : null}
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Timezone</span>
                    <input value={form.schedule?.timezone || ''} onChange={(e) => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), timezone: e.target.value } }))} />
                  </label>
                </div>
              </section>

              <section className="section">
                <div className="section-head">
                  <span className="index">05</span>
                  <div>
                    <h3>Documents feeding the summary</h3>
                    <p>The most recent uploads from the home client&apos;s Source Library.</p>
                  </div>
                  <span className="label">{docs.length} doc{docs.length === 1 ? '' : 's'}</span>
                </div>
                {docs.length ? (
                  <div style={{ display: 'grid', gap: 0 }}>
                    {docs.map((d) => (
                      <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: 'var(--vrk-ink-soft, #5a5346)', borderBottom: '1px solid rgba(42,36,32,0.1)', padding: '8px 2px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                        <span style={{ fontFamily: 'var(--vrk-mono, monospace)' }}>{d.chars}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No knowledge-base docs found for this client.</p>
                )}
              </section>

              {saveStatus?.kind === 'error' && <p className="hint-danger">{saveStatus.msg}</p>}
              {sendStatus?.kind === 'error' && <p className="hint-danger">{sendStatus.msg}</p>}
              <div id="email-digest-settings-actionbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
                <span className="hint">{
                  sendStatus && sendStatus.kind !== 'error' ? sendStatus.msg
                    : saveStatus && saveStatus.kind !== 'error' ? saveStatus.msg
                      : 'Generate & Send saves settings, refreshes digest data, then emails from the saved result.'
                }</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {termLines.length > 0 && !termOpen ? (
                    <button type="button" className="btn btn-outline" onClick={() => setTermOpen(true)}>Terminal</button>
                  ) : null}
                  <button type="button" className="btn btn-outline" onClick={save} disabled={saveStatus?.kind === 'pending' || sendStatus?.kind === 'pending'}>{saveStatus?.kind === 'pending' ? 'Saving…' : 'Save Config'}</button>
                  <button type="button" className="btn" style={{ background: '#2a2420', color: '#fff', borderColor: '#2a2420' }} onClick={runAndSend} disabled={sendStatus?.kind === 'pending' || saveStatus?.kind === 'pending'}>{sendStatus?.kind === 'pending' ? 'Working…' : 'Generate & Send'}</button>
                </div>
              </div>

              {termOpen && termLines.length > 0 ? (
                <div id="intake-modal-terminal-col" style={{ marginTop: 14 }}>
                  <div id="intake-modal-terminal-titlebar">
                    <span id="intake-modal-terminal-title">digest.generate-send</span>
                    <button
                      type="button"
                      aria-label="Close terminal"
                      onClick={() => setTermOpen(false)}
                      style={{ marginLeft: 'auto', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', font: '700 12px/1 var(--vrk-mono, monospace)', opacity: 0.7 }}
                    >
                      ✕ close
                    </button>
                  </div>
                  <div id="intake-modal-terminal-embed" ref={termRef}>
                    {termLines.map((line, i) => (
                      <div key={`dt-${i}`} className={`term-line term-${line.type}`}>{line.text}</div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )
      ) : (
        // ── EMAIL PREVIEW tab — the rendered email + send ──
        <>
          <div className="tile-detail-tab-content">
            {previewLoading ? (
              <div style={emptyWrap}><span style={emptyLabel}>{isTemplate ? 'Loading template…' : 'Gathering live data…'}</span></div>
            ) : previewError ? (
              <div style={emptyWrap}><span style={emptyLabel}>Preview failed</span><span style={emptyBody}>{previewError}</span></div>
            ) : (
              <div className="tile-detail-tab-pane" style={{ padding: 0, height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {preview?.html ? (
                  <iframe
                    title="Daily digest email"
                    srcDoc={preview.html}
                    style={{ width: '100%', flex: 1, minHeight: 560, border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8, background: '#fff' }}
                  />
                ) : (
                  <div style={emptyWrap}><span style={emptyLabel}>No email content</span></div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Create Client: website-less workspace (template for from-scratch signups) ──
export function AdminCreateClientView({ user }) {
  const [companyName, setCompanyName] = useState('');
  const [ideaDescription, setIdeaDescription] = useState('');
  const [status, setStatus] = useState(null); // { kind, msg, clientId }
  const [runStatus, setRunStatus] = useState(null); // { kind, msg }

  const create = useCallback(async () => {
    if (!user) return;
    if (!companyName.trim()) { setStatus({ kind: 'error', msg: 'Enter a client name.' }); return; }
    setStatus({ kind: 'pending', msg: 'Creating…' });
    setRunStatus(null);
    try {
      const data = await authFetch(user, '/api/admin/create-client', {
        method: 'POST',
        body: JSON.stringify({ companyName, ideaDescription }),
      });
      setStatus({ kind: 'ok', msg: `Created ${data.clientId}. Run its first brief below, then set it as Home in the Email Digest settings.`, clientId: data.clientId });
      setCompanyName('');
      setIdeaDescription('');
    } catch (e) {
      setStatus({ kind: 'error', msg: e.message });
    }
  }, [user, companyName, ideaDescription]);

  const runBrief = useCallback(async () => {
    const cid = status?.clientId;
    if (!user || !cid) return;
    setRunStatus({ kind: 'pending', msg: 'Running brief… (~1 min)' });
    try {
      await authFetch(user, `/api/dashboard/marketing-brief/run?as=${encodeURIComponent(cid)}`, { method: 'POST', body: '{}' });
      setRunStatus({ kind: 'ok', msg: 'Brief generated. It will appear in the email + Email Digest.' });
    } catch (e) {
      setRunStatus({ kind: 'error', msg: e.message });
    }
  }, [user, status]);

  return (
    <div className="tile-detail-bento-cell tile-detail-tabbed-container">
      <div className="tile-detail-tab-content">
        <div className="tile-detail-tab-pane custom-brief-submit-pane">
          <section className="mb-config-section">
            <div className="mb-config-section-head">
              <span className="mb-config-section-index">01</span>
              <div>
                <h4>New website-less client</h4>
                <p>Creates a workspace with no site attached — the template for survey-only / email-only / from-scratch signups. Feed it via uploads and a brief run after switching to it in the client dropdown.</p>
              </div>
            </div>
            <label className="mb-config-field">
              <span className="mb-config-label">Client name</span>
              <input className="mb-config-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Bryan Balli" />
            </label>
            <label className="mb-config-field">
              <span className="mb-config-label">Idea / positioning (no website)</span>
              <textarea className="mb-config-textarea" rows={4} value={ideaDescription} onChange={(e) => setIdeaDescription(e.target.value)} placeholder="What this brand/person is about — seeds the brief's search plan in place of a website." />
            </label>
          </section>
          {status?.kind === 'error' && <p className="mb-config-error">{status.msg}</p>}
          {runStatus?.kind === 'error' && <p className="mb-config-error">{runStatus.msg}</p>}
          <div className="mb-config-actionbar">
            <span className="mb-config-actionbar-note">
              {runStatus && runStatus.kind !== 'error' ? runStatus.msg
                : status && status.kind !== 'error' ? status.msg
                : 'Owner: you (admin). Added to your client dropdown automatically.'}
            </span>
            <div className="mb-config-actionbar-buttons">
              <button type="button" className="tile-foot-rerun-btn" onClick={create} disabled={status?.kind === 'pending'}>{status?.kind === 'pending' ? 'Creating…' : 'Create Client'}</button>
              {status?.clientId ? (
                <button type="button" className="mb-config-mini-btn" onClick={runBrief} disabled={runStatus?.kind === 'pending'}>{runStatus?.kind === 'pending' ? 'Running…' : 'Run brief'}</button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const emptyWrap = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 400, gap: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'center', padding: 40 };
const emptyLabel = { fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.7 };
const emptyBody = { fontSize: 13, lineHeight: 1.6, maxWidth: 360 };
