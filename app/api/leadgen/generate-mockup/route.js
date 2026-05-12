import { createRequire } from 'module';
import { formatReferencesForMockupPrompt } from '../../../../features/leadgen/design-references.js';
import { buildVisualDnaPromptBlock } from '../../../../features/leadgen/visual-dna.js';

// Generates a visual mockup from the stored DESIGN.MD brief.
// Cascade: Gemini 2.5 Flash Image (Nano Banana) → gpt-image-1 → Imagen 4.
// Streams NDJSON progress. Result stored in Firebase Storage + generation.mockupUrl.
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb                      = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser }   = require('../../../../api/_lib/auth.cjs');
const { saveBufferArtifact }  = require('../../../../api/_lib/storage-artifacts.cjs');
const { logUsage, computeImageCost } = require('../../../../api/_lib/usage-logger.cjs');

// ─── VERTICAL STYLE HINTS ─────────────────────────────────────────────────────

const VERTICAL_STYLE = {
  lawyer:        'authoritative navy + gold palette, serif headings, formal and trustworthy',
  dental:        'bright blues and whites, rounded corners, clean clinical feel, friendly',
  home_services: 'bold orange accents, strong sans-serif type, blue/dark backgrounds, reliable',
  restaurant:    'warm rich tones, elegant typography, large food photography, inviting',
  med_spa:       'soft rose and ivory palette, refined luxury feel, elegant sans-serif type, calming and aspirational',
  auto_shop:     'bold industrial palette, strong metallic accents, heavy sans-serif type, confident and capable',
  auto_repair:   'bold industrial palette, strong metallic accents, heavy sans-serif type, confident and capable',
  chiropractor:  'calm teal and warm white palette, body-forward photography, approachable and wellness-oriented',
  gym_fitness:   'high-energy dark backgrounds, bold accent colors, athletic photography, motivational and dynamic',
  real_estate:   'premium neutral palette, large property photography, clean serif-and-sans mix, prestigious and aspirational',
  wedding_event: 'romantic blush and gold palette, soft editorial photography, elegant script-and-serif type, dreamy and refined',
  pet_services:  'warm playful palette, bright accent colors, friendly photography, approachable and caring',
  default:       'modern professional, clean white backgrounds, strong typography, trustworthy',
};

// ─── PROMPT BUILDER ───────────────────────────────────────────────────────────

function buildMockupPrompt(prospect, content, designReferences = null, visualDna = null) {
  const copy    = content?.copy    || {};
  const colors  = content?.colors  || {};
  const struct  = content?.structure || {};

  const name      = prospect.name     || 'Local Business';
  const vertical  = prospect.vertical || 'business';
  const style     = VERTICAL_STYLE[vertical] || VERTICAL_STYLE.default;
  const headline  = copy.heroHeadline    || name;
  const sub       = copy.heroSubheadline || copy.tagline || '';
  const services  = (copy.serviceNames   || []).slice(0, 4);
  const navItems  = (struct.navItems     || ['Services', 'About', 'Contact']).slice(0, 5);
  const primary   = colors.primary   || '#2c3e50';
  const secondary = colors.secondary || '#3498db';
  const accent    = colors.accent    || '#e74c3c';
  const cta       = (copy.ctaTexts   || ['Get in Touch'])[0] || 'Get in Touch';
  const aboutText = copy.aboutText   ? copy.aboutText.slice(0, 200) : '';

  // Brief summary injected as context before the master creative direction
  const briefContext = `DESIGN BRIEF CONTEXT:
Business: "${name}" — ${vertical} (${style})
Headline: "${headline.slice(0, 80)}"${sub ? `\nSubheadline: "${sub.slice(0, 80)}"` : ''}${aboutText ? `\nAbout: "${aboutText}"` : ''}${services.length ? `\nServices: ${services.join(', ')}` : ''}
Navigation: ${navItems.join(' · ')} + CTA "${cta}"
Brand colors: primary ${primary} · secondary ${secondary} · accent ${accent}`;

  const refDirection = formatReferencesForMockupPrompt(designReferences?.summary);
  const visualDnaDirection = buildVisualDnaPromptBlock(visualDna || prospect.visualDna || null);

  return `${briefContext}

---

Based on the design brief above, generate a full first-page website mockup for this business.

The design should include eight distinct sections stacked vertically, rendered as one single tall image showing the complete first-page scroll from top to bottom.

This is for a visually ambitious, design-forward website. The visuals should feel highly original, art-directed, and intentional — with text and UI elements integrated thoughtfully into the composition. Make it feel ultra-creative, like an Awwwards SOTD-level website in both concept and execution.

LAYOUT RULES:
- Go beyond standard layouts. Do not rely on simple text-left, image-right compositions.
- Use experimental, varied section structures: fullscreen hero takeovers, full-bleed background imagery, horizontal panoramic bands, bold typographic sections, asymmetric grids, layered depth compositions.
- Mix dense sections with minimal breathing-room sections.
- Use full background images or strong full-background color compositions throughout. No plain white sections.
- Keep it light mode overall.

SECTION STRUCTURE (top to bottom):
1. Navigation bar — logo left, links right, CTA button
2. Hero — fullscreen or near-fullscreen, bold headline, CTA
3. About / value proposition — experimental layout
4. Services — grid or unconventional arrangement
5. Process or how-it-works — horizontal or step-based
6. Social proof / testimonials — immersive or editorial
7. CTA / contact band — strong color or image-backed
8. Footer — clean, purposeful

VISUAL DIRECTION:
- Brand palette: ${primary}, ${secondary}, ${accent} — use these as the dominant color story
- Typography: strong hierarchy, mix of large display type and tight body text
- Motion/animation feel: static image but should imply kinetic energy, scroll animations, transitions
- Photography or illustration style consistent with "${style}"
- Text integrated into imagery, not just placed on top${visualDnaDirection ? `\n\nCLIENT-SPECIFIC VISUAL DNA:\n${visualDnaDirection}` : ''}${refDirection ? `\n\n${refDirection}` : ''}

Render as a single tall vertical image, pixel-perfect, photorealistic UI. No lorem ipsum. No placeholder boxes. No wireframes. Looks like a real, shipped, award-winning website.`;
}

// ─── GEMINI 2.5 FLASH IMAGE (Nano Banana) — PRIMARY ──────────────────────────

const NANO_BANANA_MODELS = [
  'gemini-2.5-flash-image',         // GA name
  'gemini-2.5-flash-image-preview', // preview name (some accounts only)
];

async function callNanoBananaModel(model, prompt, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(endpoint, {
    method:  'POST',
    signal:  AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${model} ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p?.inline_data?.data || p?.inlineData?.data);
  const b64 = imgPart?.inline_data?.data || imgPart?.inlineData?.data;
  if (!b64) {
    const finishReason = data?.candidates?.[0]?.finishReason || 'unknown';
    throw new Error(`${model} returned no image data (finishReason: ${finishReason})`);
  }
  return Buffer.from(b64, 'base64');
}

async function generateMockupImageNanoBanana(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const errors = [];
  for (const model of NANO_BANANA_MODELS) {
    try {
      return await callNanoBananaModel(model, prompt, apiKey);
    } catch (err) {
      errors.push(err.message);
      console.warn(`[generate-mockup] ${model} attempt failed:`, err.message);
    }
  }
  throw new Error(`Nano Banana (all models) failed: ${errors.join(' | ')}`);
}

// ─── OPENAI gpt-image-1 — FALLBACK ────────────────────────────────────────────

async function generateMockupImageOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method:  'POST',
    signal:  AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:   'gpt-image-1',
      prompt,
      n:       1,
      size:    '1024x1536',
      quality: 'high',
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenAI image API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const item = data?.data?.[0];
  if (!item) throw new Error('OpenAI returned no image data');

  if (item.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item.url) {
    const imgRes = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) throw new Error(`Failed to fetch generated image URL (${imgRes.status})`);
    return Buffer.from(await imgRes.arrayBuffer());
  }
  throw new Error('OpenAI response contained neither b64_json nor url');
}

// ─── IMAGEN 4 — LAST-RESORT FALLBACK (via Google AI Studio) ──────────────────

async function generateMockupImageImagen4(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;

  const res = await fetch(endpoint, {
    method:  'POST',
    signal:  AbortSignal.timeout(90_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances:  [{ prompt }],
      parameters: { sampleCount: 1, aspectRatio: '3:4', outputMimeType: 'image/png' },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Imagen 4 API ${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  const b64  = data?.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) throw new Error('Imagen 4 returned no image data');
  return Buffer.from(b64, 'base64');
}

// ─── IMAGE GENERATION CASCADE ─────────────────────────────────────────────────

async function generateMockupImage(prompt, emit) {
  const providers = [
    { name: 'Nano Banana (gemini-2.5-flash-image)', model: 'gemini-2.5-flash-image', providerKey: 'gemini', fn: generateMockupImageNanoBanana, size: null,         quality: null   },
    { name: 'gpt-image-1',                          model: 'gpt-image-1',            providerKey: 'openai', fn: generateMockupImageOpenAI,     size: '1024x1536', quality: 'high' },
    { name: 'Imagen 4',                             model: 'imagen-4',               providerKey: 'gemini', fn: generateMockupImageImagen4,    size: null,         quality: null   },
  ];

  let lastErr;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    try {
      if (typeof emit === 'function') {
        emit({ type: 'progress', stage: 'mockup', label: i === 0 ? `Trying ${p.name}…` : `Falling back to ${p.name}…` });
      }
      const buf = await p.fn(prompt);
      return { buffer: buf, provider: p.name, model: p.model, providerKey: p.providerKey, size: p.size, quality: p.quality };
    } catch (err) {
      lastErr = err;
      console.warn(`[generate-mockup] ${p.name} failed:`, err.message);
      if (typeof emit === 'function') {
        emit({ type: 'progress', stage: 'mockup', label: `${p.name} failed: ${String(err.message).slice(0, 240)}` });
      }
    }
  }
  throw new Error(`All image providers failed: ${lastErr?.message || 'unknown error'}`);
}

// ─── ROUTE ────────────────────────────────────────────────────────────────────

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}

// POST /api/leadgen/generate-mockup
//   body: { placeId: string }
//   → streams NDJSON: prompt → image cascade (Nano Banana → gpt-image-1 → Imagen 4) → storage upload
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
  if (!prospect?.generation?.designMd) {
    return new Response(JSON.stringify({ type: 'error', message: 'No brief found — run Prepare Brief first.' }) + '\n', { status: 409, headers: { 'Content-Type': 'application/x-ndjson' } });
  }

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      emit({ type: 'start', websiteUrl: prospect.website || prospect.name });

      try {
        // ── Step 1: Build prompt ───────────────────────────────────────
        emit({ type: 'progress', stage: 'mockup', label: 'Building visual prompt from brief…' });

        let prompt;
        const storedPrompt   = prospect.generation?.mockupPrompt;
        const promptEditedAt = prospect.generation?.mockupPromptEditedAt;

        if (storedPrompt && promptEditedAt) {
          prompt = storedPrompt;
          emit({ type: 'progress', stage: 'mockup', label: 'Using edited mockup prompt…' });
        } else {
          const content    = prospect.generation?.contentJson
            ? JSON.parse(prospect.generation.contentJson)
            : {};
          const designRefs = prospect.generation?.designReferences || null;
          prompt = buildMockupPrompt(prospect, content, designRefs, prospect.visualDna || null);
          if (designRefs?.summary?.length) {
            emit({ type: 'progress', stage: 'mockup', label: `Injecting ${designRefs.summary.length} Lazyweb reference descriptions into prompt…` });
          }
          if (prospect.visualDna?.subjects?.length) {
            emit({ type: 'progress', stage: 'mockup', label: `Injecting Visual DNA for ${prospect.visualDna.subjects.length} subject profile${prospect.visualDna.subjects.length === 1 ? '' : 's'}…` });
          }
        }
        emit({ type: 'progress', stage: 'mockup', label: `Prompt ready — calling Nano Banana (fallbacks: gpt-image-1, Imagen 4) — this takes ~20–40s…` });

        // ── Step 2: Generate image ─────────────────────────────────────
        const { buffer: imageBuffer, provider, model: mockupModel, providerKey, size: mockupSize, quality: mockupQuality } = await generateMockupImage(prompt, emit);

        const mockupCostUsd = computeImageCost({ model: mockupModel, size: mockupSize, quality: mockupQuality, count: 1 });
        await logUsage({
          module:     'leadgen',
          action:     'generate-mockup',
          provider:   providerKey,
          model:      mockupModel,
          imageCount: 1,
          costUsd:    mockupCostUsd,
          placeId,
          metadata:   {
            providerLabel: provider,
            size:          mockupSize,
            quality:       mockupQuality,
            bytes:         imageBuffer.byteLength,
          },
        });
        emit({ type: 'progress', stage: 'mockup', label: `Image generated via ${provider} — ${(imageBuffer.byteLength / 1024).toFixed(0)}KB · $${mockupCostUsd.toFixed(4)} · uploading…` });

        // ── Step 3: Upload to Firebase Storage ─────────────────────────
        const stored = await saveBufferArtifact({
          storagePath: `leadgen/${placeId}/mockup.png`,
          buffer:      imageBuffer,
          contentType: 'image/png',
          metadata:    { artifactType: 'site_mockup', placeId, provider, generatedAt: new Date().toISOString() },
        });

        const mockupUrl = stored.downloadUrl;
        emit({ type: 'progress', stage: 'mockup', label: 'Mockup saved.' });

        // ── Step 4: Persist ────────────────────────────────────────────
        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          'generation.mockupUrl':            mockupUrl,
          'generation.mockupGeneratedAt':    new Date().toISOString(),
          'generation.mockupPrompt':         prompt,
          'generation.mockupProvider':       provider,
          // Clear edit flag so next run rebuilds fresh unless operator edits again
          'generation.mockupPromptEditedAt': null,
        });

        emit({
          type:   'done',
          status: 'succeeded',
          result: { mockupUrl },
        });

      } catch (err) {
        console.error('[generate-mockup] error:', err);
        emit({ type: 'error', message: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status:  200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
