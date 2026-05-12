import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { buildVisualDnaPromptBlock } from '../../../../features/leadgen/visual-dna.js';

export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { saveBufferArtifact } = require('../../../../api/_lib/storage-artifacts.cjs');
const { logUsage, computeAnthropicCost } = require('../../../../api/_lib/usage-logger.cjs');
const { analyzeVisualDnaSubject, VISION_MODEL } = require('../../../../features/scout-intake/modules/visual-dna-vision.js');

const DOMAINS = new Set(['food', 'product', 'location', 'lifestyle', 'people', 'environment']);

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

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'subject';
}

async function uploadImages(placeId, subjectId, images) {
  const urls = [];
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i];
    if (!img.imageBase64) continue;
    const mediaType = img.mediaType || 'image/jpeg';
    const ext = (mediaType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const buffer = Buffer.from(img.imageBase64, 'base64');
    const stored = await saveBufferArtifact({
      storagePath: `leadgen/${placeId}/visual-dna/${subjectId}-${i + 1}.${ext}`,
      buffer,
      contentType: mediaType,
      metadata: { artifactType: 'visual_dna_reference', placeId, subjectId },
    });
    urls.push(stored.downloadUrl);
  }
  return urls;
}

function mergeSubject(subjects, nextSubject) {
  const existing = Array.isArray(subjects) ? subjects : [];
  const idx = existing.findIndex((s) => s.id === nextSubject.id);
  if (idx === -1) return [...existing, nextSubject];
  return existing.map((s, i) => (i === idx ? { ...s, ...nextSubject } : s));
}

export async function GET(request) {
  try { await verifyRequestUser(makeReqShim(request)); }
  catch { return jerror('Unauthorized.', 401); }

  const url = new URL(request.url);
  const placeId = String(url.searchParams.get('placeId') || '').trim();
  if (!placeId) return jerror('placeId is required.');

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) return jerror(`Prospect not found: ${placeId}`, 404);

  return NextResponse.json(
    { placeId, visualDna: snap.data()?.visualDna || null },
    { headers: { 'cache-control': 'no-store' } }
  );
}

export async function POST(request) {
  try { await verifyRequestUser(makeReqShim(request)); }
  catch { return jerror('Unauthorized.', 401); }

  let body;
  try { body = await request.json(); }
  catch { return jerror('Invalid JSON body.'); }

  const placeId = String(body?.placeId || '').trim();
  const domain = String(body?.domain || '').trim();
  const subjectLabel = String(body?.subjectLabel || '').trim();
  const notes = String(body?.notes || '').trim();
  const images = Array.isArray(body?.images) ? body.images.slice(0, 12) : [];

  if (!placeId) return jerror('placeId is required.');
  if (!DOMAINS.has(domain)) return jerror('domain must be one of food, product, location, lifestyle, people, environment.');
  if (!subjectLabel) return jerror('subjectLabel is required.');
  if (!images.length) return jerror('At least one image is required.');

  const ref = fb.adminDb.collection('leadgen_prospects').doc(placeId);
  const snap = await ref.get();
  if (!snap.exists) return jerror(`Prospect not found: ${placeId}`, 404);

  const subjectId = slugify(subjectLabel);

  const [analysisResult, imageUrls] = await Promise.all([
    analyzeVisualDnaSubject({ domain, subjectLabel, notes, images }),
    uploadImages(placeId, subjectId, images),
  ]);

  if (!analysisResult.ok) return jerror(`vision_failed: ${analysisResult.error}`, 502);

  await logUsage({
    module: 'visual-dna',
    action: 'analyze-subject',
    provider: 'anthropic',
    model: VISION_MODEL,
    inputTokens: analysisResult.usage?.inputTokens || 0,
    outputTokens: analysisResult.usage?.outputTokens || 0,
    costUsd: computeAnthropicCost({
      model: VISION_MODEL,
      inputTokens: analysisResult.usage?.inputTokens || 0,
      outputTokens: analysisResult.usage?.outputTokens || 0,
    }),
    placeId,
    metadata: { domain, subjectLabel, imageCount: images.length },
  });

  const current = snap.data()?.visualDna || {};
  const subject = {
    id: subjectId,
    type: domain === 'food' ? 'dish' : 'subject',
    label: subjectLabel,
    domain,
    notes,
    status: 'ready',
    imageUrls,
    imageCount: imageUrls.length,
    analysis: analysisResult.analysis,
    aliases: analysisResult.analysis?.aliases || [],
    promptBlock: analysisResult.analysis?.promptBlock || '',
    updatedAt: new Date().toISOString(),
  };

  const nextVisualDna = {
    ...current,
    domain,
    status: 'ready',
    subjects: mergeSubject(current.subjects, subject),
    updatedAt: new Date().toISOString(),
  };
  nextVisualDna.masterPromptBlock = buildVisualDnaPromptBlock(nextVisualDna);

  await ref.update({
    visualDna: nextVisualDna,
    'generation.briefGeneratedAt': null,
  });

  return NextResponse.json(
    { placeId, visualDna: nextVisualDna, subject },
    { headers: { 'cache-control': 'no-store' } }
  );
}
