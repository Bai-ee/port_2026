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

function cleanHex(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(normalized) ? normalized : '';
}

function cleanText(value, max = 240) {
  return String(value || '').trim().slice(0, max);
}

function cleanLogoUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('data:image/') && raw.length < 750000) return raw;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? raw.slice(0, 1200) : '';
  } catch {
    return '';
  }
}

function normalizeColor(input = {}, fallback = {}) {
  return {
    ...fallback,
    hex: cleanHex(input.hex) || cleanHex(fallback.hex),
    role: cleanText(input.role || fallback.role, 180),
  };
}

function normalizeStyleGuide(input = {}, fallback = {}) {
  return {
    ...fallback,
    confidence: 'manual',
    source: 'brand-snapshot-data-tab',
    updatedByUser: true,
    updatedAtIso: new Date().toISOString(),
    summary: cleanText(input.summary || fallback.summary, 1000),
    assets: {
      ...(fallback.assets || {}),
      logoUrl: cleanLogoUrl(input.assets?.logoUrl || fallback.assets?.logoUrl),
      logoAlt: cleanText(input.assets?.logoAlt || fallback.assets?.logoAlt || 'Brand mark', 160),
    },
    colors: {
      ...(fallback.colors || {}),
      primary: normalizeColor(input.colors?.primary, fallback.colors?.primary),
      secondary: normalizeColor(input.colors?.secondary, fallback.colors?.secondary),
      tertiary: normalizeColor(input.colors?.tertiary, fallback.colors?.tertiary),
      neutral: normalizeColor(input.colors?.neutral, fallback.colors?.neutral),
    },
    typography: {
      ...(fallback.typography || {}),
      headingSystem: {
        ...(fallback.typography?.headingSystem || {}),
        fontFamily: cleanText(input.typography?.headingSystem?.fontFamily || fallback.typography?.headingSystem?.fontFamily, 220),
        fontWeight: cleanText(input.typography?.headingSystem?.fontWeight || fallback.typography?.headingSystem?.fontWeight, 60),
        fontSize: cleanText(input.typography?.headingSystem?.fontSize || fallback.typography?.headingSystem?.fontSize, 60),
      },
      bodySystem: {
        ...(fallback.typography?.bodySystem || {}),
        fontFamily: cleanText(input.typography?.bodySystem?.fontFamily || fallback.typography?.bodySystem?.fontFamily, 220),
        fontWeight: cleanText(input.typography?.bodySystem?.fontWeight || fallback.typography?.bodySystem?.fontWeight, 60),
        fontSize: cleanText(input.typography?.bodySystem?.fontSize || fallback.typography?.bodySystem?.fontSize, 60),
      },
    },
    gradient: {
      ...(fallback.gradient || {}),
      from: cleanHex(input.gradient?.from || fallback.gradient?.from),
      to: cleanHex(input.gradient?.to || fallback.gradient?.to),
      angle: cleanText(input.gradient?.angle || fallback.gradient?.angle || '135deg', 40),
    },
  };
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

  const dashboardRef = fb.adminDb.collection('dashboard_state').doc(context.clientId);
  const configRef = fb.adminDb.collection('client_configs').doc(context.clientId);
  const dashSnap = await dashboardRef.get();
  const dash = dashSnap.exists ? dashSnap.data() || {} : {};
  const fallback = dash?.snapshot?.visualIdentity?.styleGuide || {};
  const styleGuide = normalizeStyleGuide(body?.styleGuide || {}, fallback);

  const now = fb.FieldValue.serverTimestamp();
  await Promise.all([
    dashboardRef.set(
      {
        snapshot: {
          ...(dash.snapshot || {}),
          visualIdentity: {
            ...(dash.snapshot?.visualIdentity || {}),
            styleGuide,
          },
        },
        brandSnapshotOverrides: {
          styleGuide,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    ),
    configRef.set(
      {
        brandSnapshotConfig: {
          styleGuide,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);

  return json({ ok: true, clientId: context.clientId, styleGuide });
}
