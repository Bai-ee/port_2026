// Pure helpers for scripts/mixtapes/publish-tape-review.mjs (no filesystem, network or process I/O):
// clip-window picker, review ids, ffmpeg clip filter, env preflight and the Firestore record builder.

export const CLIP_LENGTH_S = 60;
export const HEAD_MARGIN_S = 120;
export const TAIL_MARGIN_S = 180;
export const JOIN_EXCLUDE_S = 30;
export const END_EXCLUDE_S = 5;
export const FADE_S = 1;
export const PUBLISH_VERSION = 1;
export const COLLECTION = 'mixtape_reviews';
export const STORAGE_PREFIX = 'mixtape-reviews';
export const EXPECTED_PROJECT_ID = 'human-in-the-loop-a1a19';
export const EXPECTED_BUCKET = 'human-in-the-loop-a1a19.firebasestorage.app';
export const ENV_FILE_PATH = process.env.MIXTAPE_ENV_FILE || '/Users/baiagentbai/Documents/Repos/Bballi_Portfolio/.env.local';
export const REQUIRED_ENV = ['FIREBASE_ADMIN_PROJECT_ID', 'FIREBASE_ADMIN_CLIENT_EMAIL', 'FIREBASE_ADMIN_PRIVATE_KEY'];
export const CHAIN_LABEL_BASE = 'Clean-up + gentle hiss';

const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

// ---------- clip window ----------

/** Joins in OUTPUT time: cumulative keep-segment lengths at each interior boundary (not the final end). */
export function joinsFromKeep(keep) {
  const joins = [];
  let t = 0;
  const segs = keep || [];
  for (let i = 0; i < segs.length - 1; i++) {
    t += segs[i].endS - segs[i].startS;
    joins.push(round(t));
  }
  return joins;
}

/** Deterministic fraction in [0,1) from the first 8 hex chars of a seed (mulberry32 one step). */
export function seedFraction(seedHex) {
  const hex = String(seedHex || '').replace(/[^0-9a-f]/gi, '').slice(0, 8).padEnd(8, '0');
  let a = parseInt(hex, 16) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Remove forbidden [a,b] ranges from [lo,hi]; returns the remaining intervals (non-empty only). */
function subtractRanges(lo, hi, forbidden) {
  let free = [[lo, hi]];
  for (const [fa, fb] of forbidden) {
    const next = [];
    for (const [a, b] of free) {
      if (fb <= a || fa >= b) { next.push([a, b]); continue; }
      if (fa > a) next.push([a, fa]);
      if (fb < b) next.push([fb, b]);
    }
    free = next;
  }
  return free.filter(([a, b]) => b > a);
}

/**
 * Pick the review window. Candidate starts lie in [120, dur-180]; a start is rejected when the
 * 60 s window comes within 30 s of an interior join. Tapes under 6 min are centred (nudged to the
 * nearest join-free start). Same inputs always give the same answer.
 * @returns {{ startS: number, lengthS: number, joinFree: boolean }}
 */
export function pickClipWindow({ durationS, joinsS = [], seedHex = '' }) {
  const lengthS = Math.min(CLIP_LENGTH_S, Math.max(0, durationS));
  // start s is bad when [s, s+len] intersects (join-30, join+30)
  const forbidden = joinsS.map((j) => [j - JOIN_EXCLUDE_S - lengthS, j + JOIN_EXCLUDE_S]);
  const lastStart = durationS - lengthS - END_EXCLUDE_S;
  const normal = durationS >= HEAD_MARGIN_S + TAIL_MARGIN_S;

  if (normal) {
    const free = subtractRanges(HEAD_MARGIN_S, Math.max(HEAD_MARGIN_S, durationS - TAIL_MARGIN_S), forbidden);
    const total = free.reduce((s, [a, b]) => s + (b - a), 0);
    if (total > 0) {
      let pos = seedFraction(seedHex) * total;
      for (const [a, b] of free) {
        if (pos < b - a) return { startS: round(a + pos), lengthS, joinFree: true };
        pos -= b - a;
      }
    }
  }
  // short tape (or normal tape with no clean candidate): nearest join-free start to the centre
  const centre = Math.max(0, (durationS - lengthS) / 2);
  const free = subtractRanges(0, Math.max(0, lastStart), forbidden);
  if (!free.length) return { startS: round(centre), lengthS, joinFree: false };
  let best = null;
  for (const [a, b] of free) {
    const c = Math.min(Math.max(centre, a), b);
    if (best === null || Math.abs(c - centre) < Math.abs(best - centre)) best = c;
  }
  return { startS: round(best), lengthS, joinFree: true };
}

// ---------- ids / labels ----------

/** Lowercase [a-z0-9-] slug; collapses runs, trims dashes, falls back to "tape". */
export function slugify(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'tape';
}

/** reviewId = <stem slug>-<first 8 hex of trimmed sha256>. */
export function makeReviewId(stem, trimmedSha256) {
  const sha = String(trimmedSha256 || '').toLowerCase();
  if (!/^[0-9a-f]{8,}$/.test(sha)) throw new Error('trimmed sha256 is not a hex digest');
  return `${slugify(stem)}-${sha.slice(0, 8)}`;
}

export function reviewPrefix(reviewId) { return `${STORAGE_PREFIX}/${reviewId}`; }

/** Storage paths for both clips, keyed by chainHash so a re-restore never serves stale cached audio. */
export function storagePathsFor(reviewId, chainHash) {
  if (!/^[0-9a-f]{12}$/.test(String(chainHash || ''))) throw new Error('chainHash must be 12 hex chars');
  const base = `${reviewPrefix(reviewId)}/${chainHash}`;
  return { original: `${base}/original.m4a`, restored: `${base}/restored.m4a` };
}

/** Same URL format as api/_lib/storage-artifacts.cjs buildDownloadUrl. */
export function buildTokenUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

// ---------- ffmpeg ----------

/** Clip filter: optional gain, then 1 s fade in and fade out. */
export function clipFilter(gainDb, lengthS = CLIP_LENGTH_S) {
  const parts = [];
  if (gainDb) parts.push(`volume=${round(gainDb, 3)}dB`);
  parts.push(`afade=t=in:d=${FADE_S}`, `afade=t=out:st=${round(lengthS - FADE_S)}:d=${FADE_S}`);
  return parts.join(',');
}

/** Identical AAC encode args for both clips. */
export const AAC_ARGS = ['-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart'];

// ---------- env preflight ----------

/** Dotenv-style parse (KEY=value, optional quotes, # comments, `export ` prefix). Never throws. */
export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/**
 * Fail-closed credential check on an env-like object. Error messages name variables only, never values.
 * @returns {{ projectId: string, bucket: string }} safe-to-log identifiers
 */
export function preflightEnv(env) {
  const missing = REQUIRED_ENV.filter((k) => !env || !String(env[k] || '').trim());
  if (missing.length) throw new Error(`missing required env: ${missing.join(', ')}`);
  const pk = String(env.FIREBASE_ADMIN_PRIVATE_KEY).replace(/\\n/g, '\n');
  if (!pk.includes('-----BEGIN') || !pk.includes('PRIVATE KEY-----')) throw new Error('FIREBASE_ADMIN_PRIVATE_KEY is not a PEM private key; refusing');
  const projectId = String(env.FIREBASE_ADMIN_PROJECT_ID).trim();
  if (projectId !== EXPECTED_PROJECT_ID) throw new Error('FIREBASE_ADMIN_PROJECT_ID is not the expected production project; refusing');
  const bucket = String(env.FIREBASE_ADMIN_STORAGE_BUCKET || env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '').trim();
  if (!bucket) throw new Error('missing storage bucket env: FIREBASE_ADMIN_STORAGE_BUCKET or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
  if (bucket !== EXPECTED_BUCKET) throw new Error('storage bucket is not the expected production bucket; refusing');
  return { projectId, bucket };
}

// ---------- record ----------

export function chainLabelFor(steps) {
  return steps && steps.air === false ? CHAIN_LABEL_BASE : `${CHAIN_LABEL_BASE} + air`;
}

/**
 * Whitelisted Firestore record. Throws if any storage path is outside mixtape-reviews/<reviewId>/.
 * @param {object} a { reviewId, title, restore, trim, clip, gainsDb, urls, storagePaths, now (ISO) }
 */
export function buildReviewRecord({ reviewId, title, restore, trim, clip, gainsDb, urls, storagePaths, now }) {
  const prefix = `${reviewPrefix(reviewId)}/`;
  const paths = [storagePaths.original, storagePaths.restored];
  if (paths.some((p) => typeof p !== 'string' || !p.startsWith(prefix) || p.includes('..'))) {
    throw new Error('storage path outside the review prefix');
  }
  const cuts = trim.cuts || [];
  const stem = restore.source.trimmedName.replace(/\.trimmed\.[^.]+$/i, '');
  const d = restore.diagSummary || {};
  return {
    status: 'published',
    title: String(title || stem),
    tapeStem: stem,
    createdAt: now,
    publishedAt: now,
    durations: { originalS: round(trim.source?.durationS), trimmedS: round(restore.output.durationS) },
    cuts: {
      count: cuts.length,
      kinds: [...new Set(cuts.map((c) => c.kind))].sort(),
      removedS: round(cuts.reduce((s, c) => s + (c.endS - c.startS), 0)),
    },
    chainLabel: chainLabelFor(restore.steps),
    chain: restore.chain,
    diag: { balanceDb: d.balanceDb ?? null, humHz: d.humHz ?? null, rolloffHz: d.rolloffHz ?? null, lufs: d.integratedLufs ?? null },
    clip: { startS: clip.startS, lengthS: clip.lengthS, gainsDb: { original: round(gainsDb.original), restored: round(gainsDb.restored) } },
    urls: { original: urls.original, restored: urls.restored },
    storagePaths: paths,
    versions: { detector: trim.detectorVersion ?? null, render: trim.renderVersion ?? null, restore: restore.restoreVersion, publish: PUBLISH_VERSION },
    chainHash: restore.chainHash,
  };
}

/** Plain file name: no separators, not '.'/'..', no leading dot. */
export function isPlainBasename(n) {
  return typeof n === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_ .()+,-]{0,200}$/.test(n) && n !== '.' && n !== '..';
}

/** Basic shape check of restore.json against the contract; returns a list of problems. */
export function validateRestoreJson(r) {
  const bad = [];
  const need = (cond, what) => { if (!cond) bad.push(what); };
  need(r && typeof r === 'object', 'not an object');
  if (bad.length) return bad;
  need(typeof r.chain === 'string' && r.chain, 'chain');
  need(/^[0-9a-f]{12}$/.test(r.chainHash || ''), 'chainHash');
  need(Number.isFinite(r.restoreVersion), 'restoreVersion');
  need(r.source && /^[0-9a-f]{64}$/.test(r.source.trimmedSha256 || ''), 'source.trimmedName/trimmedSha256');
  need(r.source && isPlainBasename(r.source.trimmedName), 'source.trimmedName not a plain basename');
  need(r.source && isPlainBasename(r.source.trimJsonName), 'source.trimJsonName');
  need(r.output && isPlainBasename(r.output.name) && /^[0-9a-f]{64}$/.test(r.output.sha256 || ''), 'output.name/sha256');
  need(r.output && Number.isFinite(r.output.durationS), 'output.durationS');
  return bad;
}
