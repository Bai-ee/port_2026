// Lead Gen — Site Generator
// Calls Claude Sonnet to produce a one-shot HTML5 homepage from a DESIGN.MD brief.
// Saves the generation prompt alongside the output for iterative tuning.
// Server-only. Requires: ANTHROPIC_API_KEY.

import { createRequire } from 'module';
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { subdir as clientSubdir } from './client-folder.js';
import { buildSiteFrame, normalizeGeneratedBody, validateFramedHtml, validateGeneratedBody } from './site-frame.js';

const require = createRequire(import.meta.url);
const { callAnthropic } = require('../scout-intake/_anthropic-client.js');

const CLIENTS_ROOT  = process.env.VERCEL ? '/tmp/clients' : path.join(process.cwd(), 'clients');
const SHARED_DIR    = path.join(process.cwd(), 'clients/_shared');
const MODEL         = 'claude-sonnet-4-6';
const MAX_TOKENS    = 16000;

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior frontend engineer generating production-quality HTML5 homepage body markup for local businesses. You produce ONLY the markup that belongs inside <body>.

TECH STACK:
- HTML5 semantic markup (header, nav, main, section, article, footer)
- Tailwind CSS utilities are available globally — use arbitrary values [#hexcolor] for brand colors.
- GSAP 3.12 + ScrollTrigger + gsap-kit.js are loaded by the server frame. You do NOT write GSAP code.
- No other JS libraries. No build step.

DOCUMENT FRAME:
- Do NOT output <!DOCTYPE>, <html>, <head>, <body>, CDN scripts, Tailwind config, JSON-LD, Open Graph, Twitter Card, canonical, or meta tags.
- The server owns the document shell and will wrap your body markup in the shared frame.
- You may include one <style> tag only if Tailwind utilities cannot express a necessary visual detail.

ANIMATION SYSTEM (critical — follow exactly):
You declare animations via HTML data attributes. You NEVER write custom GSAP code.
- data-gsap="heroParallax" on the hero section → background parallax on scroll. Add data-parallax on the bg image and data-reveal on headline/subheadline.
- data-gsap="textReveal" on a section → add data-reveal on children to stagger them in
- data-gsap="fadeUp" on a section → add data-animate on children for staggered fade+translate
- data-gsap="staggerGrid" on a services/grid section → add data-animate on each card
- data-gsap="slideCards" on a testimonials section → add data-animate on each card
- data-gsap="counterUp" on a stats section → add data-counter="TARGET_NUMBER" on counter elements
- data-gsap="scaleIn" on logos/badges → add data-animate on each element

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

OUTPUT: Return ONLY body markup. No explanations, no markdown fences, no comments about what you did.`;

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

Generate the body markup now. Return only the inner <body> content.`;
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

  const normalized = normalizeGeneratedBody(rawHtml);
  const { html, warnings } = buildSiteFrame({
    bodyHtml: normalized.bodyHtml,
    styleHtml: normalized.styleHtml,
    contentJson,
  });

  // Validate and log issues (non-fatal)
  const issues = [
    ...normalized.warnings,
    ...warnings,
    ...validateGeneratedBody(normalized.bodyHtml),
    ...validateFramedHtml(html),
  ];
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
