# Claude implementation plan — failed dashboard creation

## Product brief

### What this is

When a new dashboard cannot be created, replace the failed Intake Terminal with a clear, support-oriented blocking modal. It explains that setup failed, gives the client a safe error report they can copy, confirms that Bryan was notified automatically, and offers a direct Calendly link. The modal remains the only client experience after sign-in until the incident is resolved by an admin or the client deletes their account.

### Who it is for

A client such as the person who submitted `rositas.com`: their account was created but the intake pipeline failed, leaving them with an unusable dashboard and no useful next step.

### Problem

The current failure path is technically persisted but has poor recovery UX. `failRun` writes a generic `dashboard_state.errorState`; however, `DashboardPage.jsx` continues to show the terminal and lets the client close it. Closing stores `intake-failed-acked:<runId>` in localStorage, so the failure is hidden on future sessions even though the dashboard remains broken. The client cannot tell Bryan what failed, and Bryan has no guaranteed real-time alert.

### V1 does

- Persist one support incident for every **primary dashboard-creation** run that exhausts/fails.
- Automatically notify Bryan once per incident without requiring a client email action.
- Replace the failed terminal with an accessible, non-dismissible resolution modal.
- Provide a client-safe, copyable incident report and a Calendly action.
- Re-gate sign-in while the incident is unresolved, then restore normal dashboard access immediately after an admin resolves/requeues it.
- Keep account deletion as the only destructive escape hatch.

### V1 does not

- Expose stack traces, provider responses, secrets, or other internal diagnostics to clients.
- Block established dashboards because a later module or onboarding-chain run failed.
- Add client self-service retries or an in-modal support chat.
- Claim an email was sent when the notification transport is unavailable.

---

## Scope and decision rules

1. **Hard-gate only a failed initial dashboard build.** Match a primary intake/provisioning run (currently `pipelineType: 'free-tier-intake'` or the project’s actual signup pipeline type), not `pipelineType: 'module-run'` and not a soft `trigger: 'onboarding-chain'` failure. Existing clients must keep their dashboard for module failures.
2. **No close button, backdrop close, or Escape exit.** This is the agreed behavior. The user can open Calendly in a new tab, copy the report, or open the existing account-deletion confirmation. Do not reveal the dashboard underneath.
3. **Persist the gate on the server.** Never use localStorage/sessionStorage acknowledgment to determine whether a broken dashboard should be visible.
4. **Notify once per incident/run, idempotently.** A retry, bootstrap refresh, or page reload must not send duplicate alerts.
5. **Show a user-safe cause.** The report may include a stable category/stage (for example, `website_unreachable`), but never raw `error.message` from `brief_runs`. The admin email/console may contain the sanitized internal error plus a link/run ID.

## Data contract

Use `dashboard_state.errorState` as the client-facing projection and keep the detailed error in the existing admin-only `brief_runs` documents. Extend the error shape, rather than creating a parallel source of truth:

```js
errorState: {
  kind: 'dashboard_creation_failed',
  status: 'open',                 // 'open' | 'resolved'
  incidentId: 'runId',            // idempotency key; use runId for v1
  runId: 'runId',
  failedAt: 'ISO date',
  publicCode: 'HIT-ABC123',       // deterministic/reproducible, safe to share
  publicStage: 'website_access',  // stable, client-safe category
  publicMessage: 'We could not reach the website to build your dashboard.',
  notification: {
    attemptedAt: 'ISO date',
    status: 'sent'                // 'sent' | 'queued' | 'failed' | 'not_configured'
  },
  resolvedAt: null,
  resolvedBy: null,
}
```

Keep `message` temporarily as a backwards-compatible alias during rollout, then migrate all UI reads to `publicMessage`. Do not send or return `brief_runs.error.message` to clients.

Classify known pipeline errors in `api/_lib/run-lifecycle.cjs` (or a small extracted helper) into stable public categories. Use a conservative fallback:

| Condition | `publicStage` | Client copy |
| --- | --- | --- |
| URL/hostname invalid | `website_address` | “We could not validate the website address.” |
| DNS, connection, timeout, 4xx/5xx fetch | `website_access` | “We could not reach the website to build your dashboard.” |
| Screenshot/browser render | `website_rendering` | “We could not read the website well enough to create the dashboard.” |
| Provider/worker/internal unknown | `processing` | “We hit a problem while creating your dashboard.” |

## Implementation plan

### 1. Make lifecycle failures create a durable incident

Files: `api/_lib/run-lifecycle.cjs`, plus focused unit tests beside its existing tests.

- Update `failRun` to identify a **hard initial-creation failure**. Preserve the existing `details.soft` behavior, and explicitly exclude module runs.
- For that case, write the expanded `errorState` with `status: 'open'`, `runId`, safe code/category/message, and no client-visible internals. Continue writing full diagnostics to both existing run records.
- Ensure the client record status is `error` only for this hard initial-creation case (confirm the existing lifecycle behavior and keep it consistent).
- `completeRun`, `requeueRun`, and any successful re-provision path must clear/resolve the incident atomically with their current `errorState: null` behavior. Prefer clearing the gate at requeue, since the user should then see the running terminal; optionally retain a resolved audit record in a new admin-only `dashboard_failure_incidents` collection if needed.
- Do not overwrite a newer incident when an older worker finishes late. Use current run ID/status checks or a Firestore transaction/conditional update.

### 2. Send Bryan an automatic, idempotent alert

Files: new `api/_lib/dashboard-failure-notification.cjs` (recommended), `api/_lib/run-lifecycle.cjs`, tests. Reuse `api/_lib/resend-transport.cjs` rather than adding a mail provider.

- Send on the server after the failure is persisted, with an idempotency key such as `dashboard-failure:${runId}`.
- Recipient should be a dedicated env var `DASHBOARD_FAILURE_ALERT_EMAIL`, falling back to the existing `DIGEST_EMAIL` only if that is an accepted project convention. Never hard-code Bryan’s personal address.
- Email subject: `Dashboard creation failed — <client/company> — <publicCode>`.
- Include client name/email, submitted URL, client ID, run ID, public category, failure time, sanitized internal error/stage, and an admin dashboard deep link. Do not include secrets or raw external response bodies.
- Store notification outcome under the incident. Treat alert delivery as best-effort: it must never change the pipeline result into a second failure. If it cannot send, modal copy must say “Your report has been recorded for Bryan,” not “sent to Bryan.”
- Add an observable structured log event for failure and notification outcome. The existing Ops dashboard can then surface the incident by reading its current status or a dedicated collection in a follow-up.

### 3. Return the gate in bootstrap and protect it from caching

Files: `api/_lib/client-provisioning.cjs`, `app/api/dashboard/bootstrap/route.js`, `lib/dashboard/bootstrap-session.js` tests.

- Include a compact `dashboardFailure` / `creationFailure` object in bootstrap, derived only from an open `dashboardState.errorState` for the user’s own client.
- Do not show the gate for an admin impersonating another client unless the admin explicitly needs client-preview behavior. Recommended v1: admins see their normal admin tooling; client gating applies only to `ownClientId` / non-impersonated sessions.
- Keep `Cache-Control: no-store` and make sure cached bootstrap fallback cannot suppress a newer open incident. If a cached dashboard is used after an error, it must not be treated as proof the incident is resolved; prefer refetching the live bootstrap before rendering a protected dashboard.

### 4. Build the resolution modal and replace the terminal on hard failure

Files: new `components/dashboard/DashboardCreationFailedModal.jsx`, `DashboardPage.jsx`, `styles/dashboard/` (use the established modal stylesheet/location), optional small report formatter at `lib/dashboard/`.

- Match the visual grammar of `components/payments/SubscribeModal.jsx`: branded header, centered card, clear hierarchy, primary outlined/filled CTA treatment, responsive/mobile-safe layout. Do not import Stripe/payment logic.
- Render this modal when `bootstrap.creationFailure.status === 'open'` and it is a non-impersonated client session. Its z-index must exceed the terminal overlay and every dashboard detail modal.
- On detection, close/suppress the Intake Terminal (`showIntakeModal` must be false for this case) and clear any terminal-dismissal/ack keys for migration safety. Delete the old `intake-failed-acked` behavior for hard initial-creation failures; it may remain only for non-gating module-run UX if still desired.
- The modal copy should be calm and specific:
  - Eyebrow: `Dashboard setup needs help`
  - Heading: `WE COULDN’T FINISH YOUR DASHBOARD`
  - Body: “We couldn’t complete setup for <domain>. Bryan has been notified and can take a closer look.” Use conditional wording if the notification status is not `sent`.
  - Reference: `Support reference: HIT-ABC123`
- Include a collapsed “Technical details” section containing only the safe client report, plus a **Copy report** button. After copy, provide an `aria-live` confirmation (`Copied`). The report should contain: reference code, approximate UTC/local failure time, submitted website domain/URL, safe category/message, and run ID. It must not contain raw error text.
- Primary CTA: `Schedule with Bryan` → `https://calendly.com/bballi/30min`, new tab, `rel="noopener noreferrer"`. Track the click.
- Secondary CTA: `Delete my account` opens the existing confirmation modal; use `onRequestDeleteAccount` from the parent rather than duplicating deletion logic. The delete confirmation itself must be above the blocking modal. After deletion, existing `signOutUser()` flow returns the client to signup.
- There is intentionally no “close”, “continue”, or “view dashboard” button. Trap focus in the modal, label it correctly with `role="dialog" aria-modal="true"`, disable Escape/backdrop dismissal, and make the copy action keyboard accessible.

### 5. Remove the current loopholes and prevent dashboard flash

Files: `DashboardPage.jsx` and tests.

- Update `showIntakeModal`, `dismissIntakeModal`, `reopenIntakeModal`, and the body-scroll/modal coordination effect. The hard gate supersedes them; a client cannot acknowledge it away.
- Do not render the dashboard grid/entrance animation for an unresolved creation failure. Avoid a one-frame dashboard flash by treating bootstrap as unresolved until the failure check is available.
- Preserve normal behavior for: active builds, success/reveal countdown, provision pending, later module failures, soft onboarding-chain failures, bootstrap network errors, admin impersonation, and account deletion.
- If bootstrap itself cannot load, show its existing load-error UX; do not manufacture a dashboard-creation incident client-side.

### 6. Add an admin resolution path

Files: existing admin run/ops surface (likely `app/api/admin/brief-runs/route.js` and `OpsOverviewPage.jsx`) plus an authenticated admin route if none exists.

- Show `open` incidents with public code, client, domain, timestamp, run ID, safe stage, full admin diagnostic, notification delivery state, and actions.
- Actions: **Requeue / retry** (uses existing `requeueRun`) and **Resolve without retry**. Both must clear the client gate; resolving records `resolvedAt`, admin email, and optional note in an admin-only incident/audit record. Requeue should switch the client into the existing terminal-running experience.
- Ensure only verified admins can resolve/requeue and only the affected client can read their compact public incident via bootstrap.

## Analytics

Add events in `lib/analytics.js` (no URL query strings or raw errors):

- `dashboard_creation_failed_modal_shown` — `{ public_code, public_stage }`
- `dashboard_creation_failed_report_copied` — `{ public_code }`
- `dashboard_creation_failed_calendly_clicked` — `{ public_code }`
- `dashboard_creation_failed_delete_started` — `{ public_code }`
- `dashboard_creation_failure_resolved` — admin-side `{ public_code, resolution: 'requeued' | 'manual' }`

## Test and acceptance checklist

1. Unit-test failure classification and ensure only primary intake failures create `status: 'open'` incidents.
2. Unit-test notification idempotency and unavailable-email behavior; verify no duplicate notification after retrying `failRun` or refreshing bootstrap.
3. Unit-test bootstrap serialization: client sees safe fields only; no stack trace/raw error; admin gets required diagnostic via admin route.
4. Component-test keyboard/focus behavior, copy success/failure feedback, no Escape/backdrop dismissal, Calendly attributes, and delete handoff.
5. End-to-end: create a test signup whose website fetch deterministically fails. Confirm terminal closes/replaces with modal, dashboard never renders, refresh/sign-out/sign-in reopens it, and the support alert is created exactly once.
6. E2E: an admin requeues the run. Confirm the modal clears, terminal shows the re-run, then dashboard opens on success.
7. E2E: a later module run fails for a healthy client. Confirm only the existing non-blocking module error UX appears.
8. E2E: delete account from the failure modal. Confirm Auth, Firestore client state, dashboard state, artifacts, and failure incident handling follow the existing account deletion contract, then the user can sign up again.
9. Manually inspect desktop and mobile against the subscription modal’s design language and run the project’s lint/test/build commands.

## Rollout notes

- The existing `rositas.com` client needs a one-time data repair: identify its failed primary run, populate/normalize the open error state (or requeue it), then verify the modal using an impersonated client-preview test.
- Ship the server data contract and admin resolver before turning on the hard client gate, so no user can become trapped without a support resolution route.
- Add the new environment variable in `.env.example` and deployment configuration before enabling email confirmation wording.

## Live verification log — 2026-08-26

Method: a throwaway auth user + client (`ztest-failgate-001`) was seeded directly
in Firestore and the **real `failRun()`** was invoked against it (`RESEND_API_KEY`
stripped from the seeding process, so `notifyDashboardFailure` returned
`not_configured` and no alert email was ever sent). Exercised in Chrome against
`next dev` on `:3000`, signed in as that client. All seeded data — client,
dashboard_state, brief_runs (both copies), users doc, auth user, and the
`dashboard_failure_incidents` audit doc — was deleted afterwards.

Verified working:

- **Phase 1** — `failRun` on a `free-tier-intake` + `trigger:'signup'` run wrote
  `errorState.kind='dashboard_creation_failed'`, `status:'open'`,
  `publicCode='HIT-5AUD7B'`, `publicStage='website_access'`, and downgraded
  `clients/{id}.status` to `error`.
- **Phase 2** — notification resolved to `not_configured` with no send, and the
  status was persisted onto the incident without clobbering the rest of the map.
- **Phase 3** — bootstrap projected only the allow-listed fields; the raw
  `getaddrinfo ENOTFOUND …` never reached the client payload or DOM.
- **Phase 4** — modal renders with `role="dialog"`/`aria-modal`, initial focus on
  the dialog, Tab cycles inside it, `<details>` collapsed by default, and
  **Copy report** wrote exactly the six safe lines to the clipboard (verified by
  intercepting `navigator.clipboard.writeText`). Calendly CTA is
  `https://calendly.com/bballi/30min` + `target="_blank"`. **Delete my account**
  opens the existing type-DELETE confirmation above the gate; cancelling returns
  to the gate rather than the dashboard.
- **Notification wording** — `notification.status: 'not_configured'` renders
  "Your report has been recorded for Bryan to review."; flipping it to `'sent'`
  renders "Bryan has been notified…". Both confirmed in the browser.
- **Phase 5** — Escape, backdrop click, and full page reloads never dismiss the
  gate; `body` stays `overflow:hidden`; the intake terminal/modal and all
  dashboard tiles are suppressed while the incident is open.
- **Phase 6** — `listOpenIncidents` returned the incident with admin-only
  `internalError`; `resolveIncident` cleared the gate, wrote the audit record,
  and correctly 404s on a second call; `requeueIncident` nulled `errorState`,
  reset the run to `queued`/`attempts: 0`, restored `clients/{id}.status` to
  `provisioning`, and wrote a `requeued` audit record. Both paths cleared the
  client gate on the next load.

Open findings (NOT fixed in this pass):

1. **Raw error still reaches the client after the gate clears.** `failRun`'s
   `appendRunEvent` writes `Pipeline failed: ${error.message}` for *hard*
   failures (`api/_lib/run-lifecycle.cjs`, the `soft ? … : …` progressLabel),
   and run events are client-readable. While the incident is open the terminal
   is suppressed, so it is invisible — but after an admin **manual resolve**
   (and after a requeue, until the re-run overwrites the log) the client's
   intake terminal renders `✗ Pipeline failed: getaddrinfo ENOTFOUND
   broken-site-for-test.invalid` verbatim. Observed in the browser. Suggested
   fix: write the classified `publicMessage` (+ `publicCode`) on the hard path
   too, keeping the raw text in `brief_runs` only.
2. **Manual resolve leaves `clients/{id}.status = 'error'`.** Only `requeue`
   un-errors the client record. Nothing gates dashboard access on that field
   today, so it is cosmetic/admin-facing, but the two resolution paths end in
   different client states.
3. **The incident audit doc is last-write-wins.** `writeAuditRecord` uses
   `.doc(incidentId).set(...)`, so a requeue after a manual resolve overwrites
   the earlier record instead of appending a second one. Fine for "who cleared
   this", lossy as a history.

Not verified live (needs an admin browser session): the
`components/AdminDashboardFailuresView.jsx` UI and the auth wrapper on
`app/api/admin/dashboard-failures/route.js`. The module those call
(`api/_lib/dashboard-failure-incidents.cjs`) was exercised directly against
live Firestore, as described above.

Test state at time of writing: `npm test` → **2941 passed, 0 failed** (58 suites).
