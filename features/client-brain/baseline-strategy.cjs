'use strict';

// Baseline strategy -> Client Brain (pure, deterministic, no LLM, no I/O).
//
// A client can have a full baseline from the Marketing Brief pipeline while its Brain's Strategy Document,
// Content Tracks and Track Targets are empty (so the chat agent and calendar have nothing to manage against).
// buildBaselineStrategy() drafts those sections from the baseline; applyBaselineToMarkdown() writes the draft
// into the Brain Markdown. Brain wins: only EMPTY fields are filled, never overwritten.
//
// Baseline sources (dashboard_state/{clientId}):
//   marketingBrief.content   { content_angle, x_post, ... }   Scribe output
//   strategy30               { days:[{date,theme,idea}], today:{post,angle,rationale}, revisionNotes }
//   strategyBuilder.lastPlan { items:[{scheduledAt, xStrategy:{postType}}], ... }
//   strategyBuilder.config   { postsPerDay }
//
// Field mapping (form keys from form-schema.js; Markdown format = CLIENT_BRAIN_MARKDOWN_STANDARD.md
// "Strategy Document, Content Tracks and Track Targets"):
//   strategy.thesis        <- the Brain's own identity.strategicOneLiner + identity.positioning, else
//                             marketingBrief.content.content_angle, else strategy30.today.angle (+ rationale)
//   strategy.tracks        <- supplied `tracks` (owner/agent grouping), else strategy30.days themes that RECUR
//                             (one-off daily themes are returned as `themes` for the agent to group, not drafted)
//   strategy.formats       <- strategyBuilder.lastPlan.items xStrategy.postType counts
//   content.contentTracks  <- the same strategy30 theme lanes, share = lane's share of planned days
//   content.trackTargets   <- postsPerDay per lane (lastPlan items per day, else config.postsPerDay, else 1) x lane share
// Audience, Rules, Algorithm, Decisions and Open questions have no baseline source and are left alone.

const { markdownToForm, formToMarkdown } = require('./form-markdown.cjs');

const MAX_LANES = 4;
const SECTION_MAX = 1800;

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const clip = (v, n) => {
  const s = clean(v);
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
};
// Row cells may not hold the row/list delimiters.
const label = (v) => clip(String(v || '').replace(/[|;:=]/g, ' '), 40);
const isFilled = (v) => (typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) && v.some((r) => (r && typeof r === 'object' ? Object.values(r).some(Boolean) : Boolean(r))));

/** Recurring theme lanes from strategy30.days: [{ label, count, idea }] by frequency, then first appearance. */
function themeLanes(strategy30) {
  const days = Array.isArray(strategy30?.days) ? strategy30.days : [];
  const lanes = new Map();
  days.forEach((d, i) => {
    const name = label(d?.theme);
    if (!name) return;
    const key = name.toLowerCase();
    const lane = lanes.get(key) || { label: name, count: 0, idea: '', first: i };
    lane.count += 1;
    if (!lane.idea && clean(d?.idea)) lane.idea = clip(d.idea, 140);
    lanes.set(key, lane);
  });
  return [...lanes.values()].sort((a, b) => b.count - a.count || a.first - b.first).slice(0, MAX_LANES);
}

/** Owner/agent-supplied tracks [{label, share?}] -> lanes (count = share, equal when unset). Max MAX_TRACKS. */
const MAX_TRACKS = 6;
function suppliedLanes(tracks) {
  const rows = (Array.isArray(tracks) ? tracks : [])
    .map((t) => (typeof t === 'string' ? { label: t } : t))
    .map((t) => ({ label: label(t?.label || t?.name), share: Number(t?.share) }))
    .filter((t) => t.label);
  const seen = new Set();
  const lanes = rows.filter((t) => !seen.has(t.label.toLowerCase()) && seen.add(t.label.toLowerCase())).slice(0, MAX_TRACKS);
  return lanes.map((t, i) => ({ label: t.label, count: t.share > 0 ? t.share : 1, idea: '', first: i }));
}

/** Integer percents summing to 100 (largest remainder), one per lane. */
function percentShares(lanes) {
  const total = lanes.reduce((n, l) => n + l.count, 0);
  if (!total) return [];
  const raw = lanes.map((l) => (l.count / total) * 100);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => {
    if (left > 0) { out[i] += 1; left -= 1; }
  });
  return out;
}

function postFormats(lastPlan) {
  const items = Array.isArray(lastPlan?.items) ? lastPlan.items : [];
  const counts = new Map();
  for (const it of items) {
    const t = clean(it?.xStrategy?.postType);
    if (t) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([type, n]) => `- ${type}: ${n} of ${total} planned posts`);
}

function postsPerDay(dashboardState) {
  const items = Array.isArray(dashboardState?.strategyBuilder?.lastPlan?.items) ? dashboardState.strategyBuilder.lastPlan.items : [];
  const days = new Set(items.map((it) => String(it?.scheduledAt || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  let perDay = days.size ? items.length / days.size : Number(dashboardState?.strategyBuilder?.config?.postsPerDay);
  if (!Number.isFinite(perDay) || perDay <= 0) perDay = 1;
  return Math.round(Math.min(5, Math.max(0.5, perDay)) * 10) / 10;
}

const rowText = (cols) => `- ${cols.filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(' | ')}`;

/**
 * @param {{brainMarkdown?: string, dashboardState?: object}} input
 * @returns {null | {
 *   fields: Object<string, string|object[]>,   form-key -> value, ONLY the empty fields this draft fills (feed formToMarkdown)
 *   sections: {strategyDocument?: string, contentTracks?: string, trackTargets?: string},  readable Markdown of what would be written
 *   onlyEmpty: string[],   which of 'strategyDocument' | 'contentTracks' | 'trackTargets' this draft fills
 *   source: string[],      baseline fields actually used
 *   notes: string[],       caveats for the owner
 * }}  null when there is no baseline or nothing empty to fill.
 */
function buildBaselineStrategy({ brainMarkdown = '', dashboardState = {}, tracks = null } = {}) {
  const ds = dashboardState && typeof dashboardState === 'object' ? dashboardState : {};
  const current = markdownToForm(String(brainMarkdown || '')).fields;
  const strategy30 = ds.strategy30 && typeof ds.strategy30 === 'object' ? ds.strategy30 : null;
  const lastPlan = ds.strategyBuilder?.lastPlan && typeof ds.strategyBuilder.lastPlan === 'object' ? ds.strategyBuilder.lastPlan : null;
  const content = ds.marketingBrief?.content && typeof ds.marketingBrief.content === 'object' ? ds.marketingBrief.content : null;

  const source = new Set();
  const notes = [];
  const draft = {};

  // Strategy Document. The thesis is the Brain's own durable positioning; the brief's angle is a single day's
  // note, so it is only the fallback.
  const oneLiner = clean(current['identity.strategicOneLiner']);
  const positioning = clean(current['identity.positioning']);
  const angle = clip(content?.content_angle, 600);
  const todayAngle = clean(strategy30?.today?.angle) ? clip(`${clean(strategy30.today.angle)}${clean(strategy30.today.rationale) ? ` ${clean(strategy30.today.rationale)}` : ''}`, 600) : '';
  if (oneLiner || positioning) {
    draft['strategy.thesis'] = clip([oneLiner && `${oneLiner.replace(/[.!]+$/, '')}.`, positioning].filter(Boolean).join(' '), 600);
    source.add('brain.identity.positioning');
  } else if (angle) { draft['strategy.thesis'] = angle; source.add('marketingBrief.content.content_angle'); }
  else if (todayAngle) { draft['strategy.thesis'] = todayAngle; source.add('strategy30.today'); }

  // Lanes: supplied tracks win; else 30-day plan themes, but only ones that recur. One-off daily themes are not
  // tracks, so then the draft leaves the track sections empty and returns the themes for the agent to group.
  const days = Array.isArray(strategy30?.days) ? strategy30.days : [];
  const themes = [...new Set(days.map((d) => label(d?.theme)).filter(Boolean))];
  const supplied = suppliedLanes(tracks);
  const recurring = themeLanes(strategy30).filter((l) => l.count > 1);
  const lanes = supplied.length ? supplied : recurring;
  if (supplied.length) {
    draft['strategy.tracks'] = lanes.map((l) => `- ${l.label}`).join('\n');
    source.add('tracks (supplied)');
  } else if (lanes.length) {
    draft['strategy.tracks'] = lanes.map((l) => `- ${l.label}${l.idea ? `: ${l.idea}` : ''} (${l.count} of ${days.length} planned days)`).join('\n').slice(0, SECTION_MAX);
    source.add('strategy30.days');
  } else if (themes.length) {
    notes.push(`The 30-day plan has ${themes.length} one-off daily themes and no recurring lane, so no tracks were drafted. Group the themes into 3-5 tracks and pass them as tracks.`);
  }
  const formats = postFormats(lastPlan);
  if (formats.length) { draft['strategy.formats'] = formats.join('\n'); source.add('strategyBuilder.lastPlan.items'); }

  // Content Tracks + Track Targets (rows). Targets refer to track labels, so they follow the tracks that end up in the Brain.
  let trackRows = null;
  const tracksEmpty = !isFilled(current['content.contentTracks']);
  if (tracksEmpty && lanes.length) {
    const shares = percentShares(lanes);
    trackRows = lanes.map((l, i) => ({ label: l.label, share: String(shares[i]), topics: '', benchmarks: '', lists: '' }));
    draft['content.contentTracks'] = trackRows;
    notes.push('Content Tracks follow Content Center buckets: a track reaches the plan and calendar only once a bucket with the same name exists (buckets.upsert).');
  }
  const targetRows = trackRows
    || (isFilled(current['content.contentTracks']) ? (current['content.contentTracks'] || []).filter((r) => r && r.label) : []);
  if (!isFilled(current['content.trackTargets']) && targetRows.length) {
    const perDay = postsPerDay(ds);
    const total = targetRows.reduce((n, r) => n + (Number(r.share) || 0), 0);
    draft['content.trackTargets'] = targetRows.map((r) => {
      const share = total ? (Number(r.share) || 0) / total : 1 / targetRows.length;
      return { track: r.label, postsPerDay: String(Math.max(0.1, Math.round(perDay * share * 10) / 10)),
        'original-showcase': '', 'original-text': '', reply: '', quote: '', 'self-quote': '', video: '' };
    });
    source.add(lastPlan?.items?.length ? 'strategyBuilder.lastPlan.items' : 'strategyBuilder.config.postsPerDay');
    notes.push('Track Targets set posts/day only; the post-type mix is not in the baseline, so it stays unset.');
  }

  // Brain wins: keep only fields that are empty in the Brain.
  const fields = {};
  for (const [key, value] of Object.entries(draft)) if (!isFilled(current[key])) fields[key] = value;
  if (!Object.keys(fields).length) return null;
  const trackLabels = (fields['content.contentTracks'] || targetRows).map((r) => r.label || r.track).filter(Boolean);

  const docKeys = Object.keys(fields).filter((k) => k.startsWith('strategy.'));
  const sections = {};
  const onlyEmpty = [];
  if (docKeys.length) {
    const title = { 'strategy.thesis': 'Thesis', 'strategy.tracks': 'Tracks', 'strategy.formats': 'Formats' };
    sections.strategyDocument = `## Strategy Document\n\n${docKeys.map((k) => `### ${title[k]}\n\n${fields[k]}`).join('\n\n')}`;
    onlyEmpty.push('strategyDocument');
  }
  if (fields['content.contentTracks']) {
    sections.contentTracks = `### Content Tracks\n\n${fields['content.contentTracks'].map((r) => rowText([['label', r.label], ['share', r.share]])).join('\n')}`;
    onlyEmpty.push('contentTracks');
  }
  if (fields['content.trackTargets']) {
    sections.trackTargets = `### Track Targets\n\n${fields['content.trackTargets'].map((r) => rowText([['track', r.track], ['postsPerDay', r.postsPerDay]])).join('\n')}`;
    onlyEmpty.push('trackTargets');
  }
  return { fields, sections, onlyEmpty, source: [...source], notes, themes, trackLabels };
}

/** Write the draft's fields into the Brain Markdown (everything else kept verbatim; same editor as the Brain form). */
function applyBaselineToMarkdown(brainMarkdown, draft) {
  return formToMarkdown(draft.fields, { preserved: String(brainMarkdown || '') });
}

module.exports = { buildBaselineStrategy, applyBaselineToMarkdown };
