# Master handoff prompt — dashboard-creation failure UX

You are continuing implementation and verification of the HITLOOP dashboard-creation failure experience in `/Users/bballi/Documents/Repos/Bballi_Portfolio`.

## Objective

When a new client’s initial website/dashboard build fails, they must be hard-gated into a polished support modal instead of being dropped into a broken dashboard or a dismissible failed terminal. The modal must explain the problem safely, provide a copyable error report, confirm the correct notification state, offer a Calendly meeting with Bryan, and permit account deletion. It must appear on every client sign-in until an admin requeues or resolves the incident.

Do not deploy, push, commit, alter production configuration, or send real customer/Bryan email without explicit user authorization.

## Product decisions (not open for reinterpretation)

- This is a **hard gate** for a failed primary signup dashboard build—not a toast or a terminal state.
- The user cannot close it with Escape, a close button, or backdrop click, and cannot access the broken dashboard behind it.
- The only client actions are: copy the safe report, schedule with Bryan via Calendly, or open the existing account-deletion confirmation.
- It reappears every sign-in until resolved. Never use localStorage/sessionStorage acknowledgment to dismiss an unresolved incident.
- The modal must never expose raw errors, stack traces, provider responses, tokens, or secrets.
- Later module failures, soft onboarding-chain failures, and admin impersonation must **not** trigger this client hard gate.
- Bryan notification is automatic and best-effort. Say “Bryan has been notified” only if notification status is `sent`; otherwise say “Your report has been recorded.”
- Do not send a real alert for verification. Use direct Firestore seeding of a throwaway test client.

## Current implementation status

The implementation work is complete through all six planned phases; the primary remaining work is a live browser verification pass using a seeded test client, plus cleanup/documentation of the result.

### Phase 1: lifecycle incident creation — complete

`api/_lib/run-lifecycle.cjs`

- `failRun` reads the run record and identifies a true primary signup failure as `pipelineType === 'free-tier-intake' && trigger === 'signup'`.
- On the first such hard failure it writes an open, safe incident to `dashboard_state.errorState`:
  - `kind: 'dashboard_creation_failed'`
  - `status: 'open'`
  - `incidentId`, `runId`, `publicCode`, `publicStage`, `publicMessage`, and notification state
- It marks the client `status: 'error'`.
- Module/reseed failures no longer downgrade established clients or write this hard-gate error state.
- It has a stale-write guard so a no-longer-running run cannot overwrite newer state.

### Phase 2: automatic notification — complete

`api/_lib/dashboard-failure-notification.cjs`

- Uses existing `resend-transport.cjs` with `idempotencyKey: dashboard-failure:${runId}`.
- Recipient precedence: `DASHBOARD_FAILURE_ALERT_EMAIL`, then `DIGEST_EMAIL`, then existing Bryan fallback.
- It never throws into the pipeline; notification state is persisted as `sent`, `failed`, or `not_configured`.
- The notification code redacts token/key-shaped strings and sends only server/admin-safe diagnostic detail.

### Phase 3: safe bootstrap projection and cache behavior — complete

`api/_lib/client-provisioning.cjs`, `lib/dashboard/bootstrap-session.js`

- Bootstrap returns strict allow-listed `creationFailure`, containing only:
  `status`, `incidentId`, `runId`, `failedAt`, `publicCode`, `publicStage`, `publicMessage`, `notification.status`.
- It returns `null` for impersonation, so admin client previews are not blocked.
- Cache entries now have `cachedAtMs`; a cached healthy state is only usable for five minutes, while a cached open incident may always keep the client safely gated.
- Auth failures cannot resurrect stale cached sessions.

### Phase 4: modal UI — complete

`components/dashboard/DashboardCreationFailedModal.jsx`
`lib/dashboard/creation-failure-report.js`
`lib/analytics.js`
`DashboardPage.jsx`

- Modal uses the subscription modal’s visual language and self-guards unless `creationFailure.status === 'open'`.
- It displays safe copy, a collapsed technical details/report section, clipboard feedback, Calendly, account deletion handoff, a focus trap, `role="dialog"`, and `aria-modal="true"`.
- Its z-index is above terminal/tile overlays and below the existing delete-account overlay.
- Analytics events exist for shown, report copied, Calendly clicked, and deletion started.

### Phase 5: terminal/dashboard suppression — complete

`DashboardPage.jsx`

- `creationFailureOpen` is highest-priority: it suppresses the intake terminal, cleans old terminal acknowledgement keys, blocks writing a hard-failure ack, prevents dashboard entrance/reveal flash, and keeps body scroll locked.
- Existing normal states were deliberately preserved.

### Phase 6: admin resolution — complete

This includes an admin route/module and admin UI tab, with tests. Inspect the new files before making changes:

- `api/_lib/dashboard-failure-incidents.cjs`
- `app/api/admin/dashboard-failures/`
- `components/AdminDashboardFailuresView.jsx`
- `AdminPage.jsx`

The expected outcome is that an authenticated admin can see open incidents and safely requeue or manually resolve them, clearing the client gate durably with audit information.

## Verification history

- Builds have completed successfully during implementation.
- The suite was observed as fully passing once (`2919/2919`) and later had two known unrelated/transient failures (`2939/2941`). Re-run the relevant suites and report the exact current result; do not hide failures.
- There is no lint script configured.
- No live browser exercise of an open incident has yet been completed.

## Required next work: safe live browser verification

`.env.local` appears to point to a real Firebase project and has a Resend key. There is no emulator configuration. Therefore, **do not invoke the real signup pipeline**—it could send a genuine failure notification.

### Seed only a throwaway test client

Use the project’s Firebase Admin configuration to create a uniquely named, temporary test client and its own temporary Firebase Auth user. Do not modify an existing client, including Rosita’s.

Suggested values (add a unique timestamp/suffix):

```text
clientId: test-phase6-verify-<timestamp>
email: test-phase6-verify-<timestamp>@example.invalid
websiteUrl: https://example.invalid
```

Create the minimum required documents so that the test user owns the client and bootstrap returns an **open** `creationFailure`. Populate `clients/{clientId}` and `dashboard_state/{clientId}` with the project’s required ownership/status fields and a safe `errorState` matching the established shape. Do not call `failRun`, notification code, workers, or a signup route.

Because bootstrap intentionally suppresses `creationFailure` while impersonating, test by signing in as the temporary client’s own Auth user, not as an admin impersonating it.

### Browser test checklist

1. Start the local app using the project’s standard dev command and open `/dashboard`.
2. Sign in as the temporary test user.
3. Confirm the failed terminal does not appear and the dashboard grid/chrome does not flash behind the modal.
4. Confirm safe domain/message/reference are rendered; ensure no raw error or stack text is visible.
5. Expand Technical details and use Copy report. Confirm visible/audible `Copied` feedback and inspect clipboard only if the browser tool allows it.
6. Confirm Calendly opens in a new tab with `noopener noreferrer`.
7. Confirm Escape and backdrop click do not close the gate and focus cannot escape it.
8. Open Delete my account, verify its confirmation modal sits on top, then cancel it. Do **not** delete via the UI unless you have confirmed the cleanup path.
9. In an authenticated admin session, use the Phase 6 admin resolution/requeue action. Confirm the incident clears and the client is no longer hard-gated. If requeued, confirm the existing terminal/build state is the expected next UI.
10. Sign out/sign in once before resolution (modal should persist), and once after resolution (modal should stay gone).

### Cleanup (mandatory)

Delete precisely the temporary Auth user and all documents/subcollections/artifacts created for the unique test client. Check exact targets before deletion. Report what was deleted. Never use broad collection deletes, wildcards, or destructive commands against the project root/production data.

## Engineering constraints

- First inspect `git status`; the worktree contains unrelated user changes. Preserve them.
- Use `rg` for searching and `apply_patch` for any source changes.
- Keep tests focused and do not change unrelated code merely to make tests pass.
- If an actual bug is found during browser verification, fix only the minimal in-scope issue, add/adjust an appropriate test, rebuild, and rerun affected tests.
- If an action would send an email, trigger paid/external work, change a real customer, deploy, push, or commit, stop and ask for authorization.

## Final response requirements

Lead with the result. State:

- whether the browser pass succeeded;
- exact test/build results;
- whether any production-facing email/pipeline was triggered (expected: no);
- exact throwaway test data cleaned up;
- any remaining limitations or required user actions.

Do not claim deployment or production release. The changes are currently local/uncommitted unless the user explicitly asks otherwise.
