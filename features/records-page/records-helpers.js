// Pure helpers for the public /records page: stats aggregation, showcase
// selection and waitlist validation. No I/O, so they are unit-testable.

export const PACKAGE_PREFIX = 'discogs-';
export const DISCOGS_SOURCE = 'discogs-ingest';
export const MEMORY_PLACEHOLDER = '[add your memory]';

export const WAITLIST_ROLES = ['collector', 'dj', 'label', 'shop', 'other'];
export const WAITLIST_SIZES = ['<100', '100-1k', '1k-10k', '10k+'];

/** Count of video variants stored on a post (1:1 / 9:16), at least 1 when a main video exists. */
function clipCount(post) {
  const variants = post?.mediaVariants?.video;
  const n = variants && typeof variants === 'object'
    ? Object.values(variants).filter((v) => v && v.url).length
    : 0;
  if (n > 0) return n;
  return post?.mediaType === 'video' && post?.mediaUrl ? 1 : 0;
}

/**
 * Aggregate counts only. Never returns text, URLs or identifiers.
 * packages: [{ id, status }]; posts: [{ status, mediaType, mediaVariants, postedAt }].
 */
export function aggregateStats(packages = [], posts = []) {
  const pkgs = packages.filter((p) => typeof p?.id === 'string' && p.id.startsWith(PACKAGE_PREFIX));
  const byPackageStatus = {};
  for (const p of pkgs) {
    const s = String(p.status || 'idea');
    byPackageStatus[s] = (byPackageStatus[s] || 0) + 1;
  }
  const discogsPosts = posts.filter((p) => p?.source === undefined || p.source === DISCOGS_SOURCE);
  const byPostStatus = { draft: 0, scheduled: 0, posted: 0 };
  let clipsRendered = 0;
  let lastProcessedAt = null;
  for (const p of discogsPosts) {
    const s = String(p.status || 'draft');
    if (s === 'posted') byPostStatus.posted += 1;
    else if (s === 'scheduled' || s === 'posting') byPostStatus.scheduled += 1;
    else byPostStatus.draft += 1;
    clipsRendered += clipCount(p);
    for (const t of [p.createdAt, p.updatedAt]) {
      const ms = Date.parse(t);
      if (Number.isFinite(ms) && (lastProcessedAt === null || ms > lastProcessedAt)) lastProcessedAt = ms;
    }
  }
  return {
    recordsProcessed: pkgs.length,
    addedToDiscogs: pkgs.length,
    clipsRendered,
    postsPublished: byPostStatus.posted,
    postsScheduled: byPostStatus.scheduled,
    postsDrafted: byPostStatus.draft,
    packagesByStatus: byPackageStatus,
    lastProcessedAt: lastProcessedAt === null ? null : new Date(lastProcessedAt).toISOString(),
  };
}

function parseHead(content) {
  const lines = typeof content === 'string' ? content.split('\n') : [];
  const head = (lines[0] || '').trim();
  const meta = lines[1] && lines[1].includes(' · ') ? lines[1].trim() : '';
  return { head, meta };
}

/** Owner story from builder-shaped text; null when empty or still the placeholder. */
export function storyFromContent(content) {
  if (typeof content !== 'string' || content.toLowerCase().includes(MEMORY_PLACEHOLDER)) return null;
  const lines = content.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i >= lines.length || !lines[i].includes(' – ')) return null;
  i += 1;
  while (i < lines.length && lines[i].trim() === '') i += 1;
  if (i < lines.length && lines[i].includes(' · ')) i += 1;
  return lines.slice(i).join('\n').trim() || null;
}

export function xStatusUrl(post) {
  const id = post?.twitterId;
  return post?.status === 'posted' && id && /^\d+$/.test(String(id)) ? `https://x.com/i/status/${id}` : null;
}

/**
 * Showcase cards. Eligible: post status 'posted' OR package.showcase === true.
 * Only public fields leave this function.
 */
export function buildShowcase(packages = [], posts = [], limit = 12) {
  const pkgById = new Map(packages.map((p) => [p?.id, p]));
  const cards = [];
  for (const post of posts) {
    const releaseId = post?.sourceRef?.releaseId;
    if (releaseId == null) continue;
    const pkg = pkgById.get(`${PACKAGE_PREFIX}${releaseId}`) || null;
    const posted = post.status === 'posted';
    if (!posted && pkg?.showcase !== true) continue;
    const video = post.mediaVariants?.video?.['1x1']?.url || (post.mediaType === 'video' ? post.mediaUrl : null);
    if (!video) continue;
    const { head, meta } = parseHead(post.content);
    const title = head.includes(' – ') ? head : (pkg?.title || head);
    if (!title) continue;
    const [artist, ...rest] = title.split(' – ');
    const story = (pkg?.story && pkg.story.trim() && !pkg.story.toLowerCase().includes(MEMORY_PLACEHOLDER))
      ? pkg.story.trim()
      : storyFromContent(post.content);
    cards.push({
      releaseId,
      artist: artist.trim(),
      title: rest.join(' – ').trim(),
      meta: meta || '',
      story,
      videoUrl: video,
      labelImageUrl: post.mediaVariants?.image?.['1x1']?.url || post.selfReply?.mediaUrl || null,
      discogsUrl: post.sourceRef?.discogsUrl || null,
      xUrl: xStatusUrl(post),
      sortAt: Date.parse(post.postedAt || post.updatedAt || '') || 0,
    });
  }
  cards.sort((a, b) => b.sortAt - a.sortAt);
  return cards.slice(0, limit).map(({ sortAt, ...c }) => c);
}

// ── Waitlist ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Validate + normalise a waitlist submission.
 * Returns { ok:true, value } | { ok:false, error } | { ok:true, honeypot:true } (silent drop).
 */
export function parseWaitlistBody(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (clean(b.website, 200)) return { ok: true, honeypot: true };
  const email = clean(b.email, 254).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };
  const role = clean(b.role, 20).toLowerCase();
  const size = clean(b.collectionSize, 20).toLowerCase().replace(/[–—]/g, '-');
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    const v = clean(b.utm?.[k], 100);
    if (v) utm[k] = v;
  }
  return {
    ok: true,
    value: {
      email,
      name: clean(b.name, 120),
      role: WAITLIST_ROLES.includes(role) ? role : '',
      collectionSize: WAITLIST_SIZES.includes(size) ? size : '',
      discogsUsername: clean(b.discogsUsername, 80).replace(/^@/, ''),
      note: String(b.note ?? '').replace(/\r/g, '').trim().slice(0, 1000),
      utm,
    },
  };
}

/** Stable Firestore doc id for an email (dedupe key). */
export function waitlistDocId(email) {
  return encodeURIComponent(email).replace(/\./g, '%2E').slice(0, 300);
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formulas
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const WAITLIST_CSV_COLUMNS = ['email', 'name', 'role', 'collectionSize', 'discogsUsername', 'note', 'createdAt', 'updatedAt', 'submissions'];

export function waitlistToCsv(rows = []) {
  const lines = [WAITLIST_CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(WAITLIST_CSV_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\n');
}

/** "3 min ago" style label. */
export function relativeTime(iso, now = Date.now()) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return null;
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}
