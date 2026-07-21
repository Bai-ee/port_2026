import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { renderClonePage } = require('../../../../api/_lib/clone-demo.cjs');
const { getCloneJob } = require('../../../../api/_lib/clone-jobs.cjs');

// HITLOOP-hosted live demo of a recreated site (Site Recreate card).
// Public read: the jobId is an unguessable capability token
// (clone_<ts>_<hex>) and the content is the user's own public site. Rendering
// = stored template + current slot values (clone_demo.cjs) — edits made in
// the card's content editor appear on refresh. Assets/media are served by the
// job's static Vercel preview, not this route.
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { jobId, path: segs } = await params;
  if (!/^clone_[a-z0-9_]+$/i.test(String(jobId || ''))) {
    return new Response('Not found', { status: 404 });
  }
  const slug = !segs || !segs.length
    ? 'home'
    : segs.join('-').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();

  // /sites/<jobId>/admin — natural guess for "where do I edit this?".
  // Redirect to the real Payload admin when the CMS is hosted; otherwise
  // explain where editing lives instead of a bare 404.
  if (slug === 'admin') {
    const job = await getCloneJob(jobId).catch(() => null);
    const adminUrl = job?.cms?.hostedAdminUrl || (job?.cms?.hostedUrl ? `${job.cms.hostedUrl}/admin` : null);
    if (adminUrl) return Response.redirect(adminUrl, 302);
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Admin not hosted yet</title>
      <body style="font-family:ui-monospace,monospace;max-width:560px;margin:15vh auto;padding:0 20px;line-height:1.6">
      <h1 style="font-size:18px">This demo doesn't have a hosted admin yet.</h1>
      <p>Text edits: use <strong>EDIT CONTENT</strong> on the Site Recreate card in your
      <a href="/dashboard">HITLOOP dashboard</a>.</p>
      <p>For the full WYSIWYG admin on a public URL, click
      <strong>HOST LIVE — SITE + ADMIN</strong> on the card — the admin link and login
      appear there when provisioning completes.</p></body>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
    );
  }
  try {
    const html = await renderClonePage(jobId, slug);
    if (!html) return new Response('Not found', { status: 404 });
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // The mirrored theme inlines scripts/styles; keep the demo iframable
        // by the dashboard card if we ever want an embedded preview.
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (err) {
    return new Response(`Demo render failed: ${err.message}`, { status: 500 });
  }
}
