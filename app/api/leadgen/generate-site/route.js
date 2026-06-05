import { createRequire } from 'module';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { buildVisualDnaPromptBlock } from '../../../../features/leadgen/visual-dna.js';

// Generates homepage HTML from the stored DESIGN.MD brief, deploys to Vercel,
// then runs the before/after AI Readiness comparison.
// Streams NDJSON progress. The Claude generation step (~30s) shows a typing indicator.
export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { callAnthropic }     = require('../../../../features/scout-intake/_anthropic-client.js');
const { logUsage, computeAnthropicCost } = require('../../../../api/_lib/usage-logger.cjs');

import { runReadinessComparison, formatComparison } from '../../../../features/leadgen/readiness-comparison.js';
import { downloadAssetsToBuffers } from '../../../../features/leadgen/asset-manager.js';
import { ensureClientFolder, subdir, assetsDir, clientRoot, syncClientFolder } from '../../../../features/leadgen/client-folder.js';
import { buildSiteFrame, normalizeGeneratedBody, validateFramedHtml, validateGeneratedBody } from '../../../../features/leadgen/site-frame.js';
import {
  buildKnowledgeBaseRuntimeQuery,
  getKnowledgeBaseRuntimeContext,
} from '../../../../features/knowledge-base/pipeline-context.js';

const MODEL      = 'claude-sonnet-4-6';
const MAX_TOKENS = 16000;
const MAX_VISION_IMAGE_DIMENSION = 1600;
const MAX_VISION_IMAGE_BYTES = 1_500_000;

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior frontend engineer generating production-quality HTML5 homepage body markup for local businesses. You produce ONLY the markup that belongs inside <body>.

TECH STACK:
- HTML5 semantic markup (header, nav, main, section, article, footer)
- Tailwind CSS utilities are available globally — use arbitrary values [#hexcolor] for brand colors.
- GSAP 3.12 + ScrollTrigger + gsap-kit.js are loaded by the server frame. You do NOT write custom GSAP code.
- No other JS libraries. No build step.

DOCUMENT FRAME:
- Do NOT output <!DOCTYPE>, <html>, <head>, <body>, CDN scripts, Tailwind config, JSON-LD, Open Graph, Twitter Card, canonical, or meta tags.
- The server owns the document shell and will wrap your body markup in the shared frame.
- You may include one <style> tag only if Tailwind utilities cannot express a necessary visual detail.

ANIMATION SYSTEM (follow exactly — no custom GSAP):
- data-gsap="heroParallax" on hero section. Add data-parallax on bg image, data-reveal on headline/subheadline.
- data-gsap="textReveal" on a section → add data-reveal on children
- data-gsap="fadeUp" on a section → add data-animate on children
- data-gsap="staggerGrid" on services/grid section → add data-animate on each card
- data-gsap="slideCards" on testimonials section → add data-animate on each card
- data-gsap="counterUp" on stats section → add data-counter="NUMBER" on counter elements
- data-gsap="scaleIn" on logos/badges → add data-animate on each element

CONTENT RULES:
- Use copy VERBATIM from the brief. Do not paraphrase or invent.
- Business name, phone, address, email must match the brief exactly.
- Service names and descriptions must match the brief exactly.
- Images: use URLs exactly as specified in the brief.

QUALITY:
- Mobile-first responsive (sm: md: lg: xl:)
- All images: loading="lazy", descriptive alt, width/height hints
- Skip-to-content link, focus-visible styles, keyboard accessible
- Subtle footer: "Preview redesign by Bballi Studio · bballi.com"

OUTPUT: Return ONLY body markup. No explanations, no markdown fences.`;

// ─── FRAMED HTML ASSEMBLY ─────────────────────────────────────────────────────

// ─── VERCEL DEPLOY ────────────────────────────────────────────────────────────

async function deployToVercel(slug, html, assetBuffers = []) {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error('VERCEL_API_TOKEN not set');

  // Load gsap-kit.js from the shared folder (tracked in git)
  const gsapKitPath = path.join(process.cwd(), 'clients/_shared/gsap-kit.js');
  const gsapKitContent = existsSync(gsapKitPath)
    ? readFileSync(gsapKitPath, 'utf8')
    : '// gsap-kit.js unavailable';

  const projectName = `leadgen-preview-${slug}`.slice(0, 52);
  const teamId      = process.env.VERCEL_TEAM_ID || undefined;

  const files = [
    { file: 'index.html',  data: Buffer.from(html,           'utf8').toString('base64'), encoding: 'base64' },
    { file: 'gsap-kit.js', data: Buffer.from(gsapKitContent, 'utf8').toString('base64'), encoding: 'base64' },
    ...assetBuffers.map(({ targetFile, buffer }) => ({
      file:     targetFile,
      data:     buffer.toString('base64'),
      encoding: 'base64',
    })),
  ];

  const deployUrl = `https://api.vercel.com/v13/deployments${teamId ? `?teamId=${teamId}` : ''}`;
  const res  = await fetch(deployUrl, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // Omit `target` — Vercel API only accepts 'production', 'staging', or a
    // custom env identifier. Default (no target) yields a preview deployment.
    body:    JSON.stringify({ name: projectName, files, projectSettings: { framework: null } }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Vercel deploy failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);

  // Poll for ready (up to 90s)
  const deployId = data.id;
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const poll = await fetch(`https://api.vercel.com/v13/deployments/${deployId}${teamId ? `?teamId=${teamId}` : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const pd = await poll.json();
      if (pd.readyState === 'READY' || pd.state === 'READY') return `https://${pd.url}`;
      if (pd.readyState === 'ERROR'  || pd.state === 'ERROR')  throw new Error(`Vercel error: ${pd.errorCode || 'unknown'}`);
    } catch (err) {
      if (err.message.startsWith('Vercel error')) throw err;
    }
  }
  return `https://${data.url}`; // return original URL if polling times out
}

// ─── ROUTE ────────────────────────────────────────────────────────────────────

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}

function resolveProspectClientId(placeId, prospect) {
  if (prospect?.clientId) return prospect.clientId;
  const match = String(placeId || '').match(/^client:(.+)$/);
  return match ? match[1] : null;
}

function normalizeVisionMediaType(value) {
  const mediaType = String(value || '').split(';')[0].trim().toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mediaType)) return mediaType;
  if (mediaType === 'image/jpg') return 'image/jpeg';
  return 'image/png';
}

async function prepareAnthropicVisionImage(buffer, { maxDimension = MAX_VISION_IMAGE_DIMENSION, inputMediaType = 'image/png' } = {}) {
  let finalBuf = buffer;
  let width = null;
  let height = null;
  let resized = false;
  let mediaType = 'image/png';

  try {
    const sharp = (await import('sharp')).default;
    const image = sharp(buffer, { limitInputPixels: false });
    const meta = await image.metadata();
    width = meta.width || null;
    height = meta.height || null;
    const needsResize =
      (width && width > maxDimension) ||
      (height && height > maxDimension) ||
      buffer.byteLength > MAX_VISION_IMAGE_BYTES;
    finalBuf = await sharp(buffer, { limitInputPixels: false })
      .resize(needsResize ? {
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      } : undefined)
      .png({ compressionLevel: 8, quality: 82 })
      .toBuffer();
    resized = needsResize || finalBuf.byteLength !== buffer.byteLength;
    const nextMeta = await sharp(finalBuf).metadata();
    width = nextMeta.width || width;
    height = nextMeta.height || height;
  } catch {
    // If sharp is unavailable or cannot parse the image, keep the original.
    // The caller may still skip it by byte size before sending to Anthropic.
    mediaType = normalizeVisionMediaType(inputMediaType);
  }

  return {
    buffer: finalBuf,
    mediaType,
    width,
    height,
    resized,
  };
}

// POST /api/leadgen/generate-site
//   body: { placeId: string, skipComparison?: boolean }
//   → streams NDJSON: HTML gen + Vercel deploy + readiness comparison
export async function POST(request) {
  try { await verifyRequestUser(makeReqShim(request)); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Unauthorized.' }) + '\n', { status: 401, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  let body;
  try { body = await request.json().catch(() => ({})); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  const placeId          = String(body?.placeId || '').trim();
  const skipComparison   = body?.skipComparison === true || body?.runComparison === false;
  const useMockup        = body?.useMockup !== false;          // ON by default
  const useLazywebVision = body?.useLazywebVision === true;    // OFF by default
  const useBrandSystem   = body?.useBrandSystem !== false;     // ON by default
  const useDesignEval    = body?.useDesignEval !== false;      // ON by default
  if (!placeId) return new Response(JSON.stringify({ type: 'error', message: 'Provide placeId.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } });

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) return new Response(JSON.stringify({ type: 'error', message: `Prospect not found: ${placeId}` }) + '\n', { status: 404, headers: { 'Content-Type': 'application/x-ndjson' } });

  const prospect = snap.data();
  const designMd = prospect?.generation?.designMd;
  if (!designMd) return new Response(JSON.stringify({ type: 'error', message: 'No brief found — run Prepare Brief first.' }) + '\n', { status: 409, headers: { 'Content-Type': 'application/x-ndjson' } });

  const { makeClientSlug } = await import('../../../../features/leadgen/asset-manager.js');
  const slug = makeClientSlug(prospect);

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

        emit({ type: 'start', websiteUrl: prospect.website });

      try {
        const prospectClientId = resolveProspectClientId(placeId, prospect);
        const knowledgeBaseContext = prospectClientId
          ? await getKnowledgeBaseRuntimeContext({
              clientId: prospectClientId,
              query: buildKnowledgeBaseRuntimeQuery({
                intent: 'generated homepage offer structure proof points FAQ product truth audience positioning services',
                websiteUrl: prospect.website || '',
                clientName: prospect.name || '',
                brandOverview: {
                  industry: prospect.vertical || '',
                  summary: prospect.description || '',
                },
              }),
              topK: 5,
              charCap: 3400,
            })
          : null;
        const knowledgeBasePromptBlock = knowledgeBaseContext?.available
          ? `\n\nCLIENT KNOWLEDGE BASE — MASTER SOURCE OF TRUTH FOR COPY AND CLAIMS:\n${knowledgeBaseContext.block}\n\nUse this for offer structure, proof points, FAQs, product truth, audience, positioning, and claims. Do not invent copy that conflicts with it.`
          : '';

        // ── Step 0: Materialize per-client folder on local disk ───────────
        // Mirrors briefs / assets / deploy artifacts under clients/{slug}/ so
        // every generated client has a single reviewable folder.
        await ensureClientFolder(slug);
        const onboardingDir = subdir(slug, 'onboarding');
        writeFileSync(path.join(onboardingDir, 'prospect.json'),        JSON.stringify(prospect, null, 2), 'utf8');
        writeFileSync(path.join(onboardingDir, 'onboard-answers.json'), JSON.stringify(prospect.onboard || {}, null, 2), 'utf8');
        if (prospect.audit) {
          writeFileSync(path.join(onboardingDir, 'audit.json'), JSON.stringify(prospect.audit, null, 2), 'utf8');
        }
        if (prospect?.generation?.contentJson) {
          try {
            const contentObj = typeof prospect.generation.contentJson === 'string'
              ? JSON.parse(prospect.generation.contentJson)
              : prospect.generation.contentJson;
            writeFileSync(path.join(subdir(slug, 'scraped'), 'content.json'), JSON.stringify(contentObj, null, 2), 'utf8');
          } catch { /* malformed contentJson — skip */ }
        }
        writeFileSync(path.join(subdir(slug, 'brief'), 'DESIGN.MD'), designMd, 'utf8');
        await syncClientFolder(slug, {
          name:    prospect.name || null,
          placeId,
          website: prospect.website || null,
          stage:   'generating',
        });
        // ── Step 1: Build prompt ───────────────────────────────────────
        emit({ type: 'progress', stage: 'prompt', label: 'Building generation prompt…' });

        let userPrompt;
        let contentJsonForFrame = {};
        const storedSitePrompt   = prospect?.generation?.sitePrompt;
        const sitePromptEditedAt = prospect?.generation?.sitePromptEditedAt;

        try {
          contentJsonForFrame = prospect?.generation?.contentJson
            ? (typeof prospect.generation.contentJson === 'string'
                ? JSON.parse(prospect.generation.contentJson)
                : prospect.generation.contentJson)
            : {};
        } catch {
          contentJsonForFrame = {};
        }

        if (storedSitePrompt && sitePromptEditedAt) {
          userPrompt = `${storedSitePrompt}${knowledgeBasePromptBlock}\n\nIMPORTANT OUTPUT OVERRIDE: Return only inner <body> markup. Do not include <!DOCTYPE>, <html>, <head>, <body>, CDN scripts, Tailwind config, JSON-LD, Open Graph, Twitter Card, canonical, or meta tags.`;
          emit({ type: 'progress', stage: 'prompt', label: 'Using edited site prompt…' });
        } else {
          const contentJson = contentJsonForFrame;
          const copy = contentJson?.copy || {};
          const ci   = copy.contactInfo || {};
          const contactBlock = [
            ci.phone   ? `Phone: ${ci.phone}`   : null,
            ci.email   ? `Email: ${ci.email}`   : null,
            ci.address ? `Address: ${ci.address}` : null,
          ].filter(Boolean).join('\n');
          userPrompt = `Below is the complete DESIGN.MD creative brief. Follow it precisely.\n\n---\n${designMd}\n---${knowledgeBasePromptBlock}\n\nCONTACT INFORMATION (copy verbatim):\n${contactBlock || '(see brief)'}\n\nGenerate the body markup now. Return only the inner <body> content.`;
        }
        // If brief-level toggles differ from what the stored brief was built with,
        // rebuild DESIGN.MD on-the-fly. Skipped when both are ON (default path).
        const briefNeedsRebuild = (!useBrandSystem || !useDesignEval) && !!designMd && !(storedSitePrompt && sitePromptEditedAt);
        if (briefNeedsRebuild) {
          try {
            emit({ type: 'progress', stage: 'prompt', label: 'Rebuilding brief with toggled features…' });
            const { generateDesignMd } = await import('../../../../features/leadgen/design-md-generator.js');
            const contentJson = contentJsonForFrame;
            const assetManifest = prospect?.generation?.assetManifest || null;
            const brandGuide = useBrandSystem
              ? (prospect.brandGuide || prospect.userUploads?.brandSystem?.brandGuideV2 || null)
              : null;
            const designRefs = prospect.generation?.designReferences || null;

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
              visualDna:        prospect.visualDna || null,
              knowledgeBaseContext,
            });

            const copy = contentJson?.copy || {};
            const ci   = copy.contactInfo || {};
            const contactBlock = [
              ci.phone   ? `Phone: ${ci.phone}`   : null,
              ci.email   ? `Email: ${ci.email}`   : null,
              ci.address ? `Address: ${ci.address}` : null,
            ].filter(Boolean).join('\n');
            userPrompt = `Below is the complete DESIGN.MD creative brief. Follow it precisely.\n\n---\n${rebuiltMd}\n---${knowledgeBasePromptBlock}\n\nCONTACT INFORMATION (copy verbatim):\n${contactBlock || '(see brief)'}\n\nGenerate the body markup now. Return only the inner <body> content.`;
            emit({ type: 'progress', stage: 'prompt', label: `Brief rebuilt without ${[!useBrandSystem && 'Brand System', !useDesignEval && 'Design Eval'].filter(Boolean).join(' + ')}` });
          } catch (err) {
            emit({ type: 'progress', stage: 'prompt', label: `⚠ Brief rebuild failed — using stored brief: ${err.message}` });
          }
        }

        const visualDnaBlock = buildVisualDnaPromptBlock(prospect.visualDna || null);
        if (visualDnaBlock && !(storedSitePrompt && sitePromptEditedAt)) {
          userPrompt += `\n\nCLIENT-SPECIFIC VISUAL DNA FOR ALL GENERATED IMAGERY:\n${visualDnaBlock}`;
        }
        const promptLen = Math.round((SYSTEM_PROMPT.length + userPrompt.length) / 4);
        emit({ type: 'progress', stage: 'prompt', label: `Prompt ready — ~${promptLen} tokens input` });

        // ── Step 2: Load vision context (mockup + optional Lazyweb refs) ─────
        let messageContent = userPrompt;
        const mockupUrl    = prospect?.generation?.mockupUrl;
        let mockupImage    = null; // { type: 'image', source: { type: 'base64', ... } }

        if (useMockup && mockupUrl) {
          try {
            emit({ type: 'progress', stage: 'generate', label: 'Loading visual mockup…' });
            const imgRes = await fetch(mockupUrl, { signal: AbortSignal.timeout(20_000) });
            if (imgRes.ok) {
              const origBuf  = Buffer.from(await imgRes.arrayBuffer());
              const origKB   = (origBuf.byteLength / 1024).toFixed(0);
              const prepared = await prepareAnthropicVisionImage(origBuf, {
                maxDimension: 1200,
                inputMediaType: imgRes.headers.get('content-type') || 'image/png',
              });
              const finalBuf = prepared.buffer;
              if ((prepared.width && prepared.width > 8000) || (prepared.height && prepared.height > 8000)) {
                throw new Error(`Mockup dimensions remain too large (${prepared.width || '?'}x${prepared.height || '?'})`);
              }

              const finalKB = (finalBuf.byteLength / 1024).toFixed(0);
              mockupImage = {
                type: 'image',
                source: { type: 'base64', media_type: prepared.mediaType, data: finalBuf.toString('base64') },
              };
              emit({ type: 'progress', stage: 'generate', label: `Mockup loaded (${origKB}KB → ${finalKB}KB${prepared.width && prepared.height ? ` · ${prepared.width}x${prepared.height}` : ''})` });
            }
          } catch {
            emit({ type: 'progress', stage: 'generate', label: '⚠ Mockup load failed — continuing without.' });
          }
        }

        // Lazyweb reference images — OFF by default, enabled via toggle
        const refImages = [];
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
                    const rawBuf = Buffer.from(await imgRes.arrayBuffer());
                    const prepared = await prepareAnthropicVisionImage(rawBuf, {
                      maxDimension: MAX_VISION_IMAGE_DIMENSION,
                      inputMediaType: img.mimeType || imgRes.headers.get('content-type') || 'image/png',
                    });
                    const buf = prepared.buffer;
                    if ((prepared.width && prepared.width > 8000) || (prepared.height && prepared.height > 8000)) continue;
                    if (buf.byteLength > MAX_VISION_IMAGE_BYTES) continue;
                    refImages.push({
                      type: 'image',
                      source: { type: 'base64', media_type: prepared.mediaType, data: buf.toString('base64') },
                    });
                  }
                } catch { /* skip individual image */ }
              }
            }
            if (refImages.length > 0) {
              emit({ type: 'progress', stage: 'references', label: `Loaded ${refImages.length} reference image${refImages.length > 1 ? 's' : ''}` });
            }
          } catch (err) {
            emit({ type: 'progress', stage: 'references', label: `⚠ References skipped: ${err.message}` });
          }
        } else if (useLazywebVision && !process.env.LAZYWEB_TOKEN) {
          emit({ type: 'progress', stage: 'references', label: '⚠ Lazyweb toggle ON but LAZYWEB_TOKEN not set — skipping.' });
        }

        // Build final message content
        const visionImages = [
          ...(mockupImage ? [mockupImage] : []),
          ...refImages,
        ];

        if (visionImages.length > 0) {
          const hasMockup = !!mockupImage;
          const refCount  = refImages.length;
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
          emit({ type: 'progress', stage: 'generate', label: `Calling ${MODEL} — generating homepage (no vision context)…` });
        }

        // ── Step 3: Call Claude ────────────────────────────────────────
        const response = await callAnthropic({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: messageContent }],
        });

        const rawHtml = response?.content?.[0]?.text || '';
        if (!rawHtml) throw new Error('Claude returned empty response');

        const usage = response?.usage || {};
        const generationCostUsd = computeAnthropicCost({
          model:        MODEL,
          inputTokens:  usage.input_tokens  || 0,
          outputTokens: usage.output_tokens || 0,
        });
        await logUsage({
          module:       'leadgen',
          action:       'generate-site',
          provider:     'anthropic',
          model:        MODEL,
          inputTokens:  usage.input_tokens  || 0,
          outputTokens: usage.output_tokens || 0,
          costUsd:      generationCostUsd,
          placeId,
          metadata:     {
            visionImages: (mockupImage ? 1 : 0) + refImages.length,
            mockupLoaded: !!mockupImage,
            lazywebVision: refImages.length,
            toggles:      { useMockup, useLazywebVision, useBrandSystem, useDesignEval, runComparison: !skipComparison },
            knowledgeBaseSources: knowledgeBaseContext?.available ? knowledgeBaseContext.sources.length : 0,
            slug,
          },
        });
        emit({ type: 'progress', stage: 'generate', label: `Generated ${(rawHtml.length / 1024).toFixed(1)}KB · ${usage.output_tokens || '?'} tokens · $${generationCostUsd.toFixed(4)}` });

        // ── Step 3: Validate ───────────────────────────────────────────
        emit({ type: 'progress', stage: 'validate', label: 'Validating output…' });
        const normalized = normalizeGeneratedBody(rawHtml);
        const { html, warnings } = buildSiteFrame({
          bodyHtml: normalized.bodyHtml,
          styleHtml: normalized.styleHtml,
          contentJson: contentJsonForFrame,
          prospect,
        });
        const issues = [
          ...normalized.warnings,
          ...warnings,
          ...validateGeneratedBody(normalized.bodyHtml),
          ...validateFramedHtml(html),
        ];
        if (issues.length) {
          emit({ type: 'progress', stage: 'validate', label: `⚠ ${issues.join(' · ')}` });
        } else {
          emit({ type: 'progress', stage: 'validate', label: 'HTML valid — JSON-LD ✓ · OG tags ✓ · data-gsap ✓' });
        }

        // Save prompt + HTML for debugging
        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          'generation.htmlGeneratedAt':    new Date().toISOString(),
          'generation.htmlSizeBytes':      Buffer.byteLength(html, 'utf8'),
          'generation.validationIssues':   issues,
          'generation.tokenUsage':         { input: usage.input_tokens || 0, output: usage.output_tokens || 0 },
          'generation.estimatedCostUsd':   Math.round(generationCostUsd * 10000) / 10000,
          'generation.sitePrompt':         userPrompt,
          'generation.knowledgeBaseSources': knowledgeBaseContext?.available ? knowledgeBaseContext.sources : [],
          'generation.sitePromptEditedAt': null,
          stage: 'generating',
        });

        // Mirror generation artifacts to disk
        try {
          writeFileSync(path.join(subdir(slug, 'generation'), 'generation-prompt.txt'),
            `SYSTEM:\n${SYSTEM_PROMPT}\n\n---\nUSER:\n${userPrompt}`, 'utf8');
          writeFileSync(path.join(clientRoot(slug), 'index.html'), html, 'utf8');
          const gsapKitSrc = path.join(process.cwd(), 'clients/_shared/gsap-kit.js');
          if (existsSync(gsapKitSrc)) {
            writeFileSync(path.join(clientRoot(slug), 'gsap-kit.js'), readFileSync(gsapKitSrc, 'utf8'), 'utf8');
          }
          await syncClientFolder(slug, {});
        } catch (err) {
          emit({ type: 'progress', stage: 'validate', label: `⚠ disk mirror failed: ${err.message}` });
        }

        // ── Step 4: Download assets ────────────────────────────────────
        let assetBuffers = [];
        const assetManifest = prospect?.generation?.assetManifest;
        if (assetManifest) {
          const totalQueued = [assetManifest.logo, ...(assetManifest.heroImages || []), ...(assetManifest.sectionImages || [])].filter(Boolean).length;
          emit({ type: 'progress', stage: 'deploy', label: `Downloading ${totalQueued} asset${totalQueued !== 1 ? 's' : ''}…` });
          assetBuffers = await downloadAssetsToBuffers(assetManifest);
          const totalBytes = assetBuffers.reduce((s, a) => s + a.buffer.byteLength, 0);
          emit({ type: 'progress', stage: 'deploy', label: `Downloaded ${assetBuffers.length}/${totalQueued} assets — ${(totalBytes / 1024).toFixed(0)}KB` });

          // Mirror asset buffers to disk under clients/{slug}/assets/
          try {
            const assetDir = assetsDir(slug);
            mkdirSync(assetDir, { recursive: true });
            for (const { targetFile, buffer } of assetBuffers) {
              // targetFile is like "assets/hero-1.webp" — strip the prefix.
              const filename = targetFile.replace(/^assets\//, '');
              writeFileSync(path.join(assetDir, filename), buffer);
            }
            writeFileSync(path.join(assetDir, 'manifest.json'), JSON.stringify(assetManifest, null, 2), 'utf8');
            await syncClientFolder(slug, {});
          } catch (err) {
            emit({ type: 'progress', stage: 'deploy', label: `⚠ asset disk mirror failed: ${err.message}` });
          }
        }

        // ── Step 5: Deploy ─────────────────────────────────────────────
        emit({ type: 'progress', stage: 'deploy', label: 'Deploying preview to Vercel…' });

        const previewUrl = await deployToVercel(slug, html, assetBuffers);
        emit({ type: 'progress', stage: 'deploy', label: `Deployed → ${previewUrl}` });

        const deployedAt = new Date().toISOString();
        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          stage:                       'ready',
          previewUrl,
          'generation.previewUrl':     previewUrl,
          'generation.deployedAt':     deployedAt,
        });

        try {
          writeFileSync(path.join(subdir(slug, 'deploy'), 'preview-meta.json'),
            JSON.stringify({ previewUrl, slug, deployedAt, assetCount: assetBuffers.length }, null, 2), 'utf8');
          await syncClientFolder(slug, { stage: 'ready', previewUrl });
        } catch { /* non-fatal */ }

        // ── Step 6: Readiness comparison ───────────────────────────────
        let comparison = null;
        if (!skipComparison) {
          emit({ type: 'progress', stage: 'compare', label: 'Running AI Readiness on preview…' });
          try {
            comparison = await runReadinessComparison({ prospect, previewUrl });
            const imp = comparison.improvement;
            emit({ type: 'progress', stage: 'compare', label: `Before: ${comparison.before.score ?? '?'} → After: ${comparison.after.score ?? '?'}${imp != null ? ` (+${imp})` : ''}` });
            console.log(formatComparison(comparison));

            await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
              'generation.readinessComparison': comparison,
            });

            try {
              writeFileSync(path.join(subdir(slug, 'comparison'), 'readiness.json'), JSON.stringify(comparison, null, 2), 'utf8');
              await syncClientFolder(slug, {});
            } catch { /* non-fatal */ }
          } catch (err) {
            emit({ type: 'progress', stage: 'compare', label: `⚠ Comparison failed: ${err.message}` });
          }
        }

        emit({
          type:   'done',
          status: 'succeeded',
          result: {
            previewUrl,
            comparison,
            validationIssues: issues,
            tokenUsage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0 },
          },
        });

      } catch (err) {
        console.error('[generate-site] error:', err);
        await fb.adminDb.collection('leadgen_prospects').doc(placeId)
          .update({ stage: 'audited', 'generation.error': err.message }).catch(() => {});
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
