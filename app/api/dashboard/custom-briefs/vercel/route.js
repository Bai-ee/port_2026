import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyAdminRequest } = require('../../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../../api/_lib/client-provisioning.cjs');
const { launchCustomBriefToVercel } = require('../../../../../api/_lib/vercel-briefs.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function compactPathSlug(value, fallback = 'brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug || String(fallback || 'brief').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'brief';
}

function compactClientSlug(value, fallback = 'client') {
  const words = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 2 && ['shop', 'store', 'restaurant', 'llc', 'inc', 'co', 'company', 'ltd'].includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join('') || String(fallback || 'client').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'client';
}

function clientDisplayName(client, fallback = '') {
  return client?.companyName || client?.name || client?.dashboardTitle || client?.displayName || fallback;
}

function briefDescription(brief, clientName) {
  const description = String(brief.description || '').trim();
  if (description) return description.slice(0, 240);
  return `Custom brief for ${clientName || 'this client'}.`;
}

function normalizeOrigin(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function deploymentPublicOrigin(request) {
  return normalizeOrigin(
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL
  ) || request.nextUrl.origin;
}

function validCustomBriefKey(value) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(String(value || ''));
}

async function resolveCustomBriefDoc(clientId, briefKey) {
  const briefsRef = fb.adminDb
    .collection('clients')
    .doc(clientId)
    .collection('custom_briefs');

  const direct = await briefsRef.doc(briefKey).get();
  if (direct.exists) return direct;

  const publicSlugSnapshot = await briefsRef
    .where('publicBriefSlug', '==', briefKey)
    .limit(1)
    .get();
  if (!publicSlugSnapshot.empty) return publicSlugSnapshot.docs[0];

  const existingSnapshot = await briefsRef.limit(100).get();
  return existingSnapshot.docs.find((doc) => {
    const data = doc.data() || {};
    return compactPathSlug(data.publicBriefSlug || data.briefSlug || doc.id, doc.id) === briefKey ||
      compactPathSlug(data.title || '', doc.id) === briefKey;
  }) || null;
}

export async function POST(request) {
  try {
    const decoded = await verifyAdminRequest(makeReqShim(request));
    const bootstrap = await getDashboardBootstrap({
      uid: decoded.uid,
      email: decoded.email,
      request,
    });
    const clientId = bootstrap?.effectiveClientId || bootstrap?.client?.clientId || bootstrap?.client?.id;
    if (!clientId) {
      return NextResponse.json({ error: 'No effective client is selected.' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const briefKey = String(body.briefId || body.briefSlug || body.id || '').trim();
    if (!briefKey || !validCustomBriefKey(briefKey)) {
      return NextResponse.json({ error: 'A valid brief id is required.' }, { status: 400 });
    }

    const snapshot = await resolveCustomBriefDoc(clientId, briefKey);
    if (!snapshot?.exists) {
      return NextResponse.json({ error: 'Custom brief not found.' }, { status: 404 });
    }

    const brief = snapshot.data() || {};
    if (!brief.html) {
      return NextResponse.json({ error: 'Custom brief has no HTML to deploy.' }, { status: 400 });
    }

    const client = bootstrap?.client || {};
    const clientSlug = brief.publicClientSlug || compactClientSlug(
      client.publicClientSlug || client.publicSlug || client.slug || clientDisplayName(client, clientId),
      clientId
    );
    const publicBriefSlug = brief.publicBriefSlug || compactPathSlug(brief.briefSlug || snapshot.id, snapshot.id);
    const publicPath = `/briefs/${encodeURIComponent(clientSlug)}/${encodeURIComponent(publicBriefSlug)}`;
    const publicUrl = `${deploymentPublicOrigin(request)}${publicPath}`;
    const imageUrl = `${publicUrl}/og-image`;
    const title = brief.title || brief.briefSlug || snapshot.id;
    const description = briefDescription(brief, clientDisplayName(client, clientId));

    const result = await launchCustomBriefToVercel({
      clientSlug,
      briefSlug: publicBriefSlug,
      title,
      description,
      publicUrl,
      imageUrl,
      imageAlt: `${title} preview image`,
      html: String(brief.html),
    });

    const now = fb.FieldValue.serverTimestamp();
    const vercel = {
      projectName: result.projectName || '',
      deploymentId: result.deployment?.id || result.deployment?.uid || '',
      readyState: result.deployment?.readyState || result.deployment?.state || '',
      url: result.url || '',
      inspectorUrl: result.inspectorUrl || '',
      deployedAt: now,
      deployedBy: decoded.email || decoded.uid || 'admin',
    };

    await snapshot.ref.set({
      vercel,
      vercelUrl: vercel.url,
      updatedAt: now,
    }, { merge: true });

    return NextResponse.json({
      ok: true,
      clientId,
      briefId: snapshot.id,
      vercel: {
        ...vercel,
        deployedAt: new Date().toISOString(),
      },
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not launch custom brief on Vercel.';
    const status = /^Unauthorized/i.test(message) ? 401 : /^Forbidden/i.test(message) ? 403 : Number(error?.status) || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
