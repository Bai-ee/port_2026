import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Serves a stored skill doc as a downloadable HTML file.
// Backed by dashboard_state.artifacts.skillDocs[skillId] (inline HTML/markdown).
// Vercel Hobby compatible — pure Firestore read, <1s.
export const maxDuration = 10;

const require = createRequire(import.meta.url);
const fb                    = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

/**
 * GET /api/dashboard/skill-doc?skillId=<id>&format=html|md
 *
 * Auth'd endpoint that returns a stored skill doc as a file download.
 * Used by the DATA tab to let users download the rendered audit.
 *
 * Default format is html. Pass ?format=md for the raw markdown.
 */
export async function GET(request) {
  // 1. Auth
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Unauthorized.' }, { status: 401 });
  }

  // 2. Resolve clientId
  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return NextResponse.json({ error: 'No user record.' }, { status: 404 });
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) return NextResponse.json({ error: 'No clientId on user record.' }, { status: 404 });

  // 3. Parse query
  const url    = new URL(request.url);
  const skillId = url.searchParams.get('skillId') || '';
  const format  = (url.searchParams.get('format') || 'html').toLowerCase();
  if (!skillId) return NextResponse.json({ error: 'skillId is required.' }, { status: 400 });
  if (format !== 'html' && format !== 'md') {
    return NextResponse.json({ error: 'format must be html or md.' }, { status: 400 });
  }

  // 4. Load doc from dashboard_state
  const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
  if (!dashSnap.exists) return NextResponse.json({ error: 'No dashboard state.' }, { status: 404 });

  const doc = dashSnap.data()?.artifacts?.skillDocs?.[skillId] || null;
  if (!doc) return NextResponse.json({ error: `No doc for skill '${skillId}'.` }, { status: 404 });

  const body        = format === 'md' ? (doc.markdown || '') : (doc.html || '');
  const contentType = format === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8';
  const baseName    = (doc.filename || `${skillId}.html`).replace(/\.html?$/i, '');
  const filename    = format === 'md' ? `${baseName}.md` : `${baseName}.html`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type':        contentType,
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control':       'no-store',
    },
  });
}
