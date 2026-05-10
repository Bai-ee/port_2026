// features/leadgen/design-references.js
//
// Fetches design reference screenshots from Lazyweb for a given vertical + section type.
// Returns structured reference data suitable for:
//   1. Storage in Firestore (generation.designReferences)
//   2. Appendix in §9 Operator Notes of DESIGN.MD
//   3. Vision context injected into Claude during site generation (Phase 2)

// ── VERTICAL SEARCH QUERIES ─────────────────────────────────────────────────

const VERTICAL_REFERENCE_QUERIES = {
  lawyer:        { hero: 'law firm website hero section',          services: 'legal services grid cards',            testimonials: 'attorney client testimonials',       cta: 'law firm contact CTA section' },
  dental:        { hero: 'dental clinic website hero',             services: 'dentist services section cards',       testimonials: 'dental patient reviews section',     cta: 'dental appointment booking CTA' },
  home_services: { hero: 'contractor home services hero section',  services: 'plumber HVAC services grid',           testimonials: 'contractor customer reviews',        cta: 'home services get a quote CTA' },
  restaurant:    { hero: 'restaurant website hero food photography',services: 'restaurant menu section',             testimonials: 'dining reviews section',             cta: 'restaurant reservation CTA' },
  med_spa:       { hero: 'med spa aesthetics hero section',        services: 'beauty treatments services grid',      testimonials: 'spa client testimonials',            cta: 'book consultation CTA' },
  auto_repair:   { hero: 'auto repair mechanic website hero',      services: 'automotive services section',         testimonials: 'mechanic customer reviews',          cta: 'auto repair appointment CTA' },
  chiropractor:  { hero: 'chiropractor wellness hero section',     services: 'chiropractic services section',       testimonials: 'patient testimonials wellness',      cta: 'chiropractic book appointment' },
  gym_fitness:   { hero: 'gym fitness website hero section',       services: 'fitness classes membership grid',     testimonials: 'gym member testimonials',            cta: 'gym free trial CTA section' },
  real_estate:   { hero: 'real estate agency hero section',        services: 'property listings grid cards',        testimonials: 'realtor client reviews',             cta: 'real estate contact agent CTA' },
  wedding_event: { hero: 'wedding planner hero section romantic',  services: 'event planning services grid',        testimonials: 'wedding couple testimonials',        cta: 'event booking inquiry CTA' },
  pet_services:  { hero: 'veterinary clinic hero section',         services: 'pet care services grid',              testimonials: 'pet owner reviews section',          cta: 'vet appointment booking CTA' },
  default:       { hero: 'professional services website hero',     services: 'small business services section',     testimonials: 'customer testimonials section',      cta: 'business contact CTA section' },
};

const SECTION_PRIORITY = ['hero', 'services', 'testimonials', 'cta'];
const MAX_REFERENCES = 5;
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
      'Accept': 'application/json, text/event-stream',
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

  // Handle SSE / streamable HTTP responses
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.startsWith('data:'));
    const last = lines[lines.length - 1]?.replace(/^data:\s*/, '');
    if (!last) throw new Error('Empty SSE response from Lazyweb');
    return JSON.parse(last).result;
  }

  const data = await res.json();
  return data.result;
}

// ── PARSE MCP RESULT ────────────────────────────────────────────────────────
// Lazyweb returns results as a text item containing JSON.
// Each result has an imageUrl (signed URL), not base64 data.

function parseImageUrls(mcpResult) {
  const content = mcpResult?.content || [];
  const urls = [];

  for (const item of content) {
    if (item.type === 'image' && item.data) {
      // Direct base64 image (future-proof)
      urls.push({ url: null, data: item.data, mimeType: item.mimeType || 'image/png' });
    } else if (item.type === 'text') {
      try {
        const parsed = JSON.parse(item.text);
        const results = parsed?.results || (parsed?.ok === false ? [] : [parsed]);
        for (const r of results) {
          if (r.imageUrl) urls.push({ url: r.imageUrl, mimeType: 'image/png', meta: { company: r.companyName, category: r.category, description: r.visionDescription } });
        }
      } catch {}
    }
  }

  return urls;
}

// ── MAIN EXPORT ─────────────────────────────────────────────────────────────

/**
 * Fetch design reference screenshots for a prospect's vertical.
 *
 * @param {Object} options
 * @param {string} options.vertical - Vertical key (e.g. 'dental', 'lawyer')
 * @param {string} [options.prospectScreenshotUrl] - Prospect's current homepage URL for visual-similarity fallback
 * @param {Function} [options.onProgress] - Progress callback (receives a label string)
 * @returns {{ references: Array, meta: Object }}
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
      const result = await callLazywebTool('lazyweb_search', { query, platform: 'desktop' });
      const images = parseImageUrls(result).slice(0, maxForSection);

      if (images.length > 0) {
        references.push({ section, query, images });
        totalImages += images.length;
        onProgress(`Found ${images.length} reference${images.length > 1 ? 's' : ''} for ${section}`);
      } else {
        onProgress(`No image references for ${section} — skipping`);
      }
    } catch (err) {
      onProgress(`Lazyweb error for ${section}: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  // Visual similarity fallback using prospect's own screenshot
  if (prospectScreenshotUrl && totalImages < MAX_REFERENCES) {
    onProgress('Finding visually similar sites to current homepage…');
    try {
      const result = await callLazywebTool('lazyweb_compare_image', { image_url: prospectScreenshotUrl });
      const images = parseImageUrls(result).slice(0, 2);
      if (images.length > 0) {
        references.push({ section: 'similar', query: 'visual_match', images });
        totalImages += images.length;
        onProgress(`Found ${images.length} visually similar site${images.length > 1 ? 's' : ''}`);
      }
    } catch (err) {
      onProgress(`Visual similarity search failed: ${err.message}`);
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
 * Returns markdown text only — images are delivered as vision context, not embedded.
 */
export function formatReferencesForBrief(references) {
  if (!references?.length) return '';

  const lines = ['**Design References (from Lazyweb):**'];
  for (const ref of references) {
    const count = ref.images?.length || 0;
    lines.push(`- **${ref.section}:** ${count} reference${count !== 1 ? 's' : ''} — query: "${ref.query}"`);
  }
  lines.push('_Reference screenshots are provided as visual context during site generation._');
  return lines.join('\n');
}

/**
 * Format reference visionDescriptions for injection into the mockup image prompt.
 * Produces plain text for gpt-image-2, not markdown.
 *
 * @param {Array} refSummary - summary array from generation.designReferences.summary
 * @returns {string} Text block for prompt injection, or empty string if no descriptions
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
