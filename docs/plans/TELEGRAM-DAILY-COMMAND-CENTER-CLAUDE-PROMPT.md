# Claude implementation prompt — Telegram daily command center

Read and implement the updated `docs/plans/TELEGRAM-CONTENT-UX-MASTER-PLAN.md`. Its updated daily-command-center priority and revised T0–T6 supersede the old upload-first order.

Goal: I manage daily social activity in Telegram. What's happening? gives distilled market insights, leading on-brand tweets/conversations and the same available information as my HITLOOP email brief. I see strategy/calendar and outstanding actions. When a post needs attention, send its video/image, exact copy, target account and local time. Let me revise, take the bundle and post myself, or explicitly authorize existing HITLOOP delivery.

Verify current integrated hardened base; last inspected release/content-system at 0898d614. Read current SSOT, developer handoff, digest/email readers, lifecycle/reservations, context, queue and storage code. Preserve ongoing edits and use an isolated worktree. Recheck official Telegram limits. Delegate bounded disjoint tasks if useful; keep shared contracts/lifecycle under one integration owner.

Reuse HITLOOP structured brief data, shared Brain/strategy context, opportunity readers, library, post queue, hardened approvals/reservations and publisher. No second content engine or bot-specific publishing service. Reads show freshness and never secretly initiate paid generation. Respect owner pilot restrictions and permissions on every action.

First demo milestone: secure linking + What's happening? + Today/Calendar + durable timed post previews/manual bundle using existing content. Uploads are next, not a dependency. Preview assets separately from exact copy for easy download/copy. Main menu: What's happening? / Today's posts / Calendar / Upload content / Settings.

Manual handoff is default. Post myself must claim delivery atomically and hold/remove auto scheduling before the same post can publish elsewhere. I've posted it records user-reported completion, optionally a permalink; never fake verified delivery/metrics. Shared web, calendar, results and publisher respect that state. Refuse manual takeover once automatic delivery has begun. Unsupported replies stay manual.

Optional automatic delivery uses clearly named Approve & schedule / Approve & post now, with target/time visible, exact revision and current clearance/expiry/plan checks. No implicit publishing from conversational agreement. Expired approval cards, duplicate clicks, concurrent edits and reschedules cannot apply stale actions. Missed approval stays unsent and asks to reschedule.

Implement durable inbox/outbox and due-time dispatch, not request timers. Re-read post state before notifying, invalidate superseded cards, deduplicate business actions, handle 429/timeouts and document notification latency. Quiet hours and notification pause must not silently alter schedules. Prefer briefings and actionable failures over repeated unchanged alerts.

Then implement photo/video/album intake into the existing library, factual-context questions and large-file upload continuation. No automatic remix, paid analysis or posting approval on upload.

Tests: brief/source parity, freshness, calendar parity, timezone/reminders, media fallback, revisions, manual-auto race, self-reported vs verified completion, overdue approval, duplicate updates/callbacks, permission revocation, processing recovery and upload parity. Fresh review on auth/lifecycle changes, integrated checks and phone walkthrough. Update SSOT/runbook and concise video handoff to verified behavior.

Complete reviewable local implementation first. No push/deploy, bot/webhook activation, external messages, paid calls or live publishing without explicit authorization. Private-bot messaging and live X posting are separate pilot gates. Use injected transport/storage/publisher until then. Final handoff: branch/commits, phases completed, evidence, simple user walkthrough, worker/setup requirements, remaining limits and exact activation steps.
