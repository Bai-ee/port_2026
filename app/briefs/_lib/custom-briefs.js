import { createRequire } from 'module';

const require = createRequire(import.meta.url);
export const fb = require('../../../api/_lib/firebase-admin.cjs');

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function validId(value) {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(String(value || ''));
}

export function compactClientSlug(value, fallback = 'client') {
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

export function compactPathSlug(value, fallback = 'brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug || String(fallback || 'brief').replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'brief';
}

export function clientDisplayName(client, fallback = '') {
  return client?.companyName || client?.name || client?.dashboardTitle || client?.displayName || fallback;
}

export function titlePdfFileName(value, fallback = 'Custom Brief') {
  const base = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const safeBase = base || fallback;
  return `${safeBase.slice(0, 120)}.pdf`;
}

export function contentDispositionFileName(fileName) {
  const safe = titlePdfFileName(fileName).replace(/"/g, "'");
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function resolveClientId(clientKey, briefSlug) {
  const direct = await fb.adminDb.collection('clients').doc(clientKey).get();
  if (direct.exists) return clientKey;

  const alias = await fb.adminDb.collection('brief_client_slugs').doc(clientKey).get();
  if (alias.exists && alias.data()?.clientId) {
    return String(alias.data().clientId);
  }

  const publicSlugSnapshot = await fb.adminDb
    .collection('clients')
    .where('publicClientSlug', '==', clientKey)
    .limit(1)
    .get();
  if (!publicSlugSnapshot.empty) return publicSlugSnapshot.docs[0].id;

  const briefSnapshot = await fb.adminDb
    .collectionGroup('custom_briefs')
    .where('publicClientSlug', '==', clientKey)
    .limit(10)
    .get();
  if (!briefSnapshot.empty) {
    const matched = briefSnapshot.docs.find((doc) => doc.id === briefSlug || doc.data()?.briefSlug === briefSlug);
    const parent = matched?.ref.parent.parent;
    if (parent?.id) return parent.id;
  }

  const clientsSnapshot = await fb.adminDb.collection('clients').limit(500).get();
  const matchedClient = clientsSnapshot.docs.find((doc) => {
    const data = doc.data() || {};
    const derived = compactClientSlug(
      data.publicClientSlug || data.publicSlug || data.slug || clientDisplayName(data, doc.id),
      doc.id
    );
    return derived === clientKey;
  });
  if (matchedClient) return matchedClient.id;

  return null;
}

export async function resolveBriefSnapshot(clientId, briefKey) {
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

  const hyphenated = String(briefKey || '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  if (hyphenated && hyphenated !== briefKey) {
    const hyphenDirect = await briefsRef.doc(hyphenated).get();
    if (hyphenDirect.exists) return hyphenDirect;
  }

  const existingSnapshot = await briefsRef.limit(100).get();
  const matched = existingSnapshot.docs.find((doc) => {
    const data = doc.data() || {};
    return compactPathSlug(data.publicBriefSlug || data.briefSlug || doc.id, doc.id) === briefKey ||
      compactPathSlug(data.title || '', doc.id) === briefKey;
  });
  return matched || null;
}

export async function resolvePublicBrief(clientKey, briefKey) {
  if (!validId(clientKey) || !validId(briefKey)) return null;

  const clientId = await resolveClientId(clientKey, briefKey);
  if (!clientId) return null;

  const snapshot = await resolveBriefSnapshot(clientId, briefKey);
  if (!snapshot?.exists) return null;

  const brief = snapshot.data() || {};
  if (brief.public === false) return null;

  const clientSnapshot = await fb.adminDb.collection('clients').doc(clientId).get();
  return {
    clientId,
    client: clientSnapshot.exists ? clientSnapshot.data() || {} : {},
    snapshot,
    brief,
  };
}

export function publicBriefPath({ clientId, client, brief, snapshotId }) {
  const publicClientSlug = brief.publicClientSlug || compactClientSlug(
    client?.publicClientSlug || client?.publicSlug || client?.slug || clientDisplayName(client, clientId),
    clientId
  );
  const publicBriefSlug = brief.publicBriefSlug || compactPathSlug(brief.briefSlug || snapshotId, snapshotId);
  return `/briefs/${encodeURIComponent(publicClientSlug)}/${encodeURIComponent(publicBriefSlug)}`;
}

export function briefDescription(brief, clientName) {
  const description = String(brief.description || '').trim();
  if (description) return description.slice(0, 240);
  return `Custom brief for ${clientName || 'this client'}.`;
}

export function briefOgLabel(brief) {
  const label = String(brief?.ogLabel || '').trim();
  return (label || 'BRYAN BALLI').slice(0, 80);
}

export function buildBriefOpenGraphMeta({ origin, clientId, client, brief, snapshotId }) {
  const clientName = clientDisplayName(client, clientId);
  const publicPath = publicBriefPath({ clientId, client, brief, snapshotId });
  const title = String(brief.title || brief.briefSlug || snapshotId || 'Custom Brief').trim();
  const description = briefDescription(brief, clientName);
  const publicUrl = `${origin}${publicPath}`;
  const imageUrl = `${publicUrl}/og-image`;
  return {
    title,
    description,
    clientName,
    publicPath,
    publicUrl,
    imageUrl,
    imageAlt: `${title} preview image`,
    hideOgSubhead: brief.hideOgSubhead === true,
    ogLabel: briefOgLabel(brief),
  };
}
