# Brand Guide v1 — Existing Code Map

Every file in the current Brand System pipeline, with line counts and responsibilities.

## Core Logic

### `features/scout-intake/modules/brand-system.js` (437 lines)
**The main mapper.** Pure function that converts dashboard state to Brand System JSON + gap list.

Key exports:
- `SCHEMA_VERSION` — currently `1`
- `GAP_DEFS` — array of 5 gap definitions (logo, soul-descriptors, visual-language, lighting, material)
- `mapPipelineToBrandSystem(state)` — reads pipeline data, returns `{ filled, gaps, completeness, schemaVersion }`
- `buildBrandSystemJson({ filled })` — assembles final JSON matching Image-2.0 schema
- `buildMasterPrompt(json)` — generates the single master prompt string
- `buildIfComplete(state)` — convenience wrapper
- `analyzeLogo(opts)` — wrapper for Anthropic vision API (also in brand-system-vision.js)

Pipeline data readers (internal):
- `getBrandName(state)` — from snapshot.brandOverview.name or client.name
- `getBrandStatement(state)` — from snapshot.brandOverview.tagline/headline
- `getIndustry(state)` — from snapshot.brandOverview.industry
- `getSoulDescriptors(state)` — from snapshot.brandTone.descriptors/keywords (needs 3+)
- `getColors(state)` — from snapshot.visualIdentity.styleGuide.colors or analyzerOutputs.style-guide.colors
- `getTypography(state)` — from snapshot.visualIdentity.styleGuide.typography or analyzerOutputs
- `getLogoUrl(state)` — from userUploads.brandSystem.logoUrl, siteMeta.favicon, or siteMeta.ogImage

Current GAP_DEFS:
1. `logo` — image upload → Claude vision analysis (required)
2. `soul-descriptors` — 3-word short-text-list (required)
3. `visual-language` — choice: editorial/cinematic/industrial/organic/futuristic (required)
4. `lighting` — choice: hard directional/soft diffused/neon-saturated/overcast natural (required)
5. `material` — choice: matte paper/glass/brushed metal/soft fabric/polished plastic (required)

### `features/scout-intake/modules/brand-system-vision.js` (88 lines)
**Logo vision analysis.** Calls Claude Sonnet with the brand-system-vision.md prompt.

- `analyzeLogo({ imageUrl, imageBase64, mediaType })` — returns `{ ok, vision, usage }`
- Uses model: `claude-sonnet-4-20250514`, max tokens: 1500
- Loads system prompt from `skills/brand-system-vision.md`
- Strips code fences from response, parses JSON

### `features/scout-intake/skills/brand-system-vision.md` (64 lines)
**Logo vision system prompt.** Extracts 7 fields:
- shape_language, stroke_logic, motif_seeds, color_hints, material_inference, iconography_style, personality_words

### `features/scout-intake/skills/brand-asset-gap.md` (159 lines)
**Brand asset coherence audit.** Separate from Brand Guide — audits brand consistency across the site.

## API Endpoints

### `app/api/brand-system/scan/route.js` (89 lines)
**GET /api/brand-system/scan** — Read-only scan phase.

Flow:
1. Verify Firebase auth token
2. Get clientId from users/{uid}.clientId
3. Fetch dashboard_state + clients from Firestore
4. Run mapPipelineToBrandSystem() with merged state
5. Return `{ clientId, filled, gaps, completeness, schemaVersion, lastRun }`

### `app/api/brand-system/chat/route.js` (195 lines)
**POST /api/brand-system/chat** — Gap-fill + assembly endpoint.

Body: `{ gapId, value, imageUrl?, imageBase64?, mediaType? }`

Flow:
1. Verify auth, get clientId
2. If gapId === 'logo': run analyzeLogo(), store logoVisionAnalysis + usage
3. Otherwise: map gapId → field name via fieldForGap(), write to dashboard_state.userUploads.brandSystem
4. Re-fetch merged state
5. Re-run mapper
6. If gaps remain: return `{ done: false, nextGap, remaining, completeness }`
7. If complete: assemble JSON + masterPrompt, write to dashboard_state.brandSystem, return `{ done: true, json, masterPrompt, sources, generatedAt }`

Current fieldForGap mappings:
- logo → logoUrl
- soul-descriptors → soulDescriptors
- visual-language → visualLanguage
- lighting → lighting
- material → material

## Frontend

### `components/dashboard/BrandSystemTerminal.jsx` (723 lines)
**Full-screen terminal modal.** macOS-style window chrome with terminal log + chat panel.

Three phases:
1. **SCAN** — calls /api/brand-system/scan, streams progress lines
2. **CHAT** — iterates through gaps with type-specific UI (image upload, choice buttons, text input, short-text-list)
3. **DONE** — shows completion, "Open Details" button

Key state: phase, logLines, scanResult, currentGap, textInput, submitting, finalResult

Gap type UI components:
- `image` → file upload button (PNG/JPG/SVG/WebP)
- `choice` → button grid
- `short-text-list` → text input with 3-word parsing (commas/slashes/"and"/2+ spaces)
- `text` → standard text input

## Supporting Files

### `features/scout-intake/_anthropic-client.js`
Anthropic API wrapper: `callAnthropic(params)`, cost extraction utilities.

### `DashboardPage.jsx`
Dashboard integration — BrandSystemTerminal lazy-loaded, triggered by brand-system card.

### `features/not-the-rug-brief/knowledge/not-the-rug/brand-voice.json` (132 lines)
Example brand voice doc for "Not The Rug" — demonstrates how brand system output informs content strategy.

## Firestore Data Shape

```
dashboard_state/{clientId} = {
  snapshot: {
    brandOverview: { name, tagline, headline, industry, ... },
    brandTone: { descriptors[], keywords[], primary, secondary, ... },
    visualIdentity: {
      styleGuide: {
        colors: { primary, secondary, tertiary, neutral },
        typography: { headingSystem, bodySystem }
      }
    }
  },
  analyzerOutputs: { "style-guide": { colors, typography }, ... },
  siteMeta: { favicon, ogImage, canonical, ... },
  userUploads: {
    brandSystem: {
      logoUrl, logoVisionAnalysis, logoVisionUsage,
      soulDescriptors, visualLanguage, lighting, material,
      brandName, brandStatement, industry
    }
  },
  brandSystem: {
    json: { /* v1 schema */ },
    masterPrompt: "Design a vertical 4:5...",
    sources: { brandName: "pipeline", ... },
    generatedAt: "ISO timestamp",
    schemaVersion: 1
  },
  artifacts: {
    homepageScreenshots: { desktop: "url", mobile: "url" },
    homepageDeviceMockup: "url",
    fullPageScreenshots: { desktop: "url" }
  }
}
```
