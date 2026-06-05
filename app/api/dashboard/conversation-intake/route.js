import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../api/_lib/client-provisioning.cjs');
const { parseConversation } = require('../../../../features/scout-intake/conversation-parser');
const { saveConversationIntake, getConversationIntake } = require('../../../../features/scout-intake/conversation-intake-store');

function getProviderFactory() {
  return require('../../../../features/not-the-rug-brief/providers');
}

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

// Compact "what matters" string fed to the parser as relevance context.
// Reuses the Marketing Brief config the Scout already runs on, so intake
// relevance and brief relevance stay aligned (same marketing bucket).
function buildRelevanceContext(clientConfig) {
  const mb = clientConfig?.marketingBriefConfig || {};
  const lines = [];
  if (String(mb.sourceFocus || '').trim()) lines.push(`Focus: ${String(mb.sourceFocus).trim()}`);
  if (String(mb.scoutInstructions || '').trim()) lines.push(`Scout instructions: ${String(mb.scoutInstructions).trim()}`);
  const competitors = String(mb.competitors || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (competitors.length) lines.push(`Competitors to watch: ${competitors.join(', ')}`);
  const kols = String(mb.kols || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (kols.length) lines.push(`Watched accounts: ${kols.join(', ')}`);
  const idea = String(clientConfig?.sourceInputs?.ideaDescription || '').trim();
  if (idea) lines.push(`Business: ${idea}`);
  return lines.join('\n');
}

export async function GET(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }
  const intake = await getConversationIntake(context.clientId);
  return json({ ok: true, intake: intake || null });
}

export async function POST(request) {
  let decoded, context;
  try {
    ({ decoded, context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const body = await request.json().catch(() => ({}));
  const rawText = String(body?.rawText || '').trim();
  if (!rawText) return json({ error: 'No conversation text provided.' }, 400);

  const configSnap = await fb.adminDb.collection('client_configs').doc(context.clientId).get();
  const clientConfig = configSnap.exists ? configSnap.data() || {} : {};

  try {
    const { initProvider } = getProviderFactory();
    const provider = initProvider(clientConfig?.providerConfig || { defaultProvider: 'anthropic' });
    const relevanceContext = buildRelevanceContext(clientConfig);

    const { items, rawCharCount } = await parseConversation({ rawText, relevanceContext, provider });

    const intake = {
      items,
      itemCount: items.length,
      rawCharCount,
      digestedAtIso: new Date().toISOString(),
      digestedByUid: decoded.uid,
    };
    await saveConversationIntake(context.clientId, intake);

    return json({ ok: true, intake });
  } catch (err) {
    return json({ error: err?.message || 'Conversation digest failed.' }, 500);
  }
}
