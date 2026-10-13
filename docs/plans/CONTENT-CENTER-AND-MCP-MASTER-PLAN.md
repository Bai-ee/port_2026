# Content Center + HITLOOP MCP — combined master plan (2026-10-12)

Base: main `90f45c91` (Strategy document shipped). Owner: bryanballi@gmail.com. Client: `bryan-balli-WUoltG84`.

## Objective

One connected content system for the POC loop:
**Strategy document → daily suggestions + Strategy Builder campaigns → owner approves → existing queue/poster publishes →
results → Review checks the strategy** — and the owner can hold the whole conversation (X algorithm, HITLOOP data,
codebase) from ChatGPT or Claude through one MCP server, with read access to all client-admin data and the ability to
request syncs.

## Model (three layers)

1. **Knowledge** — what we know: Client Brain (voice), Strategy document (what/why), content library (archive,
   Timeline, NAS, buckets), Market Signals (material, not strategy).
2. **Planning** — what to post: daily mode (Content Engine loop) + campaign mode (Strategy Builder). Both read the
   Strategy document + Brain.
3. **Publishing** — unchanged, proven: `social_posts` queue, calendar, `process-due` poster. One entry rule: everything
   passes the same strategy guard.

## Workstreams (parallel, one worktree + branch each)

### WS-A `feat/builder-strategy` — close the caveat
- Strategy Builder generation (`features/strategy-builder/{generate-plan,build-strategy,prompt}.js`) reads the client's
  CONFIRMED Strategy document (`x_strategy_docs`, `strategyGuidance` + Tracks/Thesis) and puts it in its prompt.
- `app/api/dashboard/strategy-builder/push/route.js`: run `guardXPost` on every item before scheduling. Hard block ⇒ item
  not scheduled, reported in `failed[]` with the reason. Major flags ⇒ scheduled but flagged on the post
  (`guard` field) and returned in the response. Push behaviour for clean items unchanged.
- Builder card shows "Following Strategy vN" / "No confirmed strategy" and lists guard failures after push.

### WS-B `feat/mcp-server` — HITLOOP MCP server (ChatGPT + Claude)
- Remote MCP over Streamable HTTP (stateless JSON-RPC: initialize, tools/list, tools/call, ping) at `/api/mcp`,
  hand-rolled (no new dependency unless the owner approves one).
- Auth: OAuth 2.1 authorization server for connectors (metadata at `/.well-known/oauth-authorization-server` +
  `/.well-known/oauth-protected-resource`, dynamic client registration, PKCE S256, authorize page gated by the existing
  Firebase admin login, short-lived signed access tokens, refresh tokens) + an optional static owner token
  (`MCP_OWNER_TOKEN`) for CLI clients. Only admin emails (`isAdminEmail`) can authorize. Fails closed when the signing
  secret env is unset.
- `initialize.instructions`: the strategy agent's data + honesty rules and strategy model (from `agent/prompt.js`), so
  any model behaves like the in-app agent.
- Tools:
  - **All strategy agent tools**, generated from `READ_TOOLS` / `PROPOSE_TOOLS` and executed through the same tool deps
    (strategy doc, evaluation, algorithm, score, rule check, audience, tracks, queue, posts, opportunities, results,
    inventory, today run, + anything WS-C adds). Proposals land as cards in an "MCP" thread in the Strategy chat.
  - **Data**: `list_collections`, `query_collection` (equality filters, order, limit ≤ 200), `get_document` (incl.
    subcollections) over Firestore with a deny-list (secrets/PII collections) + recursive field redaction
    (token/secret/password/key/credential/refresh/authorization …). Curated: `get_client_overview`, `search_timeline`,
    `get_strategy_builder_plan`, `get_market_signals`, `get_operating_costs`, `get_digest_status`.
  - **Codebase** (repo `Bai-ee/port_2026`, public): `list_repo_path`, `read_repo_file`, `search_repo` (GitHub code
    search when `GITHUB_TOKEN` is set, else path search over the git tree), `recent_commits`. Read-only.
  - **Sync requests**: free ones run directly (strategy refresh queue, daily-run regenerate without model, NAS browse /
    estimate). Paid ones (X Monitor sync, Market Signals refresh, NAS analyze, model drafting) are two-step:
    `request_sync` returns the action + estimated cost + a single-use confirm code; `confirm_sync` executes. Daily cap.
    **No X API writes, no posting/scheduling/approving, ever.**
- Every call logged (`mcp_audit`), rate-limited per token.

### WS-C `feat/chat-queue` — chat sees the whole queue + signals
- New read tool `get_market_signals` (latest Market Signals / brief summary, quoted as data).
- `get_queue` covers every source (Builder, Copywriter, daily loop) with `source` shown.
- New proposal kind `post-edit` `{postId, text, scheduledAt?}` for posts in draft/approved/scheduled (never
  published/posting); executor updates via the existing `updateSocialPost` path; stale check on `updatedAt`.
  Confirm-only, like every proposal.
- Export a tool-deps factory on the handlers object so WS-B can run the same tools.

### WS-D `feat/content-center` (integration) — Content Center + docs
- Move the Content Engine card to the Knowledge bucket, titled **Content Center** (owner-approved edit to
  `DashboardPage.jsx`: `category` + card order + labels only).
- Telegram activation runbook (bot, env, webhook) — owner steps; no code.
- Merge WS-A/B/C, run all scoped tests, security review of the MCP surface, preview deploy, ship.

## Guardrails (all workstreams)

- No X API writes; no paid calls in tests; nothing approves/schedules/publishes from chat or MCP.
- Prod Firestore is shared: tests use memory fakes; no writes to prod during development.
- Never edit `DashboardPage.jsx` except WS-D's approved move. Do not touch Discogs/assetManager.
- Secrets never in code, logs, tool output or docs.

## Owner steps after ship

1. ChatGPT: Settings → Connectors → add custom connector `https://hitloop.agency/api/mcp` (developer mode if required),
   sign in with the admin account. Claude: Settings → Connectors → add the same URL.
2. Telegram: create bot via BotFather, set env + webhook per the runbook.
