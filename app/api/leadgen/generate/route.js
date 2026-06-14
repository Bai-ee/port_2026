import { NextResponse }   from 'next/server';
import { createRequire }  from 'module';
import { writeFileSync }  from 'fs';
import path               from 'path';

// Full pipeline: scrape → assets → DESIGN.MD → HTML → deploy → comparison.
// Runs synchronously in one request. Max ~3 min on Vercel Pro.
export const maxDuration = 300;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');

import { scrapeClientContent }              from '../../../../features/leadgen/content-scraper.js';
import { makeClientSlug, ensureClientDir, downloadAssets, fetchGbpPhotos, listDownloadedAssets } from '../../../../features/leadgen/asset-manager.js';
import { generateDesignMd }                 from '../../../../features/leadgen/design-md-generator.js';
import { generateSite }                     from '../../../../features/leadgen/site-generator.js';
import { deployPreview }                    from '../../../../features/leadgen/deploy-preview.js';
import { runReadinessComparison, formatComparison } from '../../../../features/leadgen/readiness-comparison.js';
import { syncClientFolder, subdir }         from '../../../../features/leadgen/client-folder.js';

const CLIENTS_ROOT = process.env.VERCEL
  ? '/tmp/clients'
  : path.join(process.cwd(), 'clients');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try { return new URL(candidate).toString(); } catch { return null; }
}

// POST /api/leadgen/generate
//   body: { placeId: string, skipDeploy?: boolean, skipComparison?: boolean }
//   → runs the full site generation pipeline for one prospect
export async function POST(request) {
  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let body;
  try { body = await request.json().catch(() => ({})); } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const placeId       = String(body?.placeId       || '').trim();
  const skipDeploy    = body?.skipDeploy    === true;
  const skipComparison = body?.skipComparison === true;

  if (!placeId) return NextResponse.json({ error: 'Provide placeId.' }, { status: 400 });

  // ── Load prospect ────────────────────────────────────────────────────────
  const prospectRef = fb.adminDb.collection('leadgen_prospects').doc(placeId);
  const snap = await prospectRef.get();
  if (!snap.exists) return NextResponse.json({ error: `Prospect not found: ${placeId}` }, { status: 404 });

  const prospect = snap.data();
  const websiteUrl = normalizeUrl(prospect.website);

  if (!websiteUrl) return NextResponse.json({ error: 'Prospect has no valid website URL.' }, { status: 400 });
  if (!prospect.onboard) return NextResponse.json({ error: 'Run ONBOARD first before generating.' }, { status: 409 });

  const slug = makeClientSlug(prospect);
  await prospectRef.update({ stage: 'generating', generationStartedAt: new Date().toISOString(), generationSlug: slug });

  const stepLog = [];
  function log(step, data = {}) {
    const entry = { step, t: new Date().toISOString(), ...data };
    stepLog.push(entry);
    console.log(`[leadgen/generate] ${step}`, data);
  }

  try {
    // ── Step 0: Materialize client folder + write onboarding snapshot ─────
    await ensureClientDir(slug);
    const onboardingDir = subdir(slug, 'onboarding');
    writeFileSync(path.join(onboardingDir, 'prospect.json'),        JSON.stringify(prospect, null, 2),         'utf8');
    writeFileSync(path.join(onboardingDir, 'onboard-answers.json'), JSON.stringify(prospect.onboard || {}, null, 2), 'utf8');
    if (prospect.audit) {
      writeFileSync(path.join(onboardingDir, 'audit.json'), JSON.stringify(prospect.audit, null, 2), 'utf8');
    }
    await syncClientFolder(slug, {
      name:     prospect.name || null,
      placeId,
      website:  websiteUrl,
      stage:    'generating',
    });

    // ── Step 1: Scrape content ─────────────────────────────────────────────
    log('scrape.start', { websiteUrl });
    const scrapedContent = await scrapeClientContent(websiteUrl, { businessName: prospect.name, placeId });
    log('scrape.done', { warnings: scrapedContent.meta.warnings });

    writeFileSync(path.join(subdir(slug, 'scraped'), 'content.json'), JSON.stringify(scrapedContent, null, 2), 'utf8');
    await syncClientFolder(slug, {});

    // ── Step 2: Download assets ────────────────────────────────────────────
    log('assets.start');
    let assetManifest = await downloadAssets(slug, scrapedContent.assets);

    // GBP photo fallback if no hero/section images came through
    const hasImages = (assetManifest.heroImages?.length || 0) + (assetManifest.sectionImages?.length || 0);
    if (!hasImages) {
      log('assets.gbp-fallback', { placeId });
      await fetchGbpPhotos(placeId, { slug, maxPhotos: 5 });
      const gbpFiles = (await listDownloadedAssets(slug)).filter(f => f.startsWith('gbp-'));
      if (gbpFiles.length) {
        assetManifest.heroImages = gbpFiles.slice(0, 1).map(f => ({ localPath: `assets/${f}`, filename: f, source: 'gbp' }));
        assetManifest.sectionImages = gbpFiles.slice(1).map(f => ({ localPath: `assets/${f}`, filename: f, source: 'gbp' }));
      }
    }
    log('assets.done', { logo: !!assetManifest.logo?.localPath, heroImages: assetManifest.heroImages?.length, sectionImages: assetManifest.sectionImages?.length });

    // ── Step 3: Generate DESIGN.MD ─────────────────────────────────────────
    log('brief.start');
    const designMdContent = generateDesignMd({
      prospect,
      onboard:       prospect.onboard,
      content:       scrapedContent,
      assetManifest,
    });
    writeFileSync(path.join(subdir(slug, 'brief'), 'DESIGN.MD'), designMdContent, 'utf8');
    await syncClientFolder(slug, {});
    log('brief.done', { lines: designMdContent.split('\n').length });

    // Persist DESIGN.MD to Firestore so the dashboard can show/edit it
    await prospectRef.update({ 'generation.designMd': designMdContent, 'generation.designMdGeneratedAt': new Date().toISOString() });

    // ── Step 4: Generate site HTML via Claude ──────────────────────────────
    log('html.start', { model: 'claude-sonnet-4-6' });
    const genResult = await generateSite(slug);
    await syncClientFolder(slug, {});
    log('html.done', { issues: genResult.validationIssues, tokens: genResult.usage });

    // ── Step 5: Deploy to Vercel ───────────────────────────────────────────
    let previewMeta = null;
    if (!skipDeploy) {
      log('deploy.start');
      previewMeta = await deployPreview(slug);
      log('deploy.done', { url: previewMeta.previewUrl });
      await prospectRef.update({
        stage:    'ready',
        previewUrl: previewMeta.previewUrl,
        'generation.previewUrl':  previewMeta.previewUrl,
        'generation.deployId':    previewMeta.deployId,
        'generation.deployedAt':  previewMeta.deployedAt,
      });
      await syncClientFolder(slug, { stage: 'ready', previewUrl: previewMeta.previewUrl });
    }

    // ── Step 6: Before/after readiness comparison ──────────────────────────
    let comparison = null;
    if (!skipDeploy && !skipComparison && previewMeta?.previewUrl) {
      log('comparison.start', { previewUrl: previewMeta.previewUrl });
      comparison = await runReadinessComparison({ prospect, previewUrl: previewMeta.previewUrl });
      log('comparison.done', { improvement: comparison.improvement });
      console.log(formatComparison(comparison));

      await prospectRef.update({ 'generation.readinessComparison': comparison });
      writeFileSync(path.join(subdir(slug, 'comparison'), 'readiness.json'), JSON.stringify(comparison, null, 2), 'utf8');
      await syncClientFolder(slug, {});
    }

    return NextResponse.json({
      ok: true,
      placeId,
      slug,
      steps: stepLog,
      previewUrl:  previewMeta?.previewUrl || null,
      comparison,
      validationIssues: genResult.validationIssues,
      tokenUsage:  genResult.usage,
    });

  } catch (err) {
    console.error('[leadgen/generate] pipeline error:', err);
    await prospectRef.update({ stage: 'audited', generationError: err.message }).catch(() => {});
    return NextResponse.json({ ok: false, error: err.message, steps: stepLog }, { status: 500 });
  }
}
