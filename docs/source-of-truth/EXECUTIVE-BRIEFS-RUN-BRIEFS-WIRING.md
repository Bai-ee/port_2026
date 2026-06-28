# Executive Briefs / Run Briefs Wiring

Last verified: 2026-06-28 against local code in `DashboardPage.jsx`.
Status: active canonical for the Daily Stand Up / Run Briefs dashboard bucket.

This documents the work that connected the Run Briefs cards into generated brief documents. The important behavior is:

- The former **Daily Stand Up** card is now the **Executive Brief** card.
- Each Run Briefs card has a `RUN BRIEF` action that maps to an existing brief producer or scoped run.
- Generated briefs appear inside the same card shell/modal pattern used by the Creative Brief.
- The duplicate Creative Director / Creative Brief card and old pre-run Brief Preview card were removed from the Run Briefs card list.

## User-facing Model

| Card | Card id | Brief composition | Run action | Preview source |
|---|---|---|---|---|
| Executive Brief | `marketing-brief` | `executive-daily` | `runMarketingBrief()` full run | `/api/dashboard/brief-preview?type=marketing` for the featured tile; named view uses `?brief=executive-daily` |
| Creative Brief | `onboarding-brief` | `onboarding` | `runCreativeBrief()` | `/api/dashboard/brief-preview?brief=onboarding`, with fallback to the legacy latest brief HTML for first-run onboarding |
| Market Brief | `brief-marketing` | `marketing-director` | `runMarketingBrief('marketing-director')` | `/api/dashboard/brief-preview?brief=marketing-director` |
| Strategy Brief | `brief-strategy` | `social-media-manager` | `runMarketingBrief('social-media-manager')` | `/api/dashboard/brief-preview?brief=social-media-manager` |
| Website Developer Brief | `brief-performance` | `website-developer` | `runBriefProducers('website-developer', 'brief-performance')` | `/api/dashboard/brief-preview?brief=website-developer` |

## Code Breadcrumbs

### Brief identity map

`DashboardPage.jsx`

- `BRIEF_TYPE_BY_CARD` maps card ids to named brief compositions: `DashboardPage.jsx:1515`.
- `BRIEF_CARD_PREVIEW_TYPES` lists cards whose shells fetch named brief HTML: `DashboardPage.jsx:1523`.
- `BRIEF_TIER_ACCESS` still comes from `features/scout-intake/brief-sections.cjs`, so entitlement logic stays tied to the server-side composition registry.

`features/scout-intake/brief-sections.cjs`

- `executive-daily` is the roll-up Executive Brief composition.
- `onboarding` is the Creative Brief composition.
- `marketing-director` is the Market Brief composition.
- `social-media-manager` is the Strategy Brief composition.
- `website-developer` is the Website Developer Brief composition.

### Preview rendering

`DashboardPage.jsx`

- Named card preview fetch key: `DashboardPage.jsx:4577`.
- Named preview fetch effect calls `/api/dashboard/brief-preview?brief=<key>`: `DashboardPage.jsx:4605`.
- Creative Brief click prefers the named onboarding render after an Executive Brief run: `DashboardPage.jsx:7215`.
- Card shell iframe branch for named brief cards: `DashboardPage.jsx:13310`.
- Modal shell iframe branch for named brief cards: `DashboardPage.jsx:15105`.

`app/api/dashboard/brief-preview/route.js`

- Accepts named brief composition through the `brief` query param.
- Uses the same `renderMarketingBriefHtml` editorial renderer for every named composition.

### Run actions

`DashboardPage.jsx`

- Executive Brief card is `marketing-brief` and displays `EXECUTIVE BRIEF`: `DashboardPage.jsx:11113`.
- Executive Brief button calls the full `runMarketingBrief` path.
- Creative Brief button calls `runCreativeBrief`.
- Market Brief calls `runMarketingBrief('marketing-director')`.
- Strategy Brief calls `runMarketingBrief('social-media-manager')`.
- Website Developer Brief calls `runBriefProducers('website-developer', 'brief-performance')`: `DashboardPage.jsx:11285`.
- List-view Run button now reflects the card's footer label/loading state instead of a generic `Run`: `DashboardPage.jsx:14100`.

`app/api/dashboard/marketing-brief/run/route.js`

- `scope=marketing-director` runs Scout-only signal refresh.
- `scope=social-media-manager` runs the strategy/scribe path reusing stored market signals.
- no scope runs the full Executive Brief path.

`app/api/dashboard/modules/run/route.js`

- Runs module brief producers such as `website-developer`.
- Persists module brief output into `dashboard_state.moduleBriefs`.

### Removed surfaces

Removed from `DashboardPage.jsx` card/modal wiring:

- Duplicate Creative Director card: old id `brief-creative`.
- Old pre-run Brief Preview card: old id `brief-preview`.
- Pay-per-run modal entry point for these brief cards: old `runPaywall` / `openRunPaywall` path.

The `/api/dashboard/brief-preview` route and `.tile-brief-preview` CSS names remain active and should not be removed. They are the renderer/shell used by the real brief previews.

### Navigation breadcrumb

`DashboardPage.jsx`

- Right nav bucket label changed from `Daily Stand Up` to `Executive Brief`, with sublabel `Daily stand up`: `DashboardPage.jsx:14180`.
- The internal bucket key remains `brief`; do not rename it without auditing routing, filters, and card grouping.

## Data Flow

```text
RUN BRIEF click
  -> card footer action
  -> run route / module producer
  -> dashboard_state update
  -> bootstrap refresh / listener update
  -> named brief preview fetch
  -> iframe in card shell + tile modal shell
```

Executive Brief specifically depends on the other populated brief/data surfaces:

```text
market signals + strategy + creative/onboarding artifacts + website/module analysis
  -> renderMarketingBriefHtml("executive-daily")
  -> one roll-up Executive Brief document
```

The standalone Market/Strategy/Website/Creative briefs render from the same underlying data and section registry, so a section can be reused inside the Executive Brief and still viewed as its own document.

## Guardrails For Future Work

- Do not reintroduce `brief-creative`; `onboarding-brief` is the Creative Brief card.
- Do not reintroduce a `brief-preview` card in Run Briefs; preview rendering is now attached to real cards.
- Do not bypass `BRIEF_TYPE_BY_CARD` / `BRIEF_CARD_PREVIEW_TYPES` when adding a new Run Briefs card.
- Do not make a card render raw `agentData`; use the named brief route and server renderer.
- Keep the card id, composition key, run action, and preview fetch in sync. If one changes, grep the other three.
- Leave `/api/dashboard/brief-preview` and `.tile-brief-preview` naming alone unless replacing the brief renderer globally.

## Verification Breadcrumbs

Commands run after implementation:

```bash
npm test
npm run build
```

Results:

- `npm test`: 600 tests passed.
- `npm run build`: passed.
- Build warning still present and unrelated to this work: Turbopack NFT warning from `features/leadgen/client-folder.js` via `app/api/leadgen/generate/route.js`.
- Browser smoke check reached the expected `/login?redirect=%2Fdashboard` redirect for unauthenticated `/dashboard`; no app runtime errors were observed. Chrome emitted WebGL performance warnings only.
