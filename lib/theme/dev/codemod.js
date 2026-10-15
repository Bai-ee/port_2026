// Pure text transform behind scripts/theme/codemod-literals.mjs (contract 10.4 rule 2).
// Rewrites ONLY exact legacy matches (see legacy-map.js); anything ambiguous,
// unmapped, or outside the allowed JSX style keys is written to the report and
// left untouched. Idempotent. Dev tooling only.

import {
  scanLiterals, isBlackShadow, guessType, kebab, lineCol,
} from './scan-literals.js';
import { mapLiteral } from './legacy-map.js';

const EXACT_KEYS = new Set(['color', 'background', 'background-color', 'fill', 'stroke', 'stop-color', 'box-shadow']);
const isAllowedKey = (k) => EXACT_KEYS.has(k) || k.startsWith('border') || k.startsWith('outline');

const RE_PROP_STRING = /([A-Za-z][\w$]*)\s*[:=]\s*(?:\{\s*)?(["'`])((?:\\.|(?!\2)[^\\\n])*)\2/g;

function entry(file, text, index, f, status, extra = {}) {
  const { line, column } = lineCol(text, index);
  return { file, line, column, literal: f.literal, property: f.property || null, status, ...extra };
}

function applyEdits(text, edits) {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function classify(file, text, abs, f, property, edits, report, counts) {
  const res = mapLiteral(f.literal, property);
  const base = { ...f, property };
  if (res.status === 'mapped') {
    edits.push({ start: abs, end: abs + f.literal.length, text: res.replacement });
    report.push(entry(file, text, abs, base, 'changed', { replacement: res.replacement }));
    counts.changed += 1;
  } else if (res.status === 'ambiguous') {
    report.push(entry(file, text, abs, base, 'ambiguous', { suggestions: res.suggestions }));
    counts.ambiguous += 1;
  } else {
    report.push(entry(file, text, abs, base, 'unmapped'));
    counts.unmapped += 1;
  }
}

/**
 * @returns { text, changed, report, counts }
 */
export function applyCodemod(source, { file = '', type = guessType(file) } = {}) {
  const report = [];
  const counts = { changed: 0, ambiguous: 0, unmapped: 0, notAttempted: 0, skippedBlackShadow: 0 };
  const edits = [];

  if (type === 'css') {
    for (const f of scanLiterals(source, { file, type })) {
      if (f.blackShadow) {
        counts.skippedBlackShadow += 1;
        continue;
      }
      classify(file, source, f.index, f, f.property, edits, report, counts);
    }
  } else {
    const spans = [];
    for (const m of source.matchAll(RE_PROP_STRING)) {
      const key = kebab(m[1]);
      if (!isAllowedKey(key)) continue;
      const value = m[3];
      if (value.includes('${')) continue;
      const valueStart = m.index + m[0].length - 1 - value.length;
      spans.push([valueStart, valueStart + value.length]);
      for (const f of scanLiterals(value, { file, type: 'js' })) {
        const withKey = { ...f, property: key };
        if (isBlackShadow(withKey, value)) {
          counts.skippedBlackShadow += 1;
          continue;
        }
        classify(file, source, valueStart + f.index, withKey, key, edits, report, counts);
      }
    }
    for (const f of scanLiterals(source, { file, type: 'js' })) {
      if (f.blackShadow) continue;
      if (spans.some(([a, b]) => f.index >= a && f.index < b)) continue;
      report.push(entry(file, source, f.index, f, 'not-attempted'));
      counts.notAttempted += 1;
    }
  }

  report.sort((a, b) => a.line - b.line || a.column - b.column);
  return { text: applyEdits(source, edits), changed: edits.length > 0, report, counts };
}
