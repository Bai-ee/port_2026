// client-brief.js - publish a client-facing brief (hosted URL + PDF) from pasted text, over MCP.
// Calls the SAME route the dashboard's Studio > CLIENT BRIEF (/dashboard/studio?tool=brief) calls (app/api/dashboard/custom-briefs), in-process,
// with the owner's own dashboard authorization (../owner-session.js) and `?as=<clientId>` so the brief lands on the
// requested client (getDashboardBootstrap honours `as` for admins; a non-provisioned client is a 403, never a silent
// fallback to the owner's home client). The route is imported lazily so the registry stays I/O-free at import.

import { ToolError } from '../jsonrpc.js';
import { defTool, resolveClientId, CLIENT_ID_PROP, str } from './common.js';
import { ownerAuthorization } from '../owner-session.js';
import { reserveDailyClientBriefSlot } from '../limits.js';

const MAX_TEXT = 50000;
const THEME_IDS = ['ledger', 'editorial', 'studio-dark'];
const KIND = 'client-brief';
const NO_SESSION = "Could not open the owner's dashboard session; publish from HITLOOP Studio > CLIENT BRIEF (/dashboard/studio?tool=brief) instead.";
const BRIEF_SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/i;
const CLIENT_BRIEF_SLUG_RE = /^client-brief-\d{8}-[0-9a-f]{16}$/;
const arrOfStr = (description, maxItems, maxLength) => ({ type: 'array', description, maxItems, items: { type: 'string', maxLength } });

const loadRoute = async (ctx) => ctx.services?.customBriefsRoute
  ? { route: await ctx.services.customBriefsRoute(), plain: true }
  : { route: await import('../../../app/api/dashboard/custom-briefs/route.js'), plain: false };

/**
 * Build the in-process request. The custom-briefs route reads `request.nextUrl` (origin, searchParams), which a
 * plain Request lacks, so attach a URL as `nextUrl`. No dependency on next/server, so it cannot fall back silently.
 */
async function buildRequest(_plain, url, init) {
  const request = new Request(url, init);
  Object.defineProperty(request, 'nextUrl', { value: new URL(url), enumerable: false });
  return request;
}

async function callRoute(ctx, clientId, method, { query = {}, body } = {}) {
  const authorization = await (ctx.services?.ownerAuthorization || ownerAuthorization)({ email: ctx.email });
  if (!authorization) throw new ToolError(NO_SESSION);
  const origin = String(ctx.origin || process.env.MCP_PUBLIC_ORIGIN || '').replace(/\/+$/, '');
  if (!origin) throw new ToolError('The public origin is not known on this deployment; publish from HITLOOP Studio > CLIENT BRIEF (/dashboard/studio?tool=brief) instead.');
  const { route, plain } = await loadRoute(ctx);
  const handler = route?.[method];
  if (typeof handler !== 'function') throw new ToolError('The client brief route is not available on this deployment.');
  const qs = new URLSearchParams({ ...query, as: clientId });
  const init = { method, headers: { authorization, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) };
  const res = await handler(await buildRequest(plain, `${origin}/api/dashboard/custom-briefs?${qs}`, init));
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (res.status >= 400 || !json || json.error) throw new ToolError(`Client brief request failed: ${json?.error || 'unknown error'} (${res.status})`);
  // Never trust the route's client resolution: the result must be for the client that was asked for.
  if (json.clientId !== clientId) throw new ToolError(`Refused: the route answered for client "${json.clientId}", not "${clientId}". Nothing was reported as published; check HITLOOP Studio > CLIENT BRIEF (/dashboard/studio?tool=brief).`);
  return json;
}

const absUrl = (origin, v) => (v && /^https?:\/\//i.test(v) ? v : v ? `${origin}${v}` : null);

const publishClientBrief = defTool({
  name: 'publish_client_brief',
  title: 'Publish client brief',
  kind: 'sync',
  description: `Publish a CLIENT-FACING brief for a client from pasted text, exactly like HITLOOP Studio > CLIENT BRIEF (/dashboard/studio?tool=brief). WRITES: this creates a PUBLIC hosted page plus a PDF that the owner can forward to the client. Call this tool DIRECTLY to publish a client brief: do NOT use find_actions or chat_send for it (chat_send can also do it via the registry action briefs.client.publish, but this is the reliable path). Use it ONLY when the owner explicitly asks to make/publish (or update) a client brief. "text" is the client-facing Markdown, rendered exactly as pasted (headings, lists, tables, bold, links, code blocks stay in order; no restructuring, no model call, no live data); NEVER include internal notes, costs, strategy or anything the client should not see. Pass clientId. Optional theme: ledger | editorial | studio-dark (built-in document looks; default = the plain invoice look). Optional link-preview (share image) fields: ogLabel, ogSubhead, hideOgSubhead, ogTitleLines (up to 3 headline lines), ogLines (up to 2 extra lines). Pass briefSlug of an existing client brief to UPDATE it in place (same URL; the PDF is re-rendered); updates count against the same daily cap. Chat apps cache link previews, so an update will not refresh an already-shared preview. Returns publicUrl, pdfUrl, ogImageUrl, briefSlug, clientId, title and warnings (a PDF warning is non-fatal). Undo with unpublish_client_brief.`,
  inputSchema: {
    type: 'object',
    properties: {
      clientId: CLIENT_ID_PROP,
      text: str(`The client-facing Markdown text. Max ${MAX_TEXT} characters.`, { maxLength: MAX_TEXT }),
      title: str('Optional title; otherwise the first H1 of the text.'),
      briefSlug: str('Optional: briefSlug of an existing client brief (from list_client_briefs) to update in place.'),
      theme: str('Optional built-in document theme (ledger | editorial | studio-dark). Omitted: the default look (a new brief) or the brief\'s current theme (an update).', { enum: THEME_IDS }),
      ogLabel: str('Optional share-image label (default HITLOOP).', { maxLength: 80 }),
      ogSubhead: str('Optional share-image subhead (default: first paragraph).', { maxLength: 160 }),
      hideOgSubhead: { type: 'boolean', description: 'Hide the share-image subhead line.' },
      ogTitleLines: arrOfStr('Optional share-image headline lines (max 3, 40 chars each); blank = auto from the title.', 3, 40),
      ogLines: arrOfStr('Optional extra share-image lines (max 2, 120 chars each).', 2, 120),
    },
    required: ['text'],
  },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const text = typeof args?.text === 'string' ? args.text : '';
    if (!text.trim()) throw new ToolError('text is required (the client-facing breakdown).');
    if (text.length > MAX_TEXT) throw new ToolError(`text is too long (${text.length} characters; max ${MAX_TEXT}).`);
    const title = typeof args?.title === 'string' ? args.title.trim().slice(0, 140) : '';
    const briefSlug = typeof args?.briefSlug === 'string' ? args.briefSlug.trim() : '';
    if (briefSlug && !CLIENT_BRIEF_SLUG_RE.test(briefSlug)) throw new ToolError('briefSlug is not a client brief id (use list_client_briefs).');
    if (args?.theme !== undefined && args?.theme !== null && !THEME_IDS.includes(args.theme)) throw new ToolError(`theme must be one of: ${THEME_IDS.join(', ')}.`);
    const og = {};
    if (typeof args?.theme === 'string') og.theme = args.theme;
    if (typeof args?.ogLabel === 'string') og.ogLabel = args.ogLabel.slice(0, 80);
    if (typeof args?.ogSubhead === 'string') og.ogSubhead = args.ogSubhead.slice(0, 160);
    if (typeof args?.hideOgSubhead === 'boolean') og.hideOgSubhead = args.hideOgSubhead;
    if (Array.isArray(args?.ogTitleLines)) og.ogTitleLines = args.ogTitleLines.filter((l) => typeof l === 'string').slice(0, 3).map((l) => l.slice(0, 40));
    if (Array.isArray(args?.ogLines)) og.ogLines = args.ogLines.filter((l) => typeof l === 'string').slice(0, 2).map((l) => l.slice(0, 120));
    if (typeof ctx.services?.counters === 'function') await reserveDailyClientBriefSlot(ctx.services.counters(), { now: ctx.now() });
    const json = await callRoute(ctx, clientId, 'POST', { body: { kind: KIND, text, ...(briefSlug ? {} : { public: true }), ...(title ? { title } : {}), ...(briefSlug ? { briefSlug } : {}), ...og } });
    const b = json.brief;
    if (!b?.briefSlug || !b.publicUrl) throw new ToolError('The route did not return a brief. Check HITLOOP Studio > CLIENT BRIEF (/dashboard/studio?tool=brief).');
    const origin = new URL(b.publicUrl).origin;
    return {
      publicUrl: b.publicUrl,
      pdfUrl: absUrl(origin, b.pdfDownloadUrl || (b.pdfDownloadPath && `${origin}${b.pdfDownloadPath}`)),
      ogImageUrl: absUrl(origin, b.ogImageUrl || b.ogImagePath),
      briefSlug: b.briefSlug, clientId, title: b.title, public: b.public === true,
      warnings: json.pdf?.warning ? [json.pdf.warning.message || String(json.pdf.warning.code || 'PDF warning')] : [],
    };
  },
});

const unpublishClientBrief = defTool({
  name: 'unpublish_client_brief',
  title: 'Unpublish client brief',
  kind: 'sync',
  description: 'Take a published client brief down (its public URL and PDF stop working; the brief stays in HITLOOP Studio > CLIENT BRIEF (/dashboard/studio?tool=brief) where the owner can republish it). Pass clientId and the briefSlug from publish_client_brief or list_client_briefs. Only for client briefs. Unpublish only; there is no republish here.',
  inputSchema: { type: 'object', properties: { clientId: CLIENT_ID_PROP, briefSlug: str('briefSlug of the client brief.') }, required: ['briefSlug'] },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const briefSlug = typeof args?.briefSlug === 'string' ? args.briefSlug.trim() : '';
    if (!BRIEF_SLUG_RE.test(briefSlug)) throw new ToolError('briefSlug is not valid.');
    const json = await callRoute(ctx, clientId, 'PATCH', { body: { briefSlug, public: false } });
    const warning = json.warning || json.pdf?.warning || null;
    return { ok: json.ok !== false, briefSlug, ...(warning ? { warning: warning.message || String(warning) } : {}) };
  },
});

const listClientBriefs = defTool({
  name: 'list_client_briefs',
  title: 'List client briefs',
  description: "A client's client briefs (newest first): title, date, public (live link or taken down), publicUrl, pdfUrl, briefSlug. Read-only.",
  inputSchema: { type: 'object', properties: { clientId: CLIENT_ID_PROP } },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const json = await callRoute(ctx, clientId, 'GET', { query: { kind: KIND } });
    const briefs = (json.briefs || []).filter((b) => b.kind === KIND || b.kind === undefined).slice(0, 50).map((b) => {
      const origin = b.publicUrl ? new URL(b.publicUrl).origin : '';
      return {
        briefSlug: b.briefSlug, title: b.title, date: b.createdAt || b.importedAt || b.updatedAt || null,
        public: b.public === true, publicUrl: b.publicUrl || null, pdfUrl: absUrl(origin, b.pdfDownloadUrl || b.pdfDownloadPath),
      };
    });
    return { clientId, briefs };
  },
});

export const clientBriefTools = Object.freeze([publishClientBrief, unpublishClientBrief, listClientBriefs]);
export const _buildRequestForTest = (url, init) => buildRequest(false, url, init);
