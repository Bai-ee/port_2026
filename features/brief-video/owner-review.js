// owner-review.js — owner decisions on a v2 Creative Brief from outside the dashboard (the MCP), one explicit step at a time.
//
// OWNER RULE (2026-11-21): once the Director has accepted the current brief version, the owner may approve every phase
// (brief, storyboard, video) from the MCP; no dashboard confirm card. Guards, all enforced on the server:
//  - approve needs directorAcceptedCurrent(post) (accepted verdict whose briefHash is the saved v2's hash);
//  - every decision pins the revision the caller viewed (expectedRevision required, must equal the row's revision);
//  - a storyboard approve pins the episode shown (outlineHash + storagePath, the versioned -vNN.mp4) and needs a ready storyboard WITH a rendered episode;
//  - a video decision pins the attached version (v + outlineHash), checked again by applyVideoReview.
// 'changes' (owner notes) needs no Director gate. Brief 'changes' has no backing action: notes go through the writer.
// Pure: no Firestore, no network.

import { directorAcceptedCurrent } from './director-notes.js';
import { attachedVersion } from './video-review.js';

export const OWNER_REVIEW_STEPS = ['brief', 'storyboard', 'video'];
export const OWNER_REVIEW_DECISIONS = ['approve', 'changes'];

const fail = (message, status, code) => Object.assign(new Error(message), { status, code });

/** Throws (400/409) when the decision may not run; returns the normalised { step, decision, revision }. */
export function checkOwnerReview(post, { step, decision, expectedRevision, outlineHash, storagePath } = {}) {
  const s = String(step || '').trim();
  const d = String(decision || '').trim();
  if (!OWNER_REVIEW_STEPS.includes(s)) throw fail('step must be brief, storyboard or video.', 400, 'invalid-step');
  if (!OWNER_REVIEW_DECISIONS.includes(d)) throw fail('decision must be approve or changes.', 400, 'invalid-decision');
  if (!post) throw fail('Post not found.', 404, 'not-found');
  if (post.status !== 'draft') throw fail(`Only a draft's Creative Brief can be reviewed (this post is ${post.status}).`, 409, 'not-draft');
  if (Number(post.videoBriefMeta?.briefVersion) !== 2) throw fail('Only a v2 Creative Brief can be reviewed from the MCP.', 409, 'not-v2');
  if (expectedRevision == null || expectedRevision === '' || !Number.isFinite(Number(expectedRevision))) {
    throw fail('expectedRevision is required: read the brief first (creative_brief_get) and pass its revision.', 400, 'revision-required');
  }
  if (Number(expectedRevision) !== (post.revision || 0)) throw fail('The post changed since you read it. Read it again and review the current version.', 409, 'revision-conflict');
  if (s === 'brief' && d === 'changes') throw fail('Brief changes go through the brief writer (re-save the brief); there is no owner change note for a brief.', 400, 'brief-changes-unsupported');
  if (d === 'approve' && !directorAcceptedCurrent(post)) {
    throw fail('The Director has not accepted this version of the brief yet, so it cannot be approved from the MCP.', 409, 'director-not-accepted');
  }
  const sb = post.videoBriefMeta?.storyboard || null;
  if (s === 'storyboard') {
    if (!sb || sb.status !== 'ready') throw fail(`There is no storyboard waiting for review (storyboard is ${sb?.status || 'missing'}).`, 409, 'storyboard-not-ready');
    if (d === 'approve') {
      const ep = sb.episode;
      if (!ep) throw fail('The storyboard has no rendered episode yet, so there is no video to approve.', 409, 'no-episode');
      if (!outlineHash || !storagePath || String(outlineHash) !== String(ep.outlineHash || '') || String(storagePath) !== String(ep.storagePath || '')) {
        throw fail('The storyboard episode changed since you viewed it (pass the outlineHash and storagePath you were shown). Read it again.', 409, 'episode-changed');
      }
    }
  }
  if (s === 'brief' && post.videoBriefMeta?.status === 'rendered') throw fail('This brief is already rendered.', 409, 'already-rendered');
  return { step: s, decision: d, revision: post.revision || 0 };
}

/** The downloadable video on a post (server-derived mediaUrl: the versioned -vNN.mp4 the attach resolved), else null. */
export function attachedVideoOf(post) {
  if (!post?.mediaUrl || post.mediaType !== 'video') return null;
  return { downloadUrl: post.mediaUrl, posterUrl: post.posterUrl || null, storagePath: post.mediaStoragePath || null, v: attachedVersion(post), outlineHash: post.mediaMetadata?.outlineHash || null };
}
