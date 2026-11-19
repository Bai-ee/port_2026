// Video group: Critters Quest how-to video REQUESTS (template v3 / 3.1 / 3.2) and render-now. Route app/api/dashboard/howto-requests (key 'howto-requests').
// Firestore only (howto_requests/{id}); no render, no spend. The owner approves a request with scripts/cq-howto/approve-request.mjs;
// only then does the daily cron render it. Logic + validation: features/brief-video/howto-request.js.
import { str, obj, open, bool } from './_schema.js';

const ID = str('Request id: lowercase letters, digits and hyphens, 3-48 chars, e.g. gather-first-decision.', { pattern: '^[a-z0-9-]{3,48}$' });

export const VIDEO_ACTIONS = [
  {
    id: 'video.howto.request.submit',
    group: 'video',
    title: 'Submit a Critters Quest how-to video request',
    description: 'Saves a how-to video request (v3.2 = auto-approved, renders with no owner step; 3/3.1 wait for the owner). Returns briefLine for the draft. Narration on by default for 3.2.',
    keywords: 'critters quest how-to video request template v3 howto brief render submit',
    route: 'howto-requests', method: 'POST', action: 'submit',
    args: obj({ request: open('The v3 request as JSON: request_version 3.2, id, review_on, type (how-to|feature-promo), game_commit (optional for 3.2), goal, audience, public_copy (<=280), hook, banner, host{name}, arrival{say}, steps[2-4]{say,panel,surface,clicks[{action (catalog action id), target?, handler?}]}, payoff{say,spot_art,town{name,level 1-15}}. Optional narration (boolean; default true for 3.2, false for older). Max 32 KB.') }, ['request']),
    tier: 1,
  },
  {
    id: 'video.howto.request.get',
    group: 'video',
    title: 'Read a how-to video request',
    description: 'Returns a request by id: status, autoApproved, note, warnings, briefLine. Locked once approved by the owner, building or rejected; a rejected one needs a new id.',
    keywords: 'critters quest how-to video request status approved',
    route: 'howto-requests', method: 'GET', action: null, query: { action: 'get' },
    args: obj({ id: ID }, ['id']),
    tier: 0,
  },
  {
    id: 'video.render.now',
    group: 'video',
    title: 'Render the video for a draft now',
    description: 'Starts the video for ONE draft now (needs an INTERNAL VIDEO BRIEF, no media, no HOLD; max 5/day). It attaches on the next cron tick. Returns {jobId, status}.',
    keywords: 'critters quest video render now immediately draft brief howto narration',
    route: 'howto-requests', method: 'POST', action: 'render-now',
    args: obj({ postId: str('The draft id (social_...).'), narration: bool('How-to videos only: override the request narration for this render (true = voice-over, false = none).') }, ['postId']),
    tier: 1,
  },
];
