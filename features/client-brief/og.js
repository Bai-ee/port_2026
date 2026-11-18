// Client Brief - share-image (OG) field helpers. Pure and browser-safe (no
// node imports): used by the route, the MCP path and the dashboard card.
// Limits mirror the invoice publish path in app/api/dashboard/custom-briefs/route.js.

import { parseClientBrief, inlineToPlain } from './parse.js';

export const CLIENT_BRIEF_DEFAULT_OG_LABEL = 'HITLOOP';

const clean = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export function normalizeClientBriefOg(source) {
  const body = source && typeof source === 'object' ? source : {};
  const lines = (value, max, cap) => (Array.isArray(value) ? value : []).map((line) => clean(line, max)).filter(Boolean).slice(0, cap);
  return {
    ogLabel: clean(body.ogLabel, 80) || CLIENT_BRIEF_DEFAULT_OG_LABEL,
    ogSubhead: clean(body.ogSubhead, 160),
    hideOgSubhead: body.hideOgSubhead === true,
    ogTitleLines: lines(body.ogTitleLines, 40, 3),
    ogLines: lines(body.ogLines, 120, 2),
  };
}

// First paragraph of the pasted text as plain text ('' when there is none).
export function firstParagraphText(text, max = 240) {
  try {
    const model = parseClientBrief(String(text || ''), {});
    const para = model.blocks.find((block) => block.type === 'paragraph');
    return para ? clean(inlineToPlain(para.tokens), max) : '';
  } catch {
    return '';
  }
}

// Prefill for the card, applied once when every OG field is empty: headline
// split over two lines from the title, "Prepared for <client>", and the first
// paragraph as the extra line.
export function suggestClientBriefOg({ title, clientName, text } = {}) {
  const words = clean(title, 140).split(/\s+/).filter(Boolean);
  let line1 = '';
  let line2 = '';
  for (const word of words) {
    if (!line2 && (line1 ? `${line1} ${word}` : word).length <= 18) line1 = line1 ? `${line1} ${word}` : word;
    else line2 = line2 ? `${line2} ${word}` : word;
  }
  const client = clean(clientName, 80);
  return {
    ogTitleLines: [line1.slice(0, 40), line2.slice(0, 40)],
    ogSubhead: client ? `Prepared for ${client}` : '',
    ogLines: [firstParagraphText(text, 120), ''],
  };
}
