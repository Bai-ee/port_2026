// Bookmark judge: for each of the owner's bookmarked posts, decide FIT against the Brain and HOW to respond.
// Pure except for the injected `callModel`. Reuses the hot-quote judge's Brain digest, cost and angle-grounding helpers;
// the prompt is its own (the hot judge only scores fit for a quote, this one also picks the kind of response).

import { JUDGE, ANGLES } from '../x-quote-targets/hot-config.js';
import { groundAngle, judgeCostUsd } from '../x-quote-targets/hot-judge.js';

export { brainDigest } from '../x-quote-targets/hot-judge.js';

export const RESPONDS = Object.freeze(['quote', 'reply', 'swipe', 'skip']);
export const LANES = Object.freeze(['design', 'music', 'other']);
/** Bookmarks are already the owner's own pick, so the fit bar is lower than the hot scan's 0.65. */
/** Haiku spends most of its output budget thinking (~1k tokens before the JSON), so the judge runs in small batches with a
 *  per-batch output cap that leaves room for 8 rows of how + why. maxCandidates is the per-run total across batches. */
export const BOOKMARK_LIMITS = Object.freeze({ ...JUDGE, threshold: 0.5, maxCandidates: 24, batchSize: 8, maxOutputTokens: 6000 });
export const MAX_HOW = 140;
export const MAX_WHY = 140;
const QUOTE_MAX_AGE_HOURS = 36;

const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Unjudged, undecided bookmarks, newest first, capped. */
export function selectBookmarkCandidates(items, max = BOOKMARK_LIMITS.maxCandidates) {
  return (items || [])
    .filter((x) => x && x.id && !x.judge && !x.decision && String(x.text || '').trim())
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))
    .slice(0, max);
}

export function bookmarkSystemPrompt(digest) {
  return [
    'The account owner bookmarked X posts. For each, judge how well it fits his strategy and HOW he could respond. He writes his own words; you only recommend a response kind and a one-line direction.',
    `Owner: ${digest.who}`,
    `He owns: ${digest.own.join('; ')}.`,
    `Reject (respond "skip", fit 0, set "reject" to a short reason): ${digest.avoid.join('; ')}.`,
    `His ONLY authority claims (anything he says must rest on these): ${digest.evidence.join('; ')}. Never invent experience for him.`,
    'Per post return:',
    '- fit 0-1 (1 = squarely his lane and he has real standing to add something)',
    '- lane: "design" | "music" | "other"',
    `- angle (one of ${ANGLES.join(', ')}): "credit" amplify a peer; "craft" a design-craft point; "i-was-there" ONLY for the Chicago/SF house scene, Housepitality or an era/place he was part of; "builder" he shipped something similar; "record" a record-collecting point; "none" when no claim above honestly applies`,
    `- respond: "quote" = a striking object worth a quote-react with a flat 2-8 word caption, ONLY when age_h < ${QUOTE_MAX_AGE_HOURS} or it is still clearly climbing; "reply" = a conversation where he has real standing (age does not matter); "swipe" = a good reference for his OWN future showcase, record or mix post, not for engaging; "skip" = no use`,
    `- how: ONE plain line (max ${MAX_HOW} chars) saying what he would say or make. Ground it ONLY in the authority claims above. A statement from his own work, never a question to the author (he does not ask his audience questions). No hype, no hashtags.`,
    `- why: one plain sentence (max ${MAX_WHY} chars) on why it fits.`,
    'Answer with ONLY a JSON array, one object per post: [{"i":<index>,"fit":<0-1>,"lane":"...","angle":"...","respond":"...","how":"...","why":"...","reject":"<only when rejected>"}]',
  ].join('\n');
}

export function bookmarkUserPrompt(candidates, now = Date.now()) {
  const rows = candidates.map((c, i) => {
    const t = Date.parse(c.createdAt || '');
    return JSON.stringify({
      i, author: c.author, name: c.authorName, media: c.media || 'none', thread: c.isThread === true,
      age_h: Number.isFinite(t) ? Math.round(((now - t) / 3_600_000) * 10) / 10 : null,
      likes: c.likes ?? 0, replies: c.replies ?? 0, text: clip(c.text, 400),
    });
  });
  return `Bookmarked posts to judge:\n${rows.join('\n')}`;
}

/** A cut-off array (max_tokens) still yields its complete rows: every flat {...} object that parses on its own. */
function salvageRows(text) {
  const rows = [];
  for (const m of String(text).matchAll(/\{[^{}]*\}/g)) {
    try { rows.push(JSON.parse(m[0])); } catch { /* partial row at the cut */ }
  }
  return rows;
}

/** Tolerant parse -> Map(index -> {fit, lane, angle, respond, how, why, reject?}). Bad rows are dropped; a truncated array keeps its complete rows. */
export function parseBookmarkJudgeOutput(text, count) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  const out = new Map();
  if (start === -1) return out;
  let arr;
  if (end <= start) arr = salvageRows(raw.slice(start)); // no closing bracket: the array was cut off
  else { try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { arr = salvageRows(raw.slice(start)); } }
  for (const r of Array.isArray(arr) ? arr : []) {
    const i = Number(r?.i);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    const fit = Number(r.fit);
    if (!Number.isFinite(fit)) continue;
    const reject = typeof r.reject === 'string' && r.reject.trim() ? clip(r.reject, 80) : undefined;
    out.set(i, {
      fit: Math.max(0, Math.min(1, fit)),
      lane: LANES.includes(r.lane) ? r.lane : 'other',
      angle: ANGLES.includes(r.angle) ? r.angle : 'none',
      respond: RESPONDS.includes(r.respond) ? r.respond : 'skip',
      how: clip(r.how, MAX_HOW), why: clip(r.why, MAX_WHY),
      ...(reject ? { reject } : {}),
    });
  }
  return out;
}

/**
 * Final verdict for one item: parsed model verdict + code-side rules.
 *  - an angle with no Brain evidence is 'none'; a quote or reply rests on standing, so without an angle it becomes a swipe
 *  - a quote of a post older than the window becomes a swipe
 *  - a rejected or below-threshold post is a skip
 */
export function finalizeVerdict(v, item, digest, { now = Date.now(), model = BOOKMARK_LIMITS.model, limits = BOOKMARK_LIMITS } = {}) {
  // groundAngle's own `reject` is dropped: an ungrounded angle only demotes the response to a swipe, it does not discard the bookmark.
  const out = { ...v, angle: groundAngle(v.angle, item.text, digest).angle };
  const t = Date.parse(item.createdAt || '');
  const ageH = Number.isFinite(t) ? (now - t) / 3_600_000 : null;
  if ((out.respond === 'quote' || out.respond === 'reply') && out.angle === 'none') out.respond = 'swipe';
  if (out.respond === 'quote' && ageH !== null && ageH > QUOTE_MAX_AGE_HOURS) out.respond = 'swipe';
  if (out.reject || out.fit < limits.threshold) out.respond = 'skip';
  return { ...out, judgedAt: new Date(now).toISOString(), model };
}

/**
 * Judge candidates in batches of limits.batchSize (one model call each; a later batch is skipped once the cost cap is hit).
 * @returns {Promise<{judged:Array<{item:object, judge:object}>, costUsd:number, notes:string[]}>}
 *   judge is null for a row the model dropped, so the next run retries it.
 */
export async function judgeBookmarks({ candidates, digest, callModel, limits = BOOKMARK_LIMITS, now = Date.now() }) {
  const notes = [];
  if (!candidates.length) return { judged: [], costUsd: 0, notes };
  if (candidates.length > limits.maxCandidates) throw new Error(`judge cap: ${candidates.length} > ${limits.maxCandidates}`);
  const size = Math.max(1, Number(limits.batchSize) || candidates.length);
  const system = bookmarkSystemPrompt(digest);
  const judged = [];
  let costUsd = 0;
  for (let at = 0; at < candidates.length; at += size) {
    const batch = candidates.slice(at, at + size);
    if (costUsd > limits.maxCostUsd) {
      notes.push(`judge cost $${costUsd.toFixed(4)} exceeded the $${limits.maxCostUsd} cap; ${candidates.length - at} left unjudged`);
      judged.push(...batch.map((item) => ({ item, judge: null })));
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const res = await callModel({ system, user: bookmarkUserPrompt(batch, now), maxTokens: limits.maxOutputTokens });
    costUsd += judgeCostUsd(res.usage, limits);
    const verdicts = parseBookmarkJudgeOutput(res.text, batch.length);
    if (verdicts.size < batch.length) notes.push(`judge returned ${verdicts.size}/${batch.length} verdicts (batch ${at / size + 1})`);
    judged.push(...batch.map((item, i) => {
      const v = verdicts.get(i);
      // A missing verdict stays unjudged (null) so the next run retries it.
      return { item, judge: v ? finalizeVerdict(v, item, digest, { now, model: limits.model, limits }) : null };
    }));
  }
  return { judged, costUsd: Number(costUsd.toFixed(5)), notes };
}
