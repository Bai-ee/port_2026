// brief-fields.js — the internal "Video brief" panel on a calendar post, kept OUT of the public copy.
//
// OWNER RULE (2026-11-19): the video template and its production notes live in their own fields on the social_posts
// row, saved independently of the post copy, approval, rendering and publishing. A panel brief renders only after
// the owner sets its status to 'approved'; 'rendered' is set by the attach step, never by a caller.
//
// Row fields: videoBrief (the template text the renderer reads; same field attach.js already writes) and
// videoBriefMeta {status, assets[], shots, captions, audio, narration, updatedAt, updatedBy}.
// Pure: no Firestore, no network.

export const VIDEO_BRIEF_MAX = 8000;
export const BRIEF_NOTE_MAX = 4000;
export const BRIEF_ASSETS_MAX = 20;
export const BRIEF_STATUSES = ['draft', 'ready', 'approved', 'rendered'];
export const SETTABLE_STATUSES = ['draft', 'ready', 'approved'];

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'invalid-video-brief' });
const str = (v) => (v == null ? '' : String(v));

function note(key, v) {
  const s = str(v).replace(/\r\n?/g, '\n').trim();
  if (s.length > BRIEF_NOTE_MAX) throw bad(`${key} must be ${BRIEF_NOTE_MAX} characters or fewer.`);
  return s;
}

function assetList(v) {
  const list = Array.isArray(v) ? v : str(v).split(/\n+/);
  const out = list.map((x) => str(x).trim()).filter(Boolean);
  if (out.length > BRIEF_ASSETS_MAX) throw bad(`At most ${BRIEF_ASSETS_MAX} asset links.`);
  for (const a of out) if (a.length > 2000) throw bad('An asset link is too long.');
  return out;
}

/**
 * Merge a partial save onto the row's current brief. Returns { videoBrief, videoBriefMeta } where both are null when
 * the template is empty (that clears the panel and its publish guard). Throws 400 on bad input.
 * `allowApprove` false (the connector at tier 1) refuses status 'approved', because approving starts a render.
 */
export function mergeVideoBrief(post, input = {}, { by = null, now = new Date().toISOString(), allowApprove = true } = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  const cur = post?.videoBriefMeta && typeof post.videoBriefMeta === 'object' ? post.videoBriefMeta : {};
  const template = has('template') ? str(input.template).replace(/\r\n?/g, '\n').trim() : str(post?.videoBrief).trim();
  if (template.length > VIDEO_BRIEF_MAX) throw bad(`The video template must be ${VIDEO_BRIEF_MAX} characters or fewer.`);
  if (!template) return { videoBrief: null, videoBriefMeta: null };
  let status = has('status') ? str(input.status).trim() : (cur.status || 'draft');
  if (!SETTABLE_STATUSES.includes(status)) throw bad(`status must be one of ${SETTABLE_STATUSES.join(', ')}.`);
  if (status === 'approved' && !allowApprove && cur.status !== 'approved') throw Object.assign(new Error('Approving a video brief starts a render: approve it in the post\'s Video brief panel.'), { status: 403, code: 'brief-approve-owner-only' });
  // Any change to the template sends an approved brief back to review, so a render never uses text nobody approved.
  const templateChanged = template !== str(post?.videoBrief).trim();
  if (templateChanged && !has('status') && status === 'approved') status = 'ready';
  const narration = has('narration') ? (input.narration === null || input.narration === '' ? null : Boolean(input.narration === true || input.narration === 'true' || input.narration === 'on')) : (cur.narration ?? null);
  return {
    videoBrief: template,
    videoBriefMeta: {
      status,
      assets: has('assets') ? assetList(input.assets) : (Array.isArray(cur.assets) ? cur.assets : []),
      shots: has('shots') ? note('shots', input.shots) : str(cur.shots),
      captions: has('captions') ? note('captions', input.captions) : str(cur.captions),
      audio: has('audio') ? note('audio', input.audio) : str(cur.audio),
      narration,
      updatedAt: now,
      updatedBy: by ? String(by).slice(0, 200) : null,
    },
  };
}

/** A panel brief exists (videoBriefMeta set). Legacy rows (brief only in content, or moved by attach) have no meta. */
export const isPanelBrief = (post) => Boolean(post?.videoBriefMeta && typeof post.videoBriefMeta === 'object' && str(post.videoBrief).trim());

/** Panel brief still waiting for its video: blocks approval/publish. */
export const isPanelBriefPending = (post) => isPanelBrief(post) && post.videoBriefMeta.status !== 'rendered' && !post.mediaUrl;

/** Worker gate: a panel brief renders only once approved. Legacy briefs keep their old behaviour. */
export const panelBriefBlocksRender = (post) => isPanelBrief(post) && post.videoBriefMeta.status !== 'approved';

/** What the connector / editor read back. */
export function videoBriefView(post) {
  return {
    postId: post?.id || null,
    postStatus: post?.status || null,
    template: str(post?.videoBrief),
    meta: post?.videoBriefMeta || null,
    mediaUrl: post?.mediaUrl || null,
    renderState: post?.videoBriefStatus || null,
    revision: post?.revision ?? null,
  };
}
