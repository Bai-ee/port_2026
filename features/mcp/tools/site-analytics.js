// site-analytics.js - owner view of sites HITLOOP tracks with its own beacon (/api/public/site-events; today the
// Underground Existence Arweave site). Same report the client MCP's get_site_stats returns for that site's client
// (features/site-analytics/report.js), plus a test-mode switch for checking the beacon after a deploy. Firestore only.

import { SITES } from '../../site-analytics/events.js';
import { getSiteReport, REPORT_RANGES } from '../../site-analytics/report.js';
import { ToolError } from '../jsonrpc.js';
import { defTool } from './common.js';

const siteAnalyticsTool = defTool({
  name: 'get_site_analytics',
  title: 'Website analytics (beaconed sites)',
  description: `Visitor analytics for websites HITLOOP tracks with its own beacon (sites: ${Object.entries(SITES).map(([k, v]) => `"${k}" = ${v.label}`).join(', ')}). Returns analytics.{pageviews, sessions, visitors, engagedVisitPct, bounceRatePct, pagesPerSession, sessionDuration, dailyTrend, sources, referrers, pages, clicks, outboundLinks, mixPlays, countries, cities, devices, live (last 60 min)} plus meta (status, trackingStartDate, eventsTruncated) and definitions. range: today | 24h | 7d | 30d (default 7d), days in the site's timezone. testMode true shows only test traffic (?ue_analytics_test=1). Read-only.`,
  inputSchema: {
    type: 'object',
    properties: {
      site: { type: 'string', enum: Object.keys(SITES), description: 'Which site. Default "ue".' },
      range: { type: 'string', enum: [...REPORT_RANGES], description: 'Default 7d.' },
      testMode: { type: 'boolean', description: 'Only test traffic. Default false.' },
    },
  },
  // Counts are keyed by words like "sessions"; key-name redaction would blank them.
  redactKeys: false,
  handler: async ({ args, ctx }) => {
    const site = args.site || 'ue';
    if (!SITES[site]) throw new ToolError(`Unknown site "${site}".`);
    return getSiteReport({ db: ctx.db, site, range: args.range || '7d', now: ctx.now(), testMode: args.testMode === true });
  },
});

export const siteAnalyticsTools = Object.freeze([siteAnalyticsTool]);
