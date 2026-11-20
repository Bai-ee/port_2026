// brief-context.js — everything ChatGPT needs to write a Critters Quest Creative Brief, served by the MCP tool
// queue.post.video-brief.context (social-posting action `video-brief-context`): the v2 template doc, the vendored scene/lesson
// library, the recent episodes to avoid repeating, the campaign + rules, and (with a postId) that post. Read only.
// IO is injected (readTemplateDoc, readPost, readPosts, readJobs) so the shape is testable without Firestore.

import fs from 'node:fs';
import path from 'node:path';
import { videoBriefView } from './brief-fields.js';
import { READY_RULES, FIRST_TIME_RIGHT } from './brief-v2.js';
import LIBRARY from './howto-catalog/cq-library.json' with { type: 'json' }; // static JSON imports (no createRequire: it broke the build before)
import STANDARD from './howto-catalog/cq-brief-standard.json' with { type: 'json' };

export { FIRST_TIME_RIGHT };

export const TEMPLATE_DOC_PATH = 'docs/source-of-truth/CQ-CREATIVE-BRIEF-TEMPLATE.md';
export const RECENT_EPISODES_MAX = 10;
export const RECENT_POSTS_READ = 60; // bounded newest-first read of the client's posts; never a collection scan
export const RECENT_JOBS_READ = 40;
const str = (v) => (v == null ? '' : String(v));
const cut = (v, n) => str(v).slice(0, n);

export const loadLibrary = () => LIBRARY;
/** The owner brief standard (first-time-right items, writing rules, the gold "Keeps moving" example) as text. */
export const loadBriefStandard = () => STANDARD.text;

/** The template doc text. Vercel: the file is traced in via next.config.mjs outputFileTracingIncludes; cwd is the project root. */
export function readTemplateDoc({ cwd = process.cwd() } = {}) {
  try { return fs.readFileSync(path.join(cwd, TEMPLATE_DOC_PATH), 'utf8'); } catch { return null; }
}

/** One compact line per episode: v2 briefs give format/treatment/lesson/angle/hero/scenes; v1 briefs give what the text and job show. */
export function episodeOf(post, job = null) {
  const meta = post?.videoBriefMeta || {};
  const v2 = Number(meta.briefVersion) === 2 && meta.v2 ? meta.v2 : null;
  const scenes = v2 ? [...new Set((v2.beats || []).map((b) => cut(b.screen, 100)).filter(Boolean))] : [];
  return {
    date: post.reviewOn || str(post.scheduledAt).slice(0, 10) || str(post.createdAt).slice(0, 10) || null,
    postId: post.id || null,
    briefVersion: v2 ? 2 : 1,
    format: v2?.format || (job?.kind === 'cq-howto' ? 'guide' : null),
    treatment: v2?.treatment || null,
    lesson: v2?.lesson || null,
    angle: v2 ? cut(v2.angle, 240) : null,
    hero: v2 ? cut(v2.hero, 240) : null,
    scenes,
    captions: v2 ? (v2.beats || []).map((b) => cut(b.caption, 60)).filter((c) => c && c !== 'none') : cut(meta.captions, 300).split(/\s*\|\s*|\n/).filter(Boolean),
    status: meta.status || null,
    rendered: Boolean(post.mediaUrl) || meta.status === 'rendered',
    storyboard: meta.storyboard?.status || null,
  };
}

/** Newest first, only posts that carry a brief (panel brief or a rendered brief video), bounded to `limit`. */
export function buildRecentEpisodes({ posts = [], jobs = [], limit = RECENT_EPISODES_MAX, excludePostId = null } = {}) {
  const jobByPost = new Map();
  for (const j of jobs) if (j?.postId && !jobByPost.has(j.postId)) jobByPost.set(j.postId, j);
  return posts
    .filter((p) => p && p.id !== excludePostId && (p.videoBriefMeta || jobByPost.has(p.id)))
    .map((p) => episodeOf(p, jobByPost.get(p.id)))
    .sort((a, b) => str(b.date).localeCompare(str(a.date)))
    .slice(0, limit);
}

export async function buildBriefContext({ clientId, postId = null, readTemplateDoc: readDoc = readTemplateDoc, readPost, readPosts, readJobs, library = loadLibrary() }) {
  let post = null;
  if (postId) {
    const row = await readPost(clientId, postId);
    if (!row) throw Object.assign(new Error('Post not found.'), { status: 404 });
    post = { id: row.id || postId, status: row.status || null, content: cut(row.content, 2000), reviewOn: row.reviewOn || null, scheduledAt: row.scheduledAt || null, revision: row.revision ?? null, brief: videoBriefView({ ...row, id: row.id || postId }) };
  }
  const [posts, jobs] = await Promise.all([readPosts(clientId, RECENT_POSTS_READ), readJobs(clientId, RECENT_JOBS_READ)]);
  return {
    ok: true,
    use: 'Write the Creative Brief as the v2 object following briefStandard (the six locked items, the writing rules and one worked example), templateDoc and library; never repeat a recentEpisodes angle or hero; never change the post\'s topic or copy (gaps go in needs); ' + FIRST_TIME_RIGHT + ' ' + READY_RULES + ' Save with queue.post.video-brief.save { postId, v2, status: "ready" }; never approve. A brief is finished only when directorNotes.status is "accepted". If directorNotes.status is "revise", fix every item in directorNotes.items and re-save (a save resets it to pending for re-review). If "pending", the Director has not reviewed it yet: move on to the next post.',
    briefStandard: loadBriefStandard(),
    templateDoc: readDoc(),
    library,
    recentEpisodes: buildRecentEpisodes({ posts, jobs, excludePostId: postId }),
    ...(post ? { post, directorNotes: post.brief.directorNotes || null } : {}),
  };
}
