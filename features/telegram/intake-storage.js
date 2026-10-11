// intake-storage.js — storage + library-registration adapter for Telegram intake.
//
// Lands bytes in the HITLOOP default bucket under `publish-staging/telegram/...`
// (the prefix the Library's media-url resolver already understands) and registers
// ONE ContentPackage per intake in `x_content_packages` — the same collection the
// X Content Engine Library tab reads. Pure of globals: bucket, registerAsset and
// db are injected. Production binding for registerAsset:
//   (pkg) => upsertPackage(pkg, { returnPackages: false })   // x-content-inventory/store.js
//
// Possession is not clearance: rows are written with rights 'client-approval-needed'
// + approval {state:'needed'} and `rightsDeclared:'unknown'`. Nothing here remixes,
// analyses, or posts.

import { createHash } from 'node:crypto';

export const MB = 1024 * 1024;
export const TELEGRAM_GET_FILE_LIMIT = 20 * MB;
export const DEFAULT_CAPS = { imageBytes: 20 * MB, videoBytes: 20 * MB };
export const STORAGE_PREFIX = 'publish-staging/telegram';
export const STORY_PLACEHOLDER = '[add your memory]';

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'm4v ', 'mmp4', 'f4v ']);
const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
};

/** Content type from magic bytes only (never trust Telegram's mime or file name). */
export function sniffContentType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (brand === 'qt  ') return 'video/quicktime';
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (MP4_BRANDS.has(brand)) return 'video/mp4';
  }
  return null;
}

export const kindOf = (contentType) => (String(contentType || '').startsWith('video/') ? 'video' : 'image');

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clean = (o) => JSON.parse(JSON.stringify(o)); // drops undefined (Firestore rejects it)

/**
 * @param {{ bucket: {file(path):{save(buf,opts):Promise<void>}}, registerAsset: (pkg:object)=>Promise<any>, db?: object, caps?: {imageBytes:number, videoBytes:number} }} deps
 */
export function createIntakeStorage({ bucket, registerAsset, db = null, caps = {} } = {}) {
  if (!bucket || typeof bucket.file !== 'function') throw new Error('bucket with file() is required');
  if (typeof registerAsset !== 'function') throw new Error('registerAsset is required');
  const limits = { ...DEFAULT_CAPS, ...caps };

  /** Validate + sniff. Returns {ok, contentType, kind} | {ok:false, reason}. */
  function inspect(buffer) {
    if (!buffer || !buffer.length) return { ok: false, reason: 'empty-file' };
    const contentType = sniffContentType(buffer);
    if (!contentType) return { ok: false, reason: 'unsupported-type' };
    const kind = kindOf(contentType);
    const cap = kind === 'video' ? limits.videoBytes : limits.imageBytes;
    if (buffer.length > cap) return { ok: false, reason: 'too-large' };
    return { ok: true, contentType, kind };
  }

  /** Deterministic path: a retry overwrites the same object instead of orphaning a new one. */
  function pathFor({ clientId, intakeId, index, fileUniqueId, contentType }) {
    const safe = String(fileUniqueId || index).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || String(index);
    return `${STORAGE_PREFIX}/${clientId}/${intakeId}/${index}-${safe}.${EXT[contentType] || 'bin'}`;
  }

  async function store({ clientId, intakeId, index, fileUniqueId, buffer }) {
    const verdict = inspect(buffer);
    if (!verdict.ok) return verdict;
    const storagePath = pathFor({ clientId, intakeId, index, fileUniqueId, contentType: verdict.contentType });
    await bucket.file(storagePath).save(buffer, { resumable: false, contentType: verdict.contentType });
    return {
      ok: true,
      storagePath,
      contentType: verdict.contentType,
      kind: verdict.kind,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    };
  }

  /** Build the Library row for an intake. Exported for tests / the continuation route. */
  function buildPackage(intake) {
    const assets = (intake.items || []).filter((i) => i.status === 'stored');
    const kinds = new Set(assets.map((a) => a.kind));
    const caption = str(intake.context?.caption);
    const note = str(intake.context?.note);
    const title = caption ? caption.slice(0, 80) : `Telegram upload (${assets.length} ${kinds.has('video') && !kinds.has('image') ? 'video' : 'item'}${assets.length === 1 ? '' : 's'})`;
    return clean({
      id: `tg-${intake.id}`,
      series: 'C6',
      engine: 'client',
      pillar: 'building-now',
      title,
      story: STORY_PLACEHOLDER,
      assetRefs: assets.map((a) => a.storagePath),
      mediaState: kinds.has('video') ? 'video' : 'still',
      effort: '10-min',
      rights: 'client-approval-needed',
      rightsDeclared: 'unknown',
      approval: { state: 'needed' },
      platforms: ['x'],
      cta: null,
      entities: [],
      status: 'idea',
      lastPostedAt: null,
      postCount: 0,
      source: { kind: 'manual' },
      clientId: intake.clientId,
      context: { caption: caption || undefined, note: note || undefined, treatAs: 'data' },
      provenance: {
        transport: 'telegram',
        chatId: intake.chatId,
        messageId: intake.messageIds?.[0] ?? null,
        messageIds: intake.messageIds || [],
        mediaGroupId: intake.mediaGroupId || null,
        intakeId: intake.id,
        assets: assets.map((a) => ({
          fileUniqueId: a.fileUniqueId, messageId: a.messageId, storagePath: a.storagePath,
          contentType: a.contentType, bytes: a.bytes, sha256: a.sha256,
        })),
      },
    });
  }

  /** Idempotent: same intake id => same package id (upsert merges). */
  async function register(intake) {
    const pkg = buildPackage(intake);
    if (!pkg.assetRefs.length) throw new Error('nothing stored to register');
    await registerAsset(pkg);
    return { packageId: pkg.id, pkg };
  }

  return { inspect, store, register, buildPackage, caps: limits, db };
}
