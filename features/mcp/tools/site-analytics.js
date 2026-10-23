// site-analytics.js - owner view of sites HITLOOP tracks with its own beacon (/api/public/site-events; today the
// Underground Existence Arweave site). Same report + visit paths the client MCP serves for a hitloop-provider
// source (features/site-analytics/report.js), plus a test-mode switch for checking the beacon after a deploy.
// Firestore only.

import { SITES } from '../../site-analytics/events.js';
import { getSiteReport, getSessionPaths, REPORT_RANGES, SESSIONS_DEFAULT_LIMIT, SESSIONS_MAX_LIMIT } from '../../site-analytics/report.js';
import { ToolError } from '../jsonrpc.js';
import { defTool, str } from './common.js';

const SITE_LIST = Object.entries(SITES).map(([k, v]) => `"${k}" = ${v.label}`).join(', ');
const DATE = { pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };

const windowProps = (defaultRange) => ({
  site: { type: 'string', enum: Object.keys(SITES), description: 'Which site. Default "ue".' },
  range: { type: 'string', enum: [...REPORT_RANGES], description: `today | 24h (rolling) | 7d | 30d. Default ${defaultRange}. Ignored when from/to are given.` },
  from: str('Custom start date, YYYY-MM-DD in the site timezone. Needs to. At most 90 days.', DATE),
  to: str('Custom end date (inclusive), YYYY-MM-DD in the site timezone, not in the future. Needs from.', DATE),
  testMode: { type: 'boolean', description: 'Only test traffic (?ue_analytics_test=1). Default false.' },
});

function windowOf(args, defaultRange) {
  const site = args.site || 'ue';
  if (!SITES[site]) throw new ToolError(`Unknown site "${site}".`);
  const from = typeof args.from === 'string' ? args.from.trim() : '';
  const to = typeof args.to === 'string' ? args.to.trim() : '';
  return { site, range: args.range || defaultRange, ...(from || to ? { from, to } : {}), testMode: args.testMode === true };
}

// A bad date window (RangeRequestError, expose:true) is the caller's to fix: say why.
const run = async (fn) => { try { return await fn(); } catch (e) { if (e?.expose) throw new ToolError(e.message); throw e; } };

const siteAnalyticsTool = defTool({
  name: 'get_site_analytics',
  title: 'Website analytics (beaconed sites)',
  description: `Visitor analytics for websites HITLOOP tracks with its own beacon (sites: ${SITE_LIST}). Returns analytics.{pageviews, sessions, visitors, engagedVisitPct, bounceRatePct, pagesPerSession, sessionDuration, dailyTrend, sources, referrers, pages, clicks, outboundLinks, mixPlays, countries, cities, devices, live (last 60 min)} plus meta (status, trackingStartDate, eventsTruncated) and definitions. range: today | 24h | 7d | 30d (default 7d) or from/to dates, days in the site's timezone. For individual visits use get_site_sessions. Read-only.`,
  inputSchema: { type: 'object', properties: windowProps('7d') },
  // Counts are keyed by words like "sessions"; key-name redaction would blank them.
  redactKeys: false,
  handler: ({ args, ctx }) => run(() => getSiteReport({ db: ctx.db, now: ctx.now(), ...windowOf(args, '7d') })),
});

const siteSessionsTool = defTool({
  name: 'get_site_sessions',
  title: 'Website visits (paths)',
  description: `Individual visits to a beaconed site (sites: ${SITE_LIST}), newest first: source (campaign, referring site or direct), entry and exit page, every page view, click, engagement and mix play in order with times, duration, bounced, location, device, and a pseudonymous visitor id (the same id on two visits = the same browser returning). range: today | 24h | 7d | 30d (default 24h) or from/to dates. limit: default ${SESSIONS_DEFAULT_LIMIT}, max ${SESSIONS_MAX_LIMIT}. Read-only.`,
  inputSchema: {
    type: 'object',
    properties: { ...windowProps('24h'), limit: { type: 'integer', minimum: 1, maximum: SESSIONS_MAX_LIMIT, description: `Visits to return. Default ${SESSIONS_DEFAULT_LIMIT}.` } },
  },
  redactKeys: false,
  handler: ({ args, ctx }) => run(() => getSessionPaths({ db: ctx.db, now: ctx.now(), limit: args.limit, ...windowOf(args, '24h') })),
});

export const siteAnalyticsTools = Object.freeze([siteAnalyticsTool, siteSessionsTool]);
