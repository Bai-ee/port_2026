'use strict';

// design-system-extractor.js — CSS-aware design system extraction
//
// Plugs into the existing scout-intake pipeline between site-fetcher and intake-synthesizer.
// Extracts raw CSS evidence from fetched HTML, then uses a Sonnet LLM call to
// produce structured design tokens: typography, colors, layout, motion.
//
// Flow:
//   1. extractCssEvidence(html)       — regex extraction of inline styles, CSS vars, stylesheet URLs
//   2. fetchExternalStylesheets(urls)  — fetches linked .css files (reuses site-fetcher timeout pattern)
//   3. synthesizeDesignSystem(cssText) — Sonnet LLM call with structured tool_use schema
//
// The output is a DesignSystem object that gets merged into the intake result
// via normalize.js and displayed in the dashboard.
//
// Model: claude-sonnet-4-20250514 (better reasoning for CSS analysis)
// Typical cost per run: ~$0.01–$0.03

const DESIGN_SYSTEM_MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const FETCH_TIMEOUT_MS = 6000;
const MAX_CSS_CHARS = 60000; // cap total CSS to avoid token blowout
const MAX_EXTERNAL_SHEETS = 4;

// ── Anthropic client (shared pattern with intake-synthesizer.js) ─────────────

function getApiKey() {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    (() => {
      try { require('dotenv/config'); } catch { /* ignore */ }
      return process.env.ANTHROPIC_API_KEY;
    })();

  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
  return key;
}

async function callAnthropic(params) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// ── CSS Evidence Extraction (regex-only, no parser dependency) ───────────────

/**
 * Extract CSS-relevant content from raw HTML:
 * - Inline <style> blocks
 * - CSS custom properties (--var declarations)
 * - External stylesheet URLs (<link rel="stylesheet">)
 * - Inline style= attributes on key elements (body, h1-h6, nav, main)
 */
function extractCssEvidence(html) {
  const evidence = {
    inlineStyles: [],
    externalSheetUrls: [],
    cssVariables: [],
    keyElementStyles: [],
  };

  // 1. Inline <style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const content = m[1].trim();
    if (content.length > 10) evidence.inlineStyles.push(content);
  }

  // 2. External stylesheet URLs
  const linkRe = /<link[^>]*rel\s*=\s*['"]stylesheet['"][^>]*href\s*=\s*['"]([^'"]+)['"]/gi;
  const linkReAlt = /<link[^>]*href\s*=\s*['"]([^'"]+)['"][^>]*rel\s*=\s*['"]stylesheet['"]/gi;
  for (const re of [linkRe, linkReAlt]) {
    while ((m = re.exec(html)) !== null) {
      const href = m[1].trim();
      // Skip data URIs, inline, and CDN icon fonts
      if (!href.startsWith('data:') && !href.includes('font-awesome') && !href.includes('icon')) {
        evidence.externalSheetUrls.push(href);
      }
    }
  }
  evidence.externalSheetUrls = [...new Set(evidence.externalSheetUrls)].slice(0, MAX_EXTERNAL_SHEETS);

  // 3. CSS custom properties from all collected CSS
  const allInline = evidence.inlineStyles.join('\n');
  const varRe = /(--[\w-]+)\s*:\s*([^;}{]+);/g;
  while ((m = varRe.exec(allInline)) !== null) {
    evidence.cssVariables.push({ name: m[1].trim(), value: m[2].trim() });
  }

  // 4. Inline style= on structural elements
  const inlineStyleRe = /<(body|main|header|nav|footer|section|h[1-6]|p|a|button)[^>]*style\s*=\s*['"]([^'"]+)['"]/gi;
  while ((m = inlineStyleRe.exec(html)) !== null) {
    evidence.keyElementStyles.push({ element: m[1].toLowerCase(), style: m[2].trim() });
  }

  return evidence;
}

// ── External stylesheet fetcher ──────────────────────────────────────────────

async function fetchStylesheet(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrandintelBot/1.0)',
        Accept: 'text/css,*/*;q=0.1',
      },
    });
    if (!res.ok) {
      clearTimeout(timer);
      return null;
    }
    const text = await res.text();
    clearTimeout(timer);
    return text.slice(0, 30000); // cap individual sheet
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Resolve and fetch external stylesheets discovered in the HTML.
 * Returns concatenated CSS text.
 */
async function fetchExternalStylesheets(urls, baseUrl) {
  if (!urls.length) return '';

  const resolved = urls.map((href) => {
    try { return new URL(href, baseUrl).toString(); } catch { return null; }
  }).filter(Boolean);

  const results = await Promise.allSettled(
    resolved.map((url) => fetchStylesheet(url))
  );

  return results
    .filter((r) => r.status === 'fulfilled' && r.value)
    .map((r) => r.value)
    .join('\n\n/* --- sheet boundary --- */\n\n');
}

// ── CSS text builder ─────────────────────────────────────────────────────────

/**
 * Combine all CSS sources into a single text block for LLM analysis.
 * Strips comments and collapses whitespace to save tokens.
 */
function buildCssText(cssEvidence, externalCss) {
  const parts = [];

  if (cssEvidence.inlineStyles.length) {
    parts.push('/* === INLINE STYLES === */');
    parts.push(cssEvidence.inlineStyles.join('\n\n'));
  }

  if (externalCss) {
    parts.push('/* === EXTERNAL STYLESHEETS === */');
    parts.push(externalCss);
  }

  if (cssEvidence.cssVariables.length) {
    parts.push('/* === CSS CUSTOM PROPERTIES === */');
    parts.push(cssEvidence.cssVariables.map((v) => `${v.name}: ${v.value};`).join('\n'));
  }

  if (cssEvidence.keyElementStyles.length) {
    parts.push('/* === INLINE ELEMENT STYLES === */');
    parts.push(cssEvidence.keyElementStyles.map((s) => `${s.element} { ${s.style} }`).join('\n'));
  }

  let combined = parts.join('\n\n');

  // Strip CSS comments to save tokens
  combined = combined.replace(/\/\*[\s\S]*?\*\//g, '');
  // Collapse whitespace
  combined = combined.replace(/\n{3,}/g, '\n\n').trim();

  // Hard cap
  if (combined.length > MAX_CSS_CHARS) {
    combined = combined.slice(0, MAX_CSS_CHARS) + '\n/* ... truncated ... */';
  }

  return combined;
}

// ── Deterministic heading-font detector ──────────────────────────────────────

/**
 * Scan raw CSS text and find the first font-family declaration that targets a
 * heading selector. Priority order:
 *   1. `h1` (alone or in a selector list that includes h1)
 *   2. `h1, h2, …` headings group
 *   3. `.h1` / `[role="heading"][aria-level="1"]`
 *   4. `h2`
 * Returns the first font name (stripped of quotes and fallback list) or null.
 *
 * Ignores @keyframes, @font-face, @media rules for the selector match but still
 * reads `font-family:` declarations inside @media blocks.
 */
function extractHeadingFontFamily(cssText) {
  if (!cssText || typeof cssText !== 'string') return null;

  const firstFamilyOf = (declList) => {
    const match = /font-family\s*:\s*([^;{}]+)/i.exec(declList);
    if (!match) return null;
    const raw = match[1].trim();
    // Split on commas, take the first entry, strip quotes.
    const first = raw.split(',')[0].trim().replace(/^["']|["']$/g, '').trim();
    // Reject obvious system stacks or vars.
    if (!first || /^var\(/i.test(first)) return null;
    if (/^(inherit|initial|unset|revert|sans-serif|serif|monospace|system-ui)$/i.test(first)) return null;
    return first;
  };

  // Match rules of the form: selector { declarations }
  // Non-greedy body match; skip @-rule blocks heuristically.
  const ruleRe = /([^{}@]+)\{([^{}]*)\}/g;
  const candidates = { h1Only: null, h1Group: null, h1Class: null, h2: null };
  let m;
  while ((m = ruleRe.exec(cssText)) !== null) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    const body = m[2];
    if (!selector || !body || !/font-family\s*:/i.test(body)) continue;

    const selectors = selector.split(',').map((s) => s.trim()).filter(Boolean);
    const touchesH1   = selectors.some((s) => /(^|[^a-z0-9_-])h1([^a-z0-9_-]|$)/i.test(s));
    const isH1Only    = selectors.length === 1 && /^h1$/i.test(selectors[0]);
    const isH1Class   = selectors.some((s) => /^\.h1$/i.test(s) || /\[aria-level="1"\]/i.test(s));
    const touchesH2   = selectors.some((s) => /(^|[^a-z0-9_-])h2([^a-z0-9_-]|$)/i.test(s));

    if (isH1Only && !candidates.h1Only)   candidates.h1Only  = firstFamilyOf(body);
    if (touchesH1 && !candidates.h1Group) candidates.h1Group = firstFamilyOf(body);
    if (isH1Class && !candidates.h1Class) candidates.h1Class = firstFamilyOf(body);
    if (touchesH2 && !candidates.h2)      candidates.h2      = firstFamilyOf(body);

    if (candidates.h1Only) break;
  }

  return candidates.h1Only || candidates.h1Group || candidates.h1Class || candidates.h2 || null;
}

// ── Tool schema for design system extraction ─────────────────────────────────

const DESIGN_SYSTEM_TOOL = {
  name: 'write_design_system',
  description: 'Extract a structured design system from the provided CSS evidence.',
  input_schema: {
    type: 'object',
    required: ['typography', 'colors', 'layout', 'motion'],
    properties: {

      // ── Typography ───────────────────────────────────────────────────────
      typography: {
        type: 'object',
        required: ['fontFamilies', 'headingSystem', 'bodySystem'],
        properties: {
          fontFamilies: {
            type: 'array',
            description: 'All font families declared or used. Include Google Fonts, system stacks, and fallbacks.',
            items: {
              type: 'object',
              required: ['family', 'role'],
              properties: {
                family: { type: 'string', description: 'Font family name exactly as declared (e.g. "Inter", "Playfair Display", "system-ui").' },
                role: { type: 'string', enum: ['heading', 'body', 'ui', 'accent', 'mono', 'unknown'], description: 'What role this font plays in the system.' },
                source: { type: 'string', enum: ['google-fonts', 'adobe-fonts', 'self-hosted', 'system', 'unknown'], description: 'Where the font is loaded from.' },
              },
            },
          },
          headingSystem: {
            type: 'object',
            required: ['fontFamily'],
            description: 'Typography specs for the heading system (h1-h6 or equivalent).',
            properties: {
              fontFamily: { type: 'string' },
              fontSize: { type: 'string', description: 'Base heading size or range (e.g. "20px", "clamp(1.5rem, 4vw, 3rem)").' },
              fontWeight: { type: 'string', description: 'Weight value or name (e.g. "300", "bold", "700").' },
              lineHeight: { type: 'string', description: 'Line height (e.g. "1.4", "28px").' },
              letterSpacing: { type: 'string', description: 'Letter spacing (e.g. "-0.025em", "0.5px"). "normal" if not set.' },
            },
          },
          bodySystem: {
            type: 'object',
            required: ['fontFamily'],
            description: 'Typography specs for body/paragraph text.',
            properties: {
              fontFamily: { type: 'string' },
              fontSize: { type: 'string', description: 'Base body size (e.g. "16px", "1rem", "10px").' },
              fontWeight: { type: 'string' },
              lineHeight: { type: 'string' },
              letterSpacing: { type: 'string' },
            },
          },
          scale: {
            type: 'string',
            description: 'Type scale system if detectable (e.g. "modular 1.25", "custom", "tailwind default"). "custom" if unclear.',
          },
        },
      },

      // ── Colors ───────────────────────────────────────────────────────────
      colors: {
        type: 'object',
        required: ['primary', 'secondary', 'neutral'],
        properties: {
          primary: {
            type: 'object',
            required: ['hex', 'role'],
            description: 'The dominant brand color.',
            properties: {
              hex: { type: 'string', description: 'Hex value (e.g. "#C3CEB5").' },
              role: { type: 'string', description: 'How this color is used (e.g. "brand accent", "primary backgrounds", "CTA fill").' },
              shades: {
                type: 'array',
                description: 'Shade scale from lightest to darkest if available (50-950 or similar). List hex values only.',
                items: { type: 'string' },
              },
            },
          },
          secondary: {
            type: 'object',
            required: ['hex', 'role'],
            properties: {
              hex: { type: 'string' },
              role: { type: 'string' },
              shades: { type: 'array', items: { type: 'string' } },
            },
          },
          tertiary: {
            type: 'object',
            description: 'Third brand color if present. Omit if only two colors are used.',
            properties: {
              hex: { type: 'string' },
              role: { type: 'string' },
              shades: { type: 'array', items: { type: 'string' } },
            },
          },
          neutral: {
            type: 'object',
            required: ['hex'],
            description: 'The primary neutral / background color.',
            properties: {
              hex: { type: 'string', description: 'Base neutral hex (e.g. "#050505", "#FFFFFF", "#F5F5F5").' },
              role: { type: 'string' },
              shades: { type: 'array', items: { type: 'string' } },
            },
          },
          semantic: {
            type: 'object',
            description: 'Semantic colors if defined (success, warning, error, info).',
            properties: {
              success: { type: 'string' },
              warning: { type: 'string' },
              error: { type: 'string' },
              info: { type: 'string' },
            },
          },
          mode: {
            type: 'string',
            enum: ['light', 'dark', 'both', 'unknown'],
            description: 'Whether the site uses light mode, dark mode, both, or unclear.',
          },
        },
      },

      // ── Layout / Visual DNA ──────────────────────────────────────────────
      layout: {
        type: 'object',
        required: ['layoutType', 'contentWidth', 'framing', 'grid'],
        properties: {
          layoutType: {
            type: 'string',
            enum: ['flex', 'grid', 'float', 'mixed', 'unknown'],
            description: 'Primary CSS layout method.',
          },
          contentWidth: {
            type: 'string',
            enum: ['full-bleed', 'contained', 'narrow', 'mixed'],
            description: 'How content width is handled. "full-bleed" = edge-to-edge, "contained" = max-width container, "narrow" = tight reading width.',
          },
          maxWidth: {
            type: 'string',
            description: 'The max-width value if a container is used (e.g. "1200px", "80rem"). "none" if full-bleed.',
          },
          framing: {
            type: 'string',
            enum: ['open', 'boxed', 'card-based', 'sectioned', 'mixed'],
            description: '"open" = minimal containers/borders, "boxed" = visible boundaries, "card-based" = card UI pattern, "sectioned" = alternating full-width bands.',
          },
          grid: {
            type: 'string',
            enum: ['minimal', '12-column', 'auto-fit', 'masonry', 'custom', 'none'],
            description: 'Grid system detected.',
          },
          spacing: {
            type: 'object',
            description: 'Spacing system if detectable.',
            properties: {
              unit: { type: 'string', description: 'Base spacing unit (e.g. "8px", "0.5rem", "4px").' },
              scale: { type: 'string', description: 'Scale pattern (e.g. "4-8-16-24-32-48", "tailwind default", "custom").' },
            },
          },
          borderRadius: {
            type: 'string',
            description: 'Dominant border-radius value (e.g. "0", "4px", "8px", "9999px" for pills). "mixed" if inconsistent.',
          },
        },
      },

      // ── Motion ───────────────────────────────────────────────────────────
      motion: {
        type: 'object',
        required: ['level'],
        properties: {
          level: {
            type: 'string',
            enum: ['none', 'minimal', 'moderate', 'heavy'],
            description: '"none" = no transitions/animations. "minimal" = hover states + subtle transitions only. "moderate" = scroll animations, page transitions. "heavy" = complex choreography, parallax, 3D.',
          },
          durations: {
            type: 'array',
            description: 'Distinct transition/animation duration values found (e.g. ["200ms", "400ms", "2000ms"]).',
            items: { type: 'string' },
          },
          easings: {
            type: 'array',
            description: 'Easing functions found (e.g. ["ease", "ease-in-out", "cubic-bezier(0.4, 0, 0.2, 1)"]).',
            items: { type: 'string' },
          },
          scrollPatterns: {
            type: 'array',
            description: 'Scroll-linked animation libraries or patterns detected (e.g. ["GSAP ScrollTrigger", "Intersection Observer", "AOS", "Lenis"]). Empty if none.',
            items: { type: 'string' },
          },
          prefersReducedMotion: {
            type: 'boolean',
            description: 'Whether the CSS includes @media (prefers-reduced-motion) handling.',
          },
        },
      },

      // ── Confidence ───────────────────────────────────────────────────────
      confidence: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: '"high" = rich CSS with clear design tokens. "medium" = partial CSS, some inference needed. "low" = minimal CSS, mostly guesswork (JS-rendered or utility-only).',
      },
      notes: {
        type: 'string',
        description: 'Brief note on CSS quality, framework detection (Tailwind, Bootstrap, etc.), or extraction limitations.',
      },
    },
  },
};

// ── Master prompt ────────────────────────────────────────────────────────────

function buildDesignSystemPrompt(cssText, siteUrl, { headingFontHint = null } = {}) {
  const headingHintBlock = headingFontHint
    ? `\nAUTHORITATIVE HEADING-FONT HINT — extracted deterministically from the raw CSS's h1 rules:\n  headingSystem.fontFamily MUST be "${headingFontHint}" unless you can point to a more specific h1 selector in the CSS below that proves otherwise. Do not use a .menu-button, .nav-link, or utility-class font as the heading font.\n`
    : '';
  return `You are a senior design systems engineer performing a CSS audit.${headingHintBlock}

Your job: analyze the raw CSS below and call write_design_system with a complete, structured design system extraction.

RULES — READ CAREFULLY:

TYPOGRAPHY
- The HEADING font is whatever is declared on the h1 selector (or h1, h2 group, or [role="heading"][aria-level="1"]). If the AUTHORITATIVE HEADING-FONT HINT above is provided, that font wins — do not substitute a button/menu/nav font.
- Identify every font-family declaration. Determine role (heading vs body vs ui vs accent vs mono) from context: selectors, weights, sizes.
- For heading and body systems, extract the EXACT values from CSS — do not infer or round. Include font-family, font-size, font-weight, line-height, letter-spacing.
- If values use clamp(), calc(), or CSS vars, preserve the full expression.
- Check @font-face, Google Fonts imports, and Adobe Fonts imports to determine source.
- If the same font is used for headings and body, still report it in both systems with their different size/weight specs.

COLORS
- Extract actual hex/rgb/hsl values — do not describe colors with words.
- Primary = the most prominent BRAND color (used in CTAs, accents, links, key UI elements). This is NEVER white, near-white, black, near-black, or any gray. It must be a saturated, intentional color that distinguishes the brand. If the site has no saturated brand color at all, report the most prominent non-neutral color you can find.
- Secondary = the second most used intentional color (not neutral/gray).
- Tertiary = third brand color if one exists. Omit if not present.
- Neutral = the dominant background/text color axis. White, cream, off-white, black, dark gray belong HERE — never in primary.
- Check CSS custom properties (--color-*, --brand-*, --bg-*, --text-*) first — these are the most reliable source.
- ANTI-RULE: if you are about to set primary.hex to #FFFFFF, #000000, #333333, #F5F5F5, or any color with saturation < 10%, STOP — that belongs in neutral, not primary. Find a real brand color.
- If a shade scale exists (50-950 or light-to-dark variants), capture the full scale as hex values.
- Convert rgb()/hsl() to hex in the output.
- Detect light/dark mode from @media (prefers-color-scheme) or .dark/.light class patterns.

LAYOUT / VISUAL DNA
- Determine layout method from display: flex, display: grid, float usage.
- Content width: check max-width on containers, body, main. "full-bleed" if content goes edge-to-edge.
- Framing: "open" if minimal borders/cards/containers. "boxed" if visible boundaries. "card-based" if card patterns dominate.
- Grid: check for explicit grid-template-columns, 12-col patterns, auto-fit/auto-fill, or framework grids.
- Spacing: look for consistent spacing values or CSS vars like --spacing-*, --gap-*, --space-*.
- Border radius: find the dominant border-radius value.

MOTION
- Check transition, animation, @keyframes declarations.
- Capture exact duration values and easing functions.
- Look for GSAP, ScrollTrigger, AOS, Lenis, locomotive-scroll, Framer Motion references in:
  - CSS class names (.gsap-*, .aos-*, [data-scroll], .lenis)
  - CSS comments mentioning libraries
  - Animation patterns characteristic of specific libraries
- Check for @media (prefers-reduced-motion) queries.
- "minimal" = only hover/focus transitions. "moderate" = entrance animations, scroll reveals. "heavy" = complex choreography.

CONFIDENCE
- "high" if you found rich CSS with clear design tokens, custom properties, or a design system framework.
- "medium" if CSS is partial (some inline, some external) but enough to extract key values.
- "low" if CSS is mostly utility classes (Tailwind), minified beyond useful extraction, or very thin.

WHAT TO AVOID:
- Do NOT make up hex values. If a color is not in the CSS, do not invent one.
- Do NOT default to generic values. If font-size is not specified, say "not specified" — do not guess "16px".
- Do NOT confuse framework defaults with intentional design choices.
- Do NOT report colors from third-party widgets, cookie banners, or embedded content.
- If CSS is heavily minified, focus on CSS custom properties and @font-face — those survive minification.

SITE: ${siteUrl}

RAW CSS EVIDENCE
================
${cssText}`;
}

// ── Extraction helpers ───────────────────────────────────────────────────────

function extractToolInput(response) {
  if (!Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'write_design_system') {
      return block.input || null;
    }
  }
  return null;
}

function extractUsage(response) {
  const usage = response.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  // Sonnet pricing: $3.00/MTok input, $15.00/MTok output
  const estimatedCostUsd = (inputTokens * 0.000003) + (outputTokens * 0.000015);
  return {
    model: DESIGN_SYSTEM_MODEL,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract design system from a site's HTML pages.
 *
 * Integrates into the existing pipeline:
 *   const evidence = await fetchSiteEvidence(url);
 *   const designSystem = await extractDesignSystem(evidence);
 *   // merge designSystem into intake before normalize
 *
 * @param {SiteEvidence} evidence - From site-fetcher.js (must include raw HTML in pages)
 * @param {object} [options]
 * @param {function} [options.onProgress] - Called before LLM call fires
 * @returns {Promise<DesignSystemResult>}
 */
async function extractDesignSystem(evidence, { onProgress } = {}) {
  // Collect CSS from all fetched pages
  const allCssEvidence = {
    inlineStyles: [],
    externalSheetUrls: [],
    cssVariables: [],
    keyElementStyles: [],
  };

  for (const page of (evidence.pages || [])) {
    if (!page._rawHtml) continue;
    const pageEvidence = extractCssEvidence(page._rawHtml);
    allCssEvidence.inlineStyles.push(...pageEvidence.inlineStyles);
    allCssEvidence.externalSheetUrls.push(...pageEvidence.externalSheetUrls);
    allCssEvidence.cssVariables.push(...pageEvidence.cssVariables);
    allCssEvidence.keyElementStyles.push(...pageEvidence.keyElementStyles);
  }

  // Deduplicate stylesheet URLs
  allCssEvidence.externalSheetUrls = [...new Set(allCssEvidence.externalSheetUrls)].slice(0, MAX_EXTERNAL_SHEETS);

  // Fetch external stylesheets
  const externalCss = await fetchExternalStylesheets(allCssEvidence.externalSheetUrls, evidence.url);

  // Build combined CSS text
  const cssText = buildCssText(allCssEvidence, externalCss);

  if (!cssText || cssText.length < 50) {
    return {
      ok: false,
      designSystem: null,
      runCostData: null,
      error: 'No meaningful CSS found — site may be JS-rendered or use inline styles only.',
    };
  }

  // Deterministic heading-font extraction — feeds the LLM as an authoritative
  // hint AND acts as a fallback/override if the model picks a non-heading
  // font (e.g. a .menu-button or .nav-link family) for the heading system.
  const headingFontHint = extractHeadingFontFamily(cssText);

  // Emit progress before blocking LLM call
  if (onProgress) { try { await onProgress(); } catch { /* never block extraction */ } }

  let response;
  try {
    response = await callAnthropic({
      model: DESIGN_SYSTEM_MODEL,
      max_tokens: MAX_TOKENS,
      tools: [DESIGN_SYSTEM_TOOL],
      tool_choice: { type: 'any' },
      messages: [
        {
          role: 'user',
          content: buildDesignSystemPrompt(cssText, evidence.url, { headingFontHint }),
        },
      ],
    });
  } catch (err) {
    return { ok: false, designSystem: null, runCostData: null, error: err.message };
  }

  const runCostData = extractUsage(response);
  const designSystem = extractToolInput(response);

  if (!designSystem) {
    return {
      ok: false,
      designSystem: null,
      runCostData,
      error: 'Model did not return structured design system data.',
    };
  }

  // Override: if we deterministically detected an h1 font and the model picked
  // something different, trust the CSS source of truth.
  if (headingFontHint && designSystem?.typography?.headingSystem) {
    const llmFont = String(designSystem.typography.headingSystem.fontFamily || '')
      .split(',')[0].trim().replace(/^["']|["']$/g, '').trim();
    if (!llmFont || llmFont.toLowerCase() !== headingFontHint.toLowerCase()) {
      designSystem.typography.headingSystem.fontFamily = headingFontHint;
    }
  }

  return { ok: true, designSystem, runCostData, error: null };
}

module.exports = {
  extractDesignSystem,
  extractCssEvidence,
  extractHeadingFontFamily,
  fetchExternalStylesheets,
  buildCssText,
  buildDesignSystemPrompt,
  DESIGN_SYSTEM_TOOL,
};
