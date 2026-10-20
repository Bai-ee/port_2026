# HITLOOP MCP server

A remote MCP server so the owner can talk to HITLOOP from ChatGPT and Claude (custom connectors): read client-admin data and the codebase, run free syncs, and propose changes (including paid syncs, which are proposal cards). **It can never post, schedule, approve, delete, send email/Telegram, write to X, or spend money by itself: every paid action needs the owner's Confirm click inside HITLOOP.**

Code: `features/mcp/*` (pure logic + tools), `app/api/mcp/route.js`, `app/api/oauth/{register,authorize,token}/route.js`, `app/oauth/authorize/page.jsx`, `app/.well-known/oauth-*`. Plan: `docs/plans/CONTENT-CENTER-AND-MCP-MASTER-PLAN.md` (WS-B).

## Endpoints

| URL | What |
| --- | --- |
| `POST /api/mcp` | MCP Streamable HTTP, stateless JSON-RPC 2.0 (single or batch). `GET`/`DELETE` answer 405. |
| `/.well-known/oauth-protected-resource` | RFC 9728 metadata (`resource` = `<origin>/api/mcp`). Also answers the path-suffixed form. |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata (S256 only, public clients, scope `hitloop`). |
| `POST /api/oauth/register` | RFC 7591 dynamic client registration. Redirect URIs must be on the **host allowlist** (below). 10/hour per IP, 100/hour overall. |
| `/oauth/authorize` | Consent page (shows the full redirect host prominently; never frameable: `frame-ancestors 'none'` + `X-Frame-Options: DENY` via `next.config.mjs`). Requires the existing Firebase login (`/login?redirect=`, same-origin paths only), admin accounts only. |
| `POST /api/oauth/token` | `authorization_code` (PKCE S256, single use, 10 min) and `refresh_token` (rotating, token families, 30 days absolute). Access token 1 h. |

`maxDuration` for `/api/mcp` is 300 (an existing tier): the free NAS/refresh tools can wait for a worker. No paid sync runs in this route any more.

## Auth flow

1. Client calls `/api/mcp` without a token and gets `401` + `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`.
2. Client reads the metadata, registers itself, sends the owner to `/oauth/authorize` with a PKCE challenge.
3. The page validates `client_id` + exact `redirect_uri` server-side, requires login, and on Allow POSTs the Firebase ID token to `/api/oauth/authorize`. The server requires a **verified identity** (Firebase token with `email_verified === true` or `firebase.sign_in_provider === 'google.com'`; otherwise 403 with a clear message), checks `isAdminEmail`, then issues a single-use code (`mcp_oauth_codes`, stored hashed, bound to client, redirect URI, challenge and admin email).
4. Client exchanges the code at `/api/oauth/token` and gets an HS256 access token (claims `sub`=email, `aud`=`<origin>/api/mcp`, `scope`, `jti`, `exp`) plus an opaque refresh token (`mcp_oauth_refresh`, hashed).
   - **Token families:** each refresh record carries `familyId`, an absolute `familyExpiresAt` (30 days from first issue, **not** extended by rotation) and a `secretVersion` (hash prefix of `MCP_OAUTH_SECRET`). Rotating marks the old token used (kept, not deleted). **Presenting a used token again = reuse: the whole family is revoked** and the client must re-authorize. A refresh whose `secretVersion` differs from the current secret is rejected (and its family revoked).
5. Every `/api/mcp` call re-checks that the token's email is still an admin (revoking admin cuts the connector off immediately).

**Fails closed:** with `MCP_OAUTH_SECRET` unset, `/api/mcp`, `/api/oauth/*` return `503`; the static owner token is also refused. In **production** (`VERCEL_ENV=production`) `MCP_PUBLIC_ORIGIN` is also required: with it unset the metadata, token and MCP routes return `503` instead of deriving the issuer/audience from request headers.

**Revocation = rotate `MCP_OAUTH_SECRET`.** That invalidates every access token (signature) and every refresh token (`secretVersion`) at once. Removing a person from `admins` also cuts them off on their next call.

### Redirect host allowlist (dynamic registration)

Only redirect URIs whose **exact host** is allowed are accepted at registration and again at authorize time: `claude.ai`, `chatgpt.com`, `chat.openai.com`, `localhost`, `127.0.0.1`, `[::1]`, plus hosts in `MCP_EXTRA_REDIRECT_HOSTS`. `https` is required except on loopback (http or https). Known callbacks: Claude `https://claude.ai/api/mcp/auth_callback`, ChatGPT `https://chatgpt.com/connector_platform_oauth_redirect`. No fragments, no credentials in the URI.

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `MCP_OAUTH_SECRET` | yes | HMAC signing secret for access tokens (32+ random bytes). Unset = everything 503. |
| `MCP_OWNER_TOKEN` | no | Static bearer token for CLI clients (constant-time compare). **Ignored unless 32+ characters.** Still needs `MCP_OAUTH_SECRET` and an admin email. |
| `MCP_OWNER_EMAIL` | no | Identity for the owner token (default `bryanballi@gmail.com`). |
| `MCP_PUBLIC_ORIGIN` | **yes in production** | Public origin (e.g. `https://hitloop.agency`). Issuer and token audience come from it. Unset in production = `503` (fail closed). Optional elsewhere (preview/dev derive it from the forwarded host). |
| `MCP_EXTRA_REDIRECT_HOSTS` | no | Comma list of extra hostnames allowed as OAuth redirect hosts (exact match, https), e.g. a new connector's callback host. |
| `GITHUB_TOKEN` | no | Raises the GitHub API rate limit and enables real code search in `search_repo`. Read-only scope is enough. |

Existing vars the paid syncs rely on (they run from the dashboard route when the owner confirms a card, not from MCP): `ANTHROPIC_API_KEY` (strategy review), X OAuth app vars (X Monitor sync).

## Tool catalogue

Descriptions are rich on purpose: they are how the model learns what to call. Start with `get_hitloop_guide`.

- **Guide:** `get_hitloop_guide` (static map; the repo's `CLAUDE.md` is local-only and not on GitHub).
- **Strategy agent (generated 1:1 from `READ_TOOLS` / `PROPOSE_TOOLS` in `features/x-strategy/agent/tools.js`, prefixed `strategy_`):** read tools (`strategy_get_strategy_doc`, `..._get_algorithm`, `..._score_posts`, `..._get_rule_check`, `..._get_audience`, `..._get_recent_posts`, `..._next_post`, `..._get_evaluation`, `..._get_plan`, `..._get_tracks`, `..._get_context`, `..._get_today_run`, `..._search_inventory`, `..._top_posts`, `..._get_queue`, `..._get_post`, `..._get_opportunities`, `..._get_results`) run through the same tool deps as the in-app chat (`handlers.toolDepsFor`). Propose tools (`strategy_propose_*`) validate with the same code, then store a **pending** proposal card through `handlers.createProposalInThread` (which also enforces `MAX_EXTERNAL_PROPOSALS`; `dropped` entries are surfaced) in thread `t_mcp_<YYYYMMDD>` of the Strategy chat. Cards in `t_mcp_*` threads show a **From MCP** badge. The owner confirms it in Content Center. Adding a tool to `READ_TOOLS`/`PROPOSE_TOOLS` exposes it here automatically.
- **Data:** `list_collections`, `get_document`, `query_collection` (≤3 equality filters, orderBy, limit ≤200, `startAfter` paging), `get_client_overview` (reports a `membersCount`, never the members), `search_timeline`, `get_operating_costs`, `get_x_monitor` (stored data only).
- **Codebase** (`Bai-ee/port_2026`, `main`): `list_repo_path`, `read_repo_file` (raw.githubusercontent, ≤120k chars, line ranges), `search_repo` (GitHub code search with `GITHUB_TOKEN`; otherwise path match over the cached git tree, optional `grep`), `recent_commits`.
- **Free syncs:** `request_strategy_refresh` (queues the local `bird` ingest; only the own handle and the profile/track benchmark handles, same rule as the in-app agent), `regenerate_today_suggestions` (daily loop, template drafting, no model; `force` defaults to **false**), `nas_status`, `nas_jobs`, `nas_browse` (`commandId` must match `^[A-Za-z0-9_-]{1,64}$`), `nas_estimate` (queue commands for the Mac worker; offline worker = clear error / `pending`).
- **Paid syncs are proposal cards, not tools that spend.** `request_sync {kind, params}` validates and prices the action, then creates a **"Run a paid sync"** card (proposal kind `paid-sync` `{kind, params, estimate}`) in Marketing Director > Strategy (chat) (thread "MCP"). **Nothing runs and no confirm code exists.** There is no `confirm_sync` tool. The action runs only when the owner presses Confirm on the card in HITLOOP (`strategy-proposal-decide`, the same path as every other proposal), via the `runPaidSync` dep that `app/api/dashboard/quote-targets/route.js` injects into `createStrategyHandlersFromDb`. The MCP server has no sync functions at all. Kinds: `strategy_review` (~$0.17 Anthropic), `x_monitor_sync` (X API **reads** only; the card names the metered call count, which is the human click the X Monitor SSOT requires), `nas_analyze` (Anthropic batch, hard cap `capUsd` <= $2). Pricing/validation and execution live in one shared module, `features/mcp/paid-syncs.js` (`describePaidSync` for MCP, `executePaidSync` for the dashboard; params are re-validated at execution). **Daily cap: 10 paid syncs per UTC day**, enforced in the executor with an atomic read + increment in one Firestore transaction (`counters.reserve`, `mcp_rate_limits`); a refused request does not use a slot.
- **Removed:** `market_signals_refresh`. Its signals phase runs paid X watchlist reads and the `dailyXSearch` override, which a model-driven path must not trigger. Market Signals refreshes run from the **Refresh** button in the Marketing Director header (group 1); `request_sync` has no kind for them.

## Deny list and redaction

- **Never readable** (any collection segment, any depth, case-insensitive): `users, admins, subscriptions, social_accounts, account_deletions, deleted_account_emails, _rate_limits, _stripe_events, system_flags` (holds `x_oauth_tokens`), `social_oauth_pending`, `calendar_connections` (Google refresh tokens), `social_approvals`, `telegram_bindings`, every `mcp_*` except `mcp_audit`, plus any collection or document id matching `/token|secret|oauth|credential/i`. **Personal data of third parties:** `records_waitlist`, `digest_deliveries`, `leadgen_prospects`, `telegram_updates`, and the `members` subcollection under `clients` (`get_client_overview` only reports its count).
- **Redacted in every Firestore result:** any field whose key matches `/token|secret|password|passwd|api[_-]?key|app[_-]?key|consumer[_-]?key|private[_-]?key|credential|authorization|cookie|session|refresh|oauth|jwt|webhook|verifier|signature|dsn/i` becomes `"[redacted]"` (numbers/booleans are kept so usage counts like `inputTokens` survive). String values shaped like secrets (`sk-…`, `sk_live_/sk_test_/rk_live_…`, Resend `re_…`, Telegram bot tokens, Google `1//…` refresh tokens, `ghp_…`, `github_pat_…`, `AIza…`, `xox…`, JWTs, `Bearer …`, PEM blocks) are replaced inline. Firestore Timestamps become ISO strings. The strategy agent's own output skips only the key rule (its field names such as `lastRefreshAt` are not credentials); value patterns still apply.
- **`query_collection` rejects `where` / `orderBy` on any field name matching the redaction key rule** (otherwise a caller could binary-search a hidden value).
- `search_repo` strips any `word:` search qualifier from the query, always appends `repo:Bai-ee/port_2026` itself, and drops hits whose `repository.full_name` differs (the optional `GITHUB_TOKEN` may see private repos).
- Results are capped at ~40k characters and say so when truncated.

## Audit and limits

`mcp_audit` gets `{at, email, tool, args (redacted, ≤1k chars), ok, ms}` per tool call. Rate limit: 120 calls per 10 minutes **per authenticated email** (not per token id: a fresh token does not reset it), and **every `tools/call` in a JSON-RPC batch counts** (a batch of 20 costs 20). `mcp_rate_limits` fixed-window counters; docs carry `expiresAt` for a Firestore TTL policy if you want cleanup.

## Connect ChatGPT

Settings → Connectors (enable Developer mode under Advanced if it is not visible) → Create / Add custom connector → URL `https://hitloop.agency/api/mcp`, authentication OAuth. Sign in with the admin account on the HITLOOP consent page and press Allow.

## Connect Claude

Settings → Connectors → Add custom connector → URL `https://hitloop.agency/api/mcp`. Complete the same consent.

## Local test with curl (dev server, no prod writes)

```bash
MCP_OAUTH_SECRET=local-dev-secret-change-me MCP_OWNER_TOKEN=local-owner-token npx next dev --webpack -p 3013
curl -s localhost:3013/.well-known/oauth-authorization-server
curl -si -X POST localhost:3013/api/mcp -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'          # 401 + WWW-Authenticate
curl -s -X POST localhost:3013/api/mcp -H 'authorization: Bearer local-owner-token' \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Authorized calls read **real Firestore** (the dev env points at prod). Use read tools only; `request_sync` writes a proposal card to prod Firestore, so do not call it locally either. (On the dev server `VERCEL_ENV` is unset, so `MCP_PUBLIC_ORIGIN` is optional there.)

## Day-to-day strategy from ChatGPT

Tools (48 in total):
- `get_daily_brief {clientId?}` (free, read-only): one call composing today's suggestions, the queue for the next 7 days (counts + next 10 scheduled items: time, status, first 120 chars), input status (same `content-context` source as InputStatusStrip), last results summary, quote-scan freshness, and the number of pending proposal cards. Per-group Refresh times are stored only in the owner's browser, so they are omitted. Each section fails independently (`{error}`) instead of failing the brief. Code: `features/mcp/tools/playbook.js`.
- `get_action_playbook {}` (free, static, no I/O): every owner action grouped by surface (Refresh groups 1-7, Strategy chat actions, Queue & Calendar, Results/X Monitor, Telegram). Entry: `id, label, surface, how ("click"|"chat-message"|"mcp-proposal"), costClass ("free"|"model"|"paid-x-api"|"render"), template, mcpTool`. Chat templates mirror what the `propose_*` tools accept.

Convention: start a day-to-day conversation with `get_daily_brief`, then `strategy_get_evaluation` for performance. To change something the model calls the matching `strategy_propose_*` tool (a pending card appears in Marketing Director > Strategy (chat)); otherwise it replies with a fenced **HITLOOP COMMAND** block: the exact message to paste into the in-app Strategy chat plus a "Where to click" line. It never claims anything ran.

Where things live now (admin): Marketing Director > WHAT'S OUR STRATEGY holds Today, Queue & Calendar, Strategy (chat + doc), Results, Publishing settings; Content Center keeps Library, Buckets, Timeline, Clients. All manual refreshes are the single Refresh button in the Marketing Director header (7 groups; paid groups need the in-app confirm row). Paid syncs over MCP (`request_sync`: `strategy_review`, `x_monitor_sync`, `nas_analyze`) still only create a card to confirm.

Connect steps are unchanged (see Connect ChatGPT / Connect Claude above).

## Tests

`node --test 'features/mcp/**/*.test.{js,mjs}'` (fakes only, no network): OAuth (PKCE, token sign/verify/expiry/tamper, single-use codes, redirect host allowlist, refresh rotation + token families, reuse detection, secret-rotation revocation, verified-identity rule), JSON-RPC dispatcher, redaction + deny list (PII, new key/value patterns, field-name rejection), query limits, rate limit (email key, batch cost), the paid-sync proposal flow end to end (`paid-syncs.test.js`: card created, nothing runs, owner Confirm executes once, atomic daily cap under concurrency, `market_signals_refresh` gone), registry (1:1 strategy tools, 46 tools), codebase tools (injected fetch, qualifier stripping, repo filter), auth (owner-token length, production origin), the `/login?redirect=` guard and the `/oauth/*` frame headers. Also run `features/x-strategy` tests (contracts pin 11 proposal kinds; `paid-sync` is server-only and has no in-app agent tool).

## Known limits

- `strategy_propose_item_story` and `refresh-handles` for handles outside the profile fail closed over MCP (and `request_strategy_refresh` refuses them too): the server cannot see the conversation, so it cannot verify the owner's own words (the in-app chat can).
- The strategy-chat daily turn cap applies to `strategy_review` (it runs through the same chat turn).
- `readers.js` re-states the chat readers from `app/api/dashboard/quote-targets/route.js` (route files cannot export helpers). Keep them in step.
- `chat-queue` (WS-C) also adds `toolDepsFor` to `createStrategyHandlers`; this branch adds the same one-line export, so the merge is trivial (keep one).

## Client Brain as source of truth (2026-10-13)

Three new generated tools: `strategy_propose_post_approve`, `strategy_propose_post_schedule`, `strategy_propose_post_unschedule` (pending cards in the "MCP" thread; the owner confirms in HITLOOP; nothing publishes). Registry count is now 51 tools (the 46 stated above plus the new ones and later additions; the pinned count lives in `features/mcp/__tests__`). Re-add the connector in ChatGPT/Claude to pick them up. SSOT: [`CLIENT-BRAIN-SOURCE-OF-TRUTH.md`](CLIENT-BRAIN-SOURCE-OF-TRUTH.md)

## Daily brief `todayPlan` (2026-10-13)

`get_daily_brief` now includes a `todayPlan` block, built by the same `readTodayPlan` as the daily email's `todayPlan` section (tracks with per-day targets, next <=5 scheduled posts, pending proposals; see EMAIL-DIGEST-CARD.md). Read-only; never throws.
