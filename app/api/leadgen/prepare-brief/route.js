import { NextResponse }  from 'next/server';
import { createRequire } from 'module';

// Scrapes prospect website + builds DESIGN.MD creative brief.
// Streams NDJSON progress so the panel can show live updates.
export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

import { scrapeClientContent } from '../../../../features/leadgen/content-scraper.js';
import { generateDesignMd }    from '../../../../features/leadgen/design-md-generator.js';
import { buildAssetManifest, getGbpPhotoUrls, makeClientSlug } from '../../../../features/leadgen/asset-manager.js';
import {
  buildKnowledgeBaseRuntimeQuery,
  getKnowledgeBaseRuntimeContext,
} from '../../../../features/knowledge-base/pipeline-context.js';

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const c = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { return new URL(c).toString(); } catch { return null; }
}

function resolveProspectClientId(placeId, prospect) {
  if (prospect?.clientId) return prospect.clientId;
  const match = String(placeId || '').match(/^client:(.+)$/);
  return match ? match[1] : null;
}

// POST /api/leadgen/prepare-brief
//   body: { placeId: string }
//   → streams NDJSON: scrape + DESIGN.MD generation
export async function POST(request) {
  try { await verifyAdminRequest(makeReqShim(request)); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Unauthorized.' }) + '\n', { status: 401, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  let body;
  try { body = await request.json().catch(() => ({})); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  const placeId        = String(body?.placeId || '').trim();
  const useBrandSystem = body?.useBrandSystem !== false; // ON by default
  const useDesignEval  = body?.useDesignEval !== false;  // ON by default
  if (!placeId) return new Response(JSON.stringify({ type: 'error', message: 'Provide placeId.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } });

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) return new Response(JSON.stringify({ type: 'error', message: `Prospect not found: ${placeId}` }) + '\n', { status: 404, headers: { 'Content-Type': 'application/x-ndjson' } });

  const prospect   = snap.data();
  const websiteUrl = normalizeUrl(prospect.website);
  if (!websiteUrl) return new Response(JSON.stringify({ type: 'error', message: 'Prospect has no valid website URL.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      emit({ type: 'start', websiteUrl });

      try {
        // ── Step 1: Fetch + scrape ─────────────────────────────────────
        emit({ type: 'progress', stage: 'fetch', label: 'Connecting to website…' });
        const content = await scrapeClientContent(websiteUrl, { businessName: prospect.name, placeId });

        if (content.meta.warnings.length) {
          for (const w of content.meta.warnings) {
            emit({ type: 'progress', stage: 'fetch', label: `⚠ ${w}` });
          }
        }

        // ── Step 2: Report what was found ──────────────────────────────
        emit({ type: 'progress', stage: 'analyze', label: 'Extracting copy and structure…' });

        const headline  = content.copy.heroHeadline;
        const services  = content.copy.serviceNames.length;
        const testimonials = content.copy.testimonials.length;
        const hasLogo   = !!content.assets.logo?.url;
        const heroImgs  = content.assets.heroImages.length;

        emit({ type: 'progress', stage: 'analyze', label: `Found: ${services} services · ${testimonials} testimonials · hero ${headline ? `"${headline.slice(0, 40)}…"` : 'not detected'}` });
        emit({ type: 'progress', stage: 'analyze', label: `Assets: logo ${hasLogo ? '✓' : '✗'} · ${heroImgs} hero image${heroImgs !== 1 ? 's' : ''} · ${content.assets.sectionImages.length} section images` });

        // ── Step 3: Build asset manifest ──────────────────────────────
        emit({ type: 'progress', stage: 'assets', label: 'Planning asset manifest…' });
        const assetManifest = buildAssetManifest(content.assets);

        // GBP photo fallback when site has no hero images
        if (assetManifest.heroImages.length === 0) {
          emit({ type: 'progress', stage: 'assets', label: 'No hero images found — checking Google Business Profile photos…' });
          const gbpUrls = await getGbpPhotoUrls(placeId, { maxPhotos: 3 });
          gbpUrls.forEach((url, i) => {
            assetManifest.heroImages.push({ url, targetFile: `assets/gbp-${i + 1}.jpg`, localPath: `assets/gbp-${i + 1}.jpg`, alt: prospect.name, source: 'gbp' });
          });
          if (gbpUrls.length) {
            emit({ type: 'progress', stage: 'assets', label: `Added ${gbpUrls.length} GBP photo${gbpUrls.length !== 1 ? 's' : ''} as hero images.` });
          }
        }

        const totalAssets = [assetManifest.logo, ...assetManifest.heroImages, ...assetManifest.sectionImages].filter(Boolean).length;
        emit({ type: 'progress', stage: 'assets', label: `Manifest ready — ${totalAssets} asset${totalAssets !== 1 ? 's' : ''} queued for download at generation time.` });

        // ── Step 4: Build DESIGN.MD ────────────────────────────────────
        emit({ type: 'progress', stage: 'brief', label: 'Building creative brief…' });
        const brandGuide = useBrandSystem
          ? (prospect.brandGuide || prospect.userUploads?.brandSystem?.brandGuideV2 || null)
          : null;
        const prospectClientId = resolveProspectClientId(placeId, prospect);
        const knowledgeBaseContext = prospectClientId
          ? await getKnowledgeBaseRuntimeContext({
              clientId: prospectClientId,
              query: buildKnowledgeBaseRuntimeQuery({
                intent: 'leadgen generated site offer structure proof points FAQ product truth audience positioning services',
                websiteUrl,
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
        const designRefs = prospect.generation?.designReferences || null;
        const onboardForBrief = { ...(prospect.onboard || {}) };
        if (!useDesignEval) {
          delete onboardForBrief.designEval;
        }
        if (!useBrandSystem || !useDesignEval) {
          emit({ type: 'progress', stage: 'brief', label: `Building without ${[!useBrandSystem && 'Brand System', !useDesignEval && 'Design Eval'].filter(Boolean).join(' + ')}` });
        }
        const designMd = generateDesignMd({
          prospect,
          onboard:          onboardForBrief,
          content,
          assetManifest,
          brandSystem:      brandGuide,
          designReferences: designRefs,
          visualDna:        prospect.visualDna || null,
          knowledgeBaseContext,
        });

        const lines = designMd.split('\n').length;
        emit({ type: 'progress', stage: 'brief', label: `Brief drafted — ${lines} lines · ${prospect.vertical} vertical · colors ${content.colors.primary || 'default'}` });

        // ── Step 4: Persist to Firestore ───────────────────────────────
        emit({ type: 'progress', stage: 'persist', label: 'Saving brief to Firestore…' });

        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          'generation.designMd':            designMd,
          'generation.knowledgeBaseSources': knowledgeBaseContext?.available ? knowledgeBaseContext.sources : [],
          'generation.contentJson':         JSON.stringify(content),
          'generation.assetManifest':       assetManifest,
          'generation.briefGeneratedAt':    new Date().toISOString(),
          'generation.briefLines':          lines,
          stage: prospect.stage === 'generating' ? 'audited' : (prospect.stage || 'audited'),
        });

        emit({ type: 'progress', stage: 'persist', label: 'Brief saved.' });

        emit({
          type: 'done',
          status: 'succeeded',
          result: {
            lines,
            headline,
            services,
            testimonials,
            hasLogo,
            heroImages: heroImgs,
            primaryColor: content.colors.primary,
            warnings: content.meta.warnings,
          },
        });

      } catch (err) {
        console.error('[prepare-brief] error:', err);
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
