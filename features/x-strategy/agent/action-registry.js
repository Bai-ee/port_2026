// STUB — replaced by CATALOG at merge. Minimal registry so action-runtime.js can be built and tested against the
// contract shape (CONTRACT2 §A). Do NOT extend this file; the merge takes CATALOG's version of it.

const freeze = (o) => Object.freeze(o);

export const ROUTE_MODULES = freeze({
  'quote-targets': () => import('../../../app/api/dashboard/quote-targets/route.js'),
  'social-posting': () => import('../../../app/api/social-posting/route.js'),
});

export const ACTIONS = Object.freeze([
  freeze({
    id: 'queue.post.list', group: 'queue', title: 'List queued posts', description: 'Read the post queue.',
    route: 'social-posting', method: 'POST', action: 'list', args: { type: 'object', properties: {}, required: [] }, tier: 0,
  }),
  freeze({
    id: 'queue.post.update', group: 'queue', title: 'Edit a queued post', description: 'Change the text of a draft or queued post.',
    route: 'social-posting', method: 'POST', action: 'update',
    args: { type: 'object', properties: { postId: { type: 'string' }, content: { type: 'string' } }, required: ['postId'] },
    tier: 1, snapshot: [{ collection: 'social_posts', idArg: 'postId' }],
  }),
  freeze({
    id: 'queue.post.reject', group: 'queue', title: 'Reject a draft', description: 'Reject a draft so it leaves the queue.',
    route: 'social-posting', method: 'POST', action: 'reject-draft',
    args: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
    tier: 2, snapshot: [{ collection: 'social_posts', idArg: 'postId' }],
  }),
  freeze({
    id: 'queue.post.schedule', group: 'queue', title: 'Schedule a post', description: 'Schedule an approved post; the cron publishes it to X.',
    route: 'social-posting', method: 'POST', action: 'approve-and-schedule',
    args: { type: 'object', properties: { postId: { type: 'string' }, scheduledAt: { type: 'string' } }, required: ['postId', 'scheduledAt'] },
    tier: 3, external: 'x', cost: 'Publishes to X (1 metered write).', snapshot: [{ collection: 'social_posts', idArg: 'postId' }],
  }),
  freeze({
    id: 'xmonitor.sync', group: 'xmonitor', title: 'Sync X Monitor', description: 'Pull the latest followers and post metrics (paid X API).',
    route: 'quote-targets', method: 'POST', action: 'x-monitor-sync', args: { type: 'object', properties: {}, required: [] },
    tier: 3, external: 'paid', cost: 'About 3 metered X API calls.', irreversible: true,
  }),
]);

const byId = new Map(ACTIONS.map((a) => [a.id, a]));
export const getAction = (id) => byId.get(String(id ?? '')) ?? null;

export function findActions(query, { group, maxTier, limit = 8 } = {}) {
  const toks = String(query ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored = [];
  for (const a of ACTIONS) {
    if (group && a.group !== group) continue;
    if (Number.isInteger(maxTier) && a.tier > maxTier) continue;
    const hay = `${a.id} ${a.title} ${a.description} ${a.group}`.toLowerCase();
    const score = toks.length ? toks.filter((t) => hay.includes(t)).length : 1;
    if (score) scored.push({ a, score });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map(({ a }) => ({
    id: a.id, title: a.title, tier: a.tier, group: a.group,
    args: Object.keys(a.args?.properties ?? {}).join(', '),
  }));
}
