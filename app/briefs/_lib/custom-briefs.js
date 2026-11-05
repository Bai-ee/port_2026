import { createRequire } from 'module';
import { formatMoney, resolveInvoiceLabels } from '../../../features/invoices/model.js';

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
  if (brief.public !== true) return null;

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

// Display domain for the OG share image / meta — protocol + www + trailing
// slash stripped so it reads as a clean "rositastacos.com".
export function briefWebsite(client) {
  const raw = String(client?.websiteUrl || client?.website || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .slice(0, 60);
}

// Firestore admin Timestamp | {_seconds} | epoch | ISO → Date, or null.
function toDateSafe(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') { try { return value.toDate(); } catch { return null; } }
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  if (typeof value === 'number') return new Date(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const OG_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// Publish/updated date for the OG image DATE tile — "JUN 30 2026" (UTC, mono).
export function briefDateLabel(brief) {
  const date = toDateSafe(brief?.updatedAt) || toDateSafe(brief?.importedAt) || toDateSafe(brief?.createdAt);
  if (!date) return '';
  return `${OG_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ${date.getUTCFullYear()}`;
}

// Invoice-kind briefs (Invoice Studio publish — `brief.kind === 'invoice'`,
// `brief.invoice` = the stored normalized model) share with the reader what
// the document actually is: the subhead names who it is for and the OG
// tiles carry BILL TO · TOTAL · DUE instead of the generic client/website/
// date band, which on an invoice read as the owner's own inputs. Returns
// null for anything that is not an invoice so the brief path is untouched.
function invoiceOgFacts(brief) {
  if (brief?.kind !== 'invoice' || !brief.invoice || typeof brief.invoice !== 'object') return null;
  const inv = brief.invoice;
  const billTo = String(inv.billTo?.name || '').trim();
  const labels = resolveInvoiceLabels(inv);
  const docKind = String(labels.title || 'Invoice').trim();
  const number = String(inv.invoiceNumber || '').trim();
  const total = Number(inv.totals?.total) || 0;
  const totalLabel = total > 0 ? formatMoney(total, inv.currency || 'USD', inv.locale || 'en-US') : '';
  const due = toDateSafe(inv.dueDate);
  const dueLabel = due ? `${OG_MONTHS[due.getUTCMonth()]} ${due.getUTCDate()} ${due.getUTCFullYear()}` : '';
  const description = [
    billTo ? `${docKind} for ${billTo}` : docKind,
    number ? `#${number}` : '',
    totalLabel ? `· ${totalLabel}` : '',
  ].filter(Boolean).join(' ');
  return {
    description: description.slice(0, 240),
    subhead: billTo ? `Prepared for ${billTo}` : '',
    // Uploaded per-invoice logo (Cover card) wins over the HITLOOP mark in
    // the OG image's oversized corner logo; null = renderer's brand asset.
    logo: typeof inv.logoDataUrl === 'string' && /^data:image\//.test(inv.logoDataUrl) ? inv.logoDataUrl : null,
    tiles: [
      { k: 'BILL TO', v: billTo || '—' },
      { k: 'TOTAL', v: totalLabel || '—' },
      { k: 'DUE', v: dueLabel || '—' },
    ],
  };
}

export function buildBriefOpenGraphMeta({ origin, clientId, client, brief, snapshotId }) {
  const clientName = clientDisplayName(client, clientId);
  const publicPath = publicBriefPath({ clientId, client, brief, snapshotId });
  const title = String(brief.title || brief.briefSlug || snapshotId || 'Custom Brief').trim();
  const invoiceFacts = invoiceOgFacts(brief);
  const description = invoiceFacts ? invoiceFacts.description : briefDescription(brief, clientName);
  const publicUrl = `${origin}${publicPath}`;
  const imageUrl = `${publicUrl}/og-image`;
  return {
    title,
    description,
    clientName,
    website: briefWebsite(client),
    dateLabel: briefDateLabel(brief),
    publicPath,
    publicUrl,
    imageUrl,
    imageAlt: `${title} preview image`,
    hideOgSubhead: brief.hideOgSubhead === true,
    ogLabel: briefOgLabel(brief),
    // Invoice-only overrides for the OG image (see invoiceOgFacts). Absent
    // on briefs, where og-image/route.js keeps its own defaults.
    ...(invoiceFacts ? { ogVariant: 'invoice', ogLogo: invoiceFacts.logo, ogLines: ogLinesOf(brief), ogTitleLines: ogTitleLinesOf(brief), ogSubhead: ogSubheadOverride(brief) ?? invoiceFacts.subhead, ogTiles: invoiceFacts.tiles } : {}),
    ...(!invoiceFacts && ogSubheadOverride(brief) !== null ? { ogSubhead: ogSubheadOverride(brief) } : {}),
  };
}

// Operator-typed OG subhead (Invoice Studio's Publish card). Stored as
// `brief.ogSubhead`; blank/absent = null = "use the computed default".
// Up to two optional extra lines under the subhead (Invoice Studio's
// Publish card); blank entries are dropped, so "off" = empty.
function ogLinesOf(brief) {
  const raw = Array.isArray(brief?.ogLines) ? brief.ogLines : [];
  return raw.map((line) => String(line || '').replace(/\s+/g, ' ').trim().slice(0, 120)).filter(Boolean).slice(0, 2);
}

// Operator-managed headline lines for the invoice OG image (Publish card);
// empty = auto-wrap the title.
function ogTitleLinesOf(brief) {
  const raw = Array.isArray(brief?.ogTitleLines) ? brief.ogTitleLines : [];
  return raw.map((line) => String(line || '').replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean).slice(0, 3);
}

function ogSubheadOverride(brief) {
  const text = String(brief?.ogSubhead || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 160) : null;
}

// Meta for the Studio's live OG preview (app/api/dashboard/custom-briefs/
// og-preview): the same shape buildBriefOpenGraphMeta() produces, built
// from an UNSAVED draft instead of a stored brief, so the preview is the
// real renderer over the real inputs — never a client-side approximation.
export function buildInvoiceOgPreviewMeta({ title, invoice, ogLabel, ogSubhead, hideOgSubhead, ogLines, ogTitleLines, clientName }) {
  const brief = { kind: 'invoice', invoice, title, ogLabel, ogSubhead, ogLines, ogTitleLines, hideOgSubhead: hideOgSubhead === true };
  const invoiceFacts = invoiceOgFacts(brief);
  const cleanTitle = String(title || '').trim() || String(invoice?.invoiceNumber || '').trim() || 'Invoice';
  return {
    title: cleanTitle,
    description: invoiceFacts ? invoiceFacts.description : briefDescription(brief, clientName),
    clientName: clientName || '',
    website: '',
    dateLabel: '',
    hideOgSubhead: hideOgSubhead === true,
    ogLabel: briefOgLabel(brief),
    ...(invoiceFacts ? { ogVariant: 'invoice', ogLogo: invoiceFacts.logo, ogLines: ogLinesOf(brief), ogTitleLines: ogTitleLinesOf(brief), ogSubhead: ogSubheadOverride(brief) ?? invoiceFacts.subhead, ogTiles: invoiceFacts.tiles } : {}),
  };
}
