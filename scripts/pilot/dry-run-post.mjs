#!/usr/bin/env node
// LOCAL FIXTURE dry run of the owner post lifecycle for the pilot deploy candidate.
// In-memory fake Firestore + MOCK X publisher only. No network (global fetch is stubbed to throw), no real
// Firestore, no real X, no model calls, no secrets read or printed. This is NOT a staging or live check.
//
// Usage: node scripts/pilot/dry-run-post.mjs        (exit 0 = every step PASS, 1 = any FAIL)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const require = createRequire(import.meta.url);
const OWNER_CLIENT = 'fixture-client-a'; // in-memory fake only; any pilot client id
const OWNER_UID = 'dry-run-owner-uid';
const DAY = 86_400_000;
const ENV_KEYS = ['PILOT_CLIENT_IDS', 'PILOT_OWNER_UIDS'];

const ctMonth = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(new Date(ms)).slice(0, 7);

/** Runs the whole lifecycle and returns { ok, steps:[{n, step, expected, actual, pass}], fetchCalls, tweets }. */
export async function runDryRun() {
  const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
  const { makeFakeContext } = require(path.join(REPO, 'api/_lib/__tests__/fake-firestore.cjs'));
  const { __setXAdapterDepsForTest } = await import(pathToFileURL(path.join(REPO, 'features/social-posting/adapters/x.js')).href);
  const svc = await import(pathToFileURL(path.join(REPO, 'features/social-posting/twitter-service.js')).href);
  const { upsertPackage, getPackage } = await import(pathToFileURL(path.join(REPO, 'features/x-content-inventory/store.js')).href);
  const { buildMonthCalendar } = await import(pathToFileURL(path.join(REPO, 'features/x-content-inventory/month-calendar.js')).href);
  const { buildPostResults } = await import(pathToFileURL(path.join(REPO, 'features/x-content-inventory/results.js')).href);
  const { default: seedRows } = await import(pathToFileURL(path.join(REPO, 'features/x-content-inventory/content-packages.json')).href, { with: { type: 'json' } });

  const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const savedFetch = globalThis.fetch;
  const originalDbDescriptor = Object.getOwnPropertyDescriptor(fb, 'adminDb');
  const savedWarn = console.warn;
  let fetchCalls = 0;
  let restoreDeps = () => {};
  const tweets = [];
  let tweetImpl = null;
  const steps = [];

  process.env.PILOT_CLIENT_IDS = OWNER_CLIENT;
  process.env.PILOT_OWNER_UIDS = OWNER_UID;
  globalThis.fetch = () => { fetchCalls += 1; throw new Error('dry run: network call attempted'); };

  const ctx = makeFakeContext();
  ctx.adminDb.batch = () => {
    const ops = [];
    return { set: (ref, data, o) => ops.push(() => ref.set(data, o)), delete: (ref) => ops.push(() => ref.delete()), commit: async () => { for (const op of ops) await op(); } };
  };
  // Firestore DocumentReference.create() semantics (6 = ALREADY_EXISTS) for ensureDraftPost.
  const origCollection = ctx.adminDb.collection.bind(ctx.adminDb);
  ctx.adminDb.collection = (name) => {
    const col = origCollection(name);
    const origDoc = col.doc.bind(col);
    col.doc = (docId) => {
      const ref = origDoc(docId);
      ref.create = async (data) => {
        if ((await ref.get()).exists) throw Object.assign(new Error('already exists'), { code: 6 });
        await ref.set(data);
      };
      return ref;
    };
    return col;
  };
  Object.defineProperty(fb, 'adminDb', { configurable: true, get: () => ctx.adminDb });
  restoreDeps = __setXAdapterDepsForTest({
    getClient: async () => ({
      authMode: 'oauth2',
      client: {
        v1: { uploadMedia: async () => 'm1' },
        v2: {
          tweet: async (payload) => {
            tweets.push(payload);
            if (tweetImpl) return tweetImpl(payload);
            return { data: { id: String(1850000000000000000n + BigInt(tweets.length)) } };
          },
        },
      },
    }),
    fetchMedia: async () => { throw new Error('no media'); },
  });
  console.warn = () => {};

  const raw = (id) => ctx.adminDb._raw('social_posts', id);
  const pkgRow = (id) => ({ ...seedRows[1], id, status: 'idea', rights: 'owned' });
  const state = {};

  /** Record one step: fn returns { expected, actual, pass }; a throw is a FAIL. */
  async function step(name, fn) {
    const n = steps.length + 1;
    let r;
    try { r = await fn(); } catch (e) { r = { expected: 'no error', actual: `threw ${e?.code || ''} ${e?.message || e}`.trim(), pass: false }; }
    steps.push({ n, step: name, expected: String(r.expected), actual: String(r.actual), pass: r.pass === true });
  }
  const eq = (expected, actual) => ({ expected, actual, pass: expected === actual });
  const rejects = async (code, p) => {
    try { await p; return { expected: `rejected ${code}`, actual: 'resolved', pass: false }; } catch (e) { return { expected: `rejected ${code}`, actual: `rejected ${e.code || e.message}`, pass: e.code === code }; }
  };

  try {
    const t1 = Date.now() + 32 * DAY;               // >= 31 days out: never publishable by a real sweep
    const t1Iso = new Date(Math.ceil(t1 / 3_600_000) * 3_600_000).toISOString();
    const t2Iso = new Date(Date.parse(t1Iso) + 30 * 60_000).toISOString();   // 30 min after t1 (inside plan spacing)
    const t3Iso = new Date(Date.parse(t1Iso) + 2 * DAY).toISOString();

    await upsertPackage(pkgRow('dry-pkg-a'), { returnPackages: false });
    await upsertPackage(pkgRow('dry-pkg-b'), { returnPackages: false });

    await step('Draft via ensureDraftPost (owner client, package A)', async () => {
      const a = await svc.ensureDraftPost(OWNER_CLIENT, { idempotencyKey: 'dry-run:a', content: 'Representative post: first draft.', packageId: 'dry-pkg-a', channel: 'x' });
      const b = await svc.ensureDraftPost(OWNER_CLIENT, { idempotencyKey: 'dry-run:a', content: 'ignored repeat save', packageId: 'dry-pkg-a' });
      state.a = a.post.id;
      const row = raw(state.a);
      return eq('draft, v2, one row, repeat save is idempotent', `${row.status}, v${row.lifecycleVersion}, ${a.post.id === b.post.id && b.existing ? 'one row, repeat save is idempotent' : 'DUPLICATE ROW'}`);
    });

    await step('Edit the draft text', async () => {
      await svc.updateSocialPost(OWNER_CLIENT, state.a, { content: 'Representative post: edited by the owner.' });
      const row = raw(state.a);
      return eq('draft | Representative post: edited by the owner.', `${row.status} | ${row.content}`);
    });

    await step('Approve and schedule >= 31 days out', async () => {
      await svc.approveAndSchedule(OWNER_CLIENT, state.a, { scheduledAt: t1Iso, reviewedBy: OWNER_UID });
      const row = raw(state.a);
      const days = (Date.parse(row.scheduledAt) - Date.now()) / DAY;
      return { expected: 'scheduled, >= 31 days out, approvedHash set', actual: `${row.status}, ${days.toFixed(1)} days out, approvedHash ${row.approvedHash ? 'set' : 'MISSING'}`, pass: row.status === 'scheduled' && days >= 31 && !!row.approvedHash };
    });

    await step('Sweep now does NOT publish the future-dated post', async () => {
      await svc.processDuePosts(OWNER_CLIENT);
      return eq('0 tweets, status scheduled', `${tweets.length} tweets, status ${raw(state.a).status}`);
    });

    await step('Second schedule, SAME package, refused', async () => {
      const dup = await svc.ensureDraftPost(OWNER_CLIENT, { idempotencyKey: 'dry-run:a-dup', content: 'Competing copy for package A.', packageId: 'dry-pkg-a' });
      return rejects('package-already-pending', svc.approveAndSchedule(OWNER_CLIENT, dup.post.id, { scheduledAt: t3Iso, reviewedBy: OWNER_UID }));
    });

    await step('Second schedule, other package, 30 min apart, refused', async () => {
      const b = await svc.ensureDraftPost(OWNER_CLIENT, { idempotencyKey: 'dry-run:b', content: 'Second representative post (ambiguous path).', packageId: 'dry-pkg-b' });
      state.b = b.post.id;
      return rejects('plan-spacing', svc.approveAndSchedule(OWNER_CLIENT, state.b, { scheduledAt: t2Iso, reviewedBy: OWNER_UID }));
    });

    await step('Calendar view shows the post as scheduled on its day', async () => {
      const posts = await svc.readSocialQueue(OWNER_CLIENT);
      const cal = buildMonthCalendar({ posts, month: ctMonth(Date.parse(t1Iso)), now: Date.now() });
      const hit = cal.weeks.flat().flatMap((d) => d.posts.map((p) => ({ ...p, date: d.date }))).find((p) => p.id === state.a);
      return { expected: 'post present with state scheduled, not proposed', actual: hit ? `state ${hit.state}, ${hit.proposed ? 'proposed' : 'real'}, date ${hit.date}` : 'not found', pass: !!hit && hit.state === 'scheduled' && !hit.proposed };
    });

    await step('Force due (scheduledAt 1h in the past, inside the 2h window)', async () => {
      ctx.adminDb._patch('social_posts', state.a, { scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
      return eq('status scheduled, scheduledAt in the past', `status ${raw(state.a).status}, scheduledAt ${Date.parse(raw(state.a).scheduledAt) < Date.now() ? 'in the past' : 'future'}`);
    });

    await step('processDuePosts publishes through the MOCK publisher exactly once', async () => {
      await svc.processDuePosts(OWNER_CLIENT);
      await svc.processDuePosts(OWNER_CLIENT);
      return eq('1 tweets, status posted, numeric twitterId', `${tweets.length} tweets, status ${raw(state.a).status}, ${/^\d+$/.test(String(raw(state.a).twitterId)) ? 'numeric twitterId' : 'no twitterId'}`);
    });

    await step('Package usage written back (posted, postCount 1, lastTwitterId)', async () => {
      const pkg = await getPackage('dry-pkg-a');
      return { expected: `status posted, postCount 1, lastTwitterId = post twitterId`, actual: `status ${pkg.status}, postCount ${pkg.postCount}, lastTwitterId ${pkg.lastTwitterId === raw(state.a).twitterId ? 'matches' : 'MISMATCH'}`, pass: pkg.status === 'posted' && pkg.postCount === 1 && pkg.lastTwitterId === raw(state.a).twitterId };
    });

    await step('Results view: posted with "not measured yet" metrics', async () => {
      const posts = await svc.readSocialQueue(OWNER_CLIENT);
      const packages = [await getPackage('dry-pkg-a'), await getPackage('dry-pkg-b')];
      const res = buildPostResults({ posts, packages, now: Date.now() });
      const row = res.posted.find((r) => r.id === state.a);
      return { expected: 'in posted list, metrics null, note "not measured yet"', actual: row ? `in posted list, metrics ${row.metrics === null ? 'null' : 'present'}, note "${row.metricsNote}"` : 'not in posted list', pass: !!row && row.metrics === null && row.metricsNote === 'not measured yet' };
    });

    await step('Schedule second v2 post (package B) far out, then force due', async () => {
      await svc.approveAndSchedule(OWNER_CLIENT, state.b, { scheduledAt: t3Iso, reviewedBy: OWNER_UID });
      const far = raw(state.b).status;
      ctx.adminDb._patch('social_posts', state.b, { scheduledAt: new Date(Date.now() - 3_600_000).toISOString() });
      return eq('scheduled, due', `${far}, ${Date.parse(raw(state.b).scheduledAt) < Date.now() ? 'due' : 'not due'}`);
    });

    await step('Ambiguous publish (mock ETIMEDOUT) parks needs_review', async () => {
      const before = tweets.length;
      tweetImpl = async () => { throw Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }); };
      await svc.processDuePosts(OWNER_CLIENT);
      const row = raw(state.b);
      return { expected: 'needs_review, network-ambiguous, retryable false, 1 attempt', actual: `${row.status}, ${row.errorClass}, retryable ${row.retryable}, ${tweets.length - before} attempt`, pass: row.status === 'needs_review' && row.errorClass === 'network-ambiguous' && row.retryable === false && tweets.length - before === 1 };
    });

    await step('Parked post is NOT retried by later sweeps', async () => {
      const before = tweets.length;
      await svc.processDuePosts(OWNER_CLIENT);
      await svc.processDuePosts(OWNER_CLIENT);
      return eq('0 further publish attempts, status needs_review', `${tweets.length - before} further publish attempts, status ${raw(state.b).status}`);
    });

    await step('reconcilePost marks the held post posted with a numeric platform id (no publish)', async () => {
      const before = tweets.length;
      const bad = await rejects('platform-id-required', svc.reconcilePost(OWNER_CLIENT, state.b, { outcome: 'posted', platformId: 'abc' }));
      const out = await svc.reconcilePost(OWNER_CLIENT, state.b, { outcome: 'posted', platformId: '1850000000000009999', by: OWNER_UID });
      return { expected: 'bad id rejected; posted, id 1850000000000009999, no new tweet', actual: `bad id ${bad.pass ? 'rejected' : 'ACCEPTED'}; ${out.status}, id ${out.twitterId}, ${tweets.length - before} new tweets`, pass: bad.pass && out.status === 'posted' && out.twitterId === '1850000000000009999' && tweets.length === before };
    });

    await step('No network call was made (global fetch never invoked)', async () => eq('0 fetch calls', `${fetchCalls} fetch calls`));
  } finally {
    restoreDeps();
    console.warn = savedWarn;
    globalThis.fetch = savedFetch;
    Object.defineProperty(fb, 'adminDb', originalDbDescriptor);
    for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  }
  return { ok: steps.every((s) => s.pass), steps, fetchCalls, tweets: tweets.length };
}

export function formatTranscript(result) {
  const lines = ['LOCAL FIXTURE DRY RUN (in-memory fake Firestore + mock X publisher; not a staging or live check)', ''];
  for (const s of result.steps) {
    lines.push(`${s.n}. ${s.step}`, `   expected: ${s.expected}`, `   actual:   ${s.actual}`, `   ${s.pass ? 'PASS' : 'FAIL'}`);
  }
  const failed = result.steps.filter((s) => !s.pass).length;
  lines.push('', `${result.steps.length - failed}/${result.steps.length} steps passed. ${result.ok ? 'RESULT: PASS' : 'RESULT: FAIL'}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runDryRun();
  console.log(formatTranscript(result));
  process.exit(result.ok ? 0 : 1);
}
