# GENERATION TOGGLES — Pipeline Feature Flags UI + Backend

> Feed this to Claude Code CLI. This adds toggleable feature flags to the
> Generate Site step, visible in both the dashboard card (expanded prospect)
> and wired through to the API endpoint.

---

## CONTEXT

The Elia Chicago generation (our best output to date) used a simpler pipeline:
scraper → asset manifest → DESIGN.MD → mockup → Claude generation. It did NOT
use Brand System, Design Evaluation priority chains, or Lazyweb references.

We need operator control over which pipeline features are active per generation.
Toggles live on the Generate Site card and are passed to the API as body params.

---

## TOGGLE DEFINITIONS

| ID | Label | Default | Description |
|----|-------|---------|-------------|
| `useMockup` | Mockup vision | ON | Send mockup image as Claude vision context |
| `useLazywebVision` | Lazyweb references | OFF | Fetch Lazyweb screenshots as additional vision context |
| `useBrandSystem` | Brand System | ON | Include Brand System data in DESIGN.MD priority chain |
| `useDesignEval` | Design Eval | ON | Include Design Evaluation data in DESIGN.MD priority chain |
| `runComparison` | Readiness check | ON | Run before/after AI Readiness comparison post-deploy |

**Note:** `useBrandSystem` and `useDesignEval` only matter if those modules have
been run for the prospect. When toggled OFF, the brief falls back to
scraper + vertical defaults only — mimicking the "simple pipeline" that produced
the Elia result.

---

## FILES TO MODIFY

1. `components/dashboard/LeadGenDashboard.jsx` — Add toggle UI to the Generate Site step
2. `components/dashboard/leadgen/LeadgenModulePanel.jsx` — Accept + forward `extraBody` params
3. `app/api/leadgen/generate-site/route.js` — Read toggle flags from body, gate features
4. `app/api/leadgen/prepare-brief/route.js` — Read `useBrandSystem` and `useDesignEval` flags

---

## CHANGE 1: LeadGenDashboard.jsx — Toggle UI on Generate Site Card

### 1a: Add state for generation toggles

Near the existing state declarations (around line 226), add:

```javascript
// Generation feature toggles — keyed by placeId so each prospect has its own state
const [genToggles, setGenToggles] = useState({});

function getToggles(placeId) {
  return genToggles[placeId] || {
    useMockup: true,
    useLazywebVision: false,
    useBrandSystem: true,
    useDesignEval: true,
    runComparison: true,
  };
}

function setToggle(placeId, key, value) {
  setGenToggles(prev => ({
    ...prev,
    [placeId]: { ...getToggles(placeId), [key]: value },
  }));
}
```

### 1b: Add toggle row to the Generate Site step (Step 3)

Inside the Step 3 div (after the "View / Edit Prompt" button, before the Generate button), 
add a toggle row. Insert between lines 1194-1195:

```jsx
{/* Generation toggles */}
<div className="leadgen-gen-toggles" onClick={(e) => e.stopPropagation()}>
  <label className="leadgen-gen-toggle" title="Include mockup as vision context">
    <input
      type="checkbox"
      checked={getToggles(p.placeId).useMockup}
      onChange={(e) => setToggle(p.placeId, 'useMockup', e.target.checked)}
    />
    <span>Mockup</span>
  </label>
  <label className="leadgen-gen-toggle" title="Fetch Lazyweb reference screenshots as vision">
    <input
      type="checkbox"
      checked={getToggles(p.placeId).useLazywebVision}
      onChange={(e) => setToggle(p.placeId, 'useLazywebVision', e.target.checked)}
    />
    <span>Lazyweb</span>
  </label>
  <label className="leadgen-gen-toggle" title="Include Brand System in brief priority chain">
    <input
      type="checkbox"
      checked={getToggles(p.placeId).useBrandSystem}
      onChange={(e) => setToggle(p.placeId, 'useBrandSystem', e.target.checked)}
    />
    <span>Brand</span>
  </label>
  <label className="leadgen-gen-toggle" title="Include Design Eval in brief priority chain">
    <input
      type="checkbox"
      checked={getToggles(p.placeId).useDesignEval}
      onChange={(e) => setToggle(p.placeId, 'useDesignEval', e.target.checked)}
    />
    <span>DesignEval</span>
  </label>
  <label className="leadgen-gen-toggle" title="Run AI Readiness before/after comparison">
    <input
      type="checkbox"
      checked={getToggles(p.placeId).runComparison}
      onChange={(e) => setToggle(p.placeId, 'runComparison', e.target.checked)}
    />
    <span>Readiness</span>
  </label>
</div>
```

### 1c: Pass toggles when opening the module panel

Update the Generate Site button's onClick (line 1200) to include toggles in the panel state:

```javascript
onClick={(e) => {
  e.stopPropagation();
  setModulePanel({
    placeId: p.placeId,
    moduleId: 'generate-site',
    moduleLabel: 'Generate Site',
    endpoint: '/api/leadgen/generate-site',
    extraBody: getToggles(p.placeId),
  });
}}
```

### 1d: Add CSS for toggle row

Add to the component's existing styles or the shared CSS file:

```css
.leadgen-gen-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  margin-top: 6px;
}
.leadgen-gen-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #6b7280);
  cursor: pointer;
  user-select: none;
}
.leadgen-gen-toggle input[type="checkbox"] {
  width: 12px;
  height: 12px;
  margin: 0;
  accent-color: #4f46e5;
  cursor: pointer;
}
.leadgen-gen-toggle span {
  line-height: 1;
}
```

---

## CHANGE 2: LeadgenModulePanel.jsx — Forward extraBody

### 2a: Accept `extraBody` prop

Update the component signature (line 96):

```javascript
export default function LeadgenModulePanel({
  open, placeId, moduleId, moduleLabel, endpoint, extraBody, getIdToken, onClose, onDone,
}) {
```

### 2b: Include extraBody in the fetch call

Update the body JSON (line 171):

```javascript
body: JSON.stringify({ placeId, moduleId, ...extraBody }),
```

### 2c: Pass extraBody from LeadGenDashboard

Find the `<LeadgenModulePanel` JSX at the bottom of the dashboard (around line 1429).
Add the `extraBody` prop:

```jsx
<LeadgenModulePanel
  open={Boolean(modulePanel)}
  placeId={modulePanel?.placeId}
  moduleId={modulePanel?.moduleId}
  moduleLabel={modulePanel?.moduleLabel}
  endpoint={modulePanel?.endpoint}
  extraBody={modulePanel?.extraBody}   // ← NEW
  getIdToken={getIdToken}
  onClose={() => setModulePanel(null)}
  onDone={handleModuleDone}
/>
```

---

## CHANGE 3: generate-site/route.js — Gate Features with Flags

### 3a: Read toggle flags from body

Update the body parsing section (around line 170):

```javascript
const placeId          = String(body?.placeId || '').trim();
const skipComparison   = body?.skipComparison === true || body?.runComparison === false;
const useMockup        = body?.useMockup !== false;          // ON by default
const useLazywebVision = body?.useLazywebVision === true;    // OFF by default
const useBrandSystem   = body?.useBrandSystem !== false;     // ON by default
const useDesignEval    = body?.useDesignEval !== false;      // ON by default
```

### 3b: Gate the mockup loading

Wrap the existing mockup block with the flag (around line 228):

```javascript
if (useMockup && mockupUrl) {
  // ... existing mockup load + resize code stays as-is ...
}
```

Change the outer `if (mockupUrl)` to `if (useMockup && mockupUrl)`.

### 3c: Re-enable Lazyweb vision behind flag

After the mockup block, add a conditional Lazyweb fetch (re-adding what we removed,
but now gated behind the `useLazywebVision` flag):

```javascript
// Lazyweb reference images — OFF by default, enabled via toggle
let refImages = [];
if (useLazywebVision && process.env.LAZYWEB_TOKEN) {
  try {
    emit({ type: 'progress', stage: 'references', label: 'Fetching Lazyweb references (toggled ON)…' });
    const { fetchDesignReferences } = await import('../../../../features/leadgen/design-references.js');
    const { references } = await fetchDesignReferences({
      vertical: prospect.vertical || 'default',
      onProgress: (label) => emit({ type: 'progress', stage: 'references', label }),
    });

    for (const ref of references) {
      for (const img of (ref.images || [])) {
        if (!img.url) continue;
        try {
          const imgRes = await fetch(img.url, { signal: AbortSignal.timeout(10_000) });
          if (imgRes.ok) {
            const buf = Buffer.from(await imgRes.arrayBuffer());
            if (buf.byteLength > 1_500_000) continue;
            refImages.push({
              type: 'image',
              source: { type: 'base64', media_type: img.mimeType || 'image/png', data: buf.toString('base64') },
            });
          }
        } catch { /* skip */ }
      }
    }
    if (refImages.length > 0) {
      emit({ type: 'progress', stage: 'references', label: `Loaded ${refImages.length} reference image${refImages.length > 1 ? 's' : ''}` });
    }
  } catch (err) {
    emit({ type: 'progress', stage: 'references', label: `⚠ References skipped: ${err.message}` });
  }
}
```

### 3d: Update messageContent builder

Replace the current "Build final message content" block with one that handles all three states
(mockup only, mockup + refs, refs only, neither):

```javascript
// Build final message content
const visionImages = [
  ...(mockupImage ? [mockupImage] : []),
  ...refImages,
];

if (visionImages.length > 0) {
  const hasMockup  = !!mockupImage;
  const refCount   = refImages.length;
  let visionPreamble;

  if (hasMockup && refCount > 0) {
    visionPreamble = `The first image is the visual mockup target — match its layout, color scheme, and section structure exactly. The remaining ${refCount} image${refCount > 1 ? 's are' : ' is a'} real-world design reference${refCount > 1 ? 's' : ''} from top websites in this vertical — use them as inspiration for section layout, typography treatment, and visual polish.`;
  } else if (hasMockup) {
    visionPreamble = 'The image above is the visual mockup target — match its layout, color scheme, and section structure.';
  } else {
    visionPreamble = `The ${refCount} image${refCount > 1 ? 's are' : ' is a'} real-world design reference${refCount > 1 ? 's' : ''} from top websites in this vertical — use them as inspiration.`;
  }

  messageContent = [
    ...visionImages,
    { type: 'text', text: `${visionPreamble}\n\n${userPrompt}` },
  ];
  emit({ type: 'progress', stage: 'generate', label: `Calling ${MODEL} with ${visionImages.length} image${visionImages.length > 1 ? 's' : ''}…` });
} else {
  emit({ type: 'progress', stage: 'generate', label: `Calling ${MODEL} — text-only (no vision context)…` });
}
```

### 3e: Pass brief flags to a brief-rebuild if needed

If `useBrandSystem` or `useDesignEval` are toggled OFF but the stored DESIGN.MD was
built WITH those features, we need to regenerate the brief on-the-fly. Add this
BEFORE Step 2 (after the prompt is built):

```javascript
// If brief-level toggles differ from what was used, rebuild DESIGN.MD on-the-fly
const briefNeedsRebuild = (!useBrandSystem || !useDesignEval) && prospect?.generation?.designMd;
if (briefNeedsRebuild) {
  emit({ type: 'progress', stage: 'prompt', label: 'Rebuilding brief with toggled features…' });
  const { generateDesignMd } = await import('../../../../features/leadgen/design-md-generator.js');
  const contentJson = prospect?.generation?.contentJson
    ? JSON.parse(prospect.generation.contentJson)
    : {};
  const assetManifest = prospect?.generation?.assetManifest || null;
  const brandGuide = useBrandSystem
    ? (prospect.brandGuide || prospect.userUploads?.brandSystem?.brandGuideV2 || null)
    : null;
  const designRefs = prospect.generation?.designReferences || null;

  // For Design Eval: if toggled off, we strip design eval data from onboard
  const onboardForBrief = { ...(prospect.onboard || {}) };
  if (!useDesignEval) {
    delete onboardForBrief.designEval;
  }

  const rebuiltMd = generateDesignMd({
    prospect,
    onboard:          onboardForBrief,
    content:          contentJson,
    assetManifest,
    brandSystem:      brandGuide,
    designReferences: designRefs,
  });

  // Rebuild the user prompt with the new brief
  const copy = contentJson?.copy || {};
  const ci   = copy.contactInfo || {};
  const contactBlock = [
    ci.phone   ? `Phone: ${ci.phone}`   : null,
    ci.email   ? `Email: ${ci.email}`   : null,
    ci.address ? `Address: ${ci.address}` : null,
  ].filter(Boolean).join('\n');
  userPrompt = `Below is the complete DESIGN.MD creative brief. Follow it precisely.\n\n---\n${rebuiltMd}\n---\n\nCONTACT INFORMATION (copy verbatim):\n${contactBlock || '(see brief)'}\n\nGenerate the complete index.html now. Return only the HTML.`;
  emit({ type: 'progress', stage: 'prompt', label: `Brief rebuilt without ${[!useBrandSystem && 'Brand System', !useDesignEval && 'Design Eval'].filter(Boolean).join(' + ')}` });
}
```

**Important:** This rebuild only happens when toggles are OFF. When both are ON
(the default), it uses the stored `designMd` as-is — zero extra cost.

### 3f: Update metadata logging

Update the metadata object in `logUsage` to track which toggles were active:

```javascript
metadata: {
  visionImages: visionImages.length,
  mockupLoaded: !!mockupImage,
  lazywebVision: refImages.length,
  toggles: { useMockup, useLazywebVision, useBrandSystem, useDesignEval, runComparison: !skipComparison },
  slug,
},
```

---

## CHANGE 4: Existing `skipComparison` backward compatibility

The existing `skipComparison` field in the body already works. The new `runComparison`
toggle maps to it (inverted). Keep both supported:

```javascript
const skipComparison = body?.skipComparison === true || body?.runComparison === false;
```

This means old callers using `skipComparison: true` still work, and the new UI sends
`runComparison: false` when the toggle is OFF.

---

## IMPLEMENTATION RULES

1. **Defaults must match current behavior.** When no toggles are sent (e.g. from
   existing callers or other integrations), the endpoint behaves exactly as it does
   today: mockup ON, Lazyweb OFF, brand system ON, design eval ON, comparison ON.

2. **Toggles are per-prospect, in-memory only.** They don't persist to Firestore.
   They reset to defaults on page reload. This is intentional — they're operator
   overrides for experimentation, not permanent settings.

3. **The toggle row should be compact.** Small checkboxes with short labels, single
   row, muted color. They're power-user controls, not primary UI.

4. **CSS must use the existing design system.** Match the font sizes, colors, and
   spacing used by `leadgen-gen-step-desc` and similar existing classes.

5. **Stop event propagation on toggle interactions.** The card row is clickable
   (expands/selects the prospect). Toggle clicks must NOT bubble up.

6. **Brief rebuild is lazy.** Only triggers when a toggle is OFF AND the stored
   brief was built with that feature. In practice this means the first generation
   (toggles all ON) uses the stored brief. Subsequent runs with toggles OFF
   rebuild on-the-fly.

7. **Follow existing patterns.** The `extraBody` prop pattern, NDJSON streaming,
   emit/progress, and error handling all match existing code exactly.

---

## UI LAYOUT REFERENCE

```
┌─────────────────────────────────────────────────────────────┐
│ 3. Generate Site                                            │
│    Mockup ready — build with Claude                         │
│    View / Edit Prompt                                       │
│                                                             │
│    ☑ Mockup  ☐ Lazyweb  ☑ Brand  ☑ DesignEval  ☑ Readiness │
│                                                             │
│                                         [ ▶ Generate ]      │
└─────────────────────────────────────────────────────────────┘
```

The toggle row sits between the description/prompt-link and the action button.
Labels are intentionally short (5-10 chars) to fit in one row on desktop.
On mobile, they can wrap to two rows — the flex-wrap handles this.

---

## VERIFICATION CHECKLIST

- [ ] Toggle row renders on the Generate Site card with all 5 toggles
- [ ] Lazyweb toggle is OFF by default, all others ON
- [ ] Clicking toggles does NOT expand/collapse the prospect card
- [ ] Toggles persist per-prospect within the session (switching between prospects keeps their individual states)
- [ ] Module panel receives and forwards `extraBody` to the API
- [ ] `generate-site` endpoint with no toggle params behaves identically to before (backward compatible)
- [ ] `useMockup: false` skips mockup loading entirely
- [ ] `useLazywebVision: true` fetches and includes Lazyweb screenshots
- [ ] `useBrandSystem: false` rebuilds brief without Brand System influence
- [ ] `useDesignEval: false` rebuilds brief without Design Eval influence  
- [ ] `runComparison: false` skips AI Readiness comparison
- [ ] Both old `skipComparison: true` and new `runComparison: false` work
- [ ] Usage logging records which toggles were active for cost/quality tracking
- [ ] Brief rebuild only fires when a toggle is OFF (no extra cost on default path)

---

## DATA FLOW AFTER TOGGLES

```
Dashboard Toggle State (per prospect, in-memory)
  │
  ├─→ setModulePanel({ ..., extraBody: toggles })
  │
  ▼
LeadgenModulePanel
  │ fetch(endpoint, { body: { placeId, moduleId, ...extraBody } })
  │
  ▼
POST /api/leadgen/generate-site
  │
  ├─ useMockup=false?        → skip mockup load
  ├─ useLazywebVision=true?  → fetch Lazyweb → base64 → vision array
  ├─ useBrandSystem=false?   → rebuild brief without brandGuide
  ├─ useDesignEval=false?    → rebuild brief without onboard.designEval
  ├─ runComparison=false?    → skip readiness comparison
  │
  ▼
Claude Messages API
  │ receives: [vision images based on toggles] + [brief based on toggles]
  ▼
HTML → Deploy → (optional comparison)
```
