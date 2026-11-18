// Client Brief — pure decision helpers shared by the custom-briefs route, the
// public brief resolver and the "newest public brief" pickers. No I/O.

import { randomBytes } from 'crypto';
import { parseClientBrief } from './parse.js';
import { renderClientBriefDocument } from './render.js';
import { normalizeTheme } from '../../app/dashboard/studio/invoice/themes/theme-schema.js';
import { firstParagraphText, normalizeClientBriefOg } from './og.js';

export const CLIENT_BRIEF_KIND = 'client-brief';
export const CLIENT_BRIEF_SLUG_RE = /^client-brief-\d{8}-[0-9a-f]{16}$/;
export const CLIENT_BRIEF_MAX_HTML_BYTES = 3 * 1024 * 1024;
// v3 = invoice-look document with `##` sections (new docs). v2 = flowing
// Markdown layout. v1 docs have no layoutVersion and keep the paged
// 'edge-to-edge' PDF mode; v2 and v3 print through the plain default mode
// (A4 with Browserless's fixed margins, no injected CSS) so the document's own
// @media print rules apply. Old v1/v2 docs keep their stored HTML.
export const CLIENT_BRIEF_LAYOUT_VERSION = 3;
export const CLIENT_BRIEF_DEFAULT_PDF_MIN_LAYOUT_VERSION = 2;

export function clientBriefPdfMode(brief) {
  return Number(brief?.layoutVersion) >= CLIENT_BRIEF_DEFAULT_PDF_MIN_LAYOUT_VERSION ? 'default' : 'edge-to-edge';
}

// Built-in theme id ('ledger' | 'editorial' | 'studio-dark') or null (default).
// Accepts an id string or a { id } object; anything else is the default.
export function normalizeClientBriefThemeId(raw) {
  const candidate = typeof raw === 'string' ? { id: raw } : raw;
  return normalizeTheme(candidate)?.id || null;
}

// Link-preview description: operator's subhead, else the first paragraph.
export function clientBriefDescription({ ogSubhead, text, clientName }) {
  const subhead = String(ogSubhead || '').trim();
  if (subhead) return subhead.slice(0, 240);
  const para = firstParagraphText(text, 240);
  return para || `Client brief for ${clientName || 'this client'}.`;
}

export function isClientBriefData(data) {
  return Boolean(data) && typeof data === 'object' && data.kind === CLIENT_BRIEF_KIND;
}

// Doc id AND public slug: date + 64 random bits. Never derived from the title,
// so a link cannot be guessed from a client name or headline.
export function newClientBriefSlug({ now = new Date(), randomHex = () => randomBytes(8).toString('hex') } = {}) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  return `client-brief-${date}-${randomHex()}`;
}

// Fuzzy resolution (hyphen-variant, compacted-title) must never reach a
// client brief: only the exact doc id / exact publicBriefSlug may.
export function allowsFuzzyResolve(data) {
  return !isClientBriefData(data);
}

export function todayIsoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function cleanAsOf(value, now) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayIsoDate(now);
}

// Parse + render, server side, from the request body only. Throws
// ClientBriefParseError (code: empty | too_long) on bad text. Returns the
// parsed model ({ title, clientName, asOf, blocks }), the html, the normalized
// OG fields, the link-preview description and the validated theme id (or null).
export function buildClientBrief({ body, clientName, pdfPath, now = new Date(), theme, brand = null }) {
  const model = parseClientBrief(body?.text, {
    title: String(body?.title || '').slice(0, 140),
    clientName,
    asOf: cleanAsOf(body?.asOf, now),
  });
  // `theme` (explicit arg, else body.theme) is validated to a built-in id or null.
  const themeId = normalizeClientBriefThemeId(theme !== undefined ? theme : body?.theme);
  const html = renderClientBriefDocument(model, { pdfPath, theme: themeId ? { id: themeId } : null, brand }).html;
  const og = normalizeClientBriefOg(body);
  const description = clientBriefDescription({ ogSubhead: og.ogSubhead, text: body?.text, clientName });
  return { model, html, og, description, themeId };
}

// GET visibility. Non-admins never receive client-brief docs. Admins get them
// (public or not, so they can republish/delete) only when they ask with
// ?kind=client-brief; the default list keeps its existing public-only,
// no-client-brief shape so older consumers are unchanged.
export function selectBriefsForViewer(briefs, { isAdmin, kindFilter } = {}) {
  const list = Array.isArray(briefs) ? briefs : [];
  if (isAdmin && kindFilter === CLIENT_BRIEF_KIND) {
    return list.filter((brief) => brief.kind === CLIENT_BRIEF_KIND);
  }
  return list
    .filter((brief) => brief.kind !== CLIENT_BRIEF_KIND)
    .filter((brief) => brief.public)
    .filter((brief) => !kindFilter || brief.kind === kindFilter);
}
