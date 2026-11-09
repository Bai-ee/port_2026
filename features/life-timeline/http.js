// Testable handler logic for the life routes. Route files are thin wrappers around these.
// Real dependencies load lazily (firebase-admin) so tests injecting fakes never touch it.
import { lifeUploadUrls, ingestLifeResults } from './ingest.js';
import { requireLifeOwner } from './owner-auth.js';
import { sanitizeLifeStatus } from './schema.js';

const HEADERS = { 'cache-control': 'no-store' };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$|^unknown$/;
const ID_RE = /^[0-9a-f]{16}$/;
export const SIGN_CONCURRENCY = 16;

const res = (body, status = 200) => ({ status, body, headers: HEADERS });
const errRes = (e) => res({ error: e?.message || 'Failed' }, e?.status || 500);

async function realDeps() {
  const store = await import('./store.js');
  const signed = await import('./signed.js');
  const { workerAuthStatus } = await import('../discogs-ingest/service.js');
  return {
    ...store, workerAuthStatus, signRead: signed.signReadUrl, signUpload: signed.signUploadUrl,
    countBySource: store.countBySource,
  };
}

function workerGate(request, deps) {
  const auth = deps.workerAuthStatus(request);
  if (auth === 503) return res({ error: 'Worker token not configured' }, 503);
  if (auth !== 200) return res({ error: 'Unauthorized' }, 401);
  return null;
}

export async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const n = i; i += 1; out[n] = await fn(list[n]); }
  });
  await Promise.all(workers);
  return out;
}

export async function handleUploadUrls(request, deps) {
  const d = deps || await realDeps();
  const denied = workerGate(request, d);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  try { return res(await lifeUploadUrls({ signUpload: d.signUpload }, body)); } catch (e) { return errRes(e); }
}

export async function handleResults(request, deps) {
  const d = deps || await realDeps();
  const denied = workerGate(request, d);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  try { return res(await ingestLifeResults(d, body)); } catch (e) { return errRes(e); }
}

async function ownerGate(request, d) {
  try { await requireLifeOwner(request, d.ownerDeps || {}); return null; } catch (e) { return errRes(e); }
}

export async function handleMonths(request, deps) {
  const d = deps || await realDeps();
  const denied = await ownerGate(request, d);
  if (denied) return denied;
  try {
    const all = await d.listMonths();
    const months = all.filter((m) => m.ym !== 'unknown').map((m) => ({ ym: m.ym, count: m.count })).sort((a, b) => (a.ym < b.ym ? -1 : 1));
    const unknownCount = all.find((m) => m.ym === 'unknown')?.count || 0;
    const total = months.reduce((n, m) => n + m.count, 0) + unknownCount;
    return res({ months, unknownCount, total });
  } catch (e) { return errRes(e); }
}

export async function handleMonth(request, deps) {
  const d = deps || await realDeps();
  const denied = await ownerGate(request, d);
  if (denied) return denied;
  const ym = new URL(request.url).searchParams.get('ym') || '';
  if (!MONTH_RE.test(ym)) return res({ error: 'ym must be YYYY-MM or unknown' }, 400);
  try {
    const month = await d.readMonth(ym);
    const entries = month?.items || [];
    const items = await mapLimit(entries, SIGN_CONCURRENCY, async (e) => ({
      ...e, thumbUrl: await d.signRead(`life-thumbs/${e.id}_s.jpg`).catch(() => null),
    }));
    return res({ ym, items, expiresAt: new Date((d.now ? d.now() : Date.now()) + 3600000).toISOString() });
  } catch (e) { return errRes(e); }
}

export async function handleItem(request, deps) {
  const d = deps || await realDeps();
  const denied = await ownerGate(request, d);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!ID_RE.test(id)) return res({ error: 'id must be 16 hex chars' }, 400);
  try {
    const doc = await d.getItem(id);
    if (!doc) return res({ error: 'Not found' }, 404);
    const { canonicalPath, ...item } = doc; // eslint-disable-line no-unused-vars
    const [previewUrl, thumbUrl] = item.thumbs
      ? await Promise.all([d.signRead(item.thumbs.m).catch(() => null), d.signRead(item.thumbs.s).catch(() => null)])
      : [null, null];
    return res({ item, previewUrl, thumbUrl, expiresAt: new Date((d.now ? d.now() : Date.now()) + 3600000).toISOString() });
  } catch (e) { return errRes(e); }
}

export async function handleStatusWrite(request, deps) {
  const d = deps || await realDeps();
  const denied = workerGate(request, d);
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const out = sanitizeLifeStatus(body);
  if (!out.ok) return res({ error: `Invalid status: ${out.reason}` }, 400);
  try {
    const receivedAt = new Date(d.now ? d.now() : Date.now()).toISOString();
    await d.writeStatus(out.status, undefined, receivedAt);
    return res({ ok: true, receivedAt });
  } catch (e) { return errRes(e); }
}

// PUBLIC (no auth): numbers/labels only, no paths or names. The one exception to owner-only reads.
export async function handleStatusRead(request, deps) {
  const d = deps || await realDeps();
  try { return res({ status: (await d.readStatus()) || null }); } catch (e) { return errRes(e); }
}
