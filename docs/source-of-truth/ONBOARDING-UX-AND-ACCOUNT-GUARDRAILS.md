# Onboarding UX + Account Guardrails — SSOT

As-built 2026-07-18 (commits `e84491ad`, `4d7062f1`, `47e92324`, `1a2d3501`). Launch-hardening for
the new-signup experience: error-surface routing during the build terminal, the deleted-account
re-signup blocklist, and the mobile brief-viewer fixes. For the Creative Brief content system and
the post-signup auto-open, see [`CREATIVE-BRIEF-COMPOSER.md`](CREATIVE-BRIEF-COMPOSER.md).

## 1. Toast routing during onboarding (DashboardPage.jsx)

Rule: while the build terminal (`showIntakeModal`) is open, errors surface **inside the terminal**;
toasts only after it closes.

- `#db-alert-toast` (bootstrap errors) renders only when `!showIntakeModal`. Transient
  "last loaded state" warnings auto-dismiss unseen (7s); hard failures stay in state and toast once
  the terminal closes.
- **Weak-connection toast** `#connection-weak-toast`: a bootstrap poll that times out
  (20s, `DASHBOARD_BOOTSTRAP_TIMEOUT_MS`) while cached state keeps the dashboard usable shows a
  neutral amber top-center toast — exact copy "Internet connection is not strong." — instead of the
  red timed-out error. Shown even during the terminal (it's a connection notice, not a failure);
  auto-dismisses in 6s; routed in `applyBootstrapResponse` via `/timed out/i` on
  `_bootstrapWarning`. Own keyframes preserve the `translateX(-50%)` centering.
- `runErrorToast` fires only for `pipelineType === 'module-run'` — intake/onboarding-chain failures
  render in the terminal (`Error` status + `errorState.message` line), never as a toast.
- CSS lives in the `dashboardCss` const (mirror `dashboard.css` synced for the toast block).

## 2. Deleted-account re-signup blocklist

Any account deletion bars that email from signing up again — **sole exception
`sangamondivide@gmail.com`** (the test account), which is fully cleansed so it can cycle
signup → delete → signup.

- **Module:** `api/_lib/deleted-accounts.cjs` — collection `deleted_account_emails/{emailLower}`,
  `isEmailBlocked`, `recordDeletedAccount` (records, or deletes the entry for the exception),
  `DELETED_ACCOUNT_MESSAGE` = exact copy "Deleted Account, Contact Bryan.".
- **Write:** `app/api/account/delete/route.js` step 0b calls `recordDeletedAccount` (before
  storage/Firestore/auth teardown; errors collect, don't short-circuit).
- **Enforce (authority):** `app/api/clients/provision/route.js` → 403 + `code: 'DELETED_ACCOUNT'`
  for blocked emails, before rate limiting. Fail-open on blocklist read errors so an outage never
  blocks normal signups.
- **Instant UX:** public pre-check `app/api/public/deleted-account-check?email=` (IP rate-limited
  30/h) → `AuthContext.signUp` checks BEFORE `createUserWithEmailAndPassword` (no orphan identity);
  the Google path checks after the popup, signs back out, throws. `AuthPage` catches the typed
  `DELETED_ACCOUNT` error → top-center red toast (`#deleted-account-toast`, 8s), no inline dupe.
- Known edge: if the pre-check fetch fails, email/password signup creates the auth user, provision
  then 403s and signs them out — a workspaceless orphan auth identity remains (harmless).
- Emails deleted BEFORE this shipped are not in the blocklist (populates on delete going forward);
  backfill from `account_deletions` audit collection is possible if ever wanted.

## 3. Brief/asset viewer on mobile

`#brief-fullscreen-container`: `height: 90dvh` (vh fallback) + `max-height: 100%` — iOS Safari's
`vh` includes the collapsed browser chrome, which used to push the centered container off the top
and hide the Download/Share/✕ row. ≤480px it spans `calc(100vw - 16px)` × `calc(100dvh - 16px)`.
Brief HTML side gutters drop to `clamp(12px,4vw,24px)` at ≤640px (`brief-css.cjs`) so content fills
the modal; PDF/print padding unchanged. The popup renders `briefShellHtml` (CTA-stripped);
Share/standalone keeps the CTA. The card-footer **Details** button is active for non-admins on
unlocked cards that actually open for them (deliverable assets + brief views); everything else
keeps the lock so there is never an active-but-dead button.
