import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { getHeaderValue, safeSecretEquals, buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');
const briefSummary = require('../../../../features/intelligence/_brief-summary.js');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const briefIntel = require('../../../../features/intelligence/_brief-intel.js');

// ── Config ──────────────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO = process.env.DIGEST_EMAIL || 'bryanballi@gmail.com';
const DIGEST_FROM = process.env.DIGEST_FROM || 'HitLoop Daily <digest@hitloop.agency>';
const WORKER_SECRET = process.env.WORKER_SECRET;
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = 'prj_h2AHIKHmJu7eV1DdmiTra2WFmPv6';
const VERCEL_TEAM_ID = 'team_xmgNCNc6fHyZZinuszh8B6ZB';
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

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function readAggregateCount(snapshot) {
  const count = snapshot?.data?.()?.count;
  return typeof count === 'number' ? count : 0;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  if (!cronSecret) return true; // if not configured, allow (dev mode)
  const provided = getHeaderValue(request.headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
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

async function runGA4Report(accessToken, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
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

async function getGA4Metrics() {
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
    });

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
    });

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
    });

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
            values: DIGEST_EVENT_NAMES,
          },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    });

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

/** Fetch up to 5 days of events for DIGEST_CALENDAR_ID, expanding recurrences,
 *  grouped by local day, plus a one-line summary of tomorrow's schedule. */
async function getCalendarAgenda(timestamp) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const SPAN_DAYS = 5;
  try {
    const now = new Date(timestamp);
    const offset = tzOffset(DIGEST_TIMEZONE, now);

    // Build the 5-day window (today .. today+4) in the digest timezone.
    const days = [];
    for (let d = 0; d < SPAN_DAYS; d++) {
      const inst = new Date(timestamp + d * DAY_MS);
      days.push({
        key: localDateStr(DIGEST_TIMEZONE, inst),
        weekday: inst.toLocaleDateString('en-US', { weekday: 'short', timeZone: DIGEST_TIMEZONE }),
        dateLabel: inst.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: DIGEST_TIMEZONE }),
        isToday: d === 0,
        events: [],
      });
    }
    const timeMin = `${days[0].key}T00:00:00${offset}`;
    const timeMax = `${days[SPAN_DAYS - 1].key}T23:59:59${offset}`;

    const accessToken = await getCalendarAccessToken();
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(DIGEST_CALENDAR_ID)}/events` +
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
const DT = {
  bg: '#fbf8f0',
  card: '#fffdf7',
  ink: '#12100c',
  soft: '#5a5346',
  light: '#8a8070',
  line: '#e7ddc8',
  dash: 'rgba(18,16,12,0.10)',
  accent: '#b8542e',
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

function dKicker(text) {
  return `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${DT.light};margin:0 0 8px;">${text}</div>`;
}

function dMini(text) {
  return `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin:0 0 9px;">${text}</div>`;
}

function dSectionHead(kicker, title) {
  return `${dKicker(kicker)}<div class="sec-title" style="font-family:${DT.fDisp};font-weight:900;font-size:30px;line-height:.95;letter-spacing:-.005em;text-transform:uppercase;color:${DT.ink};margin:0 0 18px;">${title}</div>`;
}

// Every section: top hairline divider + mono eyebrow + Doto display title + body
function dSection(kicker, title, body) {
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
  if (agenda.error) {
    return dSection('Schedule', 'Agenda', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:14px 16px;font-family:${DT.fBody};font-size:13px;color:${DT.accent};">Calendar unavailable: ${escapeHtml(agenda.error)}</div>`);
  }

  const days = agenda.days || [];

  // Each day renders as a fixed-width card; the row scrolls horizontally where
  // the client supports overflow-x (Apple Mail, most webmail). Gmail does not
  // scroll — it clips to the email width, showing the first ~2 days.
  const dayCards = days.map((day) => {
    const evs = day.events || [];
    const rows = evs.length
      ? evs.map((ev, i) => `
        <div style="padding:10px 14px;${i ? `border-top:1px dashed ${DT.dash};` : ''}white-space:normal;font-family:${DT.fBody};font-size:13px;color:${DT.ink};">
          <span style="display:block;font-family:${DT.fMono};font-size:10px;font-weight:700;letter-spacing:.04em;color:${DT.accent};margin-bottom:3px;">${escapeHtml(ev.timeLabel)}</span>
          ${escapeHtml(ev.summary)}${ev.location ? `<span style="display:block;margin-top:2px;font-size:11px;color:${DT.light};">${escapeHtml(ev.location)}</span>` : ''}
        </div>`).join('')
      : `<div style="padding:20px 14px;white-space:normal;font-family:${DT.fBody};font-size:12px;color:${DT.light};">No events</div>`;

    return `<div style="display:inline-block;vertical-align:top;white-space:normal;width:230px;margin-right:12px;background:${DT.card};border:1px solid ${day.isToday ? DT.accent : DT.line};border-radius:14px;overflow:hidden;">
      <div style="padding:11px 14px;border-bottom:1px solid ${DT.line};background:${day.isToday ? 'rgba(184,84,46,0.07)' : 'transparent'};">
        ${day.isToday ? `<span style="display:inline-block;margin-right:7px;font-family:${DT.fMono};font-size:8px;font-weight:700;letter-spacing:.12em;color:#fff;background:${DT.accent};border-radius:4px;padding:2px 5px;vertical-align:middle;">TODAY</span>` : ''}<span style="font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${day.isToday ? DT.accent : DT.ink};">${escapeHtml(day.weekday)}</span><span style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;color:${DT.light};"> &middot; ${escapeHtml(day.dateLabel)}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');

  const hint = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin:0 0 10px;">Scroll &rarr; up to 5 days</div>`;
  const carousel = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;font-size:0;padding-bottom:6px;">${dayCards}</div>`;

  const tomorrow = agenda.tomorrowSummary
    ? `<div style="margin-top:16px;background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:16px 18px;">
        ${dMini('Looking ahead &middot; Tomorrow')}
        <p style="font-family:${DT.fBody};font-size:14px;line-height:1.55;color:${DT.soft};margin:0;">${escapeHtml(agenda.tomorrowSummary)}</p>
      </div>`
    : '';

  return dSection('Schedule', 'Agenda', `${hint}${carousel}${tomorrow}`);
}

function buildHomepageAnalyticsSection(homepage) {
  if (homepage.error) {
    return dSection('Engagement', 'Homepage', `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.accent};margin:0;">Unavailable: ${escapeHtml(homepage.error)}</p>`);
  }

  if (!homepage.totalEvents) {
    return dSection('Engagement', 'Homepage', `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.light};margin:0;">No interaction events in the last 24 hours.</p>`);
  }

  const chips = homepage.byInteractionType
    .map((item) => dChip(escapeHtml(item.name.replace(/_/g, ' ')), item.count))
    .join('');

  const targetRows = homepage.topTargets.length
    ? homepage.topTargets.map((item) => `<tr><td style="${TD}max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.name)}</td><td style="${TDnum}">${item.count}</td></tr>`).join('')
    : `<tr><td colspan="2" style="${TDempty}">No click targets recorded</td></tr>`;

  const outboundRows = homepage.outboundLinks.length
    ? homepage.outboundLinks.map((item) => `<tr><td style="${TD}max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(item.name)}</td><td style="${TDnum}">${item.count}</td></tr>`).join('')
    : `<tr><td colspan="2" style="${TDempty}">No outbound clicks recorded</td></tr>`;

  const scrollChips = homepage.scrollDepths.length
    ? homepage.scrollDepths.map((item) => dChip(escapeHtml(item.name), item.count)).join('')
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">No scroll milestones yet</span>`;

  const vitalChips = homepage.webVitals.length
    ? homepage.webVitals.map((item) => dChip(`${escapeHtml(item.name)} avg`, `${item.average}${item.poor ? ` &middot; poor ${item.poor}` : ''}`)).join('')
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">No web vitals yet</span>`;

  return dSection('Engagement', `Homepage <span style="font-family:${DT.fMono};font-size:14px;color:${DT.light};">(${homepage.totalEvents})</span>`,
    `<div style="margin-bottom:16px;">${chips}</div>
    <div style="margin-bottom:14px;">${dDataTable([{ label: 'Top clicks / fields' }, { label: 'Events', right: true }], targetRows)}</div>
    <div style="margin-bottom:14px;">${dDataTable([{ label: 'Outbound links' }, { label: 'Clicks', right: true }], outboundRows)}</div>
    <div style="margin-bottom:16px;">${dMini('Scroll depth')}${scrollChips}</div>
    <div>${dMini('Web vitals')}${vitalChips}</div>`
  );
}

/** LLM executive-summary block, rendered at the very top of the brief. */
function buildSummarySection(summary) {
  if (!summary || !summary.paragraph) return '';
  const text = escapeHtml(summary.paragraph).replace(/\n+/g, ' ');
  return `<div style="margin-bottom:32px;">
    ${dKicker('Today &middot; Executive Summary')}
    <div style="background:${DT.card};border:1px solid ${DT.line};border-left:3px solid ${DT.accent};border-radius:14px;padding:20px 22px;font-family:${DT.fBody};font-size:15px;line-height:1.62;color:${DT.ink};">${text}</div>
  </div>`;
}

/** Strategic brief block — mirrors the established daily brief's strategy. */
function buildStrategicBriefSection(intel, clientName) {
  if (!intel) return '';
  const hasContent =
    intel.opportunities?.length || intel.kols?.length || intel.competitors?.length ||
    intel.narratives?.length || intel.humanBrief;
  if (!hasContent) return '';

  const linkBit = (url) => (url ? ` <a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;">↗</a>` : '');

  const oppRows = (intel.opportunities || []).length
    ? intel.opportunities.map((o) => `<tr>
        <td style="${TD}">${escapeHtml(o.topic)}${o.windowHours ? ` <span style="color:${DT.light};font-family:${DT.fMono};font-size:11px;">${o.windowHours}h</span>` : ''}${linkBit(o.url)}<div style="margin-top:3px;color:${DT.soft};font-size:12px;">${escapeHtml(o.angle || '')}</div></td>
      </tr>`).join('')
    : '';

  const signalRows = [
    ...(intel.kols || []).map((k) => ({ tag: `KOL${k.platform ? ` · ${k.platform}` : ''}`, label: k.name, value: k.detail, url: k.url })),
    ...(intel.competitors || []).map((c) => ({ tag: `Competitor${c.impact ? ` · ${c.impact}` : ''}`, label: c.name, value: c.finding, url: c.url })),
    ...(intel.narratives || []).map((n) => ({ tag: 'Narrative', label: n.trend, value: n.detail, url: n.url })),
  ];
  const signalsHtml = signalRows.length
    ? signalRows.map((s) => `<tr>
        <td style="${TD}width:120px;font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};vertical-align:top;">${escapeHtml(s.tag)}</td>
        <td style="${TD}"><strong>${escapeHtml(s.label)}</strong>${linkBit(s.url)}<div style="margin-top:2px;color:${DT.soft};font-size:12px;">${escapeHtml(s.value || '')}</div></td>
      </tr>`).join('')
    : '';

  const c = intel.content || {};
  const postBlocks = [
    c.x_post && { label: 'X post', text: c.x_post },
    c.x_thread_opener && { label: 'Thread opener', text: c.x_thread_opener },
    c.discord_announcement && { label: 'Discord', text: c.discord_announcement },
  ].filter(Boolean);
  const postsHtml = postBlocks.length
    ? postBlocks.map((p) => `<div style="margin-bottom:10px;padding:12px 14px;background:${DT.card};border:1px solid ${DT.line};border-radius:10px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">${escapeHtml(p.label)}</div>
        <div style="font-family:${DT.fBody};font-size:13px;color:${DT.ink};line-height:1.5;">${escapeHtml(p.text)}</div>
      </div>`).join('')
    : '';

  return `<div style="margin-bottom:32px;">
    ${dKicker(`Strategic Brief${clientName ? ` &middot; ${escapeHtml(clientName)}` : ''}`)}
    ${intel.humanBrief ? `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:18px 20px;margin-bottom:16px;font-family:${DT.fBody};font-size:14px;line-height:1.6;color:${DT.ink};">${escapeHtml(intel.humanBrief)}</div>` : ''}
    ${oppRows ? `<div style="margin-bottom:14px;">${dMini('Post opportunities')}${dDataTable([{ label: 'Conversation / angle' }], oppRows)}</div>` : ''}
    ${signalsHtml ? `<div style="margin-bottom:14px;">${dMini('Signals · KOLs / competitors / narratives')}${dDataTable([{ label: 'Type' }, { label: 'Finding' }], signalsHtml)}</div>` : ''}
    ${postsHtml ? `<div>${dMini('Suggested posts')}${postsHtml}</div>` : ''}
  </div>`;
}

function buildEmailHtml(firebase, vercel, ga4, agenda, homepage, timestamp, summary, briefs) {
  const strategicSections = (Array.isArray(briefs) ? briefs : [])
    .map((b) => buildStrategicBriefSection(b.intel, b.clientName))
    .filter(Boolean)
    .join('');
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

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
    : `<tr><td colspan="3" style="${TDempty}">No new sign-ups in the last 24 hours</td></tr>`;

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
    : `<tr><td colspan="3" style="${TDempty}">No new dashboards created</td></tr>`;

  const deploymentsRows = vercel.deployments?.length
    ? vercel.deployments
        .map(
          (d) => `<tr>
          <td style="${TD}">${dStatusBadge(d.state)}</td>
          <td style="${TDsub}max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.commit || '—')}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(d.created).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">No deployments in the last 24 hours</td></tr>`;

  const statusBreakdown = Object.entries(firebase.statusCounts)
    .map(([status, count]) => dChip(escapeHtml(status), count))
    .join('');

  const errorSection = vercel.errorLogs?.length
    ? dSection('Runtime', `Errors <span style="font-family:${DT.fMono};font-size:14px;color:${DT.accent};">(${vercel.errorLogs.length})</span>`, dDataTable(
        [{ label: 'Path' }, { label: 'Message' }, { label: 'Status', right: true }],
        vercel.errorLogs.map((e) => `<tr>
            <td style="${TD}font-family:${DT.fMono};font-size:12px;">${escapeHtml(e.path)}</td>
            <td style="${TDsub}max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(e.message)}</td>
            <td style="${TDnum}">${e.statusCode || '—'}</td>
          </tr>`).join('')
      ))
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>HitLoop Daily Digest</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
body{margin:0;padding:0;background:${DT.bg};}
a{text-decoration:none;}
@media only screen and (max-width:600px){
  .container{padding:24px 16px !important;}
  .hero-title{font-size:62px !important;}
  .sec-title{font-size:26px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${DT.bg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${DT.bg};">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;">
        <tr><td class="container" style="padding:40px 32px;">

          <!-- Hero -->
          <div style="padding-bottom:6px;">
            ${dKicker('HitLoop.agency &middot; Daily Digest')}
            <div class="hero-title" style="font-family:${DT.fDisp};font-weight:900;font-size:74px;line-height:.82;letter-spacing:-.04em;text-transform:uppercase;color:${DT.ink};margin:6px 0 16px;">Daily<br>Digest</div>
            <div style="font-family:${DT.fMono};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};">${dateStr}</div>
          </div>

          <!-- Executive summary (LLM) -->
          ${buildSummarySection(summary)}

          <!-- Strategic brief (mirrors established daily brief) -->
          ${strategicSections}

          <!-- Key metrics -->
          ${dSection('Platform', 'Overview', dStatCells([
            { num: firebase.newUsers, label: 'New sign-ups' },
            { num: firebase.totalUsers, label: 'Total users' },
            { num: firebase.recentRuns, label: 'Dashboards' },
            { num: vercel.totalDeployments || 0, label: 'Deployments' },
          ], 4))}

          <!-- GA4 overview -->
          ${ga4.overview
            ? dSection('Google Analytics', 'Traffic', `${dStatCells([
                { num: ga4.overview.sessions, label: 'Sessions' },
                { num: ga4.overview.pageViews, label: 'Page views' },
                { num: ga4.overview.totalUsers, label: 'Visitors' },
                { num: ga4.overview.newUsers, label: 'New' },
                { num: `${ga4.overview.bounceRate}%`, label: 'Bounce' },
              ], 5)}<div style="font-family:${DT.fMono};font-size:11px;color:${DT.soft};letter-spacing:.02em;">Avg session <strong style="color:${DT.ink};">${Math.floor(ga4.overview.avgSessionDuration / 60)}m ${ga4.overview.avgSessionDuration % 60}s</strong> &nbsp;&middot;&nbsp; Engaged <strong style="color:${DT.ink};">${ga4.overview.engagedSessions}</strong></div>`)
            : (ga4.error ? dSection('Google Analytics', 'Traffic', `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.accent};margin:0;">GA4 unavailable: ${escapeHtml(ga4.error)}</p>`) : '')}

          <!-- Today's Agenda -->
          ${buildAgendaSection(agenda)}

          <!-- Top pages -->
          ${ga4.topPages?.length ? dSection('Analytics', 'Top Pages', dDataTable(
            [{ label: 'Page' }, { label: 'Views', right: true }, { label: 'Users', right: true }],
            ga4.topPages.map((p) => `<tr>
              <td style="${TD}max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.path)}</td>
              <td style="${TDnum}">${p.views}</td>
              <td style="${TDnum}color:${DT.soft};font-weight:400;">${p.users}</td>
            </tr>`).join('')
          )) : ''}

          <!-- Traffic sources -->
          ${ga4.trafficSources?.length ? dSection('Analytics', 'Sources', dDataTable(
            [{ label: 'Source / Medium' }, { label: 'Sessions', right: true }, { label: 'Users', right: true }],
            ga4.trafficSources.map((s) => `<tr>
              <td style="${TD}">${escapeHtml(s.source)} <span style="color:${DT.light};">/ ${escapeHtml(s.medium)}</span></td>
              <td style="${TDnum}">${s.sessions}</td>
              <td style="${TDnum}color:${DT.soft};font-weight:400;">${s.users}</td>
            </tr>`).join('')
          )) : ''}

          <!-- Key events -->
          ${Object.keys(ga4.events || {}).length ? dSection('Analytics', 'Key Events',
            `<div>${Object.entries(ga4.events).map(([name, count]) => dChip(escapeHtml(name.replace(/_/g, ' ')), count)).join('')}</div>`
          ) : ''}

          <!-- Homepage interactions -->
          ${buildHomepageAnalyticsSection(homepage)}

          <!-- New sign-ups -->
          ${dSection('Firebase', 'New Sign-ups', dDataTable([{ label: 'Email' }, { label: 'Website' }, { label: 'Time', right: true }], newUsersRows))}

          <!-- Dashboards -->
          ${dSection('Firebase', 'Dashboards', dDataTable([{ label: 'Website' }, { label: 'Status' }, { label: 'Time', right: true }], recentRunsRows))}

          <!-- Pipeline status -->
          ${dSection('Firebase', 'Pipeline Status',
            `<div style="margin-bottom:10px;">${statusBreakdown || `<span style="color:${DT.light};font-family:${DT.fBody};font-size:13px;">No pipeline data</span>`}</div><div style="font-family:${DT.fMono};font-size:11px;color:${DT.soft};letter-spacing:.02em;">Total runs <strong style="color:${DT.ink};">${firebase.totalRuns}</strong> &nbsp;&middot;&nbsp; Clients <strong style="color:${DT.ink};">${firebase.totalClients}</strong></div>`
          )}

          <!-- Deployments -->
          ${dSection('Vercel', 'Deployments',
            `${vercel.errors ? `<p style="font-family:${DT.fBody};color:${DT.accent};font-size:12px;margin:0 0 10px;">Note: ${escapeHtml(vercel.errors)}</p>` : ''}${dDataTable([{ label: 'Status' }, { label: 'Commit' }, { label: 'Time', right: true }], deploymentsRows)}`
          )}

          ${errorSection}

          <!-- Footer -->
          <div style="border-top:1.5px solid ${DT.line};padding-top:22px;margin-top:32px;">
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;color:${DT.light};margin-bottom:10px;">Generated ${new Date(timestamp).toLocaleTimeString('en-US')}</div>
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;">
              <a href="https://hitloop.agency/dashboard" style="color:${DT.accent};">Dashboard</a> &nbsp;&middot;&nbsp;
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
}

// ── Email sender ────────────────────────────────────────────────────────────

async function sendEmail(subject, html) {
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
      to: [DIGEST_TO],
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

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(request) {
  const url = new URL(request.url);
  const isPreview = url.searchParams.get('preview') === '1';
  const isSendNow = url.searchParams.get('send') === '1';

  // Auth: cron/worker secret for the scheduled run; admin token for dashboard
  // preview / send-now actions.
  let adminOk = false;
  if (isPreview || isSendNow) {
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

  try {
    const timestamp = Date.now();
    logInfo('daily_digest_start', { timestamp: new Date(timestamp).toISOString() });
    const [firebase, vercel, ga4, agenda, homepage] = await Promise.all([
      getFirebaseMetrics(),
      getVercelMetrics(),
      getGA4Metrics(),
      getCalendarAgenda(timestamp),
      getHomepageAnalyticsMetrics(),
    ]);

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
    try {
      const fullDateStr = new Date(timestamp).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
      const configClientId = await digestConfig.resolveDigestClientId();
      const cfg = await digestConfig.getDigestConfig(configClientId);
      const homeClientId = cfg.homeClientId || configClientId;
      const briefClientIds = [...new Set([homeClientId, ...(cfg.includeClientIds || [])].filter(Boolean))];

      briefs = (await Promise.all(briefClientIds.map((cid) => briefIntel.getBriefForClient(cid)))).filter(Boolean);

      if (cfg.summaryEnabled) {
        const { text: docsText } = await digestConfig.getRecentDocsText({
          clientId: homeClientId, count: cfg.recentDocsCount, maxChars: cfg.maxDocChars,
        });
        const briefText = briefs
          .map((b) => `[${b.clientName}]\n${briefIntel.briefIntelToText(b.intel)}`)
          .join('\n\n')
          .slice(0, 12000);
        summary = await briefSummary.generateBriefSummary({
          dateStr: fullDateStr, agenda, ga4, firebase, homepage, docsText,
          briefText, config: cfg,
        });
      }
    } catch (err) {
      logWarn('daily_digest_summary_failed', { error: err.message });
    }

    const sessionStr = ga4.overview ? `, ${ga4.overview.sessions} session${ga4.overview.sessions !== 1 ? 's' : ''}` : '';
    const subject = `HitLoop Daily — ${firebase.newUsers} sign-up${firebase.newUsers !== 1 ? 's' : ''}, ${firebase.recentRuns} dashboard${firebase.recentRuns !== 1 ? 's' : ''}${sessionStr} · ${dateStr}`;

    const html = buildEmailHtml(firebase, vercel, ga4, agenda, homepage, timestamp, summary, briefs);

    // Preview mode (admin dashboard): build everything, send nothing.
    if (isPreview) {
      return json({
        ok: true,
        preview: true,
        timestamp: new Date(timestamp).toISOString(),
        paragraph: summary?.paragraph || '',
        summary,
        html,
      });
    }

    const emailResult = await sendEmail(subject, html);
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
    });
  } catch (err) {
    logError('daily_digest_route_error', { error: err });
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
