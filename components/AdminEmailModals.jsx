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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SECTIONS, UI_GROUP_ORDER } from '../features/email-digest/sections.registry.cjs';
import { computeNextRunAt } from '../features/email-digest/scheduler.cjs';

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

// The new consolidated POST-only admin route (Phase 3) — one action per
// call, replacing the old digest-config POST/GET split and daily-digest's
// GET ?preview=/?send=1 query-param contract. See app/api/admin/email-digest
// /route.js for the five actions (config/status/retry/reset-breaker/preview/
// send-now); this is the one call site every UI action below goes through.
function callEmailDigest(user, action, payload = {}) {
  return authFetch(user, '/api/admin/email-digest', {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
}

// Granular email section toggles, grouped. Each entry is
// [include key, card title, card description, customize cardId, platformIcon?].
// One key = one rendered section in the digest's render.js buildEmailHtml, so
// the EMAIL PREVIEW and the sent email match. The 4th element opens the
// dashboard card that owns that section's own settings (null = no card).
// Creative Brief is opt-in (off). Grouped by the brief each section belongs
// to — mirrors the email's top-down order.
//
// Derived from the single section registry (features/email-digest/
// sections.registry.cjs) — a plain-data CJS module with zero requires, safe
// to import into this client component (unlike _digest-config.js, which
// requires firebase-admin.cjs and can never be imported client-side). Add,
// remove, relabel, or reorder a row there, not here. Group/row order comes
// from the registry's UI_GROUP_ORDER + each row's uiOrder — genuinely
// different from the registry's own array order (which is INCLUDE_KEYS
// order, load-bearing for the email's default render order) — see the
// uiOrder field doc comment in sections.registry.cjs.
const SECTION_GROUPS = UI_GROUP_ORDER.map((groupLabel) => [
  groupLabel,
  SECTIONS
    .filter((s) => s.uiGroup === groupLabel)
    .sort((a, b) => a.uiOrder - b.uiOrder)
    .map((s) => [s.key, s.uiLabel, s.uiHint, s.relatedCardId, s.platformIcon]),
]);
const ALL_SECTION_KEYS = SECTION_GROUPS.flatMap(([, items]) => items.map(([k]) => k));

// Sections whose data comes from OUR accounts (our GA4 property, our Firestore
// counts, our Vercel project, the admin's calendar) rather than from the
// client's own. Flipping one to DEMO renders it as an empty slot — zeroed
// numbers, or an all-open calendar strip — so the client sees what the section
// would give them without seeing our data. Keyed by SECTION_GROUPS label; the
// `affects` copy names the exact section, because a group can hold sections the
// toggle does NOT touch (Top of email also holds Weather, which stays real).
// Mirrors DEMO_METRIC_GROUPS in features/intelligence/_digest-config.js — kept
// hardcoded here because that module is CJS + server-only (never import it into
// a client component).
const DEMO_METRIC_GROUP_BY_LABEL = {
  'Top of email': {
    key: 'calendar',
    affects: 'Show Calendar Agenda as demo (all days open)',
    hint: 'The agenda reads the connected Google Calendar. Demo renders the full 5-day swipe strip with every day marked “Open” — the client sees the schedule slot without seeing anyone’s real events. Weather is unaffected. Also skips the Calendar API call.',
  },
  'Web Performance': {
    key: 'webPerformance',
    affects: 'Show as demo (zeroed)',
    hint: 'These numbers come from HITLOOP’s own GA4 property. Demo renders the group at 0 with “not connected yet” copy — the client sees the slot, not our traffic. Also skips the GA4 call.',
  },
  Platform: {
    key: 'platform',
    affects: 'Show as demo (zeroed)',
    hint: 'These are HITLOOP’s own Firestore user/run counts — and they drive the subject line. Demo renders the group at 0 and zeroes the subject too, so a client’s email never quotes our sign-up numbers.',
  },
  Deployments: {
    key: 'deployments',
    affects: 'Show as demo (zeroed)',
    hint: 'These come from HITLOOP’s own Vercel project. Demo renders the group at 0 with “not connected yet” copy. Also skips the Vercel call.',
  },
};

// ── Email size estimator ──────────────────────────────────────────────────────
// Gmail clips emails past ~102KB and hides the rest behind "View entire
// message" — on 2026-07-04 a 157KB digest lost every section after Post
// Opportunities. Rough per-section KB weights (measured from real sends, with
// the route's EMAIL_CAPS applied — keep loosely in sync with EMAIL_CAPS in
// app/api/admin/daily-digest/route.js) so the admin sees clip risk while
// toggling, before anything is sent.
const EMAIL_BASE_KB = 4; // hero + CTA rows + footer + styles
const EST_SECTION_KB = {
  agenda: 8, weather: 2, execSummary: 5, videoPosts: 4, videoPromo: 4,
  execBriefLink: 1, contactHuman: 1,
  humanBrief: 2, opportunities: 7, suggestedReplies: 9, signals: 14,
  watchlistAccounts: 9, suggestedPosts: 5, planPreview: 3, watchlist: 7,
  redditAnalysis: 8, instagramAnalysis: 8, xMarketTalk: 8, followerPosts: 7,
  creativeBrief: 6,
  ga4Traffic: 3, topPages: 2, trafficSources: 2, keyEvents: 1, homepage: 4,
  platformOverview: 2, signups: 2, dashboards: 2, pipeline: 2,
  deployments: 2, runtimeErrors: 2,
};
const GMAIL_CLIP_KB = 102;
// Thresholds are in raw-HTML KB; Gmail clips at ~102KB of ENCODED body, and
// encoding overhead (unicode-heavy days) eats the difference — so warn early.
const EMAIL_WARN_KB = 65;
const EMAIL_DANGER_KB = 80;
function estimateEmailKb(include = {}) {
  return ALL_SECTION_KEYS.reduce(
    (kb, k) => kb + (include[k] ? (EST_SECTION_KB[k] || 2) : 0),
    EMAIL_BASE_KB
  );
}
// Groups whose cards can be shuffled up/down to set the email order. The CTA
// group isn't part of the section flow, so it stays fixed.
const NON_ORDERABLE_GROUPS = new Set(['Call to action']);
// Display labels for suggested-post platforms; the list itself comes from the
// server (form.postPlatforms keys), so adding a platform in _digest-config
// surfaces a checkbox here automatically. Unknown keys fall back to capitalized.
const PLATFORM_LABELS = { x: 'X', thread: 'Thread opener', discord: 'Discord', reddit: 'Reddit', instagram: 'Instagram' };
const PLATFORM_SECTION_LABELS = { x: 'X', reddit: 'Reddit', instagram: 'Instagram' };

function guardIncludeForAvailability(include = {}, availability = {}) {
  const next = { ...(include || {}) };
  if (availability.x === false) next.watchlist = false;
  if (availability.reddit === false) next.redditAnalysis = false;
  if (availability.instagram === false) next.instagramAnalysis = false;
  if (availability.x === false) next.xMarketTalk = false;
  return next;
}

function formatDigestSendHour(hour) {
  const normalizedHour = Number.isFinite(Number(hour))
    ? ((Number(hour) % 24) + 24) % 24
    : 7;
  const period = normalizedHour >= 12 ? 'PM' : 'AM';
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour}:00 ${period}`;
}

// Real abbreviation for the CURRENT date, not a hardcoded 'CST' that lies
// half the year (America/Chicago is CDT roughly March-November). Falls back
// to the raw IANA string only if Intl can't resolve it (e.g. malformed
// saved value) — never a wrong-but-plausible-looking abbreviation.
function digestTimezoneLabel(timezone) {
  const tz = timezone || 'America/Chicago';
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
  } catch {
    return tz;
  }
}

// "Wed, Aug 20 · 7:00 AM CDT" — human display for a computeNextRunAt() ms
// epoch, in the schedule's own timezone (never the browser's local zone —
// an admin reviewing a client's schedule from a different timezone must see
// the client's time, not their own).
function formatNextRunAt(ms, timezone) {
  if (!Number.isFinite(ms)) return null;
  const tz = timezone || 'America/Chicago';
  try {
    const dateStr = new Date(ms).toLocaleString('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    return `${dateStr} ${digestTimezoneLabel(tz)}`;
  } catch {
    return new Date(ms).toISOString();
  }
}

// ── Email Digest: SETTINGS (params) + PREVIEW (rendered email + send) ─────────
export function AdminEmailDigestView({ user, onOpenCard, runWithTerminal, activeClientId }) {
  const [tab, setTab] = useState('settings'); // 'settings' | 'preview'
  const [clientsExpanded, setClientsExpanded] = useState(false); // "Include client briefs" collapsible — default collapsed

  // ── Settings state (params that drive the email) ──
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState('');
  const [form, setForm] = useState(null);
  const [docs, setDocs] = useState([]);
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState([]);
  const [marketInsights, setMarketInsights] = useState({ sourcePlatforms: [], platformAvailability: {} });
  const [ownerEmail, setOwnerEmail] = useState(''); // scoped client's signup email — recipient placeholder
  const [saveStatus, setSaveStatus] = useState(null);
  const [runState, setRunState] = useState({}); // { [clientId]: 'running' | 'done' | 'error: msg' }
  const [socialAccountStatus, setSocialAccountStatus] = useState({}); // connected accounts owned by the selected video client
  const [videoOwnerDigestConfig, setVideoOwnerDigestConfig] = useState(null);
  const videoOwnerClientId = form?.dailyVideo?.sourceClientId || clientId;
  const videoOwnerIsThisDigest = Boolean(videoOwnerClientId && videoOwnerClientId === clientId);
  const effectiveVideoOwnerConfig = videoOwnerIsThisDigest ? form : videoOwnerDigestConfig;
  const videoOwnerName = clients.find((c) => c.clientId === videoOwnerClientId)?.name || videoOwnerClientId || 'this client';

  useEffect(() => {
    if (!user || !videoOwnerClientId) { setSocialAccountStatus({}); return; }
    authFetch(user, '/api/social-posting/x-oauth', { method: 'POST', body: JSON.stringify({ action: 'accounts-list', clientId: videoOwnerClientId }) })
      .then((data) => setSocialAccountStatus(data.accounts || {}))
      .catch(() => setSocialAccountStatus({}));
  }, [user, videoOwnerClientId]);

  useEffect(() => {
    if (!user || !videoOwnerClientId || videoOwnerIsThisDigest) {
      setVideoOwnerDigestConfig(null);
      return;
    }
    let cancelled = false;
    setVideoOwnerDigestConfig(null);
    callEmailDigest(user, 'config', { clientId: videoOwnerClientId })
      .then((data) => { if (!cancelled) setVideoOwnerDigestConfig(data.config || null); })
      .catch(() => { if (!cancelled) setVideoOwnerDigestConfig(null); });
    return () => { cancelled = true; };
  }, [user, videoOwnerClientId, videoOwnerIsThisDigest]);

  const loadSettings = useCallback(async () => {
    if (!user) return;
    setSettingsLoading(true);
    setSettingsError('');
    try {
      // No `patch` field = load, per the config action's contract. Scoped to
      // the client loaded in the dashboard (falls back to the email-resolved
      // admin client server-side when activeClientId is empty).
      const data = await callEmailDigest(user, 'config', activeClientId ? { clientId: activeClientId } : {});
      setForm(data.config || null);
      setDocs(data.docs || []);
      setClientId(data.clientId || '');
      setClients(data.clients || []);
      setMarketInsights(data.marketInsights || { sourcePlatforms: [], platformAvailability: {} });
      setOwnerEmail(data.ownerEmail || '');
    } catch (e) {
      setSettingsError(e.message);
    } finally {
      setSettingsLoading(false);
    }
  }, [user, activeClientId]);

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

  const currentPlatformAvailability = useCallback((f = form) => {
    const activeClientId = f?.homeClientId || clientId;
    const selectedClient = clients.find((c) => c.clientId === activeClientId);
    return selectedClient?.platformAvailability || marketInsights?.platformAvailability || {};
  }, [clients, clientId, form, marketInsights]);

  const currentSourcePlatforms = useCallback((f = form) => {
    const activeClientId = f?.homeClientId || clientId;
    const selectedClient = clients.find((c) => c.clientId === activeClientId);
    return selectedClient?.marketInsightSourcePlatforms || marketInsights?.sourcePlatforms || [];
  }, [clients, clientId, form, marketInsights]);

  const save = useCallback(async () => {
    if (!user || !form) return;
    setSaveStatus({ kind: 'pending', msg: 'Saving…' });
    try {
      const guardedPatch = { ...form, include: guardIncludeForAvailability(form.include, currentPlatformAvailability(form)) };
      const data = await callEmailDigest(user, 'config', { clientId: activeClientId, patch: guardedPatch });
      setForm(data.config);
      if (data.marketInsights) setMarketInsights(data.marketInsights);
      setSaveStatus({ kind: 'ok', msg: 'Saved.' });
    } catch (e) {
      setSaveStatus({ kind: 'error', msg: e.message });
    }
  }, [user, form, currentPlatformAvailability, activeClientId]);

  // Master daily-email state for the loaded client — mirrors the server's
  // isCronEnrolled gate (enabled AND a real cadence). Drives the ON/OFF toggle.
  const dailyOn = form?.schedule?.enabled === true && (form?.schedule?.frequency || 'off') !== 'off';
  const scheduleTimezoneLabel = digestTimezoneLabel(form?.schedule?.timezone);
  // Live preview of the NEXT occurrence for the CURRENT (even unsaved) form
  // state — computeNextRunAt is the same pure, zero-dependency function the
  // dispatch route uses server-side (scheduler.cjs), so this always matches
  // what saving right now would actually schedule. Recomputes only when the
  // schedule fields actually change, not on every keystroke elsewhere in the
  // form.
  const previewNextRunAt = useMemo(() => {
    if (!dailyOn || !form?.schedule) return null;
    try { return computeNextRunAt(form.schedule, Date.now()); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyOn, form?.schedule?.enabled, form?.schedule?.frequency, form?.schedule?.sendHour, form?.schedule?.weekday, form?.schedule?.timezone]);

  // ── Preview state (the rendered email) ──
  // Default to LIVE so the preview = exactly what sends (same route code path,
  // same toggles, real data). Template is an opt-in "layout only" view.
  const [previewMode, setPreviewMode] = useState('live'); // 'live' | 'template'
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState(null); // { html, paragraph, placeholder }
  const [sendStatus, setSendStatus] = useState(null);
  // Generate & Send streams through the shared global run terminal
  // (DashboardPage `runWithTerminal` → the intake-modal terminal + RUNNING badge),
  // the same UX every other card run uses.

  // Render the preview honoring the current (even unsaved) include toggles, so
  // flipping a section off in SETTINGS and tabbing over shows it drop out.
  const loadPreview = useCallback(async (nextMode = 'template', includeFlags, contactUrl, order, postPlatforms, demoMetrics) => {
    if (!user) return;
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewMode(nextMode);
    try {
      // Scope the preview to this card's client so preview == sent per client.
      const previewClientId = form?.homeClientId || clientId || activeClientId || '';
      const payload = { clientId: previewClientId, mode: nextMode };
      if (includeFlags) payload.includeKeys = Object.entries(includeFlags).filter(([, v]) => v !== false).map(([k]) => k);
      // Live preview honors the current (even unsaved) form state so the
      // preview matches what Send Now would actually use before saving.
      if (nextMode === 'live' && contactUrl) payload.contactUrl = contactUrl;
      if (nextMode === 'live' && Array.isArray(order) && order.length) payload.order = order;
      if (nextMode === 'live' && postPlatforms) payload.postPlatforms = Object.entries(postPlatforms).filter(([, v]) => v).map(([k]) => k);
      if (nextMode === 'live' && demoMetrics) payload.demoGroups = Object.entries(demoMetrics).filter(([, v]) => v).map(([k]) => k);
      const data = await callEmailDigest(user, 'preview', payload);
      setPreview({ html: data.html || '', paragraph: data.paragraph || data.summary?.paragraph || '', placeholder: Boolean(data.placeholder) });
    } catch (e) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [user, form?.homeClientId, clientId, activeClientId]);

  const runAndSend = useCallback(async () => {
    if (!user || typeof runWithTerminal !== 'function') return;
    const freshnessToken = `digest-ui-${Date.now().toString(36)}`;
    // Stable per-click request id (P1-2 fix, 2026-08-17 review pass):
    // generated ONCE for this click and held across the whole task closure
    // below, including the final send call. If this exact click's request
    // is ever resubmitted (e.g. the browser/proxy retries after a perceived
    // timeout), the server derives the SAME manual delivery id from this
    // same id — one email, not two. A genuinely new click always gets a
    // fresh id here, so it never collapses with a different click's send.
    const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    setSendStatus({ kind: 'pending', msg: 'Saving settings…' });
    // Stream through the shared global run terminal — same modal + minimize/reopen
    // RUNNING badge every other card run uses. advance() = phase transition (settles
    // the prior line ✓ + opens a new active line); note() = a dim status line.
    try {
      await runWithTerminal({
        title: 'GENERATE & SEND',
        brand: 'Email digest',
        host: freshnessToken,
        stages: [{ pfx: '[SAVE]', text: 'saving your settings…' }],
        task: async ({ advance, note }) => {
          // Persist current toggles first so the send uses exactly what you configured
          // (the send reads saved config, not unsaved form state).
          let savedConfig = form;
          if (form) {
            const guardedPatch = { ...form, include: guardIncludeForAvailability(form.include, currentPlatformAvailability(form)) };
            const saved = await callEmailDigest(user, 'config', { clientId: activeClientId, patch: guardedPatch });
            if (saved?.config) {
              savedConfig = saved.config;
              setForm(saved.config);
            }
            if (saved?.marketInsights) setMarketInsights(saved.marketInsights);
          }
          note('Saved config ✓');
          // Scope everything to this card's saved home client. The server separately
          // resolves the configured video source and destination social account.
          const sendClientId = savedConfig?.homeClientId || activeClientId || clientId || '';

          // Refresh intelligence BEFORE sending, so the email renders today's data
          // rather than whatever the last cron left behind. The send route itself
          // never refreshes inline (that caused time-boxed sends + orphaned
          // "running" brief_runs — commit 71312f8b split the paths), so we drive
          // the worker's phases from here, each one a separate sub-300s request.
          //
          // We run `signals` + `analysis` only, NOT `modules`: the modules phase
          // renders creative/video, and a manual send must never kick off a video
          // render. `signals` re-runs Scout + the Reddit/Instagram/web searches;
          // `analysis` runs the platform analyzers that write the fields the email
          // actually reads (reportSnapshot.redditAnalysis etc.) — without it the
          // section renders its empty state even with fresh search results stored.
          //
          // `force=1` on the signals phase: a human clicking Generate & Send is
          // explicitly asking for a fresh report, so it bypasses Scout's <6h
          // freshness skip. Without it the button silently reused whatever the
          // last run stored and reported "scout ✓" for a scout that never ran —
          // config changes appeared to have no effect. The daily cron still
          // sends no `force` and keeps the skip, which is where the cost saving
          // actually matters (unattended, once a day, ~24h since the last run).
          const refreshPhase = async (phase, label) => {
            try {
              // allowX + force only on the signals phase: allowX opts this send
              // into the PAID X brand search (refreshXMarketTalk). The daily
              // cron never sends either.
              const signalsOnly = phase === 'signals' ? '&allowX=1&force=1' : '';
              const res = await authFetch(user, `/api/worker/pre-digest-refresh?phase=${phase}&clientId=${encodeURIComponent(sendClientId)}&freshnessToken=${encodeURIComponent(freshnessToken)}${signalsOnly}`, { method: 'POST' });
              const r = Array.isArray(res?.results) ? res.results[0] : null;
              if (phase === 'signals') {
                // Distinguish "scouted" from "skipped as fresh" — they used to
                // render identically as "scout ✓", which is what made a skipped
                // scout impossible to spot from the terminal.
                const scoutMark = r?.scout?.skipped
                  ? `skipped (${r.scout.skipped}${r.scout.ageMinutes != null ? `, ${r.scout.ageMinutes}m old` : ''})`
                  : (r?.scout?.ok ? '✓' : '✗');
                note(`· scout ${scoutMark} · watchlist ${r?.watchlist?.ok ? '✓' : '✗'} · X market talk ${r?.platformSignals?.xMarketTalk ?? 'n/a'}`);
              } else {
                note(`· reddit brief ${r?.redditAnalysis?.ok ? '✓' : (r?.redditAnalysis?.reason || 'skipped')} · X market talk ${r?.xMarketTalkAnalysis?.ok ? '✓' : (r?.xMarketTalkAnalysis?.reason || 'skipped')} · exec summary ${r?.executiveSummary?.ok ? '✓' : 'skipped'}`);
              }
            } catch (err) {
              // A failed refresh must not block the send — the email falls back to
              // the last saved data and the affected sections show their empty state.
              note(`· ${label} refresh failed — sending from last saved data (${err.message})`);
            }
          };
          advance('[REFRESH]', 'Re-running searches — scout, watchlist, Reddit/Instagram/web…');
          setSendStatus({ kind: 'pending', msg: 'Refreshing intelligence…' });
          await refreshPhase('signals', 'signals');
          advance('[ANALYZE]', 'Running the platform briefs over the fresh signals…');
          await refreshPhase('analysis', 'analysis');

          advance('[SEND]', 'Generating and sending the email with the latest completed video…');
          note('Manual send refreshes intelligence but never starts a video render.');
          setSendStatus({ kind: 'pending', msg: 'Generating and sending email…' });
          const res = await callEmailDigest(user, 'send-now', { clientId: sendClientId || undefined, freshnessToken, requestId });
          (Array.isArray(res?.log) ? res.log : []).forEach((l) => note(l.text));
          if (res?.subject) note(`Subject · ${res.subject}`);
          setSendStatus({ kind: 'ok', msg: 'Email sent with the latest completed video.' });
          return { doneText: 'Done ✓ — email generated and sent' };
        },
      });
    } catch (e) {
      // runWithTerminal already rendered the ✗ error line; only set the button
      // status if the failing step didn't already set a specific message.
      setSendStatus((s) => (s?.kind === 'error' ? s : { kind: 'error', msg: e.message }));
    }
  }, [user, form, runWithTerminal, currentPlatformAvailability, activeClientId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Reload the LIVE preview each time the PREVIEW tab is opened, so it reflects
  // the latest include toggles AND real data — i.e. what will actually send.
  useEffect(() => {
    if (tab === 'preview') loadPreview('live', guardIncludeForAvailability(form?.include, currentPlatformAvailability(form)), form?.contactUrl, form?.order, form?.postPlatforms, form?.demoMetrics);
  }, [tab, form, loadPreview, currentPlatformAvailability]);

  const isTemplate = previewMode === 'template';
  const platformAvailability = currentPlatformAvailability(form);
  const sourcePlatforms = currentSourcePlatforms(form);
  const effectiveInclude = guardIncludeForAvailability(form?.include, platformAvailability);
  // Live clip-risk estimate for the current (possibly unsaved) toggle combo.
  const estimatedEmailKb = estimateEmailKb(effectiveInclude);
  const sizeTier = estimatedEmailKb >= EMAIL_DANGER_KB ? 'danger' : estimatedEmailKb >= EMAIL_WARN_KB ? 'warn' : 'ok';

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
                  <span className="label">{ALL_SECTION_KEYS.filter((k) => effectiveInclude?.[k]).length}/{ALL_SECTION_KEYS.length} on · ~{estimatedEmailKb} KB</span>
                </div>

                <div
                  id="digest-size-estimate-banner"
                  role="status"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '11px 14px',
                    borderRadius: 10,
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    fontFamily: 'var(--vrk-body, inherit)',
                    border: `1px solid ${sizeTier === 'danger' ? '#d9a79c' : sizeTier === 'warn' ? '#d9c58a' : 'rgba(42,36,32,0.14)'}`,
                    background: sizeTier === 'danger' ? '#f7ece8' : sizeTier === 'warn' ? '#f6f0e2' : 'rgba(255,255,255,0.55)',
                    color: sizeTier === 'danger' ? '#a8392a' : sizeTier === 'warn' ? '#8a6a1f' : 'var(--vrk-ink-soft, #5a5346)',
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: 14, lineHeight: '18px' }}>{sizeTier === 'ok' ? '✓' : '⚠'}</span>
                  <span>
                    <strong>Estimated email size ~{estimatedEmailKb} KB.</strong>{' '}
                    {sizeTier === 'ok'
                      ? `Fits Gmail's ~${GMAIL_CLIP_KB} KB clip limit.`
                      : sizeTier === 'warn'
                        ? `Close to Gmail's ~${GMAIL_CLIP_KB} KB clip limit — on heavy news days the bottom sections may be cut off behind "View entire message". Consider turning off a heavy section.`
                        : `Likely to exceed Gmail's ~${GMAIL_CLIP_KB} KB clip limit — the bottom sections will be hidden behind "View entire message". Turn off heavy sections (each card shows its ~KB weight).`}
                  </span>
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
                  <span className="label">Market Insights platform gates</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {['x', 'reddit'].map((platform) => {
                      const on = platformAvailability?.[platform] !== false;
                      return (
                        <span key={platform} className="label" style={{ margin: 0, color: on ? 'var(--vrk-ink, #2a2420)' : 'var(--vrk-ink-soft, #5a5346)', opacity: on ? 1 : 0.55 }}>
                          {PLATFORM_SECTION_LABELS[platform] || platform}: {on ? 'on' : 'off'}
                        </span>
                      );
                    })}
                  </div>
                  <span className="hint">Platform “What&apos;s happening” sections are only toggleable when that source is enabled in Market Insights. Current sources: {sourcePlatforms.length ? sourcePlatforms.join(', ') : 'not loaded'}.</span>
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

                <div id="digest-daily-x-search-section" className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Market Talk on X in the daily email</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={form.dailyXSearch === true}
                      onChange={() => setForm((f) => ({ ...f, dailyXSearch: f.dailyXSearch !== true }))}
                      style={{ width: 16, minHeight: 16 }}
                    />
                    Let the daily cron run the paid X brand search
                  </label>
                  <span className="hint">⚠️ Spends X API credits unattended — up to 3 search calls per day, billed on the X credit model and not visible on the Operating Cost card. Off = the section only fills when you press Generate &amp; Send, which always runs the search.</span>
                </div>

                <div id="digest-autopublish-section" className="field" style={{ display: 'grid', gap: 10 }}>
                  <span className="label">Auto-Publish (daily video)</span>
                  <span className="hint">Auto publishes with no human review. Approval emails a button and publishes nothing until it is clicked.</span>
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Publish video for</span>
                    <select
                      value={form.dailyVideo?.sourceClientId || ''}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        dailyVideo: { ...(f.dailyVideo || {}), sourceClientId: e.target.value },
                      }))}
                    >
                      <option value="">This digest client</option>
                      {clients.map((c) => (
                        <option key={c.clientId} value={c.clientId}>{c.name}</option>
                      ))}
                    </select>
                    <span className="hint">This client owns the caption, approval policy, connected X account, post, and approval links. This email only controls its recipients and layout.</span>
                  </label>
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Take completed video from</span>
                    <select
                      value={form.dailyVideo?.assetSourceClientId || ''}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        dailyVideo: { ...(f.dailyVideo || {}), assetSourceClientId: e.target.value },
                      }))}
                    >
                      <option value="">Publishing client’s saved videos</option>
                      {clients.map((c) => (
                        <option key={c.clientId} value={c.clientId}>{c.name} · saved videos</option>
                      ))}
                    </select>
                    <span className="hint">Select Hitloop when the admin created the Remix centrally. The file is borrowed; publishing still uses the client above. No new render is started.</span>
                  </label>
                  {['x', 'instagram'].map((platform) => {
                    const live = platform === 'x';
                    const p = effectiveVideoOwnerConfig?.autoPublish?.platforms?.[platform] || { mode: 'off', delayMinutes: 0, maxPerDay: 1 };
                    const acct = socialAccountStatus?.[platform];
                    const label = PLATFORM_SECTION_LABELS[platform] || platform;
                    const patchPlatform = (fields) => setForm((f) => ({
                      ...f,
                      autoPublish: {
                        ...(f.autoPublish || {}),
                        platforms: { ...(f.autoPublish?.platforms || {}), [platform]: { ...p, ...fields } },
                      },
                    }));
                    return (
                      <div
                        key={platform}
                        id={`digest-autopublish-${platform}-row`}
                        data-section="digest-autopublish"
                        style={{ display: 'grid', gap: 8, padding: '10px 12px', border: '1px solid var(--vrk-line, rgba(42,36,32,0.12))', borderRadius: 10, opacity: live ? 1 : 0.5 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <span className="label" style={{ margin: 0 }}>{label}</span>
                          {live ? (
                            <span className="hint" style={{ margin: 0 }}>
                              {acct?.connected ? `Posts as @${acct.username || 'unknown'}` : 'Not connected — connect in Social Accounts'}
                            </span>
                          ) : <span className="hint" style={{ margin: 0 }}>Coming soon</span>}
                        </div>
                        <div className="segmented" role="group" aria-label={`${label} publish mode`}>
                          {['off', 'auto', 'approval'].map((m) => (
                            <button key={m} type="button" disabled={!live || !videoOwnerIsThisDigest || (m !== 'off' && !acct?.connected)} className={(p.mode || 'off') === m ? 'is-active' : ''} onClick={() => patchPlatform({ mode: m })}>
                              {m}
                            </button>
                          ))}
                        </div>
                        {live ? (
                          <div style={{ display: 'grid', gap: 8 }}>
                            <span className="hint">
                              {videoOwnerIsThisDigest
                                ? `Publishing is owned by ${videoOwnerName}.`
                                : `${videoOwnerName} owns this publishing policy. Change it from that client’s Email Digest card.`}
                            </span>
                            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                              Delay (min)
                              <input type="number" min={0} max={1440} disabled={!videoOwnerIsThisDigest} value={p.delayMinutes ?? 0} onChange={(e) => patchPlatform({ delayMinutes: Number(e.target.value) || 0 })} style={{ width: 70 }} />
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                              Daily cap
                              <input type="number" min={1} max={10} disabled={!videoOwnerIsThisDigest} value={p.maxPerDay ?? 1} onChange={(e) => patchPlatform({ maxPerDay: Number(e.target.value) || 1 })} style={{ width: 60 }} />
                            </label>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
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
                  const demoGroup = DEMO_METRIC_GROUP_BY_LABEL[groupLabel];
                  const demoKey = demoGroup?.key;
                  const demoOn = !!(demoKey && form.demoMetrics?.[demoKey]);
                  return (
                    <div key={groupLabel} style={{ display: 'grid', gap: 8 }}>
                      <span className="label" style={{ marginTop: 4 }}>{groupLabel}</span>
                      {demoKey ? (
                        <div
                          id={`email-digest-demo-metrics-${demoKey}-row`}
                          data-section="email-digest-demo-metrics"
                          style={{ display: 'grid', gap: 2 }}
                        >
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={demoOn}
                              onChange={() => setForm((f) => ({ ...f, demoMetrics: { ...(f.demoMetrics || {}), [demoKey]: !demoOn } }))}
                              style={{ width: 16, minHeight: 16 }}
                            />
                            {demoGroup.affects}
                          </label>
                          <span className="hint">{demoGroup.hint}</span>
                        </div>
                      ) : null}
                      {/* Columns live in CSS (#email-digest-settings-shell .toggle-grid) —
                          NOT inline — so the ≤860px single-column collapse can win on phones. */}
                      <div className="toggle-grid" role="group" aria-label={`${groupLabel} sections`}>
                        {ordered.map(([key, title, desc, cardId, requiredPlatform], idx) => {
                          const on = !!effectiveInclude?.[key];
                          const platformEnabled = !requiredPlatform || platformAvailability?.[requiredPlatform] !== false;
                          const disabled = !platformEnabled;
                          const effectiveOn = on && !disabled;
                          const toggle = () => {
                            if (disabled) return;
                            setForm((f) => ({ ...f, include: { ...(f.include || {}), [key]: !on } }));
                          };
                          return (
                            <div
                              key={key}
                              role="button"
                              tabIndex={disabled ? -1 : 0}
                              aria-pressed={effectiveOn}
                              aria-disabled={disabled}
                              className={`toggle-card${effectiveOn ? ' is-on' : ''}`}
                              style={{ position: 'relative', opacity: disabled ? 0.48 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
                              onClick={toggle}
                              onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } }}
                            >
                              <span className="check">{effectiveOn ? '✓' : ''}</span>
                              <span style={{ minWidth: 0 }}>
                                <span className="toggle-title">{title}</span>
                                <span className="toggle-desc">{disabled ? `Enable ${PLATFORM_SECTION_LABELS[requiredPlatform] || requiredPlatform} in Market Insights to use this section.` : `${desc}${(EST_SECTION_KB[key] || 0) >= 7 ? ` · ~${EST_SECTION_KB[key]} KB` : ''}`}</span>
                                {cardId && onOpenCard && !disabled ? (
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
                                  <button type="button" aria-label={`Move ${title} up`} disabled={disabled || idx === 0} onClick={(e) => { e.stopPropagation(); if (!disabled) move(key, -1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: disabled || idx === 0 ? 'not-allowed' : 'pointer', opacity: disabled || idx === 0 ? 0.4 : 1, fontSize: 11 }}>↑</button>
                                  <button type="button" aria-label={`Move ${title} down`} disabled={disabled || idx === ordered.length - 1} onClick={(e) => { e.stopPropagation(); if (!disabled) move(key, 1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: disabled || idx === ordered.length - 1 ? 'not-allowed' : 'pointer', opacity: disabled || idx === ordered.length - 1 ? 0.4 : 1, fontSize: 11 }}>↓</button>
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

              <section className="section" id="digest-daily-schedule-section">
                <div className="section-head">
                  <span className="index">04</span>
                  <div>
                    <h3>Daily email</h3>
                    <p>Master switch for {clientId || 'this client'}. ON enrolls it in the daily refresh + send crons; OFF means no daily crawl, brief, or email (the signup Creative Brief still ships). Off by default — save to apply.</p>
                  </div>
                  <span className="label" style={dailyOn ? { color: 'var(--vrk-success, #285f3b)' } : undefined}>{dailyOn ? 'ON' : 'OFF'}</span>
                </div>
                <div className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Daily email</span>
                  <div className="segmented" role="group" aria-label="Daily email">
                    <button type="button" className={dailyOn ? 'is-active' : ''} onClick={() => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), enabled: true, frequency: (p.schedule?.frequency && p.schedule.frequency !== 'off') ? p.schedule.frequency : 'daily' } }))}>ON</button>
                    <button type="button" className={!dailyOn ? 'is-active' : ''} onClick={() => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), enabled: false, frequency: 'off' } }))}>OFF</button>
                  </div>
                </div>
                {dailyOn ? (
                  <div className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Cadence</span>
                    <div className="segmented" role="group" aria-label="Cadence">
                      {['daily', 'weekly'].map((fq) => (
                        <button key={fq} type="button" className={(form.schedule?.frequency || 'daily') === fq ? 'is-active' : ''} onClick={() => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), frequency: fq } }))}>{fq}</button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <label className="field" style={{ display: 'grid', gap: 6 }}>
                  <span className="label">Recipient</span>
                  <input
                    type="email"
                    value={form.recipientEmail || ''}
                    placeholder={ownerEmail ? `${ownerEmail} (client's signup email)` : 'name@example.com — leave blank to send to the admin address'}
                    onChange={(e) => setForm((p) => ({ ...p, recipientEmail: e.target.value }))}
                  />
                  <span className="oc-note" style={{ font: '500 11px/1.5 var(--vrk-mono, monospace)', opacity: 0.7 }}>Where this client&apos;s daily email is sent. Blank = the admin address (the client is never emailed until you set this).</span>
                </label>
                <div className="field-grid">
                  <label className="field" style={{ display: 'grid', gap: 6 }}>
                    <span className="label">Send time</span>
                    <select value={form.schedule?.sendHour ?? 7} onChange={(e) => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), sendHour: Number(e.target.value) } }))}>
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>{formatDigestSendHour(hour)} {scheduleTimezoneLabel}</option>
                      ))}
                    </select>
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
                    <span className="label">Timezone (IANA)</span>
                    <input value={form.schedule?.timezone || ''} placeholder="America/Chicago" onChange={(e) => setForm((p) => ({ ...p, schedule: { ...(p.schedule || {}), timezone: e.target.value } }))} />
                  </label>
                </div>
                {dailyOn ? (
                  <div id="digest-next-send-preview" className="oc-note" style={{ font: '500 12px/1.5 var(--vrk-mono, monospace)', opacity: 0.85 }}>
                    {previewNextRunAt
                      ? <>Next send (if saved now): {formatNextRunAt(previewNextRunAt, form.schedule?.timezone)} — arrives within ~30 min after the dispatcher's next check.</>
                      : 'Next send time unavailable — check the timezone value above.'}
                  </div>
                ) : null}
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
                      : 'Generate & Send Email saves settings, builds the email from saved digest data, and attaches the latest completed video.'
                }</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-outline" onClick={save} disabled={saveStatus?.kind === 'pending' || sendStatus?.kind === 'pending'}>{saveStatus?.kind === 'pending' ? 'Saving…' : 'Save Config'}</button>
                  <button type="button" className="btn" style={{ background: '#2a2420', color: '#fff', borderColor: '#2a2420' }} onClick={runAndSend} disabled={sendStatus?.kind === 'pending' || saveStatus?.kind === 'pending'}>{sendStatus?.kind === 'pending' ? 'Working…' : 'Generate & Send Email'}</button>
                </div>
              </div>
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
