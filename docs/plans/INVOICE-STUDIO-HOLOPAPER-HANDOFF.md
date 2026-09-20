# Invoice Studio — HoloPaper presentation layer handoff

Status: **SUPERSEDED — implemented and verified, 2026-09-04.** H0–H3 all complete; the as-built
reference is now [`docs/source-of-truth/INVOICE-STUDIO.md`](../source-of-truth/INVOICE-STUDIO.md)
§12/§13 (architecture, verified behavior, the documented webfont-fidelity limitation, and current
test counts). Kept here for the phase-by-phase rationale and the original contract this build was
held to, not as a current source of truth.

Audience: one orchestrating Claude session using parallel Sonnet implementation agents.

Builds on the completed Invoice Studio contract in
[`docs/source-of-truth/INVOICE-STUDIO.md`](../source-of-truth/INVOICE-STUDIO.md). The prior invoice
handoffs remain historical. This document controls only the new HoloPaper presentation layer.

---

## 0. Verified baseline and architectural finding

- The exact four-glob invoice suite passes **181/181**.
- The completed build reports the full repo suite at **3327/3327** and a clean isolated webpack
  build. Re-run and report actual results; do not silently rewrite that baseline.
- Invoice Studio's authoritative surface is a same-origin `srcDoc` iframe driven by
  `renderInvoiceDocument()`. The bridge patches that DOM directly during value edits.
- Holo Paper is an 11k-line, self-contained imperative Three.js editor in
  `app/dashboard/studio/ClothStudio.jsx`. It already has the desired visual and interaction grammar:
  a textured Verlet sheet, holographic `MeshPhysicalMaterial` shader, paper grain, iridescence,
  sparkle, rumple, fixed-step motion, orbit, pointer grab/fling, mirrored back texture, and strict
  teardown.
- The Mockup Video tool's `deviceInteract` pattern is the requested UX reference: one explicit
  toggle decides which surface owns pointer events; it is ephemeral and defaults off.
- A DOM iframe cannot deform with a WebGL mesh. The integration therefore needs two coordinated
  representations of the same rendered invoice: the live DOM for editing and a derived raster
  texture for the deformable scene. The DOM renderer remains the only invoice renderer.
- `three` and `three-stdlib` are already installed. No client DOM-rasterization package is currently
  installed.

Two small pre-existing contract mismatches must be repaired before Holo work:

1. `InvoiceMetaCard.jsx` currently calls `reserveNextNumber()` from a manual button, contradicting
   the locked rule that only New Document reserves a sequence number.
2. Deposit is excluded from `SectionCard`'s shared label resolver, so its rail title can disagree
   with document-kind or `paymentDueLabel` terminology.

---

## 1. Product objective

Add an optional HoloPaper presentation mode to Invoice Studio that elevates the page with the visual
character and physical interaction of the existing Holo Paper tool while preserving every current
invoice capability and the standard renderer.

The operator gets two contextual controls in the existing Cover card:

- **HOLO PAPER** — Off/On.
- **INTERACT WITH PAPER** — Off/On, available only while Holo Paper is on.

The modes are:

| Mode | Visible surface | Pointer owner | Editing behavior |
|---|---|---|---|
| Standard | Existing invoice iframe, byte/behavior unchanged | Invoice DOM | Existing two-way canvas and rail editing |
| Holo / interaction off | Live invoice iframe plus a restrained, pointer-through holographic overlay | Invoice DOM | Existing two-way canvas and rail editing remains available |
| Holo / interaction on | WebGL cloth textured from the latest authoritative invoice DOM | Holo scene | Grab/fling/orbit enabled; rail edits continue updating the scene texture; inline canvas editing resumes when interaction is turned off |

Switching modes must never change invoice data, section order, theme, totals, numbering, publish
identity, scroll state, or print/download output.

### In scope

- A legibility-tuned Invoice Holo preset derived from the existing Holo Paper `holo-foil` material.
- Non-interactive holographic overlay that leaves the real iframe usable.
- Interactive textured cloth with subtle ambient motion, orbit, grab, release/fling, and Reset View.
- Live, debounced texture refresh after rail/canvas edits and structural rerenders.
- Desktop, narrow, coarse-pointer, reduced-motion, visibility, WebGL-context-loss, and cleanup paths.
- Lazy loading so Standard mode pays no Three.js/Holo scene cost.
- Browser-local presentation preference for Holo Off/On; interaction always resets Off on load.
- Documentation and focused automated/browser verification.

### Explicitly out of scope

- Holo appearance in printed PDFs, downloaded HTML, published invoices, or server rendering.
- PNG/video export of the Holo scene.
- The full Holo Paper rail, presets, scene sets, HDRI picker, glass form, FX composer, timeline,
  lighting editor, elements, device mockup, or Cloud Run renderer.
- Custom Holo materials or JSON import/export.
- Changes to `ClothStudio.jsx` behavior, its storage, or its existing UI.
- A second invoice renderer or a Canvas-2D reimplementation of invoice layout.
- New APIs, uploads, Firestore fields, or network persistence.

---

## 2. Locked decisions

| ID | Decision |
|---|---|
| H1 | `renderInvoiceDocument()` and its live iframe DOM remain authoritative. WebGL receives only a derived visual snapshot. |
| H2 | Holo is editor presentation state, never part of normalized invoice data or the publish payload. |
| H3 | Standard mode is the default and must remain visually, behaviorally, and bundle-equivalent except for the tiny lazy-loader seam. |
| H4 | The existing 14 ordered section cards remain. Holo controls live inside Cover; no new top-level rail card. |
| H5 | Holo On + Interact Off preserves inline canvas editing. The overlay is pointer-through and must not tint text below WCAG-readable contrast. |
| H6 | Holo On + Interact On gives pointer ownership to WebGL. Inline iframe editing is temporarily unavailable, but rail edits remain live and toggling interaction Off restores the same DOM/caret-capable document. |
| H7 | `INTERACT WITH PAPER` is ephemeral and initializes Off on every mount/reload, matching Mockup Video's safety pattern. Holo On/Off may persist locally. |
| H8 | Scene code is dynamically imported only after Holo is enabled. Standard mode must not eagerly load `three`, `three-stdlib`, Holo shaders, or snapshot code. |
| H9 | Use a bounded Invoice-specific scene adapted from audited Holo Paper primitives. Do not mount/import the full `ClothStudio` component and do not modify its runtime behavior. |
| H10 | The scene includes only: textured sheet, front/back material pair, minimal lights/background, orbit, fixed-step Verlet motion, rumple, grab/fling, resize, pause/resume, reset, and disposal. |
| H11 | Texture generation clones the already-rendered same-origin invoice DOM. It strips bridge-only/editor-only artifacts and never calls a second invoice layout builder. |
| H12 | Texture refresh is generation-tokened, debounced, latest-wins, and keeps the last good texture visible. A failed refresh never blanks the document. |
| H13 | Texture dimensions honor the current renderer's maximum texture size and a documented pixel budget. Preserve aspect ratio; downsample instead of cropping. |
| H14 | Print, Download HTML, admin publish, and saved invoices continue using the normal renderer/DOM path. Holo state is excluded. |
| H15 | `prefers-reduced-motion` disables ambient cloth motion and fling. Static Holo appearance remains available; interaction can use restrained orbit/grab without autonomous animation. |
| H16 | WebGL unavailable/context lost/snapshot failure falls back to Holo non-interactive DOM mode with an honest inline notice, never a blank canvas. |
| H17 | No scene pointer handler may prevent rail scrolling, browser pinch/zoom outside the stage, keyboard navigation, or invoice actions. |
| H18 | Fix the two pre-existing numbering/Deposit terminology mismatches in H0 before declaring the combined product complete. |

---

## 3. State and component contract

Create `app/dashboard/studio/invoice/holo/useInvoicePresentation.js`:

```js
presentation = {
  holoEnabled: boolean,       // persisted locally, default false
  sceneInteractive: boolean,  // ephemeral, default false on every mount
  sceneStatus: 'idle' | 'loading' | 'ready' | 'fallback',
}
```

Use a separate, guarded localStorage key, `invoice-studio-presentation-v1`, containing only:

```js
{ v: 1, holoEnabled: boolean }
```

Do not bump or reshape `invoice-studio-draft-v2`. Presentation state is not draft/document state.
Every storage read/write must catch failures.

`InvoiceStudio.jsx` owns the one `useInvoicePresentation()` instance and passes it to both
`InvoiceCanvas` and `InvoiceRail`. `InvoiceRail` passes it through to `CoverCard`; other cards ignore
it. `CoverCard` adds one compact subsection below Design:

- Holo Paper On/Off.
- Interact with Paper On/Off, disabled while Holo is off.
- Reset View action visible only while interaction is on.
- Plain-language note: interaction mode uses the scene; turn it off to edit text directly on paper.

Turning Holo off must synchronously set `sceneInteractive:false`.

---

## 4. Snapshot contract

Create a small pipeline under `app/dashboard/studio/invoice/holo/`:

- `invoice-dom-snapshot.js` — pure clone/cleanup/size helpers plus browser rasterization driver.
- `useInvoiceTexture.js` — debounced, generation-tokened orchestration.
- Focused tests under `invoice/holo/__tests__/`.

The source is `iframe.contentDocument` after the existing renderer and bridge have produced the live
document. Clone it, never mutate the live iframe. Remove at minimum:

- `contenteditable`, focus/selection state, bridge highlight classes/styles, `data-inv-*` editor
  annotations where not needed for appearance, Download PDF controls, scripts, and transient UI.

Before capture, await the iframe's own `document.fonts.ready` and image `decode()` promises with
bounded timeouts. Inline or embed required styles/assets into the snapshot so the texture does not
depend on a later network fetch. The existing sanitized draft logo may appear because it is already
part of the authoritative rendered DOM; no other external resource may be introduced.

First prove the smallest reliable browser-native DOM-to-image path with the actual default, Ledger,
Editorial, Studio Dark, long 25-item invoice, and sanitized logo. If native SVG/`foreignObject`
rasterization cannot preserve required fidelity across the project's supported browsers, adding
exactly one maintained client-only rasterization dependency is allowed. Document the failed proof,
why the dependency is required, its client-bundle cost, and add only that dependency. Do not add a
server screenshot route or use Browserless for live editing.

Output a disposable `ImageBitmap`, canvas, or image object plus `{width,height,revision}`. The Holo
scene owns the resulting `CanvasTexture` and disposes the superseded bitmap/texture. Never serialize
the texture into invoice state or localStorage.

Refresh triggers:

- iframe `load` after structural rerender;
- debounced `draft.invoice`/`draft.lastEdit` changes while Holo is enabled;
- theme, locale, label, logo, section include/order, or document-kind changes;
- explicit retry after a fallback.

Do not regenerate at animation-frame frequency. Target no more than one capture per 250 ms during
typing, latest generation only.

---

## 5. Holo scene contract

Create an Invoice-only implementation under `app/dashboard/studio/invoice/holo/`:

- `InvoiceHoloSurface.jsx` — React lifecycle shell and accessibility/fallback UI.
- `invoice-holo-scene.js` — imperative Three.js world with a narrow public API.
- `cloth-sim.js` — pure grid/constraint/fixed-step helpers.
- `holo-material.js` — legibility-tuned shader/material configuration.
- Focused pure tests for simulation bounds, mode gating, sizing, and disposal contracts.

Required public scene API:

```js
createInvoiceHoloScene(container, {
  onReady,
  onContextLost,
}) => {
  setTexture(source, { width, height, revision }),
  setInteractive(boolean),
  setReducedMotion(boolean),
  resize(width, height, dpr),
  resetView(),
  pause(),
  resume(),
  dispose(),
}
```

Adapt only these proven `ClothStudio.jsx` behaviors, anchored by identifier rather than line number:

- `world.buildCloth` grid/aspect/constraint construction;
- `world.applyPins`, `world.applyRumple`, and fixed-step constraint relaxation;
- `world.grab` pointer raycast, tweezer falloff, pointer capture, release/fling;
- `mkClothMaterial`, `holoUniforms`, and front/back mirrored texture behavior;
- `OrbitControls` arbitration and full listener/GPU disposal.

Do not copy the giant world, full state schema, or unrelated render/export systems. Use a frozen
Invoice Holo preset tuned around pearl/white paper so black and colored invoice text stays readable.
Holographic response must modulate highlights/specular appearance rather than replace the invoice
texture's base color. The text and logo must remain recognizable while the paper moves.

Non-interactive Holo mode uses a restrained transparent overlay aligned exactly to
`#invoice-studio-paper-shell`; it has `pointer-events:none`, no orbit/grab listeners, and the iframe
remains visible and editable. Interactive mode crossfades only after the latest texture is ready,
then gives pointer ownership to the WebGL canvas and marks the iframe inert/aria-hidden for that
period. Turning interaction off reverses this without remounting or losing the iframe document.

Pause animation when the tab is hidden or the surface is outside the viewport. Resume only when
visible. Cap DPR and mesh complexity on narrow/coarse devices. On cleanup dispose renderer,
materials, front/back textures, geometry, controls, observers, RAF, timers, and all window/canvas
listeners. Ten repeated On/Off toggles must not multiply canvases, listeners, or animation loops.

---

## 6. Phases and agent ownership

### H0 — Baseline, contract repair, and seams (orchestrator)

- Record `git status`; protect all unrelated dirty paths.
- Run the exact 181-test invoice command.
- Remove the manual sequence-mutating Reserve button/import from `InvoiceMetaCard`; retain a
  non-mutating pattern example and duplicate warning.
- Route Deposit's rail title through `paymentDueLabel`, while preserving a genuinely customized
  `totals.depositLabel` as the most specific explicit per-document heading.
- Add regression tests for both repairs.
- Establish `useInvoicePresentation.js` and tests only; no visible Holo scene yet.
- Add the smallest prop seams through `InvoiceStudio`, `InvoiceRail`, and `CoverCard`, feature off.
- Rerun all invoice tests. Continue automatically.

### H1 — Two parallel Sonnet lanes

**Lane R — DOM snapshot pipeline** owns only:

- `invoice/holo/invoice-dom-snapshot.js`
- `invoice/holo/useInvoiceTexture.js`
- their new tests and an optional single dependency/lockfile hunk if the required native proof fails

**Lane S — Holo engine** owns only:

- `invoice/holo/invoice-holo-scene.js`
- `invoice/holo/cloth-sim.js`
- `invoice/holo/holo-material.js`
- `invoice/holo/InvoiceHoloSurface.jsx`
- their new tests

The lanes must not edit `InvoiceCanvas`, `InvoiceStudio`, `InvoiceRail`, `CoverCard`,
`useInvoiceDraft`, `render.js`, `ClothStudio.jsx`, or each other's files. Each reports source anchors,
files, tests, browser gaps, bundle implications, and cleanup proof.

The orchestrator inspects both diffs, rejects scope drift, integrates deliberately, and reruns the
invoice suite before H2.

### H2 — Integration (one Sonnet agent after H1)

Owns only:

- Holo integration hunks in `InvoiceCanvas.jsx`
- Presentation prop wiring in `InvoiceStudio.jsx`, `InvoiceRail.jsx`, and `CoverCard.jsx`
- Focused integration tests

Wire the three modes in §1. Preserve existing zoom, pinch, auto-height, bridge attachment,
New Invoice, Download HTML, and Print handlers. Standard mode must retain its existing DOM and CSS
path. Holo must never leak into `renderInvoiceDocument()` options or downloaded/published output.

The orchestrator reviews the diff, performs any cross-file repair, and reruns invoice tests.

### H3 — Hardening, browser proof, and documentation (orchestrator)

- Run invoice tests and the pinned default byte-identity test.
- Run `npm test`; classify environmental failures against the 3327 baseline.
- Run a safe isolated webpack build if a dev server shares the checkout.
- Perform every manual acceptance check below.
- Audit the Standard invoice route's eagerly loaded chunks: no Three/Holo/snapshot code before the
  user enables Holo.
- Update `docs/source-of-truth/INVOICE-STUDIO.md` with the new presentation layer, exact limitations,
  tests, and fallback behavior. Mark this handoff superseded only after verification passes.

---

## 7. Acceptance checks

1. Holo Off is indistinguishable from the current Invoice Studio; 181 baseline tests and golden
   bytes remain green.
2. The initial Standard route does not eagerly load Three/Holo scene code.
3. Holo On + interaction Off adds a restrained foil/paper response while the real invoice iframe
   remains selectable and directly editable. Canvas↔rail round trips still work.
4. Holo On + interaction On visibly displays the full current invoice on a deformable sheet. Drag,
   fling, orbit, and Reset View work; empty-space orbit and sheet grab do not fight.
5. Rail edits made during scene interaction refresh the texture within the debounce window without
   rebuilding the scene, resetting the camera, or flashing blank.
6. Switching interaction Off restores the same live iframe with all edits intact. Switching Holo Off
   restores the exact Standard appearance.
7. Default, Ledger, Editorial, and Studio Dark remain legible on the Holo surface. A sanitized logo,
   document-kind labels, locale formatting, reordered/hidden sections, and a 25-item invoice all
   appear correctly and uncropped.
8. New Document is the only action that reserves a sequence number. Repeated rendering/toggling and
   Holo texture refreshes never increment it.
9. Deposit rail and printed headings follow document kind and `paymentDueLabel`; a genuinely custom
   `totals.depositLabel` remains the explicit override.
10. Print/Save PDF and Download HTML contain no Holo canvas, shader, overlay, scene state, or snapshot
    artifacts and match their normal renderer output.
11. Signed-out mode contains no owner identity/HITLOOP/payment assets beyond the existing authorized
    behavior. Holo introduces no network write or publish-field change.
12. Narrow/coarse-pointer mode remains usable. Scene interaction is an explicit 44px-minimum target;
    rail scroll and browser gestures outside the paper work.
13. Reduced motion, hidden tab, offscreen surface, WebGL context loss, snapshot error, and unsupported
    WebGL each degrade honestly without a blank document.
14. Ten Holo/interaction toggle cycles produce one canvas/world at most, no duplicate listeners, no
    growing RAF count, and disposed GPU resources.
15. No console errors. Final source-of-truth documentation matches observed behavior rather than
    aspirational behavior.

---

## 8. Master Claude prompt

Copy the complete fenced prompt below into a new Claude Code session opened at the repository root.

```text
You are the orchestrating implementer for the Invoice Studio HoloPaper presentation layer in this
repository. Use multiple Sonnet agents exactly as directed by the controlling handoff. Work in the
current checkout because the Invoice Studio and related Studio baseline is uncommitted. Never
discard, reset, overwrite, commit, deploy, or modify unrelated user changes. Run continuously until
the entire H0–H3 plan is implemented and verified; do not ask the owner to test or approve between
phases. Pause only for a genuine blocker or a required product/scope decision that cannot be resolved
safely from the written contracts.

READ COMPLETELY BEFORE EDITING:
1. CLAUDE.md
2. docs/source-of-truth/INVOICE-STUDIO.md
3. docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md — the controlling plan
4. app/dashboard/studio/invoice/** and features/invoices/**
5. The relevant Holo Paper source anchors in app/dashboard/studio/ClothStudio.jsx named by §5 of the
   controlling plan; do not treat the entire component as reusable
6. The Mockup Video `deviceInteract` pointer-routing implementation in ClothStudio.jsx as the UX
   reference for the explicit interaction toggle

BASELINE FIRST:
- Record git status and protect every unrelated dirty path.
- Run exactly:
  node --test app/dashboard/studio/invoice/__tests__/*.test.js app/dashboard/studio/invoice/themes/__tests__/*.test.js app/dashboard/studio/invoice/identity/__tests__/*.test.js features/invoices/__tests__/*.test.js
- Expect 181 passes and 0 failures before new tests. If the invoice baseline fails, diagnose and
  report the real cause; do not begin feature work on a broken baseline.
- The prior completed build reports npm test at 3327/3327 and a clean isolated webpack build.

EXECUTION AND AGENT RULES:
- Execute H0 through H3 in one uninterrupted run. Do not ask for phase approvals.
- H0 is owned by you. Repair the two pre-existing numbering/Deposit terminology contract mismatches,
  add regression tests, establish presentation state/prop seams with Holo off, and keep tests green.
- H1: spawn two Sonnet agents in parallel. Lane R owns only the snapshot pipeline files/tests and an
  optional single rasterization dependency hunk if its required native proof fails. Lane S owns only
  the new Invoice Holo engine/surface files/tests. Give each the exact §6 ownership and acceptance
  criteria. They may inspect but not edit ClothStudio.jsx.
- Inspect both H1 diffs yourself. Reject scope drift, integrate deliberately, and rerun all invoice
  tests.
- H2: spawn one Sonnet integration agent with only InvoiceCanvas.jsx, InvoiceStudio.jsx,
  InvoiceRail.jsx, CoverCard.jsx, and focused integration-test ownership. Review its diff and repair
  cross-file issues yourself.
- H3 is owned by you: hardening, full verification, bundle audit, and documentation.
- Every agent reports files touched, tests added/run with exact counts, browser checks actually run,
  checks still needed, dependency/bundle effects, cleanup proof, and ownership conflicts. An agent
  stops rather than editing outside ownership.

NON-NEGOTIABLE PRODUCT CONTRACTS:
- renderInvoiceDocument() and the live same-origin iframe remain the only invoice renderer and source
  of visual truth. Holo uses a derived DOM snapshot as a texture; never build a second invoice layout.
- Preserve the three modes exactly: Standard; Holo with interaction off and the real iframe still
  editable beneath a pointer-through restrained overlay; Holo with interaction on and pointer
  ownership transferred to the textured WebGL cloth while rail edits remain live.
- Holo On/Off lives in the existing Cover card. INTERACT WITH PAPER is explicit, ephemeral, defaults
  off, and turning it off restores inline iframe editing without losing state. Add no rail card.
- Holo state is editor-only. It never enters normalized invoice data, render options, downloaded HTML,
  print/PDF, publish payloads, saved-invoice API data, or server rendering.
- Standard mode is default and must preserve the golden HTML bytes and current Invoice Studio
  behavior. New Three/Holo/snapshot code is dynamically imported only after Holo is enabled.
- Adapt the bounded cloth/material/orbit/grab behaviors identified in §5. Do not import/mount the full
  ClothStudio, change its behavior, or copy its unrelated scene/editor/export systems.
- Snapshot generation clones the already-rendered iframe DOM, is bounded/debounced/latest-wins, keeps
  the last good texture, preserves full aspect without cropping, and disposes superseded resources.
- Prefer a browser-native snapshot path. If real-browser proof shows it cannot preserve the required
  fonts/themes/logo/long-document fidelity, exactly one maintained client-only rasterizer dependency
  is authorized; document the failed proof and bundle cost. No server screenshot route.
- Holographic response must preserve invoice texture color and legibility. Use the existing Holo Paper
  look as the source, tuned to pearl/white invoice paper; do not wash out text or logos.
- Interaction mode includes bounded orbit, grab/fling, subtle fixed-step motion, Reset View, pointer
  arbitration, visibility/offscreen pause, reduced-motion behavior, resize, context-loss fallback, and
  complete listener/RAF/GPU teardown.
- Preserve all current invoice editing, section, theme, identity, numbering, saved-data, privacy,
  print, download, publish, accessibility, and mobile contracts.
- New Document is the only sequence-reservation path. Deposit rail terminology must use the shared
  label resolver while preserving a real totals.depositLabel override.
- Do not add Holo PNG/video export, the full Holo control rail, scene sets, glass, FX, timeline,
  elements, APIs, Firestore fields, or Cloud Run work.

VERIFICATION DISCIPLINE:
- After every lane and integration, run the exact invoice test command and report exact counts.
- Never regenerate the golden fixture.
- Perform all 15 acceptance checks in §7. Browser claims require a real browser; visual Holo, pointer
  grab/fling/orbit, mode switching, reduced motion, context loss/fallback, long-document texture, and
  ten-cycle teardown cannot be claimed from string/unit tests alone.
- Run npm test and classify any environmental failures against the recorded 3327 baseline.
- Run npm run build only where no dev server shares the checkout; otherwise use an isolated temporary
  snapshot containing the exact tracked and untracked working state.
- Audit route chunks and prove Standard Invoice Studio does not eagerly load Three/Holo/snapshot code.
- Update docs/source-of-truth/INVOICE-STUDIO.md with observed as-built behavior and limitations. Mark
  the Holo handoff superseded only when final verification passes.
- Never claim a browser, bundle, memory/cleanup, privacy, print, or build check passed unless you
  actually ran it.

FINAL REPORT FORMAT:
1. Outcome
2. Architecture actually shipped
3. Files changed
4. Tests and exact counts
5. Browser and visual acceptance evidence
6. Performance, bundle, fallback, and teardown evidence
7. Known limitations/blockers
8. Diff/ownership audit
9. Final readiness statement

Start with the baseline and H0, then continue automatically through H1–H3. Return only when the
complete HoloPaper presentation layer and the two prerequisite contract repairs are implemented and
final verification is complete.
```

