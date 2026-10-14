import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { resolveDashboardClientContext } = require('../_context.cjs');
const { getForm, saveForm } = require('./_handlers.cjs');

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
    return json(await getForm(context.clientId));
  } catch (err) {
    return json({ error: err.message || 'Could not load the Brain form.' }, err.status || 500);
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
    const clientName = context.client?.companyName || context.client?.name || '';
    return json(await saveForm(context.clientId, body?.fields, { byUid: decoded?.uid || null, clientName }));
  } catch (err) {
    if (err?.name === 'FormValidationError') return json({ error: err.message, details: err.details }, 400);
    return json({ error: err.message || 'Could not save the Brain form.' }, err.status || 500);
  }
}
