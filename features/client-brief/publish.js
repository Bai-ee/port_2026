// Client Brief — pure decision helpers shared by the custom-briefs route, the
// public brief resolver and the "newest public brief" pickers. No I/O.

import { randomBytes } from 'crypto';
import { parseClientBrief } from './parse.js';
import { renderClientBriefHtml } from './render.js';

export const CLIENT_BRIEF_KIND = 'client-brief';
export const CLIENT_BRIEF_SLUG_RE = /^client-brief-\d{8}-[0-9a-f]{16}$/;
export const CLIENT_BRIEF_MAX_HTML_BYTES = 3 * 1024 * 1024;

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
// ClientBriefParseError (code: empty | too_long) on bad text.
export function buildClientBrief({ body, clientName, pdfPath, now = new Date() }) {
  const model = parseClientBrief(body?.text, {
    title: String(body?.title || '').slice(0, 140),
    clientName,
    asOf: cleanAsOf(body?.asOf, now),
  });
  const html = renderClientBriefHtml(model, { pdfPath });
  return { model, html };
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
