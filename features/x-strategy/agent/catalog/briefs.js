// Client Brief group: create / update / unpublish / republish / list a CLIENT-FACING brief (hosted page + PDF).
// Same route the dashboard's Studio > CLIENT BRIEF (/dashboard/studio?tool=brief) and the MCP publish_client_brief tool call:
// app/api/dashboard/custom-briefs (route key 'custom-briefs'). Docs: docs/source-of-truth/CLIENT-BRIEF.md.
//  Auth: bearer + verifyAdminRequest (POST/PATCH) / verifyRequestUser (GET); the client = getDashboardBootstrap `?as=`.
//  `fixed.kind` pins the route to the client-brief path (the agent can never switch it to invoice / pasted-HTML).
//  `resultPick` boils the route's large brief document down to the links the agent must hand the owner.
import { str, bool, arr, obj } from './_schema.js';

const SLUG = /^client-brief-\d{8}-[0-9a-f]{16}$/;
const slugArg = str('briefSlug of the client brief (from briefs.client.list or the publish result), e.g. client-brief-20261118-0123456789abcdef.', { pattern: SLUG.source });

const BRIEF_PICK = {
  publicUrl: 'brief.publicUrl',
  pdfUrl: 'brief.pdfDownloadUrl',
  ogImageUrl: 'brief.ogImageUrl',
  briefSlug: 'brief.briefSlug',
  title: 'brief.title',
  public: 'brief.public',
  clientId: 'clientId',
  updated: 'updated',
  warning: 'warning',
};

export const BRIEFS_ACTIONS = [
  {
    id: 'briefs.client.publish',
    group: 'briefs',
    title: 'Create or save a client brief (hosted link + PDF)',
    description: 'Publishes client-facing Markdown as a public brief page with a PDF share link. Pass briefSlug to update in place. Returns publicUrl and pdfUrl. Undo = unpublish.',
    keywords: 'create save publish client brief report performance report client-facing share link pdf hosted page update brief markdown breakdown',
    route: 'custom-briefs', method: 'POST', action: null,
    fixed: { kind: 'client-brief' },
    // A NEW brief is published (public:true) unless the agent says otherwise; an UPDATE (briefSlug) sends `public` only if the agent passed it.
    defaultsUnlessArg: { arg: 'briefSlug', body: { public: true } },
    args: obj({
      text: str('The client-facing Markdown, rendered exactly as given. Never include internal notes, costs or strategy. Max 50000 characters.', { maxLength: 50000 }),
      title: str('Optional title; otherwise the first H1 of the text.', { maxLength: 140 }),
      briefSlug: slugArg,
      public: bool('Only pass to change visibility on purpose. Omitted: new briefs are published, updates keep their current visibility.'),
      theme: str('Optional built-in document theme (ledger | editorial | studio-dark). Omitted: default look (new) or the current theme (update).', { enum: ['ledger', 'editorial', 'studio-dark'] }),
      ogLabel: str('Optional link-preview label.', { maxLength: 80 }),
      ogSubhead: str('Optional link-preview subhead.', { maxLength: 160 }),
      hideOgSubhead: bool('Hide the link-preview subhead.'),
      ogTitleLines: arr(str('Headline line', { maxLength: 40 }), 'Optional link-preview headline lines (max 3).', { maxItems: 3 }),
      ogLines: arr(str('Line', { maxLength: 120 }), 'Optional extra link-preview lines (max 2).', { maxItems: 2 }),
    }, ['text']),
    tier: 1, external: null,
    resultPick: BRIEF_PICK,
    undo: { actionId: 'briefs.client.unpublish', argsFrom: { briefSlug: 'result.briefSlug' } },
    // A CREATE undoes by unpublishing. An UPDATE (briefSlug) overwrites the text: unpublishing would only kill a live link, so no undo.
    noUndoWhenArg: 'briefSlug',
    noUndoNote: 'updated in place; previous text is overwritten (no undo)',
    // Shares the MCP daily publish cap (features/mcp/limits.js); one brief per run_action call.
    dailyCap: 'client-brief',
    singleItem: true,
    clientEcho: true,
  },
  {
    id: 'briefs.client.unpublish',
    group: 'briefs',
    title: 'Unpublish a client brief (take the link down)',
    description: 'Takes a client brief offline: its public link and PDF stop working. The brief stays in Studio > CLIENT BRIEF (/dashboard/studio?tool=brief) and can be republished.',
    keywords: 'unpublish take down remove client brief link pdf offline hide',
    route: 'custom-briefs', method: 'PATCH', action: null,
    fixed: { public: false },
    args: obj({ briefSlug: slugArg }, ['briefSlug']),
    tier: 1, external: null,
    resultPick: BRIEF_PICK,
    undo: { actionId: 'briefs.client.republish', argsFrom: { briefSlug: 'args.briefSlug' } },
    clientEcho: true,
  },
  {
    id: 'briefs.client.republish',
    group: 'briefs',
    title: 'Republish a client brief (link live again)',
    description: 'Makes an unpublished client brief public again (same URL; the PDF is regenerated on first download).',
    keywords: 'republish publish again restore client brief link live public',
    route: 'custom-briefs', method: 'PATCH', action: null,
    fixed: { public: true },
    args: obj({ briefSlug: slugArg }, ['briefSlug']),
    tier: 1, external: null,
    resultPick: BRIEF_PICK,
    undo: { actionId: 'briefs.client.unpublish', argsFrom: { briefSlug: 'args.briefSlug' } },
    clientEcho: true,
  },
  {
    id: 'briefs.client.list',
    group: 'briefs',
    title: 'List client briefs (links, PDFs, live or taken down)',
    description: 'A client\'s client briefs, newest first: title, briefSlug, public (live or taken down), publicUrl, pdfUrl. Read-only.',
    keywords: 'list client briefs reports performance published links pdf share link find existing brief',
    route: 'custom-briefs', method: 'GET', action: null,
    query: { kind: 'client-brief' },
    args: obj({}, []),
    tier: 0, external: null,
    resultPick: { list: 'briefs', limit: 30, pick: { briefSlug: 'briefSlug', title: 'title', public: 'public', publicUrl: 'publicUrl', pdfUrl: 'pdfDownloadUrl', updatedAt: 'updatedAt' } },
    clientEcho: true,
  },
];
