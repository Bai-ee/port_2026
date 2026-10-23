import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBeacon, normalizePath, referrerHost, deviceOf, isAllowedOrigin } from '../events.js';
import { buildReport, getSiteReport, resolveWindow, localMidnight, sourceOf, buildSessionPaths, RangeRequestError } from '../report.js';
import { registry } from '../../mcp/registry.js';
import { handleRpc } from '../../mcp/jsonrpc.js';
import { createFakeDb } from '../../mcp/__tests__/fake-db.js';

const NOW = Date.parse('2026-10-23T17:00:00Z'); // 12:00 in Chicago (CDT, UTC-5)
const TZ = 'America/Chicago';
const TX = 'JWw2H8UWfjab5lZlB-BlKOgvwSjTZI11H2PBXAjlfv8';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const headers = (h = {}) => { const m = new Map(Object.entries({ 'user-agent': MAC, ...h })); return { get: (k) => m.get(k) ?? null }; };
const base = { site: 'ue', vid: 'v1abcdefgh', sid: 's1abcdefgh' };

// ---- collector ---------------------------------------------------------------------------------------------

test('paths drop the Arweave manifest txid, query, hash and index.html', () => {
  assert.equal(normalizePath(`/${TX}/index.html`), '/');
  assert.equal(normalizePath(`/${TX}/acidman.html?x=1#y`), '/acidman.html');
  assert.equal(normalizePath('/archive.html'), '/archive.html');
  assert.equal(normalizePath(''), '/');
});

test('referrer hosts fold link shims; devices reduce to three buckets; origins limited to the site and Arweave gateways', () => {
  assert.equal(referrerHost('https://t.co/abc'), 'x.com');
  assert.equal(referrerHost('https://www.google.com/search?q=x'), 'google.com');
  assert.equal(referrerHost('not a url'), null);
  assert.equal(deviceOf(IPHONE), 'mobile');
  assert.equal(deviceOf(MAC), 'desktop');
  for (const o of [null, 'https://undergroundexistence.info', `https://evwd.arweave.net`, 'https://ue.ar.io']) assert.equal(isAllowedOrigin(o, 'ue'), true, o);
  for (const o of ['https://evil.example', 'https://arweave.net.evil.example', 'https://hitloop.agency']) assert.equal(isAllowedOrigin(o, 'ue'), false, o);
  for (const o of ['https://hitloop.agency', 'https://www.hitloop.agency', 'http://localhost:3000']) assert.equal(isAllowedOrigin(o, 'hitloop'), true, o);
  for (const o of ['https://undergroundexistence.info', 'https://evwd.arweave.net', 'https://hitloop.agency.evil.example']) assert.equal(isAllowedOrigin(o, 'hitloop'), false, o);
});

test('pageview: geo from Vercel headers, external referrer kept without query, no IP or UA stored', () => {
  const r = parseBeacon({ ...base, type: 'pageview', path: `/${TX}/index.html`, entry: true, ref: 'https://www.instagram.com/p/123?igsh=secret', utm: { source: 'ig_bio' } },
    headers({ 'x-vercel-ip-country': 'US', 'x-vercel-ip-country-region': 'IL', 'x-vercel-ip-city': 'Chicago', 'x-forwarded-for': '1.2.3.4' }), NOW);
  assert.equal(r.ok, true);
  assert.deepEqual({ path: r.row.path, refHost: r.row.refHost, ref: r.row.ref, country: r.row.country, city: r.row.city, utmSource: r.row.utmSource, entry: r.row.entry, test: r.row.test },
    { path: '/', refHost: 'instagram.com', ref: 'https://www.instagram.com/p/123', country: 'US', city: 'Chicago', utmSource: 'ig_bio', entry: true, test: undefined });
  assert.doesNotMatch(JSON.stringify(r.row), /1\.2\.3\.4|Mozilla|secret/);
});

test('same-site referrers are not a source; engagement carries no label; test flag is kept', () => {
  for (const ref of ['https://undergroundexistence.info/', `https://abc.arweave.net/${TX}/index.html`, 'https://ue.ar.io/']) {
    assert.equal(parseBeacon({ ...base, type: 'pageview', path: '/', ref }, headers(), NOW).row.refHost, undefined, ref);
  }
  const eng = parseBeacon({ ...base, type: 'engagement', label: 'x', test: true }, headers(), NOW).row;
  assert.equal(eng.label, undefined);
  assert.equal(eng.test, true);
});

test('rejects unknown sites, bad ids, unknown types, bots and foreign origins', () => {
  assert.equal(parseBeacon({ ...base, site: 'other', type: 'pageview' }, headers(), NOW).reason, 'site');
  assert.equal(parseBeacon({ ...base, vid: 'x', type: 'pageview' }, headers(), NOW).reason, 'id');
  assert.equal(parseBeacon({ ...base, type: 'purchase' }, headers(), NOW).reason, 'type');
  assert.equal(parseBeacon({ ...base, type: 'pageview' }, headers({ 'user-agent': 'Googlebot/2.1' }), NOW).reason, 'bot');
  assert.equal(parseBeacon({ ...base, type: 'pageview' }, headers({ origin: 'https://evil.example' }), NOW).reason, 'origin');
  assert.equal(parseBeacon(null, headers(), NOW).ok, false);
});

// ---- report ------------------------------------------------------------------------------------------------

test('windows are site-local calendar days', () => {
  assert.equal(new Date(localMidnight('2026-10-23', TZ)).toISOString(), '2026-10-23T05:00:00.000Z');
  assert.equal(new Date(localMidnight('2026-01-15', TZ)).toISOString(), '2026-01-15T06:00:00.000Z');
  assert.equal(new Date(resolveWindow('today', NOW, TZ).start).toISOString(), '2026-10-23T05:00:00.000Z');
  assert.equal(new Date(resolveWindow('7d', NOW, TZ).start).toISOString(), '2026-10-17T05:00:00.000Z');
  assert.equal(resolveWindow('24h', NOW, TZ).start, NOW - 86_400_000);
  assert.equal(sourceOf({ utmSource: 'nl', refHost: 'x.com' }), 'campaign:nl');
  assert.equal(sourceOf({ refHost: 'x.com' }), 'referral:x.com');
  assert.equal(sourceOf({}), 'direct');
});

const H = 3_600_000;
const ev = (o) => ({ site: 'ue', device: 'desktop', country: 'US', ...o });
const EVENTS = [
  ev({ type: 'pageview', ts: NOW - 30 * H, vid: 'a', sid: 'a1', path: '/', entry: true, refHost: 'instagram.com', ref: 'https://www.instagram.com/' }),
  ev({ type: 'click', ts: NOW - 30 * H + 1000, vid: 'a', sid: 'a1', path: '/', label: 'Acidman', href: 'https://x/acidman.html', kind: 'internal' }),
  ev({ type: 'pageview', ts: NOW - 30 * H + 2000, vid: 'a', sid: 'a1', path: '/acidman.html' }),
  ev({ type: 'play', ts: NOW - 30 * H + 62_000, vid: 'a', sid: 'a1', path: '/acidman.html', label: 'Acidman — Deep Mix' }),
  ev({ type: 'pageview', ts: NOW - 2 * H, vid: 'a', sid: 'a2', path: '/', entry: true }),
  ev({ type: 'pageview', ts: NOW - 20 * 60_000, vid: 'b', sid: 'b1', path: '/', entry: true, utmSource: 'newsletter', country: 'DE', city: 'Berlin', device: 'mobile' }),
  ev({ type: 'engagement', ts: NOW - 19 * 60_000, vid: 'b', sid: 'b1', path: '/' }),
  ev({ type: 'click', ts: NOW - 18 * 60_000, vid: 'b', sid: 'b1', path: '/', label: 'Instagram', href: 'https://www.instagram.com/ue', kind: 'outbound' }),
  ev({ type: 'pageview', ts: NOW - 10 * 60_000, vid: 't', sid: 't1', path: '/', entry: true, test: true }),
  ev({ type: 'pageview', ts: NOW - 10 * 24 * H, vid: 'old', sid: 'old1', path: '/', entry: true }),
];

test('report: client-site contract shape plus beacon extras; test traffic and out-of-window events excluded', () => {
  const r = buildReport(EVENTS, { site: 'ue', range: '7d', now: NOW, firstTs: NOW - 10 * 24 * H });
  assert.equal(r.site, 'undergroundexistence.info');
  assert.equal(r.leads, null);
  assert.equal(r.applicants, null);
  const a = r.analytics;
  assert.equal(a.meta.status, 'ok');
  assert.equal(a.range.timezone, TZ);
  assert.deepEqual([a.visitors, a.sessions, a.pageviews], [2, 3, 4]);
  assert.equal(a.bouncedSessions, 1); // a2: one page, nothing else
  assert.equal(a.bounceRatePct, 33.3);
  assert.equal(a.engagedVisitPct, 66.7);
  assert.equal(a.pagesPerSession, 1.33);
  assert.deepEqual(a.sessionDuration.medianSeconds, 91); // a1 62s, b1 120s
  assert.deepEqual(a.sources.map((s) => s.source).sort(), ['campaign:newsletter', 'direct', 'referral:instagram.com']);
  assert.deepEqual(a.pages[0], { route: '/', pageviews: 3, sessions: 3 });
  assert.deepEqual(a.outboundLinks, [{ host: 'instagram.com', clicks: 1 }]);
  assert.deepEqual(a.mixPlays, [{ mix: 'Acidman — Deep Mix', plays: 1, sessions: 1 }]);
  assert.deepEqual(a.countries.map((c) => c.country).sort(), ['DE', 'US']);
  assert.deepEqual(a.live, { ...a.live, pageviews: 1, sessions: 1 });
  assert.deepEqual(a.dailyTrend.map((d) => [d.date, d.sessions, d.pageviews]), [['2026-10-22', 1, 2], ['2026-10-23', 2, 2]]);

  const t = buildReport(EVENTS, { site: 'ue', range: 'today', now: NOW, testMode: true, firstTs: 1 }).analytics;
  assert.deepEqual([t.sessions, t.pageviews, t.meta.testMode], [1, 1, true]);
});

test('report status: no_data_yet before the first event, zero_activity for an empty window', () => {
  assert.equal(buildReport([], { site: 'ue', now: NOW }).analytics.meta.status, 'no_data_yet');
  assert.equal(buildReport([], { site: 'ue', now: NOW, firstTs: 1 }).analytics.meta.status, 'zero_activity');
});

test('getSiteReport + owner get_site_analytics read newest-first from Firestore', async () => {
  const seed = Object.fromEntries(EVENTS.map((e, i) => [`site_analytics/ue/events/e${i}`, e]));
  const db = createFakeDb(seed);
  const r = await getSiteReport({ db, site: 'ue', range: '7d', now: NOW });
  assert.equal(r.analytics.meta.trackingStartDate, new Date(NOW - 10 * 24 * H).toISOString());
  assert.equal(r.analytics.meta.eventsTruncated, false);
  assert.equal(r.analytics.sessions, 3);

  const ctx = { db, email: 'o@x.test', clientId: 'c', now: () => NOW, services: {} };
  const out = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_site_analytics', arguments: { range: '7d' } } }, { registry, ctx, instructions: '' });
  const body = JSON.parse(out.body.result.content[0].text);
  assert.equal(body.analytics.visitors, 2);
  assert.equal(body.analytics.sessions, 3); // "sessions" key not redacted
  assert.equal(registry.find((t) => t.name === 'get_site_analytics').annotations.readOnlyHint, true);
});

test('custom from/to: site-local inclusive days, validated', () => {
  const w = resolveWindow('7d', NOW, TZ, { from: '2026-10-20', to: '2026-10-22' });
  assert.deepEqual([w.key, w.days, new Date(w.start).toISOString(), new Date(w.end).toISOString()], ['custom', 3, '2026-10-20T05:00:00.000Z', '2026-10-23T05:00:00.000Z']);
  assert.throws(() => resolveWindow('7d', NOW, TZ, { from: '2026-10-22', to: '2026-10-20' }), RangeRequestError);
  assert.throws(() => resolveWindow('7d', NOW, TZ, { from: '2026-10-22', to: '2026-10-24' }), /future/);
  assert.throws(() => resolveWindow('7d', NOW, TZ, { from: '2026-01-01', to: '2026-10-22' }), /90 days/);
  assert.throws(() => resolveWindow('7d', NOW, TZ, { from: '2026-10-22' }), /YYYY-MM-DD/);
  const r = buildReport(EVENTS, { site: 'ue', from: '2026-10-22', to: '2026-10-22', now: NOW, firstTs: 1 });
  assert.deepEqual([r.range, r.analytics.sessions, r.analytics.pageviews], ['custom', 1, 2]);
});

test('visit paths: newest first, source/entry/exit, trail, visitor id; test traffic excluded', () => {
  const p = buildSessionPaths(EVENTS, { site: 'ue', range: '7d', now: NOW });
  assert.equal(p.totalSessions, 3);
  assert.deepEqual(p.sessions.map((s) => s.sid), ['b1', 'a2', 'a1']);
  const a1 = p.sessions[2];
  assert.deepEqual({ visitor: a1.visitor, source: a1.source, entry: a1.entryRoute, exit: a1.exitRoute, pv: a1.pageviews, bounced: a1.bounced, plays: a1.mixPlays, dur: a1.durationSeconds },
    { visitor: 'a', source: 'referral:instagram.com', entry: '/', exit: '/acidman.html', pv: 2, bounced: false, plays: ['Acidman — Deep Mix'], dur: 62 });
  assert.deepEqual(a1.trail.map((t) => t.event), ['pageview', 'click', 'pageview', 'play']);
  assert.equal(p.sessions[1].bounced, true);
  assert.equal(buildSessionPaths(EVENTS, { site: 'ue', range: '7d', now: NOW, limit: 1 }).returned, 1);
});

test('owner get_site_sessions + custom dates on get_site_analytics; a bad window is a tool error with the reason', async () => {
  const seed = Object.fromEntries(EVENTS.map((e, i) => [`site_analytics/ue/events/e${i}`, e]));
  const ctx = { db: createFakeDb(seed), email: 'o@x.test', clientId: 'c', now: () => NOW, services: {} };
  const callTool = (name, args) => handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' }).then((r) => r.body.result);
  const s = JSON.parse((await callTool('get_site_sessions', { range: '7d', limit: 2 })).content[0].text);
  assert.deepEqual([s.totalSessions, s.returned, s.sessions[0].sid], [3, 2, 'b1']);
  const c = JSON.parse((await callTool('get_site_analytics', { from: '2026-10-22', to: '2026-10-22' })).content[0].text);
  assert.deepEqual([c.range, c.analytics.pageviews], ['custom', 2]);
  const bad = await callTool('get_site_analytics', { from: '2026-10-22', to: '2026-10-30' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /future/);
});

test('hitloop site: own-domain referrers are internal, external ones are sources; report uses its own hostname', () => {
  const h = headers({ origin: 'https://hitloop.agency' });
  const hb = { site: 'hitloop', vid: 'h1abcdefgh', sid: 'h1sessionx' };
  assert.equal(parseBeacon({ ...hb, type: 'pageview', path: '/work', ref: 'https://hitloop.agency/' }, h, NOW).row.refHost, undefined);
  const ext = parseBeacon({ ...hb, type: 'pageview', path: '/work', ref: 'https://www.linkedin.com/feed/' }, h, NOW).row;
  assert.deepEqual([ext.site, ext.path, ext.refHost], ['hitloop', '/work', 'linkedin.com']);
  assert.equal(parseBeacon({ ...hb, type: 'pageview', path: '/' }, headers({ origin: 'https://undergroundexistence.info' }), NOW).reason, 'origin');
  const r = buildReport([{ ...ext, ts: NOW - 1000 }], { site: 'hitloop', range: 'today', now: NOW, firstTs: 1 });
  assert.deepEqual([r.site, r.analytics.sources[0].source, r.analytics.pages[0].route], ['hitloop.agency', 'referral:linkedin.com', '/work']);
});
