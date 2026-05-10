# LAZYWEB DESIGN REFERENCES — Integration Master Prompt

> Feed this to Claude Code CLI to install the Lazyweb MCP server and wire
> design-reference lookups into the leadgen pipeline.

---

## WHAT IS LAZYWEB

Lazyweb is a design reference library (257k+ real app/website screenshots from 25k+ companies) exposed via an MCP server. It does NOT generate designs — it returns **real screenshots** from production websites that match a search query, filtered by category, company, or platform. We'll use it to give Claude visual evidence of how top sites in each vertical handle specific UI sections, so it generates better homepages.

**MCP Server URL:** `https://www.lazyweb.com/mcp` (streamable HTTP, not stdio)
**Auth:** Bearer token from `https://www.lazyweb.com/api/mcp/install-token` (POST, no login needed)
**Install page:** `https://www.lazyweb.com/mcp-install`

**Available MCP tools (once connected):**
- `lazyweb_search` (alias: `search_screenshots`) — text query + optional `category`, `company`, `platform` filters → matching screenshots
- `lazyweb_compare_image` (alias: `vision_screenshots`) — image URL or base64 → visually similar screenshots
- `lazyweb_find_similar` — from a found screenshot ID → more like it
- `lazyweb_metadata` (alias: `metadata_screenshots`) — get metadata for a screenshot
- `list_filters` — list available categories and filter options

---

## OBJECTIVE

### Phase 1: Install + Manual Testing (this prompt)
1. Install Lazyweb MCP server in the project's Claude Code config
2. Create a standalone test script to validate coverage across all 12 verticals
3. Build a `features/leadgen/design-references.js` module that queries Lazyweb for vertical-matched references
4. Create an API endpoint `app/api/leadgen/fetch-references/route.js` that fetches and stores references for a prospect

### Phase 2: Pipeline Integration (after confirming coverage)
5. Wire references into `generate-site/route.js` as additional vision context
6. Append reference metadata to §9 Operator Notes in DESIGN.MD
7. Add UI controls to the dashboard

**This prompt covers Phase 1 fully and Phase 2 as a design spec. Phase 2 should only be built after testing confirms Lazyweb has adequate coverage for the target verticals.**

---

## STEP 1: INSTALL LAZYWEB MCP SERVER

### Option A: Claude Code MCP config (preferred)

Add to `.claude/mcp.json` (or the project-level MCP config):

```json
{
  "mcpServers": {
    "lazyweb": {
      "type": "url",
      "url": "https://www.lazyweb.com/mcp",
      "headers": {
        "Authorization": "Bearer LAZYWEB_TOKEN_HERE"
      }
    }
  }
}
```

To get a token, POST to `https://www.lazyweb.com/api/mcp/install-token` with body `{"mcpUrl":"https://www.lazyweb.com/mcp"}`. The response includes `{ ok: true, installPrompt: "..." }` which contains the bearer token. Extract the token and set it above.

### Option B: Runtime HTTP calls (for the API routes)

Since our Next.js API routes can't use MCP directly, the `design-references.js` module should call the Lazyweb MCP endpoint via HTTP. The MCP server at `https://www.lazyweb.com/mcp` speaks streamable HTTP — tools can be called with standard MCP JSON-RPC over HTTP POST.

Store the token in `.env.local`:
```
LAZYWEB_TOKEN=lw_xxxxxxxxxxxxx
```

---

## STEP 2: VERTICAL COVERAGE TEST SCRIPT

Create `scripts/test-lazyweb-verticals.js` — a standalone Node script that queries Lazyweb for each vertical and reports how many results come back. This lets us validate coverage before building automation.

```javascript
// scripts/test-lazyweb-verticals.js
// Run: node scripts/test-lazyweb-verticals.js
//
// Tests Lazyweb search coverage across all 12 leadgen verticals.
// Reports result counts so we know which verticals have strong references
// and which might need fallback strategies.

import 'dotenv/config';

const LAZYWEB_MCP_URL = 'https://www.lazyweb.com/mcp';
const TOKEN = process.env.LAZYWEB_TOKEN;
if (!TOKEN) { console.error('Set LAZYWEB_TOKEN in .env.local'); process.exit(1); }

// ── Vertical query map ──────────────────────────────────────────────────────
// Each vertical gets 3 test queries: hero, services section, full homepage
const VERTICAL_QUERIES = {
  lawyer:       ['law firm website homepage', 'attorney services section', 'legal practice hero section'],
  dental:       ['dental clinic website homepage', 'dentist services section', 'dental practice hero'],
  home_services:['plumber contractor website', 'home services homepage', 'HVAC company website hero'],
  restaurant:   ['restaurant website homepage', 'dining menu section', 'restaurant hero section'],
  med_spa:      ['med spa website homepage', 'aesthetics clinic services', 'beauty wellness hero'],
  auto_repair:  ['auto repair shop website', 'mechanic services section', 'automotive homepage'],
  chiropractor: ['chiropractor website homepage', 'wellness clinic services', 'chiropractic hero section'],
  gym_fitness:  ['gym fitness website homepage', 'fitness studio classes section', 'gym hero section'],
  real_estate:  ['real estate agency website', 'property listings section', 'realtor homepage hero'],
  wedding_event:['wedding planner website', 'event planning services section', 'wedding photographer hero'],
  pet_services: ['veterinary clinic website', 'pet grooming services', 'animal hospital homepage'],
  custom:       ['small business website homepage', 'local business services section', 'professional services hero'],
};

// ── MCP tool call via HTTP ──────────────────────────────────────────────────
async function callLazyweb(toolName, args) {
  // MCP JSON-RPC over streamable HTTP
  const res = await fetch(LAZYWEB_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Lazyweb ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.result;
}

// ── Run tests ───────────────────────────────────────────────────────────────
async function main() {
  console.log('Testing Lazyweb coverage across verticals...\n');
  console.log('Vertical          | Query                              | Results');
  console.log('------------------|------------------------------------|--------');

  for (const [vertical, queries] of Object.entries(VERTICAL_QUERIES)) {
    for (const query of queries) {
      try {
        const result = await callLazyweb('lazyweb_search', {
          query,
          platform: 'desktop',
        });

        // Result shape varies — count items in content array
        const content = result?.content || [];
        const textItems = content.filter(c => c.type === 'text');
        const imageItems = content.filter(c => c.type === 'image');
        const count = imageItems.length || textItems.length;

        console.log(`${vertical.padEnd(18)}| ${query.padEnd(37)}| ${count}`);
      } catch (err) {
        console.log(`${vertical.padEnd(18)}| ${query.padEnd(37)}| ERROR: ${err.message.slice(0, 40)}`);
      }

      // Rate limit courtesy
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

main().catch(console.error);
```

**Run this first. If verticals like dental/lawyer return <2 results, we'll need a fallback strategy (e.g., broader queries like "professional services website hero" or using `lazyweb_compare_image` with the prospect's own homepage screenshot).**

---

## STEP 3: DESIGN REFERENCES MODULE

Create `features/leadgen/design-references.js` — the core module that queries Lazyweb and returns structured reference data.

```javascript
// features/leadgen/design-references.js
//
// Fetches design reference screenshots from Lazyweb for a given vertical + section type.
// Returns structured reference data that can be:
//   1. Stored in Firestore (generation.designReferences)
//   2. Appended to §9 Operator Notes in DESIGN.MD
//   3. Sent as vision context to Claude during site generation

// ── VERTICAL SEARCH QUERIES ─────────────────────────────────────────────────
// Maps each vertical to optimized Lazyweb search queries per section type.
// Adjust these based on test script results (Step 2).

const VERTICAL_REFERENCE_QUERIES = {
  lawyer:        { hero: 'law firm website hero section', services: 'legal services grid cards', testimonials: 'attorney client testimonials', cta: 'law firm contact CTA section' },
  dental:        { hero: 'dental clinic website hero', services: 'dentist services section cards', testimonials: 'dental patient reviews section', cta: 'dental appointment booking CTA' },
  home_services: { hero: 'contractor home services hero section', services: 'plumber HVAC services grid', testimonials: 'contractor customer reviews', cta: 'home services get a quote CTA' },
  restaurant:    { hero: 'restaurant website hero food photography', services: 'restaurant menu section', testimonials: 'dining reviews section', cta: 'restaurant reservation CTA' },
  med_spa:       { hero: 'med spa aesthetics hero section', services: 'beauty treatments services grid', testimonials: 'spa client testimonials', cta: 'book consultation CTA' },
  auto_repair:   { hero: 'auto repair mechanic website hero', services: 'automotive services section', testimonials: 'mechanic customer reviews', cta: 'auto repair appointment CTA' },
  chiropractor:  { hero: 'chiropractor wellness hero section', services: 'chiropractic services section', testimonials: 'patient testimonials wellness', cta: 'chiropractic book appointment' },
  gym_fitness:   { hero: 'gym fitness website hero section', services: 'fitness classes membership grid', testimonials: 'gym member testimonials', cta: 'gym free trial CTA section' },
  real_estate:   { hero: 'real estate agency hero section', services: 'property listings grid cards', testimonials: 'realtor client reviews', cta: 'real estate contact agent CTA' },
  wedding_event: { hero: 'wedding planner hero section romantic', services: 'event planning services grid', testimonials: 'wedding couple testimonials', cta: 'event booking inquiry CTA' },
  pet_services:  { hero: 'veterinary clinic hero section', services: 'pet care services grid', testimonials: 'pet owner reviews section', cta: 'vet appointment booking CTA' },
  default:       { hero: 'professional services website hero', services: 'small business services section', testimonials: 'customer testimonials section', cta: 'business contact CTA section' },
};

// Sections to fetch references for (in priority order — stop at MAX_REFERENCES)
const SECTION_PRIORITY = ['hero', 'services', 'testimonials', 'cta'];
const MAX_REFERENCES = 5; // Total images to fetch (2 hero + 1 services + 1 testimonials + 1 cta)
const SECTION_COUNTS = { hero: 2, services: 1, testimonials: 1, cta: 1 };

// ── LAZYWEB MCP HTTP CLIENT ─────────────────────────────────────────────────

async function callLazywebTool(toolName, args) {
  const token = process.env.LAZYWEB_TOKEN;
  if (!token) throw new Error('LAZYWEB_TOKEN not set');

  const res = await fetch('https://www.lazyweb.com/mcp', {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Lazyweb ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.result;
}

// ── PARSE LAZYWEB RESULTS ───────────────────────────────────────────────────

function parseSearchResults(mcpResult) {
  // MCP tool results come as { content: [{type: 'text'|'image', ...}] }
  const content = mcpResult?.content || [];
  const images = [];

  for (const item of content) {
    if (item.type === 'image') {
      images.push({
        data: item.data,          // base64
        mimeType: item.mimeType || 'image/png',
      });
    } else if (item.type === 'text') {
      // Text items may contain URLs or metadata — parse if useful
      // For now we focus on images
    }
  }

  return images;
}

// ── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * Fetch design reference screenshots for a prospect's vertical.
 *
 * @param {Object} options
 * @param {string} options.vertical - Vertical key (e.g. 'dental', 'lawyer')
 * @param {string} [options.prospectScreenshotUrl] - URL of prospect's current homepage (for compare_image)
 * @param {Function} [options.onProgress] - Progress callback (label string)
 * @returns {Object} { references: [{section, query, images: [{data, mimeType}]}], meta: {...} }
 */
export async function fetchDesignReferences({ vertical, prospectScreenshotUrl = null, onProgress = () => {} }) {
  const queries = VERTICAL_REFERENCE_QUERIES[vertical] || VERTICAL_REFERENCE_QUERIES.default;
  const references = [];
  let totalImages = 0;

  for (const section of SECTION_PRIORITY) {
    if (totalImages >= MAX_REFERENCES) break;
    const query = queries[section];
    if (!query) continue;

    const maxForSection = SECTION_COUNTS[section] || 1;
    onProgress(`Searching Lazyweb: "${query}"…`);

    try {
      const result = await callLazywebTool('lazyweb_search', {
        query,
        platform: 'desktop',
      });

      const images = parseSearchResults(result).slice(0, maxForSection);
      if (images.length > 0) {
        references.push({ section, query, images });
        totalImages += images.length;
        onProgress(`Found ${images.length} reference${images.length > 1 ? 's' : ''} for ${section}`);
      } else {
        onProgress(`No references found for ${section} — skipping`);
      }
    } catch (err) {
      onProgress(`⚠ Lazyweb error for ${section}: ${err.message}`);
    }

    // Rate limit courtesy
    await new Promise(r => setTimeout(r, 300));
  }

  // Optional: visual similarity search using prospect's own screenshot
  let similarResults = null;
  if (prospectScreenshotUrl && totalImages < MAX_REFERENCES) {
    onProgress('Finding visually similar sites to current homepage…');
    try {
      const result = await callLazywebTool('lazyweb_compare_image', {
        image_url: prospectScreenshotUrl,
      });
      const images = parseSearchResults(result).slice(0, 2);
      if (images.length > 0) {
        similarResults = { section: 'similar', query: 'visual_match', images };
        references.push(similarResults);
        totalImages += images.length;
        onProgress(`Found ${images.length} visually similar site${images.length > 1 ? 's' : ''}`);
      }
    } catch (err) {
      onProgress(`⚠ Visual similarity search failed: ${err.message}`);
    }
  }

  return {
    references,
    meta: {
      vertical,
      totalImages,
      sectionsSearched: references.map(r => r.section),
      fetchedAt: new Date().toISOString(),
    },
  };
}

/**
 * Format references for injection into DESIGN.MD §9 Operator Notes.
 * Returns a markdown string describing the reference sources.
 * (The actual images are sent as vision context in generate-site, not embedded in markdown.)
 */
export function formatReferencesForBrief(references) {
  if (!references?.length) return '';

  const lines = ['**Design References (from Lazyweb):**'];
  for (const ref of references) {
    const count = ref.images?.length || 0;
    lines.push(`- **${ref.section}:** ${count} reference${count > 1 ? 's' : ''} from query "${ref.query}"`);
  }
  lines.push('_Reference screenshots will be provided as visual context during site generation._');
  return lines.join('\n');
}
```

### Key design decisions:

1. **HTTP, not MCP protocol** — API routes can't use MCP SDK, so we call the Lazyweb MCP endpoint via plain HTTP with JSON-RPC.
2. **Section-based queries** — fetch references per section type (hero, services, testimonials, CTA) so Claude gets targeted inspiration for each.
3. **5 images max** — keeps the Claude API vision context manageable and cost-controlled.
4. **Visual similarity fallback** — if the prospect has a homepage screenshot (from Multi-Device View), we can find "sites that look like theirs" for competitive context.
5. **Graceful degradation** — if Lazyweb is down or returns nothing, the pipeline continues without references. Zero hard dependencies.

---

## STEP 4: API ENDPOINT

Create `app/api/leadgen/fetch-references/route.js`:

```javascript
// POST /api/leadgen/fetch-references
//   body: { placeId: string }
//   → streams NDJSON: Lazyweb search per section → store results
//
// Fetches design reference screenshots from Lazyweb for the prospect's vertical.
// Stores reference metadata in Firestore at generation.designReferences.
// Reference images are stored as base64 for later injection as Claude vision context.

import { createRequire } from 'module';
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

import { fetchDesignReferences, formatReferencesForBrief } from '../../../../features/leadgen/design-references.js';

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}

export async function POST(request) {
  try { await verifyRequestUser(makeReqShim(request)); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Unauthorized.' }) + '\n', { status: 401, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  let body;
  try { body = await request.json().catch(() => ({})); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  const placeId = String(body?.placeId || '').trim();
  if (!placeId) return new Response(JSON.stringify({ type: 'error', message: 'Provide placeId.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } });

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) return new Response(JSON.stringify({ type: 'error', message: `Prospect not found: ${placeId}` }) + '\n', { status: 404, headers: { 'Content-Type': 'application/x-ndjson' } });

  const prospect = snap.data();
  const vertical = prospect.vertical || 'default';

  // Get prospect screenshot URL for visual similarity search (if available)
  const prospectScreenshotUrl = prospect.onboard?.multiDeviceView?.desktopUrl || null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      emit({ type: 'start', vertical });

      try {
        const { references, meta } = await fetchDesignReferences({
          vertical,
          prospectScreenshotUrl,
          onProgress: (label) => emit({ type: 'progress', stage: 'references', label }),
        });

        emit({ type: 'progress', stage: 'persist', label: `Saving ${meta.totalImages} references…` });

        // Store metadata (not full base64) in Firestore — images are too large.
        // Store a summary for the brief, and keep the image data in memory for generate-site.
        const refSummary = references.map(r => ({
          section: r.section,
          query: r.query,
          imageCount: r.images?.length || 0,
        }));

        const briefNote = formatReferencesForBrief(references);

        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          'generation.designReferences': {
            summary: refSummary,
            briefNote,
            meta,
          },
        });

        // NOTE: The actual base64 image data is NOT stored in Firestore (too large).
        // generate-site should call fetchDesignReferences() at generation time to get
        // fresh images, OR we store them in Firebase Storage. For now, re-fetch at gen time.

        emit({ type: 'progress', stage: 'persist', label: 'References saved.' });

        emit({
          type: 'done',
          status: 'succeeded',
          result: {
            totalImages: meta.totalImages,
            sections: meta.sectionsSearched,
            briefNote,
          },
        });

      } catch (err) {
        console.error('[fetch-references] error:', err);
        emit({ type: 'error', message: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
```

---

## PHASE 2 SPEC: PIPELINE INTEGRATION (build after testing)

### 2A: Wire into generate-site/route.js

In `app/api/leadgen/generate-site/route.js`, modify the vision context block (currently lines 209-230) to include design references alongside the mockup:

```javascript
// ── Step 2: Load mockup + design references (vision context) ──────────
let messageContent = userPrompt;
const mockupUrl    = prospect?.generation?.mockupUrl;
const visionImages = []; // array of { type: 'image', source: { type: 'base64', ... } }

// Load mockup image
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
    }
  } catch { /* mockup load failed — continue without */ }
}

// Load design references from Lazyweb (if LAZYWEB_TOKEN is set)
if (process.env.LAZYWEB_TOKEN) {
  try {
    emit({ type: 'progress', stage: 'generate', label: 'Fetching design references from Lazyweb…' });
    const { references } = await fetchDesignReferences({
      vertical: prospect.vertical || 'default',
      onProgress: (label) => emit({ type: 'progress', stage: 'references', label }),
    });

    for (const ref of references) {
      for (const img of (ref.images || [])) {
        visionImages.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.data },
        });
      }
    }

    if (references.length > 0) {
      const refCount = references.reduce((s, r) => s + (r.images?.length || 0), 0);
      emit({ type: 'progress', stage: 'references', label: `Loaded ${refCount} design references across ${references.length} sections` });
    }
  } catch (err) {
    emit({ type: 'progress', stage: 'references', label: `⚠ Design references skipped: ${err.message}` });
  }
}

// Build message content
if (visionImages.length > 0) {
  const imageLabels = [];
  if (mockupUrl) imageLabels.push('the visual mockup target');
  if (visionImages.length > 1) imageLabels.push(`${visionImages.length - (mockupUrl ? 1 : 0)} real-world design references for this vertical`);

  messageContent = [
    ...visionImages,
    {
      type: 'text',
      text: `The images above include ${imageLabels.join(' and ')} — match the mockup's layout and color scheme, and draw section-level design inspiration from the reference screenshots.\n\n${userPrompt}`,
    },
  ];
} else {
  emit({ type: 'progress', stage: 'generate', label: `Calling ${MODEL} — generating homepage (no vision context)…` });
}
```

### 2B: Wire into DESIGN.MD §9

In `features/leadgen/design-md-generator.js`, update the `buildOperatorNotes()` function to include reference metadata if available:

```javascript
// At the end of buildOperatorNotes(), before the return:
function buildOperatorNotes(bs, designReferences = null) {
  // ... existing Brand System code ...

  // Append design reference note if available
  if (designReferences?.briefNote) {
    lines.push(`\n${designReferences.briefNote}`);
  }

  return lines.join('\n\n') || '_No brand intelligence available._';
}
```

Update `generateDesignMd` signature to accept `designReferences`:
```javascript
export function generateDesignMd({ prospect, onboard = {}, content = {}, assetManifest = null, brandSystem = null, designReferences = null }) {
  // ... existing code ...
  // In §9:
  ${buildOperatorNotes(brandSystem, designReferences)}
}
```

Update `prepare-brief/route.js` to pass through:
```javascript
const designRefs = prospect.generation?.designReferences || null;
const designMd = generateDesignMd({
  prospect,
  onboard:          prospect.onboard || {},
  content,
  assetManifest,
  brandSystem:      brandGuide,
  designReferences: designRefs,
});
```

### 2C: Dashboard UI (optional module card)

Add to `LEADGEN_MODULE_REGISTRY` in `components/dashboard/LeadGenDashboard.jsx`:

```javascript
{
  id: 'design-references',
  label: 'Design References',
  description: 'Lazyweb · vertical-matched references',
  Icon: ImageIcon,       // from lucide-react
  type: 'analysis',
  storeKey: 'designReferences',
  // Only show if LAZYWEB_TOKEN is configured
},
```

Add the corresponding API mapping in the module runner that routes `design-references` → `POST /api/leadgen/fetch-references`.

---

## IMPLEMENTATION RULES

1. **Phase 1 only.** Do NOT modify `generate-site/route.js` or the dashboard yet. Only create the test script, the module, and the standalone API endpoint.

2. **Zero hard dependencies.** If `LAZYWEB_TOKEN` is not set, `fetchDesignReferences` should throw a clear error. The rest of the pipeline must work without Lazyweb.

3. **Follow existing patterns.** The NDJSON streaming pattern, `makeReqShim()`, `verifyRequestUser()`, and emit pattern all match the existing routes (`prepare-brief`, `generate-mockup`, `generate-site`). Don't introduce new patterns.

4. **Rate limiting.** Add 300ms delay between Lazyweb API calls. We don't know their rate limits yet.

5. **Image data handling.** Lazyweb MCP returns images as base64 in the tool result content. Parse them from the `content[]` array items with `type: 'image'`. Don't assume the response shape — log it if unexpected and handle gracefully.

6. **MCP JSON-RPC format.** The Lazyweb MCP server uses standard MCP JSON-RPC. Tool calls use `method: 'tools/call'` with `params: { name, arguments }`. Responses have `result.content[]`. If the server uses SSE or streaming responses instead of single JSON, adapt the fetch call accordingly.

---

## VERIFICATION CHECKLIST

### Phase 1
- [ ] `LAZYWEB_TOKEN` is set in `.env.local`
- [ ] `scripts/test-lazyweb-verticals.js` runs and reports results for all 12 verticals
- [ ] Coverage report shows which verticals have adequate references (≥2 images per hero query)
- [ ] `features/leadgen/design-references.js` exports `fetchDesignReferences()` and `formatReferencesForBrief()`
- [ ] `POST /api/leadgen/fetch-references` works end-to-end (streams NDJSON, stores metadata in Firestore)
- [ ] When `LAZYWEB_TOKEN` is not set, the module throws a clear error and nothing else breaks

### Phase 2 (after coverage confirmed)
- [ ] `generate-site/route.js` sends reference images as additional vision context when available
- [ ] DESIGN.MD §9 includes reference metadata when `generation.designReferences` exists
- [ ] Dashboard shows Design References module card with streaming terminal
- [ ] Pipeline works identically when Lazyweb is disabled (no LAZYWEB_TOKEN)

---

## EXPECTED DIRECTORY STRUCTURE AFTER PHASE 1

```
features/leadgen/
  design-references.js          ← NEW: Lazyweb query + parse module
  design-md-generator.js        ← (Phase 2: add designReferences param)
  content-scraper.js            ← unchanged
  asset-manager.js              ← unchanged

app/api/leadgen/
  fetch-references/route.js     ← NEW: NDJSON streaming endpoint
  prepare-brief/route.js        ← (Phase 2: pass designReferences)
  generate-site/route.js        ← (Phase 2: inject vision context)

scripts/
  test-lazyweb-verticals.js     ← NEW: coverage test script

.env.local
  LAZYWEB_TOKEN=lw_xxx          ← NEW env var
```
