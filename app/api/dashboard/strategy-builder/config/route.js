import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

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

export async function POST(request) {
  let context;
  try {
    ({ context } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const clientConfig = body?.config;
  if (!clientConfig || typeof clientConfig !== 'object') {
    return json({ error: 'config object is required.' }, 400);
  }

  // Sanitize the per-source enable map — only {key:{enabled:bool}} entries.
  const rawSources = (clientConfig.sources && typeof clientConfig.sources === 'object')
    ? clientConfig.sources
    : {};
  const sources = {};
  for (const [key, val] of Object.entries(rawSources)) {
    if (typeof key === 'string' && key.length <= 60) {
      sources[key] = { enabled: val?.enabled !== false };
    }
  }

  // Sanitize user-supplied events (used by the events signal provider).
  const events = (Array.isArray(clientConfig.events) ? clientConfig.events : [])
    .filter((e) => e && e.name && e.date)
    .slice(0, 50)
    .map((e, i) => ({
      id: String(e.id || `evt-${i}`).slice(0, 60),
      name: String(e.name).slice(0, 80),
      date: String(e.date).slice(0, 30),
    }));

  // Sanitize Campaign Setup — operational inputs the model can't infer.
  const rawCampaign = (clientConfig.campaign && typeof clientConfig.campaign === 'object')
    ? clientConfig.campaign
    : {};
  const OBJECTIVES = ['awareness', 'bookings', 'foot-traffic', 'leads', 'promotions', 'community'];
  const EMOJI = ['none', 'sparing', 'liberal'];
  const timeOk = (t) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')) ? String(t) : '');
  const promotions = (Array.isArray(rawCampaign.promotions) ? rawCampaign.promotions : [])
    .filter((p) => p && p.label && p.endDate)
    .slice(0, 20)
    .map((p, i) => ({
      id: String(p.id || `promo-${i}`).slice(0, 60),
      label: String(p.label).slice(0, 80),
      endDate: String(p.endDate).slice(0, 30),
    }));
  const campaign = {
    objective: OBJECTIVES.includes(rawCampaign.objective) ? rawCampaign.objective : '',
    ctaText: String(rawCampaign.ctaText || '').slice(0, 80),
    ctaUrl: String(rawCampaign.ctaUrl || '').slice(0, 300),
    postTime: timeOk(rawCampaign.postTime),
    postTime2: timeOk(rawCampaign.postTime2),
    guardrails: String(rawCampaign.guardrails || '').slice(0, 500),
    emojiPolicy: EMOJI.includes(rawCampaign.emojiPolicy) ? rawCampaign.emojiPolicy : 'none',
    maxHashtags: Math.max(0, Math.min(5, Number(rawCampaign.maxHashtags) ?? 2)),
    promotions,
  };

  // Sanitize before saving — only known fields
  const safeConfig = {
    vertical: String(clientConfig.vertical || '').slice(0, 100),
    days: Math.max(7, Math.min(90, Number(clientConfig.days) || 30)),
    postsPerDay: Math.max(1, Math.min(5, Number(clientConfig.postsPerDay) || 1)),
    baselineMixPct: Math.max(10, Math.min(60, Number(clientConfig.baselineMixPct) || 40)),
    rampAggressiveness: Math.max(0, Math.min(1, Number(clientConfig.rampAggressiveness) ?? 0.5)),
    signals: {
      weather: { enabled: Boolean(clientConfig.signals?.weather?.enabled) },
      events: { enabled: Boolean(clientConfig.signals?.events?.enabled) },
      holidays: { enabled: clientConfig.signals?.holidays?.enabled !== false },
    },
    sources,
    campaign,
    savedAt: new Date().toISOString(),
  };

  await fb.adminDb.collection('dashboard_state').doc(context.clientId).set(
    { strategyBuilder: { config: safeConfig, events } },
    { merge: true }
  );

  return json({ ok: true, clientId: context.clientId });
}
