# Lead Gen Estimate Automation Plan

Last updated: 2026-06-04

## Goal

Add an on-demand **Create Estimate** step to the per-client Lead Generation flow. The estimate should reuse the existing custom brief pattern from the Marketing Brief/Daily Brief work: configurable inputs, generated structured output, client-facing designed HTML preview, downloadable PDF, version history, and a send-ready outreach message.

The new flow should sit after:

```text
Prepare Brief -> Generate Mockup -> Generate Site -> Create Estimate
```

## Decisions From Product Interview

- The estimate offering must be dynamic. The operator can define what is being sold per estimate: generated website, hosting, SEO, automations, content, maintenance, or any custom service.
- Pricing model must be dynamic. Each line item should support editable description and price, with defaults that can be generic at first.
- The client-facing output should use the existing custom brief style from the uploaded/custom brief format, not an internal spreadsheet look.
- Editable fields before generation: price, timeline, scope, exclusions, terms, payment schedule, and service/package details.
- Initial pricing can be generic defaults, but should be operator-editable before generation.
- The estimate should produce a dashboard HTML preview and a PDF/download artifact.
- The estimate should include the generated site preview URL and before/after AI readiness comparison as proof when available.
- Estimate generation is on demand only. It should not auto-run after site generation.
- Estimates must be versioned/archived on every regeneration.
- The output must include a send-ready email/message, similar to the existing Lead Gen send flow.

## Recommended Architecture

Do not force estimates through the existing Marketing Brief Scout/Scribe pipeline. Estimates are a different artifact type: they do not need market discovery, KOL search, or social signal scouting.

Reuse the **pattern**, not the exact pipeline:

- Config route like `app/api/dashboard/marketing-brief/config/route.js`
- On-demand run route like `app/api/leadgen/prepare-brief/route.js`
- Structured generator module under `features/leadgen`
- Designed HTML renderer using the same custom brief visual language
- Dashboard card/modal pattern from the existing client Lead Gen cards
- Firestore persistence under the synthetic prospect document

## Data Model

Primary storage:

```js
leadgen_prospects/{placeId}.generation.estimate = {
  currentVersionId: "est_...",
  latest: {
    versionId: "est_...",
    status: "generated",
    generatedAt: "2026-06-04T00:00:00.000Z",
    generatedByUid: "...",
    templateConfigSnapshot: {},
    estimateJson: {},
    html: "...",
    pdfArtifact: {
      downloadUrl: "...",
      storagePath: "...",
      generatedAt: "..."
    },
    sendMessage: {
      subject: "...",
      body: "..."
    },
    proof: {
      previewUrl: "...",
      readinessBefore: 42,
      readinessAfter: 81,
      readinessImprovement: 39
    }
  },
  versions: [
    {
      versionId: "est_...",
      generatedAt: "...",
      total: 7500,
      label: "Website redesign estimate",
      storagePath: "..."
    }
  ]
}
```

Config storage:

```js
client_configs/{clientId}.estimateBriefConfig = {
  enabled: true,
  offerSummary: "Website redesign plus launch support",
  pricingModel: "line_items", // line_items | fixed | package | hourly | tiered
  currency: "USD",
  lineItems: [
    {
      id: "website-redesign",
      label: "Website redesign",
      description: "One-page redesigned homepage based on generated preview.",
      quantity: 1,
      unitPrice: 4500,
      editable: true
    }
  ],
  timeline: "2-4 weeks after approval",
  scope: [],
  exclusions: [],
  terms: [],
  paymentSchedule: [],
  optionalAddOns: [],
  estimateTone: "clear, direct, premium, client-facing",
  sendMessageInstructions: "Write a concise email that references the preview URL and next step.",
  updatedAtIso: "..."
}
```

## Structured Estimate Output

The generator should create JSON first, then render from JSON. This avoids fragile HTML-only outputs and makes version history/search/editing easier.

```js
{
  title: "Website Redesign Estimate",
  clientName: "Client",
  generatedAt: "...",
  summary: "A concise client-facing reason for the work.",
  proofPoints: [
    "Preview site: https://...",
    "AI readiness improvement: 42 -> 81"
  ],
  lineItems: [
    {
      label: "Website redesign",
      description: "Includes homepage rebuild, responsive layout, copy structure, and launch-ready handoff.",
      quantity: 1,
      unitPrice: 4500,
      total: 4500
    }
  ],
  subtotal: 4500,
  discounts: [],
  total: 4500,
  timeline: "2-4 weeks",
  scope: [],
  exclusions: [],
  terms: [],
  paymentSchedule: [],
  optionalAddOns: [],
  nextStep: "Approve estimate to schedule kickoff.",
  sendMessage: {
    subject: "Estimate and preview for {Client}",
    body: "..."
  }
}
```

## UX

Add a fourth card in `DashboardPage.jsx` after `Generate Site`:

- `id: 'client-estimate'`
- `number: 'CE'`
- `label: 'CREATE ESTIMATE'`
- `title: 'Create Estimate'`
- `endpoint: '/api/leadgen/create-estimate'`

Card behavior:

- If no generated site exists, show prerequisite: `Run Generate Site first`.
- If a site exists but no estimate exists, show `Ready to run`.
- If an estimate exists, show status `Passed` and footer button `Re-run`.
- Clicking RUN opens the existing Lead Gen flow modal and streams progress.

Modal tabs:

- `ESTIMATE`: designed HTML preview, same custom brief style.
- `DATA`: line items, totals, proof points, generated date, PDF status, version id.
- `MESSAGE`: send-ready subject/body.
- Later phase: `CONFIG` or `EDIT` for pre-generation settings.

## API Routes

### `app/api/dashboard/estimate-brief/config/route.js`

Purpose:

- `GET` loads `client_configs/{clientId}.estimateBriefConfig`
- `POST` validates and saves editable estimate defaults

Implementation should mirror `app/api/dashboard/marketing-brief/config/route.js`:

- Verify dashboard user
- Resolve effective client context
- Normalize line items, terms, scope, exclusions, payment schedule
- Store config with `updatedAtIso`

### `app/api/leadgen/create-estimate/route.js`

Purpose:

- Stream NDJSON progress
- Load `leadgen_prospects/{placeId}`
- Load `client_configs/{clientId}.estimateBriefConfig`
- Build structured estimate JSON
- Render HTML
- Generate PDF artifact
- Store current estimate and append version metadata

Required body:

```js
{
  placeId: "client:{clientId}",
  overrides: {
    offerSummary,
    lineItems,
    timeline,
    scope,
    exclusions,
    terms,
    paymentSchedule
  }
}
```

Progress stages:

```text
start
load-context
build-estimate
verify-estimate
render-html
render-pdf
persist
done
```

## New Feature Modules

### `features/leadgen/estimate-generator.js`

Responsibilities:

- Merge defaults, saved config, and request overrides.
- Read dynamic context from:
  - prospect name, vertical, website
  - `generation.designMd`
  - `generation.previewUrl`
  - `generation.readinessComparison`
  - `generation.contentJson`
  - Knowledge Base sources if available
- Generate/normalize estimate JSON.
- Calculate totals deterministically.
- Produce send-ready message.

### `features/leadgen/estimate-verifier.js`

Responsibilities:

- Validate line-item math.
- Reject negative prices unless explicitly marked as discounts.
- Ensure total equals subtotal + adjustments.
- Ensure proof claims match stored readiness comparison.
- Ensure preview URL is only included if it exists.
- Ensure required editable fields are present.

### `features/leadgen/estimate-renderer.js`

Responsibilities:

- Render estimate JSON into the established custom brief visual style.
- Reuse `BRIEF_CSS` or extract shared brief CSS from `features/scout-intake/brief-css.cjs`.
- Keep the renderer data-driven and escaped.
- Include:
  - cover
  - summary
  - scope
  - line items
  - timeline
  - proof
  - terms/payment schedule
  - next step

### PDF Rendering

Use the same PDF/storage pattern already used by dashboard briefs if available. If no shared helper exists, create a small wrapper under `features/leadgen/estimate-pdf.js` that can render HTML to PDF and upload a storage artifact.

Do not block phase one on perfect PDF styling. The HTML preview is the source of truth; PDF should be a faithful export.

## Agent Execution Plan

### Agent 1 — Estimate Config API

Scope:

- Add `app/api/dashboard/estimate-brief/config/route.js`
- Add normalization helpers for line items, scope, exclusions, terms, payment schedule, add-ons, and tone
- Store under `client_configs/{clientId}.estimateBriefConfig`

Acceptance:

- GET returns null/default when config is absent
- POST rejects invalid JSON and empty line items only when no fixed/package price is supplied
- POST stores normalized config with `updatedAtIso`

Suggested prompt:

```text
Implement the Lead Gen Estimate config API from docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. Mirror the auth/context style of app/api/dashboard/marketing-brief/config/route.js. Keep the route narrowly scoped and add validation helpers in the route file unless reuse is clearly needed.
```

### Agent 2 — Estimate Generator + Verifier

Scope:

- Add `features/leadgen/estimate-generator.js`
- Add `features/leadgen/estimate-verifier.js`
- Include deterministic total calculation
- Include send-ready message generation
- Keep LLM use optional; phase one can generate from config and context deterministically

Acceptance:

- Generator returns stable structured JSON
- Verifier catches math errors and unsupported readiness claims
- Works when readiness comparison is missing
- Works when preview URL exists

Suggested prompt:

```text
Implement the estimate generator and verifier described in docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. The first version should be deterministic from config/context and should not require an LLM. Include focused tests for total calculation, missing preview URL, and readiness proof validation.
```

### Agent 3 — Estimate Renderer + PDF

Scope:

- Add `features/leadgen/estimate-renderer.js`
- Render the structured estimate to designed HTML using the custom brief visual language
- Add PDF generation/upload helper if a suitable shared helper is unavailable

Acceptance:

- HTML escapes untrusted values
- Output includes line items, total, timeline, proof, terms, and next step
- PDF artifact can be generated and returned/stored

Suggested prompt:

```text
Build the estimate renderer from docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. Use the existing custom brief style as the visual model. Keep rendering data-driven from estimate JSON and include escaping. Add PDF support using the nearest existing project pattern.
```

### Agent 4 — Create Estimate Route

Scope:

- Add `app/api/leadgen/create-estimate/route.js`
- Stream NDJSON progress like `prepare-brief` and `generate-site`
- Load prospect and config
- Apply request overrides
- Generate, verify, render, PDF, persist
- Append version metadata

Acceptance:

- Requires auth
- Requires `placeId`
- Handles missing prospect
- Allows estimate generation with `designMd` and works best with `previewUrl`
- Stores `generation.estimate.latest`
- Appends `generation.estimate.versions`

Suggested prompt:

```text
Implement POST /api/leadgen/create-estimate from docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. Follow the streaming NDJSON pattern used by app/api/leadgen/prepare-brief/route.js. Persist the latest estimate and append version metadata under leadgen_prospects/{placeId}.generation.estimate.
```

### Agent 5 — Dashboard Card + Modal

Scope:

- Add `client-estimate` card after `client-site` in `DashboardPage.jsx`
- Wire it to `/api/leadgen/create-estimate`
- Add modal tabs for `ESTIMATE`, `DATA`, and `MESSAGE`
- Add PDF download link when artifact exists

Acceptance:

- Card is disabled/blocked until site generation has enough context
- Existing `leadgenStep` flow can run the route
- Generated estimate preview appears without a page refresh once Firestore listener updates
- Version/data rows show current version id, generated date, total, proof, PDF status

Suggested prompt:

```text
Wire the Create Estimate step into the per-client Lead Gen cards using docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. Follow the existing client-brief/client-mockup/client-site card and modal patterns in DashboardPage.jsx. Keep the UI scoped and avoid broad refactors.
```

### Agent 6 — Editable Pre-Generation UI

Scope:

- Add a lightweight estimate config/editor panel
- Allow editing service line items, prices, timeline, scope, exclusions, terms, and payment schedule
- Save via `/api/dashboard/estimate-brief/config`
- Pass one-off overrides to `/api/leadgen/create-estimate` if needed

Acceptance:

- Operator can customize the estimate before running
- Saved defaults persist by client
- Run uses saved defaults plus any one-off overrides

Suggested prompt:

```text
Add the estimate pre-generation editor described in docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. Reuse the Marketing Brief config UI patterns where practical, but keep the controls estimate-specific: line items, price, timeline, scope, exclusions, terms, and payment schedule.
```

### Agent 7 — Tests + Verification

Scope:

- Add unit tests for generator/verifier/renderer
- Add smoke test coverage for route validation where feasible
- Run build
- Manually verify the dashboard flow

Acceptance:

- `npm run build` passes
- Estimate generator tests pass
- Renderer escaping test passes
- Route handles missing `placeId`, missing prospect, and valid generation

Suggested prompt:

```text
Add focused test coverage and verification for the Lead Gen Estimate feature from docs/LEADGEN_ESTIMATE_AUTOMATION_PLAN.md. Prioritize generator/verifier/renderer tests and a build verification. Do not refactor unrelated Lead Gen code.
```

## Implementation Order

1. Config API
2. Generator/verifier
3. Renderer/PDF
4. Create Estimate route
5. Dashboard card/modal
6. Editable config UI
7. Tests/build/manual verification

This order keeps the backend artifact stable before UI work starts.

## Risks

- PDF rendering may need a shared browser/render helper or Vercel-safe implementation.
- `DashboardPage.jsx` is large; UI agents should make narrowly scoped edits.
- Estimate version arrays could grow. If version count becomes large, move versions to a subcollection later.
- If the estimate uses LLM generation later, price math must remain deterministic after generation.

## Future Enhancements

- Estimate history picker
- One-click send using existing Lead Gen send flow
- Global pricing catalog
- Tiered package presets
- E-signature/payment link fields
- Admin-wide estimate templates
- Project conversion flow after estimate approval
