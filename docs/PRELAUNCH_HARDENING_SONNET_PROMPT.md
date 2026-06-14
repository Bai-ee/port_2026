# Sonnet Handoff Prompt: Prelaunch Hardening

Use this prompt with a Sonnet coding model after the current local state has been committed to a snapshot branch and a hardening branch has been created.

```text
You are a senior security/reliability engineer working in this exact repository.

Goal:
Implement the prelaunch hardening plan in `docs/PRELAUNCH_HARDENING_HANDOFF.md`.

Context:
- This is a Next.js App Router app deployed on Vercel.
- It uses Firebase Auth, Firestore, Firebase Admin SDK, Firebase Storage, Stripe, Anthropic/Kimi, OpenAI, Browserless, PageSpeed, social APIs, leadgen workflows, worker/admin routes, dashboard routes, and public custom brief routes.
- Existing local changes are intentional and must not be reverted.
- Do not redesign the product. Make narrowly scoped launch-hardening changes.

Primary launch blockers:
1. Patch critical/high dependency vulnerabilities.
2. Lock down leadgen routes so normal signed-in users cannot operate on global configs or arbitrary `leadgen_prospects`.
3. Tighten Firestore rules for leadgen data.
4. Add rate limits and per-client/provider quotas for anonymous and paid-provider routes.
5. Add SSRF protection for user-supplied URL fetches.
6. Harden Stripe setup routes and webhook idempotency.
7. Make cron auth fail closed in production.
8. Make custom briefs private by default and require explicit publishing.

Work rules:
- Read `docs/PRELAUNCH_HARDENING_HANDOFF.md` first.
- Inspect current files before editing.
- Prefer existing local patterns in `api/_lib`, `app/api`, and `features`.
- Keep commits/changes grouped by risk area.
- Do not run destructive git commands.
- Do not touch `.env.local` or commit secrets.
- If a route is ambiguous, fail closed and document the decision.

Implementation sequence:

Phase 1 — Dependency and Verification Baseline
- Run `npm audit`.
- Apply safe dependency updates.
- Run `npm test` and `npm run build`.
- If a breaking update is required, make the smallest compatible code change and document it.

Phase 2 — Authorization Boundaries
- Make operator leadgen routes admin-only unless the route is explicitly client-owned.
- For client-owned leadgen routes, resolve `clientId` with `getEffectiveClientContext` and only operate on `leadgen_prospects/client:{clientId}`.
- Add reusable authorization helpers if useful.
- Add route-level tests or focused unit tests proving non-admin users are denied.

Phase 3 — Firestore Rules
- Restrict normal users from reading operator `leadgen_prospects` and `leadgen_configs`.
- Preserve same-client access for synthetic `client:{clientId}` documents where required.
- Add Firestore emulator tests if the repo already supports them; otherwise add a documented test harness or rule assertions.

Phase 4 — Rate Limits, Quotas, and Kill Switches
- Add a shared rate-limit helper backed by the best available production-safe store in this repo.
- Protect anonymous routes:
  - `/api/payments/create-payment-intent`
  - `/api/payments/create-subscription`
  - `/api/intelligence/agent-ready`
  - `/api/analytics/homepage`
- Protect signed-in expensive routes:
  - OpenAI image generation
  - OpenAI embeddings
  - Anthropic/Kimi generation
  - Browserless capture
  - PageSpeed runs
  - leadgen generation/deploy
  - dashboard module runs
- Add stable `429` responses.
- Add provider kill switches and clear user-facing failure messages.

Phase 5 — SSRF Protection
- Add a shared URL validation/fetch wrapper.
- Block localhost, private IP ranges, metadata IPs, link-local IPs, IPv6 private/loopback/link-local, and non-http(s) schemes.
- Re-check redirect targets.
- Enforce timeouts and max response bytes.
- Apply it to public scanner, knowledge-base URL ingest, leadgen/site fetchers, PageSpeed/site fetch paths, asset fetches, and PDF fallback fetches where applicable.

Phase 6 — Stripe
- Add rate limits and idempotency keys to payment setup routes.
- Prevent duplicate incomplete subscriptions/payment intents for same email/purpose.
- Add webhook event ID persistence and replay skip behavior.
- Preserve current client payment flow.

Phase 7 — Cron and Public Brief Privacy
- Make `app/api/admin/daily-digest/route.js` fail closed in production when `CRON_SECRET` is missing.
- Change custom brief creation default to private.
- Require explicit publishing for public HTML/PDF/OG routes.
- Verify unpublished briefs return `404`.

Phase 8 — Final Verification
- Run:
  - `npm test`
  - `npm run build`
  - `npm audit`
- Report any residual moderate/low audit findings with justification.
- Provide a concise final summary with:
  - files changed
  - security behavior changed
  - tests run
  - remaining launch risks

Acceptance criteria:
- No critical/high `npm audit` findings remain, or any unavoidable finding is documented with a concrete mitigation.
- Non-admin users cannot access leadgen operator data or actions.
- Firestore rules do not expose operator leadgen docs/configs to normal signed-in users.
- Public/anonymous endpoints are rate-limited.
- Paid-provider routes have quotas or kill switches.
- User-supplied URL fetches reject internal/private targets.
- Stripe setup is idempotent and webhook replay-safe.
- Cron routes fail closed in production.
- New custom briefs are private until explicitly published.
- `npm test` and `npm run build` pass.
```

