import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  createSocialPost,
  generatePromoCopy,
  postNow,
  readSocialQueue,
  runPostingAgents,
  schedulePost,
} from '../../../../features/social-posting/twitter-service.js';
import { getSocialAccount } from '../../../../features/social-posting/social-accounts.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const require = createRequire(import.meta.url);
const crypto = require('crypto');
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { getHeaderValue, safeSecretEquals, buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');
const briefSummary = require('../../../../features/intelligence/_brief-summary.js');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { getMarketInsightPlatformState } = require('../../../../features/intelligence/_market-insight-platform-state.js');
const briefIntel = require('../../../../features/intelligence/_brief-intel.js');
const { signApprovalToken } = require('../../../../api/_lib/social-approval.cjs');

// ── Config ──────────────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO = process.env.DIGEST_EMAIL || 'bryanballi@gmail.com';
const DIGEST_FROM = process.env.DIGEST_FROM || 'HITLOOP Daily <digest@hitloop.agency>';
const WORKER_SECRET = process.env.WORKER_SECRET;
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_h2AHIKHmJu7eV1DdmiTra2WFmPv6';
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_xmgNCNc6fHyZZinuszh8B6ZB';
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '532567174';
const RUN_STATUS_BUCKETS = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'provisioning'];
const DIGEST_EVENT_NAMES = [
  'sign_up',
  'sign_in',
  'sign_out',
  'dashboard_created',
  'pipeline_rerun',
  'pipeline_cancelled',
  'seo_rerun',
  'tile_opened',
  'theme_changed',
  'tier_modal_opened',
  'homepage_nav_click',
  'homepage_cta_click',
  'homepage_portfolio_click',
  'homepage_outbound_click',
  'homepage_button_click',
  'homepage_form_focus',
  'homepage_form_change',
  'homepage_scroll_depth',
  'homepage_web_vital',
];
// Personal calendar to surface in the "Today's Agenda" section. Defaults to the
// digest recipient's calendar. The digest service account must have read access
// to this calendar (share it with FIREBASE_ADMIN_CLIENT_EMAIL).
const DIGEST_CALENDAR_ID = process.env.DIGEST_CALENDAR_ID || DIGEST_TO;
const DIGEST_TIMEZONE = process.env.DIGEST_TIMEZONE || 'America/Chicago';
const DIGEST_X_HANDLE = String(process.env.DIGEST_X_HANDLE || 'bai_ee').replace(/^@+/, '');
const DIGEST_X_POST_DELAY_MINUTES = Math.max(1, Math.min(60, Number(process.env.DIGEST_X_POST_DELAY_MINUTES) || 2));
const COMPAT_INCLUDE_KEYS = ['redditAnalysis', 'instagramAnalysis', 'suggestedReplies'];
const DIGEST_INCLUDE_KEYS = Array.from(new Set([...(digestConfig.INCLUDE_KEYS || []), ...COMPAT_INCLUDE_KEYS]));

// ── Helpers ─────────────────────────────────────────────────────────────────

export function appOrigin() {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'https://hitloop.agency';
  return String(raw).replace(/\/+$/, '');
}

function mergeCompatInclude(include = {}, rawInclude = {}) {
  const next = { ...(include || {}) };
  for (const key of COMPAT_INCLUDE_KEYS) {
    if (typeof rawInclude?.[key] === 'boolean') next[key] = rawInclude[key];
  }
  return next;
}

async function readRawDigestInclude(clientId) {
  if (!clientId) return {};
  try {
    const snap = await fb.adminDb.collection('digest_config').doc(clientId).get();
    return snap.exists ? (snap.data()?.include || {}) : {};
  } catch {
    return {};
  }
}

function appUrl(path = '/') {
  const cleanPath = String(path || '/').startsWith('/') ? path : `/${path}`;
  return `${appOrigin()}${cleanPath}`;
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function readAggregateCount(snapshot) {
  const count = snapshot?.data?.()?.count;
  return typeof count === 'number' ? count : 0;
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
}

function incrementCounter(counter, key, amount = 1) {
  const normalized = String(key || 'unknown').trim() || 'unknown';
  counter[normalized] = (counter[normalized] || 0) + amount;
}

function topCounterEntries(counter, limit = 8) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function hasValidSecret(request) {
  if (!WORKER_SECRET) return false;
  const provided =
    getHeaderValue(request.headers, 'x-worker-secret') ||
    getHeaderValue(request.headers, 'authorization')?.replace(/^Bearer\s+/i, '');
  return safeSecretEquals(provided, WORKER_SECRET);
}

/** Vercel cron sends a special header we can verify */
function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Fail closed in production — missing CRON_SECRET must not authorize cron execution.
    if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
      return false;
    }
    return true; // allow in dev/preview for convenience
  }
  const provided = getHeaderValue(request.headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

export function HEAD(request) {
  if (!hasValidSecret(request) && !hasValidCronSecret(request)) {
    return new NextResponse(null, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

// ── Data collectors ─────────────────────────────────────────────────────────

async function getFirebaseMetrics() {
  const db = fb.adminDb;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [usersCountSnap, clientsCountSnap, runsCountSnap] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('clients').count().get(),
    db.collection('brief_runs').count().get(),
  ]);

  const totalUsers = readAggregateCount(usersCountSnap);
  const totalClients = readAggregateCount(clientsCountSnap);
  const totalRuns = readAggregateCount(runsCountSnap);

  // New users in last 24h
  const newUsersSnap = await db
    .collection('users')
    .where('createdAt', '>=', yesterday)
    .get();
  const newUsers = newUsersSnap.size;
  const newUsersList = newUsersSnap.docs.map((d) => {
    const data = d.data();
    return {
      email: data.email || d.id,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || 'unknown',
      website: data.websiteUrl || data.website || null,
    };
  });

  const recentRunsSnap = await db
    .collection('brief_runs')
    .where('createdAt', '>=', yesterday)
    .get();
  const recentRuns = recentRunsSnap.size;
  const recentRunsList = recentRunsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: data.status || 'unknown',
      website: data.websiteUrl || data.url || null,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || 'unknown',
    };
  });

  // Runs by status. Keep this bounded so digest cost does not grow with the
  // total brief_runs volume.
  const statusSnapshots = await Promise.all(
    RUN_STATUS_BUCKETS.map((status) =>
      db.collection('brief_runs').where('status', '==', status).count().get()
    )
  );
  const statusCounts = {};
  let knownStatusTotal = 0;
  RUN_STATUS_BUCKETS.forEach((status, index) => {
    const count = readAggregateCount(statusSnapshots[index]);
    if (count > 0) {
      statusCounts[status] = count;
      knownStatusTotal += count;
    }
  });
  const unknownStatusCount = Math.max(0, totalRuns - knownStatusTotal);
  if (unknownStatusCount > 0) {
    statusCounts.unknown = unknownStatusCount;
  }

  return {
    totalUsers,
    newUsers,
    newUsersList,
    totalClients,
    totalRuns,
    recentRuns,
    recentRunsList,
    statusCounts,
  };
}

async function getVercelMetrics() {
  if (!VERCEL_TOKEN) {
    return { deployments: [], errors: 'VERCEL_API_TOKEN not configured' };
  }

  const now = Date.now();
  const yesterday = now - 24 * 60 * 60 * 1000;

  try {
    // Recent deployments
    const dplRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&since=${yesterday}&limit=20`,
      {
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      }
    );
    const dplData = await dplRes.json();
    const deployments = (dplData.deployments || []).map((d) => ({
      id: d.uid || d.id,
      state: d.state || d.readyState,
      url: d.url,
      created: new Date(d.created || d.createdAt).toISOString(),
      commit: d.meta?.githubCommitMessage?.slice(0, 80) || '',
    }));

    // Runtime logs — errors only
    const logsRes = await fetch(
      `https://api.vercel.com/v1/projects/${VERCEL_PROJECT_ID}/runtime-logs?teamId=${VERCEL_TEAM_ID}&since=${yesterday}&level=error&limit=20`,
      {
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      }
    );
    let errorLogs = [];
    if (logsRes.ok) {
      const logsData = await logsRes.json();
      errorLogs = (logsData.logs || []).map((l) => ({
        timestamp: l.timestamp,
        message: l.message?.slice(0, 200) || '',
        path: l.path || '',
        statusCode: l.statusCode,
      }));
    }

    return { deployments, errorLogs, totalDeployments: deployments.length };
  } catch (err) {
    return { deployments: [], errorLogs: [], errors: err.message };
  }
}

// ── GA4 Analytics ───────────────────────────────────────────────────────────

async function getGoogleAccessToken() {
  // The Firebase Admin default credential doesn't include the analytics scope,
  // so we create a dedicated JWT client with the correct scope using the same
  // service account key that Firebase Admin uses.
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      private_key: String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '')
        .replace(/^"|"$/g, '')
        .replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function runGA4Report(accessToken, body, propertyId = GA4_PROPERTY_ID) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GA4 API error (${res.status}): ${err}`);
  }
  return res.json();
}

async function getGA4Metrics({ propertyId = GA4_PROPERTY_ID, eventNames = DIGEST_EVENT_NAMES } = {}) {
  try {
    const accessToken = await getGoogleAccessToken();

    // 1. Overview metrics — sessions, users, pageviews, new users, engagement
    const overviewReport = await runGA4Report(accessToken, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'engagedSessions' },
      ],
    }, propertyId);

    const ov = overviewReport.rows?.[0]?.metricValues || [];
    const overview = {
      sessions: parseInt(ov[0]?.value || '0', 10),
      totalUsers: parseInt(ov[1]?.value || '0', 10),
      newUsers: parseInt(ov[2]?.value || '0', 10),
      pageViews: parseInt(ov[3]?.value || '0', 10),
      avgSessionDuration: Math.round(parseFloat(ov[4]?.value || '0')),
      bounceRate: Math.round(parseFloat(ov[5]?.value || '0') * 100),
      engagedSessions: parseInt(ov[6]?.value || '0', 10),
    };

    // 2. Top pages
    const pagesReport = await runGA4Report(accessToken, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 10,
    }, propertyId);

    const topPages = (pagesReport.rows || []).map((r) => ({
      path: r.dimensionValues[0].value,
      views: parseInt(r.metricValues[0].value, 10),
      users: parseInt(r.metricValues[1].value, 10),
    }));

    // 3. Traffic sources
    const sourcesReport = await runGA4Report(accessToken, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 10,
    }, propertyId);

    const trafficSources = (sourcesReport.rows || []).map((r) => ({
      source: r.dimensionValues[0].value,
      medium: r.dimensionValues[1].value,
      sessions: parseInt(r.metricValues[0].value, 10),
      users: parseInt(r.metricValues[1].value, 10),
    }));

    // 4. GA4 events — sign_up, dashboard_created, etc.
    const eventsReport = await runGA4Report(accessToken, {
      dateRanges: [{ startDate: 'yesterday', endDate: 'today' }],
      dimensions: [{ name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: eventNames,
          },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    }, propertyId);

    const events = {};
    (eventsReport.rows || []).forEach((r) => {
      events[r.dimensionValues[0].value] = parseInt(r.metricValues[0].value, 10);
    });

    return { overview, topPages, trafficSources, events, error: null };
  } catch (err) {
    logError('daily_digest_ga4_error', { error: err.message });
    return { overview: null, topPages: [], trafficSources: [], events: {}, error: err.message };
  }
}

// ── Homepage interaction analytics ──────────────────────────────────────────

function homepageTargetLabel(event) {
  return (
    event.elementText ||
    event.fieldLabel ||
    event.linkUrl ||
    event.metricName ||
    event.eventName ||
    'unknown'
  );
}

async function getHomepageAnalyticsMetrics() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const snap = await fb.adminDb
      .collection('homepage_events')
      .where('createdAt', '>=', yesterday)
      .orderBy('createdAt', 'desc')
      .limit(1000)
      .get();

    const byEventName = {};
    const byInteractionType = {};
    const topTargets = {};
    const outboundLinks = {};
    const scrollDepths = {};
    const webVitals = {};

    snap.docs.forEach((doc) => {
      const event = doc.data() || {};
      incrementCounter(byEventName, event.eventName);
      incrementCounter(byInteractionType, event.interactionType || event.eventName);

      if (event.eventName === 'homepage_outbound_click' && event.linkUrl) {
        incrementCounter(outboundLinks, event.linkUrl);
      }

      if (event.eventName === 'homepage_scroll_depth') {
        incrementCounter(scrollDepths, `${event.scrollDepth || 0}%`);
      }

      if (event.eventName === 'homepage_web_vital' && event.metricName) {
        const metric = event.metricName;
        webVitals[metric] = webVitals[metric] || { count: 0, total: 0, needsImprovement: 0, poor: 0 };
        webVitals[metric].count += 1;
        webVitals[metric].total += Number(event.metricValue) || 0;
        if (event.metricRating === 'needs-improvement') webVitals[metric].needsImprovement += 1;
        if (event.metricRating === 'poor') webVitals[metric].poor += 1;
      }

      if (event.eventName !== 'homepage_web_vital') {
        incrementCounter(topTargets, `${homepageTargetLabel(event)} (${event.eventName || 'event'})`);
      }
    });

    return {
      totalEvents: snap.size,
      byEventName: topCounterEntries(byEventName, 10),
      byInteractionType: topCounterEntries(byInteractionType, 8),
      topTargets: topCounterEntries(topTargets, 10),
      outboundLinks: topCounterEntries(outboundLinks, 8),
      scrollDepths: topCounterEntries(scrollDepths, 5),
      webVitals: Object.entries(webVitals)
        .map(([name, stats]) => ({
          name,
          count: stats.count,
          average: stats.count ? Math.round(stats.total / stats.count) : 0,
          needsImprovement: stats.needsImprovement,
          poor: stats.poor,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      error: null,
    };
  } catch (err) {
    logError('daily_digest_homepage_analytics_error', { error: err.message });
    return {
      totalEvents: 0,
      byEventName: [],
      byInteractionType: [],
      topTargets: [],
      outboundLinks: [],
      scrollDepths: [],
      webVitals: [],
      error: err.message,
    };
  }
}

// ── Calendar (Today's Agenda) ────────────────────────────────────────────────

/** GMT offset string (e.g. "-05:00") for a timezone at a given instant. */
function tzOffset(tz, date) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
    return m ? `${m[1]}:${m[2] || '00'}` : '+00:00';
  } catch {
    return '+00:00';
  }
}

/** Local calendar date (YYYY-MM-DD) in a timezone for a given instant. */
function localDateStr(tz, date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Mint a Google access token scoped for the Calendar API (read-only). */
async function getCalendarAccessToken() {
  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      private_key: String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '')
        .replace(/^"|"$/g, '')
        .replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

/** Fetch up to 5 days of events, grouped by local day, plus a one-line summary
 *  of tomorrow. Prefers the home client's one-click OAuth connection
 *  (calendar_connections/{clientId}); falls back to the service-account-shared
 *  DIGEST_CALENDAR_ID. opts: { clientId, enabled }. When enabled === false
 *  (Market Signals "Calendar / Agenda" toggle off), the section is skipped. */
const AGENDA_DAY_MS = 24 * 60 * 60 * 1000;
const AGENDA_SPAN_DAYS = 5;

/** The empty 5-day window (today .. today+4) in the digest timezone, ready for
 *  events to be bucketed into. Shared by the real collector and the demo
 *  agenda, so the demo strip carries genuine dates/weekdays. */
function buildAgendaDayWindow(timestamp) {
  const days = [];
  for (let d = 0; d < AGENDA_SPAN_DAYS; d++) {
    const inst = new Date(timestamp + d * AGENDA_DAY_MS);
    days.push({
      key: localDateStr(DIGEST_TIMEZONE, inst),
      weekday: inst.toLocaleDateString('en-US', { weekday: 'short', timeZone: DIGEST_TIMEZONE }),
      dateLabel: inst.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: DIGEST_TIMEZONE }),
      isToday: d === 0,
      events: [],
    });
  }
  return days;
}

/** Demo agenda (Email Digest `demoMetrics.calendar`): the real 5-day window with
 *  no events, so the section renders its full swipe strip with every day reading
 *  as an OPEN slot instead of collapsing to a one-line "no events" card. */
function buildDemoAgenda(timestamp) {
  return { events: [], days: buildAgendaDayWindow(timestamp), tomorrowSummary: '', error: null, demo: true };
}

async function getCalendarAgenda(timestamp, opts = {}) {
  const SPAN_DAYS = AGENDA_SPAN_DAYS;
  if (opts.enabled === false) {
    return { events: [], days: [], tomorrowSummary: '', error: null, disabled: true };
  }
  try {
    const now = new Date(timestamp);
    const offset = tzOffset(DIGEST_TIMEZONE, now);

    const days = buildAgendaDayWindow(timestamp);
    const timeMin = `${days[0].key}T00:00:00${offset}`;
    const timeMax = `${days[SPAN_DAYS - 1].key}T23:59:59${offset}`;

    // Prefer the home client's connected calendar (one-click OAuth); fall back
    // to the service-account-shared DIGEST_CALENDAR_ID for backward compat.
    let accessToken = null;
    let calendarId = DIGEST_CALENDAR_ID;
    try {
      const cal = require('../../../../api/_lib/calendar-oauth.cjs');
      if (opts.clientId && cal.isConfigured()) {
        const conn = await cal.getConnection(opts.clientId);
        if (conn?.refreshToken) {
          const t = await cal.getAccessTokenForClient(opts.clientId);
          if (t) { accessToken = t; calendarId = conn.calendarId || 'primary'; }
        }
      }
    } catch { /* fall back to service account below */ }
    // Shared-calendar fallback (service-account DIGEST_CALENDAR_ID) belongs to the
    // env/home digest client only. A scoped non-home client (e.g. a client in the
    // daily fan-out) that has no OAuth connection of its own must NOT inherit it —
    // that leaked the home owner's personal calendar into other clients' emails.
    // Render the empty demo strip instead of another client's events.
    if (!accessToken && opts.allowSharedCalendar === false) {
      return buildDemoAgenda(timestamp);
    }
    if (!accessToken) accessToken = await getCalendarAccessToken();
    if (!accessToken) return buildDemoAgenda(timestamp);

    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?singleEvents=true&orderBy=startTime&maxResults=250` +
      `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
      `&timeZone=${encodeURIComponent(DIGEST_TIMEZONE)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Calendar API error (${res.status}): ${err.slice(0, 200)}`);
    }
    const data = await res.json();

    // Bucket each event into its local day.
    const dayByKey = new Map(days.map((d) => [d.key, d]));
    (data.items || [])
      .filter((e) => e.status !== 'cancelled')
      .forEach((e) => {
        const allDay = Boolean(e.start?.date && !e.start?.dateTime);
        let timeLabel = 'All day';
        let dayKey;
        if (allDay) {
          dayKey = e.start.date; // already YYYY-MM-DD local
        } else if (e.start?.dateTime) {
          const dt = new Date(e.start.dateTime);
          dayKey = localDateStr(DIGEST_TIMEZONE, dt);
          timeLabel = dt.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: DIGEST_TIMEZONE,
          });
        }
        const bucket = dayKey && dayByKey.get(dayKey);
        if (!bucket) return;
        bucket.events.push({
          summary: e.summary || '(no title)',
          location: e.location || '',
          allDay,
          timeLabel,
          sortKey: allDay ? '' : (e.start?.dateTime || ''),
        });
      });

    // All-day events first, then chronological, within each day.
    days.forEach((d) => {
      d.events.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return a.sortKey.localeCompare(b.sortKey);
      });
    });

    // One-line summary of the next day (tomorrow).
    const tmrw = days[1];
    let tomorrowSummary = '';
    if (tmrw) {
      if (!tmrw.events.length) {
        tomorrowSummary = `Nothing scheduled for ${tmrw.weekday}, ${tmrw.dateLabel}.`;
      } else {
        const first = tmrw.events[0];
        const n = tmrw.events.length;
        const when = first.allDay ? 'all day' : `at ${first.timeLabel}`;
        const where = first.location ? ` · ${first.location}` : '';
        tomorrowSummary = `${tmrw.weekday}, ${tmrw.dateLabel}: ${n} event${n !== 1 ? 's' : ''}. First up — “${first.summary}” ${when}${where}.`;
      }
    }

    // `events` stays scoped to today so the digest's eventCount metric is unchanged.
    return { events: days[0].events, days, tomorrowSummary, error: null };
  } catch (err) {
    logError('daily_digest_calendar_error', { error: err.message });
    return { events: [], days: [], tomorrowSummary: '', error: err.message };
  }
}

// ── Email builder ───────────────────────────────────────────────────────────

/** Build the "Today's Agenda" HTML block for the brief. */
// ── Digest visual theme (ported from clients/.../platform-brief.html) ─────────
// Email-safe adaptation: warm-cream surfaces, Doto display numerals, Space Mono
// micro-labels, Space Grotesk body. Web fonts load via @import where supported
// (Apple Mail); Gmail strips them and falls back to the monospace/sans stacks,
// which preserves the data-terminal character.
export const DT = {
  bg: '#fbf8f0',
  card: '#fffdf7',
  ink: '#12100c',
  soft: '#5a5346',
  light: '#8a8070',
  line: '#e7ddc8',
  dash: 'rgba(18,16,12,0.10)',
  accent: '#b8542e',
  // Brand gradient (matches the dashboard primary-button / tab-underline:
  // cyan → purple → pink) + solid/ tint fallbacks for the TODAY highlight.
  grad: 'linear-gradient(135deg,#00c2e6 0%,#6a1aff 52%,#ff00b3 100%)',
  brand: '#6a1aff',
  brandTint: 'rgba(106,26,255,0.08)',
  fDisp: "'Doto','Space Mono','Courier New',monospace",
  fBody: "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  fMono: "'Space Mono','Courier New',monospace",
};

// Shared data-cell styles
const TH = `padding:10px 14px;text-align:left;font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};border-bottom:1px solid ${DT.line};`;
const THR = TH + 'text-align:right;';
const TD = `padding:11px 14px;border-bottom:1px dashed ${DT.dash};font-family:${DT.fBody};font-size:13px;color:${DT.ink};`;
const TDsub = `padding:11px 14px;border-bottom:1px dashed ${DT.dash};font-family:${DT.fBody};font-size:13px;color:${DT.soft};`;
const TDnum = `padding:11px 14px;border-bottom:1px dashed ${DT.dash};font-family:${DT.fMono};font-size:13px;font-weight:700;text-align:right;color:${DT.ink};`;
const TDempty = `padding:18px;text-align:center;font-family:${DT.fBody};font-size:13px;color:${DT.light};`;

export function dKicker(text) {
  return `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${DT.light};margin:0 0 8px;">${text}</div>`;
}

function dMini(text) {
  return `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin:0 0 9px;">${text}</div>`;
}

function dSectionHead(kicker, title) {
  return `${dKicker(kicker)}<div class="sec-title" style="font-family:${DT.fDisp};font-weight:900;font-size:30px;line-height:.95;letter-spacing:-.005em;text-transform:uppercase;color:${DT.ink};margin:0 0 18px;">${title}</div>`;
}

// Every section: top hairline divider + mono eyebrow + Doto display title + body
export function dSection(kicker, title, body) {
  return `<div style="border-top:1px solid ${DT.line};padding-top:32px;margin-top:32px;">
    ${dSectionHead(kicker, title)}
    ${body}
  </div>`;
}

// Sub-block inside a per-brief section: a small mono label + its content. Empty
// content collapses to '' so a brief section only shows the items turned on.
function dSub(label, html) {
  if (!html || !String(html).trim()) return '';
  return `<div style="margin:0 0 22px;">${dMini(label)}${html}</div>`;
}

// One headed section per brief (top hairline + kicker + Doto title), with its
// data items as dSub blocks. Returns '' when every child sub-block is empty so
// a fully-off brief produces no header. This is the "STAND UP" grammar — each
// brief gets one section to voice its data.
function dBriefSection(kicker, title, parts) {
  const body = (Array.isArray(parts) ? parts : [parts]).filter((p) => p && String(p).trim()).join('');
  if (!body.trim()) return '';
  return `<div style="border-top:1px solid ${DT.line};padding-top:32px;margin-top:32px;">
    ${dSectionHead(kicker, title)}
    ${body}
  </div>`;
}

function dStatusBadge(label) {
  const k = String(label || '').toLowerCase();
  let bg = '#f6f0e2', fg = '#8a6a1f';
  if (['ready', 'complete', 'completed', 'succeeded', 'success'].includes(k)) { bg = '#edf4ec'; fg = '#2f6b3d'; }
  else if (['error', 'failed', 'cancelled', 'canceled'].includes(k)) { bg = '#f7ece8'; fg = '#a8392a'; }
  return `<span style="display:inline-block;padding:3px 9px;border-radius:5px;font-family:${DT.fMono};font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${bg};color:${fg};">${escapeHtml(String(label))}</span>`;
}

function dChip(label, value) {
  return `<span style="display:inline-block;margin:0 6px 8px 0;padding:6px 13px;border-radius:999px;background:rgba(18,16,12,0.04);border:1px solid rgba(18,16,12,0.09);font-family:${DT.fBody};font-size:12px;color:${DT.soft};">${label}${value != null ? `: <strong style="font-family:${DT.fMono};color:${DT.ink};">${value}</strong>` : ''}</span>`;
}

// Wrapping inline-block stat cards (reflow to 2-up on narrow screens)
function dStatCells(stats, perRow) {
  const width = perRow === 5 ? 18 : 23;
  const mr = perRow === 5 ? 2.5 : 2;
  const minw = perRow === 5 ? 92 : 118;
  return `<div style="font-size:0;line-height:0;">${stats.map((s) => `
    <div style="display:inline-block;vertical-align:top;width:${width}%;min-width:${minw}px;margin:0 ${mr}% 10px 0;background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:18px 14px;box-sizing:border-box;">
      <div style="font-family:${DT.fDisp};font-weight:900;font-size:38px;line-height:1;letter-spacing:-.02em;color:${DT.ink};">${s.num}</div>
      <div style="margin-top:9px;font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};">${s.label}</div>
    </div>`).join('')}</div>`;
}

function dDataTable(headers, bodyRows) {
  const head = headers.map((h) => `<th style="${h.right ? THR : TH}">${h.label}</th>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:${DT.card};border:1px solid ${DT.line};border-radius:14px;overflow:hidden;">
    <thead><tr>${head}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function buildAgendaSection(agenda) {
  // Visibility is toggle-gated by the caller (include.agenda). This builder
  // always renders a section so preview and live stay in sync.
  if (agenda.error) {
    return dSection('Schedule', 'Agenda', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:14px 16px;font-family:${DT.fBody};font-size:13px;color:${DT.accent};">Calendar unavailable: ${escapeHtml(agenda.error)}</div>`);
  }

  const days = agenda.days || [];
  if (!days.length) {
    return dSection('Schedule', 'Agenda', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:14px 16px;font-family:${DT.fBody};font-size:13px;color:${DT.light};">No events on the calendar for the next 5 days.</div>`);
  }

  // Swipe carousel: each day is a fixed-width card in a horizontally scrolling
  // strip — conserves vertical space and shows all days. The strip is hard-
  // contained (outer overflow:hidden + max-width:100%) so it NEVER widens the
  // email body; only the strip scrolls. Today is first. Clients that strip
  // overflow scroll (Gmail app) clip to width — showing today first, which is
  // the intended graceful fallback. scroll-snap gives clean paging where supported.
  const dayCards = days.map((day) => {
    const evs = day.events || [];
    const rows = evs.length
      ? evs.map((ev, i) => `
        <div style="padding:10px 14px;${i ? `border-top:1px dashed ${DT.dash};` : ''}white-space:normal;font-family:${DT.fBody};font-size:13px;color:${DT.ink};">
          <span style="display:block;font-family:${DT.fMono};font-size:10px;font-weight:700;letter-spacing:.04em;color:${day.isToday ? DT.brand : DT.accent};margin-bottom:3px;">${escapeHtml(ev.timeLabel)}</span>
          ${escapeHtml(ev.summary)}${ev.location ? `<span style="display:block;margin-top:2px;font-size:11px;color:${DT.light};">${escapeHtml(ev.location)}</span>` : ''}
        </div>`).join('')
      : `<div style="padding:14px;white-space:normal;font-family:${DT.fBody};font-size:12px;color:${DT.light};">${agenda.demo ? 'Open' : 'No events'}</div>`;

    return `<div style="display:inline-block;vertical-align:top;white-space:normal;font-size:13px;line-height:normal;width:260px;max-width:80%;margin-right:10px;scroll-snap-align:start;background:${DT.card};border:1px solid ${day.isToday ? DT.brand : DT.line};border-radius:14px;overflow:hidden;box-sizing:border-box;">
      <div style="padding:11px 14px;border-bottom:1px solid ${DT.line};background:${day.isToday ? DT.brandTint : 'transparent'};">
        ${day.isToday ? `<span style="display:inline-block;margin-right:7px;font-family:${DT.fMono};font-size:8px;font-weight:700;letter-spacing:.12em;color:#fff;background:${DT.brand};background-image:${DT.grad};border-radius:4px;padding:2px 5px;vertical-align:middle;">TODAY</span>` : ''}<span style="font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${day.isToday ? DT.brand : DT.ink};">${escapeHtml(day.weekday)}</span><span style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;color:${DT.light};"> &middot; ${escapeHtml(day.dateLabel)}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');

  const hint = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin:0 0 10px;">Swipe &rarr; ${days.length} day${days.length !== 1 ? 's' : ''}</div>`;
  const carousel = `<div style="max-width:100%;overflow:hidden;"><div style="overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;font-size:0;line-height:0;padding-bottom:8px;scroll-snap-type:x mandatory;">${dayCards}</div></div>`;

  // Demo (Email Digest `demoMetrics.calendar`): the strip renders in full with
  // every day OPEN, so the slot reads as available rather than as a dead day.
  const demoNote = agenda.demo
    ? `<div style="font-family:${DT.fBody};font-size:12px;color:${DT.light};margin-top:2px;">Not connected yet — connect your calendar and your real schedule fills these days.</div>`
    : '';

  return dSection('Schedule', 'Agenda', `${hint}${carousel}${demoNote}`);
}

/** Standalone Weather section (its own toggle: include.weather). Reads the
 *  weather from the first brief that carries it. Always renders a section so
 *  preview and live stay in sync (empty state when no forecast). */
function buildWeatherSection(briefs) {
  const briefList = Array.isArray(briefs) ? briefs : [];
  const w = briefList.map((b) => b?.intel?.weather).find((x) => x && x.today);
  const body = w && w.today
    ? `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:16px 18px;">
        <div style="font-family:${DT.fBody};font-size:15px;color:${DT.ink};"><strong>${escapeHtml(w.today.name)}:</strong> ${escapeHtml(w.today.short)} &middot; ${escapeHtml(String(w.today.temp))}&deg;${escapeHtml(w.today.unit)}${w.today.wind ? ` &middot; wind ${escapeHtml(w.today.wind)}` : ''}</div>
        ${w.threeDayLine ? `<div style="margin-top:6px;font-family:${DT.fBody};font-size:12px;color:${DT.soft};">3-day: ${escapeHtml(w.threeDayLine)}</div>` : ''}
      </div>`
    : `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.light};margin:0;">No forecast available for this run.</p>`;
  return dSection(`Local Weather${w?.place ? ` &middot; ${escapeHtml(w.place)}` : ''}`, 'Weather', body);
}

/** Follower posts (own toggle: include.followerPosts). ONE post from each
 *  followed handle (the first activity item), rendered in the "Conversation /
 *  angle" grammar with an obvious "View post" link. Empty state for parity. */
function buildFollowerPostsSection(briefs) {
  const briefList = Array.isArray(briefs) ? briefs : [];
  const seen = new Set();
  const items = [];
  for (const b of briefList) {
    for (const w of (b?.intel?.watchlist || [])) {
      const handle = String(w.handle || '').replace(/^@+/, '').trim();
      if (!handle || seen.has(handle.toLowerCase())) continue;
      const post = (w.found && Array.isArray(w.activity) && w.activity.length) ? w.activity[0] : null;
      if (!post || !post.text) continue;
      seen.add(handle.toLowerCase());
      items.push({ handle, text: post.text, url: post.url || '' });
    }
  }
  const shown = items.slice(0, EMAIL_CAPS.followerPosts);
  const rows = shown.length
    ? shown.map((it) => `<tr>
        <td style="${TD}">
          <strong style="font-family:${DT.fMono};color:${DT.ink};">@${escapeHtml(it.handle)}</strong>${it.url ? ` <a href="${escapeHtml(it.url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;">&rarr; View post</a>` : ''}
          <div style="margin-top:4px;color:${DT.soft};font-size:13px;line-height:1.5;">${escapeHtml(String(it.text).slice(0, 280))}</div>
        </td>
      </tr>`).join('') + emailOverflowRow(items.length - shown.length, 'follower posts')
    : `<tr><td style="${TDempty}">No posts from followed handles this run.</td></tr>`;
  // Inner table only — composed as the "Follower posts" sub-block under the
  // Market Signals brief header by buildEmailHtml.
  return dDataTable([{ label: 'Conversation / angle' }], rows);
}

// Inner content only — composed as the "Homepage" sub-block under the Web
// Performance brief header by buildEmailHtml.
function buildHomepageAnalyticsSection(homepage) {
  if (homepage.error) {
    return `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.accent};margin:0;">Unavailable: ${escapeHtml(homepage.error)}</p>`;
  }

  if (!homepage.totalEvents) {
    // `demo` = the zeroed fixture (Email Digest demo-metrics group): read as an
    // available slot, not as "nothing happened today".
    return `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.light};margin:0;">${homepage.demo
      ? 'Not connected yet — clicks, scroll depth and web vitals from your site land here once tracking is on.'
      : 'No interaction events in the last 24 hours.'}</p>`;
  }

  const chips = homepage.byInteractionType
    .map((item) => dChip(escapeHtml(item.name.replace(/_/g, ' ')), item.count))
    .join('');

  const targetRows = homepage.topTargets.length
    ? homepage.topTargets.map((item) => `<tr><td style="${TD}max-width:420px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(item.name)}</td><td style="${TDnum}">${item.count}</td></tr>`).join('')
    : `<tr><td colspan="2" style="${TDempty}">No click targets recorded</td></tr>`;

  const outboundRows = homepage.outboundLinks.length
    ? homepage.outboundLinks.map((item) => `<tr><td style="${TD}max-width:420px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(item.name)}</td><td style="${TDnum}">${item.count}</td></tr>`).join('')
    : `<tr><td colspan="2" style="${TDempty}">No outbound clicks recorded</td></tr>`;

  const scrollChips = homepage.scrollDepths.length
    ? homepage.scrollDepths.map((item) => dChip(escapeHtml(item.name), item.count)).join('')
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">No scroll milestones yet</span>`;

  const vitalChips = homepage.webVitals.length
    ? homepage.webVitals.map((item) => dChip(`${escapeHtml(item.name)} avg`, `${item.average}${item.poor ? ` &middot; poor ${item.poor}` : ''}`)).join('')
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">No web vitals yet</span>`;

  return `<div style="margin-bottom:16px;">${chips}</div>
    <div style="margin-bottom:14px;">${dDataTable([{ label: 'Top clicks / fields' }, { label: 'Events', right: true }], targetRows)}</div>
    <div style="margin-bottom:14px;">${dDataTable([{ label: 'Outbound links' }, { label: 'Clicks', right: true }], outboundRows)}</div>
    <div style="margin-bottom:16px;">${dMini('Scroll depth')}${scrollChips}</div>
    <div>${dMini('Web vitals')}${vitalChips}</div>`;
}

// Per-domain accent tints for the executive-summary callout cards. Email-safe
// flat hex (no gradients): a soft tint background + a stronger ink for the tag
// and the card's left rule, so each callout is scannable by category.
const CALLOUT_COLORS = {
  Platform:   { bg: '#f7ece8', fg: '#a8392a' },
  Traffic:    { bg: '#e9f0f4', fg: '#2f5d7a' },
  Calendar:   { bg: '#edf4ec', fg: '#2f6b3d' },
  Strategy:   { bg: '#efeaf6', fg: '#5a3d8a' },
  Engagement: { bg: '#f6f0e2', fg: '#8a6a1f' },
  Pipeline:   { bg: '#eceef1', fg: '#4a5568' },
};

/** Below the video/post table: the Social Auto-Publish attribution + action row.
 *  ctx = {clientName, handle, mode, approvalUrl, publishedAt, platformLabel,
 *  preview, skipped, error} — undefined/mode 'off' renders nothing (today's
 *  row, byte-identical). Table-based, no flex, no JS (Outlook-safe). */
function buildAutoPublishRow(ctx) {
  if (!ctx || !ctx.mode || ctx.mode === 'off') return '';
  const platformLabel = escapeHtml(ctx.platformLabel || 'X');
  const attribution = ctx.clientName
    ? `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin:10px 0 6px;">${escapeHtml(ctx.clientName)} &rarr; ${ctx.handle ? `@${escapeHtml(ctx.handle)}` : `<em style="font-style:normal;">not connected</em>`}</div>`
    : '';

  let action = '';
  if (ctx.mode === 'approval' && ctx.approvalUrl) {
    // Bulletproof-table CTA — no flex, no JS, Outlook-safe.
    const href = escapeHtml(ctx.approvalUrl);
    action = `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${DT.ink};">
      <a href="${href}" style="display:inline-block;padding:10px 18px;font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fff;text-decoration:none;">POST TO ${platformLabel}</a>
    </td></tr></table>`;
  } else if (ctx.mode === 'approval') {
    const line = ctx.preview
      ? `Preview — the sent email includes a working Post button.`
      : ctx.claimedByRollup
        ? `Included in today's Pending Approval roll-up email instead.`
        : ctx.skipped === 'not-connected'
          ? `Not connected — connect ${platformLabel} for this client in Social Accounts.`
          : `No pending approval right now.`;
    action = `<div style="font-family:${DT.fBody};font-size:12px;color:${DT.soft};">${escapeHtml(line)}</div>`;
  } else if (ctx.mode === 'auto') {
    const line = ctx.publishedAt
      ? `PUBLISHED &middot; @${escapeHtml(ctx.handle || '')} &middot; ${escapeHtml(new Date(ctx.publishedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}`
      : ctx.preview
        ? `Will auto-publish on send.`
        : ctx.error
          ? `Auto-publish failed &middot; ${escapeHtml(ctx.error)}`
          : `Not published this run &middot; ${escapeHtml(ctx.skipped || 'unknown reason')}`;
    action = `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;color:${ctx.publishedAt ? '#2f9e6b' : DT.soft};">${line}</div>`;
  }

  return `${attribution}${action}`;
}

/** ONE "Post content" row — [video play-card | X post copy]. Email-safe: the
 *  video column is a dark branded card (▶ + duration) LINKING to the MP4 (clients
 *  can't play video). Stacks to 1 column on mobile via the .vp-col-* classes.
 *  `kind` labels the source (Remix / Promo). Returns '' when there's no video.
 *  `ctx` (Social Auto-Publish attribution + button) is undefined for Promo and
 *  for any client with mode 'off' — renders the row byte-identical to before. */
export function buildVideoPostRow(item, kind = 'Video', ctx = null) {
  if (!item || !item.url) return '';
  const href = escapeHtml(String(item.url));
  const secs = Number(item.duration) || 0;
  const durLabel = secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} &middot; ${escapeHtml(kind)}` : escapeHtml(kind);
  const caption = item.caption
    ? escapeHtml(item.caption)
    : `<span style="color:${DT.light};">Promo post generates on send.</span>`;
  // A carried-over video (today's render wasn't ready) is labeled on the card.
  // Silent reuse previously made a stalled pipeline look like a working one.
  const staleBadge = item.stale
    ? `<div style="margin-top:8px;font-family:${DT.fMono};font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#ffb454;">&#9888; from ${escapeHtml(item.staleLabel || 'an earlier run')}</div>`
    : '';
  const videoCard = `<a href="${href}" style="text-decoration:none;display:block;">
    <div style="background:${DT.ink};border-radius:12px;text-align:center;padding:30px 12px;">
      <span style="display:inline-block;width:46px;height:46px;line-height:46px;border-radius:50%;background:${DT.brand};background-image:${DT.grad};color:#fff;font-size:16px;">&#9654;</span>
      <div style="margin-top:10px;font-family:${DT.fMono};font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,0.72);">${durLabel}</div>
      ${staleBadge}
    </div>
  </a>`;
  const postCol = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">X &middot; Post</div>
    <p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.ink};margin:0 0 10px;">${caption}</p>
    <a href="${href}" style="color:${DT.brand};font-family:${DT.fMono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;">&rarr; View video</a>
    ${buildAutoPublishRow(ctx)}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 4px;">
    <tr>
      <td class="vp-col-media" valign="top" width="42%" style="width:42%;vertical-align:top;">${videoCard}</td>
      <td class="vp-col-text" valign="top" width="58%" style="width:58%;vertical-align:top;padding-left:14px;">${postCol}</td>
    </tr>
  </table>`;
}

/** LLM executive-summary card body (no section wrapper — composed under the TODAY
 *  header by buildEmailHtml). Per-domain callout cards when the model returned
 *  structured callouts; falls back to the flat paragraph; empty state otherwise. */
function buildSummaryBody(summary) {
  const callouts = Array.isArray(summary?.callouts) ? summary.callouts : [];

  // Structured callouts → marketing-director grammar: a warm report card with a
  // mono eyebrow, a Doto headline, the lead as a pull-quote, then one labeled
  // block per category (sec label + bold headline + line) — like the
  // Overview / Suggested-action blocks in the watchlist brief.
  // Same grammar as Weather: dSection header (hairline + kicker + Doto title)
  // with the content in a cream card body below — no title-inside-card.
  if (callouts.length) {
    const lead = summary.lead
      ? `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.35;padding:0;margin:0 0 20px;color:${DT.ink};">${escapeHtml(summary.lead)}</p>`
      : '';
    const blocks = callouts.map((c, i) => {
      const col = CALLOUT_COLORS[c.category] || CALLOUT_COLORS.Strategy;
      const label = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${col.fg};margin:0 0 6px;">${escapeHtml(c.category)}</div>`;
      return `<div style="${i ? `border-top:1px dashed ${DT.dash};padding-top:16px;` : ''}margin-bottom:16px;">
        ${label}
        ${c.headline ? `<div style="font-family:${DT.fBody};font-weight:700;font-size:16px;line-height:1.3;color:${DT.ink};margin-bottom:4px;">${escapeHtml(c.headline)}</div>` : ''}
        ${c.line ? `<div style="font-family:${DT.fBody};font-size:14px;line-height:1.55;color:${DT.soft};">${escapeHtml(c.line)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:20px;margin-bottom:18px;">${lead}${blocks}</div>`;
  }

  // Fallback: flat paragraph (or empty state). Toggle-gated by the caller
  // (include.execSummary); empty state keeps preview == sent in sync.
  const text = summary && summary.paragraph
    ? escapeHtml(summary.paragraph).replace(/\n+/g, ' ')
    : '';
  const body = text || `<span style="color:${DT.light};">No executive summary generated for this run.</span>`;
  return `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:20px 22px;margin-bottom:18px;font-family:${DT.fBody};font-size:15px;line-height:1.62;color:${DT.ink};">${body}</div>`;
}

// ── Email size caps ───────────────────────────────────────────────────────────
// Gmail clips messages over ~102KB of encoded HTML and hides the rest behind
// "View entire message" (2026-07-04 digest: 157KB — every section ordered after
// Post Opportunities was invisible in the inbox even though it was sent). Each
// cap trims a section's item count / text length in the EMAIL only; full detail
// stays in the Executive Brief, and overflow rows link there. Keep the resulting
// section sizes roughly in sync with EST_SECTION_KB in components/AdminEmailModals.jsx
// (the SETTINGS-tab size estimator).
const EMAIL_CAPS = {
  signalsKolPerHandle: 1,  // KOL posts per handle in Signals
  signalsKols: 5,
  signalsCompetitors: 4,
  signalsNarratives: 4,
  signalsText: 240,        // finding/detail text per Signals row
  opportunities: 6,
  suggestedReplies: 3,
  watchlistHandles: 10,    // handle rows in Watchlist Accounts
  watchlistActivityPerHandle: 2,
  followerPosts: 10,
  analysisCards: 4,        // per-handle / thread / post cards in the Happening-on sections
  analysisCardText: 300,
};
const REPLY_TARGET_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const STRATEGY_PLAN_MAX_AGE_MS = 26 * 60 * 60 * 1000;
// Absolute cutoff for reusing an already-rendered video. 26h (not 30h) so the
// fallback can only ever reach back to YESTERDAY's send, never the day before.
// Reuse is no longer silent — see isSameDigestDay/staleVideoLabel below: a
// carried-over video is labeled in the email and flagged in the run terminal,
// because a silently repeated video is indistinguishable from a broken pipeline.
const VIDEO_CAPTURE_MAX_AGE_MS = 26 * 60 * 60 * 1000;

/** True when a capture was created on the same calendar day (digest timezone)
 *  as this send — i.e. it is genuinely today's video, not a carried-over one. */
function isSameDigestDay(value, nowMs = Date.now()) {
  const ms = dateMs(value);
  if (!Number.isFinite(ms)) return false;
  return localDateStr(DIGEST_TIMEZONE, new Date(ms)) === localDateStr(DIGEST_TIMEZONE, new Date(nowMs));
}

/** "Mon, Jul 19" for a carried-over capture, used in the email's stale badge. */
function staleVideoLabel(value) {
  const ms = dateMs(value);
  if (!Number.isFinite(ms)) return 'an earlier run';
  return new Date(ms).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: DIGEST_TIMEZONE,
  });
}

function dateMs(value) {
  if (!value) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  if (value?.toDate) return value.toDate().getTime();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  return NaN;
}

function ageMs(value, nowMs = Date.now()) {
  const ms = dateMs(value);
  return Number.isFinite(ms) ? Math.max(0, nowMs - ms) : Infinity;
}

function isFreshWithin(value, maxAgeMs, nowMs = Date.now()) {
  return ageMs(value, nowMs) <= maxAgeMs;
}

function digestRecipeGeneratedAt(recipe) {
  return recipe?.generatedAt || recipe?.updatedAt || recipe?.completedAt || recipe?.createdAt || recipe?.inputGeneratedAt || null;
}

function isFreshReplyRecipe(recipe, nowMs = Date.now()) {
  return Boolean(recipe?.recipeId === 'reply-targets' && recipe?.ok && recipe?.analysis) &&
    isFreshWithin(digestRecipeGeneratedAt(recipe), REPLY_TARGET_MAX_AGE_MS, nowMs);
}

function staleReplyNotice(recipe) {
  const stamp = digestRecipeGeneratedAt(recipe);
  const label = stamp && Number.isFinite(dateMs(stamp))
    ? new Date(dateMs(stamp)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unknown';
  return `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">Suggested Replies is enabled, but the latest reply-targets run is stale (${escapeHtml(label)}). Run Generate &amp; Send or wait for the next successful analysis refresh.</div>`;
}

function isFreshStrategyPlan(plan, nowMs = Date.now()) {
  return Boolean(plan) && isFreshWithin(plan.generatedAt || plan.today?.date, STRATEGY_PLAN_MAX_AGE_MS, nowMs);
}

function staleStrategyNotice(plan) {
  const stamp = plan?.generatedAt || plan?.today?.date || null;
  const label = stamp && Number.isFinite(dateMs(stamp))
    ? new Date(dateMs(stamp)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unknown';
  return `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">Strategy Builder output is stale (${escapeHtml(label)}). Suggested Posts and the 30-day plan are hidden until the next successful strategy refresh.</div>`;
}

function isFreshVideoCapture(capture, nowMs = Date.now()) {
  return Boolean(capture?.downloadUrl) && isFreshWithin(capture.createdAt, VIDEO_CAPTURE_MAX_AGE_MS, nowMs);
}

async function probeVideoUrl(url) {
  const target = String(url || '').trim();
  if (!target) return { ok: false, reason: 'missing-url' };
  const acceptableType = (value) => {
    const type = String(value || '').toLowerCase();
    return !type || type.includes('video/') || type.includes('octet-stream') || type.includes('binary');
  };
  try {
    const head = await fetch(target, {
      method: 'HEAD',
      signal: AbortSignal.timeout(8_000),
      cache: 'no-store',
    });
    if (head.ok && acceptableType(head.headers.get('content-type'))) {
      return { ok: true, contentLength: head.headers.get('content-length') || null };
    }
    if (head.status && head.status !== 405 && head.status !== 403) {
      return { ok: false, reason: `head-${head.status}` };
    }
  } catch { /* fall through to ranged GET */ }

  try {
    const res = await fetch(target, {
      headers: { Range: 'bytes=0-1023' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok && res.status !== 206) return { ok: false, reason: `get-${res.status}` };
    if (!acceptableType(res.headers.get('content-type'))) return { ok: false, reason: 'not-video' };
    const chunk = await res.arrayBuffer().catch(() => null);
    return chunk && chunk.byteLength > 0
      ? { ok: true, contentLength: res.headers.get('content-length') || null }
      : { ok: false, reason: 'empty-response' };
  } catch (err) {
    return { ok: false, reason: err.message || 'probe-failed' };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
// Table row linking to the Executive Brief when a cap dropped items.
const emailOverflowRow = (n, label, colspan = 1) => (n > 0
  ? `<tr><td colspan="${colspan}" style="${TDempty}"><a href="${appUrl('/dashboard?open=brief')}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;">+${n} more ${label} in the Executive Brief &rarr;</a></td></tr>`
  : '');

/** Strategic brief block — mirrors the established daily brief's strategy. */
// Returns the Strategic-brief items as SEPARATE named HTML parts so each can be
// toggled on/off individually under the Market Signals brief header. Each value
// is raw inner HTML (no dMini label — the label comes from the dSub wrapper);
// '' when that item has no data.
function buildStrategicParts(intel, postPlatforms = {}) {
  if (!intel) return {};
  // Suggested-post platform filter: unset key => X on, everything else off.
  const ppOn = (k) => (postPlatforms && postPlatforms[k] !== undefined) ? postPlatforms[k] !== false : (k === 'x');
  // Map a post's platformHint → a registry platform key (default 'x').
  const platformOf = (hint) => {
    const h = String(hint || '').toLowerCase();
    for (const plat of digestConfig.POST_PLATFORMS) {
      if (plat.key === 'x') continue;
      if ((plat.hints || []).some((x) => h.includes(x))) return plat.key;
    }
    return 'x';
  };

  // Weather is its own toggled section (buildWeatherSection) — not rendered here.
  const linkBit = (url) => (url ? ` <a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;">↗</a>` : '');
  // "Post Me →" — opens the dashboard Post Me card (deep link) so the admin can
  // review + post the draft. Emails can't POST directly, so this is a link.
  const postMeLink = `<div style="margin-top:10px;"><a href="${appUrl('/dashboard?open=post-me')}" style="display:inline-block;color:${DT.brand};font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Post Me &rarr;</a></div>`;

  const oppAll = intel.opportunities || [];
  const oppItems = oppAll.slice(0, EMAIL_CAPS.opportunities);
  const oppRows = oppItems.length
    ? oppItems.map((o) => `<tr>
        <td style="${TD}">${escapeHtml(o.topic)}${o.windowHours ? ` <span style="color:${DT.light};font-family:${DT.fMono};font-size:11px;">${o.windowHours}h</span>` : ''}${linkBit(o.url)}<div style="margin-top:3px;color:${DT.soft};font-size:12px;">${escapeHtml(o.angle || '')}</div></td>
      </tr>`).join('') + emailOverflowRow(oppAll.length - oppItems.length, 'opportunities')
    : '';

  // Suggested Replies — reads only fresh reply-targets recipe output persisted by
  // pre-digest-refresh (marketingBrief.reportSnapshot.digestRecipes). Stale or
  // missing recipe output renders an explicit state instead of old replies.
  const anyReplyRecipe = (intel.digestRecipes || []).find((r) => r?.recipeId === 'reply-targets' && r?.ok && r?.analysis);
  const replyRecipe = isFreshReplyRecipe(anyReplyRecipe) ? anyReplyRecipe : null;
  let repliesHtml = '';
  if (!replyRecipe && anyReplyRecipe) {
    repliesHtml = staleReplyNotice(anyReplyRecipe);
  }
  if (replyRecipe) {
    const { data: rtData, prose: rtProse } = parseRecipeAnalysis(replyRecipe.analysis);
    const targets = (Array.isArray(rtData?.replyTargets) ? rtData.replyTargets.filter((t) => t?.suggestedReply) : [])
      .slice(0, EMAIL_CAPS.suggestedReplies);
    if (targets.length) {
      repliesHtml = targets.map((t) => `<div style="margin-bottom:14px;padding:14px 16px;background:${DT.brandTint};border:1px solid ${DT.line};border-radius:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.brand};">Reply${t.tier ? ` &middot; Tier ${t.tier}` : ''}${t.score != null ? ` &middot; ${t.score}/10` : ''}</span>
        </div>
        <div style="font-family:${DT.fBody};font-size:13px;font-weight:700;color:${DT.ink};margin-bottom:4px;">${escapeHtml(t.author || '')}${t.url ? linkBit(t.url) : ''}</div>
        ${t.text ? `<div style="font-family:${DT.fBody};font-size:12px;line-height:1.5;color:${DT.soft};margin-bottom:8px;font-style:italic;">&ldquo;${escapeHtml(String(t.text).slice(0, 200))}&rdquo;</div>` : ''}
        ${t.why ? `<div style="font-family:${DT.fBody};font-size:12px;line-height:1.5;color:${DT.soft};margin-bottom:8px;"><strong style="color:${DT.ink};">Why:</strong> ${escapeHtml(t.why)}</div>` : ''}
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin-bottom:3px;">Draft reply</div>
        <div style="font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.ink};">${escapeHtml(t.suggestedReply)}</div>
        ${t.url ? `<a href="${escapeHtml(t.url)}" style="display:inline-block;margin-top:8px;color:${DT.brand};font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;text-transform:uppercase;">Read post &amp; reply &rarr;</a>` : ''}
      </div>`).join('');
      if (rtProse) repliesHtml += `<div style="font-family:${DT.fBody};font-size:12px;line-height:1.6;color:${DT.soft};margin-top:12px;padding-top:12px;border-top:1px solid ${DT.line};">${escapeHtml(rtProse)}</div>`;
      repliesHtml += postMeLink;
    }
  }
  if (!repliesHtml && replyRecipe) {
    // Prose fallback: the reply-targets recipe ran but didn't emit parseable
    // replyTargets JSON (model returned prose). Render the fresh reply guidance
    // rather than an empty card — mirrors the reddit/X sections' proseFallback.
    // Strips any leading/trailing ``` fences the model may have wrapped it in.
    const { data: rtData, prose: rtProse } = parseRecipeAnalysis(replyRecipe.analysis);
    const raw = String(rtProse || (rtData ? '' : replyRecipe.analysis) || '').trim();
    const cleaned = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
    if (cleaned) {
      repliesHtml = `<div style="font-family:${DT.fBody};font-size:13px;line-height:1.6;color:${DT.ink};margin-bottom:8px;">${escapeHtml(cleaned).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</div>` + postMeLink;
    }
  }
  // No fallback to scout opportunity text here. Reply suggestions are only safe
  // for email when the dedicated reply-targets recipe ran recently; otherwise
  // the section intentionally renders an empty/stale state instead of reusing
  // old suggestedReply strings.

  // Signals was the section that blew past Gmail's clip (40 full-text KOL posts
  // ≈ 56KB on 2026-07-04): cap KOL posts per handle, cap competitors/narratives,
  // slice row text, and link the remainder to the Executive Brief.
  const kolAll = intel.kols || [];
  const kolCounts = new Map();
  const kols = kolAll.filter((k) => {
    const name = String(k.name || '').toLowerCase();
    const n = kolCounts.get(name) || 0;
    if (n >= EMAIL_CAPS.signalsKolPerHandle) return false;
    kolCounts.set(name, n + 1);
    return true;
  }).slice(0, EMAIL_CAPS.signalsKols);
  const competitorsAll = intel.competitors || [];
  const narrativesAll = intel.narratives || [];
  const competitors = competitorsAll.slice(0, EMAIL_CAPS.signalsCompetitors);
  const narratives = narrativesAll.slice(0, EMAIL_CAPS.signalsNarratives);
  const signalsDropped = (kolAll.length - kols.length)
    + (competitorsAll.length - competitors.length)
    + (narrativesAll.length - narratives.length);
  const signalRows = [
    ...kols.map((k) => ({ tag: `KOL${k.platform ? ` · ${k.platform}` : ''}`, label: k.name, value: k.detail, url: k.url })),
    ...competitors.map((c) => ({ tag: `Competitor${c.impact ? ` · ${c.impact}` : ''}`, label: c.name, value: c.finding, url: c.url })),
    ...narratives.map((n) => ({ tag: 'Narrative', label: n.trend, value: n.detail, url: n.url })),
  ];
  const signalsHtml = signalRows.length
    ? signalRows.map((s) => `<tr>
        <td style="${TD}width:120px;font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};vertical-align:top;">${escapeHtml(s.tag)}</td>
        <td style="${TD}"><strong>${escapeHtml(s.label)}</strong>${linkBit(s.url)}<div style="margin-top:2px;color:${DT.soft};font-size:12px;">${escapeHtml(String(s.value || '').slice(0, EMAIL_CAPS.signalsText))}</div></td>
      </tr>`).join('') + emailOverflowRow(signalsDropped, 'signals', 2)
    : '';

  // Watchlist — every configured account, name-for-name, with its activity
  // this run (or a "quiet" note). Surfaces named accounts even when not
  // brand-specific, for narrative opportunities.
  const watchlistAll = intel.watchlist || [];
  const watchlistShown = watchlistAll.slice(0, EMAIL_CAPS.watchlistHandles);
  const watchlistHtml = watchlistShown.length
    ? watchlistShown.map((w) => `<tr>
        <td style="${TD}width:150px;font-family:${DT.fMono};font-size:12px;font-weight:700;color:${DT.ink};vertical-align:top;">${escapeHtml(w.handle)}</td>
        <td style="${TD}">${
          w.found
            ? w.activity.slice(0, EMAIL_CAPS.watchlistActivityPerHandle).map((a) => `<div style="margin-bottom:4px;color:${DT.soft};font-size:12px;">${escapeHtml((a.text || '').slice(0, 240))}${linkBit(a.url)}</div>`).join('')
            : `<span style="color:${DT.light};font-size:12px;">No activity surfaced this run.</span>`
        }</td>
      </tr>`).join('') + emailOverflowRow(watchlistAll.length - watchlistShown.length, 'accounts', 2)
    : '';

  const c = intel.content || {};
  const strategyPlanFresh = isFreshStrategyPlan(intel.strategyBuilder);
  const strategyStaleHtml = intel.strategyBuilder && !strategyPlanFresh
    ? staleStrategyNotice(intel.strategyBuilder)
    : '';
  const strategyPostBlocks = (strategyPlanFresh ? (intel.strategyBuilder?.today?.posts || []) : []).map((p, index) => ({
    label: p.platformHint ? `Today · ${String(p.platformHint).toUpperCase()}` : `Today · Post ${index + 1}`,
    text: p.content,
    foot: [p.signalUsed ? `Signal: ${p.signalUsed}` : '', p.rationale || ''].filter(Boolean).join(' · '),
    platform: platformOf(p.platformHint),
  }));
  // Content drafts per platform, derived from the registry (each platform's
  // first present content field). Add a platform in _digest-config and its
  // drafts flow here automatically.
  const contentBlocks = [];
  for (const plat of digestConfig.POST_PLATFORMS) {
    const field = (plat.fields || []).find((f) => c[f]);
    if (field) contentBlocks.push({ label: plat.label, text: c[field], platform: plat.key });
  }
  const postBlocks = [...strategyPostBlocks, ...contentBlocks].filter((b) => ppOn(b.platform));
  const postsHtml = postBlocks.length
    ? postBlocks.map((p) => `<div style="margin-bottom:10px;padding:12px 14px;background:${DT.card};border:1px solid ${DT.line};border-radius:10px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">${escapeHtml(p.label)}</div>
        <div style="font-family:${DT.fBody};font-size:13px;color:${DT.ink};line-height:1.5;">${escapeHtml(p.text)}</div>
        ${p.foot ? `<div style="margin-top:6px;font-family:${DT.fBody};font-size:11px;color:${DT.soft};line-height:1.45;">${escapeHtml(p.foot)}</div>` : ''}
      </div>`).join('') + postMeLink
    : '';
  const planPreview = (strategyPlanFresh ? (intel.strategyBuilder?.items || []) : []).slice(0, 7);
  const planTable = planPreview.length
    ? dDataTable([{ label: 'Date' }, { label: 'Post' }], planPreview.map((item) => `<tr>
        <td style="${TD}width:120px;font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};vertical-align:top;">${escapeHtml(String(item.scheduledAt || '').slice(0, 10))}</td>
        <td style="${TD}"><strong>${escapeHtml(item.kind || 'post')}</strong><div style="margin-top:2px;color:${DT.soft};font-size:12px;">${escapeHtml(item.content || '')}</div></td>
      </tr>`).join(''))
    : '';

  return {
    humanBrief: intel.humanBrief
      ? `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:18px 20px;font-family:${DT.fBody};font-size:14px;line-height:1.6;color:${DT.ink};">${escapeHtml(intel.humanBrief)}</div>`
      : '',
    opportunities: oppRows ? dDataTable([{ label: 'Conversation / angle' }], oppRows) : '',
    suggestedReplies: repliesHtml,
    signals: signalsHtml ? dDataTable([{ label: 'Type' }, { label: 'Finding' }], signalsHtml) : '',
    watchlistAccounts: watchlistHtml ? dDataTable([{ label: 'Account' }, { label: 'Activity this run' }], watchlistHtml) : '',
    suggestedPosts: strategyStaleHtml || postsHtml || '',
    planPreview: strategyStaleHtml || planTable,
  };
}

/** Split a recipe analysis string into leading JSON + trailing prose. Ported
 *  from the dashboard's parseRecipeAnalysis (DashboardPage.jsx) so the email
 *  renders the same watchlist-analysis shape server-side. */
function parseRecipeAnalysis(text) {
  if (!text || typeof text !== 'string') return { data: null, prose: '' };
  const start = text.indexOf('{');
  if (start === -1) return { data: null, prose: text.trim() };
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { data: null, prose: text.trim() };
  let data = null;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { data = null; }
  return { data, prose: text.slice(end + 1).trim() };
}

/** "Happening on X" watchlist brief — email port of renderWatchlistAnalysisBlock
 *  (DashboardPage.jsx). Renders the dashboard REPORT-tab block in the brief-kit
 *  look using email-safe inline styles + the digest's warm-cream tokens
 *  (no pseudo-elements / CSS grid). Returns '' when there's nothing to show. */
function buildWatchlistBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const spotHandle = data?.spotlight?.handle ? String(data.spotlight.handle).replace(/^@+/, '') : '';
  const handleNames = Array.from(new Set(
    (Array.isArray(data?.handles) ? data.handles : [])
      .map((h) => String(h.handle || '').replace(/^@+/, '').trim())
      .filter(Boolean)
  ));
  // Bold tracked handle names wherever they appear in free-form text. Escape
  // first — handle names are alphanumeric/underscore, unchanged by escaping.
  const boldHandles = (raw) => {
    const safe = escapeHtml(String(raw || ''));
    if (!handleNames.length) return safe;
    const escaped = handleNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(@?(?:${escaped.join('|')})\\b)`, 'gi');
    return safe.replace(re, '<strong>$1</strong>');
  };

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const pull = (inner) => `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.3;padding:0;margin:0;color:${DT.ink};">${inner}</p>`;

  const overviewHtml = data?.overview
    ? `<div style="margin-bottom:16px;">${sec('Overview')}${pull(boldHandles(data.overview))}</div>` : '';
  const actionHtml = data?.priorityAction
    ? `<div style="margin-bottom:16px;">${sec('Suggested action')}${pull(escapeHtml(data.priorityAction))}</div>` : '';

  const handlesArr = (Array.isArray(data?.handles) ? data.handles : []).slice(0, EMAIL_CAPS.analysisCards);
  const handleCards = handlesArr.length
    ? `<div style="margin-bottom:16px;">${sec('Per handle')}<div style="font-size:0;line-height:0;">${handlesArr.map((h) => {
        const hh = escapeHtml(String(h.handle || '').replace(/^@+/, ''));
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:18px;line-height:1;text-transform:uppercase;color:${DT.ink};">@${hh}</div>
          ${h.posting ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.ink};margin:8px 0 0;">${escapeHtml(h.posting)}</p>` : ''}
          ${h.talkedAbout ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed ${DT.dash};">${sec('Talked about')}<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:3px 0 0;">${escapeHtml(h.talkedAbout)}</p></div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const spotlightHtml = data?.spotlight?.why
    ? `<div style="background:${DT.ink};border-radius:14px;padding:16px 18px;margin-top:6px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px;">Spotlight &middot; @${escapeHtml(spotHandle)}</div>
        <div style="font-family:${DT.fBody};font-weight:300;font-size:16px;line-height:1.3;color:#fff;">${escapeHtml(data.spotlight.why)}</div>
      </div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  // Inner content only — composed as the "Happening on X" sub-block under the
  // Market Signals brief header by buildEmailHtml.
  return `${overviewHtml}${actionHtml}${handleCards}${spotlightHtml}${proseFallback}`;
}

/** "What's happening on Reddit" platform brief. Same persisted-analysis pattern
 *  as Happening on X, but shaped around Reddit threads/items instead of handles. */
function buildRedditBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const pull = (inner) => `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.3;padding:0;margin:0;color:${DT.ink};">${inner}</p>`;
  const link = (url) => url ? `<a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;">Read thread &rarr;</a>` : '';

  const overviewHtml = data?.overview
    ? `<div style="margin-bottom:16px;">${sec('Overview')}${pull(escapeHtml(data.overview))}</div>` : '';
  const actionHtml = data?.priorityAction
    ? `<div style="margin-bottom:16px;">${sec('Suggested action')}${pull(escapeHtml(data.priorityAction))}</div>` : '';
  const threads = (Array.isArray(data?.threads) ? data.threads : (Array.isArray(data?.items) ? data.items : [])).slice(0, EMAIL_CAPS.analysisCards);
  const threadCards = threads.length
    ? `<div style="margin-bottom:16px;">${sec('Threads to review')}<div style="font-size:0;line-height:0;">${threads.map((t) => {
        const subreddit = t.subreddit ? String(t.subreddit).replace(/^r\//, '') : 'reddit';
        const body = String(t.summary || t.why || t.opportunity || t.actionableTakeaway || '').slice(0, EMAIL_CAPS.analysisCardText);
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">r/${escapeHtml(subreddit)}</div>
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:17px;line-height:1.05;text-transform:uppercase;color:${DT.ink};">${escapeHtml(t.title || 'Reddit thread')}</div>
          ${body ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:8px 0 0;">${escapeHtml(body)}</p>` : ''}
          ${t.url ? `<div style="margin-top:10px;">${link(t.url)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const spotlight = data?.spotlight;
  const spotlightHtml = spotlight?.why
    ? `<div style="background:${DT.ink};border-radius:14px;padding:16px 18px;margin-top:6px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px;">Spotlight${spotlight.subreddit ? ` &middot; r/${escapeHtml(String(spotlight.subreddit).replace(/^r\//, ''))}` : ''}</div>
        <div style="font-family:${DT.fBody};font-weight:300;font-size:16px;line-height:1.3;color:#fff;">${escapeHtml(spotlight.why)}</div>
        ${spotlight.url ? `<div style="margin-top:10px;">${link(spotlight.url)}</div>` : ''}
      </div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  return `${overviewHtml}${actionHtml}${threadCards}${spotlightHtml}${proseFallback}`;
}

/** "Happening on Instagram" platform brief. Instagram mirror of buildRedditBriefSection
 *  — same persisted-analysis JSON shape, relabeled for IG accounts/posts. */
function buildInstagramBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const pull = (inner) => `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.3;padding:0;margin:0;color:${DT.ink};">${inner}</p>`;
  const link = (url) => url ? `<a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;">View post &rarr;</a>` : '';

  const overviewHtml = data?.overview
    ? `<div style="margin-bottom:16px;">${sec('Overview')}${pull(escapeHtml(data.overview))}</div>` : '';
  const actionHtml = data?.priorityAction
    ? `<div style="margin-bottom:16px;">${sec('Suggested action')}${pull(escapeHtml(data.priorityAction))}</div>` : '';
  const threads = (Array.isArray(data?.threads) ? data.threads : (Array.isArray(data?.items) ? data.items : [])).slice(0, EMAIL_CAPS.analysisCards);
  const threadCards = threads.length
    ? `<div style="margin-bottom:16px;">${sec('Posts to review')}<div style="font-size:0;line-height:0;">${threads.map((t) => {
        const account = t.subreddit ? String(t.subreddit).replace(/^@/, '') : 'instagram';
        const body = String(t.summary || t.why || t.opportunity || t.actionableTakeaway || '').slice(0, EMAIL_CAPS.analysisCardText);
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">@${escapeHtml(account)}</div>
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:17px;line-height:1.05;text-transform:uppercase;color:${DT.ink};">${escapeHtml(t.title || 'Instagram post')}</div>
          ${body ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:8px 0 0;">${escapeHtml(body)}</p>` : ''}
          ${t.url ? `<div style="margin-top:10px;">${link(t.url)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const spotlight = data?.spotlight;
  const spotlightHtml = spotlight?.why
    ? `<div style="background:${DT.ink};border-radius:14px;padding:16px 18px;margin-top:6px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px;">Spotlight${spotlight.subreddit ? ` &middot; @${escapeHtml(String(spotlight.subreddit).replace(/^@/, ''))}` : ''}</div>
        <div style="font-family:${DT.fBody};font-weight:300;font-size:16px;line-height:1.3;color:#fff;">${escapeHtml(spotlight.why)}</div>
        ${spotlight.url ? `<div style="margin-top:10px;">${link(spotlight.url)}</div>` : ''}
      </div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  return `${overviewHtml}${actionHtml}${threadCards}${spotlightHtml}${proseFallback}`;
}

/** Opportunity Signals brief — public buying-signal opportunities, each with a
 *  trigger quote, likely problem, and a non-pitch response angle. Same JSON-first
 *  persisted-analysis shape as the other platform briefs; capped to the top
 *  high-confidence items for the email (full list lives in the dashboard REPORT
 *  block). See docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md. */
function buildOpportunitySignalsBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const link = (url) => url ? `<a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;">Source &rarr;</a>` : '';

  const opportunities = (Array.isArray(data?.opportunities) ? data.opportunities : []).slice(0, 3);
  const cards = opportunities.length
    ? `<div style="margin-bottom:16px;">${sec('Opportunities')}<div style="font-size:0;line-height:0;">${opportunities.map((o) => {
        const who = [o.person, o.company].filter(Boolean).join(' / ') || 'Unknown';
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">${escapeHtml(o.platform || 'signal')}${o.confidence ? ` &middot; ${escapeHtml(o.confidence)} confidence` : ''}</div>
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:17px;line-height:1.05;text-transform:uppercase;color:${DT.ink};">${escapeHtml(who)}</div>
          ${o.currentTrigger ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:8px 0 0;">&ldquo;${escapeHtml(String(o.currentTrigger).slice(0, 240))}&rdquo;</p>` : ''}
          ${o.possibleResponse ? `<p style="font-family:${DT.fBody};font-size:12.5px;line-height:1.5;color:${DT.ink};margin:8px 0 0;"><strong>Angle:</strong> ${escapeHtml(String(o.possibleResponse).slice(0, 200))}</p>` : ''}
          ${o.url ? `<div style="margin-top:10px;">${link(o.url)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  return `${cards}${proseFallback}`;
}

/** Creative Brief attachment — inlines the run onboarding-brief summary + a hero
 *  image in the digest's warm-cream style. Returns '' when nothing has run. */
function buildCreativeBriefSection(creative) {
  if (!creative || !creative.summary) return '';
  const img = creative.image
    ? `<img src="${escapeHtml(creative.image)}" alt="" style="width:100%;max-width:520px;border-radius:12px;border:1px solid ${DT.line};margin:0 0 14px;display:block;">`
    : '';
  const generatedAt = creative.generatedAt
    ? `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};margin:0 0 8px;">Latest creative module brief &middot; ${escapeHtml(new Date(creative.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>`
    : '';
  const text = escapeHtml(creative.summary).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  // Inner content only — composed under the Creative brief header by buildEmailHtml.
  return `${img}${generatedAt}<p style="font-family:${DT.fBody};font-size:14px;line-height:1.62;color:${DT.ink};margin:0;">${text}</p>`;
}

function buildEmailHtml(firebase, vercel, ga4, agenda, homepage, timestamp, summary, briefs, include = {}, creative = null, briefUrl = null, contactUrl = '', videoItems = [], order = [], postPlatforms = {}, freshnessToken = '', videoStatus = {}, videoPublishCtx = {}) {
  // Fallback target when no hosted brief is resolved (briefLinkMode 'off' /
  // 'latest' with nothing published / 'fresh' run failed): the dashboard modal.
  const executiveBriefUrl = appUrl('/dashboard?open=brief');
  const briefLinkUrl = briefUrl || executiveBriefUrl;
  // CTA row: primary "Open Executive Brief" + secondary "Contact Your Human"
  // (mirrors the brief's "Meet with a Human" CTA). Contact defaults to the
  // brief's Calendly when unconfigured, so the button shows whenever toggled on.
  const showBrief = include.execBriefLink !== false;
  const showContact = include.contactHuman !== false;
  const contactHref = escapeHtml(String(contactUrl || '').trim() || 'https://calendly.com/bballi/30min');
  const briefBtn = showBrief
    ? `<a class="cta-btn" href="${escapeHtml(briefLinkUrl)}" style="display:inline-block;text-align:center;background:${DT.ink};color:${DT.card};font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:13px 18px;border:1px solid ${DT.ink};margin:0 8px 8px 0;">Open Executive Brief</a>`
    : '';
  const contactBtn = showContact
    ? `<a class="cta-btn" href="${contactHref}" style="display:inline-block;text-align:center;background:${DT.card};color:${DT.ink};font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:13px 18px;border:1px solid ${DT.ink};margin:0 8px 8px 0;">Contact Your Human</a>`
    : '';
  const ctaRow = (showBrief || showContact)
    ? `<div style="margin:18px 0 28px;">${briefBtn}${contactBtn}</div>`
    : '';
  const briefList = Array.isArray(briefs) ? briefs : [];
  // Strategic-brief items are now individually toggled. Aggregate each part
  // across all briefs so a single dSub renders that item from every client.
  const strategicParts = briefList.map((b) => buildStrategicParts(b.intel, postPlatforms));
  const sPart = (k) => strategicParts.map((p) => p[k]).filter(Boolean).join('');
  const watchlistSections = include.watchlist === false ? '' : briefList
    .map((b) => buildWatchlistBriefSection(b.intel?.watchlistAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const redditAnalysisSections = include.redditAnalysis === false ? '' : briefList
    .map((b) => buildRedditBriefSection(b.intel?.redditAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const instagramAnalysisSections = include.instagramAnalysis === false ? '' : briefList
    .map((b) => buildInstagramBriefSection(b.intel?.instagramAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const opportunitySignalsSections = include.opportunitySignals === false ? '' : briefList
    .map((b) => buildOpportunitySignalsBriefSection(b.intel?.opportunitySignalsAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Demo (zeroed) groups render at 0 with "connect this" copy instead of the
  // real "nothing happened in 24h" copy, so the section reads as an available
  // slot rather than a dead result. `demo` is set on the zeroed fixture by the
  // route (see DEMO_METRIC_GROUPS in _digest-config.js).
  const emptyCopy = (source, demoMsg, realMsg) => (source && source.demo ? demoMsg : realMsg);

  const newUsersRows = firebase.newUsersList.length
    ? firebase.newUsersList
        .map(
          (u) => `<tr>
          <td style="${TD}">${escapeHtml(u.email)}</td>
          <td style="${TDsub}">${u.website ? escapeHtml(u.website) : '—'}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(u.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(firebase, 'Not connected yet — your new sign-ups will be listed here.', 'No new sign-ups in the last 24 hours')}</td></tr>`;

  const recentRunsRows = firebase.recentRunsList.length
    ? firebase.recentRunsList
        .map(
          (r) => `<tr>
          <td style="${TD}">${escapeHtml(r.website || r.id)}</td>
          <td style="${TD}">${dStatusBadge(r.status)}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(r.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(firebase, 'Not connected yet — dashboards created for you will be listed here.', 'No new dashboards created')}</td></tr>`;

  const deploymentsRows = vercel.deployments?.length
    ? vercel.deployments
        .map(
          (d) => `<tr>
          <td style="${TD}">${dStatusBadge(d.state)}</td>
          <td style="${TDsub}max-width:300px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(d.commit || '—')}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(d.created).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(vercel, 'Not connected yet — connect your hosting to see each deploy here.', 'No deployments in the last 24 hours')}</td></tr>`;

  const statusBreakdown = Object.entries(firebase.statusCounts)
    .map(([status, count]) => dChip(escapeHtml(status), count))
    .join('');

  const errorRows = vercel.errorLogs?.length
    ? vercel.errorLogs.map((e) => `<tr>
            <td style="${TD}font-family:${DT.fMono};font-size:12px;">${escapeHtml(e.path)}</td>
            <td style="${TDsub}max-width:300px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(e.message)}</td>
            <td style="${TDnum}">${e.statusCode || '—'}</td>
          </tr>`).join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(vercel, 'Not connected yet — connect your hosting to catch runtime errors here.', 'No runtime errors in the last 24 hours')}</td></tr>`;
  const errorInner = dDataTable([{ label: 'Path' }, { label: 'Message' }, { label: 'Status', right: true }], errorRows);

  // ── Inner pieces for the brief-grouped sections (each a dSub under a header) ──
  const platformOverviewCells = dStatCells([
    { num: firebase.newUsers, label: 'New sign-ups' },
    { num: firebase.totalUsers, label: 'Total users' },
    { num: firebase.recentRuns, label: 'Dashboards' },
    { num: vercel.totalDeployments || 0, label: 'Deployments' },
  ], 4);
  const ga4TrafficInner = ga4.overview
    ? `${dStatCells([
        { num: ga4.overview.sessions, label: 'Sessions' },
        { num: ga4.overview.pageViews, label: 'Page views' },
        { num: ga4.overview.totalUsers, label: 'Visitors' },
        { num: ga4.overview.newUsers, label: 'New' },
        { num: `${ga4.overview.bounceRate}%`, label: 'Bounce' },
      ], 5)}<div style="font-family:${DT.fMono};font-size:11px;color:${DT.soft};letter-spacing:.02em;">Avg session <strong style="color:${DT.ink};">${Math.floor(ga4.overview.avgSessionDuration / 60)}m ${ga4.overview.avgSessionDuration % 60}s</strong> &nbsp;&middot;&nbsp; Engaged <strong style="color:${DT.ink};">${ga4.overview.engagedSessions}</strong></div>${ga4.demo ? `<div style="font-family:${DT.fBody};font-size:12px;color:${DT.light};margin-top:10px;">Not connected yet — connect Google Analytics and these fill with your real traffic each day.</div>` : ''}`
    : `<p style="font-family:${DT.fBody};font-size:13px;color:${ga4.error ? DT.accent : DT.light};margin:0;">${ga4.error ? `GA4 unavailable: ${escapeHtml(ga4.error)}` : 'No traffic recorded in the last 24 hours.'}</p>`;
  const topPagesTable = dDataTable(
    [{ label: 'Page' }, { label: 'Views', right: true }, { label: 'Users', right: true }],
    ga4.topPages?.length ? ga4.topPages.map((p) => `<tr>
      <td style="${TD}max-width:300px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(p.path)}</td>
      <td style="${TDnum}">${p.views}</td>
      <td style="${TDnum}color:${DT.soft};font-weight:400;">${p.users}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(ga4, 'Not connected yet — your most-viewed pages will rank here.', 'No page data in the last 24 hours')}</td></tr>`
  );
  const sourcesTable = dDataTable(
    [{ label: 'Source / Medium' }, { label: 'Sessions', right: true }, { label: 'Users', right: true }],
    ga4.trafficSources?.length ? ga4.trafficSources.map((s) => `<tr>
      <td style="${TD}">${escapeHtml(s.source)} <span style="color:${DT.light};">/ ${escapeHtml(s.medium)}</span></td>
      <td style="${TDnum}">${s.sessions}</td>
      <td style="${TDnum}color:${DT.soft};font-weight:400;">${s.users}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(ga4, 'Not connected yet — where your visitors come from will break down here.', 'No traffic sources in the last 24 hours')}</td></tr>`
  );
  const keyEventsInner = Object.keys(ga4.events || {}).length
    ? `<div>${Object.entries(ga4.events).map(([name, count]) => dChip(escapeHtml(name.replace(/_/g, ' ')), count)).join('')}</div>`
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">${emptyCopy(ga4, 'Not connected yet — the actions you choose to track will count here.', 'No key events in the last 24 hours')}</span>`;
  const signupsTable = dDataTable([{ label: 'Email' }, { label: 'Website' }, { label: 'Time', right: true }], newUsersRows);
  const dashboardsTable = dDataTable([{ label: 'Website' }, { label: 'Status' }, { label: 'Time', right: true }], recentRunsRows);
  const pipelineInner = `<div style="margin-bottom:10px;">${statusBreakdown || `<span style="color:${DT.light};font-family:${DT.fBody};font-size:13px;">${emptyCopy(firebase, 'Not connected yet — run status will break down here.', 'No pipeline data')}</span>`}</div><div style="font-family:${DT.fMono};font-size:11px;color:${DT.soft};letter-spacing:.02em;">Total runs <strong style="color:${DT.ink};">${firebase.totalRuns}</strong> &nbsp;&middot;&nbsp; Clients <strong style="color:${DT.ink};">${firebase.totalClients}</strong></div>`;
  const deploymentsInner = `${vercel.errors ? `<p style="font-family:${DT.fBody};color:${DT.accent};font-size:12px;margin:0 0 10px;">Note: ${escapeHtml(vercel.errors)}</p>` : ''}${dDataTable([{ label: 'Status' }, { label: 'Commit' }, { label: 'Time', right: true }], deploymentsRows)}`;

  // Per-section renderers, keyed by include key. Each returns its email block
  // (a dSub for items under a brief header; a standalone section for top items).
  // The email renders each group's keys in the admin's saved `order` (shuffled
  // up/down within the group), gated by include[key].
  // Every toggleable element is its OWN section with the established header
  // (kicker + Doto title), like Weather / Happening on X. Empty body => no
  // section (skips items with nothing to show — preview and sent skip alike).
  const section = (kicker, title, body) => (body && String(body).trim()) ? dSection(kicker, title, body) : '';
  const noDataBlock = (message) => `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">${escapeHtml(message)}</div>`;
  const RENDER = {
    // Top of email
    agenda: () => buildAgendaSection(agenda),
    weather: () => buildWeatherSection(briefs),
    // Executive Summary / TODAY
    execSummary: () => section('Executive Summary', 'Today', buildSummaryBody(summary)),
    // Post Content
    videoPosts: () => section('Post Content', 'Video Remix', buildVideoPostRow(videoItems?.remix, 'Remix', videoPublishCtx?.x) || noDataBlock(videoStatus?.remix || 'Video Remix is enabled, but no fresh completed video was ready when this email rendered.')),
    videoPromo: () => section('Post Content', 'Video Promo', buildVideoPostRow(videoItems?.promo, 'Promo') || noDataBlock(videoStatus?.promo || 'Video Promo is enabled, but no fresh completed video was ready when this email rendered.')),
    // Market Signals
    humanBrief: () => section('Market Signals', 'Brief', sPart('humanBrief')),
    opportunities: () => section('Market Signals', 'Post Opportunities', sPart('opportunities')),
    suggestedReplies: () => section('Market Signals', 'Suggested Replies', sPart('suggestedReplies') || noDataBlock('Suggested Replies is enabled, but no drafted replies were found in the current Market Signals data yet. Run Generate & Send after Market Insights has fresh opportunities or reply targets.')),
    signals: () => section('Market Signals', 'Signals', sPart('signals')),
    watchlistAccounts: () => section('Market Signals', 'Watchlist Accounts', sPart('watchlistAccounts')),
    suggestedPosts: () => section('Market Signals', 'Suggested Posts', sPart('suggestedPosts')),
    planPreview: () => section('Market Signals', '30-Day Plan', sPart('planPreview')),
    watchlist: () => section('Market Signals', 'Happening on X', watchlistSections),
    redditAnalysis: () => section('Market Signals', 'Happening on Reddit', redditAnalysisSections || noDataBlock('Happening on Reddit is enabled, but no Reddit analysis has been saved for this client yet. Run Generate & Send with Reddit enabled in Market Insights so the Reddit analyzer can write this section.')),
    instagramAnalysis: () => section('Market Signals', 'Happening on Instagram', instagramAnalysisSections || noDataBlock('Happening on Instagram is enabled, but no Instagram analysis has been saved for this client yet. Run Generate & Send with Instagram enabled in Market Insights so the Instagram analyzer can write this section.')),
    opportunitySignals: () => section('Market Signals', 'Opportunity Signals', opportunitySignalsSections || noDataBlock('Opportunity Signals is enabled, but no opportunities have been found yet. Refresh Market Signals with Opportunity Signals enabled so the scan can write this section.')),
    followerPosts: () => section('Market Signals', 'Follower Posts', buildFollowerPostsSection(briefs)),
    // Creative
    creativeBrief: () => section('Creative', 'Creative Brief', buildCreativeBriefSection(creative)),
    // Web Performance
    ga4Traffic: () => section('Google Analytics', 'Traffic', ga4TrafficInner),
    topPages: () => section('Analytics', 'Top Pages', topPagesTable),
    trafficSources: () => section('Analytics', 'Sources', sourcesTable),
    keyEvents: () => section('Analytics', 'Key Events', keyEventsInner),
    homepage: () => section('Engagement', 'Homepage', buildHomepageAnalyticsSection(homepage)),
    // Platform
    platformOverview: () => section('Platform', 'Overview', platformOverviewCells),
    signups: () => section('Firebase', 'New Sign-ups', signupsTable),
    dashboards: () => section('Firebase', 'Dashboards', dashboardsTable),
    pipeline: () => section('Firebase', 'Pipeline Status', pipelineInner),
    // Deployments
    deployments: () => section('Vercel', 'Deployments', deploymentsInner),
    runtimeErrors: () => section('Vercel', 'Runtime Errors', errorInner),
  };
  const ord = Array.isArray(order) && order.length ? order : Object.keys(RENDER);
  const orderIdx = (k) => { const i = ord.indexOf(k); return i === -1 ? 999 : i; };
  // Render a group's keys (each its own section) in saved order, gated by include[key].
  const renderGroup = (keys) => [...keys]
    .sort((a, b) => orderIdx(a) - orderIdx(b))
    .filter((k) => include[k] !== false && RENDER[k])
    .map((k) => RENDER[k]())
    .join('');

  const topSections = renderGroup(['agenda', 'weather']);
  const todaySection = renderGroup(['execSummary']);
  const postContentSection = renderGroup(['videoPosts', 'videoPromo']);
  const marketSignalsSection = renderGroup(['humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'watchlistAccounts', 'suggestedPosts', 'planPreview', 'watchlist', 'redditAnalysis', 'instagramAnalysis', 'opportunitySignals', 'followerPosts']);
  const creativeSection = renderGroup(['creativeBrief']);
  const webPerfSection = renderGroup(['ga4Traffic', 'topPages', 'trafficSources', 'keyEvents', 'homepage']);
  const platformSection = renderGroup(['platformOverview', 'signups', 'dashboards', 'pipeline']);
  const opsSection = renderGroup(['deployments', 'runtimeErrors']);
  const freshnessTokenText = String(freshnessToken || '').trim();
  const freshnessSection = freshnessTokenText
    ? dSection('Verification', 'Freshness Token', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:16px 18px;font-family:${DT.fMono};font-size:12px;line-height:1.5;color:${DT.ink};word-break:break-word;">${escapeHtml(freshnessTokenText)}</div>`)
    : '';

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>HITLOOP Daily Digest</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
body{margin:0;padding:0;background:${DT.bg};}
a{text-decoration:none;}
@media only screen and (max-width:600px){
  .container{padding:24px 16px !important;}
  .hero-title{font-size:42px !important;}
  .sec-title{font-size:26px !important;}
  .cta-btn{display:block !important;width:100% !important;margin:0 0 10px 0 !important;box-sizing:border-box !important;}
  .vp-col-media,.vp-col-text{display:block !important;width:100% !important;padding-left:0 !important;}
  .vp-col-media{margin-bottom:10px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${DT.bg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${DT.bg};">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;table-layout:fixed;">
        <tr><td class="container" style="padding:40px 32px;">

          <!-- Hero -->
          <div style="padding-bottom:6px;">
            ${dKicker('HitLoop.agency &middot; Daily Digest')}
            <div class="hero-title" style="font-family:${DT.fDisp};font-weight:900;font-size:72px;font-size:clamp(34px,11.2vw,84px);line-height:.9;letter-spacing:-.04em;text-transform:uppercase;color:${DT.ink};margin:6px 0 16px;">Stand Up</div>
            <div style="font-family:${DT.fMono};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};">${dateStr}</div>
          </div>

          <!-- Top CTA row (Brief + Contact Your Human) -->
          ${ctaRow}

          <!-- Top of email (agenda / weather, in saved order) -->
          ${topSections}

          <!-- Executive Summary (TODAY), under weather -->
          ${todaySection}

          <!-- Post Content (Video Remix + Video Promo) — own section -->
          ${postContentSection}

          <!-- ── One headed section per brief (STAND UP) ── -->
          ${marketSignalsSection}
          ${creativeSection}
          ${webPerfSection}
          ${platformSection}
          ${opsSection}
          ${freshnessSection}

          <!-- Bottom CTA row (Brief + Contact Your Human) -->
          ${ctaRow ? `<div style="border-top:1px solid ${DT.line};padding-top:28px;margin-top:32px;">${ctaRow}</div>` : ''}

          <!-- Footer -->
          <div style="border-top:1.5px solid ${DT.line};padding-top:22px;margin-top:32px;">
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;color:${DT.light};margin-bottom:10px;">Generated ${new Date(timestamp).toLocaleTimeString('en-US')}</div>
            ${freshnessTokenText ? `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.04em;color:${DT.light};margin-bottom:10px;">Freshness token ${escapeHtml(freshnessTokenText)}</div>` : ''}
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;">
              <a href="${escapeHtml(briefLinkUrl)}" style="color:${DT.accent};">Executive Brief</a> &nbsp;&middot;&nbsp;
              ${showContact ? `<a href="${contactHref}" style="color:${DT.accent};">Contact Your Human</a> &nbsp;&middot;&nbsp;` : ''}
              <a href="https://vercel.com/baiees-projects/port-2026" style="color:${DT.accent};">Vercel</a> &nbsp;&middot;&nbsp;
              <a href="https://console.firebase.google.com/project/human-in-the-loop-a1a19" style="color:${DT.accent};">Firebase</a> &nbsp;&middot;&nbsp;
              <a href="https://analytics.google.com" style="color:${DT.accent};">GA4</a>
            </div>
          </div>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  // Strip template-literal indentation — pure whitespace to email clients, but
  // ~10KB on a full email, and every KB counts against Gmail's ~102KB clip.
  return emailHtml.replace(/\n[ \t]+/g, '\n');
}

// ── Email sender ────────────────────────────────────────────────────────────

export async function sendEmail(subject, html, to = DIGEST_TO) {
  if (!RESEND_API_KEY) {
    logWarn('daily_digest_email_skipped_missing_api_key');
    return { skipped: true, reason: 'RESEND_API_KEY not configured' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: DIGEST_FROM,
      to: [to || DIGEST_TO],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error (${res.status}): ${err}`);
  }

  return res.json();
}

// ── X auto-posting ──────────────────────────────────────────────────────────

function selectDigestSuggestedPost(briefs, homeClientId) {
  const briefList = Array.isArray(briefs) ? briefs : [];
  const ordered = [
    ...briefList.filter((b) => b?.clientId === homeClientId),
    ...briefList.filter((b) => b?.clientId !== homeClientId),
  ];
  for (const brief of ordered) {
    const content = brief?.intel?.content || {};
    const strategyPost = (brief?.intel?.strategyBuilder?.today?.posts || [])
      .find((post) => String(post?.content || '').trim());
    const text = strategyPost?.content || content.x_post || content.primary_post || content.post || '';
    if (String(text || '').trim()) {
      return {
        clientId: brief.clientId || homeClientId,
        clientName: brief.clientName || brief.clientId || homeClientId,
        text: String(text).trim(),
      };
    }
  }
  return null;
}

async function enqueueDigestSuggestedPost({ homeClientId, briefs, timestamp, step }) {
  if (!homeClientId) return { ok: false, skipped: 'no-home-client' };
  const selected = selectDigestSuggestedPost(briefs, homeClientId);
  if (!selected?.text) return { ok: false, skipped: 'no-suggested-post' };

  const dateKey = new Date(timestamp).toISOString().slice(0, 10);
  const source = `daily-digest:${dateKey}:suggested-post`;
  let existing = [];
  try {
    existing = await readSocialQueue(homeClientId);
  } catch (err) {
    logWarn('daily_digest_x_queue_read_failed', { clientId: homeClientId, error: err.message });
  }
  const duplicate = existing.find((post) => post?.source === source);
  if (duplicate) {
    step?.('info', `X post already queued · @${DIGEST_X_HANDLE}`);
    return { ok: true, skipped: 'duplicate', post: duplicate };
  }

  const { optimized, agents } = runPostingAgents(selected.text, {
    source,
    xGrowthObjective: 'awareness',
  });
  const content = String(optimized || selected.text || '').trim();
  if (!content) return { ok: false, skipped: 'empty-post' };

  const scheduledAt = new Date(Date.now() + DIGEST_X_POST_DELAY_MINUTES * 60_000).toISOString();
  const post = await schedulePost(homeClientId, {
    content,
    source,
    scheduledAt,
    agents,
    xStrategy: {
      source: 'daily-digest',
      targetHandle: DIGEST_X_HANDLE,
      sourceClientId: selected.clientId || homeClientId,
      sourceClientName: selected.clientName || '',
      dateKey,
      contentHash: shortHash(content),
    },
  });
  step?.('success', `X post queued · @${DIGEST_X_HANDLE} · ${new Date(scheduledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
  logInfo('daily_digest_x_post_queued', {
    clientId: homeClientId,
    targetHandle: DIGEST_X_HANDLE,
    source,
    postId: post.id,
    scheduledAt,
  });
  return { ok: true, post };
}

// Social Auto-Publish — publishes (or queues for approval) the client's own
// daily video to its own connected account. ONLY called on a real send (the
// caller gates on isRealSend — this function assumes it, it does not re-check
// email-vs-preview itself). Never throws: every exit is a return, and the
// caller still wraps the call for defense in depth. Returns a ctx object
// ready for buildVideoPostRow, or null when nothing applies (mode 'off').
async function enqueueAutoPublishVideoPost({ clientId, platform, videoItems, timestamp, digestCfg, step }) {
  const platformLabel = platform === 'x' ? 'X' : platform;
  const platformCfg = digestCfg?.autoPublish?.platforms?.[platform];
  const mode = platformCfg?.mode || 'off';
  if (!clientId || mode === 'off') return null;

  let clientName = clientId;
  try {
    const snap = await fb.adminDb.collection('clients').doc(clientId).get();
    const data = snap.exists ? snap.data() : null;
    clientName = data?.companyName || data?.name || data?.dashboardTitle || clientId;
  } catch { /* fall back to the raw id */ }

  let account = null;
  try {
    account = await getSocialAccount(clientId, platform);
  } catch { /* treated as not-connected below */ }
  const handle = account?.connected ? account.username : null;
  const baseCtx = { clientName, handle, mode, platformLabel, approvalUrl: null, publishedAt: null };

  const item = videoItems?.remix;
  if (!item || !item.url) {
    step?.('info', `Auto-publish · no fresh video this run (@${platformLabel})`);
    return { ...baseCtx, skipped: 'no-video' };
  }
  // Hard gate, not a warning: a carried-over (stale) video must never reach a
  // live account under either mode. The reader already sees the stale badge
  // on the card itself.
  if (item.stale) {
    step?.('info', `Auto-publish · skipped, video is stale (@${platformLabel})`);
    return { ...baseCtx, skipped: 'stale' };
  }
  if (!account?.connected) {
    step?.('info', `Auto-publish · ${platformLabel} not connected for this client`);
    return { ...baseCtx, skipped: 'not-connected' };
  }

  const dateKey = new Date(timestamp).toISOString().slice(0, 10);
  const source = `daily-video:${platform}:${dateKey}`;
  let existing = [];
  try {
    existing = await readSocialQueue(clientId);
  } catch (err) {
    logWarn('daily_digest_autopublish_queue_read_failed', { clientId, error: err.message });
  }
  const duplicate = existing.find((post) => post?.source === source);
  if (duplicate) {
    step?.('info', `Auto-publish · already queued for today (@${platformLabel})`);
    return {
      ...baseCtx,
      approvalUrl: duplicate.approvalUrl || null,
      publishedAt: duplicate.postedAt || null,
      skipped: 'duplicate',
    };
  }
  const todayPrefix = `daily-video:${platform}:`;
  const maxPerDay = Math.max(1, Math.min(10, Number(platformCfg?.maxPerDay) || 1));
  const publishedToday = existing.filter((post) => String(post?.source || '').startsWith(todayPrefix)).length;
  if (publishedToday >= maxPerDay) {
    step?.('info', `Auto-publish · daily cap reached (@${platformLabel})`);
    return { ...baseCtx, skipped: 'max-per-day' };
  }

  // The caption is already generated upstream for the email card — reuse it
  // (zero extra LLM cost). Only fall back to a fresh generation if it's empty.
  let caption = String(item.caption || '').trim();
  if (!caption) {
    try {
      caption = await generatePromoCopy({ name: clientName }, {});
    } catch { /* leave empty — handled below */ }
  }
  if (!caption) {
    step?.('info', `Auto-publish · no caption available (@${platformLabel})`);
    return { ...baseCtx, skipped: 'no-caption' };
  }

  const media = { mediaUrl: item.url, mediaType: 'video', mediaContentType: 'video/mp4', mediaJobId: item.mediaJobId || null };

  if (mode === 'auto') {
    try {
      const post = await postNow(clientId, { content: caption, source, platform, ...media });
      step?.('success', `Auto-published · @${handle || platformLabel} · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
      logInfo('daily_digest_autopublish_posted', { clientId, platform, postId: post.id });
      return { ...baseCtx, publishedAt: post.postedAt || new Date().toISOString() };
    } catch (err) {
      step?.('error', `Auto-publish failed · ${err.message}`);
      logWarn('daily_digest_autopublish_failed', { clientId, platform, error: err.message });
      return { ...baseCtx, skipped: 'publish-failed', error: err.message };
    }
  }

  // mode === 'approval'
  try {
    const post = await createSocialPost(clientId, { content: caption, source, platform, status: 'awaiting_approval', ...media });
    const { token } = await signApprovalToken({ postId: post.id, clientId, platform });
    const approvalUrl = `${appOrigin()}/post-approval/${encodeURIComponent(token)}`;
    step?.('success', `Auto-publish · approval link minted (@${handle || platformLabel})`);
    logInfo('daily_digest_autopublish_approval_queued', { clientId, platform, postId: post.id });
    return { ...baseCtx, approvalUrl };
  } catch (err) {
    step?.('error', `Auto-publish approval enqueue failed · ${err.message}`);
    logWarn('daily_digest_autopublish_enqueue_failed', { clientId, platform, error: err.message });
    return { ...baseCtx, skipped: 'enqueue-failed', error: err.message };
  }
}

// ── Placeholder data (template preview) ───────────────────────────────────────
// Renders the full email layout with representative sample data and NO live API
// calls (GA4 / Vercel / Calendar / Firebase / LLM). Lets an admin review and
// edit the layout + section structure without generating a real digest.
function buildPlaceholderData(timestamp) {
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (off = 0) => new Date(timestamp + off).toISOString();
  const mkDay = (off, isToday, events) => {
    const d = new Date(timestamp + off * DAY);
    return {
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      isToday,
      events,
    };
  };
  return {
    firebase: {
      totalUsers: 128,
      newUsers: 3,
      newUsersList: [
        { email: 'sample.user@example.com', website: 'example.com', createdAt: iso() },
        { email: 'placeholder@example.com', website: null, createdAt: iso(-3600000) },
      ],
      totalClients: 14,
      totalRuns: 320,
      recentRuns: 2,
      recentRunsList: [
        { id: 'sample-run-1', status: 'succeeded', website: 'example.com', createdAt: iso(-1800000) },
        { id: 'sample-run-2', status: 'queued', website: 'placeholder.io', createdAt: iso(-5400000) },
      ],
      statusCounts: { succeeded: 280, failed: 12, queued: 4 },
    },
    vercel: {
      deployments: [{ state: 'READY', url: 'sample.vercel.app', commit: 'feat: sample deployment (placeholder)', created: iso(-2700000) }],
      errorLogs: [],
      totalDeployments: 1,
    },
    ga4: {
      overview: { sessions: 240, totalUsers: 180, newUsers: 90, pageViews: 760, avgSessionDuration: 95, bounceRate: 42, engagedSessions: 150 },
      topPages: [
        { path: '/ (placeholder)', views: 120, users: 80 },
        { path: '/work (placeholder)', views: 64, users: 41 },
      ],
      trafficSources: [
        { source: 'google', medium: 'organic', sessions: 140, users: 110 },
        { source: 'direct', medium: '(none)', sessions: 60, users: 48 },
      ],
      events: { sign_up: 3, dashboard_created: 2, tile_opened: 18 },
      error: null,
    },
    agenda: {
      events: [{ summary: 'Sample standup', location: '', allDay: false, timeLabel: '9:00 AM' }],
      days: [
        mkDay(0, true, [{ summary: 'Sample standup', timeLabel: '9:00 AM', location: '', allDay: false }, { summary: 'Sample client call', timeLabel: '1:30 PM', location: 'Zoom', allDay: false }]),
        mkDay(1, false, [{ summary: 'Sample review', timeLabel: '2:00 PM', location: '', allDay: false }]),
        mkDay(2, false, []),
      ],
      tomorrowSummary: 'Sample — 1 event. First up — “Sample review” at 2:00 PM.',
      error: null,
    },
    homepage: {
      totalEvents: 42,
      byEventName: [{ name: 'homepage_cta_click', count: 12 }, { name: 'homepage_scroll_depth', count: 18 }],
      byInteractionType: [{ name: 'cta click', count: 12 }, { name: 'scroll', count: 18 }],
      topTargets: [{ name: 'Get Started (homepage_cta_click)', count: 9 }, { name: 'View Work (homepage_button_click)', count: 5 }],
      outboundLinks: [{ name: 'https://example.com (placeholder)', count: 4 }],
      scrollDepths: [{ name: '50%', count: 20 }, { name: '75%', count: 14 }],
      webVitals: [{ name: 'LCP', count: 30, average: 2100, needsImprovement: 2, poor: 0 }],
      error: null,
    },
    summary: {
      paragraph: 'This is placeholder executive-summary text. When you run the digest, an AI-written recap of the day’s sign-ups, traffic, deployments, and strategic brief will appear here in this slot.',
      lead: 'Claim the “Creative Systems Architect” positioning before competitors cement it — ship a short-form piece today.',
      callouts: [
        { category: 'Platform', headline: '52 users · 1 new signup', line: 'Three dashboards created in the last 24h; momentum is steady.' },
        { category: 'Calendar', headline: 'Asa · 9 AM class', line: 'Creative movement class this morning — light operating day otherwise.' },
        { category: 'Traffic', headline: '29 sessions · 59% bounce', line: 'Modest day; /dashboard is the strongest landing with high CTA engagement.' },
        { category: 'Strategy', headline: 'Stake the narrative', line: 'Use @0xCharlota’s “feel not ship” framing as the tension your system resolves.' },
      ],
    },
    creative: {
      clientName: 'Sample Client',
      summary: 'Placeholder Creative Brief — when the Creative Brief toggle is on and the client has a run brief, its cover summary is attached here, with a hero mockup above it. This is the same onboarding deliverable shown on the Creative Brief card.',
      generatedAt: iso(),
      image: null,
    },
    // One placeholder brief carrying only a watchlist-analysis snapshot, so the
    // "Happening on X" block renders in the template preview. The strategic-brief
    // block stays empty (no opportunities/KOLs/etc.) on purpose.
    briefs: [{
      clientName: 'Sample Client',
      intel: {
        weather: {
          place: 'Austin, TX',
          today: { name: 'Today', short: 'Sunny', temp: 92, unit: 'F', wind: '8 mph' },
          threeDayLine: 'Sun 94° · Mon 90° · Tue 88°',
        },
        opportunities: [
          { topic: 'Anthropic “stop prompting agents” thread', angle: 'Live now — reply within hours to claim the systems-thinking positioning before competitors do.', windowHours: 3, suggestedReply: 'Exactly — you shouldn’t prompt your brand, you build the system that runs it. That’s the whole loop we ship at HITLOOP.', url: 'https://x.com/anthropic/status/1' },
          { topic: '@0xCharlota Figma Make thread', angle: 'Genuine systems-thinking reply to her Figma thread — no pitch, just infrastructure talk.', windowHours: 96, suggestedReply: '“engineered, not designed” is the right frame. The missing piece is the contract between brief → output → next cycle.', url: 'https://x.com/0xCharlota/status/2' },
        ],
        watchlist: [
          { handle: 'sample_handle', found: true, activity: [{ text: 'Just shipped a brand manual template built in Framer — feel, not ship.', url: 'https://x.com/sample_handle/status/1' }] },
          { handle: 'another_voice', found: true, activity: [{ text: 'Hot take: model selection is becoming a checkbox, not a differentiator.', url: 'https://x.com/another_voice/status/2' }] },
        ],
        watchlistAnalysis: JSON.stringify({
          overview: 'Placeholder watchlist read — @sample_handle is shipping launch teasers while @another_voice drives the category conversation. Real overview text fills in when you run Pull timelines in the dashboard.',
          priorityAction: 'Placeholder action — reply to @sample_handle’s launch thread within the hour to ride the engagement window.',
          handles: [
            { handle: 'sample_handle', posting: 'Posting launch teasers and behind-the-scenes clips; high reply volume.', talkedAbout: 'Mentioned as the one to watch in the category this week.' },
            { handle: 'another_voice', posting: 'Sharing market commentary and contrarian takes.', talkedAbout: 'Quoted across several threads debating the new direction.' },
          ],
          spotlight: { handle: 'sample_handle', why: 'Placeholder spotlight — biggest engagement spike of the tracked set; their launch thread is the conversation to enter.' },
        }),
        redditAnalysis: JSON.stringify({
          overview: 'Placeholder Reddit read — indexed recommendation threads are clustering around trust, setup friction, and vendor comparisons. Real text fills in after the Reddit analyzer runs over Market Insights redditSignals.',
          priorityAction: 'Placeholder action — join the highest-intent recommendation thread with a useful non-pitch answer and link only if the thread asks for examples.',
          threads: [
            { title: 'Looking for tools that remove manual content planning', subreddit: 'SaaS', summary: 'Buyers are asking for workflow proof, not generic AI claims.', url: 'https://www.reddit.com/r/SaaS/comments/sample' },
            { title: 'How are teams keeping brand voice consistent?', subreddit: 'marketing', summary: 'The conversation is about process reliability and review loops.', url: 'https://www.reddit.com/r/marketing/comments/sample' },
          ],
          spotlight: { subreddit: 'SaaS', why: 'Best participation fit in the sample set because the thread is problem-led and close to purchase research.', url: 'https://www.reddit.com/r/SaaS/comments/sample' },
        }),
      },
    }],
  };
}

// ── Route handler ───────────────────────────────────────────────────────────

/**
 * Scheduled-cron fan-out. The Vercel cron hits this route with no ?clientId=,
 * which resolves a SINGLE client (the env/admin-resolved one) and sends exactly
 * one email — even though /api/worker/pre-digest-refresh already refreshes
 * EVERY daily-enrolled client. Enrolled clients therefore had their
 * intelligence rebuilt daily and never mailed.
 *
 * Re-enters this same route once per enrolled client with an explicit
 * ?clientId=, which scopes config, briefs, stats and recipient to that client
 * (the single-client path below is untouched). Each sub-send is its own
 * invocation with its own timeout budget, and is still gated by that client's
 * own schedule.enabled. Sequential on purpose: a send does heavy per-client
 * reads and the parent must stay inside maxDuration.
 *
 * The client set mirrors pre-digest-refresh (home + enrolled) so send and
 * refresh can never drift apart; a home client that is not enrolled is simply
 * skipped by the gate in its own sub-request.
 */
async function fanOutScheduledSends(url) {
  const startedAtMs = Date.now();
  const FANOUT_BUDGET_MS = 270_000;

  let clientIds = [];
  try {
    const configClientId = await digestConfig.resolveDigestClientId();
    const cfg = await digestConfig.getDigestConfig(configClientId);
    const homeClientId = cfg.homeClientId || configClientId;
    const enrolledIds = await digestConfig.listCronEnrolledClientIds();
    clientIds = [...new Set([homeClientId, ...enrolledIds].filter(Boolean))];
  } catch (err) {
    logError('daily_digest_fanout_resolve_error', { error: err.message });
    return json({ error: `Could not resolve digest clients: ${err.message}` }, 500);
  }
  if (!clientIds.length) {
    return json({ ok: true, skipped: true, reason: 'No clients enrolled in the daily digest.' });
  }

  // Sub-requests re-enter this route, so they must carry cron/worker auth.
  const headers = { 'cache-control': 'no-store' };
  if (process.env.CRON_SECRET) headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
  else if (WORKER_SECRET) headers['x-worker-secret'] = WORKER_SECRET;

  // Re-enter the SAME deployment the cron hit. appOrigin() falls back to the
  // production alias, so using it here would make a local-dev or preview-deploy
  // fan-out fire its sub-sends at a different build than the one running.
  const selfOrigin = url.origin || appOrigin();

  logInfo('daily_digest_fanout_start', { clients: clientIds.length, clientIds, origin: selfOrigin });

  const results = [];
  for (const clientId of clientIds) {
    if (results.length > 0 && Date.now() - startedAtMs > FANOUT_BUDGET_MS) {
      logError('daily_digest_fanout_budget_exhausted', {
        completed: results.length,
        total: clientIds.length,
        elapsedMs: Date.now() - startedAtMs,
      });
      break;
    }
    const target = new URL('/api/admin/daily-digest', selfOrigin);
    // Carry through anything the cron/caller set (e.g. freshnessToken); the
    // per-client id always wins.
    url.searchParams.forEach((value, key) => {
      if (key !== 'clientId') target.searchParams.set(key, value);
    });
    target.searchParams.set('clientId', clientId);

    let entry;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(target.toString(), { headers, cache: 'no-store' });
      // eslint-disable-next-line no-await-in-loop
      const body = await res.json().catch(() => ({}));
      entry = {
        clientId,
        status: res.status,
        ok: res.ok && body?.ok !== false,
        skipped: body?.skipped === true,
        reason: body?.reason || null,
        error: body?.error || null,
      };
    } catch (err) {
      entry = { clientId, ok: false, error: err.message };
    }
    results.push(entry);
    logInfo('daily_digest_fanout_client_done', entry);
  }

  const complete = results.length === clientIds.length;
  const ok = complete && results.every((r) => r.ok);
  logInfo('daily_digest_fanout_done', {
    clients: clientIds.length,
    completed: results.length,
    sent: results.filter((r) => r.ok && !r.skipped).length,
    ok,
  });
  return json({ ok, fanout: true, clientIds, complete, results });
}

export async function GET(request) {
  const url = new URL(request.url);
  const previewParam = url.searchParams.get('preview');
  const isPreview = previewParam === '1';
  const isTemplate = previewParam === 'template';
  const isSendNow = url.searchParams.get('send') === '1';
  const freshnessToken = String(url.searchParams.get('freshnessToken') || '').trim().slice(0, 160);
  const returnHtml = url.searchParams.get('returnHtml') === '1';
  // Preview-only `noLlm=1`: render from saved data with ZERO LLM calls (skips
  // the executive summary + video captions). Free way to check email size and
  // section presence for any client without generating anything.
  const skipLlm = isPreview && url.searchParams.get('noLlm') === '1';

  // Optional `include` override (preview only): comma-separated list of the
  // section keys to turn ON, so the Email Digest card can preview the layout
  // with the admin's current (even unsaved) toggles. Absent → use saved config.
  // Present-but-empty (`include=`) → all sections off.
  const includeOverride = (() => {
    if (!url.searchParams.has('include')) return null;
    const on = new Set(String(url.searchParams.get('include') || '').split(',').map((s) => s.trim()).filter(Boolean));
    const out = {};
    for (const k of DIGEST_INCLUDE_KEYS) out[k] = on.has(k);
    return out;
  })();

  // Optional `demo` override (preview only): csv of demo-metric group keys to
  // render ZEROED, so the card previews its current (even unsaved) demo toggles.
  // Present-but-empty (`demo=`) → every group real.
  const demoOverride = (isPreview && url.searchParams.has('demo'))
    ? (() => {
        const on = new Set(String(url.searchParams.get('demo') || '').split(',').map((s) => s.trim()).filter(Boolean));
        const out = {};
        for (const k of digestConfig.DEMO_METRIC_KEYS) out[k] = on.has(k);
        return out;
      })()
    : null;

  // Optional `contactUrl` override (preview only) so the typed-but-unsaved
  // Calendly URL appears in the live preview immediately, like include toggles.
  const contactUrlOverride = (isPreview && url.searchParams.has('contactUrl'))
    ? String(url.searchParams.get('contactUrl') || '').trim()
    : null;

  // Optional `order` override (preview only): comma-separated section keys, so
  // the live preview reflects the admin's current (even unsaved) reordering.
  const orderOverride = (isPreview && url.searchParams.has('order'))
    ? String(url.searchParams.get('order') || '').split(',').map((s) => s.trim()).filter(Boolean)
    : null;

  // Optional `posts` override (preview only): csv of ENABLED suggested-post
  // platforms, so the live preview reflects the card's current platform toggles.
  const postsOverride = (isPreview && url.searchParams.has('posts'))
    ? (() => {
        const on = new Set(String(url.searchParams.get('posts') || '').split(',').map((s) => s.trim()).filter(Boolean));
        const out = {};
        for (const k of digestConfig.POST_PLATFORM_KEYS) out[k] = on.has(k);
        return out;
      })()
    : null;

  // Auth: cron/worker secret for the scheduled run; admin token for dashboard
  // preview / send-now actions.
  let adminOk = false;
  if (isPreview || isTemplate || isSendNow) {
    try {
      await verifyAdminRequest(buildAuthRequestShim(request));
      adminOk = true;
    } catch {
      adminOk = false;
    }
  }
  if (!hasValidSecret(request) && !hasValidCronSecret(request) && !adminOk) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // The pure scheduled run (no ?clientId=) fans out to every enrolled client;
  // each sub-request comes back here WITH a clientId and takes the normal
  // single-client path below, so this never recurses.
  const isScheduledRun = !isPreview && !isTemplate && !isSendNow;
  const hasExplicitClient = Boolean(String(url.searchParams.get('clientId') || '').trim());
  if (isScheduledRun && !hasExplicitClient) {
    return fanOutScheduledSends(url);
  }

  // Template preview: render the full layout with placeholder data only — no
  // live API/LLM calls, nothing sent. Instant; for reviewing/editing the email.
  if (isTemplate) {
    try {
      const ts = Date.now();
      const ph = buildPlaceholderData(ts);
      const include = includeOverride || { ...digestConfig.DEFAULT_INCLUDE };
      // A sample hosted-brief URL so the CTA renders a realistic link in template mode.
      const sampleBriefUrl = appUrl('/briefs/sample-client/latest');
      const sampleContactUrl = 'https://calendly.com/your-human/intro';
      const sampleVideoItems = {
        remix: { url: 'https://example.com/remix-1.mp4', duration: 30, caption: 'Stop scrolling — this 30s cut shows exactly how we turn raw clips into a launch-ready edit. Built for the feed. ▶ #creative' },
        promo: { url: 'https://example.com/promo-1.mp4', duration: 22, caption: 'Your site, reimagined as a social-ready promo. Watch the 3D mockup walkthrough — then ship it. #promo' },
      };
      const html = buildEmailHtml(ph.firebase, ph.vercel, ph.ga4, ph.agenda, ph.homepage, ts, ph.summary, ph.briefs, include, ph.creative, sampleBriefUrl, sampleContactUrl, sampleVideoItems, orderOverride || digestConfig.DEFAULT_ORDER, postsOverride || digestConfig.DEFAULT_POST_PLATFORMS, freshnessToken);
      return json({ ok: true, template: true, placeholder: true, timestamp: new Date(ts).toISOString(), paragraph: ph.summary.paragraph, html });
    } catch (err) {
      logError('daily_digest_template_error', { error: err.message });
      return json({ error: err.message || 'Template render failed' }, 500);
    }
  }

  try {
    const timestamp = Date.now();
    logInfo('daily_digest_start', { timestamp: new Date(timestamp).toISOString() });

    // Resolve the digest home client up front so the agenda reads that client's
    // connected calendar. The Email Digest card's `include.agenda` toggle is the
    // single authority for whether the agenda is included (P2b migration).
    let homeClientId = null;
    let digestCfg = null;
    // Whether THIS send may use the shared service-account calendar
    // (DIGEST_CALENDAR_ID). Default true preserves the legacy/home behavior if
    // resolution throws; a scoped non-home client is set false below so it can
    // never inherit the home owner's calendar (see getCalendarAgenda).
    let allowSharedCalendar = true;
    try {
      // Explicit ?clientId= (the Email Digest card passes its active client) scopes
      // the WHOLE send to that client — its digest config, briefs, stats, and
      // recipient. Without it (the scheduled cron), fall back to the env-resolved
      // admin client. Never mix: resolving by admin email while viewing another
      // client's dashboard was the cross-client contamination path.
      const requestedDigestClientId = String(url.searchParams.get('clientId') || '').trim();
      const envDigestClientId = await digestConfig.resolveDigestClientId();
      const configClientId = requestedDigestClientId || envDigestClientId;
      digestCfg = await digestConfig.getDigestConfig(configClientId);
      digestCfg = {
        ...digestCfg,
        include: mergeCompatInclude(digestCfg?.include, await readRawDigestInclude(configClientId)),
      };
      homeClientId = (requestedDigestClientId ? configClientId : digestCfg.homeClientId) || configClientId;
      // Unscoped run = the home/env send (shared calendar is legitimately its own).
      // A scoped run gets the shared calendar only when it IS the env/home client.
      allowSharedCalendar = !requestedDigestClientId || homeClientId === envDigestClientId;
    } catch { /* resolution failed — agenda falls back to the env calendar */ }

    // Gate the SCHEDULED send by the daily-email toggle (schedule.enabled). The
    // same switch that gates the refresh cron gates the send, so one toggle
    // controls the whole daily pipeline for a client. Manual "Send Now"
    // (isSendNow) and previews always bypass this; only the pure cron run is
    // gated. If config resolution failed (digestCfg null) we don't block —
    // preserve prior behavior rather than silently drop a legit send.
    if (!isPreview && !isTemplate && !isSendNow && digestCfg && !digestConfig.isCronEnrolled(digestCfg.schedule)) {
      logInfo('daily_digest_skipped_not_enrolled', { clientId: homeClientId });
      return json({ ok: true, skipped: true, reason: 'Daily email is off for this client (schedule disabled).' });
    }

    // All clients whose intelligence feeds this email: the home client + any
    // included clients. Computed up front so we can refresh them before reading.
    const briefClientIds = [...new Set([homeClientId, ...(digestCfg?.includeClientIds || [])].filter(Boolean))];

    // ── Fresh-run gate ──────────────────────────────────────────────────────
    // The normal path is now two-step:
    //   1. /api/worker/pre-digest-refresh refreshes Scout + watchlist + strategy.
    //   2. This route reads saved data and sends quickly.
    // Send routes never run Scout inline. Inline refresh was the source of
    // time-boxed sends and orphaned "running" brief_runs; fresh data must be
    // produced by /api/worker/pre-digest-refresh before this route sends.
    const isRealSend = isSendNow || (!isPreview && !isTemplate);
    const skipInlineRefresh = url.searchParams.get('skipRefresh') === '1' || url.searchParams.get('refresh') === '0';
    const forceInlineRefresh = url.searchParams.get('refresh') === 'inline';
    // Execution log returned to the Email Digest card's terminal so the admin can
    // confirm what the send did (refresh per client, brief link, video, render,
    // send). Only meaningful on a real send.
    const sendLog = [];
    const step = (type, text) => sendLog.push({ type, text });
    if (isRealSend && briefClientIds.length) {
      if (forceInlineRefresh) {
        logWarn('daily_digest_inline_refresh_disabled', { clients: briefClientIds.length });
        step('error', 'Inline refresh is disabled; sending from latest saved data. Run the pre-digest refresh worker first for fresh data.');
      }
      step('info', skipInlineRefresh
        ? 'Refresh skipped by request — sending from latest saved digest data.'
        : 'Scheduled send — using latest saved digest data from pre-digest refresh.');
    }

    // Email Digest card aggregation toggles. These gate the collectors (to skip
    // their API cost) and the rendered sections. A preview `include` override
    // (the card's current, possibly-unsaved toggles) wins over the saved config.
    let include = includeOverride || digestCfg?.include || { ...digestConfig.DEFAULT_INCLUDE };
    try {
      const marketState = await getMarketInsightPlatformState(homeClientId);
      const available = marketState.platformAvailability || {};
      include = {
        ...include,
        watchlist: available.x === false ? false : include.watchlist,
        redditAnalysis: available.reddit === false ? false : include.redditAnalysis,
        instagramAnalysis: available.instagram === false ? false : include.instagramAnalysis,
      };
    } catch { /* keep saved include if the config lookup fails */ }
    // Opportunity Signals is its own opt-in feature (marketingBriefConfig.opportunitySignals),
    // separate from platformAvailability — gate the email section on both the
    // digest toggle AND the feature's own enabled/includeInEmail settings.
    try {
      const cfgSnap = await fb.adminDb.collection('client_configs').doc(homeClientId).get();
      const osCfg = cfgSnap.exists ? (cfgSnap.data()?.marketingBriefConfig?.opportunitySignals || null) : null;
      if (!osCfg?.enabled || osCfg?.includeInEmail === false) include = { ...include, opportunitySignals: false };
    } catch { /* keep saved include if the config lookup fails */ }

    // Web Stats card settings (Website Developer bucket) — per-home-client GA4
    // property, tracked event list, and homepage block toggle. Empty values fall
    // back to the route env/defaults so behavior is unchanged when never set.
    let webStats = {};
    if (homeClientId) {
      try {
        const ccSnap = await fb.adminDb.collection('client_configs').doc(homeClientId).get();
        webStats = ccSnap.data()?.webStatsConfig || {};
      } catch { /* default: env values */ }
    }
    const ga4PropertyId = webStats.ga4PropertyId || GA4_PROPERTY_ID;
    const ga4EventNames = Array.isArray(webStats.trackedEvents) && webStats.trackedEvents.length
      ? webStats.trackedEvents
      : DIGEST_EVENT_NAMES;
    const homepageEnabled = webStats.homepageEnabled !== false;

    const NEUTRAL_VERCEL = { deployments: [], errorLogs: [], totalDeployments: 0 };
    const NEUTRAL_GA4 = { overview: null, topPages: [], trafficSources: [], events: {}, error: null };
    const NEUTRAL_AGENDA = { events: [], days: [], tomorrowSummary: '', error: null };
    const NEUTRAL_HOMEPAGE = { totalEvents: 0, byEventName: [], byInteractionType: [], topTargets: [], outboundLinks: [], scrollDepths: [], webVitals: [], error: null };

    // Demo (zeroed) fixtures. Same shapes as the NEUTRAL_* ones, but the stat-cell
    // sources carry a real zeroed object instead of null/absent so the section
    // renders its numbers AT 0 rather than collapsing to prose — the client sees
    // the slot. `demo: true` switches each empty-state to "connect this" copy.
    const ZERO_GA4 = {
      overview: { sessions: 0, pageViews: 0, totalUsers: 0, newUsers: 0, bounceRate: 0, avgSessionDuration: 0, engagedSessions: 0 },
      topPages: [], trafficSources: [], events: {}, error: null, demo: true,
    };
    const ZERO_VERCEL = { ...NEUTRAL_VERCEL, demo: true };
    // Homepage + Platform demo groups render SAMPLE rows (not empty "connect this"
    // copy) so a not-yet-connected client sees a populated, representative slot.
    // Values are deliberately obvious placeholders (example.com) and carry
    // `demo: true` so the summary LLM skips them (see _brief-summary compactData).
    const now = timestamp;
    const SAMPLE_HOMEPAGE = {
      totalEvents: 42,
      byEventName: [{ name: 'homepage_cta_click', count: 12 }, { name: 'homepage_scroll_depth', count: 18 }],
      byInteractionType: [{ name: 'cta click', count: 12 }, { name: 'scroll', count: 18 }, { name: 'link click', count: 6 }],
      topTargets: [{ name: 'Get Started (sample)', count: 9 }, { name: 'View Work (sample)', count: 5 }],
      outboundLinks: [{ name: 'https://example.com (sample)', count: 4 }],
      scrollDepths: [{ name: '50%', count: 20 }, { name: '75%', count: 14 }, { name: '100%', count: 6 }],
      webVitals: [{ name: 'LCP', count: 30, average: 2100, poor: 0 }, { name: 'CLS', count: 30, average: 0.06, poor: 0 }],
      error: null, demo: true,
    };
    const SAMPLE_FIREBASE = {
      totalUsers: 128, newUsers: 3,
      newUsersList: [
        { email: 'sample.user@example.com', website: 'example.com', createdAt: new Date(now - 1_800_000).toISOString() },
        { email: 'new.lead@example.com', website: 'example.org', createdAt: new Date(now - 5_400_000).toISOString() },
        { email: 'placeholder@example.com', website: null, createdAt: new Date(now - 9_000_000).toISOString() },
      ],
      totalClients: 14, totalRuns: 320, recentRuns: 2,
      recentRunsList: [
        { id: 'sample-run-1', status: 'succeeded', website: 'example.com', createdAt: new Date(now - 2_700_000).toISOString() },
        { id: 'sample-run-2', status: 'queued', website: 'example.org', createdAt: new Date(now - 6_300_000).toISOString() },
      ],
      statusCounts: { succeeded: 280, failed: 12, queued: 4 }, demo: true,
    };

    // Demo groups (Email Digest card) — see DEMO_METRIC_GROUPS in _digest-config.
    // A demo group skips its collector entirely: no GA4/Vercel/Firestore cost.
    const demoMetrics = demoOverride || digestCfg?.demoMetrics || { ...digestConfig.DEFAULT_DEMO_METRICS };
    const demoWebPerf = demoMetrics.webPerformance === true;
    const demoPlatform = demoMetrics.platform === true;
    const demoDeployments = demoMetrics.deployments === true;
    const demoCalendar = demoMetrics.calendar === true;

    // Derived group flags: only pay a collector's API cost when at least one of
    // the granular sections it powers is enabled (and the group isn't demoed).
    const needVercel = !demoDeployments && (include.deployments !== false || include.runtimeErrors !== false);
    const needGA4 = !demoWebPerf && (include.ga4Traffic !== false || include.topPages !== false
      || include.trafficSources !== false || include.keyEvents !== false);
    const needHomepage = !demoWebPerf && include.homepage !== false && homepageEnabled;

    const [firebase, vercel, ga4, agenda, homepage] = await Promise.all([
      // Firebase powers the subject line + platform stats. Demoed => zeroed, so a
      // client's email never quotes our internal sign-up/dashboard counts.
      demoPlatform ? Promise.resolve(SAMPLE_FIREBASE) : getFirebaseMetrics(),
      needVercel ? getVercelMetrics() : Promise.resolve(demoDeployments ? ZERO_VERCEL : NEUTRAL_VERCEL),
      needGA4 ? getGA4Metrics({ propertyId: ga4PropertyId, eventNames: ga4EventNames }) : Promise.resolve(demoWebPerf ? ZERO_GA4 : NEUTRAL_GA4),
      include.agenda === false
        ? Promise.resolve(NEUTRAL_AGENDA)
        : demoCalendar
          ? Promise.resolve(buildDemoAgenda(timestamp)) // no Google Calendar call
          : getCalendarAgenda(timestamp, { clientId: homeClientId, enabled: true, allowSharedCalendar }),
      needHomepage ? getHomepageAnalyticsMetrics() : Promise.resolve(demoWebPerf ? SAMPLE_HOMEPAGE : NEUTRAL_HOMEPAGE),
    ]);

    // Render flags: homepage block also honors the Web Stats homepage toggle.
    const renderInclude = { ...include, homepage: include.homepage !== false && homepageEnabled };

    const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    // Strategic brief intelligence (post ideas, KOLs, competitors, narratives)
    // mirrored from the established daily brief, aggregated across the home
    // client + any included clients. Additive — calendar/analytics are rendered
    // unconditionally elsewhere and never depend on this block.
    let summary = null;
    let briefs = [];
    let creative = null;
    try {
      const fullDateStr = new Date(timestamp).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const cfg = digestCfg || await digestConfig.getDigestConfig(await digestConfig.resolveDigestClientId());
      if (!homeClientId) homeClientId = cfg.homeClientId || null;
      // Reuse the up-front list (recompute only if homeClientId was just resolved).
      const briefIds = briefClientIds.length ? briefClientIds : [...new Set([homeClientId, ...(cfg.includeClientIds || [])].filter(Boolean))];

      // The brief fetch powers every Market Signals item + weather + follower
      // posts — fetch if ANY brief-derived section is enabled.
      const needBrief = [
        'humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'watchlistAccounts', 'suggestedPosts',
        'planPreview', 'watchlist', 'redditAnalysis', 'instagramAnalysis', 'followerPosts', 'weather',
      ].some((k) => include[k] !== false);
      if (needBrief) {
        briefs = (await Promise.all(briefIds.map((cid) => briefIntel.getBriefForClient(cid)))).filter(Boolean);
      }

      // Creative Brief attachment (opt-in) — the run onboarding deliverable for the home client.
      if (include.creativeBrief && homeClientId) {
        creative = await briefIntel.getCreativeBriefForClient(homeClientId);
      }

      if (cfg.summaryEnabled && !skipLlm) {
        const { text: docsText } = await digestConfig.getRecentDocsText({
          clientId: homeClientId, count: cfg.recentDocsCount, maxChars: cfg.maxDocChars,
        });
        const briefText = briefs
          .map((b) => `[${b.clientName}]\n${briefIntel.briefIntelToText(b.intel)}`)
          .join('\n\n')
          .slice(0, 12000);
        // Approved Client Brain voice/positioning (optional, additive). Absent or
        // unapproved => '' => summary behaves exactly as before.
        let clientBrainContext = '';
        try {
          const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
          if (homeClientId) {
            clientBrainContext = await loadClientBrainContext(homeClientId, { useFor: 'emailDigest', maxChars: 1800 });
          }
        } catch (e) {
          logWarn('daily_digest_client_brain_failed', { error: e.message });
        }
        summary = await briefSummary.generateBriefSummary({
          dateStr: fullDateStr, agenda, ga4, firebase, homepage, docsText,
          briefText, clientBrainContext, config: cfg,
        });
      }
    } catch (err) {
      logWarn('daily_digest_summary_failed', { error: err.message });
    }

    // ── "Post content" block (TODAY section): latest 2 Video Remix videos, each
    // paired with an LLM-written X promo post. Toggle: include.videoPosts.
    // Live preview + real send generate captions (Haiku); template uses the
    // placeholder layout (no cost).
    // Two independent "Post content" rows, each its own toggle:
    //   videoPosts  → latest Video Remix video (mediaCaptures, type video_remix)
    //   videoPromo  → latest Video Promo video (studioCaptures, type studio_video)
    const videoItems = { remix: null, promo: null };
    const wantRemix = include.videoPosts !== false;
    const wantPromo = include.videoPromo !== false;
    const videoStatus = { remix: null, promo: null };
    if ((wantRemix || wantPromo) && homeClientId) {
      try {
        const readLatestCaptures = async () => {
          const ds = (await fb.adminDb.collection('dashboard_state').doc(homeClientId).get()).data() || {};
          const latestFresh = (items, type) => (Array.isArray(items) ? items : [])
            .filter((c) => c?.type === type && isFreshVideoCapture(c))
            .sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt))[0] || null;
          return {
            remix: wantRemix ? latestFresh(ds.mediaCaptures, 'video_remix') : null,
            promo: wantPromo ? latestFresh(ds.studioCaptures, 'studio_video') : null,
          };
        };

        const reconcileInFlight = async () => {
          try {
            const mediaJobsLib = require('../../../../api/_lib/media-jobs.cjs');
            const { reconcileMediaJob } = require('../../../../api/_lib/media-reconcile.cjs');
            const inflight = await mediaJobsLib.listInFlightMediaJobs(20);
            for (const job of inflight) {
              if (job?.clientId !== homeClientId) continue;
              try { await reconcileMediaJob(job, homeClientId); } catch { /* per-job best-effort */ }
            }
          } catch (e) {
            logWarn('daily_digest_media_reconcile_failed', { error: e.message });
          }
        };

        // Reconcile in-flight remix renders first (e.g. the one the pre-digest
        // video cron primed) so a just-finished video lands before we read it.
        // On real sends, wait briefly; on previews, keep it quick.
        const deadline = Date.now() + (isRealSend ? 45_000 : 0);
        let caps = { remix: null, promo: null };
        do {
          if (wantRemix) await reconcileInFlight();
          caps = await readLatestCaptures();
          if ((!wantRemix || caps.remix) && (!wantPromo || caps.promo)) break;
          if (!isRealSend || Date.now() >= deadline) break;
          await sleep(5_000);
        } while (Date.now() < deadline);

        let remixCap = caps.remix;
        let promoCap = caps.promo;
        if (remixCap) {
          const probe = await probeVideoUrl(remixCap.downloadUrl);
          if (!probe.ok) {
            videoStatus.remix = `Video Remix link failed validation (${probe.reason || 'unknown'}).`;
            remixCap = null;
          } else if (!isSameDigestDay(remixCap.createdAt, timestamp)) {
            videoStatus.remix = `REUSED from ${staleVideoLabel(remixCap.createdAt)} — today's render was not ready in time.`;
          } else {
            videoStatus.remix = `ready · ${remixCap.createdAt || 'fresh capture'}`;
          }
        } else if (wantRemix) {
          videoStatus.remix = 'Video Remix is still rendering or no fresh completed capture was found.';
        }
        if (promoCap) {
          const probe = await probeVideoUrl(promoCap.downloadUrl);
          if (!probe.ok) {
            videoStatus.promo = `Video Promo link failed validation (${probe.reason || 'unknown'}).`;
            promoCap = null;
          } else if (!isSameDigestDay(promoCap.createdAt, timestamp)) {
            videoStatus.promo = `REUSED from ${staleVideoLabel(promoCap.createdAt)} — today's render was not ready in time.`;
          } else {
            videoStatus.promo = `ready · ${promoCap.createdAt || 'fresh capture'}`;
          }
        } else if (wantPromo) {
          videoStatus.promo = 'Video Promo is still rendering or no fresh completed capture was found.';
        }

        // Caption the enabled videos (one Haiku call); skip on template (no cost).
        const toCaption = [];
        if (remixCap) toCaption.push(remixCap);
        if (promoCap) toCaption.push(promoCap);
        let captions = [];
        if (!isTemplate && !skipLlm && toCaption.length) {
          let brain = '';
          try {
            const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
            brain = await loadClientBrainContext(homeClientId, { useFor: 'copy', maxChars: 1500 });
          } catch { /* optional */ }
          try {
            captions = await briefSummary.generateVideoPromoPosts({
              videos: toCaption.map((c) => ({ durationSeconds: c.durationSeconds, sourceFolders: c.sourceFolders })),
              clientBrainContext: brain,
              config: digestCfg || {},
            });
          } catch (e) {
            logWarn('daily_digest_video_promo_failed', { error: e.message });
          }
        }
        let ci = 0;
        // `stale` = carried over from an earlier day; surfaced as a badge on the
        // card so a repeated video is never mistaken for a fresh one.
        if (remixCap) {
          const stale = !isSameDigestDay(remixCap.createdAt, timestamp);
          videoItems.remix = {
            url: remixCap.downloadUrl,
            duration: remixCap.durationSeconds || 30,
            caption: captions[ci++] || '',
            stale,
            staleLabel: stale ? staleVideoLabel(remixCap.createdAt) : '',
          };
        }
        if (promoCap) {
          const stale = !isSameDigestDay(promoCap.createdAt, timestamp);
          videoItems.promo = {
            url: promoCap.downloadUrl,
            duration: promoCap.durationSeconds || 0,
            caption: captions[ci++] || '',
            stale,
            staleLabel: stale ? staleVideoLabel(promoCap.createdAt) : '',
          };
        }
      } catch (e) {
        logWarn('daily_digest_video_posts_failed', { error: e.message });
      }
    }

    if (isRealSend && (wantRemix || wantPromo)) {
      const n = (videoItems.remix ? 1 : 0) + (videoItems.promo ? 1 : 0);
      step(n ? 'success' : 'info', n ? `Video · ${n} attached (remix:${videoItems.remix ? 'y' : 'n'} promo:${videoItems.promo ? 'y' : 'n'})` : 'No fresh video available yet');
      // A reused (stale) video is NOT a success — it means today's render missed
      // the send window and the reader is seeing yesterday's video again.
      const stepLevel = (item) => (!item ? 'error' : (item.stale ? 'warn' : 'success'));
      if (wantRemix && videoStatus.remix) step(stepLevel(videoItems.remix), `Video Remix · ${videoStatus.remix}`);
      if (wantPromo && videoStatus.promo) step(stepLevel(videoItems.promo), `Video Promo · ${videoStatus.promo}`);
    }

    let xPostResult = null;
    if (isRealSend && digestCfg?.autoPostX !== false) {
      try {
        xPostResult = await enqueueDigestSuggestedPost({ homeClientId, briefs, timestamp, step });
        if (xPostResult?.skipped && !['duplicate'].includes(xPostResult.skipped)) {
          step('info', `X post skipped · ${xPostResult.skipped}`);
        }
      } catch (err) {
        logWarn('daily_digest_x_post_enqueue_failed', { clientId: homeClientId, error: err.message });
        step('error', `X post enqueue failed: ${err.message}`);
      }
    }

    // Social Auto-Publish — the client's own daily video to its own account.
    // isRealSend gates the WHOLE enqueue, not just the publish call inside it:
    // a preview or template render must never write an 'awaiting_approval'
    // post or mint a live approval token, so anything but a real send only
    // describes the configured mode (read-only, no Firestore writes).
    const videoPublishCtx = { x: null };
    if (wantRemix && homeClientId) {
      const publishPlatform = 'x';
      const publishMode = digestCfg?.autoPublish?.platforms?.[publishPlatform]?.mode || 'off';
      if (publishMode !== 'off') {
        if (isRealSend) {
          try {
            const result = await enqueueAutoPublishVideoPost({
              clientId: homeClientId, platform: publishPlatform, videoItems, timestamp, digestCfg, step,
            });
            // Double-send guard: this client's own digest lands in the same
            // inbox as the approval-rollup worker (blank/DIGEST_EMAIL
            // recipientEmail) — the rollup owns the visible button for this
            // post, so strip it here rather than showing it twice in one
            // inbox. The post itself (and its token) still exist; the rollup
            // mints its own separate token when it sends.
            if (result?.approvalUrl && digestConfig.isDigestClaimedByRollup(digestCfg)) {
              step('info', `Auto-publish · button moved to the roll-up email (@${publishPlatform})`);
              videoPublishCtx[publishPlatform] = { ...result, approvalUrl: null, claimedByRollup: true };
            } else {
              videoPublishCtx[publishPlatform] = result;
            }
          } catch (err) {
            logWarn('daily_digest_autopublish_failed', { clientId: homeClientId, error: err.message });
            step('error', `Auto-publish failed: ${err.message}`);
          }
        } else {
          let handle = null;
          let publishClientName = homeClientId;
          try {
            const acct = await getSocialAccount(homeClientId, publishPlatform);
            handle = acct?.connected ? acct.username : null;
          } catch { /* not connected */ }
          try {
            const snap = await fb.adminDb.collection('clients').doc(homeClientId).get();
            const data = snap.exists ? snap.data() : null;
            publishClientName = data?.companyName || data?.name || data?.dashboardTitle || homeClientId;
          } catch { /* fall back to the raw id */ }
          videoPublishCtx[publishPlatform] = {
            clientName: publishClientName, handle, mode: publishMode, platformLabel: 'X',
            approvalUrl: null, publishedAt: null, preview: true,
          };
        }
      }
    }

    const sessionStr = ga4.overview ? `, ${ga4.overview.sessions} session${ga4.overview.sessions !== 1 ? 's' : ''}` : '';
    // Subject carries the client's brand when the send is client-scoped, so two
    // clients' digests are distinguishable in the same inbox. Falls back to the
    // platform brand for the unscoped/legacy cron.
    let subjectBrand = 'HITLOOP';
    try {
      const brandSnap = homeClientId ? await fb.adminDb.collection('client_configs').doc(homeClientId).get() : null;
      const b = String(brandSnap?.data()?.marketingBriefConfig?.brandName || '').trim();
      if (b) subjectBrand = b.toUpperCase();
    } catch { /* keep platform brand */ }
    const subject = `${subjectBrand} Daily — ${firebase.newUsers} sign-up${firebase.newUsers !== 1 ? 's' : ''}, ${firebase.recentRuns} dashboard${firebase.recentRuns !== 1 ? 's' : ''}${sessionStr} · ${dateStr}`;

    // Resolve the hosted Executive Brief link (run fresh / newest published /
    // off). Best-effort: any failure falls back to the dashboard link inside
    // buildEmailHtml so a brief problem never blocks the email. A fresh run
    // (LLM cost) only happens on a real send — never on a preview reload.
    let briefUrl = null;
    const briefLinkMode = digestCfg?.briefLinkMode || 'fresh';
    if (include.execBriefLink !== false && briefLinkMode !== 'off' && homeClientId) {
      try {
        const { resolveExecutiveBriefUrl } = require('../../../../features/intelligence/_digest-brief-link.js');
        briefUrl = await resolveExecutiveBriefUrl({
          clientId: homeClientId,
          mode: briefLinkMode,
          origin: appOrigin(),
          allowFreshRun: !isPreview, // preview tab never triggers a paid run
          freshnessToken,
        });
      } catch (err) {
        logWarn('daily_digest_brief_link_failed', { error: err.message });
      }
    }

    const contactUrl = (contactUrlOverride != null
      ? contactUrlOverride
      : (digestCfg?.contactUrl || process.env.DIGEST_CONTACT_URL || process.env.CALENDLY_URL || '')).trim();
    if (isRealSend) step('info', `Executive Brief · ${briefUrl || 'dashboard fallback'}`);
    const sectionOrder = orderOverride || digestCfg?.order || digestConfig.DEFAULT_ORDER;
    const postPlatforms = postsOverride || digestCfg?.postPlatforms || {};
    const html = buildEmailHtml(firebase, vercel, ga4, agenda, homepage, timestamp, summary, briefs, renderInclude, creative, briefUrl, contactUrl, videoItems, sectionOrder, postPlatforms, freshnessToken, videoStatus, videoPublishCtx);
    // Gmail clips messages past ~102KB of ENCODED body and hides the rest behind
    // "View entire message" — quoted-printable inflation means ~80KB of raw HTML
    // is the practical ceiling. Warn in the send terminal + prod logs when over.
    const emailBytes = Buffer.byteLength(html, 'utf8');
    const emailKb = Math.round(emailBytes / 1024);
    const overClipRisk = emailBytes > 80 * 1024;
    if (overClipRisk) logWarn('daily_digest_email_over_clip_size', { emailKb, clientId: homeClientId });
    if (isRealSend) {
      const onCount = digestConfig.INCLUDE_KEYS.filter((k) => include[k] !== false).length;
      step('success', `Rendered email · ${onCount} section${onCount !== 1 ? 's' : ''} on · ~${emailKb} KB`);
      if (overClipRisk) step('error', `Email is ~${emailKb} KB — Gmail clips near ~102KB, so bottom sections may be hidden behind "View entire message". Turn off heavy sections in SETTINGS.`);
      const hasSuggestedReplies = html.includes('Suggested Replies');
      const hasRedditAnalysis = html.includes('Happening on Reddit');
      const hasInstagramAnalysis = html.includes('Happening on Instagram');
      if (include.suggestedReplies !== false) {
        step(hasSuggestedReplies ? 'success' : 'error', hasSuggestedReplies ? 'Verified section · Suggested Replies included in final email HTML' : 'Missing section · Suggested Replies was enabled but absent from final email HTML');
      }
      if (include.redditAnalysis !== false) {
        step(hasRedditAnalysis ? 'success' : 'error', hasRedditAnalysis ? 'Verified section · Happening on Reddit included in final email HTML' : 'Missing section · Happening on Reddit was enabled but absent from final email HTML');
      }
      if (include.instagramAnalysis !== false) {
        step(hasInstagramAnalysis ? 'success' : 'error', hasInstagramAnalysis ? 'Verified section · Happening on Instagram included in final email HTML' : 'Missing section · Happening on Instagram was enabled but absent from final email HTML');
      }
    }

    // Preview mode (admin dashboard): build everything, send nothing.
    if (isPreview) {
      return json({
        ok: true,
        preview: true,
        timestamp: new Date(timestamp).toISOString(),
        paragraph: summary?.paragraph || '',
        summary,
        html,
        emailKb,
        overClipRisk,
        freshnessToken,
      });
    }

    // Recipient: the client's configured recipientEmail, else the admin address.
    // Blank recipientEmail means a client is never emailed — it goes to you.
    const digestRecipient = (digestCfg?.recipientEmail || '').trim() || DIGEST_TO;
    const emailResult = await sendEmail(subject, html, digestRecipient);
    step(emailResult?.skipped ? 'info' : 'success', emailResult?.skipped ? `Email not sent: ${emailResult?.reason || 'no transport configured'}` : `Email sent → ${digestRecipient}`);
    logInfo('daily_digest_complete', {
      timestamp: new Date(timestamp).toISOString(),
      newUsers: firebase.newUsers,
      recentRuns: firebase.recentRuns,
      emailSkipped: Boolean(emailResult?.skipped),
    });

    return json({
      ok: true,
      timestamp: new Date(timestamp).toISOString(),
      summary: summary?.paragraph || null,
      metrics: { firebase, vercel: { totalDeployments: vercel.totalDeployments, errorCount: vercel.errorLogs?.length || 0 }, ga4: { overview: ga4.overview, topPagesCount: ga4.topPages?.length, sourcesCount: ga4.trafficSources?.length, events: ga4.events, error: ga4.error || null }, agenda: { eventCount: agenda.events?.length || 0, error: agenda.error || null }, homepage: { totalEvents: homepage.totalEvents, byInteractionType: homepage.byInteractionType, topTargets: homepage.topTargets, error: homepage.error || null } },
      email: emailResult,
      xPost: xPostResult ? {
        ok: Boolean(xPostResult.ok),
        skipped: xPostResult.skipped || null,
        postId: xPostResult.post?.id || null,
        source: xPostResult.post?.source || null,
        scheduledAt: xPostResult.post?.scheduledAt || null,
      } : null,
      subject,
      log: sendLog,
      emailKb,
      overClipRisk,
      freshnessToken,
      html: returnHtml ? html : undefined,
      freshness: {
        token: freshnessToken || null,
        emailContainsToken: freshnessToken ? html.includes(freshnessToken) : null,
        briefUrl,
        sources: {
          firebasePulledAt: new Date(timestamp).toISOString(),
          vercelPulledAt: new Date(timestamp).toISOString(),
          ga4PulledAt: new Date(timestamp).toISOString(),
          agendaPulledAt: new Date(timestamp).toISOString(),
          homepagePulledAt: new Date(timestamp).toISOString(),
          briefGeneratedAt: briefs[0]?.intel?.generatedAt || null,
          strategyGeneratedAt: briefs[0]?.intel?.strategyBuilder?.generatedAt || null,
          creativeGeneratedAt: creative?.generatedAt || null,
        },
      },
    });
  } catch (err) {
    logError('daily_digest_route_error', { error: err });
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
