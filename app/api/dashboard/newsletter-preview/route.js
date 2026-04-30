import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const { renderNewsletterHtml, renderGenericTemplate } = require('../../../../features/newsletter/newsletter-renderer.cjs');
const { getRenderedNewsletter } = require('../../../../features/newsletter/store.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type':  'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'pragma':        'no-cache',
    },
  });
}

function errorPage(status, message) {
  return htmlResponse(
    `<!doctype html><meta charset="utf-8"><title>${message}</title><pre style="font:14px/1.5 system-ui;padding:24px;">${message}</pre>`,
    status
  );
}

/**
 * GET /api/dashboard/newsletter-preview
 *
 * Serves the rendered newsletter HTML for iframe preview on the dashboard.
 *
 * Strategy:
 *   1. Try to serve the pre-rendered HTML from the newsletter store (fastest).
 *   2. If not available, re-render from dashboard_state.newsletter.content on the fly.
 *   3. If neither exists, serve a generic template with sample content.
 *
 * Accepts ?template=generic query param to force the generic template.
 */
export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return errorPage(401, err instanceof Error ? err.message : 'Unauthorized.');
  }

  const bootstrap = await getDashboardBootstrap(decoded.uid);
  const clientId = bootstrap?.userProfile?.clientId || null;
  const dash = bootstrap?.dashboardState || null;
  if (!clientId) return errorPage(404, 'No client record for user.');
  if (!dash) return errorPage(404, 'No dashboard_state for client — run the pipeline first.');

  // ── 0. Force generic template via query param ─────────────────────
  const { searchParams } = new URL(request.url);
  const clientName = dash.clientName || bootstrap?.userProfile?.businessName || clientId;
  if (searchParams.get('template') === 'generic') {
    return htmlResponse(renderGenericTemplate({ clientName }));
  }

  // ── 1. Try pre-rendered HTML from filesystem store ──────────────────
  const cachedHtml = await getRenderedNewsletter(clientId);
  if (cachedHtml) {
    return htmlResponse(cachedHtml);
  }

  // ── 2. Try re-rendering from dashboard_state newsletter content ─────
  const newsletterContent = dash.newsletter?.content;
  if (!newsletterContent || !newsletterContent.hero_story) {
    // ── 3. Fallback: serve generic template with sample content ────────
    return htmlResponse(renderGenericTemplate({ clientName }));
  }

  // Load client config for schema resolution
  let resolvedConfig = {};
  try {
    const configSnap = await fb.adminDb.collection('client_configs').doc(clientId).get();
    if (configSnap.exists) resolvedConfig = configSnap.data() || {};
  } catch { /* non-fatal — use defaults */ }

  const html = renderNewsletterHtml({
    content: newsletterContent,
    clientName: dash.clientName || bootstrap?.userProfile?.businessName || clientId,
    alertLevel: dash.newsletter?.alertLevel || 'QUIET',
    date: dash.newsletter?.timestamp || new Date(),
    config: resolvedConfig,
  });

  return htmlResponse(html);
}
