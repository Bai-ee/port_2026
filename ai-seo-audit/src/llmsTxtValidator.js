// llmsTxtValidator.js — Fetches /llms.txt and /llms-full.txt, validates spec,
// HEAD-checks linked URLs.
//
// llms.txt spec (llmstxt.org):
//   - First non-empty line: # Title (H1)
//   - Optional: > blockquote summary
//   - Optional sections: ## Section Name
//   - Link items: - [Title](url) : description
//
// Public API:
//   validateLlmsTxt({ websiteUrl, signal })
//     → { found, fullFound, valid, h1, summary, sections, brokenLinks, score }

import fetch from 'node-fetch';

const UA = 'BballiAiSeoAudit/1.0 (mailto:bryanballi@gmail.com)';

async function safeFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, headers: { 'User-Agent': UA, ...options.headers } });
  } catch {
    return null;
  }
}

async function headUrl(url, signal) {
  const res = await safeFetch(url, { method: 'HEAD', signal });
  return res?.ok ?? false;
}

function parseLlmsTxt(text) {
  const lines = text.split('\n');
  let h1 = null;
  let summary = null;
  const sections = {};
  let currentSection = null;
  const linkPattern = /^-\s+\[(.+?)\]\((.+?)\)(?:\s*:\s*(.*))?$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // H1 — first non-empty line must be a markdown H1
    if (h1 === null && line.startsWith('# ')) {
      h1 = line.slice(2).trim();
      continue;
    }

    // Blockquote summary
    if (line.startsWith('> ')) {
      summary = (summary ? summary + ' ' : '') + line.slice(2).trim();
      continue;
    }

    // Section header (## only — H1 already consumed)
    if (/^## /.test(line)) {
      currentSection = line.slice(3).trim();
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }

    // Link item within a section
    if (currentSection) {
      const m = line.match(linkPattern);
      if (m) {
        const [, title, url, description] = m;
        sections[currentSection].push({ title, url, description: description?.trim() || null });
      }
    }
  }

  return { valid: h1 !== null, h1, summary, sections };
}

export async function validateLlmsTxt({ websiteUrl, signal }) {
  const base = websiteUrl.replace(/\/$/, '');

  let found = false, fullFound = false, raw = null;

  // Fetch /llms.txt
  const mainRes = await safeFetch(`${base}/llms.txt`, { signal });
  if (mainRes?.ok) {
    found = true;
    raw = await mainRes.text().catch(() => null);
  }

  // Fetch /llms-full.txt (existence check only)
  const fullRes = await safeFetch(`${base}/llms-full.txt`, { signal });
  fullFound = fullRes?.ok ?? false;

  if (!found || !raw) {
    return {
      found: false, fullFound, valid: false,
      h1: null, summary: null, sections: {}, brokenLinks: [], score: 0,
    };
  }

  const parsed = parseLlmsTxt(raw);

  // Collect all linked URLs for HEAD-checking
  const allLinks = [];
  for (const items of Object.values(parsed.sections)) {
    for (const item of items) {
      if (item.url) allLinks.push(item.url);
    }
  }

  const brokenLinks = [];
  await Promise.allSettled(
    allLinks.map(async (url) => {
      const ok = await headUrl(url, signal);
      if (!ok) brokenLinks.push(url);
    })
  );

  // Score: 0–100
  let score = 0;
  if (found)                                                    score += 40;
  if (parsed.valid)                                             score += 20;
  if (Object.values(parsed.sections).some((s) => s.length > 0)) score += 20;
  if (fullFound)                                                score += 10;
  if (allLinks.length > 0 && brokenLinks.length === 0)          score += 10;

  return {
    found, fullFound,
    valid:   parsed.valid,
    h1:      parsed.h1,
    summary: parsed.summary,
    sections: parsed.sections,
    brokenLinks,
    score,
  };
}
