// Public analytics collector for static sites HITLOOP does not host (the Underground Existence Arweave site).
// The site's beacon sends a text/plain JSON body (a CORS "simple request", so no preflight); we always answer 204
// so a bad or dropped event never surfaces in the visitor's console. Read side: features/site-analytics/report.js,
// served by the client MCP's get_site_stats (data-sources.json row with provider "hitloop") and owner MCP get_site_analytics.

import { createRequire } from 'module';
import { parseBeacon, EVENTS_COLLECTION } from '../../../../features/site-analytics/events.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 4096;
// Per-instance flood guard. Deliberately in memory: a Firestore-backed limiter would cost more writes than the events.
const WINDOW_MS = 60_000;
const PER_IP_PER_WINDOW = 120;
const hits = new Map();

function throttled(ip, now) {
  const h = hits.get(ip);
  if (!h || now - h.start >= WINDOW_MS) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  h.count += 1;
  return h.count > PER_IP_PER_WINDOW;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' };
const done = () => new Response(null, { status: 204, headers: CORS });

export function OPTIONS() { return done(); }

export async function POST(request) {
  // Emergency stop, read per request (no redeploy): accept and discard every event.
  if (process.env.SITE_ANALYTICS_DISABLED === 'true') return done();
  const now = Date.now();
  if (throttled(getClientIp(request), now)) return done();
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return done();
    body = JSON.parse(text);
  } catch { return done(); }

  const parsed = parseBeacon(body, request.headers, now);
  if (!parsed.ok) return done();
  try {
    await fb.adminDb.collection(EVENTS_COLLECTION(parsed.site)).add(parsed.row);
  } catch (err) {
    console.error('[site-events]', err?.message || err);
  }
  return done();
}
