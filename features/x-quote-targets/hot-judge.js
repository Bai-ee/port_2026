// Relevance judge for the hot quote scan. Pure except for the injected `callModel`.
// One batched call per scan with the small Claude model (see JUDGE in hot-config.js): the judge only decides FIT.
// Breakout, momentum and ranking stay deterministic in hot-scan.js.

import { JUDGE, ANGLES } from './hot-config.js';

const MAX_WHY = 140;

const DEFAULT_DIGEST = {
  who: 'Bryan Balli (@bai_ee), Chicago designer-builder for founders and small teams, 25 years in. Started in design making event flyers as a Chicago/SF house DJ; Housepitality; record collector.',
  own: ['design craft and designers shipping or pitching in public', 'building tools with AI as a designer-builder', 'Chicago house, 90s rave, deep house, record collecting, DJ culture and flyers'],
  avoid: ['news and politics', 'crypto price talk', 'sports', 'celebrity gossip', 'fan art', 'engagement bait and giveaways', 'agency or AI-SaaS pitches', 'wrong-genre "DJ" (EDM festival pop, hip-hop DJs)'],
};

const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v.map((x) => clip(typeof x === 'string' ? x : x?.text || x?.name, 120)).filter(Boolean) : []);

/** Compact Brain digest for the judge: lanes, topics to own / avoid, authority claims. Falls back to the built-in defaults per field. */
export function brainDigest(brain) {
  const b = brain && typeof brain === 'object' ? brain : {};
  const id = b.identity || {};
  const who = id.name || id.category || id.description
    ? clip(`${id.name || 'Owner'} (@${id.xHandle || 'bai_ee'}): ${id.category || ''}. ${id.location ? `Based in ${id.location}. ` : ''}${id.description || ''}`, 420)
    : DEFAULT_DIGEST.who;
  const audience = list(b.audience?.primary);
  const avoidPositioning = list(b.positioning?.avoidPositioning);
  return {
    who: `${who} Authority: Chicago/SF house scene since the 90s, Housepitality, record collector, designer-builder.`,
    own: [...DEFAULT_DIGEST.own, ...audience].slice(0, 8),
    avoid: [...new Set([...DEFAULT_DIGEST.avoid, ...avoidPositioning])].slice(0, 12),
  };
}

export function judgeSystemPrompt(digest) {
  return [
    'You decide whether a popular X post is worth the account owner quote-tweeting. The owner writes his own comment; you only judge FIT.',
    `Owner: ${digest.who}`,
    `He owns: ${digest.own.join('; ')}.`,
    `Reject (set "reject" to a short reason, fit 0): ${digest.avoid.join('; ')}. Also reject posts that are not about the lane they were found for (e.g. an actor named like a DJ).`,
    'For each post return fit 0-1 (1 = obviously his lane and he has real standing to add something) and one angle:',
    '"credit" he can credit/amplify a peer; "craft" a design-craft point; "i-was-there" first-hand house/rave scene memory; "builder" he shipped something similar; "record" record-collecting or vinyl point; "none" nothing honest to add.',
    '"why" is one plain sentence (max 140 chars) saying why it fits and what his angle is. No hype, no hashtags.',
    'Answer with ONLY a JSON array, one object per post: [{"i":<index>,"fit":<0-1>,"angle":"...","why":"...","reject":"<only when rejected>"}]',
  ].join('\n');
}

/** User message: the posts as compact JSON lines. Text is clipped; only what the judge needs. */
export function judgeUserPrompt(candidates) {
  const rows = candidates.map((c, i) => JSON.stringify({
    i, lane: c.lane, author: c.author, name: c.authorName, media: c.hasVideo ? 'video' : 'image',
    age_h: c.ageHours, engagement: c.engagement, text: clip(c.text, 280),
  }));
  return `Posts to judge:\n${rows.join('\n')}`;
}

/** Tolerant parse of the model's answer -> Map(index -> {fit, angle, why, reject?}). Bad rows are dropped. */
export function parseJudgeOutput(text, count) {
  const raw = String(text || '');
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  const out = new Map();
  if (start === -1 || end <= start) return out;
  let arr;
  try { arr = JSON.parse(raw.slice(start, end + 1)); } catch { return out; }
  for (const r of Array.isArray(arr) ? arr : []) {
    const i = Number(r?.i);
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    const fit = Number(r.fit);
    if (!Number.isFinite(fit)) continue;
    const angle = ANGLES.includes(r.angle) ? r.angle : 'none';
    const reject = typeof r.reject === 'string' && r.reject.trim() ? clip(r.reject, 80) : undefined;
    out.set(i, { fit: Math.max(0, Math.min(1, fit)), angle, why: clip(r.why, MAX_WHY), ...(reject ? { reject } : {}) });
  }
  return out;
}

export function judgeCostUsd(usage, model = JUDGE) {
  const inTok = Number(usage?.input_tokens) || 0;
  const outTok = Number(usage?.output_tokens) || 0;
  return (inTok * model.inputUsdPerMTok + outTok * model.outputUsdPerMTok) / 1_000_000;
}

/**
 * Which candidates get judged: at most `max`, best score first within a lane. Music gets up to a third of the budget
 * (its false-positive rate is higher) and either lane can use what the other leaves unused.
 */
export function chooseJudgeCandidates({ design = [], music = [] }, max = JUDGE.maxCandidates) {
  const musicCap = Math.floor(max / 3);
  const m = Math.min(music.length, musicCap);
  const d = Math.min(design.length, max - m);
  const m2 = Math.min(music.length, max - d);
  return [...design.slice(0, d), ...music.slice(0, m2)];
}

/**
 * Judge candidates in ONE call.
 * @param {object} o
 * @param {object[]} o.candidates   already capped (chooseJudgeCandidates)
 * @param {object} o.digest         brainDigest()
 * @param {(req:{system:string,user:string,maxTokens:number})=>Promise<{text:string,usage:{input_tokens:number,output_tokens:number}}>} o.callModel
 * @returns {Promise<{judged:object[], costUsd:number, notes:string[]}>}  judged = candidates + {fit, angle, why, reject?}; unjudged rows get fit 0
 */
export async function judgeCandidates({ candidates, digest, callModel, limits = JUDGE }) {
  const notes = [];
  if (!candidates.length) return { judged: [], costUsd: 0, notes };
  if (candidates.length > limits.maxCandidates) throw new Error(`judge cap: ${candidates.length} > ${limits.maxCandidates}`);
  const res = await callModel({ system: judgeSystemPrompt(digest), user: judgeUserPrompt(candidates), maxTokens: limits.maxOutputTokens });
  const costUsd = judgeCostUsd(res.usage, limits);
  if (costUsd > limits.maxCostUsd) notes.push(`judge cost $${costUsd.toFixed(4)} exceeded the $${limits.maxCostUsd} cap`);
  const verdicts = parseJudgeOutput(res.text, candidates.length);
  if (verdicts.size < candidates.length) notes.push(`judge returned ${verdicts.size}/${candidates.length} verdicts`);
  const judged = candidates.map((c, i) => ({ ...c, ...(verdicts.get(i) || { fit: 0, angle: 'none', why: '', reject: 'unjudged' }) }));
  return { judged, costUsd, notes };
}
