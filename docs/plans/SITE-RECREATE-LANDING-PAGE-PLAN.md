# Site Recreate — Standalone Landing Page Plan

Status: PLANNED — approved for implementation handoff. Implementer: execute phase by phase, stop for approval after each.
Owner surface: public sub-page (e.g. `hitloop.agency/recreate`) for the Site Recreate tool.
SSOT for the underlying feature: `docs/source-of-truth/SITE-RECREATE-CARD.md` (read § Admin gating + Phase 4/5f before touching the API).

## Objective

One full-screen page: same particle background as the site, frosted blur overlay on top, centered headline + short description + "enter your website" input + contact-human button. Submit → the established terminal UI runs the clone. Users can log in/out with the existing login flow but get NO dashboard access — logged-in users see a DOWNLOAD button + "Running" chip in the page nav and retrieve their zip that way. Super basic, launchable on its own.

## Recon facts (verified 2026-07-21 — do NOT re-derive)

### Background + overlay (reuse as-is)
- Particle canvas: `ox.jsx` — default export `App({ params, liveParamsRef, backgroundColor, onReady, snapRef, scatterRef })`, plain component, safe to mount per-route. Root is `position:fixed`, full-viewport, `zIndex:1`, `pointerEvents:none`.
- The reusable frosted "mute" wash: `InternalPageBackground.jsx` — mounts `ox.jsx` (aliased `BackgroundScene`, line 5) + sibling wash div (`washStyle`, lines 51–58: `rgba(245,241,223,0.08)` + `backdropFilter:'blur(18px)'`). This IS the "muted blurred shape" look requested. Mount `<InternalPageBackground />` and you're done.
- Canonical smallest page template to copy structure from: `app/about/page.jsx` → `AboutPage.jsx` → `InnerPageShell.jsx`. BUT do not use `InnerPageShell` here — it brings shared `Header` + footer; this page needs its own slim nav (below). Compose `InternalPageBackground` directly.

### Auth (reuse, one small edit)
- `AuthProvider` is global (`app/layout.jsx` lines 123–126) → `useAuth()` works on any route. Exposes `user, isAdmin, loading, signIn, signUp, signInWithGoogle, signOutUser` (`AuthContext.jsx`, hook at line 350, `onAuthStateChanged` at 134).
- Standalone login page already exists: `AuthPage.jsx` at route `/login` (`app/login/page.jsx`). Self-contained, renders its own `InternalPageBackground`.
- Needed edit: `/login` must support a `?next=/recreate` return param (currently redirects to dashboard flow). Keep the edit minimal — read `next` from searchParams, `window.location.href = next` after successful auth, only for same-origin paths.

### Terminal UI (light standalone copy — NOT extractable)
- The established terminal lives INLINE in `DashboardPage.jsx`: state `adhocTerminal` (:479), orchestrator `runWithTerminal` (:566–629), modal JSX gated at :12024 (shares `#intake-modal-overlay` / `#intake-modal-card`), minimized chip `#run-active-indicator-chip` (:10371–10392). All entangled with page-local state. Do NOT refactor DashboardPage.
- Correct move: a light standalone copy in the new page's component tree that honors the same contract:
  - `runWithTerminal({ title, brand, host, stages, task })` — opens modal, cosmetic 3.5s stage ticker, calls `task({ advance, note })`; `advance(pfx, text)` freezes ticker + streams real progress; `note(text)` appends dim line; task resolves `{ doneText }`; auto-settles done/error.
  - Copy the visual language from the dashboard terminal (dark panel, mono lines, brand row, close/minimize button) using kit classes — a trimmed reimplementation without intake-survey branches.
- Closable mid-run: the clone job continues server-side. On close → nav shows local "Running" chip; chip click reopens terminal; polling continues in page state.

### Site-clone API (`app/api/dashboard/site-clone/route.js`)
- Auth base: `resolveContext` (:34) = `verifyRequestUser` + `getEffectiveClientContext` (signed-in user with a clientId). Admin gate `requireAdmin` (:45–48).
- POST `create` (:104) — **ADMIN-ONLY today**. Requires `{ targetUrl, ownershipAttested: true }`, SSRF-validates URL, cap `MAX_JOBS_PER_CLIENT=200`, creates `clone_jobs` doc under `context.clientId`, then best-effort `triggerWorker` → Cloud Run worker is LIVE (`SITE_CLONE_WORKER_URL` set) so submits auto-run.
- GET `status` (:247) + `list` (:261) — any signed-in user, clientId-scoped (NOT admin-gated). `getCloneJob(jobId, clientId)` null-checks ownership.
- Job statuses: `queued → processing → verifying → done | failed`. Download = `job.zip.downloadUrl`; live preview = `job.preview.vercelUrl`; log stream = `job.log[]` (capped 200 lines).
- Reference client call sequence (copy this): `components/dashboard/SiteRecreateCard.jsx` — `authFetch` w/ Firebase idToken (:17); `recreate()` (:77–161): POST create → poll `status` every 3000ms up to 300 attempts, `advance()` on status change, `note()` on `job.log[]` deltas, keep-alive notes on quiet, break on `done`, throw on `failed`.

### UI kit
- "The ui kit html file" = `public/docs/dashboard-modal-component-style-guide.html` (self-contained reference; open it to match visuals).
- Production classes: `colors.css` is already global (has `.cta-pill-btn` primary CTA + tokens, lines 12–78). Full kit surface: `import '../../styles/dashboard/index.css'` in a `'use client'` component (precedent: `app/preview/mobile-audit/page.jsx:10`). ⚠️ `index.css` @import order is load-bearing — import the bundle, never individual files.
- ⚠️ Some survey classes (`.metric-card`, `.data-table`, `.gradient-pill`, `.status-badge`, `.empty-state`) exist ONLY in the style-guide HTML, not in `styles/dashboard/*.css`. If needed, port the specific rules into the page's own scoped CSS — do NOT add them to the shared dashboard bundle.
- Fonts (Doto / Space Grotesk / Space Mono) already loaded via `next/font/google` in `app/layout.jsx:2`.

## Design constraints (redesign-skill pass, applied up front)

- One accent, desaturated; no purple/blue AI-gradient look — stay inside `colors.css` tokens.
- `min-height: 100dvh` (not 100vh) for the full-screen shell.
- Headline: large, tight tracking, `text-wrap: balance`; description ≤ 65ch, 2 lines max, sentence case.
- Real copy, no clichés ("Elevate/Seamless/Unleash" banned). Draft (editable):
  - H1: `Your website, recreated.`
  - Sub: `Drop in a URL. We mirror the whole site — pages, images, copy — into a clean static build you can preview live and download as a zip.`
  - Primary CTA: `RECREATE MY SITE` (`.cta-pill-btn`). Secondary: `CONTACT BRYAN` (text-style link/button → `mailto:` or `/contact`).
- Input: kit-styled URL field + ownership attestation checkbox (required by API — keep it, one line: "I own this site or have permission to copy it").
- States required: idle, invalid-URL inline error, needs-login, running (terminal + chip), done (download + preview link), failed (plain error, no "Oops!"). Visible focus rings; hover/active on both buttons; 200–300ms transitions.
- Mobile: ≤480px must follow the MOBILE WIDTH STANDARD (single 8px gutter; see `docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md`).
- DOM naming rule (repo standard): every meaningful container gets a stable kebab-case id. Use at minimum:
  - `#recreate-landing-shell`, `#recreate-nav-row`, `#recreate-hero-stack`, `#recreate-url-input-row`, `#recreate-attest-row`, `#recreate-cta-row`, `#recreate-terminal-overlay`, `#recreate-running-chip`, `#recreate-download-row`.

## Files

| File | Action |
|---|---|
| `app/recreate/page.jsx` | NEW — 4-line route wrapper (copy `app/about/page.jsx` shape) |
| `components/recreate/RecreateLandingPage.jsx` | NEW — the whole page: bg, slim nav, hero, form, polling state |
| `components/recreate/RecreateTerminal.jsx` | NEW — standalone terminal (runWithTerminal contract copy) |
| `styles/recreate.css` (or inline styles per repo idiom) | NEW — page-scoped rules only; inline `style` props are the repo's primary idiom, prefer them |
| `AuthPage.jsx` | EDIT — honor `?next=` return path (minimal) |
| `app/api/dashboard/site-clone/route.js` | Phase 2 ONLY, decision-gated (see below) |

## DO NOT TOUCH
`Header.jsx` (shared site-wide; its only CTA hard-links `/dashboard` — this page builds its own slim nav instead), `DashboardPage.jsx`, `components/dashboard/SiteRecreateCard.jsx`, `InnerPageShell.jsx`, `api/_lib/clone-jobs.cjs`, `services/site-clone/*`, `styles/dashboard/*` (import only).

## Phases

### Phase 1 — page + terminal + polling (no API changes)
1. Route + `RecreateLandingPage`: `InternalPageBackground` full-screen, slim page-local nav (wordmark left; right side: logged-out → `LOG IN` link to `/login?next=/recreate`; logged-in → email/short label + `LOG OUT` via `signOutUser`, plus `#recreate-running-chip` when a job is running and `DOWNLOAD` when newest job is `done`).
2. Centered hero stack: H1, sub, URL input, attestation checkbox, CTA row (primary + contact-human).
3. Submit flow: validate `https?://`; if `!user` → stash URL in `sessionStorage('recreate.pendingUrl')` and go to `/login?next=/recreate` (on return, prefill and let user click again — no auto-fire); if signed in → open `RecreateTerminal`, POST `create`, poll `status` per the SiteRecreateCard sequence (3s × 300, log deltas via `note`).
4. Done state: terminal `doneText` + nav DOWNLOAD (`zip.downloadUrl`) + "View live preview" (`preview.vercelUrl`) link. Failed: plain error line in terminal.
5. On mount for logged-in users: `GET ?action=list`, surface newest job's state in nav (chip/download) so returning users find their zip without rerunning.
6. Behavior note: with the API unchanged, `create` succeeds only for the admin login. Non-admin signed-in users will get a 403 — show it as a friendly inline message pointing at CONTACT BRYAN. This is the intended Phase 1 posture.

Verification: `npm run build` + `npm run smoke:routes`; manual — anonymous view, login round-trip w/ `next`, admin run end-to-end (real job, terminal streams, download works), close-mid-run → chip → reopen, mobile 390px pass, rest of site unaffected (`/`, `/about`, `/dashboard` unchanged).

### Phase 2 — auth posture (BLOCKED ON USER DECISION — do not start without explicit pick)
- **Option 1 (self-serve):** open `create` to any signed-in user — keep attestation + SSRF checks, ADD a per-client daily cap (e.g. 3/day, count `clone_jobs` where `createdAt` > 24h ago) and keep `MAX_JOBS_PER_CLIENT`. Verify fresh signups resolve a `clientId` via `getEffectiveClientContext` before shipping. Accepts real infra spend (Cloud Run + Vercel publish + Storage) per public submit and widens the arbitrary-site-cloning legal/abuse surface the SSOT deliberately locked down — that's why this is a user call, not an implementer call.
- **Option 2 (soft launch):** keep admin-gated; page is live, non-admins get the contact-human path. Zero new risk.

### Phase 3 — polish
Page `<title>`/description/OG meta, favicon check, 404-safety, final mobile/spacing pass, remove any debug logs.

## Risks
- Opening `create` (Phase 2 opt 1) = spend + abuse surface — decision-gated above.
- `?next=` on AuthPage must not break the existing `flow=homepage-create` dashboard redirect — additive only.
- Terminal copy drifting from the dashboard look — match against the ui-kit HTML + the live dashboard terminal side by side.
- `styles/dashboard/index.css` on a public landing page pulls ~11 files of dashboard CSS; acceptable (precedent exists), but keep page markup scoped (ids above) so no dashboard selectors leak visually. If leakage appears, import only `colors.css`-backed classes + self-contained page styles instead.

## Route slug
`/recreate` (proposed; user example was "download mysite" — confirm or rename before Phase 3 meta work; renaming the folder is trivial before launch).
