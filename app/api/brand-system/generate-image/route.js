import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { callOpenAiImages } = require('../../../../features/scout-intake/_openai-client.js');
const { logUsage, computeImageCost } = require('../../../../api/_lib/usage-logger.cjs');

// Map templateId → gpt-image-1 size.
const TEMPLATE_SIZES = {
  'brand-poster':    '1024x1536', // portrait
  'storyboard':      '1536x1024', // landscape
  'product-shots':   '1024x1024', // square
  'web-design':      '1536x1024', // landscape
  'character-sheet': '1024x1024', // square
  'social-media':    '1024x1024', // square
};

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

/**
 * POST /api/brand-system/generate-image
 *
 * Body: { prompt, templateId }
 *
 * Returns: { b64, mediaType, size, templateId, generatedAt }
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

  const { prompt, templateId = 'brand-poster' } = body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return jerror('prompt is required.');
  }

  let clientId = null;
  try {
    const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
    clientId = context.clientId || null;
  } catch (err) {
    return jerror(err.message || 'Forbidden.', err.status || 403);
  }

  const size    = TEMPLATE_SIZES[templateId] || '1024x1024';
  const quality = 'medium';
  const model   = 'gpt-image-1';

  let openAiResponse;
  try {
    openAiResponse = await callOpenAiImages({
      model,
      prompt: prompt.trim(),
      n: 1,
      size,
      quality,
    });
  } catch (err) {
    console.error('[brand-system/generate-image] OpenAI error:', err.message);
    return jerror(`image_generation_failed: ${err.message}`, 502);
  }

  const b64 = openAiResponse?.data?.[0]?.b64_json;
  if (!b64) {
    return jerror('OpenAI returned no image data.', 502);
  }

  const generatedAt = new Date().toISOString();

  // Persist b64 reference to Firestore so the dashboard can surface it later.
  if (clientId) {
    try {
      await fb.adminDb.collection('dashboard_state').doc(clientId).set(
        {
          brandSystem: {
            generatedImage: { templateId, size, generatedAt },
          },
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      // Non-fatal — image still returned to client.
      console.warn('[brand-system/generate-image] Firestore write failed:', err.message);
    }
  }

  await logUsage({
    module:     'brand-system',
    action:     'generate-image',
    provider:   'openai',
    model,
    imageCount: 1,
    costUsd:    computeImageCost({ model, size, quality, count: 1 }),
    clientId,
    metadata:   { templateId, size, quality },
  });

  return NextResponse.json(
    { b64, mediaType: 'image/png', size, templateId, generatedAt },
    { headers: { 'cache-control': 'no-store' } }
  );
}
