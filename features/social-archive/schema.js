// Social archive timeline — the ingest contract. PURE: no I/O, no network.
//
// Every adapter (Facebook / X / Instagram) emits RAW entry objects; `sanitizeEntry`
// is the ONLY place that turns a raw object into a stored one. See CONTRACT.md.
//
// Rules baked in here (owner decisions, 2026-10-08):
//  - A timestamp always carries its KIND (posted | taken | event | created) and SOURCE.
//    File dates (mtime, download time) are never a valid source.
//  - Only the owner's own words are stored, trimmed to TEXT_MAX. No DMs, no other people's content.
//  - `audience` gates reuse; `unknown` is treated as not-public by consumers.
import { createHash } from 'node:crypto';

export const PLATFORMS = ['facebook', 'x', 'instagram'];
export const ENTRY_KINDS = ['post', 'media', 'event', 'story', 'reel', 'comment'];
export const TS_KINDS = ['posted', 'taken', 'event', 'created'];
export const TS_CONFIDENCE = ['high', 'medium', 'low'];
export const AUDIENCES = ['public', 'friends', 'only-me', 'unknown'];
export const RELATION_TYPES = ['reply', 'quote', 'repost', 'crosspost'];
export const ADAPTER_VERSION = 1;
export const TEXT_MAX = 600;
export const MEDIA_MAX = 20;
export const LIST_MAX = 30;

// File-date style sources are forbidden as a timestamp source.
const FORBIDDEN_TS_SOURCE = /^(mtime|ctime|file-date|file-mtime|download|downloaded|capturedAt)$/i;

const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function slug(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'account';
}

/** Deterministic, idempotent id: re-importing the same archive yields the same ids. */
export function entryId({ platform, account, platformId }) {
  const h = createHash('sha1').update(String(platformId ?? '')).digest('hex').slice(0, 12);
  return `${platform}-${slug(account)}-${h}`;
}

/** 'YYYY-MM-DD' (UTC) of an ISO timestamp, or null when invalid. */
export function dayOf(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function isIsoDay(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayOf(`${v}T12:00:00Z`) === v;
}

const URL_RE = /https?:\/\/[^\s)>\]"']+/gi;
const TAG_RE = /(^|[^\w&])#([\p{L}\p{N}_]{1,60})/gu;
const MENTION_RE = /(^|[^\w])@([A-Za-z0-9_.]{1,30})/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function extractTextEntities(text) {
  const t = String(text || '');
  const uniq = (a) => [...new Set(a)].slice(0, LIST_MAX);
  return {
    hashtags: uniq([...t.matchAll(TAG_RE)].map((m) => m[2].toLowerCase())),
    mentions: uniq([...t.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase())),
    links: uniq((t.match(URL_RE) || []).map((u) => u.replace(/[.,;!?]+$/, ''))),
  };
}

/** Small deterministic style features (no model). Used for per-platform voice fingerprints. */
export function voiceFeatures(text) {
  const t = String(text || '').trim();
  const letters = t.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  const words = t ? t.split(/\s+/).length : 0;
  const first = t.replace(/^[^\p{L}\p{N}]+/u, '').charAt(0);
  return {
    len: t.length,
    words,
    caps: letters.length ? Math.round((upper.length / letters.length) * 100) / 100 : 0,
    emoji: (t.match(EMOJI_RE) || []).length,
    hashtags: (t.match(TAG_RE) || []).length,
    links: (t.match(URL_RE) || []).length,
    mentions: (t.match(MENTION_RE) || []).length,
    question: t.includes('?'),
    exclaim: t.includes('!'),
    lowerStart: first !== '' && first === first.toLowerCase() && first !== first.toUpperCase(),
  };
}

const posix = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

export function sanitizeMedia(m) {
  if (!m || typeof m !== 'object') return null;
  const relPath = posix(m.relPath ?? m.uri ?? m.path);
  if (!relPath || relPath.split('/').includes('..')) return null;
  const type = m.type === 'video' || /\.(mp4|mov|m4v|webm)$/i.test(relPath) ? 'video' : 'image';
  const out = { type, relPath: relPath.slice(0, 400) };
  const taken = Date.parse(m.takenAt || '');
  if (Number.isFinite(taken)) out.takenAt = new Date(taken).toISOString();
  return out;
}

/**
 * Raw -> stored entry, or null if it cannot be a valid timeline entry.
 * Returns `{ entry }` or `{ error }` so adapters can count rejects with reasons.
 */
export function sanitizeEntry(raw, { archiveName = '', adapterVersion = ADAPTER_VERSION } = {}) {
  if (!raw || typeof raw !== 'object') return { error: 'not-an-object' };
  if (!PLATFORMS.includes(raw.platform)) return { error: 'bad-platform' };
  const account = str(raw.account, 80);
  if (!account) return { error: 'missing-account' };
  const platformId = str(String(raw.platformId ?? ''), 200);
  if (!platformId) return { error: 'missing-platformId' };
  const ms = Date.parse(raw.ts || '');
  if (!Number.isFinite(ms)) return { error: 'bad-timestamp' };
  if (ms < Date.UTC(1990, 0, 1) || ms > Date.now() + 86_400_000) return { error: 'timestamp-out-of-range' };
  const tsKind = TS_KINDS.includes(raw.tsKind) ? raw.tsKind : null;
  if (!tsKind) return { error: 'bad-tsKind' };
  const tsSource = str(raw.tsSource, 60);
  if (!tsSource || FORBIDDEN_TS_SOURCE.test(tsSource)) return { error: 'bad-tsSource' };

  const ts = new Date(ms).toISOString();
  const fullText = String(raw.text ?? '').replace(/\r/g, '').trim();
  const text = fullText.slice(0, TEXT_MAX);
  const ents = extractTextEntities(fullText);
  const media = (Array.isArray(raw.media) ? raw.media : []).map(sanitizeMedia).filter(Boolean).slice(0, MEDIA_MAX);
  const rel = raw.relation && RELATION_TYPES.includes(raw.relation.type)
    ? { type: raw.relation.type, ...(raw.relation.targetId ? { targetId: str(String(raw.relation.targetId), 120) } : {}) }
    : null;
  const eng = raw.engagement && typeof raw.engagement === 'object' ? raw.engagement : null;
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : undefined);
  const engagement = eng
    ? Object.fromEntries(Object.entries({ likes: n(eng.likes), reposts: n(eng.reposts), comments: n(eng.comments), views: n(eng.views) }).filter(([, v]) => v !== undefined))
    : null;

  const entry = {
    id: entryId({ platform: raw.platform, account, platformId }),
    platform: raw.platform,
    account,
    platformId,
    kind: ENTRY_KINDS.includes(raw.kind) ? raw.kind : 'post',
    ts,
    day: dayOf(ts),
    tsKind,
    tsSource,
    tsConfidence: TS_CONFIDENCE.includes(raw.tsConfidence) ? raw.tsConfidence : 'medium',
    text,
    textTruncated: fullText.length > TEXT_MAX,
    hashtags: ents.hashtags,
    mentions: ents.mentions,
    links: ents.links,
    media,
    peopleTagged: (Array.isArray(raw.peopleTagged) ? raw.peopleTagged : []).map((p) => str(p, 80)).filter(Boolean).slice(0, LIST_MAX),
    audience: AUDIENCES.includes(raw.audience) ? raw.audience : 'unknown',
    voice: voiceFeatures(fullText),
    source: {
      archive: str(raw.source?.archive || archiveName, 120),
      file: str(raw.source?.file, 200),
      ...(raw.source?.exportedAt && Number.isFinite(Date.parse(raw.source.exportedAt)) ? { exportedAt: new Date(raw.source.exportedAt).toISOString() } : {}),
      adapterVersion,
    },
    linked: [],
  };
  if (raw.lang) entry.lang = str(raw.lang, 8);
  if (raw.album) entry.album = str(raw.album, 160);
  if (raw.place) entry.place = str(raw.place, 160);
  if (raw.permalink && /^https?:\/\//i.test(String(raw.permalink))) entry.permalink = String(raw.permalink).slice(0, 300);
  if (rel) entry.relation = rel;
  if (engagement && Object.keys(engagement).length) entry.engagement = engagement;
  return { entry };
}
