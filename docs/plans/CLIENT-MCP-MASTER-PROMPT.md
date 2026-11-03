# HITLOOP client-scoped MCP — master prompt (hand to a dedicated HITLOOP agent)

Status: approved 2026-10-20. Phase 1 (Not The Rug side) is built; this prompt covers Phases 2–3 on the HITLOOP side.

---

## Paste from here

You are working in the HITLOOP repo (`/Users/bballi/Documents/Repos/Bballi_Portfolio`). Create a worktree off `main` for this work; never edit the main checkout, never touch owner servers on :3000/:3001, and never edit `DashboardPage.jsx`.

### Goal

Add a **second, client-scoped MCP server** to HITLOOP so a client (first: Not The Rug, client id to confirm in Firestore) can connect ChatGPT and ask about *their own* data only: HITLOOP marketing data for that client plus live stats from their website. The existing owner/admin MCP at `/api/mcp` (features/mcp, OAuth 2.1) must stay untouched and unaffected.

### Hard rules (owner-confirmed, do not reopen)

- Read-only. The client MCP never posts, schedules, approves, writes to X, or writes to Firestore except its own audit rows.
- One token = one `clientId`. Every tool filters by the clientId baked into the token. A client token can never read another client's records or any owner-level data. Write a test that proves it.
- Reuse the existing MCP transport and OAuth plumbing in `features/mcp` and `app/api/oauth/*`; do not fork a second copy of the transport. Add a scope/audience, not a new auth system.
- Keep answers short and direct when reporting to the owner.
- Plan before code. One phase at a time. Stop for approval after each phase.

### What already exists (read first)

- `features/mcp/**`, `app/api/mcp`, `app/api/oauth/*`, `app/.well-known/*` — owner MCP + OAuth 2.1. Firestore `mcp_oauth_clients`, `mcp_audit`.
- Env: `MCP_OAUTH_SECRET`, `MCP_PUBLIC_ORIGIN`.
- Thread notes: `~/.claude/threads/2026-10-12-content-center-mcp.md` (traps: preview deploys sit behind Vercel SSO, so connectors are only testable on prod; GitHub push protection blocks secret-shaped fixtures).
- Client records live under the client id (brain, strategy doc, calendar/queue, posted results). Find the readers the owner MCP already uses and scope them, rather than writing new queries.

### The client website data source (already built, Not The Rug side)

- `GET https://nottherug.com/api/stats?range=today|7d|30d`
- Header: `Authorization: Bearer <STATS_API_KEY>` (the owner will give you the key; store it in HITLOOP env as `CLIENT_STATS_KEY_NOTTHERUG`, never in code or docs).
- Response (JSON): `{ site, generatedAt, range, analytics, leads, applicants, degraded }`
  - `analytics`: the site's admin analytics report (traffic, sources, pages, CTAs, booking funnel) or `null` if it failed
  - `leads`: `{ timezone, today, yesterday, last7Days, last30Days, emailsCaptured{…}, byDay[], bySource{} }`
  - `applicants`: `{ total, byStage{applied,review,shadow_invited,…,rejected}, last7Days, last30Days, onHold }`
  - `degraded`: which parts fell back to zeros
- Counts and trends only. It never returns names, emails, phones or free text.
- 401 on a bad key, 429 over 60 requests / 15 min per IP, `Cache-Control: no-store`.

### Phases

**Phase 2 — client-scoped MCP endpoint**
1. New route `app/api/client-mcp` (same Streamable HTTP transport as `/api/mcp`).
2. OAuth: a client-type OAuth client whose issued tokens carry `clientId` and scope `client:read`. The owner creates/approves it (admin UI or script; owner picks). Tokens without `clientId` are rejected by `/api/client-mcp`; tokens with `clientId` are rejected by the owner `/api/mcp`.
3. Per-client data-source registry (config, not code): `{ clientId, label, kind: 'site-stats', url, keyEnv }`. Not The Rug is the first entry. Adding a future client's site = one config row + one env var.
4. Tools (all read-only, all clientId-scoped):
   - `get_site_stats(range)` — fetches the registered site source; returns it as-is plus `fetchedAt`
   - `get_client_brain()` — the client's approved brain / strategy doc
   - `get_content_calendar(range)` — planned/queued items for the client
   - `get_post_results(range)` — posted items and their results for the client
   - `get_marketing_data(section?)` — whatever marketing data the owner adds to the client record (treat as a generic read of the client's data sections; the owner is adding this data now)
5. Audit every call in `mcp_audit` with `clientId`, tool, ok/err. No request bodies in the audit.
6. Tests: tools return only the scoped client's docs; a token for client A gets nothing for client B; owner-token on `/api/client-mcp` = 401; client-token on `/api/mcp` = 401; `get_site_stats` passes the range through and never leaks the key.

**Phase 3 — connect and verify (prod only)**
1. Deploy. Owner sets `CLIENT_STATS_KEY_NOTTHERUG` in Vercel prod.
2. Owner (or the client) adds a ChatGPT connector pointing at `https://hitloop.agency/api/client-mcp`, OAuth, no client id.
3. Verify with `npx -y @modelcontextprotocol/inspector --cli https://hitloop.agency/api/client-mcp --transport http --method tools/list` and one `get_site_stats` call.
4. Confirm `mcp_audit` rows carry the Not The Rug clientId and nothing else.
5. Report back: endpoint URL, OAuth client id, tool list, audit proof, rollback deploy id.

### Report format after each phase

- Files changed
- Exact behavior changed
- What stayed untouched (owner MCP must be listed here every time)
- Verification run (tests, inspector output)
- Manual test next
- Risks / not verified

Start with Phase 2, step 1. Give a compact plan first and wait for approval.
