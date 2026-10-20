import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  signAccessToken, registerClient, issueAuthCode, exchangeCode, refreshGrant, createMemoryOAuthStore, OAuthError, sha256hex,
  CLIENT_SCOPE, SCOPE, verifyAccessToken,
} from '../../mcp/oauth.js';
import { authenticateBearer, resourceUrl } from '../../mcp/auth.js';
import { createMemoryCounters } from '../../mcp/limits.js';
import { grantIdOf, parseClientResource, clientResourceUrl, clientResourceBase, createMemoryGrantStore } from '../grants.js';
import { resolveClientConsent } from '../consent.js';
import { handleClientMcp } from '../handler.js';
import { clientRegistry, HIDDEN_STATE_KEYS } from '../tools.js';
import { siteStatsSourceFor, DATA_SOURCES } from '../sources.js';

// Secret-shaped fixtures are assembled at runtime so the pre-push secret scanner does not flag them.
const SECRET = ['test', 'signing', 'secret', '0123456789'].join('-');
const SITE_KEY = ['site', 'stats', 'key', 'abcdefghijklmnop'].join('_');
const ORIGIN = 'https://hitloop.agency';
const NOW = Date.parse('2026-10-20T12:00:00Z');
const A = 'client-aaa-111'; const B = 'client-bbb-222';
const SECRET_A = 'A'.repeat(43); const SECRET_A2 = 'C'.repeat(43); const SECRET_B = 'B'.repeat(43);
const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const env = { MCP_OAUTH_SECRET: SECRET, KEY_A: SITE_KEY };

const grants = () => createMemoryGrantStore({
  [grantIdOf(SECRET_A)]: { clientId: A, label: 'Client A', revoked: false },
  [grantIdOf(SECRET_A2)]: { clientId: A, label: 'Client A (revoked)', revoked: true },
  [grantIdOf(SECRET_B)]: { clientId: B, label: 'Client B', revoked: false },
});

// Each client's data carries its own marker, so a leak of B into A's answer is detectable anywhere in the output.
const dataFor = (id) => ({
  brain: { status: 'approved', version: 3, identity: { name: `${id}-identity` }, voice: { tone: `${id}-voice` }, markdownSource: `# ${id} brain`, sourceRefs: [`${id}-internal`] },
  strategy: { sections: { thesis: `${id}-thesis` } },
  posts: [
    { id: `${id}-p1`, clientId: id, status: 'scheduled', scheduledAt: new Date(NOW + 3600_000).toISOString(), content: `${id} planned`, platform: 'x' },
    { id: `${id}-p2`, clientId: id, status: 'draft', scheduledAt: null, content: `${id} draft`, platform: 'x' },
    { id: `${id}-p3`, clientId: id, status: 'posted', postedAt: new Date(NOW - 86400_000).toISOString(), content: `${id} went out`, performance: { views: 120 }, platform: 'x' },
    { id: `${id}-old`, clientId: id, status: 'posted', postedAt: new Date(NOW - 90 * 86400_000).toISOString(), content: `${id} old`, platform: 'x' },
  ],
  state: {
    clientId: id, provisioningState: { secretish: 'x' }, studioCaptures: [1], clientBrain: { leak: `${id}-mirror` },
    marketingBrief: { generatedAtIso: '2026-10-20T10:00:00Z', reportSnapshot: { redditAnalysis: { summary: `${id}-reddit` } }, scoutBrief: { k: `${id}-scout` } },
    seoAudit: { score: 71, note: `${id}-seo` },
  },
});
const DB = { [A]: dataFor(A), [B]: dataFor(B) };

function fakeServices({ fetchImpl } = {}) {
  const calls = { fetch: [], reads: [] };
  const read = (kind, fn) => async (clientId) => { calls.reads.push([kind, clientId]); return fn(DB[clientId]); };
  return {
    calls,
    services: {
      env,
      sources: [
        { clientId: A, label: 'Client A site', kind: 'site-stats', url: 'https://a.example/api/stats', keyEnv: 'KEY_A' },
        { clientId: B, label: 'Client B site', kind: 'site-stats', url: 'https://b.example/api/stats', keyEnv: 'KEY_B' },
      ],
      fetch: fetchImpl || (async (url, init) => { calls.fetch.push({ url, init }); return { ok: true, status: 200, json: async () => ({ site: new URL(url).host, range: new URL(url).searchParams.get('range'), leads: { today: 2 } }) }; }),
      readBrainDoc: read('brain', (d) => d?.brain ?? null),
      readStrategyDoc: read('strategy', (d) => d?.strategy ?? null),
      readPosts: read('posts', (d) => d?.posts ?? []),
      readTodayPlan: read('today', () => ({ slots: [] })),
      readDashboardState: read('state', (d) => d?.state ?? null),
      projectBrief: (brief) => ({ projected: true, reddit: brief.reportSnapshot?.redditAnalysis?.summary }),
    },
  };
}

const clientToken = ({ hcid = A, gid = grantIdOf(SECRET_A), aud = clientResourceBase(ORIGIN), scope = CLIENT_SCOPE } = {}) =>
  signAccessToken({ secret: SECRET, email: `client-grant:${gid.slice(0, 12)}`, aud, scope, hcid, gid, now: NOW });
const ownerToken = () => signAccessToken({ secret: SECRET, email: 'bryanballi@gmail.com', aud: resourceUrl(ORIGIN), now: NOW });

function makeDeps(opts) {
  const audit = [];
  const f = fakeServices(opts);
  return { audit, calls: f.calls, deps: { grants: grants(), counters: createMemoryCounters(), audit: { write: async (e) => { audit.push(e); } }, services: f.services } };
}

const call = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
async function rpc({ token = clientToken(), secret = SECRET_A, body, deps }) {
  return handleClientMcp({ authorization: token ? `Bearer ${token}` : null, body, env, now: () => NOW, origin: ORIGIN, grantSecret: secret, deps });
}
const textOf = (out) => out.body.result.content[0].text;

// ---- isolation ---------------------------------------------------------------------------------------------

test('every tool answers for the token\'s client only; a clientId argument for another client is ignored', async () => {
  const { deps, calls } = makeDeps();
  const cases = [
    ['get_site_stats', {}], ['get_client_brain', {}], ['get_client_brain', { part: 'markdown' }], ['get_content_calendar', { range: '30d' }],
    ['get_post_results', { range: '30d' }], ['get_marketing_data', {}], ['get_marketing_data', { section: 'report' }],
    ['get_marketing_data', { section: 'marketingBrief.reportSnapshot.redditAnalysis' }], ['get_marketing_data', { section: 'seoAudit' }],
  ];
  for (const [name, args] of cases) {
    const out = await rpc({ body: call(name, { ...args, clientId: B }), deps });
    assert.equal(out.status, 200, name);
    assert.equal(out.body.result.isError, undefined, `${name}: ${textOf(out)}`);
    const text = textOf(out);
    assert.ok(!text.includes(B) && !text.includes('b.example'), `${name} leaked client B: ${text.slice(0, 200)}`);
  }
  assert.ok(calls.reads.length > 0);
  assert.ok(calls.reads.every(([, id]) => id === A), 'every read used the token client');
  assert.ok(calls.fetch.every((c) => c.url.startsWith('https://a.example/')));
});

test('client B token sees B and never A', async () => {
  const { deps } = makeDeps();
  const out = await rpc({ token: clientToken({ hcid: B, gid: grantIdOf(SECRET_B) }), secret: SECRET_B, body: call('get_marketing_data', { section: 'seoAudit' }), deps });
  assert.match(textOf(out), /client-bbb-222-seo/);
  assert.ok(!textOf(out).includes(A));
});

test('no tool takes a clientId argument; all are read-only', () => {
  assert.deepEqual(clientRegistry.map((t) => t.name), ['get_site_stats', 'get_client_brain', 'get_content_calendar', 'get_post_results', 'get_marketing_data']);
  for (const t of clientRegistry) {
    assert.equal(Object.hasOwn(t.inputSchema.properties || {}, 'clientId'), false, t.name);
    assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.equal(t.annotations.destructiveHint, false, t.name);
  }
});

// ---- auth boundaries ---------------------------------------------------------------------------------------

test('owner token on /api/client-mcp = 401; static owner token = 401; no token = 401 with metadata challenge', async () => {
  const { deps } = makeDeps();
  const body = call('get_marketing_data');
  for (const token of [ownerToken(), 'x'.repeat(40), null]) {
    const out = await rpc({ token, body, deps });
    assert.equal(out.status, 401);
    assert.match(out.headers['www-authenticate'], /oauth-protected-resource\/api\/client-mcp\/c\/A{43}/);
  }
});

test('client token on the owner /api/mcp = 401 (audience), and 401 even if the audience were forged to match', async () => {
  const isAdmin = async () => true;
  await assert.rejects(authenticateBearer({ header: `Bearer ${clientToken()}`, env, now: NOW, origin: ORIGIN, isAdmin }), (e) => e.status === 401);
  const forged = clientToken({ aud: resourceUrl(ORIGIN) });
  await assert.rejects(authenticateBearer({ header: `Bearer ${forged}`, env, now: NOW, origin: ORIGIN, isAdmin }), (e) => e.status === 401 && e.code === 'wrong-scope');
  // Owner tokens still work on the owner server.
  const ok = await authenticateBearer({ header: `Bearer ${ownerToken()}`, env, now: NOW, origin: ORIGIN, isAdmin });
  assert.equal(ok.email, 'bryanballi@gmail.com');
});

test('a token is bound to its connect link: other link = 401, revoked link = 401, client mismatch = 401', async () => {
  const { deps } = makeDeps();
  const body = call('get_marketing_data');
  assert.equal((await rpc({ secret: SECRET_B, body, deps })).status, 401); // A's token on B's link
  const revoked = clientToken({ gid: grantIdOf(SECRET_A2) });
  assert.equal((await rpc({ token: revoked, secret: SECRET_A2, body, deps })).status, 401);
  const lying = clientToken({ hcid: B, gid: grantIdOf(SECRET_A) }); // claims B on A's grant
  assert.equal((await rpc({ token: lying, body, deps })).status, 401);
  assert.equal((await rpc({ token: clientToken({ scope: SCOPE }), body, deps })).status, 401);
  assert.equal((await rpc({ secret: 'short', body, deps })).status, 404);
});

// ---- OAuth flow --------------------------------------------------------------------------------------------

async function connect(store, resource) {
  const reg = await registerClient(store, { redirect_uris: [REDIRECT], client_name: 'ChatGPT' }, { now: NOW });
  const params = { client_id: reg.client_id, redirect_uri: REDIRECT, response_type: 'code', code_challenge: CHALLENGE, code_challenge_method: 'S256', scope: CLIENT_SCOPE, resource };
  const consent = await resolveClientConsent({ params, origin: ORIGIN, grants: grants() });
  const { code } = await issueAuthCode(store, { params, email: consent.subject, now: NOW, binding: consent.binding });
  return { reg, consent, tokens: await exchangeCode(store, { code, clientId: reg.client_id, redirectUri: REDIRECT, codeVerifier: VERIFIER, secret: SECRET, aud: resourceUrl(ORIGIN), now: NOW }) };
}

test('connect link -> consent -> code -> token: bound to the client, works on its link, refresh keeps the binding', async () => {
  const store = createMemoryOAuthStore();
  const { reg, consent, tokens } = await connect(store, clientResourceUrl(ORIGIN, SECRET_A));
  assert.equal(consent.clientId, A);
  assert.equal(tokens.scope, CLIENT_SCOPE);
  const v = verifyAccessToken(tokens.access_token, { secret: SECRET, aud: clientResourceBase(ORIGIN), now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.claims.hcid, A);
  assert.match(v.claims.sub, /^client-grant:/);
  const { deps } = makeDeps();
  assert.equal((await rpc({ token: tokens.access_token, body: call('get_marketing_data'), deps })).status, 200);
  const r = await refreshGrant(store, { refreshToken: tokens.refresh_token, clientId: reg.client_id, secret: SECRET, aud: resourceUrl(ORIGIN), now: NOW + 1000 });
  const rv = verifyAccessToken(r.access_token, { secret: SECRET, aud: clientResourceBase(ORIGIN), now: NOW + 2000 });
  assert.equal(rv.ok, true);
  assert.equal(rv.claims.hcid, A);
});

test('owner refresh records without a binding (pre-existing connections) still mint owner tokens', async () => {
  const store = createMemoryOAuthStore();
  const refreshToken = 'r'.repeat(43);
  await store.refresh.put(sha256hex(refreshToken), {
    clientId: 'mcpc_old', email: 'bryanballi@gmail.com', scope: SCOPE, createdAt: NOW, expiresAt: NOW + 86400_000,
    familyId: 'fam', familyExpiresAt: NOW + 86400_000, secretVersion: sha256hex(SECRET).slice(0, 16), used: false,
  });
  const r = await refreshGrant(store, { refreshToken, clientId: 'mcpc_old', secret: SECRET, aud: resourceUrl(ORIGIN), now: NOW });
  const v = verifyAccessToken(r.access_token, { secret: SECRET, aud: resourceUrl(ORIGIN), now: NOW });
  assert.equal(v.ok, true);
  assert.equal(v.claims.hcid, undefined);
  assert.equal(r.scope, SCOPE);
});

test('consent: revoked/unknown link refused; client scope without a link refused; owner requests untouched', async () => {
  const g = grants();
  await assert.rejects(resolveClientConsent({ params: { resource: clientResourceUrl(ORIGIN, SECRET_A2) }, origin: ORIGIN, grants: g }), (e) => e instanceof OAuthError && e.code === 'access_denied');
  await assert.rejects(resolveClientConsent({ params: { resource: clientResourceUrl(ORIGIN, 'Z'.repeat(43)) }, origin: ORIGIN, grants: g }), (e) => e.code === 'access_denied');
  await assert.rejects(resolveClientConsent({ params: { scope: CLIENT_SCOPE }, origin: ORIGIN, grants: g }), (e) => e.code === 'invalid_target');
  assert.equal(await resolveClientConsent({ params: { resource: resourceUrl(ORIGIN) }, origin: ORIGIN, grants: g }), null);
  assert.equal(await resolveClientConsent({ params: {}, origin: ORIGIN, grants: g }), null);
});

test('parseClientResource: only this origin, exact path, well-formed secret', () => {
  assert.equal(parseClientResource(clientResourceUrl(ORIGIN, SECRET_A), ORIGIN), SECRET_A);
  assert.equal(parseClientResource(`${clientResourceUrl(ORIGIN, SECRET_A)}/`, ORIGIN), SECRET_A);
  assert.equal(parseClientResource(clientResourceUrl('https://evil.example', SECRET_A), ORIGIN), null);
  assert.equal(parseClientResource(`${clientResourceUrl(ORIGIN, SECRET_A)}?x=1`, ORIGIN), null);
  assert.equal(parseClientResource(clientResourceUrl(ORIGIN, 'short'), ORIGIN), null);
  assert.equal(parseClientResource(resourceUrl(ORIGIN), ORIGIN), null);
});

// ---- site stats --------------------------------------------------------------------------------------------

test('get_site_stats passes the range through, sends the key only in the header, never returns it', async () => {
  const { deps, calls } = makeDeps();
  const out = await rpc({ body: call('get_site_stats', { range: 'today' }), deps });
  assert.equal(calls.fetch.length, 1);
  assert.equal(new URL(calls.fetch[0].url).searchParams.get('range'), 'today');
  assert.equal(calls.fetch[0].init.headers.authorization, `Bearer ${SITE_KEY}`);
  assert.ok(!calls.fetch[0].url.includes(SITE_KEY));
  const text = textOf(out);
  assert.ok(!text.includes(SITE_KEY));
  assert.match(text, /"range": "today"/);
  assert.match(text, /fetchedAt/);
  const bad = await rpc({ body: call('get_site_stats', { range: '90d' }), deps });
  assert.equal(bad.body.result.isError, true); // enum enforced
});

test('get_site_stats errors never leak the key (401, 429, network, unset key)', async () => {
  for (const status of [401, 429, 500]) {
    const { deps } = makeDeps({ fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
    const out = await rpc({ body: call('get_site_stats'), deps });
    assert.equal(out.body.result.isError, true);
    assert.ok(!textOf(out).includes(SITE_KEY));
  }
  const { deps } = makeDeps({ fetchImpl: async () => { throw new Error(`boom ${SITE_KEY}`); } });
  const out = await rpc({ body: call('get_site_stats'), deps });
  assert.ok(!textOf(out).includes(SITE_KEY));
  const nb = makeDeps();
  const noKey = await rpc({ token: clientToken({ hcid: B, gid: grantIdOf(SECRET_B) }), secret: SECRET_B, body: call('get_site_stats'), deps: nb.deps });
  assert.equal(noKey.body.result.isError, true);
  assert.match(textOf(noKey), /not connected yet/);
});

test('Not The Rug is the first registered site source, keyed by env name only', () => {
  const s = siteStatsSourceFor('nottherug-ten-QSMYxuuv', DATA_SOURCES);
  assert.equal(s.url, 'https://nottherug.com/api/stats');
  assert.equal(s.keyEnv, 'CLIENT_STATS_KEY_NOTTHERUG');
});

// ---- marketing data + brain --------------------------------------------------------------------------------

test('get_marketing_data: index hides internal fields, clientBrain is refused, unknown section is an error', async () => {
  const { deps } = makeDeps();
  const idx = JSON.parse(textOf(await rpc({ body: call('get_marketing_data'), deps })));
  const names = idx.sections.map((s) => s.section);
  assert.ok(names.includes('report') && names.includes('marketingBrief') && names.includes('seoAudit'));
  for (const k of HIDDEN_STATE_KEYS) assert.ok(!names.includes(k), k);
  const brain = await rpc({ body: call('get_marketing_data', { section: 'clientBrain' }), deps });
  assert.equal(brain.body.result.isError, true);
  assert.ok(!textOf(brain).includes('mirror'));
  assert.equal((await rpc({ body: call('get_marketing_data', { section: 'nope' }), deps })).body.result.isError, true);
  assert.equal((await rpc({ body: call('get_marketing_data', { section: '__proto__.x' }), deps })).body.result.isError, true);
});

test('get_client_brain shares contents only when approved, never internal source refs', async () => {
  const { deps } = makeDeps();
  const text = textOf(await rpc({ body: call('get_client_brain'), deps }));
  assert.match(text, /client-aaa-111-voice/);
  assert.ok(!text.includes('client-aaa-111-internal'));
  DB[A].brain.status = 'draft';
  try {
    const draft = textOf(await rpc({ body: call('get_client_brain'), deps }));
    assert.ok(!draft.includes('client-aaa-111-voice'));
    assert.match(draft, /not approved/);
  } finally { DB[A].brain.status = 'approved'; }
});

test('calendar = upcoming + undated; results = posted inside the range only', async () => {
  const { deps } = makeDeps();
  const cal = JSON.parse(textOf(await rpc({ body: call('get_content_calendar', { range: '7d' }), deps })));
  assert.deepEqual(cal.scheduled.map((p) => p.id), [`${A}-p1`]);
  assert.equal(cal.undatedDrafts.count, 1);
  const res = JSON.parse(textOf(await rpc({ body: call('get_post_results', { range: '30d' }), deps })));
  assert.deepEqual(res.posts.map((p) => p.id), [`${A}-p3`]);
  assert.deepEqual(res.posts[0].performance, { views: 120 });
});

// ---- audit -------------------------------------------------------------------------------------------------

test('audit: one row per call with clientId, tool, ok; no arguments or results', async () => {
  const { deps, audit } = makeDeps();
  await rpc({ body: call('get_site_stats', { range: '30d' }), deps });
  await rpc({ body: call('get_marketing_data', { section: 'nope' }), deps });
  assert.equal(audit.length, 2);
  assert.deepEqual(Object.keys(audit[0]).sort(), ['at', 'clientId', 'grant', 'ms', 'ok', 'tool', 'via']);
  assert.equal(audit[0].clientId, A);
  assert.equal(audit[0].ok, true);
  assert.equal(audit[1].ok, false);
  assert.ok(!JSON.stringify(audit).includes('30d') && !JSON.stringify(audit).includes(SITE_KEY));
});

// ---- answer framing ----------------------------------------------------------------------------------------

test('initialize: named after the client, site analytics first, marketing second, HITLOOP kept out', async () => {
  const { deps } = makeDeps();
  const out = await rpc({ body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, deps });
  const { serverInfo, instructions } = out.body.result;
  assert.equal(serverInfo.title, 'Client A data');
  assert.match(instructions, /Client A's business assistant/);
  assert.match(instructions, /a\.example/);
  assert.ok(instructions.indexOf('PRIMARY') < instructions.indexOf('SECONDARY'));
  assert.match(instructions, /call get_site_stats first/);
  assert.match(instructions, /Do not describe HITLOOP/);
  assert.match(clientRegistry[0].description, /^PRIMARY SOURCE/);
});
