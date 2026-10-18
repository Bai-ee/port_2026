# Agent Action Registry

The strategy chat agent does not get one tool per ability. It gets ONE registry of dashboard server actions
(`features/x-strategy/agent/action-registry.js` + `catalog/*.js`) and two generic tools (`find_actions`, `run_action`;
runtime in `action-runtime.js`). Each entry is the exact route + `body.action` + fields the dashboard button already uses, so
auth and validation are the same as clicking the button.

## Tiers

| Tier | Meaning | Run-time behaviour (autonomy in `client_configs/{clientId}.agentAutonomy`) |
|---|---|---|
| 0 | Read | Runs, returns data |
| 1 | Reversible write, drafts, versioned edits | Auto (default) with snapshot + audit + undo, or confirm card |
| 2 | Destructive: delete, reject, overwrite, gating changes | Always a confirm card |
| 3 | External or spend: publishes to X, **arms the cron to publish (any `scheduledAt`)**, email, Scout/ScrapeCreators/X API/Claude/renders/Arweave | Confirm card; `external:'x'` needs a typed confirm |

`external`: `x` (publishes to X; paid X *reads* are `paid`), `email`, `arweave`, `paid`. Tier 3 entries must carry `cost`.

## Groups

`queue` (social_posts lifecycle), `calendar`, `content` (library items, daily run, quote targets, archive timeline),
`buckets`, `strategy` (plan, strategy doc, profile, batches), `brain`, `signals` (Market Signals, recipes, watchlist,
Opportunity Signals, web stats), `digest`, `refresh` (Refresh groups 1/2/3/7), `xmonitor`, `media` (Media Library, remix,
Arweave archive, archive inbox), `nas` (NAS analyzer + Discogs), `other`. (`clients` is reserved; nothing in it yet.)

## Entry fields (beyond the contract)

- `fixed`: body fields merged after the agent's args (e.g. `{ scheduledAt: null }` makes `queue.post.unschedule`; `{ mode: 'llm' }`
  makes `brain.generate.llm`). The agent can never override them. Used to split one route action into entries of different tiers.
- `query`: fixed query params. `media`, `archive-inbox` and `client-brain` select their action in the query string, not the body;
  `pre-digest-refresh` takes `phase`/`allowX`. `GET` entries send `args` as query-string params.
- `snapshot` forms: `{ collection, idArg }` (idArg may be dotted, `pkg.id`) or `{ path: 'content_buckets/{clientId}/buckets/{bucket.id}', field? }`.
  `{clientId}` is the resolved client; `{x.y}` is a path into `args`. `field` captures one dotted field of the doc.
- `undo`: `{ actionId, argsFrom: { version: 'args.expectedVersion' } }` native undo (plan/doc revert); sources are `args.*`, `result.*`, `before.*`.
- Args schemas default to `additionalProperties:false`: the runtime should drop unknown keys. Dangerous fields are deliberately
  not exposed (`planOverride`, `schedule` on `digest.config.save`, `autoPublish`, `mode` on `brain.generate`, `scheduledAt` on `queue.post.update`).

## Auth model per route

`ROUTE_AUTH` in the registry is the machine-readable table. Summary:
- Bearer = the owner's Firebase ID token. Most routes resolve the client with `getEffectiveClientContext(request)`, so admin
  `?as=<clientId>` impersonation works (append `as=` when impersonating).
- `quote-targets`, `x-monitor`, `archive-inbox`: also `isAdminEmail`; `quote-targets` additionally `requirePilotOwner`.
- `digest-config`, `email-digest`, `cost-report`, `pre-digest-refresh`: `verifyAdminRequest`; **no impersonation**, the client is the
  explicit `clientId` in body/query (runtime always sends it).
- `social-posting`: any user, but approve/schedule/reject/reconcile and v2 rows need the pilot owner.

Awkward for in-process invocation: `email-digest` preview/send-now forward to the legacy digest route through an internal fetch
(needs a reachable origin); `opportunity-signals-refresh`, `watchlist-pull`, `recipe-run` rate-limit per IP+client (an in-process
Request has no forwarded IP, so they share one bucket); `marketing-brief-run` and `pre-digest-refresh` can run 270-300 s inside the request.

## Adding an action

1. Read the route source; find the `action` literal and the body fields it reads. Do not guess field names.
2. Add an entry to the right `catalog/*.js` file (new route => add to `ROUTE_MODULES`, `ROUTE_FILES`, `ROUTE_AUTH`).
3. Pick the tier by the rules above. If one route action can be reversible or armed (a `scheduledAt`, a `mode:'llm'`), split it into two entries using `fixed`.
4. Add `snapshot` (or `undo`) for every tier 1/2 write where one doc captures the state; give tier 3 a `cost`.
5. `node --test features/x-strategy/__tests__/action-registry.test.js`. The coverage test fails if a new action appears in
   `quote-targets` or `social-posting` without being catalogued or added to the test's explicit exclusion set.

## Exclusions (never agent actions)

Account/client deletion, provisioning and creation, `admin/client-configs` bulk ops, payments, OAuth (`oauth/*`, X OAuth,
Google Calendar connect/callback, `x-monitor connect-start`), Telegram webhook setup, `worker/*` other than
`pre-digest-refresh`, `mcp/*`. In `quote-targets`: `strategy-chat-send`/`strategy-chat-history` (recursion),
`strategy-proposal-decide` (the agent must not approve its own cards), `strategy-review`, `save-thumb` (binary), `media-url`.
Cron-only `social-posting GET ?action=process-due`. See the comment block at the top of `action-registry.js`.

## Media tools (2026-10-17, PRs #23, #24, #29, #30)

Dedicated read tools beside the registry (chat `features/x-strategy/agent/tools.js`; MCP gets `strategy_*` twins):
- `find_hires_media` (`features/x-content-inventory/hires-finder.js`, pure + conservative): finds the NAS original behind a post's low-res picture. Exact Facebook photo-id match wins; else OCR text ≥60% same, no event-date conflict, aspect within 6%, score ≥50. Reads every NAS package (paged, 60 s memo). The item's **own** file is always listed last (`self:true`) and is the `bestId` fallback — "no larger copy" never means "nothing to give".
- Catalog action `media.use-hires` (tier 1, snapshot + undo; `hires-media.js`): stages through `nas-stage` (Mac analyzer), swaps the post's media in a transaction, links media to the item, returns a download URL. If the copy is still running it records `hiresPending`; the worker COMPLETE hook (`app/api/archive/commands/worker/route.js` → `attachStagedHires`) attaches it later (editable posts only). Post sheet has a "Get high-res" panel (`HiresMediaPanel.jsx`).
- `get_media_link` (`media-link.js` pure + `media-signers.js`): itemId | postId | query (+ kind). EditVideos `ev:` → signed 6.9-day URL; Hitloop storage → permanent token URL; http(s)/Arweave pass through; poster + thumbnail too. NAS not copied yet → `needsStaging` (+ `nas.stage`); never-public refused; gone → `missing`.
- Trap fixed in #24: NAS upload headers must be lowercase `content-type` (the worker spreads server headers over its own; mixed case sent the header twice and broke the GCS v4 signature → 403).

## Calendar Stage, Mac queue and Daily refresh (2026-10-18)

- `queue.post.attach-item-media` (tier 1, snapshot; route action `post-attach-item-media`, `features/x-content-inventory/attach-item-media.js`): a library item's media onto a post, the editor's "Add / change creative". Goes through `swapPostMedia` (approval + schedule cleared on approved/scheduled v2 rows). Refuses never-public and non-X formats (.mov/webm); unstaged NAS → `needs-staging` (then `nas.stage`).
- `queue.post.quoted-preview` (tier 0; `quoted-post-preview`, `features/x-quote-targets/quoted-preview.js`): the tweet a quote post quotes, from the stored quote scan only (no X call).
- `calendar.quote-scan.status` (tier 0; `quote-scan-status`): a Mac quote scan queued by Refresh › Quote targets (Mac source) or MCP `request_quote_scan` (queue `x_quote_scan_requests`, `features/x-quote-targets/scan-queue.js`; drained by the Mac refresh worker every 60 s, installer `scripts/x-content/install-refresh-worker.sh`).
- `refresh.daily.get` (tier 0) / `refresh.daily.save` (tier 3, paid: standing daily spend; snapshot `digest_config/{clientId}.refreshDaily`): route `refresh-daily` (`app/api/admin/refresh-daily`, admin, explicit client). Profile logic `features/intelligence/_refresh-daily.js`.
- MCP: free syncs `request_quote_scan` + `quote_scan_status` (beside `request_strategy_refresh`); the registry entries above reach MCP through `find_actions` / `chat_send`.
- Undo never restores a snapshot whose `before` or `after` is on the publishing schedule (`action-runtime.js`); it says to unschedule / schedule instead.
- Trusted scheduling: `queue.post.schedule-approved` (tier 3, external x, `trusted:'schedule-approved'`) is the only entry that can run without a card — `resolveGate` returns `run` only while `agentAutonomy.trustedSchedule.enabled` (default off) and the batch is within `dailyCap`. Server: social-posting `trusted-schedule` → `trustedSchedulePost` (owner-approved v2 + unchanged hash + lead ≥ `minLeadMinutes` + daily cap; reads the setting from Firestore, never from the request). UI: Agent permissions panel.

## Runtime contract (action-runtime.js)
- `fixed` body/query fields are merged AFTER the agent's args. Unknown arg keys are dropped when the schema is closed and reported as `droppedArgs` in the run_action result.
- `action:null` + `query:{action}` entries send the action in the query string (POST body carries the payload); GET entries pass args as query params.
- `ROUTE_AUTH.clientFrom:'explicit'` routes (verifyAdminRequest) get `clientId` in body/query and never `as=`; `'context'` routes get `as=` while impersonating.
- `viaRefreshPanel` entries (`refreshGroups` / `refreshGroupsByArg`) are never invoked from chat: run_action returns a `refresh` proposal and the dashboard Refresh panel runs the groups. Unmapped args = "cannot run in chat".
- email-digest preview/send-now forward to `digestSelfOrigin()` (env/prod domain) on their own; no origin is needed from the chat request.
- Refused for the agent everywhere (run, cards, invoke): strategy-autonomy-save, strategy-proposal-decide, strategy-chat-send, strategy-action-undo, or any entry whose args expose an autonomy field.
