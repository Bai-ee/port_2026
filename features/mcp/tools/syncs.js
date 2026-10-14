// syncs.js - sync requests. Free ones run directly; anything that costs money becomes a PROPOSAL CARD:
//   request_sync -> validates + prices -> a "Run a paid sync" card in Marketing Director > Strategy (chat) (thread "MCP").
// It runs only when the OWNER presses Confirm on that card inside HITLOOP (strategy-proposal-decide); MCP has no
// confirm step and never receives a code. The executors live in ../paid-syncs.js (shared with the dashboard route).
// NEVER exposed here: X API writes, posting, scheduling, approving, deleting, sending email, Telegram sends.

import { ToolError } from '../jsonrpc.js';
import { DAILY_PAID_CAP } from '../limits.js';
import { PAID_SYNC_KINDS } from '../../x-strategy/contracts.js';
import { describePaidSync, NAS_ANALYZE_MAX_CAP_USD, NAS_MAX_PATHS } from '../paid-syncs.js';
import { defTool, resolveClientId, CLIENT_ID_PROP, str } from './common.js';

export { NAS_ANALYZE_MAX_CAP_USD, NAS_MAX_PATHS };

const COMMAND_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const authFor = (ctx) => ({ decoded: { email: ctx.email, uid: ctx.uid ?? null } });

function unwrap(res, what) {
  if (res && res.ok === false) throw new ToolError(`${what} failed: ${res.error || `status ${res.status || '?'}`}`);
  return res;
}

// ---- free syncs --------------------------------------------------------------------------------------------

const strategyRefresh = defTool({
  name: 'request_strategy_refresh',
  title: 'Queue a strategy data refresh',
  kind: 'sync',
  description: 'Queue a refresh of the X strategy data (own account + benchmark handles, or a subset of those handles) in the free local ingest queue. No money is spent and nothing is posted: it asks the owner\'s Mac worker to re-pull timelines with the free `bird` reader. Returns a requestId; poll with strategy_get_context or get_document("x_strategy_refresh_requests/<requestId>"). If the Mac worker is offline the request just waits.',
  inputSchema: { type: 'object', properties: { handles: { type: 'array', maxItems: 20, items: str('X handle without @') }, clientId: CLIENT_ID_PROP } },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const handlers = ctx.services.strategyHandlers();
    const asked = Array.isArray(args.handles) && args.handles.length ? args.handles : null;
    if (asked) {
      // Same rule as the in-app agent: only the own handle and the profile/track benchmark handles. (Over MCP there is no
      // owner message that could name another account.)
      const clean = (h) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();
      const known = new Set((await handlers.toolDepsFor(clientId, { clientId, uid: ctx.uid ?? null, email: ctx.email }).getProfileHandles()).map(clean));
      const unknown = asked.filter((h) => !known.has(clean(h)));
      if (unknown.length) throw new ToolError(`Not in the profile (own handle + benchmarks): ${unknown.map((h) => String(h).slice(0, 20)).join(', ')}. Only those can be refreshed over MCP; the owner can add accounts in the Strategy tab.`);
    }
    const body = { clientId, ...(asked ? { handles: asked } : {}) };
    return unwrap(await handlers.handle('strategy-refresh', body, { clientId }, authFor(ctx)), 'Refresh request');
  },
});

const regenerateToday = defTool({
  name: 'regenerate_today_suggestions',
  title: 'Regenerate today\'s suggestions',
  kind: 'sync',
  description: 'Re-run the Content Engine daily loop for today with TEMPLATE drafting only (no AI model call, no cost). Replaces today\'s recommendations with a fresh set; it does not post, schedule or save drafts. Only runs for a client whose Brain is approved, plan built and X connected. Read the result with strategy_get_today_run.',
  inputSchema: { type: 'object', properties: { force: { type: 'boolean', description: 'Regenerate even if a run for today already exists (default false).' }, clientId: CLIENT_ID_PROP } },
  handler: async ({ args, ctx }) => ctx.services.regenerateToday(await resolveClientId(ctx, args), { force: args.force === true }),
});

const nasStatus = defTool({
  name: 'nas_status',
  title: 'NAS worker status',
  description: 'Is the NAS analyzer (the owner\'s Mac) online, when was it last seen, and which NAS sources can be browsed. Needed for sourceId before nas_browse / nas_estimate. Read-only.',
  handler: ({ ctx }) => unwrap(ctx.services.nas('nas-status', {}, ctx.email), 'NAS status'),
});

const nasJobs = defTool({
  name: 'nas_jobs',
  title: 'NAS analyze jobs',
  description: 'The ten most recent NAS analyze/stage jobs with state, progress, estimate and spend. Use it to see the result of a nas_estimate (dry run) or nas_analyze. Read-only.',
  handler: ({ ctx }) => unwrap(ctx.services.nas('nas-jobs', {}, ctx.email), 'NAS jobs'),
});

const nasBrowse = defTool({
  name: 'nas_browse',
  title: 'Browse the NAS library',
  kind: 'sync',
  description: 'List a folder on the NAS library. This queues a LIST_DIRECTORY command for the owner\'s Mac worker and waits ~6 seconds; if it has not answered you get pending:true and a commandId (call again with the same commandId to collect). Free, read-only. The Mac worker must be online (see nas_status).',
  inputSchema: { type: 'object', properties: { sourceId: str('A source id from nas_status'), path: str('Folder path inside the source (empty = root)'), commandId: str('Pass the commandId from a previous pending response', { maxLength: 64 }) }, required: ['sourceId'] },
  handler: ({ args, ctx }) => {
    if (args.commandId !== undefined && !COMMAND_ID_RE.test(String(args.commandId))) throw new ToolError('commandId must be 1-64 characters: letters, digits, _ or -.');
    return unwrap(ctx.services.nas('nas-browse', { sourceId: args.sourceId, path: args.path || '', ...(args.commandId ? { commandId: args.commandId } : {}) }, ctx.email), 'NAS browse');
  },
});

const nasEstimate = defTool({
  name: 'nas_estimate',
  title: 'Estimate a NAS analysis (dry run)',
  kind: 'sync',
  description: 'Dry-run an AI analysis of NAS files: queues an ANALYZE_FACETS command with dryRun, which makes the Mac worker count files and estimate cost WITHOUT calling the model. Free. Read the estimate afterwards with nas_jobs. Then, if the owner agrees, request_sync kind "nas_analyze" creates a card the owner confirms in HITLOOP for the real (paid) run.',
  inputSchema: { type: 'object', properties: { sourceId: str('A source id from nas_status'), paths: { type: 'array', minItems: 1, maxItems: NAS_MAX_PATHS, items: str('File or folder path inside the source') } }, required: ['sourceId', 'paths'] },
  handler: ({ args, ctx }) => unwrap(ctx.services.nas('nas-estimate', { sourceId: args.sourceId, paths: args.paths }, ctx.email), 'NAS estimate'),
});

// ---- paid syncs: a PROPOSAL CARD, never an executor -----------------------------------------------------------

const requestSync = defTool({
  name: 'request_sync',
  title: 'Ask the owner to approve a paid sync',
  kind: 'propose',
  description: `Ask for an action that costs money. This validates the request, prices it, and creates a "Run a paid sync" PROPOSAL CARD in HITLOOP Marketing Director > Strategy (chat) (thread "MCP"). NOTHING RUNS and nothing is spent: the owner must press Confirm on the card inside HITLOOP, and you cannot confirm it for them (there is no confirm tool). Tell the owner the estimated cost and where to confirm. Kinds: ${PAID_SYNC_KINDS.join(', ')}. params per kind: strategy_review {clientId?}; x_monitor_sync {include?: ["profile","posts","audience"]} (X API reads, never writes; the card names the metered call count); nas_analyze {sourceId, paths[], capUsd<=${NAS_ANALYZE_MAX_CAP_USD}}. Market Signals refreshes have no kind here: they run from the Refresh button in the Marketing Director header (group 1), so tell the owner to click it. Max ${DAILY_PAID_CAP} paid syncs run per day.`,
  inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: [...PAID_SYNC_KINDS] }, clientId: CLIENT_ID_PROP, params: { type: 'object', description: 'Kind-specific parameters (see description).' } }, required: ['kind'] },
  handler: async ({ args, ctx }) => {
    if (!PAID_SYNC_KINDS.includes(args.kind)) throw new ToolError(`Unknown kind "${String(args.kind).slice(0, 40)}". Valid: ${PAID_SYNC_KINDS.join(', ')}. (Market Signals refreshes: the owner clicks Refresh in the Marketing Director header, group 1.)`);
    const clientId = await resolveClientId(ctx, { clientId: args.clientId ?? args.params?.clientId });
    const d = await describePaidSync(args.kind, args.params || {}, { ...ctx, clientId }); // price THIS client's account
    const res = await ctx.services.strategyHandlers().createProposalInThread({
      clientId,
      proposals: [{
        kind: 'paid-sync',
        payload: { kind: d.kind, params: d.params, estimate: d.estimate },
        summary: d.summary,
        rationale: `Requested over MCP by ${ctx.email}. Nothing runs until you press Confirm.`,
        evidence: [],
      }],
    });
    if (!res || res.ok === false) {
      const why = res?.dropped?.length ? res.dropped.flatMap((x) => x.errors || []).join('; ') : (res?.error || 'unknown error');
      throw new ToolError(`Paid sync request rejected: ${why}`);
    }
    const proposal = res.proposals[0];
    return {
      created: true, status: 'pending', proposalId: proposal.id, threadId: res.threadId, kind: d.kind, params: d.params, estimatedCost: d.estimate,
      ...(res.dropped?.length ? { dropped: res.dropped } : {}),
      next: 'Nothing has run and nothing was spent. Tell the owner the estimated cost and ask them to press Confirm on the "Run a paid sync" card in HITLOOP Marketing Director > Strategy (chat) (thread "MCP"). You cannot confirm it.',
    };
  },
});

export const syncTools = Object.freeze([strategyRefresh, regenerateToday, nasStatus, nasJobs, nasBrowse, nasEstimate, requestSync]);
