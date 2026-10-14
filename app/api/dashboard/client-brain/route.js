import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('./_context.cjs');
const { compileAndSaveClientBrainMarkdown, getClientBrain, saveClientBrain, listBrainVersions, readBrainVersion } = require('../../../../features/client-brain/store.cjs');
const { createClientBrainMarkdownTemplate } = require('../../../../features/client-brain/markdown.cjs');
const { onBrainStatusChanged } = require('../../../../features/client-brain/brain-sync.cjs');

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveDashboardClientContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (action === 'versions' || action === 'version') {
    try {
      if (action === 'versions') return json({ ok: true, versions: await listBrainVersions(context.clientId) });
      const version = await readBrainVersion(context.clientId, url.searchParams.get('ts'));
      if (!version) return json({ error: 'Version not found.' }, 404);
      return json({ ok: true, version });
    } catch (err) {
      return json({ error: err.message || 'Could not load Client Brain versions.' }, err.status || 500);
    }
  }

  try {
    const { brain } = await getClientBrain(context.clientId);
    const markdownSource = brain?.markdownSource || createClientBrainMarkdownTemplate({
      clientId: context.clientId,
      clientName: brain?.identity?.name || context.client?.companyName || context.client?.name || '',
    });
    return json({ ok: true, clientId: context.clientId, brain, markdownSource });
  } catch (err) {
    return json({ error: err.message || 'Could not load Client Brain.' }, err.status || 500);
  }
}

export async function POST(request) {
  let context;
  let decoded;
  try {
    ({ context, decoded } = await resolveDashboardClientContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  try {
    const brain = typeof body?.markdownSource === 'string'
      ? await compileAndSaveClientBrainMarkdown(context.clientId, body.markdownSource, { reason: 'inject', byUid: decoded?.uid || null })
      : await saveClientBrain(context.clientId, body?.brain || {});
    // An injected approved Brain adopts current settings once, then syncs.
    let brainSync = null;
    if (typeof body?.markdownSource === 'string') {
      try {
        brainSync = await onBrainStatusChanged(context.clientId, brain);
      } catch (err) {
        brainSync = { error: err.message };
      }
    }
    return json({ ok: true, clientId: context.clientId, brain, brainSync });
  } catch (err) {
    return json({ error: err.message || 'Could not save Client Brain.' }, err.status || 500);
  }
}
