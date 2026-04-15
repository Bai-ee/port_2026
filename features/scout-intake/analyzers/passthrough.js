'use strict';

// passthrough.js — Default analyzer for cards that have no specialty impl.
//
// Reads card.sourceField from sharedResults. The path root picks the source:
//   'snapshot.*' / 'signals.*' / 'strategy.*' / 'outputsPreview.*'  → intake
//   'siteMeta.*'                                                    → siteMeta
//   'intelligence.pagespeed.*'                                      → pagespeed
//
// Supports:
//   - dot paths          'snapshot.brandOverview.industry'
//   - numeric index      'strategy.contentAngles[0]'
//   - 'top' selector     'signals.core[top]'  → first high-relevance else first
//
// Confidence is inferred from the shape/thickness of the value:
//   - empty / missing                      → 'low'   status:'empty'
//   - primitive with meaningful content    → 'medium'
//   - object with ≥3 populated keys        → 'high'

function readPath(obj, path) {
  if (!obj || !path) return undefined;
  const tokens = path.split('.');
  let cur = obj;
  for (const tok of tokens) {
    if (cur == null) return undefined;
    const indexMatch = tok.match(/^(\w+)\[(\w+)\]$/);
    if (indexMatch) {
      cur = cur[indexMatch[1]];
      if (!Array.isArray(cur)) return undefined;
      const sel = indexMatch[2];
      if (sel === 'top') {
        cur = cur.find((item) => item && item.relevance === 'high') || cur[0];
      } else {
        const idx = Number(sel);
        cur = Number.isFinite(idx) ? cur[idx] : undefined;
      }
    } else {
      cur = cur[tok];
    }
  }
  return cur;
}

function resolveSource(sharedResults, path) {
  if (!path) return { source: null, strippedPath: path };
  if (path.startsWith('siteMeta')) {
    const stripped = path === 'siteMeta' ? '' : path.slice('siteMeta.'.length);
    return { source: sharedResults?.siteMeta || null, strippedPath: stripped };
  }
  if (path.startsWith('intelligence.pagespeed')) {
    const stripped = path === 'intelligence.pagespeed' ? '' : path.slice('intelligence.pagespeed.'.length);
    return { source: sharedResults?.pagespeed || null, strippedPath: stripped };
  }
  return { source: sharedResults?.intake || null, strippedPath: path };
}

function hasMeaningfulContent(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.values(value).some((v) => hasMeaningfulContent(v));
  return Boolean(value);
}

function inferConfidence(value, fallbackValue) {
  if (!hasMeaningfulContent(value)) {
    return hasMeaningfulContent(fallbackValue) ? 'low' : 'low';
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const populated = Object.values(value).filter((v) => hasMeaningfulContent(v)).length;
    if (populated >= 3) return 'high';
    if (populated >= 1) return 'medium';
  }
  return 'medium';
}

async function run({ card, sharedResults }) {
  const path = card.sourceField;
  if (!path) {
    return {
      status: 'empty',
      confidence: 'low',
      signals: null,
      notes: 'no sourceField configured',
      runCostData: null,
    };
  }

  const { source, strippedPath } = resolveSource(sharedResults, path);
  const value = strippedPath ? readPath(source, strippedPath) : source;

  let fallbackValue;
  if (!hasMeaningfulContent(value) && card.fallbackField) {
    const fb = resolveSource(sharedResults, card.fallbackField);
    fallbackValue = fb.strippedPath ? readPath(fb.source, fb.strippedPath) : fb.source;
  }

  const effective = hasMeaningfulContent(value) ? value : fallbackValue;
  const hasValue = hasMeaningfulContent(effective);

  return {
    status: hasValue ? 'ok' : 'empty',
    confidence: hasValue ? inferConfidence(effective) : 'low',
    signals: hasValue ? { value: effective } : null,
    notes: hasValue ? null : 'source field empty',
    runCostData: null,
  };
}

module.exports = { run, readPath, resolveSource, hasMeaningfulContent };
