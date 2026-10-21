// tools.js - the client-scoped MCP tools. Read-only. Static: no I/O at import.
//
// Handlers get ({args, ctx}) with ctx = {clientId, now, services}. ctx.clientId comes ONLY from the verified token
// (features/client-mcp/auth.js); no tool has a clientId argument, and one passed anyway is ignored. Every service
// call takes ctx.clientId, so a token for client A can never read client B.

import { ToolError } from '../mcp/jsonrpc.js';
import { defTool, str } from '../mcp/tools/common.js';
import { SITE_STATS_RANGES, PEOPLE_RANGES, PEOPLE_ID_RE, siteStatsSourceFor, fetchSiteStats, fetchSitePeople } from './sources.js';

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
  description: 'PRIMARY SOURCE. Live stats from the client\'s own website: visits, traffic sources, top pages, CTA clicks, booking funnel, leads and applicants (counts and trends only; for names, contact details and answers use get_leads, get_email_captures and get_applicants). Call this first for any question about how the site or business is doing. range: today | 7d | 30d (default 7d). If stats.degraded lists parts, those parts fell back to zeros.',
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

// ---- people: leads / email captures / applicants -----------------------------------------------------------
// Person-level data from the same site (owner-approved 2026-10-21: anyone with the connect link may read it).
// redactKeys:false so field names like "email"/"phone" are not blanked; secret-looking VALUES are still scrubbed.

const PEOPLE_DEFAULT_LIMIT = 25;
const PEOPLE_MAX_LIMIT = 50;
// toolResult caps at RESULT_MAX_CHARS (40000) with a plain slice, which would cut JSON mid-object. Keep the
// serialized list under this budget by dropping whole items from the end and saying so.
const PEOPLE_BUDGET_CHARS = 34_000;
const peopleRange = (args) => (PEOPLE_RANGES.includes(args?.range) ? args.range : '30d');
const peopleRangeProp = { type: 'string', enum: [...PEOPLE_RANGES], description: 'today | 7d | 30d | all. Default 30d.' };
const limitProp = { type: 'integer', minimum: 1, maximum: PEOPLE_MAX_LIMIT, description: `How many records, newest first. Default ${PEOPLE_DEFAULT_LIMIT}, max ${PEOPLE_MAX_LIMIT}.` };
const idProp = { type: 'string', pattern: PEOPLE_ID_RE.source, maxLength: 128, description: 'The record id from the list tool.' };

function peopleRequest(ctx, params) {
  return fetchSitePeople({
    source: siteStatsSourceFor(ctx.clientId, ctx.services.sources),
    env: ctx.services.env, fetchImpl: ctx.services.fetch, now: ctx.now(), ...params,
  });
}

function fitItems(res) {
  if (!Array.isArray(res.items)) return res;
  const items = [...res.items];
  const size = () => JSON.stringify({ ...res, items }, null, 1).length;
  while (items.length > 1 && size() > PEOPLE_BUDGET_CHARS) items.pop();
  if (items.length === res.items.length) return res;
  return { ...res, items, count: items.length, note: `Showing the first ${items.length} of ${res.items.length} fetched records (size cap). Ask with a smaller limit, a narrower range, or open one record by id.` };
}

const peopleListTool = ({ name, title, kind, description, withStage }) => defTool({
  name, title, description,
  inputSchema: { type: 'object', properties: { range: peopleRangeProp, ...(withStage ? { stage: str('Only applicants in this pipeline stage (as shown in stageLabel/stage).', { maxLength: 60 }) } : {}), limit: limitProp } },
  kind: 'external',
  redactKeys: false,
  handler: async ({ args, ctx }) => {
    const n = Number.isInteger(args?.limit) ? Math.min(Math.max(args.limit, 1), PEOPLE_MAX_LIMIT) : PEOPLE_DEFAULT_LIMIT;
    const stage = withStage && typeof args?.stage === 'string' ? args.stage.trim().slice(0, 60) : undefined;
    return fitItems(await peopleRequest(ctx, { kind, range: peopleRange(args), stage, limit: n }));
  },
});

const peopleOneTool = ({ name, title, kind, description }) => defTool({
  name, title, description,
  inputSchema: { type: 'object', properties: { id: idProp }, required: ['id'] },
  kind: 'external',
  redactKeys: false,
  handler: async ({ args, ctx }) => {
    const id = typeof args?.id === 'string' ? args.id.trim() : '';
    if (!PEOPLE_ID_RE.test(id)) throw new ToolError('id must be 1-128 letters, digits, _ or -. Take it from the list tool.');
    return peopleRequest(ctx, { kind, id });
  },
});

const leadsTool = peopleListTool({
  name: 'get_leads', title: 'Leads (Meet & Greet requests)', kind: 'leads',
  description: 'People who filled in the Meet & Greet form, with full details: owner name, email, phone, neighborhood, dog name, breed/age, service interest, vaccinations, walk frequency, reactivity, allergies, spay/neuter, dog and stranger social, notes, source, and whether they self-reported booking. Use for "who signed up", "who are the new leads", "names", "contact details", "what did X answer". Newest first. range: today | 7d | 30d | all (default 30d). Quote values as recorded.',
});
const leadTool = peopleOneTool({
  name: 'get_lead', title: 'One lead', kind: 'leads',
  description: 'One Meet & Greet lead with every answer. Needs the id from get_leads.',
});
const capturesTool = peopleListTool({
  name: 'get_email_captures', title: 'Email captures', kind: 'captures',
  description: 'People who left only their email (started but did not finish the questionnaire): email, source, first and last seen, whether they self-reported booking. Use for "who gave us their email", "unfinished sign-ups". range: today | 7d | 30d | all (default 30d).',
});
const applicantsTool = peopleListTool({
  name: 'get_applicants', title: 'Job applicants', kind: 'applicants', withStage: true,
  description: 'Job applicants with every answer: name, email, phone, pipeline stage (stage, stageLabel, onHold), source/utm, all application answers, notes and any AI summary. Use for "who applied", "applicant names", "contact details", "what did X answer", "who is on hold". Optional stage filter. range: today | 7d | 30d | all (default 30d). Newest first.',
});
const applicantTool = peopleOneTool({
  name: 'get_applicant', title: 'One applicant', kind: 'applicants',
  description: 'One applicant with every answer, notes and AI summary. Needs the id from get_applicants.',
});

// ---- get_client_brain --------------------------------------------------------------------------------------

const BRAIN_SECTIONS = Object.freeze(['identity', 'positioning', 'offers', 'audience', 'proof', 'voice', 'content', 'discovery']);

const clientBrainTool = defTool({
  name: 'get_client_brain',
  title: 'Brand brain + strategy',
  description: 'Secondary. The client\'s approved brand profile (identity, positioning, offers, audience, proof, voice) and strategy document. Use for questions about brand, offers or tone. part: summary (default) or markdown (the full document text).',
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
  description: 'Secondary. The client\'s planned social posts: scheduled in the next range (today = next 24 h, 7d, 30d; default 7d), plus undated drafts, and today\'s plan.',
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
  description: 'Secondary. The client\'s social posts that went out in the last range (today = last 24 h, 7d, 30d; default 30d) with their performance numbers as recorded. Missing metrics mean not measured, not zero.',
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
  description: 'Secondary. Marketing research and reports prepared for the client: Market Signals report (local search, social, Reddit/Instagram chatter, competitors), SEO audit and other brief outputs. Check briefGeneratedAt and say how old it is. No section: an index of what exists. section: "report" for the Market Signals report, a top-level section such as "seoAudit", or a dotted path such as "marketingBrief.reportSnapshot.redditAnalysis".',
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

// ---- get_daily_update --------------------------------------------------------------------------------------
// The opener: one call that answers "what do you know / give me an update / get started". Every part is fail-soft,
// so one broken source still leaves the rest of the update. Site fields follow nottherug.com/api/stats
// (lib/server/siteStats.ts there); a site with another shape gets nulls, never guessed numbers.

const BRIEF_STALE_DAYS = 30;
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const settle = (fn) => Promise.resolve().then(fn).then((value) => ({ value }), (e) => ({ error: e?.expose ? e.message : 'not available right now' }));

function localDate(ms, timeZone) {
  try { return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(ms)); }
  catch { return new Date(ms).toISOString().slice(0, 10); }
}

// Site-local calendar date (YYYY-MM-DD) and hour for an instant; dates are shifted by whole days on the string so DST is safe.
function localParts(ms, timeZone) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
  } catch { return { date: new Date(ms).toISOString().slice(0, 10), hour: new Date(ms).getUTCHours() }; }
}
const shiftDate = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dateLabel = (ymd) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${ymd}T12:00:00Z`));

// One 7d fetch feeds both days: visits/pageviews from the dailyTrend row for that site-local date, leads from
// leads.today / leads.yesterday (byDay as fallback). A missing row or field stays null, never 0.
function siteDay(s, date, leadsDirect) {
  const row = Array.isArray(s.analytics?.dailyTrend) ? s.analytics.dailyTrend.find((r) => r?.date === date) : null;
  const byDay = Array.isArray(s.leads?.byDay) ? s.leads.byDay.find((r) => r?.date === date) : null;
  return {
    date, label: dateLabel(date),
    visits: numOrNull(row?.sessions),
    pageviews: numOrNull(row?.pageviews),
    leads: numOrNull(leadsDirect) ?? numOrNull(byDay?.count),
  };
}

function siteUpdate(res, now) {
  if (res.error) return { error: res.error };
  const s = res.value?.stats || {};
  const a = s.analytics || {};
  const timeZone = s.leads?.timezone || a.range?.timezone || 'UTC';
  const { date, hour } = localParts(now, timeZone);
  const today = siteDay(s, date, s.leads?.today);
  const yesterday = siteDay(s, shiftDate(date, -1), s.leads?.yesterday);
  const empty = (d) => !d.visits && !d.leads;
  // Early in the site's day (or nothing yet) "today" is a misleading empty day: lead with yesterday, today is "so far".
  const leadWithYesterday = (hour < 6 || empty(today)) && !(yesterday.visits == null && yesterday.leads == null);
  return {
    fetchedAt: res.value.fetchedAt,
    timeZone,
    leadWithYesterday,
    today,
    yesterday,
    // bookedLeads / inquiries / appointments only exist as range totals: these are 7-day figures, not daily ones.
    last7Days: {
      leadsBooked: numOrNull(a.bookedLeads),
      inquiries: numOrNull(a.inquiries),
      appointmentsScheduled: numOrNull(a.appointmentsScheduled),
      newApplicants: numOrNull(s.applicants?.last7Days),
    },
    applicants: s.applicants
      ? { last7Days: numOrNull(s.applicants.last7Days), total: numOrNull(s.applicants.total), onHold: numOrNull(s.applicants.onHold), note: 'The site counts applicants by 7 days and in total; there is no per-day count.' }
      : null,
    degraded: Array.isArray(s.degraded) ? s.degraded : [],
  };
}

export const DAILY_UPDATE_FORMAT = [
  'Reply with exactly this, filled from the data (each line short; "n/a" for a null number, never 0):',
  'If site.leadWithYesterday is true, the first line is Yesterday and Today comes second; otherwise Today first, then Yesterday:',
  '**Yesterday (<site.yesterday.label>)**: Visits <visits> · Leads <leads>',
  '**Today so far (<site.today.label>)**: Visits <visits> · Leads <leads>',
  '**Last 7 days**: Booked <site.last7Days.leadsBooked> · New applicants <site.last7Days.newApplicants>   (7-day totals: never call them daily)',
  '**Marketing**: <one line: latest brief date and age, posts out in the last 7 days, anything stale>',
  '**Scheduled**: <count> posts in the next 7 days, next: <time> "<excerpt>" (or "nothing scheduled")',
  '**Latest brief (<date>)**: <1-2 sentences from brief.headline / brief.summary>',
  'Then one line: "Ask me about traffic, leads, posts or the brief." If the user also asked something, answer it after this.',
  'If a part has an error, say that part is not available and why, in a few words. If site.degraded lists parts, those numbers fell back to zeros: say so.',
].join('\n');

const dailyUpdateTool = defTool({
  name: 'get_daily_update',
  title: 'Daily update (start here)',
  description: 'START HERE. Call this first, before any other tool, when the user opens a conversation or asks a general question: hi, what do you know, give me an update, what can you tell me, boot up, get started, catch me up, status, how are we doing. One call returns yesterday\'s and today\'s site numbers (visits, leads), 7-day booked leads and applicants, marketing status, scheduled posts and a blurb from the latest brief, plus replyFormat: answer exactly in that format.',
  inputSchema: { type: 'object', properties: {} },
  kind: 'external',
  // Same reason as get_site_stats: counts keyed by words like "sessions" must not be blanked.
  redactKeys: false,
  handler: async ({ ctx }) => {
    const now = ctx.now();
    const s = ctx.services;
    const [site, posts, today, state] = await Promise.all([
      settle(() => fetchSiteStats({ source: siteStatsSourceFor(ctx.clientId, s.sources), range: '7d', env: s.env, fetchImpl: s.fetch, now })),
      settle(() => s.readPosts(ctx.clientId)),
      settle(() => s.readTodayPlan(ctx.clientId)),
      settle(() => s.readDashboardState(ctx.clientId)),
    ]);
    const siteOut = siteUpdate(site, now);

    let scheduled;
    let postedLast7Days = null;
    if (posts.error) scheduled = { error: posts.error };
    else {
      const rows = posts.value || [];
      const planned = rows.filter((p) => !NOT_PLANNED.has(p.status));
      const upcoming = planned
        .filter((p) => { const t = msOf(p.scheduledAt); return t != null && t >= now && t <= now + RANGE_MS['7d']; })
        .sort((a, b) => msOf(a.scheduledAt) - msOf(b.scheduledAt));
      scheduled = {
        next7Days: upcoming.length,
        next: upcoming.slice(0, 3).map((p) => ({ scheduledAt: isoOf(p.scheduledAt), platform: p.platform || null, text: excerptOf(p.content, 120) })),
        undatedDrafts: planned.filter((p) => msOf(p.scheduledAt) == null).length,
        todaysPlan: today.error ? null : today.value?.tracks ?? null,
      };
      postedLast7Days = rows.filter((p) => p.status === 'posted' && (msOf(p.postedAt) ?? 0) >= now - RANGE_MS['7d']).length;
    }

    let marketing;
    let brief = null;
    if (state.error) { marketing = { error: state.error }; brief = { error: state.error }; }
    else if (!state.value?.marketingBrief) marketing = { postedLast7Days, note: 'No marketing brief yet. It appears after the first brief run.' };
    else {
      const p = s.projectBrief(state.value.marketingBrief, state.value) || {};
      const generatedAt = isoOf(p.generatedAt || state.value.marketingBrief.generatedAtIso);
      const ageDays = generatedAt ? Math.floor((now - Date.parse(generatedAt)) / 86_400_000) : null;
      marketing = {
        briefGeneratedAt: generatedAt, briefAgeDays: ageDays, briefStale: ageDays != null && ageDays > BRIEF_STALE_DAYS,
        postedLast7Days,
        opportunities: Array.isArray(p.opportunities) ? p.opportunities.length : null,
        competitorFindings: Array.isArray(p.competitors) ? p.competitors.length : null,
      };
      brief = { generatedAt, headline: excerptOf(p.headline, 200) || null, summary: excerptOf(p.humanBrief || p.delta, 400) || null };
    }

    return { date: localDate(now, siteOut.timeZone || 'UTC'), site: siteOut, marketing, scheduled, brief, replyFormat: DAILY_UPDATE_FORMAT };
  },
});

export const clientRegistry = Object.freeze([dailyUpdateTool, siteStatsTool, leadsTool, leadTool, capturesTool, applicantsTool, applicantTool, clientBrainTool, calendarTool, resultsTool, marketingDataTool]);

// Sent on initialize: how the assistant should weigh and phrase answers for this one client.
export function clientInstructions({ label, siteUrl }) {
  const name = String(label || 'this client');
  const site = siteUrl ? new URL(siteUrl).hostname : null;
  return [
    `You are ${name}'s business assistant. This connection holds ${name}'s own data only; answer about ${name}${site ? ` and ${site}` : ''}, nothing else.`,
    'OPENING: when a conversation starts, or the user asks something general (hi, what do you know, give me an update, what can you tell me, boot up, get started, catch me up, status), call get_daily_update first and reply in its replyFormat: short and brief. Then answer any specific question.',
    site
      ? `PRIMARY: the website's live analytics. For any question about how the site or business is doing (visits, traffic, sources, pages, bookings, leads, applicants), call get_site_stats first (default 7d; use today or 30d when asked) and lead with those numbers and the trend.`
      : 'No website stats source is connected for this client yet; say so if asked about visits, leads or applicants.',
    'PEOPLE: you can look up individual leads, email captures and applicants (names, contact details, every answer) with get_leads, get_lead, get_email_captures, get_applicants and get_applicant. When asked about people, use them; quote values exactly as recorded and never invent contact details.',
    'SECONDARY: the marketing work prepared for them: get_marketing_data (Market Signals report, SEO audit, brief outputs), get_content_calendar, get_post_results, get_client_brain (brand, offers, voice). Use these after the site numbers, or when asked directly.',
    'HITLOOP is only the agency service that pipes this data in. Do not describe HITLOOP, its tools, its owner or other clients, and never present HITLOOP\'s own business as the client\'s.',
    'Never estimate or invent a number: if it is not in the data, say it is not available. Always state the range and the date the data is from (fetchedAt, briefGeneratedAt); call out marketing reports older than 30 days as old. If stats.degraded lists parts, say those parts fell back to zeros.',
    'Answer style: short and plain. Numbers first, then a one-line takeaway, then at most 3 practical suggestions. Read-only: you cannot post, schedule, approve or change anything.',
  ].join('\n');
}
