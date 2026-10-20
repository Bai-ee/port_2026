// tools.js - the client-scoped MCP tools. Read-only. Static: no I/O at import.
//
// Handlers get ({args, ctx}) with ctx = {clientId, now, services}. ctx.clientId comes ONLY from the verified token
// (features/client-mcp/auth.js); no tool has a clientId argument, and one passed anyway is ignored. Every service
// call takes ctx.clientId, so a token for client A can never read client B.

import { ToolError } from '../mcp/jsonrpc.js';
import { defTool, str } from '../mcp/tools/common.js';
import { SITE_STATS_RANGES, siteStatsSourceFor, fetchSiteStats } from './sources.js';

export const RANGES = SITE_STATS_RANGES;
const RANGE_MS = Object.freeze({ today: 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 });
const rangeProp = (description) => ({ type: 'string', enum: [...RANGES], description });
const rangeOf = (args, fallback) => (RANGES.includes(args?.range) ? args.range : fallback);

const msOf = (v) => {
  if (!v) return null;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v._seconds === 'number') return v._seconds * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const isoOf = (v) => { const t = msOf(v); return t == null ? null : new Date(t).toISOString(); };
const excerptOf = (t, n = 280) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- get_site_stats ----------------------------------------------------------------------------------------

const siteStatsTool = defTool({
  name: 'get_site_stats',
  title: 'Website stats',
  description: 'Live stats from your website: traffic, sources, pages, CTAs, booking funnel, leads and applicants (counts and trends only). range: today | 7d | 30d (default 7d).',
  inputSchema: { type: 'object', properties: { range: rangeProp('Time range. Default 7d.') } },
  kind: 'external',
  // Site stats are counts keyed by words like "sessions"; key-name redaction would blank them. Values are still scanned.
  redactKeys: false,
  handler: async ({ args, ctx }) => fetchSiteStats({
    source: siteStatsSourceFor(ctx.clientId, ctx.services.sources),
    range: rangeOf(args, '7d'),
    env: ctx.services.env,
    fetchImpl: ctx.services.fetch,
    now: ctx.now(),
  }),
});

// ---- get_client_brain --------------------------------------------------------------------------------------

const BRAIN_SECTIONS = Object.freeze(['identity', 'positioning', 'offers', 'audience', 'proof', 'voice', 'content', 'discovery']);

const clientBrainTool = defTool({
  name: 'get_client_brain',
  title: 'Brand brain + strategy',
  description: 'Your approved brand brain (identity, positioning, offers, audience, proof, voice, content) and your strategy document. part: summary (default) or markdown (the full Brain document text).',
  inputSchema: { type: 'object', properties: { part: { type: 'string', enum: ['summary', 'markdown'], description: 'summary (default) or markdown.' } } },
  handler: async ({ args, ctx }) => {
    const [brain, strategy] = await Promise.all([
      ctx.services.readBrainDoc(ctx.clientId),
      ctx.services.readStrategyDoc(ctx.clientId).catch(() => null),
    ]);
    const approved = brain?.status === 'approved';
    const out = {
      brain: brain
        ? { status: brain.status || null, version: brain.version ?? null, approvedAt: isoOf(brain.approvedAt), updatedAt: brain.updatedAtIso || isoOf(brain.updatedAt) }
        : null,
      strategyDocument: strategy || null,
    };
    if (!brain) out.note = 'No brand brain exists yet.';
    else if (!approved) out.note = 'The brand brain is not approved yet, so its contents are not shared.';
    else if (args?.part === 'markdown') out.brain.markdown = brain.markdownSource || null;
    else for (const k of BRAIN_SECTIONS) if (brain[k] !== undefined) out.brain[k] = brain[k];
    return out;
  },
});

// ---- get_content_calendar / get_post_results ---------------------------------------------------------------

const NOT_PLANNED = new Set(['posted', 'failed', 'cancelled', 'canceled', 'deleted', 'rejected', 'archived']);

const postRow = (p) => ({
  id: p.id || null, status: p.status || null, platform: p.platform || null, kind: p.kind || null,
  scheduledAt: isoOf(p.scheduledAt), text: excerptOf(p.content), mediaType: p.mediaType || null, bucketId: p.bucketId || null,
});

const calendarTool = defTool({
  name: 'get_content_calendar',
  title: 'Content calendar',
  description: 'Planned and queued posts: scheduled in the next range (today = next 24 h, 7d, 30d; default 7d), plus undated drafts, and today\'s plan.',
  inputSchema: { type: 'object', properties: { range: rangeProp('How far ahead. Default 7d.') } },
  handler: async ({ args, ctx }) => {
    const range = rangeOf(args, '7d');
    const now = ctx.now();
    const until = now + RANGE_MS[range];
    const [posts, today] = await Promise.all([ctx.services.readPosts(ctx.clientId), ctx.services.readTodayPlan(ctx.clientId).catch(() => null)]);
    const planned = posts.filter((p) => !NOT_PLANNED.has(p.status));
    const scheduled = planned.filter((p) => { const t = msOf(p.scheduledAt); return t != null && t >= now && t <= until; })
      .sort((a, b) => msOf(a.scheduledAt) - msOf(b.scheduledAt));
    const undated = planned.filter((p) => msOf(p.scheduledAt) == null);
    return {
      range, from: new Date(now).toISOString(), until: new Date(until).toISOString(),
      scheduled: scheduled.slice(0, 100).map(postRow),
      undatedDrafts: { count: undated.length, items: undated.slice(0, 25).map(postRow) },
      today,
    };
  },
});

const resultsTool = defTool({
  name: 'get_post_results',
  title: 'Post results',
  description: 'Posts that went out in the last range (today = last 24 h, 7d, 30d; default 30d) with their performance numbers as recorded. Missing metrics mean not measured, not zero.',
  inputSchema: { type: 'object', properties: { range: rangeProp('How far back. Default 30d.') } },
  handler: async ({ args, ctx }) => {
    const range = rangeOf(args, '30d');
    const now = ctx.now();
    const since = now - RANGE_MS[range];
    const posted = (await ctx.services.readPosts(ctx.clientId))
      .filter((p) => p.status === 'posted' && (msOf(p.postedAt) ?? 0) >= since)
      .sort((a, b) => msOf(b.postedAt) - msOf(a.postedAt));
    return {
      range, since: new Date(since).toISOString(), count: posted.length,
      posts: posted.slice(0, 100).map((p) => ({
        id: p.id || null, platform: p.platform || null, kind: p.kind || null, postedAt: isoOf(p.postedAt), text: excerptOf(p.content),
        url: p.permalink || null, platformPostId: p.twitterId || null, mediaType: p.mediaType || null, performance: p.performance ?? null,
      })),
    };
  },
});

// ---- get_marketing_data ------------------------------------------------------------------------------------
// Every marketing section of the client's dashboard record, read live: a brief run shows up on the next call.
// New sections appear automatically; only internal/ops fields are left out.

export const HIDDEN_STATE_KEYS = Object.freeze(new Set([
  'clientId', 'status', 'updatedAt', 'latestRunId', 'latestRunStatus', 'errorState', 'provisioningState', 'onboard',
  'studioCaptures', 'studioVideoPending', 'studioVariantIndex',
  'clientBrain', // served by get_client_brain (approved-only)
]));
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,80}$/;
const sizeOf = (v) => { try { return JSON.stringify(v ?? null).length; } catch { return 0; } };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function sectionIndex(state) {
  const out = [{ section: 'report', what: 'Market Signals report (the same summary the email and executive brief use)' }];
  for (const [k, v] of Object.entries(state)) {
    if (HIDDEN_STATE_KEYS.has(k) || v == null) continue;
    out.push({ section: k, size: sizeOf(v), ...(isObj(v) ? { parts: Object.keys(v).slice(0, 40) } : {}) });
  }
  return out;
}

const marketingDataTool = defTool({
  name: 'get_marketing_data',
  title: 'Marketing data',
  description: 'Your marketing data from HITLOOP, live (a new brief run shows up immediately). No section: an index of what exists. section: "report" for the Market Signals report, a top-level section such as "marketingBrief", or a dotted path such as "marketingBrief.reportSnapshot.redditAnalysis".',
  inputSchema: { type: 'object', properties: { section: str('Section name or dotted path (up to 4 parts). Omit for the index.', { maxLength: 200 }) } },
  handler: async ({ args, ctx }) => {
    const state = (await ctx.services.readDashboardState(ctx.clientId)) || null;
    if (!state) return { note: 'No marketing data yet. It appears after the first brief run.', sections: [] };
    const meta = { updatedAt: isoOf(state.updatedAt), briefGeneratedAt: state.marketingBrief?.generatedAtIso || null };
    const section = typeof args?.section === 'string' ? args.section.trim() : '';
    if (!section) return { ...meta, sections: sectionIndex(state) };
    if (section === 'report') return { ...meta, section, data: state.marketingBrief ? ctx.services.projectBrief(state.marketingBrief, state) : null };
    const parts = section.split('.');
    if (parts.length > 4 || !parts.every((p) => SEGMENT_RE.test(p))) throw new ToolError('section must be a name or dotted path of letters, digits, _ or - (up to 4 parts).');
    if (HIDDEN_STATE_KEYS.has(parts[0])) throw new ToolError(`"${parts[0]}" is not shared here.${parts[0] === 'clientBrain' ? ' Use get_client_brain.' : ''}`);
    let v = state;
    for (const p of parts) v = isObj(v) && Object.hasOwn(v, p) ? v[p] : undefined;
    if (v === undefined) throw new ToolError(`No section "${section}". Call get_marketing_data with no section for the index.`);
    return { ...meta, section, ...(isObj(v) ? { parts: Object.keys(v).slice(0, 60) } : {}), data: v };
  },
});

export const clientRegistry = Object.freeze([siteStatsTool, clientBrainTool, calendarTool, resultsTool, marketingDataTool]);

export const CLIENT_INSTRUCTIONS = [
  'HITLOOP client data (read-only). Every tool answers for one client only: the one this connection belongs to.',
  'get_site_stats = live website stats; get_client_brain = brand brain + strategy; get_content_calendar = planned posts;',
  'get_post_results = what went out and how it did; get_marketing_data = Market Signals reports and every other brief output.',
  'Nothing here can post, schedule, approve or change anything. Keep answers short and cite the range or section used.',
].join(' ');
