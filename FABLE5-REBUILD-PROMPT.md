# FABLE 5 — CLEAN-ROOM REBUILD CHALLENGE

> Feed alongside `FABLE5-REPO-MANIFEST.md`. The manifest is what stops invented
> integrations — without it, UNKNOWNS.md balloons and the build mostly guesses.

## OBJECTIVE
Reimagine and rebuild this codebase from scratch on a SEPARATE branch. Same
technology stack, same working features, but optimized: minimal AI slop, maximum
clarity, junior-developer readable. This is a benchmark — the original keeps
running untouched; your output is a candidate reference build, not a hot-swap.

You are graded on: correctness against the documented contracts, code clarity,
how little "AI slop" you produce, build speed, and token/$ cost. Honesty beats
volume — a smaller correct build scores higher than a large hallucinated one.

## STACK (match exactly — do not substitute)
Next.js 16 (app router), React 19, Firebase (client SDK + firebase-admin),
Anthropic SDK, googleapis, twitter-api-v2, Three.js 0.165 + @react-three/fiber +
drei + three-stdlib, GSAP, motion. Node built-in test runner. Vercel deploy.
Do NOT introduce new frameworks, state libs, ORMs, or UI kits.

## FEATURE PARITY TARGET (must exist and work)
- Marketing site: Home, About, Work, Services (5), Case Studies, Process, FAQ,
  Gallery, Contact. WebGL particle "swarm" backgrounds.
- Auth (Firebase) + multi-tenant client dashboard.
- API surface (app/api/*): account, admin, analytics, brand-system, clients,
  dashboard, intelligence, leadgen, ops, social-posting, worker.
- Feature pipelines: intelligence/digest, knowledge-base (RAG), leadgen,
  newsletter, brief generation, scout-intake, social-posting, strategy-builder.
- Per-tenant data in BOTH Firestore and on-disk clients/<tenant>/.

## HARD RULES — NO AI SLOP
1. NO invented integrations. If an external contract (Firestore schema, env var,
   API response shape, on-disk client layout, cron secret) is not given to you,
   STUB it behind a clearly named interface and list it in UNKNOWNS — do not
   guess and present a guess as working.
2. NO dead code, no speculative abstractions, no "future-proofing," no config you
   don't use, no commented-out blocks, no emoji, no decorative comments.
3. Comments explain WHY only where non-obvious. Code names explain WHAT.
4. One responsibility per file/function. A junior dev must follow any file
   top-to-bottom without prior context.
5. SECURITY IS NON-NEGOTIABLE and is the main thing the original got wrong:
   - Every API route verifies the Firebase ID token server-side.
   - Every tenant-scoped route verifies the caller OWNS the clientId it acts on
     (no trusting client-supplied tenant ids — prevent IDOR / cross-tenant reads).
   - Admin routes enforce an admin claim, not just presence of a token.
   - worker/* and social-posting/process-due require a cron/shared secret.
   - No secrets in the client bundle. No admin creds in firebase.js. Validate and
     sanitize all request bodies. Guard outbound fetch (scrapers, fetch-references)
     against SSRF. Treat LLM inputs as untrusted (prompt injection).
   - Centralize auth + tenant-ownership in ONE reusable helper; every route uses
     it. (The original scattered firebase-admin per-route and missed checks.)
6. PERFORMANCE: code-split the Three.js/WebGL bundle (dynamic import, route-level),
   clean up RAF/listeners/WebGL contexts on unmount, paginate Firestore reads, no
   N+1, pick RSC vs client correctly per route.
7. Match existing public behavior/URLs unless a change is required for security;
   when you change behavior, flag it explicitly.

## ARCHITECTURE YOU MUST PRODUCE
- A shared auth/tenant-access layer used by every route (see rule 5).
- A data-access layer wrapping Firestore + the on-disk client store behind named
  functions — routes never touch the DB directly.
- Clear separation: marketing (mostly RSC/static) vs dashboard (authed client) vs
  API vs feature pipelines.

## DELIVERABLES (in this order)
1. ARCHITECTURE.md — folder tree, trust boundaries, data flow, the auth/data-access
   layer design. (Write this FIRST, before code.)
2. The codebase itself, complete files, no placeholders or "// ... rest here".
3. UNKNOWNS.md — every contract you had to stub/assume, what you assumed, and what
   real value the human must supply to make it production-ready.
4. CHANGES.md — where your build intentionally differs from the original's behavior
   and why (security fixes, removed slop, perf changes).
5. SELF-SCORE.md — your own honest rubric: % of features you believe truly work vs
   stubbed, biggest risks, what you'd verify first, and an estimate of how this
   compares to a hand-built version.

## CONSTRAINTS
- Output must run on the named stack with `npm install && npm run build`.
- If you cannot complete everything within budget, build a CORRECT subset and say
  so in SELF-SCORE.md — do NOT pad with non-working scaffolding to look complete.
- Do not touch or reference the original branch; this is clean-room.
