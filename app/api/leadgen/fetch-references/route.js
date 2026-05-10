// POST /api/leadgen/fetch-references
//   body: { placeId: string }
//   → streams NDJSON: Lazyweb search per section → stores metadata in Firestore
//
// Fetches design reference screenshots from Lazyweb for the prospect's vertical.
// Stores reference metadata at generation.designReferences (not base64 — too large).
// generate-site will re-fetch images at generation time using LAZYWEB_TOKEN.

import { createRequire } from 'module';
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

import { fetchDesignReferences, formatReferencesForBrief } from '../../../../features/leadgen/design-references.js';

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

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
  const vertical = prospect.vertical || 'default';
  const prospectScreenshotUrl = prospect.onboard?.multiDeviceView?.desktopUrl || null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      emit({ type: 'start', vertical });

      try {
        const { references, meta } = await fetchDesignReferences({
          vertical,
          prospectScreenshotUrl,
          onProgress: (label) => emit({ type: 'progress', stage: 'references', label }),
        });

        emit({ type: 'progress', stage: 'persist', label: `Saving ${meta.totalImages} references…` });

        const refSummary = references.map(r => ({
          section:    r.section,
          query:      r.query,
          imageCount: r.images?.length || 0,
          images: (r.images || []).map(img => ({
            company:     img.meta?.company     || null,
            category:    img.meta?.category    || null,
            description: img.meta?.description || null,
          })),
        }));

        const briefNote = formatReferencesForBrief(references);

        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          'generation.designReferences': { summary: refSummary, briefNote, meta },
          // onboard.designReferences mirrors the status shape used by the module card dot
          'onboard.designReferences': {
            status:     'succeeded',
            imageCount: meta.totalImages,
            sections:   meta.sectionsSearched,
            runAt:      meta.fetchedAt,
          },
        });

        emit({ type: 'progress', stage: 'persist', label: 'References saved.' });
        emit({
          type: 'done',
          status: 'succeeded',
          result: { totalImages: meta.totalImages, sections: meta.sectionsSearched, briefNote },
        });

      } catch (err) {
        console.error('[fetch-references] error:', err);
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
