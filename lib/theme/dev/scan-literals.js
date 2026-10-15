// Colour-literal scanner shared by the migration scan tests (WS5/6/7) and the
// codemod. Finds hex / rgb / rgba / hsl / hsla / 0x literals, knows which ones
// are mode-agnostic black shadows (exception X6), and applies the allowlist
// `{ file, literal, reason, exceptionId }`.
//
// Dev tooling only: never imported by app code.

export const LITERAL_KINDS = Object.freeze(['hex', 'rgb', 'rgba', 'hsl', 'hsla', '0x']);

const SHADOW_PROPS = new Set(['box-shadow', 'text-shadow', 'filter', '-webkit-filter', 'backdrop-filter', 'drop-shadow']);

export function kebab(prop) {
  return String(prop || '')
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
    .toLowerCase();
}

export function guessType(file) {
  return /\.css$/i.test(file || '') ? 'css' : 'js';
}

// ---------- normalisation ----------

function numTok(t) {
  const s = String(t).trim();
  if (s.endsWith('%')) return `${Number(s.slice(0, -1))}%`;
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

/** lower-case, whitespace-free, canonical numbers; #rgb expanded to #rrggbb. */
export function normalizeLiteral(lit) {
  const s = String(lit).trim();
  if (s[0] === '#') {
    let h = s.slice(1).toLowerCase();
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return `#${h}`;
  }
  if (/^0x/i.test(s)) return s.toLowerCase();
  const m = /^([a-z]+)\(([^)]*)\)$/i.exec(s);
  if (!m) return s.toLowerCase();
  const fn = m[1].toLowerCase();
  const parts = m[2].split(/[\s,\/]+/).filter(Boolean).map(numTok);
  return `${fn}(${parts.join(',')})`;
}

/** Parse a literal into { space, r,g,b,a } (rgb) or { space:'hsl', h,s,l,a }. null when unparseable. */
export function parseLiteral(lit) {
  const n = normalizeLiteral(lit);
  if (n[0] === '#') {
    const h = n.slice(1);
    if (![6, 8].includes(h.length)) return null;
    return {
      space: 'rgb',
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const m = /^(rgba?|hsla?)\((.*)\)$/.exec(n);
  if (!m) return null;
  const p = m[2].split(',');
  const num = (t) => (t.endsWith('%') ? Number(t.slice(0, -1)) : Number(t));
  const alpha = (t) => (t === undefined ? 1 : t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t));
  if (m[1].startsWith('rgb')) {
    if (p.length < 3) return null;
    return { space: 'rgb', r: num(p[0]), g: num(p[1]), b: num(p[2]), a: alpha(p[3]) };
  }
  if (p.length < 3) return null;
  return { space: 'hsl', h: num(p[0]), s: num(p[1]), l: num(p[2]), a: alpha(p[3]) };
}

// ---------- scanning ----------

/** Blank out CSS selectors / at-rule preludes (keep declarations), preserving offsets. */
function maskCssSelectors(text) {
  const chars = text.split('');
  let boundary = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      for (let j = boundary; j < i; j++) if (chars[j] !== '\n') chars[j] = ' ';
      boundary = i + 1;
    } else if (ch === ';' || ch === '}') {
      boundary = i + 1;
    }
  }
  return chars.join('');
}

function blankComments(text, type) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (type === 'js') out = out.replace(/(^|[ \t])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
  return out;
}

const RE_HEX = /(?<![\w&#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
const RE_FN = /\b(rgba?|hsla?)\(\s*[^()]*\)/gi;
const RE_0X = /\b0[xX][0-9a-fA-F]{6}\b/g;

export function lineCol(text, index) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      last = i;
    }
  }
  return { line, column: index - last };
}

function propertyAt(text, index, type) {
  const before = text.slice(Math.max(0, index - 240), index);
  if (type === 'css') {
    const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
    const seg = before.slice(cut + 1);
    const m = /^\s*([-\w]+)\s*:/.exec(seg);
    return m ? kebab(m[1]) : null;
  }
  const re = /([A-Za-z][\w-]*)\s*[:=]\s*(?:\{\s*)?["'`{(]/g;
  let m;
  let last = null;
  while ((m = re.exec(before))) last = m[1];
  return last ? kebab(last) : null;
}

/**
 * @returns Array<{ literal, normalized, kind, index, line, column, property, blackShadow }>
 */
export function scanLiterals(source, { file = '', type = guessType(file) } = {}) {
  let text = blankComments(source, type);
  if (type === 'css') text = maskCssSelectors(text);
  const found = [];
  const push = (m, kind) => {
    const literal = m[0];
    if (literal.includes('${') || /var\(/i.test(literal)) return;
    const index = m.index;
    const property = propertyAt(text, index, type);
    const finding = {
      literal,
      normalized: normalizeLiteral(literal),
      kind,
      index,
      ...lineCol(source, index),
      property,
      blackShadow: false,
    };
    finding.blackShadow = isBlackShadow(finding, text);
    found.push(finding);
  };
  for (const m of text.matchAll(RE_HEX)) push(m, 'hex');
  for (const m of text.matchAll(RE_FN)) push(m, m[1].toLowerCase());
  for (const m of text.matchAll(RE_0X)) push(m, '0x');
  return found.sort((a, b) => a.index - b.index);
}

/** rgba(0,0,0,a) / #000 used inside box-shadow / text-shadow / drop-shadow: mode-agnostic (X6). */
export function isBlackShadow(finding, text) {
  const p = parseLiteral(finding.literal);
  if (!p || p.space !== 'rgb' || p.r !== 0 || p.g !== 0 || p.b !== 0) return false;
  if (finding.property && SHADOW_PROPS.has(finding.property)) {
    if (finding.property === 'filter' || finding.property === '-webkit-filter' || finding.property === 'backdrop-filter') {
      const before = (text || '').slice(Math.max(0, finding.index - 80), finding.index);
      return /drop-shadow\([^)]*$/.test(before);
    }
    return true;
  }
  const before = (text || '').slice(Math.max(0, finding.index - 80), finding.index);
  return /drop-shadow\([^)]*$/.test(before);
}

// ---------- allowlist ----------

/** Accepts an array or { entries:[...] }; returns entries with normalised literals. */
export function loadAllowlist(input) {
  const arr = Array.isArray(input) ? input : Array.isArray(input?.entries) ? input.entries : [];
  return arr
    .filter((e) => e && typeof e.file === 'string' && typeof e.literal === 'string')
    .map((e) => ({ ...e, normalizedLiteral: normalizeLiteral(e.literal) }));
}

const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');

export function isAllowed(finding, file, allowlist) {
  const f = normPath(file);
  return allowlist.some(
    (e) => (normPath(e.file) === f || e.file === '*') && (e.normalizedLiteral || normalizeLiteral(e.literal)) === finding.normalized
  );
}

/** Findings that are neither mode-agnostic black shadows nor allowlisted. */
export function findUnallowed(source, { file = '', type, allowlist = [] } = {}) {
  const entries = allowlist.length && !allowlist[0].normalizedLiteral ? loadAllowlist(allowlist) : allowlist;
  return scanLiterals(source, { file, type }).filter((f) => !f.blackShadow && !isAllowed(f, file, entries));
}
