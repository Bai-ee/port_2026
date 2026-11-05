import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { buildInvoiceOgPreviewMeta } from '../../../../briefs/_lib/custom-briefs.js';
import { renderOgImageJpeg } from '../../../../briefs/_lib/og-image-render.js';

const require = createRequire(import.meta.url);
const { verifyAdminRequest } = require('../../../../../api/_lib/auth.cjs');

export const runtime = 'nodejs';

// Admin-only live preview of the OG share image for an UNSAVED Invoice
// Studio draft. Same renderer as the public /briefs/.../og-image route
// (app/briefs/_lib/og-image-render.js) over the same meta builder, so what
// the Publish card shows is byte-for-byte what gets shared. Writes nothing.
export async function POST(request) {
  try {
    await verifyAdminRequest({
      headers: {
        authorization: request.headers.get('authorization'),
        Authorization: request.headers.get('authorization'),
      },
    });
  } catch (error) {
    const status = error?.status || error?.statusCode || 401;
    return NextResponse.json({ error: error?.message || 'Unauthorized' }, { status });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.invoice || typeof body.invoice !== 'object') {
    return NextResponse.json({ error: 'invoice is required.' }, { status: 400 });
  }
  const meta = buildInvoiceOgPreviewMeta({
    title: body.title,
    invoice: body.invoice,
    ogLabel: body.ogLabel,
    ogSubhead: body.ogSubhead,
    hideOgSubhead: body.hideOgSubhead === true,
    ogLines: Array.isArray(body.ogLines) ? body.ogLines : [],
    ogTitleLines: Array.isArray(body.ogTitleLines) ? body.ogTitleLines : [],
    clientName: body.clientName,
  });
  const jpg = await renderOgImageJpeg(meta);
  return new Response(jpg, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(jpg.length),
      'cache-control': 'no-store, max-age=0',
    },
  });
}
