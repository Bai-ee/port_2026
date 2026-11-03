# Content system — status + review brief (2026-10-18)

For an outside reviewer. This doc holds the status. The SSOTs it links hold the details. `main` head at writing: `3c25a7dd` (PR #30).

## Goal

One admin-level system that runs a client's X content end to end:
**find material → draft → review → approve → schedule → publish → measure**, steered by the approved Client Brain and a versioned strategy plan.

The Marketing Director **strategy chat agent** is meant to operate all of it at admin level:
- It reads any data and says when that data is stale.
- It refreshes data through the single Refresh panel.
- It fills the calendar every day per content track. Tracks cover birthdays, record and mix videos, throwbacks, quotes, narratives and client work.
- It can do anything a dashboard button can do, behind safety tiers.

Hard rules:
- Everything the system creates is a **draft**.
- Publishing to X always needs the owner's typed confirmation.
- Paid refreshes run only through the Refresh panel's confirm row.
- The agent cannot change its own autonomy or approve its own cards.

Multi-client: `home`, UE and NTR are live (`PILOT_CLIENT_IDS`). Home posts as @UGExistence on purpose.

## Read in this order

1. [`docs/DEVELOPER-HANDOFF-CONTENT-SYSTEM.md`](../DEVELOPER-HANDOFF-CONTENT-SYSTEM.md): the 2026-10-11 foundation (Content Engine, daily loop, `social_posts` lifecycle, pilot hardening, safety model).
2. [`source-of-truth/CONTENT-MANAGEMENT.md`](../source-of-truth/CONTENT-MANAGEMENT.md): who owns what, lifecycle, scheduling.
3. [`source-of-truth/CONTENT-PILOT-OPERATIONS.md`](../source-of-truth/CONTENT-PILOT-OPERATIONS.md) §1b–1f: multi-client wiring.
4. [`source-of-truth/CONTENT-TRACKS.md`](../source-of-truth/CONTENT-TRACKS.md): bucket tracks, calendar batch, item media, **daily fill**, **one calendar**.
5. [`source-of-truth/X-STRATEGY-TAB.md`](../source-of-truth/X-STRATEGY-TAB.md): plan, strategy doc, chat, brief bundle + freshness, data sources (Mac vs X API).
6. [`source-of-truth/AGENT-ACTION-REGISTRY.md`](../source-of-truth/AGENT-ACTION-REGISTRY.md): 158-action registry, tiers, auth, runtime, **media tools**.
7. [`source-of-truth/MARKETING-DIRECTOR.md`](../source-of-truth/MARKETING-DIRECTOR.md): cards + Refresh + cost model. [`CLIENT-BRAIN-SOURCE-OF-TRUTH.md`](../source-of-truth/CLIENT-BRAIN-SOURCE-OF-TRUTH.md): the Brain owns strategy fields.
8. [`source-of-truth/X-API-AND-PROFILE-OPERATIONS.md`](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md): X spend gate + ledger. [`TELEGRAM-COMMAND-CENTER.md`](../source-of-truth/TELEGRAM-COMMAND-CENTER.md).

## Shipped since the foundation (all on `main`, prod auto-deploys)

| PR | Commit | What | Doc |
|---|---|---|---|
| #16 | `898daf44` | Track lists → daily signals | CONTENT-TRACKS |
| #17–#19 | `e09e9dab` `7c93e2d6` `1e16c401` | One track per Content Center bucket, calendar batch, bucket colors, item media, awaited Brain write-back | CONTENT-TRACKS |
| #21 | `76186e65` | Full-control agent (registry, tiers, undo, typed confirm, autonomy panel), daily fill + cron, brief bundle + freshness, X API sources + spend ledger, MCP chat parity, reply format, unmet-request log | AGENT-ACTION-REGISTRY, CONTENT-TRACKS, X-STRATEGY-TAB, X-API |
| #22 | `4568859a` | Dark-default Midnight theme, chat formatting + toolbar (UI) | THEME-STUDIO |
| #23 #24 #29 | `d7785b55` `154d8ac1` `604bc45c` | High-res originals from the NAS (`find_hires_media`, `media.use-hires`, auto-attach on staging complete, own original always deliverable) | AGENT-ACTION-REGISTRY § Media tools |
| #25 #26 #27 | `f16ec2b6` `046fab16` `4656f2e9` | One calendar (all statuses + suggestions + requotes, inline approve), `get_calendar`, placeholders never block approval, agent gets today's date | CONTENT-TRACKS § One calendar |
| #28 | `f6695c80` | Telegram Copy + high-res button, `/creative` | TELEGRAM-COMMAND-CENTER |
| #30 | `3c25a7dd` | `get_media_link`: a link to any video or image | AGENT-ACTION-REGISTRY § Media tools |
| #31 | `fe129aad` | Video Remix accepts artist names with parentheses | (bug fix) |

Rollback target from before the #21 batch: deploy `port-2026-6i49xb1wf` (`1e16c401`).

## Verified vs not verified

**Verified:**
- Unit and integration tests: `npm test` about 7030 of 7038 pass. The 8 known failures already fail on main: telegram revise/reschedule ×4 plus "I've posted it", vendor-sync ×2, and chat-queue "post-edit executor", which depends on the date.
- `next build` passes for every PR.
- Live reads on prod data:
  - The calendar on 10-17 shows 3 requotes, 1 suggestion and pending posts with Approve.
  - A high-res original auto-attached on 2 real posts (Housepit, HUSH).
  - A `get_media_link` signed URL returns HEAD 200.
  - The daily-fill prod dry run produced 25 drafts over 7 days.

**Not verified (open):**
1. **The agent runtime has not been driven against real routes by the owner.** That covers `run_action` tiers, undo chip, delete card, typed-confirm schedule, "what's stale?", "fill the next 7 days", memory suggestions and media tasks. Only injected tests cover it.
2. **The daily-loop cron (11:30 UTC) has not been checked since #21.** Two things to confirm: the fill drafts appear, and no `x_content_daily_runs` are stuck in `running`.
3. The Telegram bot is still inactive: there's no `TELEGRAM_*` env in prod.
4. The owner has not run a paid Refresh batch in prod.
5. The X API spend ledger (`x_api_usage/{day}`) hasn't been reconciled against a real paid run.

## Known gaps / risks for the reviewer

- **Local dev uses production Firestore.** Confirming agent cards on localhost writes real drafts.
- **In-process route invoke:** the agent calls routes in-process with the owner's auth. The IP-keyed rate limits (`opportunity-signals-refresh`, `watchlist-pull`, `recipe-run`) all share one bucket. Long jobs must go through the Refresh panel, never through the chat request.
- **MCP:** it uses OAuth, not the Firebase bearer, so `run_action` is not exposed there. Write actions become dashboard cards.
- **Content Engine library payload:** about 6.6 MB. The `inventory-list` loader split was not done.
- **Corpus refresh** for @UGExistence needs the owner's Mac worker (launchd needs Full Disk Access).
- **Branch hygiene:** PR #20 (`feat/agent-loop`) is still OPEN but was superseded by #21. Close it.
- **Docs:** fixed on 2026-10-18. CONTENT-TRACKS previously said approve refuses placeholder text, which has been wrong since #25. One calendar and the media tools are now documented. These SSOTs still predate #21–#30 and were not re-audited: CONTENT-MANAGEMENT, MARKETING-DIRECTOR, CONTENT-PILOT-OPERATIONS.

## What to review

- **Safety model.** Can any path publish to X, spend, or self-approve without an owner confirm? Check the tier assignment in `features/x-strategy/agent/catalog/*` and the refusals in `action-runtime.js`.
- **Lifecycle integrity.** Check every `social_posts` write path: `approveInMemory`, `calendar-*` routes, daily fill `ensureDraftPost`, and `attachStagedHires`. They must respect revisions, `approvedHash` and the publish-time placeholder guard.
- **Idempotency of daily fill and the cron.** Check `daily-fill.js` keys, and re-run behavior on `app/api/worker/daily-loop/route.js`.
- **Scope drift between the docs and the code** for the four sections updated on 2026-10-18.
