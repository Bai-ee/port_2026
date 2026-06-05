import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  try {
    const clientId = await digestConfig.resolveDigestClientId();
    const config = await digestConfig.getDigestConfig(clientId);
    let docs = [];
    if (clientId) {
      try {
        const result = await digestConfig.getRecentDocsText({
          clientId, count: config.recentDocsCount, maxChars: config.maxDocChars,
        });
        docs = result.docs;
      } catch {
        docs = [];
      }
    }
    return json({ ok: true, clientId, config, docs });
  } catch (err) {
    return json({ error: err.message || 'Could not load digest config.' }, 500);
  }
}

export async function POST(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Forbidden.' }, 403);
  }

  try {
    const clientId = await digestConfig.resolveDigestClientId();
    if (!clientId) {
      return json({ error: 'No digest client resolved. Set DIGEST_CLIENT_ID or a client owned by DIGEST_EMAIL.' }, 400);
    }
    const patch = await request.json().catch(() => ({}));
    const config = await digestConfig.saveDigestConfig(clientId, patch);
    return json({ ok: true, clientId, config });
  } catch (err) {
    return json({ error: err.message || 'Could not save digest config.' }, 500);
  }
}
