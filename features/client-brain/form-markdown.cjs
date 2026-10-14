'use strict';

// Brain Builder: CLIENT_BRAIN.md <-> form values.
//
//   markdownToForm(markdownSource)                    -> { fields, frontmatter }
//   formToMarkdown(fields, { frontmatter, preserved }) -> markdownSource
//
// The schema (form-schema.js) names every field's heading and aliases, matching
// markdown.cjs / brain-sync.cjs. The document is edited in place: frontmatter,
// unknown sections, unknown `###` fields, headings the form did not change and
// any prose outside a field body are kept verbatim. Only fields whose value
// changed are rewritten, so parse -> serialize -> parse is lossless.

const { normalizeKey, setFrontmatterValues, SCHEMA_VERSION } = require('./markdown.cjs');
const schema = require('./form-schema.js');

const { BRAIN_FORM_SECTIONS, ALL_FIELDS, FIELD_BY_KEY } = schema;

class FormValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'FormValidationError';
    this.status = 400;
    this.details = details;
  }
}

/* ------------------------------------------------------------ doc parsing */

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { fm: '', body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { fm: '', body: text };
  const bodyStart = text.indexOf('\n', end + 4);
  if (bodyStart === -1) return { fm: text, body: '' };
  return { fm: text.slice(0, bodyStart + 1), body: text.slice(bodyStart + 1) };
}

// { preamble: string[], blocks: [{ head, pre: string[], fields: [{ head, lines }] }] }
function parseDoc(source) {
  const text = String(source || '').replace(/\r\n/g, '\n');
  const { fm, body } = splitFrontmatter(text);
  const doc = { fm, preamble: [], blocks: [] };
  let block = null;
  let fld = null;
  for (const line of body.split('\n')) {
    if (/^##\s+\S/.test(line) && !/^###/.test(line)) {
      block = { head: line, pre: [], fields: [] };
      fld = null;
      doc.blocks.push(block);
    } else if (/^###\s+\S/.test(line) && block) {
      fld = { head: line, lines: [] };
      block.fields.push(fld);
    } else if (fld) {
      fld.lines.push(line);
    } else if (block) {
      block.pre.push(line);
    } else {
      doc.preamble.push(line);
    }
  }
  return doc;
}

const h2Name = (head) => head.replace(/^##\s+/, '').trim();
const h3Name = (head) => head.replace(/^###\s+/, '').trim();
const bodyText = (fld) => fld.lines.join('\n').trim();

function findBlock(doc, section) {
  const keys = new Set([section.title, ...(section.sectionAliases || [])].map(normalizeKey));
  return doc.blocks.find((b) => keys.has(normalizeKey(h2Name(b.head)))) || null;
}

// Mirrors markdown.cjs field(): first alias with a non-empty body wins; when all
// are empty, the first heading that exists is the write target.
function findField(block, fld) {
  if (!block) return null;
  const names = [fld.heading, ...(fld.aliases || [])];
  let firstExisting = null;
  for (const name of names) {
    const key = normalizeKey(name);
    const hit = block.fields.find((f) => normalizeKey(h3Name(f.head)) === key);
    if (!hit) continue;
    if (bodyText(hit)) return hit;
    if (!firstExisting) firstExisting = hit;
  }
  return firstExisting;
}

/* --------------------------------------------------------- value parsing */

const BULLET = /^[-*](?:\s+|$)/;

function parseList(body, keepCommas) {
  const out = [];
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim().replace(BULLET, '').trim();
    if (!line) continue;
    const parts = keepCommas ? [line] : line.split(/,(?=\s*[^,\s])/);
    for (const part of parts) {
      const item = part.trim();
      if (item) out.push(item);
    }
  }
  return out;
}

function canonicalRowKey(fld, rawKey) {
  const lower = String(rawKey || '').trim().toLowerCase();
  return fld.rowKeys.find((k) => k.toLowerCase() === lower) || null;
}

function emptyRow(fld) {
  return Object.fromEntries(fld.rowKeys.map((k) => [k, '']));
}

function parsePipeRow(fld, content) {
  const row = emptyRow(fld);
  const tail = fld.bareRowKey === 'post' ? 'post' : null;
  const segs = content.split('|');
  let known = 0;
  for (let i = 0; i < segs.length; i += 1) {
    const m = segs[i].match(/^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/);
    const key = m && canonicalRowKey(fld, m[1]);
    if (!key) continue;
    known += 1;
    if (key === tail) {
      row[key] = [m[2], ...segs.slice(i + 1)].join('|').trim();
      break;
    }
    row[key] = m[2].trim();
  }
  if (!known && fld.bareRowKey) row[fld.bareRowKey] = content.trim();
  return row;
}

function parseRows(fld, body) {
  const rows = [];
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trim();
    if (!/^[-*]\s+\S/.test(line)) continue;
    const content = line.replace(BULLET, '').trim();
    if (fld.rowFormat === 'keyed') {
      const m = content.match(/^([A-Za-z][A-Za-z0-9_\s-]*?)\s*:\s*(.+?)\s*$/);
      if (m) rows.push({ key: normalizeKey(m[1]), value: m[2].trim() });
      continue;
    }
    const row = parsePipeRow(fld, content);
    if (Object.values(row).some(Boolean)) rows.push(row);
  }
  return rows;
}

function parseFieldValue(fld, body) {
  const text = String(body || '');
  if (fld.kind === 'text') return text.replace(/\s*\n\s*/g, ' ').trim();
  if (fld.kind === 'textarea') return text.trim();
  if (fld.kind === 'list') return parseList(text, Boolean(fld.keepCommas));
  return parseRows(fld, text);
}

function emptyValue(fld) {
  return fld.kind === 'text' || fld.kind === 'textarea' ? '' : [];
}

const isEmptyValue = (value) => (typeof value === 'string' ? !value.trim() : !value || value.length === 0);

/* ----------------------------------------------------- normalize/validate */

const cell = (v) => String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim();

// Coerces a client-supplied value into the canonical shape or throws
// FormValidationError. Idempotent: normalize(normalize(v)) equals normalize(v).
function normalizeValue(fld, value, errors) {
  const bad = (msg) => { errors.push(`${fld.key}: ${msg}`); return emptyValue(fld); };
  if (value == null) return emptyValue(fld);
  if (fld.kind === 'text' || fld.kind === 'textarea') {
    if (typeof value !== 'string') return bad('expected a string');
    const out = fld.kind === 'text'
      ? value.replace(/\s*[\r\n]+\s*/g, ' ').trim()
      : value.replace(/\r\n/g, '\n').trim();
    if (/^#{2,3}\s/m.test(out)) return bad('a line may not start with "## " or "### "');
    return out;
  }
  if (!Array.isArray(value)) return bad('expected an array');
  if (fld.kind === 'list') {
    if (value.some((v) => typeof v !== 'string')) return bad('every item must be a string');
    return parseList(value.map((v) => v.replace(/[\r\n]+/g, ' ')).join('\n'), Boolean(fld.keepCommas));
  }
  // rows
  const rows = [];
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad(`row ${i + 1} must be an object`);
    const unknown = Object.keys(raw).filter((k) => !fld.rowKeys.includes(k));
    if (unknown.length) return bad(`row ${i + 1} has unknown keys: ${unknown.join(', ')}`);
    const tail = fld.bareRowKey === 'post' ? 'post' : null;
    const row = emptyRow(fld);
    for (const k of fld.rowKeys) {
      const v = raw[k];
      if (v != null && typeof v !== 'string' && typeof v !== 'number') return bad(`row ${i + 1} "${k}" must be a string`);
      let c = cell(v);
      if (k !== tail) c = c.replace(/\|/g, '/');
      row[k] = c;
    }
    if (fld.rowFormat === 'keyed') {
      row.key = normalizeKey(row.key);
      if (!row.key && !row.value) continue;
      if (!(fld.allowedRowKeys || []).includes(row.key)) {
        return bad(`row ${i + 1} key "${row.key}" must be one of: ${(fld.allowedRowKeys || []).join(', ')}`);
      }
      if (!row.value) return bad(`row ${i + 1} "${row.key}" needs a value`);
    } else if (!Object.values(row).some(Boolean)) {
      continue;
    }
    rows.push(row);
  }
  if (fld.maxRows && rows.length > fld.maxRows) return bad(`at most ${fld.maxRows} rows`);
  return rows;
}

function checkLengths(fld, value, errors) {
  if (!fld.maxLen) return;
  const tooLong = (s) => String(s).length > fld.maxLen;
  if (typeof value === 'string' && tooLong(value)) errors.push(`${fld.key}: longer than ${fld.maxLen} characters`);
  else if (fld.kind === 'list' && value.some(tooLong)) errors.push(`${fld.key}: an item is longer than ${fld.maxLen} characters`);
}

/* ---------------------------------------------------------- serialization */

function serializeRow(fld, row) {
  if (fld.rowFormat === 'keyed') return `- ${row.key}: ${row.value}`;
  const filled = fld.rowKeys.filter((k) => row[k]);
  if (fld.bareRowKey === 'post' && filled.length === 1 && filled[0] === 'post' && !/^\s*[A-Za-z][A-Za-z0-9_-]*\s*:/.test(row.post)) {
    return `- ${row.post}`;
  }
  return `- ${filled.map((k) => `${k}: ${row[k]}`).join(' | ')}`;
}

function serializeBody(fld, value) {
  if (fld.kind === 'text' || fld.kind === 'textarea') return String(value).split('\n');
  if (fld.kind === 'list') return value.map((item) => `- ${item}`);
  return value.map((row) => serializeRow(fld, row));
}

/* ------------------------------------------------------------- public API */

function markdownToForm(markdownSource) {
  const doc = parseDoc(markdownSource);
  const fields = {};
  for (const section of BRAIN_FORM_SECTIONS) {
    const block = findBlock(doc, section);
    for (const fld of section.fields) {
      const hit = findField(block, fld);
      fields[fld.key] = hit ? parseFieldValue(fld, bodyText(hit)) : emptyValue(fld);
    }
  }
  const frontmatter = {};
  doc.fm.split('\n').slice(1).forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0 && !line.startsWith('---')) frontmatter[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return { fields, frontmatter };
}

function defaultFrontmatterText(frontmatter = {}) {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    clientId: '',
    clientName: '',
    status: 'draft',
    ...frontmatter,
  };
  const lines = Object.entries(base).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function formToMarkdown(fields, { frontmatter = null, preserved = '' } = {}) {
  const input = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
  const errors = [];
  const unknownKeys = Object.keys(input).filter((k) => !FIELD_BY_KEY[k]);
  if (unknownKeys.length) errors.push(`Unknown field keys: ${unknownKeys.join(', ')}`);

  const hasPreserved = typeof preserved === 'string' && preserved.trim().length > 0;
  const doc = hasPreserved
    ? parseDoc(preserved)
    : parseDoc(`${defaultFrontmatterText(frontmatter || {})}\n# Client Brain\n`);

  // Pass 1: decide the target state of each field without touching the doc.
  const plan = [];
  for (const section of BRAIN_FORM_SECTIONS) {
    const block = findBlock(doc, section);
    for (const fld of section.fields) {
      const hit = findField(block, fld);
      const current = hit ? parseFieldValue(fld, bodyText(hit)) : emptyValue(fld);
      let want = current;
      if (Object.prototype.hasOwnProperty.call(input, fld.key)) {
        want = normalizeValue(fld, input[fld.key], errors);
        if (JSON.stringify(want) !== JSON.stringify(current)) checkLengths(fld, want, errors);
      }
      plan.push({ section, fld, hit, current, want });
    }
  }
  if (errors.length) throw new FormValidationError(errors[0], errors);

  // Pass 2: apply the plan.
  const sectionBlocks = new Map();
  for (const section of BRAIN_FORM_SECTIONS) {
    const items = plan.filter((p) => p.section === section);
    let block = findBlock(doc, section);
    const needsBlock = items.some((p) => p.fld.required || !isEmptyValue(p.want));
    if (!block && needsBlock) {
      block = { head: `## ${section.title}`, pre: [''], fields: [] };
      insertBlock(doc, block, section);
    }
    if (block) sectionBlocks.set(section.id, block);
  }

  for (const section of BRAIN_FORM_SECTIONS) {
    const block = sectionBlocks.get(section.id);
    if (!block) continue;
    for (const p of plan.filter((x) => x.section === section)) {
      const same = JSON.stringify(p.want) === JSON.stringify(p.current);
      const { fld } = p;
      const target = findField(block, fld);
      if (target && same) continue;
      if (!target && same && !fld.required) continue;
      if (target && isEmptyValue(p.want) && !fld.required) {
        block.fields.splice(block.fields.indexOf(target), 1);
        continue;
      }
      const lines = isEmptyValue(p.want) ? [''] : [...serializeBody(fld, p.want), ''];
      if (target) {
        target.lines = lines;
      } else {
        insertField(block, section, fld, { head: `### ${fld.heading}`, lines });
      }
    }
  }

  const rendered = [];
  if (doc.preamble.length) rendered.push(...doc.preamble);
  for (const block of doc.blocks) {
    rendered.push(block.head, ...block.pre);
    for (const f of block.fields) rendered.push(f.head, ...f.lines);
  }
  let text = `${doc.fm}${rendered.join('\n')}`.replace(/\n+$/, '\n');
  if (frontmatter && hasPreserved) {
    const patch = Object.fromEntries(Object.entries(frontmatter).filter(([, v]) => v != null));
    if (Object.keys(patch).length) text = setFrontmatterValues(text, patch);
  }
  return text;
}

// New `###` goes after the nearest earlier schema field present in the block,
// else before the first existing field.
function insertField(block, section, fld, entry) {
  const order = section.fields.map((f) => f.key);
  const idx = order.indexOf(fld.key);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = findField(block, section.fields[i]);
    if (prev) {
      block.fields.splice(block.fields.indexOf(prev) + 1, 0, entry);
      return;
    }
  }
  block.fields.unshift(entry);
}

// New `##` goes after the nearest earlier known section, else before the next
// known one, else before Decision Drivers, else at the end.
function insertBlock(doc, block, section) {
  const order = BRAIN_FORM_SECTIONS;
  const idx = order.indexOf(section);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = findBlock(doc, order[i]);
    if (prev) { doc.blocks.splice(doc.blocks.indexOf(prev) + 1, 0, block); return; }
  }
  for (let i = idx + 1; i < order.length; i += 1) {
    const next = findBlock(doc, order[i]);
    if (next) { doc.blocks.splice(doc.blocks.indexOf(next), 0, block); return; }
  }
  const drivers = doc.blocks.find((b) => normalizeKey(h2Name(b.head)) === 'decision_drivers');
  if (drivers) doc.blocks.splice(doc.blocks.indexOf(drivers), 0, block);
  else doc.blocks.push(block);
}

module.exports = {
  FormValidationError,
  markdownToForm,
  formToMarkdown,
  // exposed for tests / route
  parseDoc,
  ALL_FIELDS,
};
