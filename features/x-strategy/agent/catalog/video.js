// Video group: Critters Quest how-to video REQUESTS (template v3). Route app/api/dashboard/howto-requests (key 'howto-requests').
// Firestore only (howto_requests/{id}); no render, no spend. The owner approves a request with scripts/cq-howto/approve-request.mjs;
// only then does the daily cron render it. Logic + validation: features/brief-video/howto-request.js.
import { str, obj, open } from './_schema.js';

const ID = str('Request id: lowercase letters, digits and hyphens, 3-48 chars, e.g. gather-first-decision.', { pattern: '^[a-z0-9-]{3,48}$' });

export const VIDEO_ACTIONS = [
  {
    id: 'video.howto.request.submit',
    group: 'video',
    title: 'Submit a Critters Quest how-to video request',
    description: 'Saves a v3 video request (template YAML as JSON). Returns briefLine for the draft. Locked once approved. Narration is off unless the request sets narration: true. No render.',
    keywords: 'critters quest how-to video request template v3 howto brief render submit',
    route: 'howto-requests', method: 'POST', action: 'submit',
    args: obj({ request: open('The v3 request as JSON: request_version 3.1, id, review_on, type (how-to|feature-promo), game_commit, goal, audience, public_copy (<=280), hook, banner, host{name}, arrival{say}, steps[2-4]{say,panel,surface,clicks[{target,handler}]}, payoff{say,spot_art,town{name,level 1-15}}. Optional narration (boolean, default false). Max 32 KB.') }, ['request']),
    tier: 1,
  },
  {
    id: 'video.howto.request.get',
    group: 'video',
    title: 'Read a how-to video request',
    description: 'Returns a request by id: status (submitted|approved|building|rejected), note, warnings, briefLine. Once building, approved or rejected it is locked; a rejected one needs a new id.',
    keywords: 'critters quest how-to video request status approved',
    route: 'howto-requests', method: 'GET', action: null, query: { action: 'get' },
    args: obj({ id: ID }, ['id']),
    tier: 0,
  },
];
