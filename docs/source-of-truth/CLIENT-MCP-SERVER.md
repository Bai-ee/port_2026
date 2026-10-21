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
| `get_site_stats(range)` | registered site source (`features/client-mcp/data-sources.json`), `range` = today\|7d\|30d passed through; returns the site JSON + `fetchedAt` |
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
One row per client in `features/client-mcp/data-sources.json`: `{clientId, label, kind:'site-stats', url, peopleUrl?, keyEnv}` +
the env var in Vercel prod (Not The Rug: `CLIENT_STATS_KEY_NOTTHERUG`). The key is only sent as
`Authorization: Bearer`; it never appears in a result, error or audit row.

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
