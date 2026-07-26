import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { createAnthropicClient } = require('../../../../../features/not-the-rug-brief/anthropic-client.js');
const { saveBufferArtifact } = require('../../../../../api/_lib/storage-artifacts.cjs');

import { CANONICAL_VERTICALS } from '../../../../../features/strategy-builder/normalize-vertical.js';
import {
  buildKnowledgeBaseRuntimeQuery,
  getKnowledgeBaseRuntimeContext,
} from '../../../../../features/knowledge-base/pipeline-context.js';

// Keep the agent's own specific term — just tidy formatting. Canonicalisation
// to a holiday bucket happens downstream (Strategy Builder), not here.
function cleanLabel(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/["'`.]/g, '')
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export const maxDuration = 120;

async function generateCategoryCardImage({ clientId, category, brandName, brandSummary, rationale }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[market-category/image] OPENAI_API_KEY not set');
    return null;
  }

  const nameHint = brandName ? ` for a brand called "${brandName}"` : '';
  const rationaleHint = rationale ? ` Context: ${rationale}` : '';
  const prompt =
    `Editorial marketing intelligence card image representing the "${category}" market sector${nameHint}.` +
    ` Cinematic, moody, high-contrast photograph with strong visual identity — evocative of the sector, not literal.` +
    ` No text, no logos, no people's faces. Square composition. Dark, premium atmosphere.${rationaleHint}`;

  let imageBuffer;
  try {
    const imgRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1024x1024' }),
    });
    if (!imgRes.ok) {
      const errBody = await imgRes.text().catch(() => '');
      console.error(`[market-category/image] API HTTP ${imgRes.status}:`, errBody);
      return null;
    }
    const imgData = await imgRes.json();
    const b64 = imgData?.data?.[0]?.b64_json;
    if (!b64) {
      console.error('[market-category/image] No b64_json in response:', JSON.stringify(imgData).slice(0, 200));
      return null;
    }
    imageBuffer = Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('[market-category/image] Image generation error:', err.message);
    return null;
  }

  try {
    const storagePath = `clients/${clientId}/card-images/market-category.png`;
    const artifact = await saveBufferArtifact({
      storagePath,
      buffer: imageBuffer,
      contentType: 'image/png',
      metadata: { category, generatedAt: new Date().toISOString() },
    });
    console.log('[market-category/image] Stored at:', artifact.downloadUrl);
    return artifact.downloadUrl;
  } catch (err) {
    console.error('[market-category/image] Storage upload error:', err.message);
    return null;
  }
}

const MODEL = 'claude-sonnet-4-6';

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function cap(v, n = 400) {
  const s = String(v || '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const clientId = context.clientId;

  let dsData = {};
  let ccData = {};
  let prospectData = {};
  try {
    const [dsSnap, ccSnap, prospectSnap] = await Promise.all([
      fb.adminDb.collection('dashboard_state').doc(clientId).get(),
      fb.adminDb.collection('client_configs').doc(clientId).get(),
      fb.adminDb.collection('leadgen_prospects').doc(`client:${clientId}`).get(),
    ]);
    dsData = dsSnap.exists ? (dsSnap.data() || {}) : {};
    ccData = ccSnap.exists ? (ccSnap.data() || {}) : {};
    prospectData = prospectSnap.exists ? (prospectSnap.data() || {}) : {};
  } catch (err) {
    return json({ error: `Firestore error: ${err.message}` }, 500);
  }

  const siteMeta = dsData.siteMeta || {};
  const brandOverview = dsData.snapshot?.brandOverview || {};
  const scribeBrief = dsData.snapshot?.scribe?.brief || {};
  const marketingBrief = dsData.marketingBrief || {};
  const leadgen = dsData.leadgen || {};
  const sourceInputs = ccData.sourceInputs || {};

  const kbQuery = buildKnowledgeBaseRuntimeQuery({
    intent: 'market category industry vertical product business model offer audience positioning',
    websiteUrl: leadgen.website || sourceInputs.websiteUrl || '',
    clientName: ccData.displayName || ccData.companyName || leadgen.businessName || leadgen.name || '',
    brandOverview,
    sourceInputs,
  });
  const knowledgeBase = await getKnowledgeBaseRuntimeContext({
    clientId,
    query: kbQuery,
    topK: 5,
    charCap: 2800,
  });

  // Compact evidence — the social-preview OG fields are the strongest signal.
  const evidence = {
    ogTitle: cap(siteMeta.title, 160),
    ogDescription: cap(siteMeta.description, 300),
    ogSiteName: cap(siteMeta.siteName, 80),
    ogType: cap(siteMeta.type, 40),
    brandName: cap(brandOverview.name || leadgen.businessName || leadgen.name, 120),
    brandHeadline: cap(brandOverview.headline, 200),
    brandIndustry: cap(brandOverview.industry, 120),
    businessModel: cap(brandOverview.businessModel, 120),
    brandSummary: cap(brandOverview.summary, 400),
    positioning: cap(scribeBrief.positioning, 240),
    audience: cap(scribeBrief.audience || scribeBrief.targetAudience, 200),
    marketingHeadline: cap(marketingBrief.headline, 200),
    scoutBrief: cap(marketingBrief?.scoutBrief?.humanBrief, 600),
    website: cap(leadgen.website || sourceInputs.websiteUrl, 200),
    offers: Array.isArray(leadgen.offers) ? leadgen.offers.slice(0, 8).map((o) => cap(o, 60)) : [],
    ideaDescription: cap(sourceInputs.ideaDescription, 400),
    priorVertical: cap(leadgen.vertical || prospectData.vertical, 60),
    knowledgeBase: knowledgeBase.available ? cap(knowledgeBase.block, 3000) : '',
  };

  const hasEvidence = Boolean(
    evidence.ogTitle || evidence.ogDescription || evidence.brandIndustry ||
    evidence.brandSummary || evidence.brandHeadline || evidence.positioning ||
    evidence.marketingHeadline || evidence.scoutBrief || evidence.website ||
    evidence.offers.length || evidence.ideaDescription || evidence.priorVertical ||
    knowledgeBase.available
  );

  if (!hasEvidence) {
    return json({
      ok: true,
      enough: false,
      message: 'Not enough pipeline data yet. Run earlier cards (Social Preview, Brand Snapshot, Marketing Brief) or set the category manually below.',
    });
  }

  const prompt = `Determine the single most accurate market category for this business from evidence gathered by other dashboard cards and the client Knowledge Base.

The client Knowledge Base is the master source of truth for product facts, business model, audience, category language, positioning, and offer details. Prefer it over inferred website metadata when it is specific and relevant. Website and Open Graph evidence still describe what is currently visible on the live site.

Be SPECIFIC and faithful to what the business actually is — do NOT force it into a broad bucket. A real-money poker site is "poker" (not "e-games" and not generic "gambling"); a sportsbook is "sportsbook"; an esports team is "esports"; a wine bar is "wine-bar". Choose the precise term a human would use for this exact business.

These common categories exist elsewhere in the product as a convenience, but you are NOT limited to them — only use one if it is genuinely the most accurate term:
${CANONICAL_VERTICALS.join(', ')}

Output the category as a concise lowercase kebab-case phrase (1–3 words).

EVIDENCE (JSON):
${JSON.stringify(evidence)}

Return ONLY this JSON, no prose, no markdown:
{"category":"<specific kebab phrase>","confidence":<0..1>,"rationale":"<one short sentence>","evidence":["<short cited field>","..."]}`;

  let parsed;
  try {
    const anthropic = createAnthropicClient();
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: 'You are a precise market-category classifier. Return only valid JSON. No markdown.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp?.content?.[0]?.text || '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return json({ error: `Category analysis failed: ${err.message}` }, 502);
  }

  const rawCategory = String(parsed?.category || '').trim();
  if (!rawCategory) {
    return json({
      ok: true,
      enough: false,
      message: 'Could not infer a category from current data. Set it manually below.',
    });
  }

  const value = cleanLabel(rawCategory);
  if (!value) {
    return json({
      ok: true,
      enough: false,
      message: 'Could not infer a category from current data. Set it manually below.',
    });
  }
  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence) || 0));
  const rationale = cap(parsed?.rationale, 240);
  const evidenceList = Array.isArray(parsed?.evidence)
    ? parsed.evidence.slice(0, 5).map((e) => cap(e, 120))
    : [];

  const cardImageUrl = await generateCategoryCardImage({
    clientId,
    category: value,
    brandName: evidence.brandName || '',
    brandSummary: evidence.brandSummary || '',
    rationale,
  });

  const marketCategory = {
    value,
    source: 'agent',
    confidence,
    rationale,
    evidence: evidenceList,
    knowledgeBaseSources: knowledgeBase.available ? knowledgeBase.sources : [],
    updatedAtIso: new Date().toISOString(),
    ...(cardImageUrl ? { cardImageUrl } : {}),
  };

  try {
    await fb.adminDb.collection('dashboard_state').doc(clientId).set(
      { marketCategory },
      { merge: true }
    );
  } catch (err) {
    return json({ error: `Firestore error: ${err.message}` }, 500);
  }

  return json({ ok: true, enough: true, marketCategory });
}
