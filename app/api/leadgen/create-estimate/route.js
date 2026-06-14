import { createRequire } from 'module';
import { randomUUID } from 'crypto';
import { generateEstimate } from '../../../../features/leadgen/estimate-generator.js';
import { verifyEstimate } from '../../../../features/leadgen/estimate-verifier.js';
import { renderEstimateHtml } from '../../../../features/leadgen/estimate-renderer.js';

export const maxDuration = 180;

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const { persistBriefPdfArtifact } = require('../../../../api/_lib/browserless.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function resolveProspectClientId(placeId, prospect) {
  if (prospect?.clientId) return prospect.clientId;
  const match = String(placeId || '').match(/^client:(.+)$/);
  return match ? match[1] : null;
}

function safeFilePart(value, fallback = 'estimate') {
  return String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || fallback;
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyAdminRequest(makeReqShim(request));
  } catch {
    return new Response(JSON.stringify({ type: 'error', message: 'Unauthorized.' }) + '\n', {
      status: 401,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  let body;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return new Response(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const placeId = String(body?.placeId || '').trim();
  if (!placeId) {
    return new Response(JSON.stringify({ type: 'error', message: 'Provide placeId.' }) + '\n', {
      status: 400,
      headers: { 'Content-Type': 'application/x-ndjson' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      emit({ type: 'start', websiteUrl: placeId });

      try {
        emit({ type: 'progress', stage: 'load-context', label: 'Loading prospect and estimate defaults...' });
        const prospectRef = fb.adminDb.collection('leadgen_prospects').doc(placeId);
        const prospectSnap = await prospectRef.get();
        if (!prospectSnap.exists) throw new Error(`Prospect not found: ${placeId}`);
        const prospect = prospectSnap.data() || {};
        const clientId = resolveProspectClientId(placeId, prospect);
        if (!clientId) throw new Error('Could not resolve clientId for estimate.');

        const gen = prospect.generation || {};
        if (!gen.designMd) throw new Error('No creative brief found - run Prepare Brief first.');
        if (!gen.previewUrl) throw new Error('No generated site preview found - run Generate Site first.');

        const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
        const clientConfig = configSnap.exists ? configSnap.data() || {} : {};
        const estimateConfig = clientConfig.estimateBriefConfig || {};

        emit({ type: 'progress', stage: 'build-estimate', label: 'Building structured estimate...' });
        const estimate = generateEstimate({
          prospect,
          config: estimateConfig,
          overrides: body?.overrides || {},
          generatedByUid: decoded.uid,
        });
        const versionId = `est_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

        emit({ type: 'progress', stage: 'verify-estimate', label: 'Verifying totals and proof claims...' });
        const verification = verifyEstimate(estimate, {
          previewUrl: gen.previewUrl || '',
          readinessComparison: gen.readinessComparison || null,
        });
        if (!verification.ok) throw new Error(`Estimate verification failed: ${verification.errors.join(' ')}`);

        emit({ type: 'progress', stage: 'render-html', label: 'Rendering estimate brief...' });
        const html = renderEstimateHtml(estimate, { clientId, placeId, versionId });

        emit({ type: 'progress', stage: 'render-pdf', label: 'Rendering PDF artifact...' });
        const pdf = await persistBriefPdfArtifact({
          clientId,
          runId: versionId,
          html,
          fileName: `${safeFilePart(prospect.name)}-estimate.pdf`,
          storageClientKey: clientId,
          storageBriefKey: `estimates/${versionId}`,
          pdfMode: 'edge-to-edge',
        });
        if (!pdf.ok) {
          emit({ type: 'progress', stage: 'render-pdf', label: pdf.warning?.message || 'PDF render skipped.' });
        }

        const latest = {
          versionId,
          status: 'generated',
          generatedAt: estimate.generatedAt,
          generatedByUid: decoded.uid,
          templateConfigSnapshot: estimate.templateConfigSnapshot || {},
          estimateJson: estimate,
          html,
          pdfArtifact: pdf.ok ? pdf.artifactRef : null,
          pdfWarning: pdf.ok ? null : (pdf.warning || null),
          sendMessage: estimate.sendMessage,
          proof: estimate.proof,
          verification,
        };
        const versionSummary = {
          versionId,
          generatedAt: estimate.generatedAt,
          total: estimate.total,
          currency: estimate.currency,
          label: estimate.title,
          pdfStoragePath: pdf.ok ? pdf.artifactRef.storagePath : null,
          pdfDownloadUrl: pdf.ok ? pdf.artifactRef.downloadUrl : null,
        };

        emit({ type: 'progress', stage: 'persist', label: 'Saving estimate and version history...' });
        await prospectRef.set(
          {
            generation: {
              estimate: {
                currentVersionId: versionId,
                latest,
                versions: fb.FieldValue.arrayUnion(versionSummary),
              },
            },
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );

        emit({
          type: 'done',
          status: 'succeeded',
          result: {
            versionId,
            total: estimate.total,
            currency: estimate.currency,
            pdfUrl: pdf.ok ? pdf.artifactRef.downloadUrl : null,
            warnings: verification.warnings,
          },
        });
      } catch (err) {
        console.error('[create-estimate] error:', err);
        emit({ type: 'error', message: err.message || 'Estimate generation failed.' });
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
