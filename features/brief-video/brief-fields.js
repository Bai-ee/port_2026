// brief-fields.js — the internal "Video brief" panel on a calendar post, kept OUT of the public copy.
//
// OWNER RULE (2026-11-19): the video template and its production notes live in their own fields on the social_posts
// row, saved independently of the post copy, approval, rendering and publishing. A panel brief renders only after
// the owner sets its status to 'approved'; 'rendered' is set by the attach step, never by a caller.
//
// Row fields: videoBriefMeta.creative (the owner's Creative Brief text, <= 8000), videoBrief (the line the renderer reads:
// the creative text until a CQ brief is authored, then `howto=<id>`; same field attach.js already writes) and
// videoBriefMeta {creative, creativeRev, status, assets[], shots, captions, audio, narration, authored?, authorError?, updatedAt, updatedBy}.
// Rows saved before the split have no meta.creative: their videoBrief text is the creative.
// v2 (features/brief-video/brief-v2.js): videoBriefMeta.v2 + briefVersion 2 + storyboard; `creative` is then a text rendering of v2.
// Pure: no Firestore, no network.

export const VIDEO_BRIEF_MAX = 8000;
export const BRIEF_NOTE_MAX = 4000;
export const BRIEF_ASSETS_MAX = 20;
export const BRIEF_STATUSES = ['draft', 'ready', 'approved', 'rendered'];
export const SETTABLE_STATUSES = ['draft', 'ready', 'approved'];

import { classifyBrief } from './brief.js';
import { HOWTO_ALLOWED_CLIENTS } from './howto-request.js';
import { normalizeV2, assertV2Ready, v2Missing, renderV2Text, sameV2, newStoryboard, isV2Meta, isV2Brief } from './brief-v2.js';

export { isV2Brief };

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'invalid-video-brief' });
const str = (v) => (v == null ? '' : String(v));

/** The owner's Creative Brief text of a row (back-compat: meta without .creative means videoBrief is the creative). */
export const creativeOf = (post) => (typeof post?.videoBriefMeta?.creative === 'string' ? post.videoBriefMeta.creative : str(post?.videoBrief)).trim();

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
  const curCreative = creativeOf(post);
  const cV2 = isV2Meta(cur) ? cur.v2 : null;
  const v2 = has('v2') ? (input.v2 == null ? null : normalizeV2(input.v2)) : cV2;
  const v2Changed = has('v2') && !sameV2(v2, cV2);
  const rendered = v2 && (v2Changed || !curCreative) ? renderV2Text(v2) : null;
  const creative = has('template') ? str(input.template).replace(/\r\n?/g, '\n').trim() : (rendered ?? curCreative);
  if (creative.length > VIDEO_BRIEF_MAX) throw bad(`The Creative Brief must be ${VIDEO_BRIEF_MAX} characters or fewer.`);
  if (!creative) return { videoBrief: null, videoBriefMeta: null };
  let status = has('status') ? str(input.status).trim() : (cur.status || 'draft');
  if (!SETTABLE_STATUSES.includes(status)) throw bad(`status must be one of ${SETTABLE_STATUSES.join(', ')}.`);
  if (status === 'approved' && !allowApprove && cur.status !== 'approved') throw Object.assign(new Error('Approving a video brief starts a render: approve it in the post\'s Video brief panel.'), { status: 403, code: 'brief-approve-owner-only' });
  // A v2 brief can be a draft with empty fields, but only a complete one can be 'ready' / 'approved' (forces the writer to fill it).
  // An edit that leaves a ready/approved v2 brief incomplete (no explicit status) drops it back to draft instead of failing the save.
  if (v2 && (status === 'ready' || status === 'approved')) {
    // The post's own copy feeds the format/topic-fit rule; it is only READ here, never written (the patch below never carries `content`).
    const gate = { postContent: post?.content };
    if (has('status')) assertV2Ready(v2, gate);
    else if (v2Changed && v2Missing(v2, gate).length) status = 'draft';
  }
  // Any change to the creative sends an approved brief back to review, so a render never uses text nobody approved.
  // A changed creative also drops the authored machine line (videoBrief goes back to the creative text until re-authored).
  const creativeChanged = creative !== curCreative;
  if (creativeChanged && !has('status') && status === 'approved') status = 'ready';
  const machine = str(post?.videoBrief).trim();
  const narration = has('narration') ? (input.narration === null || input.narration === '' ? null : Boolean(input.narration === true || input.narration === 'true' || input.narration === 'on')) : (cur.narration ?? null);
  // Storyboard (v2 only): created 'pending' when the brief is approved; any change to the v2 brief sends it back to 'pending'.
  let storyboard = v2 && cur.storyboard && typeof cur.storyboard === 'object' ? cur.storyboard : null;
  if (v2 && !storyboard && status === 'approved') storyboard = newStoryboard({ now, by });
  else if (storyboard && v2Changed && storyboard.status !== 'pending') storyboard = { ...storyboard, status: 'pending', episode: null, updatedAt: now, updatedBy: by ? String(by).slice(0, 200) : null };
  return {
    videoBrief: !creativeChanged && machine ? machine : creative,
    videoBriefMeta: {
      creative,
      creativeRev: (Number(cur.creativeRev) || 1) + (creativeChanged && curCreative ? 1 : 0),
      ...(v2 ? { briefVersion: 2, v2 } : {}),
      ...(storyboard ? { storyboard } : {}),
      ...(cur.directorRequestId ? { directorRequestId: cur.directorRequestId } : {}),
      ...(cur.authored ? { authored: cur.authored } : {}),
      ...(cur.authorError && !creativeChanged ? { authorError: cur.authorError } : {}),
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

/**
 * A CQ Creative Brief (or a how-to written as prose) whose machine line is not yet a valid `howto=<id>`: it must be authored into a
 * request first and may NEVER fall back to the free-text BriefCut renderer. Allowlisted (CQ) clients only.
 */
export function panelBriefNeedsAuthoring(post) {
  if (isV2Brief(post)) return false; // v2 goes to a storyboard, never to the clip author
  if (!HOWTO_ALLOWED_CLIENTS.includes(post?.clientId) || !isPanelBrief(post)) return false;
  if (classifyBrief(str(post.videoBrief)).kind === 'howto') return false;
  const creative = creativeOf(post);
  const kind = classifyBrief(creative);
  if (kind.kind === 'howto') return false;
  return /^\s*[*_#\s-]*creative id\b/im.test(creative) || kind.reason === 'howto-prose-needs-request';
}

/** Worker gate: a panel brief renders only once approved (and, for a CQ Creative Brief, authored). Legacy briefs keep their old behaviour. */
// A v2 brief never renders from here: approval leads to a storyboard. HOOK (not implemented): a later explicit flag
// `videoBriefMeta.directorRequestId` (set when the Director has produced a request for an approved storyboard) will lift this block.
export const panelBriefBlocksRender = (post) => isPanelBrief(post) && (isV2Brief(post) || post.videoBriefMeta.status !== 'approved' || panelBriefNeedsAuthoring(post));

/** What the connector / editor read back. */
export function videoBriefView(post, { episodeVideoUrl = null } = {}) {
  return {
    postId: post?.id || null,
    postStatus: post?.status || null,
    template: creativeOf(post),
    videoBrief: str(post?.videoBrief),
    meta: post?.videoBriefMeta || null,
    briefVersion: isV2Brief(post) ? 2 : 1,
    v2: isV2Brief(post) ? post.videoBriefMeta.v2 : null,
    storyboard: isV2Brief(post) ? (post.videoBriefMeta.storyboard || null) : null,
    episodeVideoUrl: episodeVideoUrl || null, // derived server-side from the episode's storage object (route), never from the stored episode
    mediaUrl: post?.mediaUrl || null,
    posterUrl: post?.posterUrl || null,
    renderState: post?.videoBriefStatus || null,
    revision: post?.revision ?? null,
  };
}
