// Code-owned daily-fill rule for the daily mix video (owner decision 2026-10-19): the media owner client's Dj Mix Videos
// bucket (`ue`) gets exactly ONE calendar draft a day, a BAI-EE mix video: the newest render not used yet first (the
// 06:00 daily email render, synced in by the daily-loop), then least recently used, so every BAI-EE video gets a turn
// before one repeats. Drafts only, for owner approval.
//
// sameDay (2026-10-20): the fill plans this track for today only, never days ahead. A 7-day pre-fill held every day
// with older renders, so the morning's render never reached the calendar the day it was made; now it is today's draft
// even when an older (or rejected) draft already sits on today.
//
// Lives here, not on the track: content tracks round-trip through the Client Brain (Brain wins), which would drop a
// track-level field. Same idea as the code-owned daily email video recipe (app/api/worker/pre-digest-video).

import { mediaOwnerClientId } from '../rendered-videos/firestore-sync.js';

export const DAILY_MIX_RULE = Object.freeze({ perDay: 1, artists: Object.freeze(['BAI-EE']), newestFirst: true, sameDay: true });

/** `{ [bucketId]: rule }` for planDailyFill's `trackRules`; empty for every client but the rendered-video owner (RENDERED_VIDEOS_CLIENT_ID, else NAS_INVENTORY_CLIENT_ID). */
export function dailyMixRulesFor(clientId, { ownerClientId = mediaOwnerClientId() } = {}) {
  return clientId && ownerClientId && clientId === ownerClientId ? { ue: DAILY_MIX_RULE } : {};
}
