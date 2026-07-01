import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  buildKnowledgeBaseRuntimeQuery,
  getKnowledgeBaseRuntimeContext,
} from '../../../../features/knowledge-base/pipeline-context.js';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');

const _bsPath = require.resolve('../../../../features/scout-intake/modules/brand-system.js');
function loadBrandSystem() {
  if (process.env.NODE_ENV !== 'production') delete require.cache[_bsPath];
  return require('../../../../features/scout-intake/modules/brand-system.js');
}

const { analyzeLogo }        = require('../../../../features/scout-intake/modules/brand-system-vision.js');
const { analyzeMoodBoard }   = require('../../../../features/scout-intake/modules/brand-system-mood-vision.js');
const { analyzeBrandPhotos } = require('../../../../features/scout-intake/modules/brand-system-photo-vision.js');
const { analyzeCompetitors } = require('../../../../features/scout-intake/modules/brand-system-competitor-vision.js');
const { analyzePalette }     = require('../../../../features/scout-intake/modules/brand-system-palette-vision.js');
const { buildAllPrompts }    = require('../../../../features/scout-intake/prompt-templates/index.js');
const { saveBufferArtifact } = require('../../../../api/_lib/storage-artifacts.cjs');
const { logUsage, computeAnthropicCost } = require('../../../../api/_lib/usage-logger.cjs');

// Brand-system vision modules all use the same Sonnet 4 vision model.
const VISION_MODEL = 'claude-sonnet-4-6';

// Logs an Anthropic vision call to `usage_events`. `usage` is the
// { inputTokens, outputTokens } object that each analyze* function returns.
async function logVisionUsage({ gapId, usage, clientId, metadata = {} }) {
  if (!usage) return;
  const inputTokens  = Number(usage.inputTokens)  || 0;
  const outputTokens = Number(usage.outputTokens) || 0;
  if (!inputTokens && !outputTokens) return;
  await logUsage({
    module:   'brand-system',
    action:   `chat.${gapId}`,
    provider: 'anthropic',
    model:    VISION_MODEL,
    inputTokens,
    outputTokens,
    costUsd:  computeAnthropicCost({ model: VISION_MODEL, inputTokens, outputTokens }),
    clientId,
    metadata,
  });
}

// ── Storage helpers ────────────────────────────────────────────────────────────

async function uploadBase64(clientId, pathKey, imageBase64, mediaType) {
  if (!imageBase64 || !mediaType) return null;
  try {
    const ext = (mediaType.split('/')[1] || 'jpg')
      .replace('jpeg', 'jpg').replace('svg+xml', 'svg').replace('webp', 'webp');
    const storagePath = `clients/${clientId}/brand-system/${pathKey}.${ext}`;
    const buffer = Buffer.from(imageBase64, 'base64');
    const art = await saveBufferArtifact({ storagePath, buffer, contentType: mediaType });
    return art.downloadUrl;
  } catch (err) {
    console.warn(`[brand-system/chat] storage upload failed (${pathKey}):`, err.message);
    return null;
  }
}

async function uploadMultiBase64(clientId, pathKey, images) {
  const urls = await Promise.all(
    images.map((img, i) =>
      img.imageBase64
        ? uploadBase64(clientId, `${pathKey}-${i}`, img.imageBase64, img.mediaType || 'image/jpeg')
        : Promise.resolve(null)
    )
  );
  return urls.filter(Boolean);
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function jerror(message, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { 'cache-control': 'no-store' } });
}

// Map a targetOutput choice value to a template ID.
const TARGET_OUTPUT_TO_TEMPLATE = {
  'brand identity poster':         'brand-poster',
  'storyboard / cinematic direction': 'storyboard',
  'product shots / packaging':     'product-shots',
  'website hero / landing page':   'web-design',
  'character sheet / turnarounds': 'character-sheet',
  'social media assets':           'social-media',
};

/**
 * POST /api/brand-system/chat
 *
 * Body:
 *   { gapId, value, imageUrl?, imageBase64?, mediaType?,
 *     images?: [{ imageBase64, mediaType }|{ imageUrl }],
 *     phase?, templateId?, skipped? }
 *
 * Applies the answer, runs vision when needed, re-runs the mapper, and either:
 *   - returns the next gap: { done: false, nextGap, remaining, completeness }
 *   - assembles final output: { done: true, json, jsonV2, masterPrompt, prompts, selectedPrompt, sources, generatedAt }
 */
export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return jerror(err instanceof Error ? err.message : 'Unauthorized.', 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jerror('Invalid JSON body.');
  }

  const {
    gapId,
    value,
    imageUrl,
    imageBase64,
    mediaType,
    images = [],
    skipped = false,
  } = body || {};

  const { mapPipelineToBrandSystem, buildBrandSystemJson, buildBrandSystemJsonV2, buildMasterPrompt, fieldForGap, GAP_DEFS } = loadBrandSystem();
  const validGapIds = new Set(GAP_DEFS.map((g) => g.id));
  if (gapId && !validGapIds.has(gapId)) {
    return jerror(`Unknown gapId: ${gapId}`);
  }

  let context;
  try {
    context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  } catch (err) {
    return jerror(err.message || 'Forbidden.', err.status || 403);
  }
  if (!context.userProfile) return jerror('No user record.', 404);
  const clientId = context.clientId || null;
  if (!clientId) return jerror('No clientId on user record.', 404);

  const stateRef = fb.adminDb.collection('dashboard_state').doc(clientId);

  // ── Apply answer ───────────────────────────────────────────────────────────
  if (gapId) {
    const brandSystemUploads = {};
    const gapDef = GAP_DEFS.find((g) => g.id === gapId);

    // Never allow skipping a required gap.
    if (skipped && gapDef?.required) {
      return jerror(`Gap "${gapId}" is required and cannot be skipped.`);
    }

    if (skipped) {
      // Store a sentinel value per gap type so isMissing() returns false.
      const field = fieldForGap(gapId);
      if (field?.startsWith('designDirection.')) {
        const key = field.split('.')[1];
        brandSystemUploads.designDirection = {
          [key]: key === 'confidenceScore' ? 0 : ['(skipped)'],
        };
      } else if (gapDef?.type === 'image-multi') {
        brandSystemUploads[field] = [{ skipped: true }];
      } else if (gapDef?.type === 'image') {
        brandSystemUploads[field] = { skipped: true };
      } else if (field) {
        brandSystemUploads[field] = '(skipped)';
      }

    } else if (gapId === 'logo') {
      const [visionResult, logoUploadUrl] = await Promise.all([
        analyzeLogo({ imageUrl, imageBase64, mediaType }),
        uploadBase64(clientId, 'logo', imageBase64, mediaType),
      ]);
      if (!visionResult.ok) return jerror(`vision_failed: ${visionResult.error}`, 502);
      if (imageUrl) brandSystemUploads.logoUrl = imageUrl;
      brandSystemUploads.logoVisionAnalysis = visionResult.vision;
      brandSystemUploads.logoVisionUsage    = visionResult.usage;
      if (logoUploadUrl) brandSystemUploads.uploadUrls = { logo: logoUploadUrl };
      await logVisionUsage({ gapId, usage: visionResult.usage, clientId });

    } else if (gapId === 'mood-board') {
      if (!images.length) return jerror('images array required for mood-board gap.');
      const capped = images.slice(0, gapDef?.maxFiles || 5);
      const [result, moodBoardUrls] = await Promise.all([
        analyzeMoodBoard(capped),
        uploadMultiBase64(clientId, 'mood-board', capped),
      ]);
      if (!result.ok) return jerror(`vision_failed: ${result.error}`, 502);
      brandSystemUploads.moodBoard = result.perImage.map((v) => ({ vision_analysis: v }));
      if (result.synthesis) brandSystemUploads.moodBoardSynthesis = result.synthesis;
      if (moodBoardUrls.length) brandSystemUploads.uploadUrls = { moodBoard: moodBoardUrls };
      await logVisionUsage({ gapId, usage: result.usage, clientId, metadata: { imageCount: capped.length } });

    } else if (gapId === 'brand-photos') {
      if (!images.length) return jerror('images array required for brand-photos gap.');
      const capped = images.slice(0, gapDef?.maxFiles || 10);
      const [result, brandPhotoUrls] = await Promise.all([
        analyzeBrandPhotos(capped),
        uploadMultiBase64(clientId, 'brand-photos', capped),
      ]);
      if (!result.ok) return jerror(`vision_failed: ${result.error}`, 502);
      brandSystemUploads.brandPhotos = [{ vision_analysis: result.vision }];
      brandSystemUploads.brandPhotoAnalysis = result.vision;
      if (brandPhotoUrls.length) brandSystemUploads.uploadUrls = { brandPhotos: brandPhotoUrls };
      await logVisionUsage({ gapId, usage: result.usage, clientId, metadata: { imageCount: capped.length } });

    } else if (gapId === 'competitor-refs') {
      if (!images.length) return jerror('images array required for competitor-refs gap.');
      const capped = images.slice(0, gapDef?.maxFiles || 5);
      const [result, competitorUrls] = await Promise.all([
        analyzeCompetitors(capped),
        uploadMultiBase64(clientId, 'competitor-refs', capped),
      ]);
      if (!result.ok) return jerror(`vision_failed: ${result.error}`, 502);
      brandSystemUploads.competitorRefs = [{ vision_analysis: result.vision }];
      brandSystemUploads.competitorAnalysis = result.vision;
      if (competitorUrls.length) brandSystemUploads.uploadUrls = { competitorRefs: competitorUrls };
      await logVisionUsage({ gapId, usage: result.usage, clientId, metadata: { imageCount: capped.length } });

    } else if (gapId === 'product-shots') {
      const capped = images.slice(0, gapDef?.maxFiles || 5);
      const productUrls = await uploadMultiBase64(clientId, 'product-shots', capped);
      brandSystemUploads.productShots = capped.length ? capped.map(() => ({})) : [{}];
      if (productUrls.length) brandSystemUploads.uploadUrls = { productShots: productUrls };

    } else if (gapId === 'color-palette') {
      const src = images[0] || { imageBase64, mediaType, imageUrl };
      if (!src.imageUrl && !src.imageBase64) return jerror('image required for color-palette gap.');
      const [result, paletteUrl] = await Promise.all([
        analyzePalette(src),
        uploadBase64(clientId, 'color-palette', src.imageBase64, src.mediaType || mediaType),
      ]);
      if (!result.ok) return jerror(`vision_failed: ${result.error}`, 502);
      brandSystemUploads.colorPalette = { vision_analysis: result.vision };
      brandSystemUploads.colorPaletteAnalysis = result.vision;
      if (paletteUrl) brandSystemUploads.uploadUrls = { colorPalette: paletteUrl };
      await logVisionUsage({ gapId, usage: result.usage, clientId });

    } else {
      // All remaining gaps — use fieldForGap to determine where to write.
      const field = fieldForGap(gapId);
      if (!field) return jerror(`No field mapping for gapId: ${gapId}`, 500);

      if (field.startsWith('designDirection.')) {
        const key = field.split('.')[1];
        let stored = value;
        if (key === 'keep' || key === 'change' || key === 'add') {
          stored = Array.isArray(value) ? value : [String(value)].filter(Boolean);
        } else if (key === 'confidenceScore') {
          stored = parseInt(String(value).split(' ')[0], 10) || null;
        }
        brandSystemUploads.designDirection = { [key]: stored };
      } else {
        brandSystemUploads[field] = value;
      }
    }

    await stateRef.set(
      {
        userUploads: { brandSystem: brandSystemUploads },
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  // ── Re-fetch + re-run mapper ───────────────────────────────────────────────
  const [stateSnap, clientSnap, configSnap] = await Promise.all([
    stateRef.get(),
    fb.adminDb.collection('clients').doc(clientId).get(),
    fb.adminDb.collection('client_configs').doc(clientId).get(),
  ]);
  const dashboardState = stateSnap.exists ? stateSnap.data() : {};
  const client = clientSnap.exists ? clientSnap.data() : null;
  const clientConfig = configSnap.exists ? configSnap.data() : {};
  const brandOverview = dashboardState.snapshot?.brandOverview || {};
  const sourceInputs = clientConfig.sourceInputs || {};
  const knowledgeBaseContext = await getKnowledgeBaseRuntimeContext({
    clientId,
    query: buildKnowledgeBaseRuntimeQuery({
      intent: 'brand system visual identity brand voice positioning audience product facts category',
      websiteUrl: sourceInputs.websiteUrl || client?.websiteUrl || '',
      clientName: client?.displayName || client?.companyName || brandOverview.headline || '',
      brandOverview,
      sourceInputs,
    }),
    topK: 5,
    charCap: 2600,
  });

  const mapperInput = {
    snapshot:        dashboardState.snapshot        || {},
    analyzerOutputs: dashboardState.analyzerOutputs || {},
    siteMeta:        dashboardState.siteMeta        || {},
    userUploads:     dashboardState.userUploads     || {},
    artifacts:       dashboardState.artifacts       || {},
    knowledgeBaseContext,
    client,
  };

  const result = mapPipelineToBrandSystem(mapperInput);

  // Present all gaps (required + optional) until none remain.
  if (result.gaps.length > 0) {
    return NextResponse.json(
      {
        clientId,
        done: false,
        nextGap: result.gaps[0],
        remaining: result.gaps.length,
        completeness: result.completeness,
      },
      { headers: { 'cache-control': 'no-store' } }
    );
  }

  // ── Assemble final output ──────────────────────────────────────────────────
  const generatedAt = new Date().toISOString();
  const uo = dashboardState?.userUploads?.brandSystem || {};
  const sources = {
    brandName:      result.filled.brand_header?.brand_name        ? 'pipeline' : 'user',
    brandStatement: result.filled.brand_header?.brand_statement   ? 'pipeline' : 'user',
    soulDescriptors: uo.soulDescriptors                           ? 'user'     : 'pipeline',
    colors:         result.filled.color_system?.foundation?.length ? 'pipeline' : 'user',
    typography:     result.filled.typography_system?.headline      ? 'pipeline' : 'user',
    logo:           uo.logoUrl                                     ? 'user-upload' : 'pipeline',
    visualLanguage: uo.visualLanguage                              ? 'user'     : 'inferred',
    lighting:       uo.lighting                                    ? 'user'     : 'inferred',
    material:       uo.material                                    ? 'user'     : 'inferred',
    brandArchetype: uo.brandArchetype                              ? 'user'     : 'inferred',
    colorMood:      uo.colorMood                                   ? 'user'     : 'inferred',
    designDirection: uo.designDirection                            ? 'user'     : 'inferred',
    moodBoard:      uo.moodBoard?.length                           ? 'vision'   : 'inferred',
    photoDirection: uo.photoDirection                              ? 'user'     : 'inferred',
    knowledgeBase: knowledgeBaseContext.available                  ? 'runtime-retrieval' : null,
  };

  const jsonV1 = buildBrandSystemJson({ filled: result.filled });
  const jsonV2 = buildBrandSystemJsonV2({ filled: result.filled, sources, generatedAt });
  const masterPrompt = buildMasterPrompt(jsonV1);

  let prompts = {};
  let promptsError = null;
  try {
    prompts = buildAllPrompts(jsonV2);
  } catch (err) {
    promptsError = err?.message || String(err);
    console.error('[brand-system/chat] buildAllPrompts failed:', promptsError);
  }

  // Select default prompt from user's target-output answer (if provided).
  const targetOutput = dashboardState?.userUploads?.brandSystem?.targetOutput || null;
  const selectedTemplateId = TARGET_OUTPUT_TO_TEMPLATE[targetOutput] || 'brand-poster';
  const selectedPrompt = prompts[selectedTemplateId] || masterPrompt;

  await stateRef.set(
    {
      brandSystem: {
        json:          jsonV1,
        jsonV2,
        masterPrompt,
        prompts,
        selectedPrompt,
        selectedTemplateId,
        sources,
        knowledgeBaseSources: knowledgeBaseContext.available ? knowledgeBaseContext.sources : [],
        generatedAt,
        schemaVersion: result.schemaVersion,
      },
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return NextResponse.json(
    {
      clientId,
      done: true,
      json:             jsonV1,
      jsonV2,
      masterPrompt,
      prompts,
      promptsError,
      selectedPrompt,
      selectedTemplateId,
      sources,
      knowledgeBaseSources: knowledgeBaseContext.available ? knowledgeBaseContext.sources : [],
      generatedAt,
      completeness: result.completeness,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
