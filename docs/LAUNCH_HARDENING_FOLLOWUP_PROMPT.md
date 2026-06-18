# Launch Hardening Follow-Up Prompt

Act as a senior launch-readiness reviewer for this exact repository and review the latest `codex/launch-hardening` state after the second hardening pass.

Focus on confirming these fixes are complete and do not regress signup, payment, or dashboard behavior:

1. Tenant isolation
- Verify `firestore.rules` no longer lets users change server-owned fields on `users/{uid}`, especially `clientId`, `role`, admin flags, membership fields, or subscription fields.
- Confirm client signup/login still works with the safe profile fields written by `AuthContext.jsx`.
- Confirm API tenant resolution through `getEffectiveClientContext()` can no longer be steered by a malicious client-side write.
- If practical, add or run Firestore emulator tests proving user A cannot read or mutate user B's `clients`, `client_configs`, `dashboard_state`, leadgen synthetic docs, or run events.

2. SSRF and response-size protection
- Verify `features/knowledge-base/url.js`, `features/scout-intake/site-fetcher.js`, and `features/scout-intake/agent-ready/_fetch.js` route all external URL reads through `safeFetch`.
- Confirm redirects are manually validated before each hop.
- Confirm body reads are capped even when the origin omits `content-length`.
- Add tests for public-to-private redirects, discovered internal links, oversized chunked responses, invalid schemes, localhost, metadata IPs, and private IPv4/IPv6.

3. Stripe webhook idempotency
- Verify `app/api/payments/webhook/route.js` does not mark an event `processed` until side effects succeed.
- Confirm failed events are retryable and duplicate processed events are skipped.
- Add a unit or integration test where the first handler attempt fails and a Stripe retry later succeeds.

4. Rate limits and abuse controls
- Confirm paid or expensive anonymous endpoints fail closed when the Firestore-backed limiter fails.
- Confirm `x-vercel-forwarded-for` is preferred for IP keys in Vercel.
- Confirm analytics or other non-critical routes have intentional fail-open/fail-closed behavior.

5. Verification
- Run `npm test`.
- Run `npm audit --audit-level=high`.
- Run `npm run build`.
- Do not deploy or call paid providers unless explicitly asked.

Output findings first, ordered by severity. Include file paths, what can still go wrong, exact recommended fixes, and whether you would launch after this pass. Also include manual smoke checks for payment duplicate prevention, public brief publish/unpublish behavior, admin leadgen access, signup provisioning, knowledge-base URL ingest, agent-ready scan, and cron auth.
