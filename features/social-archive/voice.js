// Per-platform voice fingerprint + exemplar picking + the prompt block that
// Client Brain appends when a caller asks for platform/topic context.
// Pure except `timelineContext`, which reads through timeline-store.js.
// Only audience==='public' entries are ever used. See CONTRACT.md "Voice + Brain".
import { voiceFeatures } from './schema.js';

const VOICE_KINDS = new Set(['post', 'story', 'reel']);
const EXAMPLE_MAX = 220;

const isVoiceEntry = (e, platform, account) =>
  !!e && typeof e === 'object'
  && e.audience === 'public'
  && VOICE_KINDS.has(e.kind)
  && typeof e.text === 'string' && e.text.trim() !== ''
  && (!platform || e.platform === platform)
  && (!account || e.account === account);

const round = (n, d = 2) => { const k = 10 ** d; return Math.round(n * k) / k; };
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

function topN(counts, n, min = 1) {
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, n)
    .map(([k]) => k);
}

const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s'#@]/gu, ' ').split(/\s+/).filter(Boolean);

export function computeFingerprint(entries, { platform, account } = {}) {
  const rows = (Array.isArray(entries) ? entries : []).filter((e) => isVoiceEntry(e, platform, account));
  const feats = rows.map((e) => voiceFeatures(e.text));
  const lens = feats.map((f) => f.len).sort((a, b) => a - b);
  const days = rows.map((e) => e.day || String(e.ts || '').slice(0, 10)).filter(Boolean).sort();
  const tags = new Map(); const mentions = new Map(); const openers = new Map(); const signOffs = new Map();
  rows.forEach((e) => {
    (e.hashtags || []).forEach((h) => bump(tags, h));
    (e.mentions || []).forEach((m) => bump(mentions, m));
    const w = words(e.text);
    if (w.length >= 2) bump(openers, w.slice(0, 2).join(' '));
    if (w.length >= 3) bump(signOffs, w.slice(-2).join(' '));
  });
  const rate = (pick) => round(mean(feats.map((f) => (pick(f) ? 1 : 0))));
  return {
    platform: platform || null,
    sample: rows.length,
    window: { from: days[0] || null, to: days[days.length - 1] || null },
    len: { median: percentile(lens, 0.5), p90: percentile(lens, 0.9) },
    caps: round(mean(feats.map((f) => f.caps))),
    emoji: round(mean(feats.map((f) => f.emoji))),
    hashtags: round(mean(feats.map((f) => f.hashtags))),
    links: round(mean(feats.map((f) => f.links))),
    questions: rate((f) => f.question),
    exclaims: rate((f) => f.exclaim),
    lowerStartRate: rate((f) => f.lowerStart),
    topHashtags: topN(tags, 8),
    topMentions: topN(mentions, 5),
    openers: topN(openers, 5, 2),
    signOffs: topN(signOffs, 5, 2),
  };
}

const engagementScore = (e) => {
  const g = e.engagement || {};
  return (g.likes || 0) + 2 * (g.comments || 0) + 2 * (g.reposts || 0);
};
const byTsId = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function pickExemplars(entries, { platform, topic = '', limit = 5 } = {}) {
  let rows = (Array.isArray(entries) ? entries : []).filter((e) => isVoiceEntry(e, platform));
  const q = String(topic || '').trim().toLowerCase();
  if (q) {
    rows = rows.filter((e) => [e.text, ...(e.hashtags || []), e.album || ''].join(' ').toLowerCase().includes(q));
  }
  // The same caption is often posted more than once (re-posts, cross-posts); one copy is enough as an example.
  const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 120);
  const unique = new Map();
  for (const e of [...rows].sort(byTsId)) {
    const k = norm(e.text);
    const prev = unique.get(k);
    if (!prev || engagementScore(e) > engagementScore(prev)) unique.set(k, e);
  }
  rows = [...unique.values()];
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  if (!rows.length || !max) return [];
  const lens = rows.map((e) => e.text.length).sort((a, b) => a - b);
  const median = percentile(lens, 0.5);
  const chosen = new Map();
  const repCount = Math.ceil(max / 2);
  [...rows]
    .sort((a, b) => Math.abs(a.text.length - median) - Math.abs(b.text.length - median) || byTsId(a, b))
    .slice(0, repCount).forEach((e) => chosen.set(e.id, e));
  [...rows]
    .sort((a, b) => engagementScore(b) - engagementScore(a) || byTsId(a, b))
    .forEach((e) => { if (chosen.size < max && engagementScore(e) > 0) chosen.set(e.id, e); });
  // top up with remaining representative picks if engagement data was sparse
  [...rows]
    .sort((a, b) => Math.abs(a.text.length - median) - Math.abs(b.text.length - median) || byTsId(a, b))
    .forEach((e) => { if (chosen.size < max) chosen.set(e.id, e); });
  return [...chosen.values()].sort(byTsId);
}

const clip = (t, n) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n - 1).trim()}…` : s;
};
const dayOfEntry = (e) => e.day || String(e.ts || '').slice(0, 10);
const timeOf = (e) => (String(e.ts || '').slice(11, 16) ? `${String(e.ts).slice(11, 16)}Z` : '');

function headerLine(fp) {
  const ym = (d) => (d ? d.slice(0, 7) : '?');
  return `PLATFORM VOICE (${fp.platform || 'all'}, ${fp.sample} public posts, ${ym(fp.window.from)}..${ym(fp.window.to)}): `
    + `median ${fp.len.median} chars, ${Math.round(fp.caps * 100)}% caps, ${fp.emoji} emoji/post, `
    + `hashtags ${fp.hashtags}/post, lowercase starts ${Math.round(fp.lowerStartRate * 100)}%`;
}

export async function timelineContext({ db, clientId, platform, topic, day, limit = 4, maxChars = 1800, store } = {}) {
  try {
    if (!clientId || !(maxChars > 0)) return '';
    const s = store || await import('./timeline-store.js');
    const lines = [];

    let corpus = [];
    if (platform || topic) {
      corpus = await s.searchEntries(db, clientId, { platform: platform || undefined, limit: 1000 });
    }
    const fp = computeFingerprint(corpus, { platform });
    let ex = [];
    if (fp.sample > 0) {
      ex = pickExemplars(corpus, { platform, topic, limit });
      if (!ex.length && topic) ex = pickExemplars(corpus, { platform, limit });
    }

    let dayLines = [];
    if (day) {
      const d = await s.getDay(db, clientId, day);
      dayLines = (d?.entries || []).filter((e) => e && e.audience === 'public')
        .map((e) => `- ${e.kind}${timeOf(e) ? ` ${timeOf(e)}` : ''}${e.platform ? ` [${e.platform}]` : ''}: "${clip(e.text, EXAMPLE_MAX)}"`);
    }

    const head = fp.sample > 0 ? headerLine(fp) : '';
    const exLines = ex.map((e) => `- [${dayOfEntry(e)} ${e.kind}] "${clip(e.text, EXAMPLE_MAX)}"`);
    const dayHead = dayLines.length ? `ON ${day} (locked facts: do not change dates):` : '';
    if (!head && !dayLines.length) return '';

    const out = [];
    let used = 0;
    const push = (l) => { if (used + l.length + 1 > maxChars) return false; out.push(l); used += l.length + 1; return true; };
    // reserve room for locked day facts, then fill with examples
    const dayBlock = dayLines.length ? [dayHead, ...dayLines] : [];
    const reserve = Math.min(dayBlock.reduce((n, l) => n + l.length + 1, 0), Math.floor(maxChars * 0.5));
    if (head && !push(head)) return head.slice(0, maxChars);
    if (exLines.length && used + 'EXAMPLES:'.length + 1 < maxChars - reserve) {
      const exOut = [];
      let u = used + 'EXAMPLES:'.length + 1;
      for (const l of exLines) { if (u + l.length + 1 > maxChars - reserve) break; exOut.push(l); u += l.length + 1; }
      if (exOut.length) { push('EXAMPLES:'); exOut.forEach(push); }
    }
    for (const l of dayBlock) if (!push(l)) break;
    return out.join('\n');
  } catch {
    return '';
  }
}
