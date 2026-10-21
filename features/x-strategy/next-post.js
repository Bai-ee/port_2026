// next-post.js - the next_post read tool: now (Chicago) -> the next OPEN baseline slot -> candidate drafts for that
// slot's track -> a per-candidate rule check -> the format template -> surplus drafts to pass.
// Pure: calendar rows, slots and the clock are injected. It proposes nothing and writes nothing; the agent turns the
// answer into cards (move / pass) that the owner confirms.

import { ctDate, ctTime, addDays, ctWallToMs } from '../x-content-inventory/month-calendar.js';
import { hasMemoryPlaceholder } from '../social-posting/self-reply.js';

export const SLOT_OCCUPIED_MINUTES = 60; // a scheduled/approved/posted post this close to a slot fills it
export const LOOKAHEAD_DAYS = 3;
export const CANDIDATES_MAX = 6;
const MIN_VIDEO_SECONDS = 10;
const TEXT_MAX = 200;
const FILLED = new Set(['approved', 'scheduled', 'queued', 'posted', 'published']);
const OPEN_STATUSES = new Set(['draft', 'approved', 'awaiting_approval', 'needs_review', 'scheduled', 'queued']);
export const RECORD_LINE_RE = /\S[^\n]*\n\s*\n[^\n]+\s[-–—]\s[^\n]+\[[^\]\n]+,\s*(?:19|20)\d{2}\]/;
// The record-line shapes we accept: "Artist – Title [Label, Year]" after a first-person line, or the generated draft
// shape ("Artist – Title", then a "Label · Cat · Year" line).
export const RECORD_LINE_ALT_RE = /[^\n]+\s[-–—]\s[^\n]+\n[^\n]*(?:19|20)\d{2}/;
const isRecordFormat = (text) => RECORD_LINE_RE.test(text) || RECORD_LINE_ALT_RE.test(text);

/** What kind of slot is this, from its track label + note. */
export function slotKind(slot) {
  const t = `${slot?.track ?? ''} ${slot?.note ?? ''}`.toLowerCase();
  if (/record|discogs|vinyl/.test(t)) return 'record';
  if (/throwback/.test(t)) return 'throwback';
  if (/quote/.test(t)) return 'quote-react';
  if (/\bmix\b|\bdj\b|\bue\b|underground/.test(t)) return 'mix';
  if (/showcase|design/.test(t)) return 'showcase';
  return 'other';
}

/** Format templates per slot kind. No figures: those come from the other tools. */
export const TEMPLATES = Object.freeze({
  showcase: 'One line, then the screen-captured video of the thing built. No intro, no hashtags. Credits and links go in the first self-reply.',
  'quote-react': 'Quote-react on a HOT-SCAN pick (never invent the target): a striking post from someone else plus a flat 2-8 word caption. No explaining, no own link, no hashtags.',
  record: 'One first-person line, a blank line, then "Artist – Title [Label, Year]". Video of the record playing, at least 10s. The Discogs link goes in the self-reply, never the main post. At most 2 hashtags (optional).',
  throwback: 'One first-person line with the year or anniversary, then the dated media (video of at least 10s). Link in the self-reply. At most 2 hashtags (optional).',
  mix: 'A mood line, then the mix video (at least 10s). The listen link goes in the self-reply. At most 2 hashtags (optional).',
  other: 'Follow the track\'s format in the Strategy document.',
});

const hashtagCount = (text) => (String(text ?? '').match(/(^|\s)#\w+/g) || []).length;
const hasUrl = (text) => /https?:\/\/(?!t\.co\/\w+$)\S+/i.test(String(text ?? ''));
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function rowMs(r) {
  if (Number.isFinite(r.ms)) return r.ms;
  const t = Date.parse(r.scheduledAt);
  return Number.isFinite(t) ? t : null;
}

/** Does a calendar post row belong to this slot's track? bucket id first, then label, then the record-line shape. */
function matchesSlot(r, slot, kind) {
  const bucket = r.bucketId || r.engine || '';
  if (slot.trackId && bucket === slot.trackId) return true;
  const b = norm(bucket);
  const label = norm(slot.track);
  if (b && label && (b.includes(label) || label.includes(b))) return true;
  if (kind === 'record' && RECORD_LINE_RE.test(String(r.content ?? ''))) return true;
  return false;
}

/** Per-candidate rule check. Each entry: {code, ok, fix?}. */
export function ruleCheckDraft(r, kind) {
  const text = String(r.content ?? r.text ?? '');
  const mediaType = String(r.mediaType ?? '');
  const hasMedia = !!(r.mediaUrl || mediaType);
  const needsVideo = kind === 'record' || kind === 'throwback' || kind === 'mix';
  const tags = hashtagCount(text);
  const maxTags = kind === 'showcase' || kind === 'quote-react' ? 0 : 2;
  const checks = [
    { code: 'no-placeholder', ok: !hasMemoryPlaceholder(text), ...(hasMemoryPlaceholder(text) ? { fix: 'Replace the "[add your …]" line with a real memory (approving strips it, but the post is better with one).' } : {}) },
    { code: 'media-present', ok: hasMedia, ...(hasMedia ? {} : { fix: 'Attach media (propose_item_media or propose_media_tasks).' }) },
  ];
  if (needsVideo) {
    const video = /video|gif/i.test(mediaType) || /\.(mp4|mov|webm)(\?|$)/i.test(String(r.mediaUrl ?? ''));
    checks.push({ code: 'video', ok: hasMedia && video, ...(hasMedia && video ? {} : { fix: `This track needs a video of at least ${MIN_VIDEO_SECONDS}s (under that it does not count as a video view).` }) });
  }
  checks.push({ code: 'no-link-in-main-post', ok: !hasUrl(text), ...(hasUrl(text) ? { fix: 'Move the link to the first self-reply.' } : {}) });
  if (kind === 'record' || kind === 'throwback' || kind === 'mix') {
    const sr = r.selfReply && typeof r.selfReply === 'object' ? String(r.selfReply.text ?? '') : '';
    checks.push({ code: 'link-in-self-reply', ok: hasUrl(sr), ...(hasUrl(sr) ? {} : { fix: 'Add the Discogs / listen link as the first self-reply.' }) });
  }
  checks.push({ code: 'hashtags', ok: tags <= maxTags, ...(tags <= maxTags ? {} : { fix: maxTags ? `Keep at most ${maxTags} hashtags.` : 'Drop the hashtags (design lane).' }) });
  checks.push({ code: 'length', ok: text.length <= 280, ...(text.length <= 280 ? {} : { fix: 'Shorten to 280 characters.' }) });
  if (kind === 'record') checks.push({ code: 'record-format', ok: isRecordFormat(text), ...(isRecordFormat(text) ? {} : { fix: 'Use: one first-person line, blank line, "Artist – Title [Label, Year]".' }) });
  return checks;
}


/** Quote-react slots run on a hot-scan pick: name where it comes from, show the picks if present, never invent a target or caption. */
function hotScanFor(hotQuotes, bookmarkPicks = null) {
  const base = { source: 'marketingBrief.hotQuotes', rule: 'The target comes from the hot scan. Do not invent a target or write a caption until the owner picks one; then a flat 2-8 word caption.' };
  const hot = Array.isArray(hotQuotes) ? hotQuotes : [];
  // Owner's bookmarks judged "quote": appended after the hot picks, tagged so the agent can say where a target came from.
  const marks = (Array.isArray(bookmarkPicks) ? bookmarkPicks : []).filter((b) => b && b.respond === 'quote');
  if (!hot.length && !marks.length) {
    return { ...base, available: false, note: 'No hot-scan picks are available on this deployment yet. Use get_opportunities for open quote targets; do not make one up.' };
  }
  const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const picks = [
    ...hot.map((q) => ({ id: q.id ?? null, handle: q.handle ?? null, url: q.url ?? null, text: clean(q.text) })),
    ...marks.map((b) => ({ id: b.id ?? null, handle: b.author ?? b.handle ?? null, url: b.url ?? null, text: clean(b.text), source: 'bookmark', ...(b.how ? { how: clean(b.how) } : {}) })),
  ].slice(0, 3);
  return { ...base, available: true, picks };
}

/** Which EXISTING card moves the pick to the slot. Nothing here moves anything; the owner confirms the card. */
function moveCard(pick, target, slot) {
  const base = { postId: pick.id, expectedRevision: pick.revision, status: pick.status, reviewOn: target.date, timeCT: slot.time };
  const atIso = new Date(ctWallToMs(target.date, slot.minutes)).toISOString();
  if (pick.status === 'scheduled' || pick.status === 'queued') return { ...base, card: 'propose_post_edit', args: { postId: pick.id, scheduledAt: atIso }, note: 'Call get_post first and pass its updatedAt as expectedUpdatedAt. The scheduling guards (approval, media staged) re-run on confirm.' };
  if (pick.status === 'approved') return { ...base, card: 'propose_post_schedule', args: { postId: pick.id, scheduledAt: atIso }, note: 'Call get_post first and pass its updatedAt as expectedUpdatedAt. The media-not-staged guard re-runs on confirm.' };
  return { ...base, card: 'propose_queue_bulk', args: { action: 'set-review-date', postIds: [pick.id], date: target.date }, note: 'Drafts get a review day only; approval and scheduling stay separate cards.' };
}

/** The pass card for surplus drafts (propose_calendar_decide, ids from get_calendar rows). */
function passCardFor(rest) {
  return { card: 'propose_calendar_decide', items: rest.filter(({ r }) => r.id).map(({ r }) => ({ decision: 'pass', item: { kind: 'post', postId: r.id, ...(Number.isInteger(r.revision) ? { expectedRevision: r.revision } : {}) } })) };
}

/**
 * @param {object} o
 * @param {number} o.now epoch ms
 * @param {Array<{time:string,minutes:number,track:string,trackId:string|null,note:string}>} o.slots baseline slots
 * @param {object[]} o.rows flat calendar rows (kind:'post'), each with `date`
 * @param {string} [o.track] only this track's slot (label, id, or a word like "discogs")
 * @param {object[]|null} [o.bookmarkPicks] judged bookmark picks (marketingBrief.bookmarkPicks.picks); only respond:'quote' ones join the quote-react picks, after the hot picks (max 3 total)
 * @param {object[]|null} [o.hotQuotes] shaped hot-scan picks (marketingBrief.hotQuotes) when the deployment has them; null/absent degrades cleanly
 */
export function planNextPost({ now, slots = [], rows = [], track = '', hotQuotes = null, bookmarkPicks = null } = {}) {
  const q = norm(track);
  const pool = q ? slots.filter((s) => norm(`${s.track} ${s.trackId ?? ''} ${s.note}`).includes(q)) : slots;
  if (!pool.length) return { available: false, reason: q ? `no baseline slot matches "${String(track).slice(0, 40)}"` : 'no baseline slots (the Strategy document must be confirmed and list a "Daily slot baseline")' };

  const today = ctDate(now);
  const posts = rows.filter((r) => r && r.kind === 'post');
  const filledNear = (slotMs) => posts.find((r) => FILLED.has(r.status) && rowMs(r) != null && Math.abs(rowMs(r) - slotMs) <= SLOT_OCCUPIED_MINUTES * 60_000);

  const passedToday = [];
  let target = null;
  for (let d = 0; d <= LOOKAHEAD_DAYS && !target; d += 1) {
    const date = addDays(today, d);
    for (const slot of pool) {
      const ms = ctWallToMs(date, slot.minutes);
      if (ms < now) { if (d === 0) passedToday.push(slot.time); continue; }
      const taken = filledNear(ms);
      if (taken) continue;
      target = { date, slot, ms };
      break;
    }
  }
  if (!target) return { available: false, reason: `every matching slot in the next ${LOOKAHEAD_DAYS} days already has a post`, passedToday };

  const { slot } = target;
  const kind = slotKind(slot);
  const dayOf = (r) => r.reviewOn || r.date || (rowMs(r) != null ? ctDate(rowMs(r)) : null);
  const open = posts.filter((r) => OPEN_STATUSES.has(r.status) && matchesSlot(r, slot, kind));
  // Drafts dated after the target day belong to later slots: never candidates, never surplus.
  const inReach = open.filter((r) => { const d = dayOf(r); return d && d >= today && d <= target.date; });
  const scoreOf = (r) => {
    const checks = ruleCheckDraft(r, kind);
    const failed = checks.filter((c) => !c.ok).length;
    const dayScore = dayOf(r) === target.date ? 0 : dayOf(r) === today ? 1 : 2;
    return { checks, failed, rank: [dayScore, failed, rowMs(r) ?? Infinity] };
  };
  const scored = inReach.map((r) => ({ r, ...scoreOf(r) })).sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
  const candidates = scored.slice(0, CANDIDATES_MAX).map(({ r, checks }) => ({
    id: r.id ?? null, status: r.status ?? null, day: dayOf(r), time: r.time || null, revision: Number.isInteger(r.revision) ? r.revision : null,
    text: String(r.content ?? r.text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX),
    media: r.mediaType || (r.mediaUrl ? 'media' : 'none'), hasSelfReply: !!(r.selfReply && (r.selfReply.text || r.selfReply.mediaUrl)),
    checks, failing: checks.filter((c) => !c.ok).map((c) => c.code),
  }));
  const pick = candidates[0] ?? null;
  const pass = candidates.slice(1).map((c) => c.id).filter(Boolean);

  return {
    available: true,
    now: { date: today, timeCT: ctTime(now) },
    target: {
      date: target.date, timeCT: slot.time, track: slot.track, trackId: slot.trackId, kind,
      isToday: target.date === today, passedToday,
      why: passedToday.length && target.date !== today
        ? `Today's ${passedToday.join(', ')} slot${passedToday.length > 1 ? 's' : ''} already passed; the next open one is ${target.date} ${slot.time} CT.`
        : `Next open ${slot.track} slot.`,
    },
    template: TEMPLATES[kind],
    ...(kind === 'quote-react' ? { hotScan: hotScanFor(hotQuotes, bookmarkPicks) } : {}),
    pick: pick ? { id: pick.id, why: `Best fit for ${target.date} ${slot.time}: ${pick.failing.length ? `needs ${pick.failing.join(', ')}` : 'passes every check'}.` } : null,
    candidates,
    passSurplus: pass.length ? { ids: pass, why: 'Same track, same stretch: one post per slot. Pass or move these (propose_calendar_decide / propose_post_edit).' } : null,
    ...(pick ? {} : { note: `No draft for the ${slot.track} track is waiting. Offer propose_daily_fill or propose_calendar_batch for it.` }),
    move: pick ? moveCard(pick, target, slot) : null,
    passCard: pass.length ? passCardFor(scored.slice(1, CANDIDATES_MAX)) : null,
  };
}
