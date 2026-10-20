// Strategy group: the `strategy-*` actions served by app/api/dashboard/quote-targets/route.js (route key 'quote-targets';
// handlers in features/x-strategy/route-handlers.js, STRATEGY_ROUTE_ACTIONS). Same auth as the rest of that route
// (bearer + admin + `?as=` + pilot owner). Every strategy handler REQUIRES body.clientId === the resolved client, so the
// runtime must send clientId (it always does).
// EXCLUDED here on purpose: strategy-reply-style-* / strategy-unmet-* (the agent has its own tools: get/save_response_style,
// get_unmet_requests / log_unmet_request), strategy-autonomy-save (the agent must never change its own permissions; the runtime also refuses it),
// strategy-action-undo (the agent uses the undo_action tool), strategy-chat-send (recursion), strategy-chat-history (the chat's own transcript),
// strategy-proposal-decide (the agent must never approve its own proposal cards), strategy-review (starts a model chat).
import { str, int, bool, arr, obj, open, day } from './_schema.js';

const S = (id, group, title, description, action, args, extra = {}) => ({
  id, group, title, description, route: 'quote-targets', method: 'POST', action, args, tier: 0, ...extra,
});
const PLAN_SNAP = [{ path: 'x_strategy_plans/{clientId}' }];
const DOC_SNAP = [{ path: 'x_strategy_docs/{clientId}' }];
const BATCH_SPEC = open('Spec {select:{track?|bucketId?|query?|ids?[]}, dateRule:{kind:"spread"|"anniversary", perDay?, startDate?}, limit?}. Preview first.');
const FILL_SPEC = open('Spec {from?: YYYY-MM-DD, days?: 1-31 (default 7), include?: ["baseline","quotes","narratives","client-work"]}. Preview first.');

export const STRATEGY_ACTIONS = [
  S('strategy.get', 'strategy', 'Get the strategy overview', 'Profile, rows meta, evaluation, plan doc, track profiles and today\'s plan preview. Also re-syncs the content tracks (cheap write).', 'strategy-get', obj({}, [])),
  S('strategy.action-log', 'strategy', 'Get the agent action log', 'The 50 most recent actions run through run_action (status, undoable). Same data as get_action_log.', 'strategy-action-log', obj({}, [])),
  S('strategy.autonomy.get', 'strategy', 'Get the agent autonomy setting', 'The owner-set autonomy (tier1 auto|confirm, tier3 confirm|typed). Read-only; only the owner can change it.', 'strategy-autonomy-get', obj({}, [])),
  S('strategy.refresh-status', 'strategy', 'Check a corpus refresh', 'Status of a queued account refresh, or (workerOnly) just the Mac worker heartbeat.', 'strategy-refresh-status',
    obj({ requestId: str('Refresh request id.'), workerOnly: bool('Return only the worker heartbeat.') }, [])),
  S('strategy.evaluate-handle', 'strategy', 'Evaluate an X handle', 'Compares a handle\'s stored posts to the client\'s own (needs a prior refresh). Read-only.', 'strategy-evaluate-handle', obj({ handle: str('X handle, no @.') }, ['handle'])),
  S('strategy.doc.get', 'strategy', 'Get the strategy document', 'The strategy document sections (or the seeded draft) with section metadata.', 'strategy-doc-get', obj({}, [])),
  S('strategy.freshness', 'strategy', 'Get data freshness', 'Per-part freshness of the brief bundle and per-Refresh-group asOf / stale-after hours.', 'strategy-freshness', obj({}, [])),
  S('strategy.calendar-batch.preview', 'strategy', 'Preview a calendar batch', 'Dry run: which library items would become dated drafts and on which days. Writes nothing.', 'strategy-calendar-batch-preview', obj({ spec: BATCH_SPEC }, ['spec'])),
  S('strategy.x-data-sources.get', 'strategy', 'Get the X data sources', 'Where Strategy accounts and Quote targets come from for this client (mac = free bird on the Mac, x-api = paid), the auto-daily flags, and the call/post estimate of one X API run. Read-only.', 'x-data-sources-get', obj({}, [])),
  S('strategy.daily-fill.preview', 'strategy', 'Preview a daily fill', 'Dry run of baseline + quote + narrative + client-work drafts for a run of days. Writes nothing.', 'strategy-daily-fill-preview', obj({ spec: FILL_SPEC }, [])),

  S('strategy.refresh', 'strategy', 'Queue an account refresh', 'Queues a corpus refresh (posts for the own + benchmark handles) for the Mac worker via bird. Free; max 6 handles. Refused (409) when the source is the paid X API; that runs from the Refresh panel.', 'strategy-refresh',
    obj({ handles: arr(str('X handle'), 'Handles; default own + benchmarks.') }, []), { tier: 1 }),
  S('strategy.x-data-sources.save', 'strategy', 'Set the X data sources', 'Chooses mac (free) or x-api (paid) for Strategy accounts and/or Quote targets. Spends nothing by itself; the auto-daily switch is owner-only (Refresh panel).', 'x-data-sources-save',
    obj({ strategyAccounts: str('mac | x-api.', { enum: ['mac', 'x-api'] }), quoteTargets: str('mac | x-api.', { enum: ['mac', 'x-api'] }) }, []),
    { tier: 1, snapshot: [{ path: 'client_configs/{clientId}', field: 'marketingBriefConfig.xGrowth.dataSources' }] }),
  S('strategy.quote-scan.refresh', 'strategy', 'Scan quote targets', 'Scans the watchlist for posts worth quote-reacting to. Source x-api: paid X API, runs on the server (about 2 calls per account, 15 accounts per run). Source mac: runs locally, nothing to start here.', 'quote-scan-refresh', obj({}, []),
    { tier: 3, external: 'paid', viaRefreshPanel: true, refreshGroups: ['quote-targets'], cost: 'Paid X API: up to 15 accounts x (1 lookup + 1 timeline call), max ~180 posts. Free when the source is the Mac.' }),
  S('strategy.hot-quotes.find', 'strategy', 'Find hot quotes', 'Queues the hot quote scan on the Mac: 4 NEW design+music picks to quote. No args = queue (returns requestId, ~4-8 min); with requestId = status + picks. Free bird, ~$0.002 judge. No posting.', 'hot-quotes-find',
    obj({ requestId: str('requestId from the first call; omit to queue a new scan.') }, []), { tier: 1 }),
  S('strategy.plan.apply', 'strategy', 'Change the strategy plan', 'Applies a partial change to the Strategy plan (cadence, floors/caps, engine targets, benchmark, content tracks). Versioned; validated server-side.', 'strategy-plan-apply',
    obj({ changes: open('Partial plan {authoredPerDay?, typeFloors?, typeCaps?, engineTargets?, benchmarkPrimary?, notes?, contentTracks?}.'), expectedVersion: int('Plan version you read; refused if stale.'), reason: str('Why (stored in history).') }, ['changes']),
    { tier: 1, snapshot: PLAN_SNAP, undo: { actionId: 'strategy.plan.revert', argsFrom: { version: 'args.expectedVersion' } } }),
  S('strategy.plan.revert', 'strategy', 'Revert the strategy plan', 'Restores the plan to an earlier version from its history (itself a new version).', 'strategy-plan-revert', obj({ version: int('History version to restore.') }, ['version']), { tier: 1, snapshot: PLAN_SNAP }),
  S('strategy.doc.save', 'strategy', 'Edit the strategy document', 'Replaces the given sections of the strategy document (thesis, audience, tracks, formats, rules, algorithm, decisions, open). Versioned.', 'strategy-doc-save',
    obj({ sections: open('{sectionKey: text} for the sections to change (each max 2000 chars).'), expectedVersion: int('Doc version you read; refused if stale.'), reason: str('Why (stored in history).') }, ['sections']),
    { tier: 1, snapshot: DOC_SNAP, undo: { actionId: 'strategy.doc.revert', argsFrom: { version: 'args.expectedVersion' } } }),
  S('strategy.doc.revert', 'strategy', 'Revert the strategy document', 'Restores the strategy document to an earlier version (itself a new version).', 'strategy-doc-revert', obj({ version: int('History version to restore.') }, ['version']), { tier: 1, snapshot: DOC_SNAP }),
  S('strategy.profile.save', 'strategy', 'Save the X handles profile', 'Sets the own X handle and benchmark handles (keeps the content tracks). Writes the Market Signals xGrowth profile.', 'strategy-profile-save',
    obj({ ownHandle: str('Own X handle, no @.'), benchmarkHandles: arr(str('X handle'), 'Benchmark handles.') }, ['ownHandle']),
    { tier: 1, snapshot: [{ path: 'client_configs/{clientId}', field: 'marketingBriefConfig.xGrowth' }] }),
  S('strategy.calendar-batch.create', 'strategy', 'Create a calendar batch of drafts', 'Creates dated draft posts (reviewOn) from library items by the spec. Drafts only; nothing is scheduled or posted. Idempotent per item/day.', 'strategy-calendar-batch-create',
    obj({ spec: BATCH_SPEC }, ['spec']), { tier: 1 }),
  S('strategy.daily-fill.create', 'strategy', 'Create a daily fill of drafts', 'Creates dated draft posts (baseline/quote/narrative/client-work) for a run of days. Drafts only; idempotent per day/kind/source.', 'strategy-daily-fill-create',
    obj({ spec: FILL_SPEC }, []), { tier: 1 }),
];
