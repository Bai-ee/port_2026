# Multi-client — final pass contract (2026-10-14)

Owner-approved target for this round. Supersedes the open-items lists in `MULTI-CLIENT-WIRING-ORCHESTRATION-HANDOFF.md` §4 for what ships next. Companion: that handoff (constraints §2, dispatch §3, report §7 still apply).

## 1. What the owner expects (accepted scope)

**Agency-operated multi-client.** One admin login. The dashboard client switcher (`?as=<clientId>`) selects any onboarded client; every Marketing Director surface then reads/writes only that client: Brain, Strategy doc, plan + tracks, Today, Queue/Compose, Results/X Monitor, Email Digest, Social Accounts. Publishing uses that client's own connected X account; every spend is the owner's own click per client per batch.

**Onboarding for many clients.** A signup (website URL + optional X/IG/competitors/goal) produces a Creative Brief, a Brain **draft** from its own data, `digest_config` (off), scout config. The owner then: approves the Brain, connects X, builds the plan from the doc. Then the loop runs for that client.

**Hard assets per client.** Media dropped on the NAS under a client's folder is analyzed into that client's inventory only and surfaces in that client's Buckets/Timeline/Today.

**Explicitly NOT in this round (accepted):** clients operating the system themselves (Phase 5); paywall enforcement; per-client score weights (global, measured on @bai_ee); auto-adding clients to env lists.

## 2. Done (in production since 2026-10-14, deploy `dpl_dxk3LPKZEvggH1SN7hyNUVf3p1B4`, rollback `dpl_2GjpiSoiT96ukt83qs8teubhB6R8`)

| Area | State |
|---|---|
| Readiness gate | `assertClientReady`: approved Brain + plan doc + connected X username, or `clients/{id}.contentLoop.enabled`. Home enabled. |
| Inventory | `x_content_packages.clientId` required everywhere; 6,276 rows stamped home; NAS/archive/rendered owner = env `NAS_INVENTORY_CLIENT_ID` (home). |
| X identity | Global token served to home only; X Monitor + audience per client; token refresh never leaks into another client's record. |
| Priors | Watchlist/timezone/own+benchmark handles in `client_configs.marketingBriefConfig.xGrowth`; home seeded; no Seb/Hitloop defaults in code (`benchmarkPrimary ''`, `DEFAULT_TRACKS []`, blank Strategy seed). |
| Signup | Optional brand fields; crawl → scout config → brand overview → Brain draft (≤2 Anthropic calls); `digest_config` off; `contentLoop.enabled=false`. Brain-wins upload path tested. |
| Already per client before this work | `process-due` sweep, digest enrollment + `recipientEmail`, Client Brain, Telegram bindings, Strategy doc/plan docs. |

## 3. Open and relevant (what the owner does not have yet)

| # | Gap | Why it matters | Resolved by |
|---|---|---|---|
| A | NAS is single-owner (`NAS_INVENTORY_CLIENT_ID`) | No per-client hard-asset analysis | **Resolved** (F1, built 2026-10-14) |
| B | Brain tracks cannot be adopted by a client with no tracks (every engine must belong to a track; adoption refused) | A fresh client never gets tracks from its Brain → no track targets, no Today plan | **Resolved** (F2) |
| C | Benchmark corpora: committed corpora are Bryan's; per-client benchmark pulls have no path | Other clients' Strategy evaluation has no benchmark rows | **Resolved** (F3) |
| D | Non-home clients have no content writers proven live (Timeline/social-archive ingest, Telegram intake) | Empty inventory → empty Today | **Resolved** (F4: proven client-keyed, no code change needed beyond a test) |
| E | `DashboardPage.jsx` X Monitor tile ignores the switcher (card inside Results follows it) | Confusing while testing | **Resolved** (F5) |
| F | Each client must be added by hand to `PILOT_CLIENT_IDS` and the scan job `--clients` | Manual step per client | Accepted; documented in §5 checklist |
| G | Home's `social_accounts` X record is @UGExistence while `xGrowth.ownHandle` is `bai_ee` | Home publishes/resolves own handle as UGExistence | Owner data decision (disconnect from home, connect on UE) |
| H | `chat-queue.test.js` 2 date-bomb failures | Noise in every test run | **Resolved** (F6) |
| I | Self-serve client access, MCP user→client map, paywall | Not this round | Phase 5, separate |

## 4. Final pass — build scope (one PR, branch `feat/multi-client-3a-inventory` reset onto `main`)

> **SHIPPED to production 2026-10-14:** PR #11 squash `aab5edaf`, deploy `dpl_HUs95qCGvtu7qrVzFeZQxFiNWhb5` (hitloop.agency), rollback `dpl_2GjpiSoiT96ukt83qs8teubhB6R8`. Worker: `assetManager` `58aaf34` on `analyzer-fast-rerun` (pushed; owner restarts the worker). Verified: suite 5,614 / 5,612 / 2 baseline; build ok; worker 210/210. Owner testing (§5) is next.

| Item | Scope | Files (start here) |
|---|---|---|
| F1 NAS per client | Folder convention `HITLOOP-ARCHIVE/<client-slug>/<collection>/<pillar>/` (legacy top-level collections = home). Worker (`~/Documents/Repos/assetManager`, PUBLIC repo, branch `analyzer-fast-rerun`) maps top folder → `clientId` via a committed `clients.map.json` (slug → id; no secrets) and sends `clientId` per item. Hitloop NAS stage/archive-inbox/rendered-sync accept the worker's `clientId`, with `NAS_INVENTORY_CLIENT_ID` as fallback only for items that carry none. Archive Inbox + Buckets filter by active client. Existing home files: no move required (legacy = home). | Hitloop: `features/x-content-inventory/nas.js`, `app/api/dashboard/archive-inbox/route.js`, `scripts/x-content/sync-rendered-videos.mjs`, `features/x-content-inventory/store.js` (`upsertPackage` owner rules unchanged). Worker: `assetManager` organizer/analyzer item payload. |
| F2 Tracks adoption | Let a client with zero tracks adopt Brain tracks: Brain track rows map to engines by a default rule (all engines the client has content for; else `client`), or relax "every engine must belong to a track" to "every engine with packages must belong to a track". Add an "Add track" affordance in the Content tracks panel empty state (`#x-strategy-content-tracks-empty`). | `features/x-strategy/content-tracks.js`, `features/client-brain/brain-sync.cjs` (adoption of `contentTracks`; do not change Brain-wins), `components/dashboard/XStrategy*` tracks panel. |
| F3 Benchmarks per client | Per-client benchmark pull: `scripts/x-content/pull-corpora.mjs --client <id>` reads `xGrowth.benchmarkHandles` + `ownHandle`, pulls via `bird` (local, free), writes `loop-corpora` rows keyed by handle. Add to the launchd scan job (same label, after the scan). Committed corpora stay home-only seed. | `features/x-strategy/loop-corpora.js`, `scripts/x-content/scan-quote-targets.mjs`, `install-scan-schedule.sh`. |
| F4 Content writers live | Prove on a localhost view-only run (no writes to prod) then document: `scripts/social-archive/ingest.mjs --client <id> --handle <x>`; Telegram binding per client; Brain Content Library. Fix anything that assumes home. | `scripts/social-archive/ingest.mjs`, `features/telegram/intake*.js`. |
| F5 X Monitor tile | Tile reads the active client (`activeClientId`), same as the Results card. Do not edit during a running local run. | `DashboardPage.jsx` x-monitor tile only (do-not-touch list lifted for this one site). |
| F6 Test hygiene | `chat-queue.test.js` fixture dates relative to `NOW`. | `features/x-strategy/__tests__/chat-queue.test.js:13-14`. |
| Docs | `CONTENT-PILOT-OPERATIONS.md` §1f (NAS per client, clients.map, pull-corpora), handoff Phase 3b row → built, this doc §3 rows → resolved. | |

**As built (2026-10-14):** rendered-sync and MCP NAS stay home-only (`NAS_INVENTORY_CLIENT_ID`), deliberately: rendered videos are home's, and both fail closed. Engine reassignment between tracks is not in the UI yet (first track owns all engines after adoption).

Constraints unchanged: no prod writes, no X API calls, no paywall changes, worker repo is PUBLIC (no LAN secrets beyond what HEAD already has), one PR, stop after the report. Worker changes: commit on `analyzer-fast-rerun`, push, do not restart the owner's worker.

**Accept (agent-verifiable):** full suite green minus the 2 studio-render baseline; build passes; a fixture client with zero tracks adopts 2 Brain tracks; `pull-corpora --client <fixture>` dry run resolves handles from `xGrowth`; worker unit tests pass with a `clients.map.json` of two slugs; NAS item with `clientId` lands under that client and a legacy item lands under home.

## 5. Owner test checklist (after the final pass deploys)

Per client (start: home, then UE, then NTR):
1. Switcher → client. Brain: inject/approve. Social Accounts: connect X, confirm username. Strategy: Builder follows doc → plan + tracks (F2 for a fresh client). Digest: recipient + toggles.
2. Add client to `PILOT_CLIENT_IDS` (Vercel) and `install-scan-schedule.sh install <id1,id2>` (Mac).
3. NAS: drop one video under `HITLOOP-ARCHIVE/<client-slug>/<collection>/<pillar>/`; run worker; confirm it appears only in that client's Buckets.
4. Today → Compose → Schedule one post (your click = spend); confirm it publishes on that client's X.
5. Results: X Monitor sync (confirm row) shows that client's account; audience from its own id.
6. Email Digest: preview with `preview=1&noLlm=1`, then Generate & Send to the client's recipient.
7. Fresh signup on localhost with the optional fields → delete account; check Brain draft, scoutConfig, digest off, ≤2 Anthropic calls.
8. Home regression: Today/Queue unchanged, scan log at 06:30, X Monitor unchanged.

Decision still yours: @UGExistence on home (G).
