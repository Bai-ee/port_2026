// Folders — manual + smart (rule-based) groupings inside a bucket
// (Content Engine v2 master plan §3 Buckets tab, §4 data model).
//
// folder = { id, bucketId, name, rule?: {field, op, value}, itemIds?: [] }
// A smart folder has a rule; a manual folder has ids; both may be present
// (result = union). Pure: no fs, no network, no clock — safe in client code.

import { resolveBucket, DEFAULT_BUCKETS } from './buckets.js';
import { effectiveFacets, canonicalGear, normalizeTerm, FACET_FIELDS } from './facets.js';

export const RULE_OPS = ['contains', 'equals', 'between', 'vibe', 'tag'];
const ARRAY_FIELDS = Object.keys(FACET_FIELDS).filter((k) => FACET_FIELDS[k] === 'array');
const SCALAR_FIELDS = ['dateText', 'eventDate', 'eraYear', 'decade'];
const ITEM_SCALAR_FIELDS = ['title', 'bucketId', 'status', 'engine'];
const VIBE_KEYS = ['light', 'time', 'kind'];

function vibeKeyOf(rule) {
  const f = String(rule?.field ?? '').replace(/^vibe\./, '');
  return VIBE_KEYS.includes(f) ? f : null;
}

/** Returns an array of error strings; empty means valid. */
export function validateFolderRule(rule) {
  if (!rule || typeof rule !== 'object') return ['rule must be an object'];
  const { field, op, value } = rule;
  if (!RULE_OPS.includes(op)) return [`op must be one of ${RULE_OPS.join(', ')}`];
  switch (op) {
    case 'contains':
      if (!ARRAY_FIELDS.includes(field) && field !== 'tags') return [`contains needs an array field: ${[...ARRAY_FIELDS, 'tags'].join(', ')}`];
      if (!normalizeTerm(value)) return ['value is required'];
      return [];
    case 'equals':
      if (![...SCALAR_FIELDS, ...ITEM_SCALAR_FIELDS].includes(field)) return [`equals needs a scalar field: ${[...SCALAR_FIELDS, ...ITEM_SCALAR_FIELDS].join(', ')}`];
      if (value == null || !String(value).trim()) return ['value is required'];
      return [];
    case 'between':
      if (field !== 'eraYear') return ['between only supports eraYear'];
      if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isFinite(Number(n)))) return ['value must be [from, to] years'];
      if (Number(value[0]) > Number(value[1])) return ['range start must be ≤ end'];
      return [];
    case 'vibe': {
      if (!vibeKeyOf(rule)) return ['vibe field must be light, time or kind'];
      if (!normalizeTerm(value)) return ['value is required'];
      return [];
    }
    case 'tag':
      return normalizeTerm(value) ? [] : ['value is required'];
    default:
      return ['invalid rule'];
  }
}

/** Does one item satisfy a rule? Invalid rules match nothing. */
export function matchesRule(rule, item, facets = effectiveFacets(item)) {
  if (validateFolderRule(rule).length) return false;
  const { field, op, value } = rule;
  switch (op) {
    case 'contains': {
      const want = field === 'gear' ? canonicalGear(value) : normalizeTerm(value);
      const have = field === 'tags' ? (item.tags || []).map(normalizeTerm) : (facets[field] || []);
      return have.includes(want);
    }
    case 'equals': {
      const have = SCALAR_FIELDS.includes(field) ? facets[field] : item[field];
      return have != null && normalizeTerm(have) === normalizeTerm(value);
    }
    case 'between': {
      const y = facets.eraYear;
      return Number.isFinite(y) && y >= Number(value[0]) && y <= Number(value[1]);
    }
    case 'vibe':
      return facets.vibe?.[vibeKeyOf(rule)] === normalizeTerm(value);
    case 'tag':
      return (item.tags || []).some((t) => normalizeTerm(t) === normalizeTerm(value));
    default:
      return false;
  }
}

/** Items in a folder: manual ids ∪ rule matches, limited to the folder's bucket. */
export function itemsInFolder(folder, items = [], buckets = DEFAULT_BUCKETS) {
  if (!folder) return [];
  const manual = new Set(folder.itemIds || []);
  return items.filter((item) => {
    if (folder.bucketId && resolveBucket(item, buckets) !== folder.bucketId) return false;
    if (manual.has(item.id)) return true;
    return folder.rule ? matchesRule(folder.rule, item) : false;
  });
}

/** { [folderId]: count } */
export function folderCounts(folders = [], items = [], buckets = DEFAULT_BUCKETS) {
  const out = {};
  for (const f of folders) out[f.id] = itemsInFolder(f, items, buckets).length;
  return out;
}

function folderLabel(field, value) {
  let v = String(value);
  if (field === 'gear') v = v.replace(/^[a-z]{2,3}-(?=\d)/i, '');
  return v.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Candidate smart folders from frequent facet values.
 * Returns [{name, bucketId, rule, count}] sorted by count desc then name.
 * opts: { minCount = 5, bucketId?, buckets?, limit = 24, existing?: folders }
 */
export function suggestFolders(items = [], opts = {}) {
  const { minCount = 5, bucketId = null, buckets = DEFAULT_BUCKETS, limit = 24, existing = [] } = opts;
  const counts = new Map();
  const bump = (field, op, value) => {
    const key = `${field}\u0000${op}\u0000${value}`;
    const e = counts.get(key);
    if (e) e.count += 1; else counts.set(key, { field, op, value, count: 1 });
  };
  for (const item of items) {
    if (bucketId && resolveBucket(item, buckets) !== bucketId) continue;
    const f = effectiveFacets(item);
    for (const field of ARRAY_FIELDS) for (const v of f[field] || []) bump(field, 'contains', v);
    if (f.decade) bump('decade', 'equals', f.decade);
    for (const k of VIBE_KEYS) if (f.vibe?.[k]) bump(`vibe.${k}`, 'vibe', f.vibe[k]);
    for (const t of item.tags || []) { const n = normalizeTerm(t); if (n) bump('tags', 'contains', n); }
  }
  const taken = new Set(existing.filter((x) => x.rule).map((x) => JSON.stringify([x.rule.field, x.rule.op, normalizeTerm(x.rule.value)])));
  return [...counts.values()]
    .filter((c) => c.count >= minCount && !taken.has(JSON.stringify([c.field, c.op, normalizeTerm(c.value)])))
    .map((c) => ({
      name: folderLabel(c.field, c.value),
      bucketId,
      rule: { field: c.field, op: c.op, value: c.value },
      count: c.count,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}
