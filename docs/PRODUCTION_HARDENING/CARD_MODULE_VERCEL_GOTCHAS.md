# Card Module Vercel Gotchas

Reference for anyone adding a new card module (`features/scout-intake/modules/*`) that will execute inside the `/api/worker/run-brief` serverless function on Vercel. Each entry is a failure mode we hit in production and the pattern that fixed it.

---

## 1. `public/` is not in the lambda

**Symptom:** `sharp(TEMPLATE_PATH)` throws `Input file is missing: /ROOT/public/...` or `/ROOT/api/_lib/...`.

**Cause:** On Vercel, the `public/` folder is served by the static CDN; it is **not** copied into the serverless function bundle. `path.resolve(__dirname, '../..')` under Turbopack resolves to the build-time `/ROOT/` placeholder, which has no runtime filesystem mapping.

**Fix:** Fetch static assets from the public CDN at runtime and cache the buffer at module scope. See `api/_lib/device-mockup.cjs:loadTemplateBuffer` for the canonical pattern.

```js
const host =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL ||
  process.env.VERCEL_URL;
const res = await fetch(`https://${host}/img/your_asset.png`, { cache: 'no-store' });
const buffer = Buffer.from(await res.arrayBuffer());
```

**Do not** rely on:
- `path.join(__dirname, ...)` — Turbopack rewrites `__dirname` to `/ROOT`.
- `path.join(process.cwd(), ...)` — project root isn't bundled unless traced.
- `outputFileTracingIncludes` — inconsistent with Next 16 + Turbopack for non-JS assets.

---

## 2. `VERCEL_URL` is gated by deployment protection

**Symptom:** Lambda's `fetch(VERCEL_URL + '/...')` returns `401 Unauthorized`.

**Cause:** `VERCEL_URL` is the per-deployment preview hostname (e.g. `port-2026-5h3bye70u-...vercel.app`), which sits behind Vercel's deployment-protection auth gate — even for same-origin fetches from your own lambda.

**Fix:** Prefer these in order:
1. `NEXT_PUBLIC_SITE_URL` (if you have a custom domain)
2. `VERCEL_PROJECT_PRODUCTION_URL` (stable public production alias, unprotected)
3. `VERCEL_URL` (preview only, last resort)

---

## 3. Fire-and-forget `fetch()` dies after response flush

**Symptom:** Queued `brief_run` never leaves `queued` state; worker trigger silently drops.

**Cause:** Vercel freezes the function the moment `NextResponse.json()` returns. A bare `fetch(...)` kicked off without awaiting gets killed mid-flight.

**Fix:** Use `after()` from `next/server` to register post-response work. See commit `9e80389`. Pattern:

```js
import { after } from 'next/server';

export async function POST(req) {
  // ... enqueue work ...
  after(() => fetch(workerUrl, { method: 'POST' }));
  return NextResponse.json({ ok: true });
}
```

---

## 4. `fetch()` hangs on slow response bodies

**Symptom:** A module stalls indefinitely; no AbortError ever fires despite a configured timeout.

**Cause:** `AbortController` timer was cleared after `fetch()` resolved (headers received) but before `res.text() / res.arrayBuffer()` finished. A server that returns headers fast and stalls on the body bypasses the timeout entirely.

**Fix:** Keep the abort timer alive until **after** the body is fully read. Or use `AbortSignal.timeout(ms)` which covers the full request including body. See `features/scout-intake/modules/multi-device-view.js` and `api/_lib/site-fetcher` (commit `8ad17ee`).

---

## 5. Warnings must carry the full object through pipeline aggregation

**Symptom:** A module failure shows `code` only in `brief_runs.warnings[]` — no `message`, no `detail`, no stack.

**Cause:** Aggregation layers were rebuilding the warnings array from `warningCodes` alone, dropping `message`/`detail`/`stage`.

**Fix:** When a module returns warnings, always prefer `result.warnings` (the full array) over `result.warningCodes`. See commit `d97197f`. Every module should return warnings shaped as:

```js
{ type: 'warning', code: 'snake_case_reason', message, stage, detail }
```

where `detail` is `error.stack` (or structured context) for compose-type failures. This is what lets us actually debug from Firestore without needing to tail Vercel logs.

---

## 6. Asset paths for screenshot variants — key mismatch trap

**Symptom:** Mockup compose skipped with `mockup_source_missing`, or throws `Missing in-memory screenshot buffer for <device>`.

**Cause:** `SCREEN_BOXES` in `device-mockup.cjs` is keyed by device template slot names (`desktop/ipad/iphone`), while screenshot artifacts are keyed by `artifact.variant` (`desktop/tablet/mobile`). Iterating one set of keys and indexing into the other produces undefined buffers.

**Fix:** Use the `REQUIRED_VARIANTS` mapping to translate slot name → variant name when resolving buffers. See commit `d76a890`.

---

## 7. Browserless screenshot sequencing

- `includeFullPage: true` doubles the number of sequential Browserless calls (one viewport + one full-page per variant). Only opt in when the card actually renders full-page captures.
- Wrap each per-variant `captureScreenshotBuffer` call in its own `try/catch` so a single timed-out variant degrades gracefully instead of killing the whole module.
- Always pass `AbortSignal.timeout(...)` to the Browserless `fetch()` — their endpoint occasionally accepts a connection then never responds.

---

## Where to look when a new card fails on Vercel

1. **Firestore `brief_runs/{runId}.warnings[]`** — full error object with stack (thanks to #5). Look for `code: '<module>_*_failed'` and read `detail`.
2. **`dashboard_state.modules.<cardId>.warnings`** — same warnings, projected per module, for the retry UI.
3. **Vercel runtime logs** (`get_runtime_logs` MCP) — message column is truncated; use it to find the failing request time window, then jump to Firestore for the full stack.
4. **`dashboard_state.artifacts.<yourArtifactKey>.downloadUrl`** — if missing, `run-lifecycle.cjs` never saw the artifactRef, which means the module's `try` block threw before pushing.

---

## Checklist for new card modules

- [ ] Any static asset loaded via HTTP fetch with `VERCEL_PROJECT_PRODUCTION_URL`-first host resolution
- [ ] Every external `fetch` uses `AbortSignal.timeout(ms)` covering the full body read
- [ ] Module returns `{ ok, artifactRef?, warnings: [{ code, message, stage, detail }] }` on failure
- [ ] Post-response work (worker triggers, webhook fires) wrapped in `after()`
- [ ] Artifact type string matches what `run-lifecycle.cjs` looks for before projecting to `dashboard_state.artifacts.<key>`
- [ ] Dashboard fallback path (when artifact missing) is explicit — don't silently substitute a different asset type
