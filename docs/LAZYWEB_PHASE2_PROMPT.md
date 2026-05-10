# LAZYWEB PHASE 2 — Wire Design References into Generation Pipeline

> Feed this to Claude Code CLI. Phase 1 is complete — the module, endpoint,
> and test script are all working. Coverage is confirmed across all 12 verticals.
> This prompt wires Lazyweb references into site generation and DESIGN.MD.

---

## CONTEXT

Phase 1 built:
- `features/leadgen/design-references.js` — exports `fetchDesignReferences()` and `formatReferencesForBrief()`
- `app/api/leadgen/fetch-references/route.js` — NDJSON streaming endpoint, stores metadata at `generation.designReferences`

**Critical implementation detail:** Lazyweb returns `imageUrl` (signed CDN URLs), NOT base64. Each result in `parseImageUrls()` has shape:
```javascript
{ url: 'https://cdn.lazyweb.com/...signed-url...', mimeType: 'image/png', meta: { company, category, visionDescription } }
```

**Critical API detail:** The Anthropic client (`features/scout-intake/_anthropic-client.js`) uses `anthropic-version: 2023-06-01` which only supports `source.type: 'base64'` for vision, NOT `source.type: 'url'`. So Lazyweb CDN URLs must be fetched and converted to base64 before sending to Claude.

---

## FILES TO MODIFY

1. `app/api/leadgen/generate-site/route.js` — Add Lazyweb reference images as vision context alongside mockup
2. `features/leadgen/design-md-generator.js` — Accept `designReferences` param, append to §9 Operator Notes
3. `app/api/leadgen/prepare-brief/route.js` — Pass `designReferences` through to `generateDesignMd()`
4. `components/dashboard/LeadGenDashboard.jsx` — Add Design References to module registry

---

## CHANGE 1: generate-site/route.js — Vision Context Injection

This is the primary integration. Replace the current Step 2 block (lines 209-230) with a new block that loads both the mockup AND Lazyweb references as vision context.

### Current code (lines 209-230):
```javascript
// ── Step 2: Load mockup image (vision context) ─────────────────
let messageContent = userPrompt;
const mockupUrl = prospect?.generation?.mockupUrl;
if (mockupUrl) {
  // ... fetches mockup, converts to base64, builds messageContent array
}
```

### Replace with:
```javascript
// ── Step 2: Load vision context (mockup + design references) ──────
let messageContent = userPrompt;
const mockupUrl    = prospect?.generation?.mockupUrl;
const visionImages = []; // { type: 'image', source: { type: 'base64', media_type, data } }

// 2a: Load mockup image
if (mockupUrl) {
  try {
    emit({ type: 'progress', stage: 'generate', label: 'Loading visual mockup…' });
    const imgRes = await fetch(mockupUrl, { signal: AbortSignal.timeout(20_000) });
    if (imgRes.ok) {
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      visionImages.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: imgBuf.toString('base64') },
      });
      emit({ type: 'progress', stage: 'generate', label: `Mockup loaded (${(imgBuf.byteLength / 1024).toFixed(0)}KB)` });
    }
  } catch {
    emit({ type: 'progress', stage: 'generate', label: '⚠ Mockup load failed — continuing without.' });
  }
}

// 2b: Load Lazyweb design references (if LAZYWEB_TOKEN is configured)
if (process.env.LAZYWEB_TOKEN) {
  try {
    emit({ type: 'progress', stage: 'references', label: 'Fetching design references from Lazyweb…' });

    const { fetchDesignReferences } = await import('../../../../features/leadgen/design-references.js');
    const { references } = await fetchDesignReferences({
      vertical: prospect.vertical || 'default',
      onProgress: (label) => emit({ type: 'progress', stage: 'references', label }),
    });

    // Fetch each CDN URL → base64 (API version 2023-06-01 requires base64, not URL)
    let refCount = 0;
    for (const ref of references) {
      for (const img of (ref.images || [])) {
        if (!img.url) continue;
        try {
          const imgRes = await fetch(img.url, { signal: AbortSignal.timeout(10_000) });
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            // Skip images larger than 1.5MB to stay within API limits
            if (buf.byteLength > 1_500_000) continue;
            visionImages.push({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType || 'image/png', data: buf.toString('base64') },
            });
            refCount++;
          }
        } catch { /* skip failed downloads silently */ }
      }
    }

    if (refCount > 0) {
      emit({ type: 'progress', stage: 'references', label: `Loaded ${refCount} design reference${refCount > 1 ? 's' : ''} as vision context` });
    }
  } catch (err) {
    emit({ type: 'progress', stage: 'references', label: `⚠ Design references skipped: ${err.message}` });
  }
}

// 2c: Build final message content
if (visionImages.length > 0) {
  const hasMockup = !!mockupUrl && visionImages.length > 0;
  const refImageCount = visionImages.length - (hasMockup ? 1 : 0);

  let visionPreamble = '';
  if (hasMockup && refImageCount > 0) {
    visionPreamble = `The first image is the visual mockup target — match its layout, color scheme, and section structure. The remaining ${refImageCount} image${refImageCount > 1 ? 's are' : ' is a'} real-world design reference${refImageCount > 1 ? 's' : ''} from top websites in this vertical — use them as inspiration for section layout, typography treatment, and visual polish.`;
  } else if (hasMockup) {
    visionPreamble = 'The image above is the visual mockup target — match its layout, color scheme, and section structure.';
  } else {
    visionPreamble = `The ${refImageCount} image${refImageCount > 1 ? 's are' : ' is a'} real-world design reference${refImageCount > 1 ? 's' : ''} from top websites in this vertical — use them as inspiration for section layout, typography treatment, and visual polish.`;
  }

  messageContent = [
    ...visionImages,
    { type: 'text', text: `${visionPreamble}\n\n${userPrompt}` },
  ];

  emit({ type: 'progress', stage: 'generate', label: `Calling ${MODEL} with ${visionImages.length} image${visionImages.length > 1 ? 's' : ''} (mockup${refImageCount > 0 ? ` + ${refImageCount} references` : ''})…` });
} else {
  emit({ type: 'progress', stage: 'generate', label: `Calling ${MODEL} — generating homepage (no vision context)…` });
}
```

### Add import at top of file:
No static import needed — we use dynamic `import()` inside the handler so the module is only loaded when `LAZYWEB_TOKEN` exists.

---

## CHANGE 2: design-md-generator.js — §9 Operator Notes

### 2a: Update function signature

```javascript
// Line 208 — add designReferences parameter
export function generateDesignMd({ prospect, onboard = {}, content = {}, assetManifest = null, brandSystem = null, designReferences = null }) {
```

### 2b: Update buildOperatorNotes to accept references

```javascript
// Line 170 — add second parameter
function buildOperatorNotes(bs, designReferences = null) {
  // ... existing Brand System logic (lines 171-203 stay exactly as-is) ...

  // After the existing Brand System blocks, before the return:
  // Append Lazyweb design reference metadata if available
  const refNote = designReferences?.briefNote;
  if (refNote) {
    lines.push(`\n${refNote}`);
  }

  return lines.join('\n\n') || '_No brand intelligence available. Add creative direction manually._';
}
```

### 2c: Update the §9 call site

Find the line in the template literal that calls `buildOperatorNotes`:
```javascript
// Current (around line 603):
${buildOperatorNotes(brandSystem)}

// Change to:
${buildOperatorNotes(brandSystem, designReferences)}
```

---

## CHANGE 3: prepare-brief/route.js — Pass designReferences through

The `prepare-brief` endpoint already reads the prospect document. If `generation.designReferences` was previously stored by the `fetch-references` endpoint, pass it through.

```javascript
// After line 109 (where brandGuide is resolved), add:
const designRefs = prospect.generation?.designReferences || null;

// Update the generateDesignMd call (around line 110):
const designMd = generateDesignMd({
  prospect,
  onboard:          prospect.onboard || {},
  content,
  assetManifest,
  brandSystem:      brandGuide,
  designReferences: designRefs,     // ← NEW
});
```

---

## CHANGE 4: LeadGenDashboard.jsx — Module Registry

Add the Design References module to `LEADGEN_MODULE_REGISTRY` (currently at line 146):

```javascript
// Add after the 'brand-system' entry (line ~195), before the closing bracket:
{
  id: 'design-references',
  label: 'Design References',
  description: 'Lazyweb · vertical-matched design inspiration',
  Icon: ImageIcon,         // import { ImageIcon } from 'lucide-react' — or use existing Images icon
  type: 'analysis',
  storeKey: 'designReferences',
},
```

This requires the module runner to route `design-references` → `POST /api/leadgen/fetch-references`. Check how the existing module runner dispatches module IDs to API endpoints. It likely maps `cardId` to an endpoint path. The mapping should be:

```javascript
'design-references': '/api/leadgen/fetch-references'
```

Find where the existing modules (social-preview, seo-performance, etc.) are mapped to their API endpoints and add this entry. The endpoint path follows the same NDJSON streaming pattern as the others.

**Important:** Also ensure the `Icon` import exists. Check what icon imports are already at the top of `LeadGenDashboard.jsx` from lucide-react. Use `Image` or `Images` or `Palette` if `ImageIcon` isn't available.

---

## IMPLEMENTATION RULES

1. **Do NOT change `_anthropic-client.js`.** The `anthropic-version: 2023-06-01` stays as-is. We fetch CDN URLs to base64 in `generate-site` instead.

2. **Image size guard.** Skip any reference image >1.5MB to stay within Claude API vision limits. The mockup image is typically ~200-500KB. 5 reference screenshots at ~100-300KB each is fine.

3. **Graceful degradation.** If `LAZYWEB_TOKEN` is not set, `generate-site` skips the reference block entirely. If fetching fails, it logs a warning and continues with mockup-only (or text-only). Zero breaking changes.

4. **No re-fetching during prepare-brief.** The `prepare-brief` endpoint does NOT call Lazyweb. It reads `generation.designReferences` from Firestore (stored by the separate `fetch-references` endpoint). The `generate-site` endpoint fetches fresh images at generation time because CDN URLs may expire.

5. **Follow existing code patterns.** The emit/progress/NDJSON pattern, error handling, and code style match the existing routes exactly.

6. **Keep the existing mockup logic working.** The mockup is always the FIRST image in the vision array. References come after. The text preamble distinguishes them clearly so Claude knows which is the target and which are inspiration.

---

## VERIFICATION CHECKLIST

- [ ] `generate-site` works identically when `LAZYWEB_TOKEN` is not set (backward compatible)
- [ ] `generate-site` works when mockup exists but Lazyweb fails (mockup-only vision)
- [ ] `generate-site` works when Lazyweb succeeds but no mockup exists (references-only vision)
- [ ] `generate-site` works with both mockup + references (full vision context)
- [ ] Reference images >1.5MB are skipped without error
- [ ] DESIGN.MD §9 includes Lazyweb reference metadata when `generation.designReferences` exists
- [ ] DESIGN.MD §9 is unchanged when `designReferences` is null (backward compatible)
- [ ] Dashboard shows Design References module card
- [ ] Module card triggers `POST /api/leadgen/fetch-references` and streams progress
- [ ] `prepare-brief` passes `designReferences` from Firestore through to `generateDesignMd()`

---

## PIPELINE FLOW AFTER PHASE 2

```
1. Modules run (Social Preview, SEO, AI Readiness, Design Eval, Brand System)
2. [NEW] Fetch References — queries Lazyweb for vertical-matched screenshots
3. Prepare Brief — scrapes site + builds DESIGN.MD (now includes reference metadata in §9)
4. Generate Mockup — gpt-image-2 visual target
5. Generate Site — Claude receives:
     Image 1: mockup (layout/color target)
     Images 2-6: Lazyweb references (section-level design inspiration)
     Text: full DESIGN.MD brief with §9 operator notes + reference metadata
6. Deploy to Vercel
7. Readiness comparison
```

The order of steps 2 and 3 matters: `fetch-references` should run BEFORE `prepare-brief` so the references metadata is available when the brief is built. Both are manual button clicks in the dashboard, so the operator controls the order.
