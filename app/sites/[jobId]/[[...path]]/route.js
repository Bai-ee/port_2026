import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { renderClonePage } = require('../../../../api/_lib/clone-demo.cjs');

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
