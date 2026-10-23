# Client MCP server (read-only, one client per link)

A second MCP endpoint so a client (first: Not The Rug, `nottherug-ten-QSMYxuuv`) can connect ChatGPT/Claude and ask
about **their own** data only. The owner server (`/api/mcp`, [HITLOOP-MCP-SERVER.md](HITLOOP-MCP-SERVER.md)) is
separate and unaffected.

## How a client connects
1. Owner creates a connect link: `node scripts/client-mcp/grant.mjs create --client <clientId> --label "<Name>"`
   (from a checkout whose `.env.local` points at prod Firestore). The URL is printed **once**:
   `https://hitloop.agency/api/client-mcp/c/<secret>`.
2. Owner sends the URL. The client adds it as a custom connector (OAuth, no client id). The consent page shows
   "Connect … to <Name> data?" — **no HITLOOP sign-in**: the link is the credential.
3. The owner makes a separate link for themself the same way (`--note owner`).
- `list [--client <id>]` shows grants; `revoke --id <prefix>` cuts every connection from that link off on its next call.
- Only SHA-256(secret) is stored (`mcp_client_grants/{sha256}`); a lost URL cannot be recovered — create a new one.

## Rules (owner-confirmed)
- Read-only. Never posts, schedules, approves, writes to X, or writes Firestore except `mcp_audit` rows.
- One token = one clientId (`hcid` claim) bound to one grant (`gid` claim). No tool has a `clientId` argument.
- **Person data is shared (owner-approved 2026-10-21):** anyone holding the connect link can read leads', email captures' and applicants' names, emails, phones and every answer via the people tools. Same per-client site key as `get_site_stats`; the key is never returned. Revoke the link to cut access.
- Owner tokens are 401 on `/api/client-mcp`; client tokens are 401 on `/api/mcp` (audience + explicit scope check).

## Tools
| Tool | Reads |
|---|---|
| `get_daily_update()` | **The opener.** One call: ONE site-stats fetch with range `7d`, split into `site.today` / `site.yesterday` (visits/pageviews = the `analytics.dailyTrend` row for that site-local date, leads = `leads.today`/`leads.yesterday`, `byDay` fallback; a missing row is null, never 0) and `site.last7Days` (`bookedLeads`, `inquiries`, `appointmentsScheduled`, `applicants.last7Days` — range totals, never shown as daily; the site has no per-day applicant count). `site.leadWithYesterday` is true when the site-local time is before 06:00 or today has no visits and no leads yet (and yesterday has data): the reply then leads with the Yesterday line and shows today as "so far", so a 00:03 check never opens on an empty day, marketing status (brief age, stale >30 d, posts out last 7 d), scheduled posts next 7 d + undated drafts + today's plan tracks, a brief blurb (`projectBrief` headline + humanBrief), and `replyFormat` (`DAILY_UPDATE_FORMAT` in `tools.js`). Each part fails soft; an unknown site shape gives nulls |
| `get_site_stats(range \| from,to)` | registered site source (`features/client-mcp/data-sources.json`). `range` = 24h (rolling, ending now)\|today\|7d\|30d, or `from`/`to` (YYYY-MM-DD, site timezone, inclusive; the site enforces ≤90 days, not future, within 13-month retention and 400s otherwise). Returns the site JSON + `fetchedAt` (`range:'custom'` + from/to for a span). Since the 2026-10-22 site update the analytics block also has `bounceRatePct`, `pagesPerSession`, `sessionDuration` (first→last event, a floor) and `funnel.abandonment` (furthest step for sessions that never saved/booked), each defined in `stats.definitions` |
| `get_visitor_sessions(range \| from,to, limit)` | site `GET <sessionsUrl>` (default `<stats url>/sessions`, or the row's `sessionsUrl`): visits newest first — source (`campaign:`/`referral:`/`direct`, null + `startedBeforeWindow` when the visit began before the window), entry/exit page, ordered trail of pages/CTAs/booking steps with times (≤40 per visit, `trailTruncated`), duration, bounced, outcome. Default 24h / 25, max 100. A session = one browser tab; NTR sessions carry `visitorId` / `visitorType` (new\|returning) / `visitorSessionsInRange` (null before visitor tracking), never linked to a lead; real traffic only (test mode excluded). Trimmed by whole sessions with `sizeNote` |
| `get_leads(range, limit)` | site `GET <peopleUrl>?kind=leads` (default `<stats url>/people`, or the row's `peopleUrl`): Meet & Greet leads with full answers. range today\|7d\|30d\|all (default 30d), limit 1–50 (default 25) |
| `get_lead(id)` | same endpoint with `id`; one lead |
| `get_email_captures(range, limit)` | `kind=captures`: email-only signups who did not finish the questionnaire |
| `get_applicants(range, stage, limit)` | `kind=applicants`: applicants with every answer, notes, AI summary; optional `stage` |
| `get_applicant(id)` | one applicant. Ids are validated (`/^[A-Za-z0-9_-]{1,128}$/`) before any fetch; 404 = "No <kind> record with that id." |
| `get_client_brain(part)` | `client_brain/current` — contents only when `approved` (summary sections or full markdown) + `x_strategy_docs/{id}` |
| `get_content_calendar(range)` | `social_posts` for the client: scheduled in the next range + undated drafts + today's plan |
| `get_post_results(range)` | `social_posts` posted in the last range with `performance` as recorded |
| `get_marketing_data(section)` | `dashboard_state/{id}` live — index, `report` (`projectBrief`), any section or dotted path. A brief run shows up on the next call. Internal fields (`HIDDEN_STATE_KEYS` in `tools.js`) and `clientBrain` are left out |

People tools use `redactKeys:false` (so `email`/`phone` are not blanked; secret-looking values are still scrubbed). The MCP result cap is 40000 chars and cuts mid-JSON, so list results are trimmed by whole items to ~34000 chars with a `note` (hence max limit 50, default 25).

## Answer framing
`clientInstructions()` in `tools.js` (sent on `initialize`, named after the grant `label`; serverInfo title `<label> data`):
OPENING = on a conversation start or a general ask ("give me an update", "what do you know", "get started", …) call
`get_daily_update` first and answer in its `replyFormat` (the trigger phrases are also in that tool's description,
because ChatGPT follows tool descriptions more reliably than `instructions`; edit both together). PRIMARY = the client's website analytics (`get_site_stats` first for any "how are we doing" question); SECONDARY = the
marketing work in HITLOOP (marketing data, calendar, results, brain). Never describe HITLOOP, its owner or other
clients; never estimate numbers; always state the range/date; flag reports older than 30 days. Tune the wording there.

## Website sources
One row per client in `features/client-mcp/data-sources.json`: `{clientId, label, kind:'site-stats', url, peopleUrl?, sessionsUrl?, keyEnv}` +
the env var in Vercel prod (Not The Rug: `CLIENT_STATS_KEY_NOTTHERUG`). The key is only sent as
`Authorization: Bearer`; it never appears in a result, error or audit row.

**Unique visitors (NTR, since 2026-10-23):** the site keeps a random localStorage visitor id per browser; `/api/stats` returns `analytics.visitors` (number, null for ranges before tracking began) and `analytics.visitorBreakdown` (`newVisitors`, `returningVisitors`, `sessionsWithVisitorId`, `sessionsPerVisitor`). A browser, not a person.

**Not available from the Not The Rug site (not recorded, so no tool can return it):** lead acquisition source (leads are not linked to sessions), scroll depth beyond the one-time 50% engagement signal, and counts of filtered bot traffic (dropped silently at `/api/track`). Each needs new tracking on the site first.

**HITLOOP-tracked static sites** (no server of their own, e.g. the Underground Existence Arweave site): row
`{clientId, label, kind:'site-stats', provider:'hitloop', site, url}` — no key, no HTTP. The site's beacon
(`website/js/ue-analytics.js` in `arweave-video-generator`, loaded by `boot.js`) posts to the public collector
`app/api/public/site-events` → `site_analytics/{site}/events` (no IP/UA stored; geo from Vercel headers; `expireAt` =
395 days, needs a Firestore TTL policy on that field; `SITE_ANALYTICS_DISABLED=true` = runtime kill switch;
`?ue_analytics_test=1` on the site = test traffic, excluded from real numbers). `get_site_stats` builds the report
(range or from/to) and `get_visitor_sessions` (per-visit paths, `/api/stats/sessions` envelope plus a pseudonymous
`visitor` id) from Firestore via `features/site-analytics/report.js` in the same shape as the client-site `/api/stats`
(`analytics.meta/range/dailyTrend/sources/pages/live`, `leads`/`applicants` null) plus visitors, clicks, outbound
links, mix plays, countries/cities, devices. Such a site has no people: the people tools say so, the daily update
drops its lead lines (`leadsTracked:false`) and the instructions omit the PEOPLE tools. Sites are registered in
`SITES` (`features/site-analytics/events.js`; `hostRe` = allowed Origins + internal referrers). Second site
`hitloop` = hitloop.agency itself: beacon `components/SiteAnalytics.jsx` (mounted in `app/layout.jsx` next to GA4's
`AnalyticsPageView`; pageview per App Router pathname change; public pages only — `/dashboard`, `/admin`, `/briefs`,
`/preview`, `/capture`, `/post-approval`, `/oauth`, `/telegram-upload`, `/sites` excluded; on other hosts only with
`?site_analytics=1`, test traffic `?site_analytics_test=1`). Read with owner MCP `get_site_analytics` / `get_site_sessions` site `hitloop`. UE routes to HITLOOP's own client `bryan-balli-WUoltG84`; owner MCP
`get_site_analytics` (report) and `get_site_sessions` (visit paths) read the same data (plus `testMode`, range or from/to). The owner reads UE through the owner MCP (`/api/mcp`); no client grant for `bryan-balli-WUoltG84` is active (8d674dd32e93 was revoked 2026-10-23).

## Audit + limits
`mcp_audit` row per call: `{at, via:'client-mcp', clientId, grant (12-char prefix), tool, ok, ms}` — no arguments or
results. Rate limit 120 calls / 10 min per grant (shared `mcp_rate_limits`).

## Wiring (where the code lives)
- `features/client-mcp/` — `grants.js` (link format, store), `auth.js` (bearer check), `consent.js` (authorize branch),
  `tools.js`, `sources.js`, `handler.js` (transport-agnostic POST), `server.js` (Firestore wiring).
- Route `app/api/client-mcp/c/[grant]/route.js` (same stateless JSON-RPC dispatcher as `/api/mcp`).
- Shared OAuth (`features/mcp/oauth.js`): codes/refresh tokens carry an optional `binding {aud, scope, hcid, gid}`;
  records without one are owner records (old connections keep working). `/api/oauth/authorize` takes the client branch
  only when `resource` is a client connect link on this origin. `/.well-known/oauth-protected-resource/api/client-mcp/c/<secret>`
  serves the client resource metadata.
- Connectors must send the RFC 8707 `resource` parameter (MCP spec 2025-06-18); a `client:read` request without it is refused.
- Tests: `features/client-mcp/__tests__/client-mcp.test.js`.
