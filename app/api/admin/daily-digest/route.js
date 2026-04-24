import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { getHeaderValue, safeSecretEquals } = require('../../../../api/_lib/auth.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');

// ── Config ──────────────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO = process.env.DIGEST_EMAIL || 'bryanballi@gmail.com';
const DIGEST_FROM = process.env.DIGEST_FROM || 'HitLoop Daily <digest@hitloop.agency>';
const WORKER_SECRET = process.env.WORKER_SECRET;
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = 'prj_h2AHIKHmJu7eV1DdmiTra2WFmPv6';
const VERCEL_TEAM_ID = 'team_xmgNCNc6fHyZZinuszh8B6ZB';
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '532567174';

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
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

  // Total users
  const usersSnap = await db.collection('users').get();
  const totalUsers = usersSnap.size;

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

  // Total clients (multi-tenant)
  const clientsSnap = await db.collection('clients').get();
  const totalClients = clientsSnap.size;

  // Brief runs (dashboards) — total and last 24h
  const runsSnap = await db.collection('brief_runs').get();
  const totalRuns = runsSnap.size;

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

  // Runs by status
  const statusCounts = {};
  runsSnap.docs.forEach((d) => {
    const s = d.data().status || 'unknown';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

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
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
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
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
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
            values: ['sign_up', 'sign_in', 'dashboard_created', 'pipeline_rerun', 'seo_rerun', 'tile_opened', 'theme_changed', 'tier_modal_opened'],
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

// ── Email builder ───────────────────────────────────────────────────────────

function buildEmailHtml(firebase, vercel, ga4, timestamp) {
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const newUsersRows = firebase.newUsersList.length
    ? firebase.newUsersList
        .map(
          (u) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${u.email}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${u.website || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;color:#888;">${new Date(u.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="padding:12px;color:#999;text-align:center;">No new sign-ups in the last 24 hours</td></tr>';

  const recentRunsRows = firebase.recentRunsList.length
    ? firebase.recentRunsList
        .map(
          (r) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${r.website || r.id}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;background:${r.status === 'complete' ? '#e6f9e6' : r.status === 'error' ? '#ffe6e6' : '#fff3e0'};color:${r.status === 'complete' ? '#1a7a1a' : r.status === 'error' ? '#cc0000' : '#cc7700'};">${r.status}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;color:#888;">${new Date(r.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="padding:12px;color:#999;text-align:center;">No new dashboards created</td></tr>';

  const deploymentsRows = vercel.deployments?.length
    ? vercel.deployments
        .map(
          (d) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;background:${d.state === 'READY' ? '#e6f9e6' : '#ffe6e6'};color:${d.state === 'READY' ? '#1a7a1a' : '#cc0000'};">${d.state}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.commit || '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;color:#888;">${new Date(d.created).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="3" style="padding:12px;color:#999;text-align:center;">No deployments in the last 24 hours</td></tr>';

  const statusBreakdown = Object.entries(firebase.statusCounts)
    .map(([status, count]) => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:4px 10px;background:#f5f5f5;border-radius:4px;font-size:13px;">${status}: <strong>${count}</strong></span>`)
    .join('');

  const errorSection = vercel.errorLogs?.length
    ? `
      <div style="margin-top:32px;">
        <h2 style="font-size:18px;color:#cc0000;margin:0 0 12px 0;font-weight:600;">Runtime Errors (${vercel.errorLogs.length})</h2>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <thead><tr style="background:#fff5f5;">
            <th style="padding:10px 12px;text-align:left;font-size:13px;color:#cc0000;">Path</th>
            <th style="padding:10px 12px;text-align:left;font-size:13px;color:#cc0000;">Message</th>
            <th style="padding:10px 12px;text-align:left;font-size:13px;color:#cc0000;">Status</th>
          </tr></thead>
          <tbody>
            ${vercel.errorLogs.map((e) => `
              <tr>
                <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${e.path}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.message}</td>
                <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;">${e.statusCode || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`
    : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f8f8f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:32px 16px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a1a 0%,#2a2420 100%);border-radius:12px;padding:32px;margin-bottom:24px;">
      <h1 style="margin:0 0 4px 0;font-size:24px;color:#fff;font-weight:700;">HitLoop Daily Digest</h1>
      <p style="margin:0;font-size:14px;color:rgba(255,255,255,0.6);">${dateStr}</p>
    </div>

    <!-- Key Metrics -->
    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
      <div style="flex:1;min-width:120px;background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:32px;font-weight:700;color:#1a1a1a;">${firebase.newUsers}</div>
        <div style="font-size:13px;color:#888;margin-top:4px;">New Sign-ups</div>
      </div>
      <div style="flex:1;min-width:120px;background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:32px;font-weight:700;color:#1a1a1a;">${firebase.totalUsers}</div>
        <div style="font-size:13px;color:#888;margin-top:4px;">Total Users</div>
      </div>
      <div style="flex:1;min-width:120px;background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:32px;font-weight:700;color:#1a1a1a;">${firebase.recentRuns}</div>
        <div style="font-size:13px;color:#888;margin-top:4px;">Dashboards Created</div>
      </div>
      <div style="flex:1;min-width:120px;background:#fff;border-radius:10px;padding:20px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="font-size:32px;font-weight:700;color:#1a1a1a;">${vercel.totalDeployments || 0}</div>
        <div style="font-size:13px;color:#888;margin-top:4px;">Deployments</div>
      </div>
    </div>

    <!-- GA4 Traffic Overview -->
    ${ga4.overview ? `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">Site Traffic (Google Analytics)</h2>
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <div style="flex:1;min-width:90px;background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${ga4.overview.sessions}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">Sessions</div>
        </div>
        <div style="flex:1;min-width:90px;background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${ga4.overview.pageViews}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">Page Views</div>
        </div>
        <div style="flex:1;min-width:90px;background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${ga4.overview.totalUsers}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">Visitors</div>
        </div>
        <div style="flex:1;min-width:90px;background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${ga4.overview.newUsers}</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">New Visitors</div>
        </div>
        <div style="flex:1;min-width:90px;background:#fff;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <div style="font-size:28px;font-weight:700;color:#1a1a1a;">${ga4.overview.bounceRate}%</div>
          <div style="font-size:12px;color:#888;margin-top:4px;">Bounce Rate</div>
        </div>
      </div>
      <div style="background:#fff;border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);font-size:13px;color:#888;">
        Avg. session: <strong style="color:#1a1a1a;">${Math.floor(ga4.overview.avgSessionDuration / 60)}m ${ga4.overview.avgSessionDuration % 60}s</strong>
        &middot; Engaged sessions: <strong style="color:#1a1a1a;">${ga4.overview.engagedSessions}</strong>
      </div>
    </div>
    ` : (ga4.error ? `<div style="margin-bottom:24px;"><h2 style="font-size:18px;color:#1a1a1a;margin:0 0 8px 0;font-weight:600;">Site Traffic</h2><p style="font-size:13px;color:#cc7700;">GA4 unavailable: ${ga4.error}</p></div>` : '')}

    <!-- Top Pages -->
    ${ga4.topPages?.length ? `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">Top Pages</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <thead><tr style="background:#fafafa;">
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Page</th>
          <th style="padding:10px 12px;text-align:right;font-size:13px;color:#888;">Views</th>
          <th style="padding:10px 12px;text-align:right;font-size:13px;color:#888;">Users</th>
        </tr></thead>
        <tbody>
          ${ga4.topPages.map((p) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.path}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:right;font-weight:600;">${p.views}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:right;color:#888;">${p.users}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- Traffic Sources -->
    ${ga4.trafficSources?.length ? `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">Traffic Sources</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <thead><tr style="background:#fafafa;">
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Source / Medium</th>
          <th style="padding:10px 12px;text-align:right;font-size:13px;color:#888;">Sessions</th>
          <th style="padding:10px 12px;text-align:right;font-size:13px;color:#888;">Users</th>
        </tr></thead>
        <tbody>
          ${ga4.trafficSources.map((s) => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;">${s.source} / ${s.medium}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:right;font-weight:600;">${s.sessions}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:14px;text-align:right;color:#888;">${s.users}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ` : ''}

    <!-- GA4 Custom Events -->
    ${Object.keys(ga4.events || {}).length ? `
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">Key Events</h2>
      <div style="background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        ${Object.entries(ga4.events).map(([name, count]) => `<span style="display:inline-block;margin:2px 6px 2px 0;padding:4px 10px;background:#f5f5f5;border-radius:4px;font-size:13px;">${name.replace(/_/g, ' ')}: <strong>${count}</strong></span>`).join('')}
      </div>
    </div>
    ` : ''}

    <!-- New Sign-ups -->
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">New Sign-ups</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <thead><tr style="background:#fafafa;">
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Email</th>
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Website</th>
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Time</th>
        </tr></thead>
        <tbody>${newUsersRows}</tbody>
      </table>
    </div>

    <!-- Dashboards Created -->
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">Dashboards Created (Last 24h)</h2>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <thead><tr style="background:#fafafa;">
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Website</th>
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Status</th>
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Time</th>
        </tr></thead>
        <tbody>${recentRunsRows}</tbody>
      </table>
    </div>

    <!-- Pipeline Status Breakdown -->
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">All-Time Pipeline Status</h2>
      <div style="background:#fff;border-radius:8px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        ${statusBreakdown || '<span style="color:#999;">No pipeline data</span>'}
        <div style="margin-top:8px;font-size:13px;color:#888;">Total runs: <strong>${firebase.totalRuns}</strong> &middot; Total clients: <strong>${firebase.totalClients}</strong></div>
      </div>
    </div>

    <!-- Deployments -->
    <div style="margin-bottom:24px;">
      <h2 style="font-size:18px;color:#1a1a1a;margin:0 0 12px 0;font-weight:600;">Deployments (Last 24h)</h2>
      ${vercel.errors ? `<p style="color:#cc7700;font-size:13px;">Note: ${vercel.errors}</p>` : ''}
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <thead><tr style="background:#fafafa;">
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Status</th>
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Commit</th>
          <th style="padding:10px 12px;text-align:left;font-size:13px;color:#888;">Time</th>
        </tr></thead>
        <tbody>${deploymentsRows}</tbody>
      </table>
    </div>

    ${errorSection}

    <!-- Footer -->
    <div style="text-align:center;padding:24px 0 0 0;border-top:1px solid #eee;margin-top:32px;">
      <p style="margin:0;font-size:12px;color:#bbb;">
        Generated at ${new Date(timestamp).toLocaleTimeString('en-US')} &middot;
        <a href="https://hitloop.agency/dashboard" style="color:#888;">Open Dashboard</a> &middot;
        <a href="https://vercel.com/baiees-projects/port-2026" style="color:#888;">Vercel</a> &middot;
        <a href="https://console.firebase.google.com/project/human-in-the-loop-a1a19" style="color:#888;">Firebase</a> &middot;
        <a href="https://analytics.google.com" style="color:#888;">GA4</a>
      </p>
    </div>

  </div>
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
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend API error (${res.status}): ${err}`);
  }

  return res.json();
}

// ── Route handler ───────────────────────────────────────────────────────────

export async function GET(request) {
  // Auth: accept WORKER_SECRET or Vercel Cron secret
  if (!hasValidSecret(request) && !hasValidCronSecret(request)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const timestamp = Date.now();
    logInfo('daily_digest_start', { timestamp: new Date(timestamp).toISOString() });
    const [firebase, vercel, ga4] = await Promise.all([
      getFirebaseMetrics(),
      getVercelMetrics(),
      getGA4Metrics(),
    ]);

    const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    const sessionStr = ga4.overview ? `, ${ga4.overview.sessions} session${ga4.overview.sessions !== 1 ? 's' : ''}` : '';
    const subject = `HitLoop Daily — ${firebase.newUsers} sign-up${firebase.newUsers !== 1 ? 's' : ''}, ${firebase.recentRuns} dashboard${firebase.recentRuns !== 1 ? 's' : ''}${sessionStr} · ${dateStr}`;

    const html = buildEmailHtml(firebase, vercel, ga4, timestamp);
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
      metrics: { firebase, vercel: { totalDeployments: vercel.totalDeployments, errorCount: vercel.errorLogs?.length || 0 }, ga4: { overview: ga4.overview, topPagesCount: ga4.topPages?.length, sourcesCount: ga4.trafficSources?.length, events: ga4.events, error: ga4.error || null } },
      email: emailResult,
    });
  } catch (err) {
    logError('daily_digest_route_error', { error: err });
    return json({ error: err.message || 'Internal error' }, 500);
  }
}
