// Relevance judge for the hot quote scan. Pure except for the injected `callModel`.
// One batched call per scan with the small Claude model (see JUDGE in hot-config.js): the judge only decides FIT.
// Breakout, momentum and ranking stay deterministic in hot-scan.js.

import { JUDGE, ANGLES } from './hot-config.js';
import { brainAvoidFrom } from './lane-graph.js';

const MAX_WHY = 140;

const DEFAULT_DIGEST = {
  who: 'Bryan Balli (@bai_ee), Chicago designer-builder for founders and small teams, 25 years in.',
  own: ['design craft and designers shipping or pitching in public', 'building tools with AI as a designer-builder', 'Chicago house, 90s rave, deep house, record collecting, DJ culture and flyers'],
  avoid: ['news and politics', 'crypto price talk', 'sports', 'celebrity gossip', 'fan art', 'engagement bait and giveaways', 'agency or AI-SaaS pitches', 'wrong-genre "DJ" (EDM festival pop, hip-hop DJs)'],
  // The ONLY things an angle may rest on (owner-confirmed authority claims). Brain proof is appended in brainDigest().
  evidence: ['Chicago/SF house scene since the 90s (club and warehouse DJ, event flyer designer)', 'Housepitality', 'record collector', 'designer-builder (designs and builds sites, tools and content systems)'],
};

// Post-text evidence each grounded angle needs. A post outside the owner's real experience gets no first-hand or collector angle.
const SCENE_RE = /chicago|san francisco|bay area|\bsf\b|housepitality|ghetto house|frankie knuckles|ron hardy|larry heard|marshall jefferson|derrick carter|music box|warehouse/i;
const RECORD_RE = /vinyl|record|records|crate|digging|discogs|12"|\blp\b|pressing|collector|7"/i;
const BUILD_RE = /\bbuilt\b|\bbuild\b|\bbuilding\b|\bship|\blaunch|prototype|\bcode\b|coding|claude|cursor|vibe|\btool\b|\bapp\b|agent|plugin/i;

const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
const list = (v) => (Array.isArray(v) ? v.map((x) => clip(typeof x === 'string' ? x : x?.text || x?.name, 120)).filter(Boolean) : []);

/** Compact Brain digest for the judge: lanes, topics to own / avoid (real Brain doc shape), authority evidence. */
export function brainDigest(brain) {
  const b = brain && typeof brain === 'object' ? brain : {};
  const id = b.identity || {};
  const who = id.name || id.category || id.description
    ? clip(`${id.name || 'Owner'} (@${id.xHandle || 'bai_ee'}): ${id.category || ''}. ${id.location ? `Based in ${id.location}. ` : ''}${id.description || ''}`, 420)
    : DEFAULT_DIGEST.who;
  const { topics } = brainAvoidFrom(b);
  return {
    who,
    own: [...DEFAULT_DIGEST.own, ...list(b.audience?.primary)].slice(0, 8),
    avoid: [...new Set([...DEFAULT_DIGEST.avoid, ...topics.map((t) => clip(t, 90))])].slice(0, 14),
    evidence: [...DEFAULT_DIGEST.evidence, ...list(b.proof?.workHistory), ...list(b.proof?.projects)].slice(0, 12),
    sceneRe: id.location ? new RegExp(`${SCENE_RE.source}|${String(id.location).replace(/[^a-z0-9 ]/gi, '').trim() || 'chicago'}`, 'i') : SCENE_RE,
  };
}

/**
 * An angle must rest on the owner's real evidence. 'i-was-there' needs a post from his scene (Chicago/SF house, Housepitality...),
 * 'record' a vinyl/record post, 'builder' a build/ship post; otherwise the angle is 'none' and the post is not picked.
 * @returns {{angle:string, reject?:string}}
 */
export function groundAngle(angle, text, digest) {
  const t = String(text || '');
  const ok = angle === 'i-was-there' ? (digest?.sceneRe || SCENE_RE).test(t)
    : angle === 'record' ? RECORD_RE.test(t)
      : angle === 'builder' ? BUILD_RE.test(t)
        : true;
  return ok ? { angle } : { angle: 'none', reject: `no Brain evidence for angle "${angle}"` };
}

export function judgeSystemPrompt(digest) {
  return [
    'You decide whether a popular X post is worth the account owner quote-tweeting. The owner writes his own comment; you only judge FIT.',
    `Owner: ${digest.who}`,
    `He owns: ${digest.own.join('; ')}.`,
    `Reject (set "reject" to a short reason, fit 0): ${digest.avoid.join('; ')}. Also reject posts that are not about the lane they were found for (e.g. an actor named like a DJ).`,
    `His ONLY authority claims (an angle may rest on nothing else): ${digest.evidence.join('; ')}.`,
    'For each post return fit 0-1 (1 = obviously his lane and he has real standing to add something) and one angle:',
    '"credit" he can credit/amplify a peer; "craft" a design-craft point; "i-was-there" ONLY when the post is about the Chicago/SF house scene, Housepitality or a place/era he was actually part of (a UK festival, another city\'s scene, a famous act he did not see is NOT his); "builder" he shipped something similar; "record" a record-collecting or vinyl point; "none" when no claim above honestly applies. Never invent experience for him.',
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
  const judged = candidates.map((c, i) => {
    const v = verdicts.get(i) || { fit: 0, angle: 'none', why: '', reject: 'unjudged' };
    const g = groundAngle(v.angle, c.text, digest);
    return { ...c, ...v, ...g };
  });
  return { judged, costUsd, notes };
}
