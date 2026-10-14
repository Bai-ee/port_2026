# Multi-client wiring — master plan (2026-10-14)

Status: PLAN ONLY, nothing built. Owner asked: "assess the difficulty and create a plan to wire all clients up to the data and work separately."

## Objective

Every client (not only the home client `bryan-balli-WUoltG84`) runs the full loop on its own data, isolated from the others: Brain → Strategy doc/plan/tracks → Today/Queue → publish on its own X account → Results/X Monitor → digest. The admin operates each client through the existing switcher. Opening the surfaces to non-admin client logins is a separate, decision-gated phase (Phase 5).

## Difficulty: Medium-Large (≈5 phases, 3 of them code)

| Layer | State today | Verdict |
|---|---|---|
| Firestore data | Already keyed per client almost everywhere: `clients/{id}/client_brain`, `x_strategy_plans/{id}`, `x_strategy_docs/{id}`, `social_accounts/{id}`, `digest_config/{id}`, `social_posts.clientId`, `dashboard_state/{id}`, `telegram_bindings` | ✅ small |
| Content inventory | `x_content_packages` has **no clientId** (global store; every `readInventory()` is unscoped: quote-targets route, daily loop, MCP readers, NAS, Telegram intake) | ❌ largest blocker |
| Owner hardcodes | `OWNER_CLIENT_IDS`/`assertOwnerClient` (`features/x-content-inventory/daily-loop/config.js:16`, `run.js:99`, `quote-targets/route.js:770`, MCP `readers.js:133`); MCP `DEFAULT_CLIENT_ID` (`features/mcp/tools/common.js:5`); paid `strategy_review` ignores `args.clientId`; `ownHandle 'bai_ee'` fallbacks (`run.js:52`, `inputs.js:80`, `plan-day.js:97`); `DIGEST_X_HANDLE || 'bai_ee'` home-only X queue (`daily-digest/route.js:846-890`) | ❌ medium |
| X identity | Per-client OAuth2/OAuth1 connect exists (Social Accounts card). But X Monitor syncs the **global** token with no clientId (`features/x-monitor/sync.js:83-250`, store keyed by X user id), Strategy `readAudience` matches on username (`route-handlers.js:975`), latent global-token fallback at `x-oauth.js:286` | ❌ medium |
| Bryan-specific priors | `WATCHLIST` (`x-quote-targets/watchlist.js`), `COMMITTED_CORPORA` bai_ee/seb__design, `DEFAULT_PROFILE` (bai_ee/Chicago), score weights measured on @bai_ee (`x-growth/score-draft.js`, `x-content-guard/rules.js`), launchd scan = one label = one client/machine | ⚠️ medium, partly product |
| Access | Marketing Director, X, Strategy cards + APIs = admin only + `PILOT_OWNER_UIDS`/`PILOT_CLIENT_IDS`; no client-role path; MCP has no OAuth-user→client map | ⚠️ large, decision-gated |
| Already multi-client | `process-due` sweep (all clients, per-client adapter), digest crons (opt-in enrollment, `recipientEmail`), Client Brain (client-usable), Telegram bindings | ✅ none |

Live state (read-only, 2026-10-14): 17 client docs. Only home has an `x_strategy_plans` doc. Brains: NTR approved; home `stale`; UE/paradice/clairecalls/tryvtc/pLOR5oyc draft; 9 none. `social_accounts` docs: home + undergroundexistence, neither with a username (unconnected). `social_posts`: home 92, UE 17, spacex 9, NTR 1. `x_content_packages`: all 400 sampled rows have no clientId.

## Keep vs change

Keep: Firestore key scheme, `getEffectiveClientContext` as the one ownership resolver, `process-due`, digest enrollment, Brain-wins adoption, every X spend gate (dry-run + owner click per batch), one bot for Telegram.

Change: owner-id hardcodes → derived from the client's own records; inventory → clientId-scoped; X Monitor/audience → per-client account; Bryan priors → per-client config with the current values as the home client's defaults.

## Phases

### Phase 1 — Config only, no code (S, ~1h)
- Set `PILOT_CLIENT_IDS` in Vercel prod to the target list (home + NTR + UE to start). Keep `PILOT_OWNER_UIDS` as is.
- Per target client, owner does the onboarding checklist (below).
- Verify: NTR/UE approve/schedule/reject on `social-posting` stop returning `pilot-wrong-client`.
- Does NOT unlock the daily loop, MCP, quote targets (Phase 2).

### Phase 2 — Remove owner hardcodes (M, ~1 day)
- Replace `OWNER_CLIENT_IDS`/`assertOwnerClient` with `assertClientReady(clientId)`: approved Brain + plan doc + X account connected (or an explicit per-client `contentLoop.enabled` flag). Call sites: `daily-loop/run.js`, `daily-loop/scheduled.js`, `quote-targets/route.js:770`, MCP `readers.js`, `scripts/x-content/daily-run.mjs`.
- `ownHandle` fallbacks → `social_accounts/{clientId}.platforms.x.username`, else Brain X profile handle, else error (never `bai_ee`).
- MCP: `clientId` required on every tool (or default from a per-token setting), `strategy_review` honors `args.clientId`; `DEFAULT_CLIENT_ID` stays only as the home convenience when the caller is the home owner.
- Digest X queue: handle from the client's social account, not `DIGEST_X_HANDLE`.
- Tests: the existing daily-loop/MCP suites import `OWNER_CLIENT_IDS`; swap to a fixture client.

### Phase 3a — Scope inventory reads (M, ~1 day)
- Add `clientId` to `x_content_packages`; one-shot backfill: every existing row → home (read-only dry-run first, report counts, then write with owner go).
- `readInventory({ clientId })` required; call sites: `quote-targets/route.js:367,417,865`, MCP `readers.js:161`, daily loop inputs, `x-content-inventory/nas.js`, `telegram/intake*.js`. Firestore index: `clientId + status/createdAt` (add to `firestore.indexes.json`).
- Writers (NAS stage, Telegram intake, Timeline/social-archive ingest, `scripts/x-content/sync-rendered-videos.mjs --client`) stamp `clientId`; the NAS worker (`assetManager`) stays home-only unless a collection→client map is added later.

### Phase 3b — Per-client content sources (M, later)
- Non-home clients have no NAS; their inventory comes from Telegram intake, Timeline/social-archive ingest of their own X/IG, and Brain `Content Library`. Build/verify those three writers per client. Decision: whether a client gets a NAS collection at all.

### Phase 4 — Per-client X identity + priors (M, ~1–2 days)
- X Monitor: `sync(clientId)` uses `getPlatformClient(clientId,'x')`; store key `x_monitor/{accountId}` plus a `clientId` field; card reads by the active client's account. Remove the global-token fallback at `x-oauth.js:286` for non-home clients.
- Strategy `readAudience`: match on the client's account id, not username.
- Quote targets: `WATCHLIST`, corpora, `DEFAULT_PROFILE` → per-client config sourced from the Brain (tracks + benchmarks already exist in the plan doc); home keeps today's values as its config. Scan: `--client` loop over `PILOT_CLIENT_IDS` under one launchd label (bird reads public timelines, so the owner's cookies still work).
- Score weights/guard rules: keep global for now; document that they were measured on @bai_ee (product decision, not code).
- Refresh cost estimates are already per group; confirm the estimate row names the client.

### Phase 5 — Client-role access (L, decision-gated, do not start unprompted)
- Non-admin client sees its own Marketing Director/X/Strategy cards (`isAdmin ? [` spreads in `DashboardPage.jsx:9344-9748` → `canSeeStrategy(user, client)`).
- MCP OAuth user → client map; Telegram binding per client user; per-admin/agency scopes on `getEffectiveClientContext`.
- Billing decision: client's own X credits (OAuth1 BYO keys, already supported) vs HitLoop app credits.

## Per-client onboarding checklist (owner, no code)
1. Brain: inject Markdown, approve (Brain-wins adopts settings into empty sections only).
2. Social Accounts card: connect X (OAuth2) or paste BYO OAuth1 keys; confirm username shows.
3. Strategy: Builder follows the doc → plan doc + content tracks + per-track targets/benchmarks.
4. Email Digest: `recipientEmail`, Daily toggle, include toggles.
5. Add to `PILOT_CLIENT_IDS` (Phase 1) / pass `assertClientReady` (Phase 2).
6. First paid Refresh with the confirm row; first scheduled post via the owner's own click.

## Risks
- Inventory backfill is a write to prod data; dry-run report + owner go, keep a pre-backfill export (untracked, public repo).
- X spend multiplies per client: every sync/scan/refresh is metered per account; confirm rows must stay per client per batch.
- Crons loop over more clients inside fixed `maxDuration` tiers (pre-digest-refresh phases, daily loop); may need per-client fan-out.
- Bryan-measured priors will mis-score other niches until Phase 4 config exists; label as home defaults.
- `isPilotClient` falls back to the owner client when the list is unset; a mis-set env silently drops plan enforcement for everyone else.

## Recommended order
1 → 2 → 3a → 4 → 3b → 5. Stop for approval after each. Phase 1 can start today with no deploy.
