'use strict';

// Deterministic (no LLM) fact check of generated copy against the APPROVED
// Client Brain's hard numeric facts: group-size caps ("max 3 dogs"), founding
// year / years in business, "from $N" prices, "N minutes" durations.
// Unapproved / absent Brain => no facts => the check is a no-op.
// Run by Guardian (guardian.js) right before its Haiku QA pass.

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
const NUM = '(\\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)';
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[String(s).toLowerCase()]);

const CAP_RE = new RegExp(
  `\\b(?:max(?:imum)?(?:\\s+of)?|up\\s+to|no\\s+more\\s+than|capped\\s+at|limit(?:ed)?\\s+to)\\s+${NUM}\\b(\\s+(?:dogs?|pets?|pups?|puppies|per\\s+(?:walk|group|pack|outing|session)|clients?|guests?|people|kids|students|seats|spots))?`,
  'gi'
);
const PRICE_RE = /\b(from|starting\s+at|starts?\s+at)\s+\$(\d{1,5})\b/gi;
const DURATION_RE = /\b(\d{1,3})[- ]?(?:minutes?|mins?)\b/gi;
const SINCE_RE = /\b(since|founded(?:\s+in)?|established(?:\s+in)?|est\.?)\s+((?:19|20)\d{2})\b/gi;
const YEARS_RE = /\b(\d{1,2})(\+?)\s+years?\b(?!\s+(?:old|ago|from))/gi;

// Dogs / pets / "per walk" all describe the same group-size cap.
function capClass(unit) {
  const u = String(unit || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!u || /^(dogs?|pets?|pups?|puppies|per (walk|group|pack|outing|session))$/.test(u)) return 'group';
  return u.replace(/s$/, '');
}

function stringLeaves(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => stringLeaves(v, out));
  return out;
}

const add = (map, key, n) => { if (!map.has(key)) map.set(key, new Set()); map.get(key).add(n); };

// Only the factual sections — not voice/post examples, which are style samples.
function extractBrainFacts(brain) {
  if (!brain || brain.status !== 'approved') return null;
  const text = ['identity', 'positioning', 'audience', 'offers', 'proof']
    .flatMap((k) => stringLeaves(brain[k])).join('\n');
  const facts = { caps: new Map(), prices: new Set(), durations: new Set(), foundedYear: null };
  for (const m of text.matchAll(CAP_RE)) {
    const n = toNum(m[1]);
    if (n && (m[2] || /^max/i.test(m[0]))) add(facts.caps, capClass(m[2]), n);
  }
  for (const m of text.matchAll(PRICE_RE)) facts.prices.add(Number(m[2]));
  for (const m of text.matchAll(DURATION_RE)) facts.durations.add(Number(m[1]));
  const years = [...text.matchAll(SINCE_RE)].map((m) => Number(m[2]));
  if (years.length) facts.foundedYear = Math.min(...years);
  const empty = !facts.caps.size && !facts.prices.size && !facts.durations.size && !facts.foundedYear;
  return empty ? null : facts;
}

// Returns { text, contradictions } for one string. `fix` = the replacement number
// when unambiguous, null when the Brain has several valid values (=> drop).
function checkString(text, facts, now) {
  const found = [];
  const edits = [];
  const test = (kind, m, numStart, numLen, got, valid, unit) => {
    if (valid.size === 0 || valid.has(got)) return;
    const fix = valid.size === 1 ? [...valid][0] : null;
    found.push({ kind, found: got, expected: [...valid], fix, excerpt: m[0] });
    if (fix != null) edits.push({ start: m.index + numStart, end: m.index + numStart + numLen, to: String(fix) });
  };

  for (const m of text.matchAll(CAP_RE)) {
    const got = toNum(m[1]);
    const valid = facts.caps.get(capClass(m[2]));
    if (valid && got) test('cap', m, m[0].indexOf(m[1]), m[1].length, got, valid);
  }
  for (const m of text.matchAll(PRICE_RE)) {
    test('price', m, m[0].indexOf('$') + 1, m[2].length, Number(m[2]), facts.prices);
  }
  for (const m of text.matchAll(DURATION_RE)) {
    test('duration', m, 0, m[1].length, Number(m[1]), facts.durations);
  }
  if (facts.foundedYear) {
    const expectedYears = now.getUTCFullYear() - facts.foundedYear;
    for (const m of text.matchAll(SINCE_RE)) {
      const got = Number(m[2]);
      if (got !== facts.foundedYear) {
        found.push({ kind: 'year', found: got, expected: [facts.foundedYear], fix: facts.foundedYear, excerpt: m[0] });
        edits.push({ start: m.index + m[0].length - 4, end: m.index + m[0].length, to: String(facts.foundedYear) });
      }
    }
    for (const m of text.matchAll(YEARS_RE)) {
      const before = text.slice(Math.max(0, m.index - 6), m.index).toLowerCase();
      if (/(last|past|next)\s*$/.test(before)) continue;
      const got = Number(m[1]);
      if (Math.abs(got - expectedYears) > 1) {
        found.push({ kind: 'years', found: got, expected: [expectedYears], fix: expectedYears, excerpt: m[0] });
        edits.push({ start: m.index, end: m.index + m[1].length, to: String(expectedYears) });
      }
    }
  }

  let out = text;
  edits.sort((a, b) => b.start - a.start).forEach((e) => { out = out.slice(0, e.start) + e.to + out.slice(e.end); });
  return { text: out, contradictions: found };
}

// Mutates string fields of `content` in place (same object Scribe saves).
// Unambiguous contradictions are corrected; ambiguous ones blank the field.
function checkCopyAgainstBrain(content, brain, { now = new Date() } = {}) {
  const facts = extractBrainFacts(brain);
  const result = { checked: false, contradictions: [] };
  if (!facts || !content || typeof content !== 'object') return result;
  result.checked = true;

  const walk = (node) => {
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (typeof v === 'string') {
        const r = checkString(v, facts, now);
        for (const c of r.contradictions) {
          const action = c.fix != null ? 'corrected' : 'dropped';
          result.contradictions.push({ field: key, kind: c.kind, found: c.found, expected: c.expected, excerpt: c.excerpt, action });
        }
        if (r.contradictions.some((c) => c.fix == null)) node[key] = '';
        else if (r.text !== v) node[key] = r.text;
      } else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'string') {
            const holder = { [i]: item };
            walk(holder);
            v[i] = holder[i];
          } else if (item && typeof item === 'object') walk(item);
        });
      } else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(content);
  return result;
}

module.exports = { extractBrainFacts, checkCopyAgainstBrain, checkString };
