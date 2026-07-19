// Public, cached render of HITLOOP's latest Creative Brief (the onboarding
// composition) for the homepage deliverables hover card. Hardcoded to the
// HITLOOP client — no clientId param, so no other client's data is reachable.
//
// Mirrors scripts/render-creative-brief.mjs but as an HTTP route, so the card
// always reflects the latest brief that's been run (within the cache window)
// instead of a committed static snapshot. Firebase asset URLs are served live
// (they're public, token-based) so no asset localization is needed.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/* Dev only: evict the stateless composer-config module so edits to it show
   without a dev-server restart (same pattern as brief-preview's STALE_CJS). */
if (process.env.NODE_ENV !== 'production') {
  for (const key of Object.keys(require.cache)) {
    if (/scout-intake[\\/]creative-brief-config\.cjs$/.test(key)) delete require.cache[key];
  }
}

const fb = require('../../../../api/_lib/firebase-admin.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // run on each request; CDN caches via Cache-Control below

// The HITLOOP client (dashboard_state doc id). hitloop.agency.
const CLIENT_ID = 'bryan-balli-WUoltG84';
const CLIENT_NAME = 'HITLOOP';

// Cover-summary fallback when the client hasn't generated one — the upsell
// "Recommended final version" from docs/ONBOARDING_UPSELL_SUMMARY.md.
const UPSELL_FINAL = [
  "Hello, thanks for signing up! We've turned your onboarding into a first-pass creative baseline built around what people actually see first. That includes your site across devices, a polished device mockup, a social share preview, a motion/video mockup, and a concise AI summary of how your current presence reads today.",
  'This gives us a practical starting point for improvement. Instead of guessing, we can now see how the brand presents across screens, how it shares, and where the message or visuals need work. From here, the highest-value next steps are usually a stronger landing page, a clearer brand system, a social/content launch package, or a more fully managed creative and growth engagement.',
].join('\n');

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Edge-cache the render: fresh within ~10 min, serve stale up to a day
      // while revalidating, so Firebase is read at most once per window.
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=86400',
    },
  });
}

export async function GET(request) {
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(CLIENT_ID).get();
    if (!snap.exists) {
      return htmlResponse('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px;color:#555">Creative Brief unavailable.</body>', 404);
    }
    const dash = snap.data() || {};

    const moduleBriefs = dash.moduleBriefs?.items || [];
    const auditMockupUrl = dash.artifacts?.homepageDeviceMockup?.downloadUrl || null;
    const studioVideoUrl = (() => {
      const caps = Array.isArray(dash.studioCaptures) ? dash.studioCaptures : [];
      for (let i = caps.length - 1; i >= 0; i -= 1) {
        if (caps[i]?.type === 'studio_video' && caps[i]?.downloadUrl) return caps[i].downloadUrl;
      }
      return null;
    })();
    const socialPreviewImageUrl = dash.siteMeta?.ogImage || null;
    const coverSummary = dash.briefSummaries?.onboarding?.summary || UPSELL_FINAL;

    // renderMarketingBriefHtml lives in the (authed) brief-preview route; import
    // it dynamically so this public route stays decoupled from that route graph.
    const { renderMarketingBriefHtml } = await import('../../dashboard/brief-preview/route.js');

    // Honor the Creative Brief composer config (admin card) here too, so the
    // public sample matches what new signups get. Defaults on failure.
    // ?layout=classic|simple overrides the saved layout only (toggles/order
    // stay saved-state) — lets the composer preview a layout before saving it.
    const { loadCreativeBriefConfig } = require('../../../../features/scout-intake/creative-brief-config.cjs');
    let creativeBriefConfig = await loadCreativeBriefConfig(fb.adminDb);
    const layoutOverride = new URL(request.url).searchParams.get('layout');
    if (layoutOverride === 'classic' || layoutOverride === 'simple') {
      creativeBriefConfig = { ...creativeBriefConfig, layout: layoutOverride };
    }

    // ?fit=1 (composer preview only): the preview iframe is sized to its
    // content height, which makes 100vh INSIDE the iframe equal the full
    // document height — every poster page balloons and the measurement loop
    // diverges (blank stretched preview). Cap page min-heights so the
    // content-sized iframe converges; real brief renders are untouched.
    const fitMode = new URL(request.url).searchParams.get('fit') === '1';

    let html = renderMarketingBriefHtml({
      creativeBriefConfig,
      marketingBrief: dash.marketingBrief || null,
      clientName: CLIENT_NAME,
      websiteUrl: dash.websiteUrl || 'https://hitloop.agency',
      generatedAt: dash.marketingBrief?.generatedAtIso || new Date().toISOString(),
      clientId: null,
      tier: dash.tier || 'free',
      moduleBriefs,
      auditMockupUrl,
      studioVideoUrl,
      socialPreviewImageUrl,
      siteMeta: dash.siteMeta || null,
      briefType: 'onboarding',
      coverSummary,
      displayLabel: 'Creative Brief',
    });

    if (fitMode) {
      // Cap poster pages only — simple-layout sections (.sb-sec) are already
      // content-height and must NOT be inflated to the cap.
      html = html.replace('</head>', '<style>section.page:not(.sb-sec){min-height:min(100vh,860px) !important}</style></head>');
    }

    return htmlResponse(html);
  } catch (err) {
    console.error('[public/hitloop-creative-brief] render failed:', err);
    return htmlResponse('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px;color:#555">Creative Brief temporarily unavailable.</body>', 500);
  }
}
