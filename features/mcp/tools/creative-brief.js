// creative-brief.js - owner review of a v2 Creative Brief from the MCP: read every phase (brief, Director verdict, storyboard
// frames, episode, attached video + download link) and decide each phase (brief / storyboard / video) without the dashboard.
//
// OWNER RULE (2026-11-21): once the Director has accepted the CURRENT brief version, every phase can be approved here. The
// social-posting route enforces it (features/brief-video/owner-review.js): Director gate on approves, the revision the caller
// read, and the episode / video version shown. Calls the route in-process with the owner's session (../ops/dashboard-route.js),
// so the route keeps its own checks. Not logged in the Strategy action log and no Undo: say so to the owner.

import { ToolError } from '../jsonrpc.js';
import { callDashboardRoute } from '../ops/dashboard-route.js';
import { defTool, str, resolveClientId, CLIENT_ID_PROP } from './common.js';

const PATH = '/api/social-posting';
const loadRoute = (ctx) => (ctx.services?.socialPostingRoute ? ctx.services.socialPostingRoute() : import('../../../app/api/social-posting/route.js'));

async function post(ctx, clientId, body) {
  const route = await loadRoute(ctx);
  const { status, json } = await callDashboardRoute(ctx, { route, path: PATH, body, clientId });
  return { status, json: json || {} };
}

const fail = (status, json) => new ToolError(`${json.error || `Refused (${status}).`}${json.code ? ` [${json.code}]` : ''}`);

/** What the owner needs to decide, trimmed from the route's brief view. */
export function shapeBrief(b, download) {
  const sb = b.storyboard || null;
  const ep = sb?.episode || null;
  const dn = b.directorNotes || null;
  return {
    postId: b.postId,
    postStatus: b.postStatus,
    revision: b.revision,
    briefVersion: b.briefVersion,
    briefStatus: b.meta?.status || null,
    title: b.v2?.title || null,
    creative: b.template || null,
    directorNotes: dn ? { status: dn.status, current: Boolean(dn.briefHash) && !dn.stale, notes: dn.notes, items: dn.items, at: dn.at } : null,
    storyboard: sb ? {
      status: sb.status,
      outline: sb.outline || null,
      notes: sb.notes || null,
      frames: (sb.frames || []).map((f, i) => ({ index: i, label: f.label, imageUrl: f.url, note: f.note || null })),
      episode: ep ? { outlineHash: ep.outlineHash || null, storagePath: ep.storagePath || null, previewUrl: b.episodeVideoUrl || null } : null,
    } : null,
    videoReview: b.meta?.videoReview || null,
    attachedVideo: download && !download.preview ? download : null,
    download: download || null,
  };
}

/** The next decision the owner can take, in plain words (advice only; the route decides). */
export function nextStep(s) {
  if (s.briefVersion !== 2) return 'This is not a v2 Creative Brief; review it in HITLOOP.';
  const accepted = s.directorNotes?.status === 'accepted' && s.directorNotes.current;
  if (s.briefStatus !== 'approved' && s.briefStatus !== 'rendered') return accepted ? 'Approve the brief: step "brief".' : 'Waiting for the Director to accept this brief version.';
  if (!s.storyboard || s.storyboard.status === 'pending') return 'Waiting for the Director\'s storyboard.';
  if (s.storyboard.status === 'ready') return s.storyboard.episode ? 'Review the storyboard: step "storyboard" (approve attaches the episode video).' : 'Storyboard is ready but has no rendered episode yet; you can request changes.';
  if (s.attachedVideo && s.videoReview?.status !== 'approved') return 'Review the attached video: step "video".';
  if (s.videoReview?.status === 'approved') return 'Video approved. Schedule the post in HITLOOP when ready.';
  return `Storyboard is ${s.storyboard.status}.`;
}

const getTool = defTool({
  name: 'creative_brief_get',
  title: 'Read a Creative Brief (all phases)',
  description: 'Read one calendar post\'s v2 Creative Brief with everything needed to review it from here: revision, brief status, creative text, the Director\'s verdict (directorNotes: status, current = verdict is for the saved version, notes, items), the storyboard (status, outline, frames with imageUrl + note, episode outlineHash/storagePath/previewUrl), the video review, the attached video and a downloadable link (download.video.downloadUrl). Also returns nextStep. Pass the returned revision (and episode / video fields) to creative_brief_review. Read-only.',
  inputSchema: { type: 'object', properties: { clientId: CLIENT_ID_PROP, postId: str('The calendar post id (social_...).') }, required: ['postId'] },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const postId = String(args.postId || '').trim();
    if (!postId) throw new ToolError('postId is required.');
    const got = await post(ctx, clientId, { action: 'video-brief-get', postId });
    if (got.status >= 400 || !got.json.ok) throw fail(got.status, got.json);
    const dl = await post(ctx, clientId, { action: 'video-brief-download', postId });
    const shaped = shapeBrief(got.json.brief || {}, dl.status < 400 && dl.json.ok ? dl.json.video : null);
    return { clientId, ...shaped, nextStep: nextStep(shaped) };
  },
});

const reviewTool = defTool({
  name: 'creative_brief_review',
  title: 'Decide a Creative Brief phase',
  kind: 'write',
  description: 'The owner\'s decision on ONE phase of a v2 Creative Brief, without the dashboard. WRITES to the draft (never schedules or publishes). Call creative_brief_get first and pass its revision as expectedRevision. step "brief": approve only (brief changes go through the brief writer). step "storyboard": approve (pass episode outlineHash + storagePath from creative_brief_get; attaches the episode video to the draft and returns its downloadUrl) or changes (notes and/or frameNotes {"0": "..."}). step "video": approve or changes (notes, optional atSeconds); pass attachedVideo.v + attachedVideo.outlineHash. Every approve requires the Director to have accepted the CURRENT brief version, else it is refused. Not undoable from the MCP: use HITLOOP to revert.',
  inputSchema: {
    type: 'object',
    properties: {
      clientId: CLIENT_ID_PROP,
      postId: str('The calendar post id.'),
      step: { type: 'string', enum: ['brief', 'storyboard', 'video'], description: 'Which phase.' },
      decision: { type: 'string', enum: ['approve', 'changes'], description: 'approve | changes.' },
      expectedRevision: { type: 'integer', description: 'The revision returned by creative_brief_get.' },
      notes: str('What should change (changes).', { maxLength: 2000 }),
      frameNotes: { type: 'object', description: 'Storyboard changes per frame: {"<0-based index>": "note"}.', additionalProperties: { type: 'string', maxLength: 1000 } },
      outlineHash: str('storyboard approve: storyboard.episode.outlineHash. video: attachedVideo.outlineHash.'),
      storagePath: str('storyboard approve: storyboard.episode.storagePath.'),
      v: { type: 'integer', description: 'video: attachedVideo.v.' },
      atSeconds: { type: 'number', description: 'video changes: where in the video.' },
    },
    required: ['postId', 'step', 'decision', 'expectedRevision'],
  },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const body = { action: 'video-brief-owner-review', postId: String(args.postId || '').trim() };
    for (const k of ['step', 'decision', 'expectedRevision', 'notes', 'frameNotes', 'outlineHash', 'storagePath', 'v', 'atSeconds']) if (args[k] !== undefined) body[k] = args[k];
    const { status, json } = await post(ctx, clientId, body);
    if (status >= 400 || !json.ok) throw fail(status, json);
    const shaped = shapeBrief(json.brief || {}, json.video || null);
    return { clientId, step: json.step, decision: json.decision, revision: json.post?.revision ?? null, download: json.video || null, state: shaped, nextStep: nextStep(shaped), undo: 'Not undoable from the MCP; revert in HITLOOP.' };
  },
});

export const creativeBriefTools = Object.freeze([getTool, reviewTool]);
