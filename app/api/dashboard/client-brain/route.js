import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('./_context.cjs');
const { compileAndSaveClientBrainMarkdown, getClientBrain, saveClientBrain } = require('../../../../features/client-brain/store.cjs');
const { createClientBrainMarkdownTemplate } = require('../../../../features/client-brain/markdown.cjs');

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
  try {
    ({ context } = await resolveDashboardClientContext(request));
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
      ? await compileAndSaveClientBrainMarkdown(context.clientId, body.markdownSource)
      : await saveClientBrain(context.clientId, body?.brain || {});
    return json({ ok: true, clientId: context.clientId, brain });
  } catch (err) {
    return json({ error: err.message || 'Could not save Client Brain.' }, err.status || 500);
  }
}
