// Lead Gen — Site Generator
// Calls Claude Sonnet to produce a one-shot HTML5 homepage from a DESIGN.MD brief.
// Saves the generation prompt alongside the output for iterative tuning.
// Server-only. Requires: ANTHROPIC_API_KEY.

import { createRequire } from 'module';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { subdir as clientSubdir } from './client-folder.js';

const require = createRequire(import.meta.url);
const { callAnthropic } = require('../scout-intake/_anthropic-client.js');

const CLIENTS_ROOT  = process.env.VERCEL ? '/tmp/clients' : path.join(process.cwd(), 'clients');
const SHARED_DIR    = path.join(process.cwd(), 'clients/_shared');
const MODEL         = 'claude-sonnet-4-6';
const MAX_TOKENS    = 16000;

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior frontend engineer generating production-quality HTML5 homepages for local businesses. You produce a SINGLE complete index.html file per request.

TECH STACK:
- HTML5 semantic markup (header, nav, main, section, article, footer)
- Tailwind CSS via CDN (https://cdn.tailwindcss.com) — use arbitrary values [#hexcolor] for brand colors
- GSAP 3.12 + ScrollTrigger via CDN — already handled by gsap-kit.js
- gsap-kit.js shared library — loaded after GSAP CDN. You do NOT write GSAP code.
- No other JS libraries. No build step. Single self-contained file.

ANIMATION SYSTEM (critical — follow exactly):
You declare animations via HTML data attributes. You NEVER write custom GSAP code.
- data-gsap="heroParallax" on the hero section → background parallax on scroll. Add data-parallax on the bg image and data-reveal on headline/subheadline.
- data-gsap="textReveal" on a section → add data-reveal on children to stagger them in
- data-gsap="fadeUp" on a section → add data-animate on children for staggered fade+translate
- data-gsap="staggerGrid" on a services/grid section → add data-animate on each card
- data-gsap="slideCards" on a testimonials section → add data-animate on each card
- data-gsap="counterUp" on a stats section → add data-counter="TARGET_NUMBER" on counter elements
- data-gsap="scaleIn" on logos/badges → add data-animate on each element

CDN SCRIPTS (always include, in this exact order, at end of body):
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" defer></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" defer></script>
<script src="gsap-kit.js" defer></script>

TAILWIND CONFIG (always include in a <script> tag before cdn.tailwindcss.com):
<script>
  tailwind.config = {
    theme: {
      extend: {
        colors: {
          brand: {
            primary: '#REPLACE_WITH_PRIMARY',
            secondary: '#REPLACE_WITH_SECONDARY',
            accent: '#REPLACE_WITH_ACCENT',
          }
        },
        fontFamily: {
          heading: ['REPLACE_WITH_HEADING_FONT'],
          body: ['REPLACE_WITH_BODY_FONT'],
        }
      }
    }
  }
</script>

REQUIRED IN <head>:
1. Complete JSON-LD: LocalBusiness schema with @context, @type, name, address (PostalAddress), telephone, url, geo (GeoCoordinates if available), openingHours if hours present
2. Open Graph: og:title, og:description, og:image (use scraped hero or OG image URL), og:type=website, og:url
3. Twitter Card: twitter:card=summary_large_image, twitter:title, twitter:description, twitter:image
4. Standard: charset=UTF-8, viewport, meta name=description, canonical link
5. robots meta: <meta name="robots" content="index, follow">
6. Google Fonts if heading/body fonts are Google Fonts (use preconnect + stylesheet link)
7. llms.txt inline script: window.__llms = { business: '...', services: [...], location: '...' }

CONTENT RULES (non-negotiable):
- Use the copy VERBATIM from the DESIGN.MD content inventory. Do not paraphrase or invent.
- If a field is "—" or missing, use a sensible generic for that vertical (not a Lorem Ipsum placeholder).
- Business name, phone, address, and email must match the brief exactly.
- Service names and descriptions must match the brief exactly.

QUALITY STANDARDS:
- Mobile-first responsive (sm: md: lg: xl: breakpoints)
- All images: loading="lazy", descriptive alt text, proper width/height hints
- Keyboard accessible: skip-to-content link, focus-visible styles, logical tab order
- Color contrast: verify WCAG AA for all text on colored backgrounds
- No inline event handlers (use addEventListener in a deferred script if needed)
- Subtle footer: "Preview redesign by Bballi Studio · bballi.com"

OUTPUT: Return ONLY the complete HTML. No explanations, no markdown fences, no comments about what you did.`;

// ─── GENERATION PROMPT BUILDER ────────────────────────────────────────────────

function buildPrompt(designMd, contentJson, assetFiles) {
  const assetList = assetFiles.length
    ? assetFiles.map(f => `  - ${f}`).join('\n')
    : '  (no assets downloaded — reference original URLs from content.json)';

  // Pull key content fields for an inline reminder (brief may be long)
  const copy = contentJson.copy || {};
  const ci   = copy.contactInfo || {};
  const contactBlock = [
    ci.phone   ? `Phone: ${ci.phone}` : null,
    ci.email   ? `Email: ${ci.email}` : null,
    ci.address ? `Address: ${ci.address}` : null,
    ci.hours   ? `Hours: ${ci.hours}` : null,
  ].filter(Boolean).join('\n');

  return `Below is the complete DESIGN.MD creative brief for this site. Follow it precisely.

---
${designMd}
---

CONTACT INFORMATION (copy these exactly into the site):
${contactBlock || '(see DESIGN.MD)'}

AVAILABLE ASSET FILES (reference by relative path from index.html):
${assetList}

Generate the complete index.html now. Return only the HTML.`;
}

// ─── HTML POST-PROCESSING ─────────────────────────────────────────────────────

const CDN_SCRIPT_BLOCK = `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js" defer></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js" defer></script>
<script src="gsap-kit.js" defer></script>`;

function postProcess(html, contentJson) {
  let out = html.trim();

  // Strip any markdown fences Claude might have added despite instructions
  if (out.startsWith('```')) {
    out = out.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim();
  }

  // Ensure DOCTYPE
  if (!out.startsWith('<!DOCTYPE') && !out.startsWith('<!doctype')) {
    out = '<!DOCTYPE html>\n' + out;
  }

  // Inject GSAP CDN scripts before </body> if Claude omitted them
  if (!out.includes('gsap.min.js')) {
    out = out.replace('</body>', `${CDN_SCRIPT_BLOCK}\n</body>`);
  }

  // Inject gsap-kit.js reference if missing
  if (!out.includes('gsap-kit.js')) {
    out = out.replace('</body>', `<script src="gsap-kit.js" defer></script>\n</body>`);
  }

  // Ensure Tailwind CDN
  if (!out.includes('cdn.tailwindcss.com')) {
    out = out.replace('</head>', `<script src="https://cdn.tailwindcss.com"></script>\n</head>`);
  }

  // Ensure skip-to-content link
  if (!out.includes('skip') && !out.includes('#main')) {
    out = out.replace('<body', '<body');  // noop — just a reminder if needed
  }

  return out;
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

function validateHtml(html) {
  const issues = [];
  if (!html.includes('<!DOCTYPE html') && !html.includes('<!doctype html')) issues.push('Missing DOCTYPE');
  if (!html.includes('<head>') && !html.includes('<head '))         issues.push('Missing <head>');
  if (!html.includes('</body>'))                                     issues.push('Missing </body>');
  if (!html.includes('application/ld+json'))                        issues.push('Missing JSON-LD');
  if (!html.includes('og:title'))                                    issues.push('Missing og:title');
  if (!html.includes('data-gsap'))                                   issues.push('No data-gsap animation attributes');
  return issues;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export async function generateSite(slug) {
  const slugDir       = path.join(CLIENTS_ROOT, slug);
  const briefDir      = clientSubdir(slug, 'brief');
  const scrapedDir    = clientSubdir(slug, 'scraped');
  const generationDir = clientSubdir(slug, 'generation');
  const designMdPath  = path.join(briefDir,   'DESIGN.MD');
  const contentPath   = path.join(scrapedDir, 'content.json');
  const htmlOutPath   = path.join(slugDir,    'index.html');
  const promptOutPath = path.join(generationDir, 'generation-prompt.txt');
  const gsapKitSrc    = path.join(SHARED_DIR, 'gsap-kit.js');
  const gsapKitDest   = path.join(slugDir, 'gsap-kit.js');

  // Back-compat: legacy clients have DESIGN.MD / content.json at the slug root.
  // Fall back to those if the new layout's files aren't present yet.
  const designMdReadPath = existsSync(designMdPath) ? designMdPath : path.join(slugDir, 'DESIGN.MD');
  const contentReadPath  = existsSync(contentPath)  ? contentPath  : path.join(slugDir, 'content.json');

  if (!existsSync(designMdReadPath)) throw new Error(`DESIGN.MD not found for slug: ${slug}`);
  if (!existsSync(contentReadPath))  throw new Error(`content.json not found for slug: ${slug}`);

  mkdirSync(generationDir, { recursive: true });

  const designMd    = readFileSync(designMdReadPath, 'utf8');
  const contentJson = JSON.parse(readFileSync(contentReadPath, 'utf8'));

  // List downloaded assets
  const assetsDir = path.join(slugDir, 'assets');
  let assetFiles = [];
  if (existsSync(assetsDir)) {
    const { readdirSync } = await import('fs');
    assetFiles = readdirSync(assetsDir)
      .filter(f => /\.(jpg|jpeg|png|webp|svg|gif)$/i.test(f))
      .map(f => `assets/${f}`);
  }

  const userPrompt = buildPrompt(designMd, contentJson, assetFiles);

  // Save the prompt for debugging / iteration
  writeFileSync(promptOutPath, `SYSTEM:\n${SYSTEM_PROMPT}\n\n---\nUSER:\n${userPrompt}`, 'utf8');

  // Call Claude
  const response = await callAnthropic({
    model:      MODEL,
    max_tokens: MAX_TOKENS,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  const rawHtml = response?.content?.[0]?.text || '';
  if (!rawHtml) throw new Error('Claude returned empty response');

  const html = postProcess(rawHtml, contentJson);

  // Validate and log issues (non-fatal)
  const issues = validateHtml(html);
  if (issues.length) console.warn(`[site-generator] HTML validation issues for ${slug}:`, issues);

  writeFileSync(htmlOutPath, html, 'utf8');

  // Copy gsap-kit.js into the client folder
  if (existsSync(gsapKitSrc)) {
    copyFileSync(gsapKitSrc, gsapKitDest);
  }

  const usage = response?.usage || {};
  return {
    slug,
    htmlPath:   htmlOutPath,
    promptPath: promptOutPath,
    validationIssues: issues,
    usage: {
      inputTokens:  usage.input_tokens  || 0,
      outputTokens: usage.output_tokens || 0,
    },
  };
}
