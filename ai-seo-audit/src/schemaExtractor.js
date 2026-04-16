// schemaExtractor.js — Extracts JSON-LD from HTML, scores by type presence,
// exposes orgData for NAP checking and entity authority lookups.
//
// Public API:
//   extractSchema(html) → { score, types, hasOrganization, hasFaqPage, hasArticle,
//                           hasLocalBusiness, hasPerson, allSchemas, orgData }

import * as cheerio from 'cheerio';

// Schema types and their point values (cap at 100)
const TYPE_WEIGHTS = {
  Organization:   20,
  LocalBusiness:  20,
  FAQPage:        20,
  Person:         10,
  Article:        10,
  BlogPosting:    10,
  WebSite:         5,
  BreadcrumbList:  5,
  Product:        10,
  Event:           5,
  Service:         5,
};

function normalizeTypes(typeValue) {
  if (!typeValue) return [];
  const values = Array.isArray(typeValue) ? typeValue : [typeValue];
  return values.map((v) => String(v).split('/').pop()); // strip schema.org URL prefix
}

function extractJsonLd(html) {
  const $ = cheerio.load(html);
  const schemas = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html() || '';
      if (!text.trim()) return;
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        schemas.push(...parsed);
      } else if (parsed && typeof parsed === 'object') {
        // @graph support: { @graph: [...] }
        if (Array.isArray(parsed['@graph'])) {
          schemas.push(...parsed['@graph']);
        } else {
          schemas.push(parsed);
        }
      }
    } catch { /* malformed JSON-LD — skip */ }
  });

  return schemas;
}

export function extractSchema(html) {
  const allSchemas = extractJsonLd(html);
  const typeSet    = new Set();

  for (const s of allSchemas) {
    for (const t of normalizeTypes(s['@type'])) {
      typeSet.add(t);
    }
  }

  const hasOrganization  = typeSet.has('Organization') || typeSet.has('LocalBusiness');
  const hasFaqPage       = typeSet.has('FAQPage');
  const hasArticle       = typeSet.has('Article') || typeSet.has('BlogPosting');
  const hasLocalBusiness = typeSet.has('LocalBusiness');
  const hasPerson        = typeSet.has('Person');

  // orgData: first Organization/LocalBusiness/Person for NAP + sameAs extraction
  const orgData = allSchemas.find((s) => {
    const types = normalizeTypes(s['@type']);
    return types.some((t) => ['Organization', 'LocalBusiness', 'Person'].includes(t));
  }) || null;

  // Score: sum weights of present types, cap at 100
  let score = 0;
  for (const [type, weight] of Object.entries(TYPE_WEIGHTS)) {
    if (typeSet.has(type)) score += weight;
  }
  score = Math.min(score, 100);

  return {
    score,
    types:          [...typeSet],
    hasOrganization,
    hasFaqPage,
    hasArticle,
    hasLocalBusiness,
    hasPerson,
    allSchemas,
    orgData,
  };
}
