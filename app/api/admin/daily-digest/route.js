import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  createSocialPost,
  generatePromoCopy,
  listPendingApprovalPosts,
  postNow,
  readSocialQueue,
  runPostingAgents,
  schedulePost,
  updateSocialPost,
} from '../../../../features/social-posting/twitter-service.js';
import { getSocialAccount, toPublicAccount } from '../../../../features/social-posting/social-accounts.js';
import { canonicalRemixCopy } from '../../../../features/social-posting/remix-copy.js';
import {
  appOrigin,
  appUrl,
  dateMs,
  isFreshWithin,
  DT,
  dKicker,
  dSection,
  buildVideoPostRow,
  buildEmailHtml,
  buildPlaceholderData,
} from '../../../../features/email-digest/render.js';
import { SECTIONS } from '../../../../features/email-digest/sections.registry.cjs';

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
const { signApprovalToken, APPROVAL_TTL_MS } = require('../../../../api/_lib/social-approval.cjs');
const { hasValidWorkerSecret } = require('../../../../api/_lib/auth.cjs');
const digestDelivery = require('../../../../api/_lib/digest-delivery.cjs');
const { sendViaResend } = require('../../../../api/_lib/resend-transport.cjs');
const { digestSelfOrigin, fetchWorkerJson, buildSendStampEntry } = require('../../../../api/_lib/digest-self-origin.cjs');
const { resolveSendPolicy } = require('../../../../api/_lib/digest-send-policy.cjs');

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
const COMPAT_INCLUDE_KEYS = ['redditAnalysis', 'instagramAnalysis', 'xMarketTalk', 'suggestedReplies'];
const DIGEST_INCLUDE_KEYS = Array.from(new Set([...(digestConfig.INCLUDE_KEYS || []), ...COMPAT_INCLUDE_KEYS]));

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function readAggregateCount(snapshot) {
  const count = snapshot?.data?.()?.count;
  return typeof count === 'number' ? count : 0;
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
  const publicAccount = toPublicAccount(account);
  const handle = publicAccount.connected ? publicAccount.username : null;
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
  if (!publicAccount.connected) {
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
  // Several emails may carry the owner's same completed video, but the owner
  // must never publish identical media twice.
  const reusableStatuses = ['awaiting_approval', 'scheduled', 'posting', 'posted'];
  const duplicate = existing.find((post) => (
    (
      post?.source === source
      && reusableStatuses.includes(post?.status)
    )
    || (
      post?.mediaUrl === item.url
      && reusableStatuses.includes(post?.status)
    )
  ));
  if (duplicate) {
    step?.('info', `Auto-publish · already queued for today (@${platformLabel})`);
    // A repeated Generate & Send should still adopt the canonical metadata
    // copy introduced for Remix approvals instead of preserving an older
    // generated caption on the reused pending post.
    if (
      duplicate.status === 'awaiting_approval'
      && item.caption
      && duplicate.content !== item.caption
    ) {
      try {
        const updated = await updateSocialPost(clientId, duplicate.id, { content: item.caption });
        duplicate.content = updated.content;
      } catch (err) {
        logWarn('daily_digest_duplicate_caption_update_failed', { clientId, postId: duplicate.id, error: err.message });
      }
    }
    let approvalUrl = duplicate.approvalUrl || null;
    // Approval URLs are intentionally not persisted on the post. A repeated
    // digest send therefore mints a fresh token for the same still-pending post
    // instead of silently rendering a video with no button.
    if (mode === 'approval' && duplicate.status === 'awaiting_approval') {
      try {
        const { token } = await signApprovalToken({ postId: duplicate.id, clientId, platform });
        approvalUrl = `${appOrigin()}/post-approval?token=${encodeURIComponent(token)}`;
      } catch (err) {
        logWarn('daily_digest_duplicate_approval_token_failed', { clientId, platform, postId: duplicate.id, error: err.message });
      }
    }
    return {
      ...baseCtx,
      approvalUrl,
      publishedAt: duplicate.postedAt || null,
      postContent: duplicate.content || item.caption || '',
      skipped: 'duplicate',
    };
  }
  const todaySource = `daily-video:${platform}:${dateKey}`;
  const maxPerDay = Math.max(1, Math.min(10, Number(platformCfg?.maxPerDay) || 1));
  // Failed/rejected/expired attempts are terminal and cannot publish. They
  // must not consume the daily cap or a user could never mint the fresh
  // approval required after a burned-link failure.
  const publishedToday = existing.filter((post) => (
    String(post?.source || '') === todaySource
    && reusableStatuses.includes(post?.status)
  )).length;
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

  const media = {
    mediaUrl: item.url,
    mediaType: 'video',
    mediaContentType: 'video/mp4',
    mediaJobId: item.mediaJobId || null,
    mediaAssetClientId: item.assetSourceClientId || null,
    mediaMetadata: item.metadata || null,
  };

  if (mode === 'auto') {
    try {
      const post = await postNow(clientId, { content: caption, source, platform, ...media });
      step?.('success', `Auto-published · @${handle || platformLabel} · ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`);
      logInfo('daily_digest_autopublish_posted', { clientId, platform, postId: post.id });
      return { ...baseCtx, publishedAt: post.postedAt || new Date().toISOString(), postContent: caption };
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
    const approvalUrl = `${appOrigin()}/post-approval?token=${encodeURIComponent(token)}`;
    step?.('success', `Auto-publish · approval link minted (@${handle || platformLabel})`);
    logInfo('daily_digest_autopublish_approval_queued', { clientId, platform, postId: post.id });
    return { ...baseCtx, approvalUrl, postContent: caption };
  } catch (err) {
    step?.('error', `Auto-publish approval enqueue failed · ${err.message}`);
    logWarn('daily_digest_autopublish_enqueue_failed', { clientId, platform, error: err.message });
    return { ...baseCtx, skipped: 'enqueue-failed', error: err.message };
  }
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
 * own schedule.enabled.
 *
 * Runs in bounded-concurrency waves. It was sequential, which meant one slow
 * client burned the parent's whole budget and every client behind it was
 * dropped by a silent `break` — for months the only client ever served was
 * whichever sorted first. Wall-clock is now the slowest client per wave.
 *
 * The client set mirrors pre-digest-refresh (enrolled only, least-recently-sent
 * first) so send and refresh can never drift apart.
 */
/** Transport call used by every durable-delivery retry (scheduled sweep or
 *  manual admin click). Reuses the SAME idempotency key on every attempt —
 *  Resend returns the original result for a duplicate key rather than
 *  sending twice. Never regenerates content: `sendFn` only ever receives
 *  what digest-delivery.cjs already has stored. */
function digestSendFn({ subject, html, to, idempotencyKey }) {
  return sendViaResend({ apiKey: RESEND_API_KEY, from: DIGEST_FROM, to, subject, html, idempotencyKey });
}

/** Runs once per scheduled cron tick (the fan-out entry point), before any
 *  client is touched. Retries every digest whose backoff has elapsed using
 *  its STORED render — no Anthropic call, no re-render, just a transport
 *  retry — and updates each client's circuit breaker on a terminal outcome. */
async function sweepDigestDeliveries() {
  try {
    const { swept, results } = await digestDelivery.sweepDueRetries({
      sendFn: digestSendFn,
    });
    if (swept) logInfo('daily_digest_delivery_sweep', { swept, sent: results.filter((r) => r.stage === 'sent').length });
  } catch (err) {
    logWarn('daily_digest_delivery_sweep_failed', { error: err.message });
  }
}

async function fanOutScheduledSends(url) {
  await sweepDigestDeliveries();
  const startedAtMs = Date.now();
  const FANOUT_BUDGET_MS = 270_000;

  let clientIds = [];
  try {
    // Enrolled clients ONLY, least-recently-sent first. The home client used to
    // be prepended unconditionally: it was never mailed (its own enrollment gate
    // skips it) but it always consumed the first slot, so with a sequential
    // fan-out no other client was ever reached. Home appears here now exactly
    // when its own daily toggle is on, like every other client.
    clientIds = await digestConfig.listCronEnrolledClientIdsByStaleness('send');
  } catch (err) {
    logError('daily_digest_fanout_resolve_error', { error: err.message });
    return json({ error: `Could not resolve digest clients: ${err.message}` }, 500);
  }
  if (!clientIds.length) {
    return json({ ok: true, skipped: true, reason: 'No clients enrolled in the daily digest.' });
  }

  // ⚠️ Self-requests must target the custom production domain, NEVER
  // url.origin: the cron invocation arrives on an SSO-protected *.vercel.app
  // host, and a sub-request to that origin lands on the vercel.com login page
  // instead of this route — which this dispatcher then stamped as "Email
  // provider did not return an id." (the 2026-08-18 root cause; Resend was
  // never called). fetchWorkerJson refuses redirects and non-JSON bodies so
  // that failure mode is loud now. See api/_lib/digest-self-origin.cjs.
  const selfOrigin = digestSelfOrigin();

  logInfo('daily_digest_fanout_start', { clients: clientIds.length, clientIds, origin: selfOrigin });

  const sendOne = async (clientId) => {
    const target = new URL('/api/admin/daily-digest', selfOrigin);
    // Carry through anything the cron/caller set (e.g. freshnessToken); the
    // per-client id always wins.
    url.searchParams.forEach((value, key) => {
      if (key !== 'clientId') target.searchParams.set(key, value);
    });
    target.searchParams.set('clientId', clientId);

    // Honest stamps via the tested contract builder: a sub-request that never
    // executed (SSO page, redirect, non-JSON) fails with its real HTTP
    // status/content-type, and the child's body can never overwrite the
    // dispatcher's trusted clientId/status/ok fields.
    const entry = buildSendStampEntry(clientId, await fetchWorkerJson(target));
    await digestConfig.stampCronRun(clientId, 'send', entry);
    logInfo('daily_digest_fanout_client_done', entry);
    return entry;
  };

  // Concurrent, in waves. Each sub-request is its own invocation with its own
  // maxDuration, so wall-clock here is the slowest client per wave, not the sum
  // of every client. Sequentially, one slow client consumed the whole budget
  // and every client behind it was dropped — silently, since the run still
  // returned ok. Capped so a large enrollment can't open 50 sockets at once.
  const FANOUT_CONCURRENCY = 4;
  const results = [];
  const droppedIds = [];
  for (let i = 0; i < clientIds.length; i += FANOUT_CONCURRENCY) {
    if (results.length > 0 && Date.now() - startedAtMs > FANOUT_BUDGET_MS) {
      droppedIds.push(...clientIds.slice(i));
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    const wave = await Promise.all(clientIds.slice(i, i + FANOUT_CONCURRENCY).map(sendOne));
    results.push(...wave);
  }
  // A dropped client is a failure to report, not a quiet break. Stamped too, so
  // staleness ordering puts it first next run.
  if (droppedIds.length) {
    logError('daily_digest_fanout_budget_exhausted', {
      completed: results.length,
      total: clientIds.length,
      droppedIds,
      elapsedMs: Date.now() - startedAtMs,
    });
    await Promise.all(droppedIds.map((clientId) => {
      const entry = { clientId, ok: false, skipped: true, reason: 'Fan-out budget exhausted before this client ran.' };
      results.push(entry);
      return digestConfig.stampCronRun(clientId, 'send', entry);
    }));
  }

  const complete = droppedIds.length === 0;
  const ok = complete && results.every((r) => r.ok);
  logInfo('daily_digest_fanout_done', {
    clients: clientIds.length,
    completed: results.length - droppedIds.length,
    dropped: droppedIds.length,
    sent: results.filter((r) => r.ok && !r.skipped).length,
    ok,
  });
  return json({ ok, fanout: true, clientIds, complete, dropped: droppedIds, results });
}

// ── Admin approval roll-up (mode=approval-rollup) ────────────────────────────
// Includes every client's pending video. Each per-client digest keeps its own
// button too, giving the client recipient and the Hitloop admin independent
// single-use links to the same one-publish post.
// One email listing every client's video that is awaiting_approval. Each row
// gets its OWN freshly-minted, single-use token; a post still carrying an unused
// token from its recipient email is left alone, because
// publishApprovedPost/rejectSocialPost guard on post.status — only the first
// click of any link can publish.
//
// Lives in this route rather than its own because it already depended on six
// of this file's helpers (DT, buildVideoPostRow, dKicker, dSection, escapeHtml,
// sendEmail), and Vercel Hobby caps a deployment at 12 function groups. Both
// surfaces are cron/admin-gated, so nothing crosses an auth boundary.

async function authorizeRollup(request) {
  const shim = buildAuthRequestShim(request);
  if (hasValidWorkerSecret(shim)) return;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && safeSecretEquals(getHeaderValue(shim.headers, 'authorization'), `Bearer ${cronSecret}`)) return;
  await verifyAdminRequest(shim);
}

function buildRollupEmailHtml(rows, timestamp) {
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const body = rows.length
    ? rows.map((r) => buildVideoPostRow(r.item, 'Remix', r.ctx)).join('<div style="height:24px;"></div>')
    : `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">Nothing is waiting on approval right now.</div>`;

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>HITLOOP Pending Approval</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
body{margin:0;padding:0;background:${DT.bg};}
a{text-decoration:none;}
@media only screen and (max-width:600px){
  .container{padding:24px 16px !important;}
  .hero-title{font-size:42px !important;}
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
          <div style="padding-bottom:6px;">
            ${dKicker('HitLoop.agency &middot; Social Auto-Publish')}
            <div class="hero-title" style="font-family:${DT.fDisp};font-weight:900;font-size:56px;line-height:.95;letter-spacing:-.03em;text-transform:uppercase;color:${DT.ink};margin:6px 0 16px;">Pending Approval &middot; ${rows.length} video${rows.length === 1 ? '' : 's'}</div>
            <div style="font-family:${DT.fMono};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};">${dateStr}</div>
          </div>
          ${dSection('Social Auto-Publish', 'Ready to post', body)}
          <div style="border-top:1.5px solid ${DT.line};padding-top:22px;margin-top:32px;">
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;color:${DT.light};">Generated ${new Date(timestamp).toLocaleTimeString('en-US')}</div>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return emailHtml.replace(/\n[ \t]+/g, '\n');
}

async function buildRollupRow(post) {
  const clientId = post.clientId;
  const platform = post.platform || 'x';
  let clientName = clientId;
  try {
    const snap = await fb.adminDb.collection('clients').doc(clientId).get();
    const data = snap.exists ? snap.data() : null;
    clientName = data?.companyName || data?.name || data?.dashboardTitle || clientId;
  } catch { /* fall back to the raw id */ }

  let handle = null;
  try {
    const account = await getSocialAccount(clientId, platform);
    const publicAccount = toPublicAccount(account);
    handle = publicAccount.connected ? publicAccount.username : null;
  } catch { /* not connected */ }

  const { token } = await signApprovalToken({ postId: post.id, clientId, platform });
  const approvalUrl = `${appOrigin()}/post-approval?token=${encodeURIComponent(token)}`;

  return {
    item: { url: post.mediaUrl, duration: 0, caption: post.content, stale: false, staleLabel: '' },
    ctx: { clientName, handle, mode: 'approval', platformLabel: platform === 'x' ? 'X' : platform, approvalUrl, publishedAt: null },
  };
}

async function runApprovalRollup(request) {
  try {
    await authorizeRollup(request);
  } catch {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const timestamp = Date.now();
  let rows = [];
  let expiredCount = 0;
  try {
    // Bounded by the approval token's own TTL: a post nobody acted on within
    // 48h is swept to 'expired' rather than re-listed (and re-tokened) here
    // every single day.
    const pending = await listPendingApprovalPosts({ maxAgeMs: APPROVAL_TTL_MS, limit: 200 });
    expiredCount = pending.expired;
    if (expiredCount) logInfo('approval_rollup_expired_stale', { count: expiredCount });

    const byClient = new Map();
    for (const post of pending.posts) {
      if (!post?.mediaUrl || !post?.clientId) continue;
      if (!byClient.has(post.clientId)) byClient.set(post.clientId, []);
      byClient.get(post.clientId).push(post);
    }

    for (const [clientId, clientPosts] of byClient) {
      for (const post of clientPosts) {
        try {
          // eslint-disable-next-line no-await-in-loop
          rows.push(await buildRollupRow(post));
        } catch (err) {
          logWarn('approval_rollup_row_failed', { clientId, postId: post.id, error: err.message });
        }
      }
    }
  } catch (err) {
    logError('approval_rollup_query_failed', { error: err.message });
    return json({ error: `Could not query pending approvals: ${err.message}` }, 500);
  }

  const html = buildRollupEmailHtml(rows, timestamp);
  try {
    await sendEmail(`HITLOOP — Pending Approval · ${rows.length} video${rows.length === 1 ? '' : 's'}`, html, DIGEST_TO);
  } catch (err) {
    logError('approval_rollup_send_failed', { error: err.message, count: rows.length });
    return json({ error: `Send failed: ${err.message}` }, 500);
  }

  logInfo('approval_rollup_sent', { count: rows.length, expired: expiredCount });
  return json({ ok: true, count: rows.length, expired: expiredCount });
}

export async function GET(request) {
  const url = new URL(request.url);
  // Approval roll-up rides this route as a mode, ahead of any digest work.
  if (url.searchParams.get('mode') === 'approval-rollup') return runApprovalRollup(request);
  const previewParam = url.searchParams.get('preview');
  const isPreview = previewParam === '1';
  const isTemplate = previewParam === 'template';
  const isSendNow = url.searchParams.get('send') === '1';
  const freshnessToken = String(url.searchParams.get('freshnessToken') || '').trim().slice(0, 160);
  // Stable per-user-action id for a manual send (P1-2 fix). The Email Digest
  // card generates this ONCE per "Generate & Send" click (crypto.randomUUID())
  // and holds it across any retry of that SAME click — see
  // components/AdminEmailModals.jsx's runAndSend. Used to derive a
  // deterministic manual delivery id so a resubmitted click (e.g. after an
  // HTTP timeout) resolves to the SAME record instead of sending twice.
  const requestId = String(url.searchParams.get('requestId') || '').trim().slice(0, 120);
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

  // Hoisted so the catch block can stamp a generation failure onto the durable
  // record — a thrown send used to leave the delivery doc untouched, making
  // Vercel's short-lived logs the only trace of WHY a day failed.
  let delivery = null;
  let genLeaseOwner = null;
  const routeStartedMs = Date.now();
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
    // What this request mode may do — see api/_lib/digest-send-policy.cjs.
    // Scheduled sends are zero-LLM and zero-social; manual sends keep both;
    // no send path publishes a fresh brief (the refresh phase owns that).
    const { isRealSend, isScheduledSend, allowInlineLlm, allowSocialSideEffects } =
      resolveSendPolicy({ isPreview, isTemplate, isSendNow });

    // Delivery identity (P1-C + P1-2 fixes), resolved once, early. Uses the
    // CLIENT'S configured digest timezone — not UTC — so "today" matches
    // the day the client actually expects the email. Read-only at this
    // point (never creates a record), so it's safe to compute even for a
    // request that turns out to be a preview. A manual send NEVER shares
    // identity with the scheduled cron occurrence, and its id is derived
    // deterministically from `requestId` (not wall-clock time) whenever the
    // card supplies one — see api/_lib/digest-delivery.cjs's
    // resolveDeliveryIdentity for exactly what that buys: a resubmitted
    // click (same requestId) resolves to the SAME record instead of
    // sending twice, and two different concurrent clicks (different
    // requestIds) always get two distinct records, never a silent collapse.
    const deliveryClientId = homeClientId || 'unscoped';
    const deliverySource = isSendNow ? 'manual-admin' : 'cron-scheduled';
    const deliveryTimeZone = digestCfg?.schedule?.timezone || 'America/Chicago';
    // Sweep reclaim (worker-auth scheduled path only): the sweep names the
    // EXACT stuck record it wants advanced. Identity then comes from that
    // record — never recomputed from the current clock — so reclaiming a
    // prior-day occurrence finishes THAT record under its original
    // idempotency key instead of minting a new current-day delivery at the
    // wrong hour. Invalid targets are refused outright (409), never silently
    // downgraded to a fresh send.
    const reclaimDeliveryId = isScheduledSend
      ? String(url.searchParams.get('reclaimDeliveryId') || '').trim().slice(0, 200)
      : '';
    let deliveryIdentity = null;
    if (isRealSend) {
      if (reclaimDeliveryId) {
        const reclaimTarget = await digestDelivery.getDelivery(reclaimDeliveryId);
        const check = digestDelivery.validateReclaimTarget(reclaimTarget, { clientId: deliveryClientId });
        if (!check.ok) {
          logWarn('daily_digest_reclaim_rejected', { reclaimDeliveryId, clientId: deliveryClientId, reason: check.reason });
          return json({ ok: false, skipped: true, reason: `reclaim rejected: ${check.reason}` }, 409);
        }
        deliveryIdentity = { dateKey: check.identity.dateKey, deliveryId: check.identity.deliveryId };
      } else {
        deliveryIdentity = await digestDelivery.resolveDeliveryIdentity({
          clientId: deliveryClientId, timestampMs: timestamp, timeZone: deliveryTimeZone, source: deliverySource, requestId,
        });
      }
    }
    // Durability starts FIRST (EMAIL-REBUILD-PLAN.md Phase 1 rule 3): the
    // delivery record used to be created only after every collector and the
    // full render succeeded, so a request killed mid-generation left NOTHING —
    // no record, no stored HTML, nothing for any sweep to recover, and the day
    // was silently lost. Creating it here makes any death visible in a durable
    // doc and gives the sweep's stale-generation reclaim something to re-enter.
    // Idempotent create-only: a re-entry for the same occurrence returns the
    // same record.
    if (isRealSend) {
      delivery = await digestDelivery.getOrCreateDelivery({
        clientId: deliveryClientId,
        dateKey: deliveryIdentity.dateKey,
        source: deliverySource,
        deliveryId: deliveryIdentity.deliveryId,
      });
      // Generation lease: exactly one worker may regenerate this occurrence at
      // a time (fenced through storeRenderedHtml), so a sweep reclaim racing
      // the daily fan-out can never produce two competing renders — and a
      // duplicate request resolves honestly instead of doing redundant work.
      const genClaim = await digestDelivery.claimGeneration(delivery.id);
      if (!genClaim.ok) {
        if (genClaim.reason === 'already-sent') {
          // Idempotent success: this occurrence already delivered.
          return json({
            ok: true, alreadySent: true,
            email: { ok: true, id: genClaim.providerEmailId || null },
            delivery: { id: delivery.id, stage: 'sent' },
          });
        }
        if (genClaim.reason === 'already-rendered') {
          // Render exists — skip regeneration entirely and go straight to
          // transport under the send lease (safe no-op if another worker is
          // mid-send or it already delivered).
          const sendResult = await digestDelivery.sendFirstAttempt(delivery.id, digestSendFn);
          const updated = await digestDelivery.getDelivery(delivery.id);
          return json({
            ok: Boolean(sendResult.ok),
            resumedStoredRender: true,
            email: sendResult,
            reason: sendResult.ok ? null : (sendResult.reason || null),
            delivery: { id: delivery.id, stage: updated?.stage || null, attempts: updated?.attempts || 0, nextRetryAt: updated?.nextRetryAt || null },
          }, sendResult.ok ? 200 : 502);
        }
        // 'generation-in-progress' / 'terminal-failure' / 'not-found'
        return json({ ok: false, skipped: true, reason: `generation not claimed: ${genClaim.reason}` }, 409);
      }
      genLeaseOwner = genClaim.ownerId;
    }

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
        xMarketTalk: available.x === false ? false : include.xMarketTalk,
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

      // The brief fetch powers every Market Signals item + weather (both read
      // `briefs` in render.js's RENDER map) — fetch if ANY brief-derived
      // section is enabled. Derived from the registry's renderGroup field
      // rather than a hand-maintained list: a hardcoded list here previously
      // went stale (missing pressCoverage/opportunitySignals, added after
      // this gate was written — found during the Phase 2 audit, 2026-08-19).
      const needBrief = SECTIONS.some((s) => (s.key === 'weather' || s.renderGroup === 'marketSignals') && include[s.key] !== false);
      if (needBrief) {
        briefs = (await Promise.all(briefIds.map((cid) => briefIntel.getBriefForClient(cid)))).filter(Boolean);
      }

      // Creative Brief attachment (opt-in) — the run onboarding deliverable for the home client.
      if (include.creativeBrief && homeClientId) {
        creative = await briefIntel.getCreativeBriefForClient(homeClientId);
      }

      // Scheduled sends are ZERO-LLM (EMAIL-REBUILD-PLAN.md Phase 1 rule 1):
      // they read the summary the pre-digest refresh already generated and
      // saved (dashboard_state.digestSummary, written by
      // refreshDigestEmailSummary), falling back to the executive-daily cover
      // paragraph, falling back to the section's honest empty state. Missing
      // or old saved content NEVER triggers an inline Anthropic call here —
      // an LLM hang mid-send is how scheduled days used to be lost. Manual
      // sends and live preview keep the inline path (now bounded by
      // callAnthropic's timeout).
      const SUMMARY_STALE_AFTER_MS = 20 * 60 * 60 * 1000;
      if (cfg.summaryEnabled && isScheduledSend) {
        try {
          const dashSnap = homeClientId
            ? await fb.adminDb.collection('dashboard_state').doc(homeClientId).get()
            : null;
          const dash = dashSnap?.exists ? dashSnap.data() || {} : {};
          // Ownership: only accept a summary stamped for THIS client (or a
          // legacy write without the stamp, which lives in this client's doc).
          const savedDigest = dash.digestSummary
            && (!dash.digestSummary.clientId || dash.digestSummary.clientId === homeClientId)
            ? dash.digestSummary : null;
          const legacyCover = dash.briefSummaries?.['executive-daily'] || null;
          const chosen = (savedDigest && (savedDigest.paragraph || savedDigest.callouts?.length))
            ? savedDigest
            : (legacyCover?.summary
              ? { paragraph: String(legacyCover.summary), lead: '', callouts: [], generatedAtIso: legacyCover.generatedAtIso || null }
              : null);
          if (chosen) {
            const ageMs = chosen.generatedAtIso ? Date.now() - Date.parse(chosen.generatedAtIso) : Infinity;
            const fresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= SUMMARY_STALE_AFTER_MS;
            summary = {
              paragraph: chosen.paragraph || '',
              lead: chosen.lead || '',
              callouts: Array.isArray(chosen.callouts) ? chosen.callouts : [],
              // Visible honesty (owner decision, 2026-08-18): stale content
              // still sends, labeled — never silently passed off as today's.
              staleNote: fresh ? null : `Summary generated ${chosen.generatedAtIso ? new Date(chosen.generatedAtIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'earlier'} — today's refresh did not complete.`,
            };
          }
        } catch (e) {
          logWarn('daily_digest_saved_summary_read_failed', { clientId: homeClientId, error: e.message });
        }
      } else if (cfg.summaryEnabled && allowInlineLlm && !skipLlm) {
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
    // The selected Video Remix client is the single owner of the remix,
    // caption, publish policy, connected account, post row, and approvals.
    // The digest client only owns this email's layout and recipient.
    const videoSourceClientId = digestConfig.resolveDailyVideoOwnerClientId(digestCfg, homeClientId);
    const videoAssetClientId = digestConfig.resolveDailyVideoAssetClientId(digestCfg, homeClientId);
    let videoOwnerDigestCfg = videoSourceClientId === homeClientId ? digestCfg : null;
    let videoOwnerConfigLoadFailed = false;
    if (videoSourceClientId && videoSourceClientId !== homeClientId) {
      try {
        videoOwnerDigestCfg = await digestConfig.getDigestConfig(videoSourceClientId);
      } catch (e) {
        videoOwnerConfigLoadFailed = true;
        logWarn('daily_digest_video_owner_config_failed', { clientId: videoSourceClientId, error: e.message });
      }
    }
    if ((wantRemix || wantPromo) && homeClientId) {
      try {
        const readLatestCaptures = async () => {
          const [videoSourceSnap, homeSnap] = await Promise.all([
            fb.adminDb.collection('dashboard_state').doc(videoAssetClientId).get(),
            videoAssetClientId === homeClientId
              ? Promise.resolve(null)
              : fb.adminDb.collection('dashboard_state').doc(homeClientId).get(),
          ]);
          const videoSourceState = videoSourceSnap.data() || {};
          const homeState = homeSnap?.data?.() || videoSourceState;
          const latestAvailable = (items, type, { requireFresh = false } = {}) => (Array.isArray(items) ? items : [])
            .filter((c) => c?.type === type && c?.downloadUrl && (!requireFresh || isFreshVideoCapture(c)))
            .sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt))[0] || null;
          return {
            remix: wantRemix ? latestAvailable(videoSourceState.mediaCaptures, 'video_remix') : null,
            promo: wantPromo ? latestAvailable(homeState.studioCaptures, 'studio_video', { requireFresh: true }) : null,
          };
        };

        const reconcileInFlight = async () => {
          try {
            const mediaJobsLib = require('../../../../api/_lib/media-jobs.cjs');
            const { reconcileMediaJob } = require('../../../../api/_lib/media-reconcile.cjs');
            const inflight = await mediaJobsLib.listInFlightMediaJobs(20);
            for (const job of inflight) {
              if (job?.clientId !== videoAssetClientId) continue;
              try { await reconcileMediaJob(job, videoAssetClientId); } catch { /* per-job best-effort */ }
            }
          } catch (e) {
            logWarn('daily_digest_media_reconcile_failed', { error: e.message });
          }
        };

        // Reconcile once, then use the latest completed render immediately.
        // Generate & Send does not start or wait for a new video render.
        const deadline = Date.now();
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
          } else videoStatus.remix = `latest rendered · ${staleVideoLabel(remixCap.createdAt)} · file library ${videoAssetClientId} · publishes for ${videoSourceClientId}`;
        } else if (wantRemix) {
          videoStatus.remix = `No completed Video Remix was found in file library ${videoAssetClientId}.`;
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

        // Caption each video in its owner's voice. Grouping by owner preserves
        // the single-call behavior when Remix and Promo belong to the same
        // client, while a borrowed Remix never inherits the email client's
        // Client Brain.
        // A remix approval starts with factual, editable metadata matching the
        // lower-left video title block.
        const captions = {
          remix: canonicalRemixCopy(remixCap?.createdWith || {}),
          promo: '',
        };
        // Scheduled sends are ZERO-LLM (policy.allowInlineLlm): no Haiku
        // caption call — the remix caption is metadata-derived
        // (canonicalRemixCopy) and the promo row renders without generated
        // copy rather than risking an LLM hang inside the cron send. Manual
        // sends + live preview keep captions.
        if (allowInlineLlm && !isTemplate && !skipLlm) {
          const captionGroups = [];
          const addCaptionTarget = (kind, capture, ownerClientId, ownerConfig) => {
            if (!capture || !ownerClientId) return;
            let group = captionGroups.find((entry) => entry.ownerClientId === ownerClientId);
            if (!group) {
              group = { ownerClientId, ownerConfig, targets: [] };
              captionGroups.push(group);
            }
            group.targets.push({ kind, capture });
          };
          addCaptionTarget('promo', promoCap, homeClientId, digestCfg || {});

          for (const group of captionGroups) {
            let brain = '';
            try {
              const { loadClientBrainContext } = require('../../../../features/client-brain/store.cjs');
              brain = await loadClientBrainContext(group.ownerClientId, { useFor: 'copy', maxChars: 1500 });
            } catch { /* optional */ }
            try {
              const generated = await briefSummary.generateVideoPromoPosts({
                videos: group.targets.map(({ capture }) => ({
                  durationSeconds: capture.durationSeconds,
                  sourceFolders: capture.sourceFolders,
                })),
                clientBrainContext: brain,
                config: group.ownerConfig || {},
              });
              group.targets.forEach(({ kind }, index) => { captions[kind] = generated[index] || ''; });
            } catch (e) {
              logWarn('daily_digest_video_promo_failed', { clientId: group.ownerClientId, error: e.message });
            }
          }
        }
        // The selected latest render is intentional, even when it predates
        // today. It is therefore publishable (`stale:false`) rather than treated
        // as an accidental daily-render fallback.
        if (remixCap) {
          videoItems.remix = {
            url: remixCap.downloadUrl,
            duration: remixCap.durationSeconds || 30,
            caption: captions.remix,
            stale: false,
            staleLabel: '',
            sourceClientId: videoSourceClientId,
            assetSourceClientId: videoAssetClientId,
            mediaJobId: remixCap.jobId || null,
            metadata: {
              ...(remixCap.createdWith || {}),
              sourceFolders: Array.isArray(remixCap.sourceFolders) ? remixCap.sourceFolders : [],
              duration: remixCap.durationSeconds || remixCap.createdWith?.duration || 30,
            },
          };
        }
        if (promoCap) {
          const stale = !isSameDigestDay(promoCap.createdAt, timestamp);
          videoItems.promo = {
            url: promoCap.downloadUrl,
            duration: promoCap.durationSeconds || 0,
            caption: captions.promo,
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
    // Social writes are MANUAL-send-only (policy): a scheduled send must never
    // queue a post, mint an approval token, or publish — social publishing
    // gets its own schedule/job in Phase 4. Until then, scheduled sends note
    // the skip honestly in the terminal log.
    if (isScheduledSend && digestCfg?.autoPostX !== false) {
      step('info', 'X post queue skipped on scheduled send (social side effects are manual-send-only until Phase 4).');
    }
    if (allowSocialSideEffects && digestCfg?.autoPostX !== false) {
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

    // Social Auto-Publish — the selected video owner's daily video to that
    // same owner's account, using that owner's publish policy.
    // isRealSend gates the WHOLE enqueue, not just the publish call inside it:
    // a preview or template render must never write an 'awaiting_approval'
    // post or mint a live approval token, so anything but a real send only
    // describes the configured mode (read-only, no Firestore writes).
    const videoPublishCtx = { x: null };
    if (wantRemix && homeClientId) {
      // Manual sends still refuse to proceed on a broken publish config (an
      // operator is acting on it); a SCHEDULED send skips social entirely, so
      // a social-config problem must never block the email itself.
      if (allowSocialSideEffects && videoOwnerConfigLoadFailed) {
        throw new Error(`Publishing settings could not be loaded for video owner ${videoSourceClientId}; email was not sent.`);
      }
      if (isScheduledSend && videoOwnerConfigLoadFailed) {
        step('warn', `Publishing settings could not be loaded for video owner ${videoSourceClientId} — auto-publish skipped; email continues.`);
      }
      const publishPlatform = 'x';
      const publishMode = videoOwnerDigestCfg?.autoPublish?.platforms?.[publishPlatform]?.mode || 'off';
      const publishClientId = videoSourceClientId;
      if (isScheduledSend && publishMode !== 'off') {
        step('info', `Auto-publish (@${publishPlatform}, mode ${publishMode}) skipped on scheduled send — social side effects are manual-send-only until Phase 4.`);
      }
      if (publishMode !== 'off') {
        if (allowSocialSideEffects) {
          try {
            const result = await enqueueAutoPublishVideoPost({
              clientId: publishClientId,
              platform: publishPlatform,
              videoItems,
              timestamp,
              digestCfg: videoOwnerDigestCfg,
              step,
            });
            // Every per-client digest keeps its own actionable button. The
            // independent master roll-up also lists this pending post, so the
            // client and the Hitloop admin can each act from their own email.
            // Multiple tokens are safe: post status + token redemption enforce
            // one publish total.
            videoPublishCtx[publishPlatform] = result;
          } catch (err) {
            logWarn('daily_digest_autopublish_failed', { clientId: publishClientId, error: err.message });
            step('error', `Auto-publish failed: ${err.message}`);
          }
        } else {
          let handle = null;
          let publishClientName = publishClientId;
          try {
            const acct = await getSocialAccount(publishClientId, publishPlatform);
            const publicAccount = toPublicAccount(acct);
            handle = publicAccount.connected ? publicAccount.username : null;
          } catch { /* not connected */ }
          try {
            const snap = await fb.adminDb.collection('clients').doc(publishClientId).get();
            const data = snap.exists ? snap.data() : null;
            publishClientName = data?.companyName || data?.name || data?.dashboardTitle || publishClientId;
          } catch { /* fall back to the raw id */ }
          videoPublishCtx[publishPlatform] = {
            clientName: publishClientName, handle, mode: publishMode, platformLabel: 'X',
            approvalUrl: null, publishedAt: null, preview: true,
          };
        }
      }
    }

    // Approval/auto mode promises an actionable daily-video row. Never send a
    // misleading email without the video, without a connected client account,
    // or (in approval mode) without the approval button. The admin can retry
    // after the already-queued render finishes or connect the account first.
    if (isRealSend && wantRemix && homeClientId) {
      const publishMode = videoOwnerDigestCfg?.autoPublish?.platforms?.x?.mode || 'off';
      const publishResult = videoPublishCtx.x;
      if (publishMode !== 'off') {
        if (!videoItems.remix || videoItems.remix.stale) {
          throw new Error(`No completed Video Remix is available for the selected video source; email was not sent.`);
        }
        if (publishResult?.skipped === 'not-connected') {
          throw new Error(`X is not connected for video owner ${videoSourceClientId}; email was not sent because no working approval/publish action could be created.`);
        }
        if (publishMode === 'approval' && !publishResult?.approvalUrl) {
          throw new Error(`Approval link could not be created for video owner ${videoSourceClientId}; email was not sent.`);
        }
        if (publishResult?.skipped === 'enqueue-failed' || publishResult?.skipped === 'publish-failed') {
          throw new Error(`Daily video ${publishMode} setup failed for video owner ${videoSourceClientId}; email was not sent.`);
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
        // Send paths are READ-ONLY here (owner decision, 2026-08-18): the
        // 'fresh' publish now happens in the pre-digest refresh's analysis
        // phase (publishFreshDigestBrief), so resolving with
        // allowFreshRun:false simply picks up this morning's already-published
        // page — and a send request can no longer stall on a render/publish.
        briefUrl = await resolveExecutiveBriefUrl({
          clientId: homeClientId,
          mode: briefLinkMode,
          origin: appOrigin(),
          allowFreshRun: false,
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
      const hasXMarketTalk = html.includes('Market Talk on X');
      if (include.suggestedReplies !== false) {
        step(hasSuggestedReplies ? 'success' : 'error', hasSuggestedReplies ? 'Verified section · Suggested Replies included in final email HTML' : 'Missing section · Suggested Replies was enabled but absent from final email HTML');
      }
      if (include.redditAnalysis !== false) {
        step(hasRedditAnalysis ? 'success' : 'error', hasRedditAnalysis ? 'Verified section · Happening on Reddit included in final email HTML' : 'Missing section · Happening on Reddit was enabled but absent from final email HTML');
      }
      if (include.xMarketTalk !== false) {
        step(hasXMarketTalk ? 'success' : 'error', hasXMarketTalk ? 'Verified section · Market Talk on X included in final email HTML' : 'Missing section · Market Talk on X was enabled but absent from final email HTML');
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

    // ── Durable, idempotent delivery ────────────────────────────────────────
    // Store the rendered HTML BEFORE attempting delivery (immutable once
    // set — a second call for the SAME delivery id is a safe no-op, never
    // an overwrite), then send under a deterministic idempotency key. A
    // transport failure here no longer discards the render: the delivery
    // lands in `retry-wait` and the next wake-up (see
    // docs/source-of-truth/EMAIL-DIGEST-CARD.md §12b — daily fan-out sweep,
    // opportunistic admin-GET sweep, and the documented sub-daily pinger)
    // resends this EXACT stored content under the SAME idempotency key —
    // never a re-render, never a second Anthropic call. `sendFirstAttempt`
    // claims the delivery atomically before touching the transport, so a
    // racing duplicate request can never send the same delivery twice.
    // (Delivery record already exists — created up front, before generation,
    // and this worker holds the generation lease.)
    await digestDelivery.markStage(delivery.id, 'generated', { note: `email rendered in ${Date.now() - routeStartedMs}ms` }).catch(() => {});
    const stored = await digestDelivery.storeRenderedHtml(delivery.id, { html, subject, recipient: digestRecipient, leaseOwner: genLeaseOwner });
    if (stored?.__generationFenced) {
      // Another worker holds the lease (ours expired mid-run) — its render is
      // the one that counts; never send ours on top of it.
      return json({ ok: false, skipped: true, reason: 'generation fenced: another worker owns this occurrence' }, 409);
    }
    const sendResult = await digestDelivery.sendFirstAttempt(delivery.id, digestSendFn);
    await digestDelivery.releaseGeneration(delivery.id, genLeaseOwner);
    const updatedDelivery = await digestDelivery.getDelivery(delivery.id);

    const emailResult = sendResult;
    const emailAccepted = Boolean(sendResult.ok);
    const emailSkipped = Boolean(sendResult.skipped);
    const willRetry = updatedDelivery.stage === 'retry-wait';
    const emailFailureReason = emailAccepted ? null : (sendResult.reason || 'Email provider did not return an id.');
    step(
      emailAccepted ? 'success' : (willRetry ? 'warn' : 'error'),
      emailAccepted
        ? `Email sent → ${digestRecipient}`
        : willRetry
          ? `Email not sent yet (${emailFailureReason}) — durable retry queued for ${updatedDelivery.nextRetryAt}`
          : `Email not sent: ${emailFailureReason}`,
    );
    logInfo('daily_digest_complete', {
      timestamp: new Date(timestamp).toISOString(),
      newUsers: firebase.newUsers,
      recentRuns: firebase.recentRuns,
      emailSkipped: !emailAccepted,
      emailId: sendResult?.id || null,
      emailFailureReason,
      deliveryId: delivery.id,
      deliveryStage: updatedDelivery.stage,
    });

    return json({
      ok: emailAccepted,
      timestamp: new Date(timestamp).toISOString(),
      summary: summary?.paragraph || null,
      metrics: { firebase, vercel: { totalDeployments: vercel.totalDeployments, errorCount: vercel.errorLogs?.length || 0 }, ga4: { overview: ga4.overview, topPagesCount: ga4.topPages?.length, sourcesCount: ga4.trafficSources?.length, events: ga4.events, error: ga4.error || null }, agenda: { eventCount: agenda.events?.length || 0, error: agenda.error || null }, homepage: { totalEvents: homepage.totalEvents, byInteractionType: homepage.byInteractionType, topTargets: homepage.topTargets, error: homepage.error || null } },
      email: emailResult,
      emailSkipped: !emailAccepted,
      reason: emailFailureReason,
      delivery: {
        id: delivery.id,
        stage: updatedDelivery.stage,
        retryable: willRetry,
        nextRetryAt: updatedDelivery.nextRetryAt || null,
        attempts: updatedDelivery.attempts || 0,
      },
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
    }, emailAccepted ? 200 : 502);
  } catch (err) {
    logError('daily_digest_route_error', { error: err });
    // Durable trace: a generation failure lands on the delivery record (plain
    // merge — no stage transition, so a later re-entry/reclaim proceeds
    // normally). Without this, the only evidence was a log line that expires
    // within the hour on the Hobby plan.
    if (delivery?.id) {
      await fb.adminDb.collection('digest_deliveries').doc(delivery.id).set({
        lastGenerationError: String(err.message || err).slice(0, 500),
        lastGenerationErrorAt: new Date().toISOString(),
        lastGenerationElapsedMs: Date.now() - routeStartedMs,
        // Bump updatedAt so the sweep's stale-generation reclaim backs off a
        // full staleness window after each failed attempt instead of
        // re-entering a deterministic failure every sweep tick.
        updatedAt: new Date().toISOString(),
      }, { merge: true }).catch(() => {});
      await digestDelivery.releaseGeneration(delivery.id, genLeaseOwner);
    }
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
