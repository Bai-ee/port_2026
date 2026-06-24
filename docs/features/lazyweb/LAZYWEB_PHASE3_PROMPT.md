# LAZYWEB PHASE 3 — Align Mockup with Design References

> Feed this to Claude Code CLI. Phases 1 and 2 are complete.
> This prompt eliminates visual drift between the mockup image and
> Lazyweb design references by injecting reference descriptions into
> the mockup generation prompt.

---

## PROBLEM

The mockup (gpt-image-2) is generated from a one-line `VERTICAL_STYLE` hint:
```
"authoritative navy + gold palette, serif headings, formal and trustworthy"
```

Meanwhile, Lazyweb returns 5 real-world screenshots with specific layout patterns,
color treatments, and typography. When Claude generates the final site, it receives
BOTH the mockup (image 1) and the Lazyweb references (images 2-6) as vision context.
If these pull in different visual directions, the output drifts.

**Root cause:** `fetch-references/route.js` (line 63) discards image-level metadata.
Lazyweb's `visionDescription` per image — which describes each reference's visual
design — never reaches Firestore. The mockup prompt has zero awareness of what
Lazyweb found.

---

## FILES TO MODIFY

1. `app/api/leadgen/fetch-references/route.js` — Store image-level metadata in Firestore
2. `features/leadgen/design-references.js` — Add `formatReferencesForMockupPrompt()` export
3. `app/api/leadgen/generate-mockup/route.js` — Inject reference direction into prompt

---

## CHANGE 1: fetch-references/route.js — Store Image Metadata

### Current code (lines 63-67):
```javascript
const refSummary = references.map(r => ({
  section:    r.section,
  query:      r.query,
  imageCount: r.images?.length || 0,
}));
```

### Replace with:
```javascript
const refSummary = references.map(r => ({
  section:    r.section,
  query:      r.query,
  imageCount: r.images?.length || 0,
  images: (r.images || []).map(img => ({
    company:     img.meta?.company     || null,
    category:    img.meta?.category    || null,
    description: img.meta?.description || null,
  })),
}));
```

This preserves the existing shape and adds an `images` array with the metadata
that Lazyweb already returns but was being discarded. The `description` field
contains Lazyweb's `visionDescription` — a text summary of the screenshot's
visual design characteristics.

**No other changes needed in this file.** The `briefNote` and `meta` fields stay as-is.

---

## CHANGE 2: design-references.js — New Export

Add a new exported function AFTER the existing `formatReferencesForBrief()` (after line 180):

```javascript
/**
 * Format reference descriptions for injection into the mockup image prompt.
 * Distills Lazyweb visionDescriptions into a concise text block that guides
 * gpt-image-2 toward the same visual direction the references represent.
 *
 * @param {Array} refSummary - The summary array stored at generation.designReferences.summary
 * @returns {string} Text block for prompt injection, or empty string if no descriptions available
 */
export function formatReferencesForMockupPrompt(refSummary) {
  if (!refSummary?.length) return '';

  const descriptions = [];
  for (const ref of refSummary) {
    for (const img of (ref.images || [])) {
      if (img.description) {
        const label = img.company ? `${img.company} (${ref.section})` : ref.section;
        descriptions.push(`- ${label}: ${img.description}`);
      }
    }
  }

  if (descriptions.length === 0) return '';

  return `DESIGN REFERENCE DIRECTION (from top-performing websites in this vertical):
${descriptions.join('\n')}

Use these reference descriptions to inform your visual approach. The mockup should
feel aligned with the design patterns described above — matching their level of
polish, layout sophistication, and visual treatment while staying true to the
brand colors specified in the brief.`;
}
```

### Why a separate function?
- `formatReferencesForBrief()` produces markdown for DESIGN.MD §9 (section counts + queries)
- `formatReferencesForMockupPrompt()` produces plain text for gpt-image-2 (visual descriptions)
- Different consumers, different formats

---

## CHANGE 3: generate-mockup/route.js — Inject into Prompt

### 3a: Add import at top of file (after line 1):

```javascript
import { formatReferencesForMockupPrompt } from '../../../../features/leadgen/design-references.js';
```

### 3b: Update `buildMockupPrompt` signature (line 32):

```javascript
function buildMockupPrompt(prospect, content, designReferences = null) {
```

### 3c: Build reference direction block

Inside `buildMockupPrompt`, after the `briefContext` block (after line 55), add:

```javascript
  // Design reference direction from Lazyweb (if available)
  const refDirection = formatReferencesForMockupPrompt(designReferences?.summary);
```

### 3d: Inject into the returned prompt

Find the VISUAL DIRECTION section in the template literal (line 84). Replace lines 84-89:

```javascript
VISUAL DIRECTION:
- Brand palette: ${primary}, ${secondary}, ${accent} — use these as the dominant color story
- Typography: strong hierarchy, mix of large display type and tight body text
- Motion/animation feel: static image but should imply kinetic energy, scroll animations, transitions
- Photography or illustration style consistent with "${style}"
- Text integrated into imagery, not just placed on top
```

With:

```javascript
VISUAL DIRECTION:
- Brand palette: ${primary}, ${secondary}, ${accent} — use these as the dominant color story
- Typography: strong hierarchy, mix of large display type and tight body text
- Motion/animation feel: static image but should imply kinetic energy, scroll animations, transitions
- Photography or illustration style consistent with "${style}"
- Text integrated into imagery, not just placed on top${refDirection ? `\n\n${refDirection}` : ''}
```

The only change is appending `${refDirection ? ...}` at the end of the VISUAL DIRECTION block.
If no references exist, nothing changes — the prompt is identical to current behavior.

### 3e: Pass designReferences to buildMockupPrompt

In the route handler, find the prompt build step (lines 212-215):

```javascript
// Current:
const content = prospect.generation?.contentJson
  ? JSON.parse(prospect.generation.contentJson)
  : {};
const prompt = buildMockupPrompt(prospect, content);
```

Replace with:

```javascript
const content = prospect.generation?.contentJson
  ? JSON.parse(prospect.generation.contentJson)
  : {};
const designRefs = prospect.generation?.designReferences || null;
const prompt = buildMockupPrompt(prospect, content, designRefs);
if (designRefs?.summary?.length) {
  emit({ type: 'progress', stage: 'mockup', label: `Injecting ${designRefs.summary.length} Lazyweb reference descriptions into prompt…` });
}
```

---

## IMPLEMENTATION RULES

1. **Graceful degradation.** If `generation.designReferences` doesn't exist in Firestore
   (references weren't fetched yet), the mockup prompt is identical to today's output.
   Zero breaking changes.

2. **No re-fetching.** The mockup reads reference metadata from Firestore — it does NOT
   call Lazyweb. The `fetch-references` endpoint already stored everything we need.
   We're just storing MORE of what it already had (the image-level metadata).

3. **Pipeline order matters.** For full alignment, the operator should run:
   `Fetch References → Prepare Brief → Generate Mockup → Generate Site`.
   If mockup runs before references, it simply uses the existing VERTICAL_STYLE
   fallback (current behavior).

4. **Keep descriptions concise.** gpt-image-2 has a prompt length limit. The
   `formatReferencesForMockupPrompt()` function includes only the `visionDescription`
   text per image — typically 1-2 sentences each. With 5 references max, this adds
   roughly 200-400 characters to the prompt. Well within limits.

5. **Don't modify VERTICAL_STYLE.** The one-liner style hints remain as the base
   fallback. Reference descriptions layer ON TOP of them, not replace them.

6. **Follow existing patterns.** Import style, error handling, emit/progress format
   all match the existing codebase.

---

## DATA FLOW AFTER PHASE 3

```
Firestore: generation.designReferences
├── summary[]
│   ├── section: "hero"
│   ├── query: "law firm website hero section"
│   ├── imageCount: 2
│   └── images[]                          ← NEW (was missing)
│       ├── company: "Smith & Associates"
│       ├── category: "Legal"
│       └── description: "Dark navy hero with large serif headline, gold accent
│                          underline, full-bleed courtroom photography, minimal nav"
├── briefNote: "**Design References...**"   (unchanged — used by DESIGN.MD §9)
└── meta: { vertical, totalImages, ... }    (unchanged)

                    ┌──────────────────────────────────────┐
                    │                                      │
                    ▼                                      ▼
         generate-mockup/route.js              generate-site/route.js
         reads summary[].images[].description  fetches CDN URLs → base64
         injects into text prompt              injects as vision images
         gpt-image-2 generates mockup          Claude sees mockup + refs
                    │                                      │
                    └──────────── ALIGNED ──────────────────┘
```

Both the mockup generator and the site generator now draw from the SAME
Lazyweb reference data — text descriptions for the mockup, actual screenshots
for site generation. The visual direction is consistent end-to-end.

---

## VERIFICATION CHECKLIST

- [ ] `fetch-references` stores `images[]` with `company`, `category`, `description` per reference
- [ ] Existing `briefNote` and `meta` fields unchanged (backward compatible)
- [ ] `formatReferencesForMockupPrompt()` returns empty string when no descriptions exist
- [ ] `formatReferencesForMockupPrompt()` produces clean text block when descriptions exist
- [ ] `generate-mockup` works identically when `generation.designReferences` is null (backward compatible)
- [ ] `generate-mockup` works identically when `designReferences.summary` has no image metadata (backward compatible)
- [ ] `generate-mockup` injects reference direction when descriptions are available
- [ ] Progress stream shows "Injecting N Lazyweb reference descriptions" when refs exist
- [ ] `generate-site` still works (no changes to this file — just verify no regression)
- [ ] Pipeline order: Fetch References → Prepare Brief → Generate Mockup → Generate Site produces aligned output

---

## PIPELINE FLOW AFTER PHASE 3

```
1. Modules run (Social Preview, SEO, AI Readiness, Design Eval, Brand System)
2. Fetch References — queries Lazyweb, stores metadata INCLUDING image descriptions
3. Prepare Brief — builds DESIGN.MD (§9 includes reference metadata)
4. Generate Mockup — gpt-image-2 receives:
     - VERTICAL_STYLE base direction
     - Brand colors from scraper/brand system
     - [NEW] Lazyweb visionDescriptions as DESIGN REFERENCE DIRECTION block
5. Generate Site — Claude receives:
     - Image 1: mockup (now informed by same references)
     - Images 2-6: Lazyweb screenshots (actual images)
     - Text: DESIGN.MD brief with §9 operator notes
     → Mockup and references are now pulling in the SAME direction
6. Deploy to Vercel
7. Readiness comparison
```
