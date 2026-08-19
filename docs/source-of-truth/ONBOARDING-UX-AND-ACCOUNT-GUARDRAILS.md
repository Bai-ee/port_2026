# Onboarding UX + Account Guardrails — SSOT

As-built 2026-07-18 (commits `e84491ad`, `4d7062f1`, `47e92324`, `1a2d3501`), updated 2026-08-19
to allow deleted users to sign up again. Launch-hardening for the new-signup experience:
error-surface routing during the build terminal, deleted-account audit history, and the mobile brief-viewer fixes. For the Creative Brief content system and
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

## 2. Deleted-account audit history

Any account deletion records the email for operational history, but **never bars that email from
signing up again**. The expected UX is delete → sign up again → new workspace provisioning.

- **Module:** `api/_lib/deleted-accounts.cjs` — collection `deleted_account_emails/{emailLower}`,
  `recordDeletedAccount` writes history and `isEmailBlocked` is a compatibility shim that returns
  `false`.
- **Write:** `app/api/account/delete/route.js` step 0b calls `recordDeletedAccount` before
  storage/Firestore/auth teardown; errors collect, don't short-circuit.
- **Provisioning authority:** `app/api/clients/provision/route.js` does not check deleted-account
  history. Normal auth, rate limits, and `provisionClientForUser` determine whether signup can
  proceed.
- **Compatibility endpoint:** `app/api/public/deleted-account-check?email=` remains IP rate-limited
  but always returns `{ blocked:false }` for stale clients.
- **Client UX:** `AuthContext.signUp` and the Google create path no longer run a deleted-account
  pre-check. `AuthPage` no longer renders `#deleted-account-toast`.

### 2b. Re-signup after an ADMIN "Delete Client"

`app/api/admin/delete-client/route.js` deletes Firestore data only — the Firebase Auth identity
survives on purpose (self-serve `account/delete` is the path that removes the identity). Two
guardrails keep that survivor from walling the user out of a fresh signup:

- **`AuthContext.signUp`** treats `auth/email-already-in-use` as "returning user": it signs in with
  the submitted password and provisions a new workspace on the existing uid. A wrong password
  yields an actionable message ("sign in with your existing password, or reset it"), never the raw
  Firebase code.
- **`provisionClientForUser`** (`api/_lib/client-provisioning.cjs`) only honors a `users/{uid}`
  → `clientId` link when that client doc still exists. A stale link falls through to fresh
  provisioning instead of returning `alreadyProvisioned` with `client: null` (a dead dashboard).
- Not changed: the provision rate limits (8/h per IP, **3 per uid per 24h**). Repeated
  delete → re-signup cycles on one uid inside a day hit "Too many provisioning attempts".

## 3. Brief/asset viewer on mobile

`#brief-fullscreen-container`: `height: 90dvh` (vh fallback) + `max-height: 100%` — iOS Safari's
`vh` includes the collapsed browser chrome, which used to push the centered container off the top
and hide the Download/Share/✕ row. ≤480px it spans `calc(100vw - 16px)` × `calc(100dvh - 16px)`.
Brief HTML side gutters drop to `clamp(12px,4vw,24px)` at ≤640px (`brief-css.cjs`) so content fills
the modal; PDF/print padding unchanged. The popup renders `briefShellHtml` (CTA-stripped);
Share/standalone keeps the CTA. The card-footer **Details** button is active for non-admins on
unlocked cards that actually open for them (deliverable assets + brief views); everything else
keeps the lock so there is never an active-but-dead button.
