# Telegram command center — as-built SSOT

> **Multi-client (2026-10-14):** bindings are per client (one active binding per `clientId`) and every read, card and intake write is keyed to the bound client; there is no home default. Access is still `requirePilotOwner` (`PILOT_OWNER_UIDS`/`PILOT_CLIENT_IDS`; prod = home, UE, NTR). The Library is client-scoped (`x_content_packages.clientId`), so uploads land in the bound client's inventory only. Still inactive until the owner creates the bot/env/webhook. See [`CONTENT-PILOT-OPERATIONS.md`](CONTENT-PILOT-OPERATIONS.md) §1b–1f.

Status (2026-10-11): built and tested locally on `feat/telegram-command-center` (from `main` @ b3978fca). **Not activated**: no bot exists yet, no webhook is registered, and no Telegram message or live X post has been sent. Contracts: [`docs/plans/TELEGRAM-COMMAND-CENTER-CONTRACTS.md`](../plans/TELEGRAM-COMMAND-CENTER-CONTRACTS.md). Plan and intent: [`TELEGRAM-CONTENT-UX-MASTER-PLAN.md`](../plans/TELEGRAM-CONTENT-UX-MASTER-PLAN.md), [`TELEGRAM-DAILY-COMMAND-CENTER-CLAUDE-PROMPT.md`](../plans/TELEGRAM-DAILY-COMMAND-CENTER-CLAUDE-PROMPT.md).

Telegram is a second interface to the same HITLOOP records. It has no strategy engine, post queue, approval policy or publisher of its own. It reads the same brief data the email uses, shows the same calendar, and changes posts only through `features/social-posting/twitter-service.js`, the same functions the web calendar calls.

## What the owner gets
(Per bound client; the admin links each client's chat from the dashboard switcher.)
Main menu: **What's happening?** · **Today's posts** · **Calendar** · **Upload content** · **Settings**.

- **What's happening?** An overview, then four sections: Market insights / Conversations to join / Needs review / More detail.
  - Data comes from `getBriefForClient` (email-brief data), the quote-target scan, and the post queue. Reading never starts a refresh or a paid call.
  - Every section shows its freshness. A stale brief says so.
  - "Conversations to join" labels each item as either a current scan item (with its age and an open/closed window) or "from the last brief".
  - Suggested replies follow the email's rule: shown only while fresh, under 26h old.
- **Today's posts / Calendar.** These read the same `buildMonthCalendar` the web uses. Labels distinguish proposed (not approved), approved, scheduled, posting manually, posted (verified) and posted (you reported). Times show in the settings timezone. Day grouping stays on the calendar's CT axis.
- **Timed handoff card.** A post enters the lead window (default 30 min before its time) and the next dispatch sends it as separate messages:
  - the media (photo/video by URL, falling back to a download link)
  - the **exact copy**, with no formatting, so it copies byte-exact
  - account, local time, status and why it was picked, with buttons
- **Card buttons by state:**
  - Unapproved draft: Post myself · Revise · Approve & schedule ‹time› · Approve & post now · Reschedule · Skip.
  - Already approved and scheduled: a status reminder with Post myself (take over) · Reschedule · Revise. It is not asked for approval again.
  - Posting manually: I've posted it · Send assets · Release back to HITLOOP.
  - Reply posts: manual only. Approve buttons are never shown, because threaded publishing is unsupported.
- **Missed approval.** An unapproved post whose time passed gets one "missed — not sent, reschedule?" card. It is never sent late.
- **Upload content.** Photos, videos and albums go into the existing Library (`x_content_packages`) with Telegram provenance.
  - Rights stay `client-approval-needed`. Uploading never means clearance, and there is no remix, analysis or posting.
  - The caption, or a single "What should people know?" answer, is stored as factual context.
  - Files over 20 MB get a 30-minute scoped web upload link at `/telegram-upload/<token>`.
- **Settings** (in Telegram, and in full in the Content Engine → More → **Telegram** tab): timezone, review lead time, daily briefing on/off and hour, quiet hours, pause notifications, failure alerts and success summary. **Quiet hours and pause only affect notifications. They never move or cancel posts.**

## Post lifecycle additions (shared, all surfaces)
- **New status `manual` ("Posting manually").**
  - It is set by `claimManualDelivery` inside the same revision-checked transaction that the sweeper's `claimDuePost` races against. Manual and automatic delivery are therefore mutually exclusive.
  - The sweeper only claims scheduled, queued and retryable-failed rows, so it never touches `manual`.
  - A takeover is refused once a row is `posting` (`auto-delivery-started`), `posted`, `needs_review` (reconcile first) or `rejected`.
  - `manual` counts as pending: it holds its slot (when taken from a live scheduled/queued slot) and its package, so the material can't be scheduled twice. It is also in `OPEN_STATUSES`.
  - Edits are refused (`manual-claimed`); release it first.
- **`recordManualPosted`** ("I've posted it").
  - Sets `status:'posted'`, `deliveryMode:'manual'`, `deliveryVerified:false`, `reportedPostedAt`, `reportedBy`, and optionally `permalink` and `reportedPlatformId` (x.com/twitter.com status URLs only).
  - `twitterId` stays null, because that field means "HITLOOP published it".
  - The package use is counted (`lastManualPostId`) but never stored as a verified tweet id.
  - Calling it from a scheduled row claims atomically in the same transaction.
- **`releaseManualClaim`.** Returns the row to `approved` (if the approval hash still matches) or `draft`, unscheduled, with the slot freed.
- **`approveAndPostNow`.** This is the explicit "Approve & post now" on an existing row.
  - It runs the same approval gate, reply/clearance/window/package rules and plan reservation as approve-and-schedule, with the slot set to now.
  - It then uses the sweeper's own claim, delivery recheck and publisher.
  - A duplicate request returns the existing result. If the cron wins the claim, the cron publishes and the bot reports it.
- **Reservations.** Keeping the exact slot a row already holds (scheduled → manual) is no longer re-checked against the plan, because it is not a new scheduling decision.
- **Display.** `month-calendar` (state `manual`, `selfReported`, `permalink`), `results` (manual counts as waiting; `selfReported` posted rows), the PostSheet, ResultsPostList and DailySuggestions labels.

## Architecture
```
Telegram → POST /api/telegram/webhook   (secret header, ≤256 KB, message|callback_query only)
           → telegram_updates (create = dedup by update_id) → 200
           → after(): runtime.processUpdate (lease) → bot.handleUpdate
Vercel cron */5 → /api/worker/telegram-dispatch (Bearer CRON_SECRET)
           → reclaim unfinished updates → per active binding (access-checked): handoffs, missed cards,
             daily briefing, failure alerts → telegram_outbox → drain (re-read post first; 429 retry_after)
           → intake.finalizeDue (album quiet period, retries)
Web: Content Engine → More → Telegram (/api/dashboard/telegram: link-start, link-confirm, unlink, save-settings)
```
Modules (`features/telegram/`):
- `transport.js`: Bot API adapter and fake. Errors never carry the token.
- `store.js`: link challenges, bindings, inbox, tickets, outbox, notices, settings, state and pending.
- `read-models.js` + `briefing.js`: LLM-free reads and HTML formatting, capped at 4096 characters.
- `handoff.js`: card builder and DST-safe time helpers.
- `bot.js`, `scheduler.js`.
- `access.js`: binding is active plus `requirePilotOwner`.
- `intake.js` + `intake-storage.js`: uploads.
- `continuation.js`: large-file tokens.
- `runtime.js`: production wiring.

Collections: `telegram_link_challenges`, `telegram_link_pending`, `telegram_bindings`, `telegram_updates`, `telegram_tickets`, `telegram_outbox`, `telegram_notices`, `telegram_settings`, `telegram_state`, `telegram_pending`, `telegram_intakes`. Queries use a single field only, so there are no composite indexes.

## Security model
- **Linking is two-step.**
  - The web route mints a one-time, 10-minute deep link. Only its sha256 hash is stored.
  - Opening it in Telegram records which account opened it.
  - **The binding is created only when the signed-in owner confirms that account in HITLOOP.** A leaked link can't bind a stranger.
- **Identity.** Identity is the numeric Telegram user id and the chat id, never the username. One active binding per client; relinking revokes the old one and raises `bindingVersion`.
- **Access checks.** Every update, callback, scheduled send and continuation upload re-checks that the binding is active and passes `requirePilotOwner` with `PILOT_OWNER_UIDS`/`PILOT_CLIENT_IDS`, which fails closed in production.
- **Buttons are opaque tickets.** `callback_data` is `t:<12-char id>` (well under 64 bytes) and carries no post text or credentials.
  - Each ticket is bound to client, post, revision, action, Telegram user and `bindingVersion`, with a 24h TTL.
  - Before applying, the bot re-reads the post: a changed revision, a superseded or expired ticket, or a version mismatch answers "This card is out of date" and sends a fresh card.
  - Ticket claim/settle makes a repeat tap replay the stored result, and the service calls are revision-checked, so a crash re-run cannot double-apply.
- **Actor recorded** as `telegram:<telegramUserId>:<uid>` (`reviewedBy`, `manualClaimedBy`, `reportedBy`).
- **No implicit approval.** Free text without a pending prompt is never treated as approval.
- **Secrets.** The bot token is never logged or stored. Telegram file URLs (which contain the token) are never persisted; intake stores error codes only.

## Notification latency
- Dispatch runs every 5 minutes. A handoff card arrives within about 5 minutes of the post entering its lead window. Interactive replies are immediate, sent from the webhook's deferred processing.
- If deferred processing dies, the next dispatch reprocesses the update (lease 60s, 5 attempts, then `dead`).
- Outbox backoff is 30s / 2m / 8m / 20m, or Telegram's `retry_after` when that is larger; after 5 attempts the message is marked failed.
- **A failed Telegram send never changes post state.** The task stays visible on the web.

## Environment (names only; none are set yet)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (1–256 characters, `[A-Za-z0-9_-]`).
- `TELEGRAM_UPLOAD_SECRET` (large-file links; unset means no link and "add it in HITLOOP instead").
- Optional `TELEGRAM_PUBLIC_BASE_URL` (default `https://hitloop.agency`).
- Existing: `CRON_SECRET`, `PILOT_OWNER_UIDS`, `PILOT_CLIENT_IDS`.

Without the token, the webhook returns 503, dispatch reports `skipped: telegram-not-configured`, and the settings tab shows "Bot not activated yet".

## Activation (owner-authorized steps, in order)
1. **Create the bot.** In @BotFather, `/newbot`. Keep the token private. Optionally `/setprivacy` (it is a private-chat bot) and `/setcommands` (`menu`, `help`).
2. **Set the Vercel env vars** above for Production, plus a random `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_UPLOAD_SECRET`. Don't add them to Preview unless previews should run the bot.
3. **Merge and deploy** (this adds the `*/5` cron). Confirm `/api/worker/telegram-dispatch` returns 401 without the secret.
4. **Register the webhook (one call):** `setWebhook` with `url=https://hitloop.agency/api/telegram/webhook`, `secret_token=<TELEGRAM_WEBHOOK_SECRET>`, `allowed_updates=["message","callback_query"]`.
5. **Large-file uploads only:** allow browser PUT from `https://hitloop.agency` in the default storage bucket's CORS.
6. **Link.** Content Engine → More → Telegram → Connect Telegram → Open bot → Start → back in HITLOOP, Confirm.
7. **Pilot gate 1 (messaging only):** check What's happening? / Today's posts / Calendar, and a `[CM test]` handoff card ≥30 days out using Post myself, then release or reject it.
8. **Pilot gate 2 (separate authorization):** Approve & post now / Approve & schedule on real posts publish to the bound client's connected X account (home: see CONTENT-PILOT-OPERATIONS §1d) through the existing publisher.

## Tests (2026-10-11)
- 366 Telegram and social-posting tests: `node --test features/telegram/__tests__/*.test.js features/social-posting/__tests__/*.test.js`.
  - Unit tests per module.
  - Manual/auto races (M1–M12).
  - End to end through the real bot + store + scheduler + lifecycle over the fake Firestore (E1–E5): linking needs the web confirm; handoff → Post myself before copy → sweeper skips → self-reported completion; a stale card after a web edit applies nothing; a duplicate post-now tap publishes once; revoked or non-allowlisted owners lose access.
- Full `npm test`: 5197 tests, only the 2 known vendor-api-lib failures.
- A fresh review of auth, lifecycle, secrets and notifications found no blockers. Fixed after review:
  - cards offered actions the services refuse, which looped on "out of date"; cards now offer only valid actions, and refusals show their reason
  - an ambiguous failed post can't be taken over
  - media can't change on a manual post
  - background intake work re-checks access
  - a slow callback answer no longer drops the follow-up
  - an unapproved draft's reschedule is labelled "Approve & pick time"
- **Not verified:**
  - real Telegram delivery
  - phone walkthrough
  - deployed webhook latency
  - real-Firestore contention for the manual claim (the fake Firestore serializes transactions)
  - browser walkthrough of the settings tab

## Known limits
- **Pilot-allowlisted clients only** (`PILOT_CLIENT_IDS`); clients do not operate Telegram themselves (Phase 5, not built).
  - The Library is client-scoped since 2026-10-14 (the old "global Library" blocker is resolved).
  - One private chat per client.
  - No groups, voice or Mini App.
- **Intake.** There is no lease on intake docs: overlapping dispatch runs could double-send an intake message, but never double-store. A late album item after Split is refused with a message. `intake.finalizeDue` doesn't re-check binding access; it only messages the chat that uploaded.
- **Timezones.** Calendar day grouping is America/Chicago, matching the web calendar. Displayed times use the settings timezone.
- **Retired cards.** These have their buttons stripped on a best-effort basis; even when stripping fails, the ticket checks make them inert.
- **Manual claims and packages.** A manual claim taken from a draft or failed row doesn't hold a package reservation doc. Other schedulers are still blocked by the pending-row collision check, which is read-then-write.
- **No timeout on manual rows.** A manual row that kept its slot holds it until the owner acts.
- **Ticket TTL** is 24h. The server revision check, not the TTL, is what blocks stale actions.

## Daily-loop suggestions (2026-10-11)
Suggestion cards, Save/Dismiss/Stage-from-NAS tickets and the per-run notice are specified in [`CONTENT-TRACKS.md`](CONTENT-TRACKS.md). Services: `saveSuggestion`, `dismissSuggestion`, `stageSuggestion` in `runtime.js`.
