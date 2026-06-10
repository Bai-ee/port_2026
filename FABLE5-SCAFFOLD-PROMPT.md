# FABLE 5 — SCAFFOLD ONE-SHOT CHALLENGE

> Cheapest, cleanest single-shot benchmark. Tests architecture + structural taste
> + speed WITHOUT betting on hallucinated business logic or external integrations.
> Feed alongside `FABLE5-REPO-MANIFEST.md`.

## OBJECTIVE
In ONE pass, produce a complete, buildable SCAFFOLD of this codebase: the full
folder structure, every route, every feature module, and every UI page present —
but as typed, contract-defined STUBS, not deep implementations. The goal is to see
whether you can lay down a clean, correct, junior-readable skeleton fast and cheap.
Deep business logic is explicitly OUT OF SCOPE this round.

You are graded on: structural completeness (does every feature/route exist),
clarity of contracts, consistency, build success, and cost/speed. NOT on whether
pipelines actually run.

## STACK (match exactly)
Next.js 16 (app router), React 19, Firebase (client SDK + firebase-admin),
Anthropic SDK, googleapis, twitter-api-v2, Three.js 0.165 + @react-three/fiber +
drei + three-stdlib, GSAP, motion. Node test runner. Vercel deploy. No new libs.

## WHAT "SCAFFOLD" MEANS HERE
For EACH item in the manifest, produce a real file in the right place that:
- Defines its inputs/outputs as explicit types/JSDoc (request shape, response
  shape, params).
- Contains a clearly marked `// STUB:` body that returns a typed placeholder or
  throws `NotImplemented`.
- Wires auth/tenant guards as REAL code (not stubbed) — see Security below.
- Compiles and builds. `npm run build` must succeed.

Do NOT write the inside of LLM pipelines, scrapers, renderers, or WebGL particle
math. Leave those as documented stubs with the correct signature.

## STRUCTURE TO LAY DOWN (from the manifest)
- All marketing pages (Home, About, Work, 5 Services, Case Studies, Process, FAQ,
  Gallery, Contact) — as RSC page shells with a placeholder WebGL background slot.
- Auth (AuthContext, login) + dashboard + admin shells.
- Every `app/api/*` route group and route (account, admin, analytics, brand-system,
  clients, dashboard, intelligence, leadgen, ops, social-posting, worker) — each a
  real route handler with guards wired and a STUB body.
- Every `features/*` module (intelligence, knowledge-base, leadgen, newsletter,
  not-the-rug-brief, scout-intake, social-posting, strategy-builder) — exported
  functions with signatures + STUB bodies.
- The shared layers below.

## REAL CODE REQUIRED (not stubbed) — this is the part that proves taste
1. A SHARED AUTH/TENANT-ACCESS HELPER used by every route:
   - verifies Firebase ID token server-side,
   - resolves the caller's tenant,
   - asserts ownership of any clientId the route acts on (no trusting client input),
   - an admin-claim check variant for admin routes,
   - a cron/shared-secret check for worker/* and social-posting/process-due.
2. A DATA-ACCESS LAYER interface wrapping Firestore + the on-disk
   clients/<tenant>/ store behind named functions (bodies may be stubbed, but the
   interface and the path-safety/clientId-sanitization logic must be real).
3. Route → guard → data-access wiring must be real and consistent across ALL routes.

## NO-SLOP RULES
- No dead code, no speculative abstractions, no emoji, no decorative comments.
- Every stub is explicitly marked `// STUB:` so a human can grep all remaining work.
- Naming and structure consistent across every file — a junior dev should predict
  where any file lives.

## DELIVERABLES (in order)
1. ARCHITECTURE.md — folder tree + trust boundaries + the auth/data-access design.
2. The scaffold itself, all files, building.
3. STUBS.md — a checklist of every `// STUB:` grouped by feature, so the human sees
   exactly what's left to implement and in what order.
4. UNKNOWNS.md — contracts you could not infer from the manifest and had to assume.
5. SELF-SCORE.md — structural coverage %, what you're confident in, what you guessed,
   build result, and honest cost/speed notes.

## CONSTRAINTS
- `npm install && npm run build` MUST succeed. A non-building scaffold fails the run.
- Completeness of STRUCTURE beats depth. Do not implement deep logic this round.
- Clean-room: do not reference or touch the original branch.
```
