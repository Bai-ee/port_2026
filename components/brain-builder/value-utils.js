// Pure helpers for the Brain Builder form. No React, no DOM — unit-testable.
// Draft value shapes: text/textarea -> string, list -> raw multi-line string
// (so blank lines survive while typing), rows -> array of { [rowKey]: string }.

export function humanizeKey(key) {
  const spaced = String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : '';
}

// rowKeys entries may be plain strings or { key, label }.
export function rowKeyMeta(rowKey) {
  if (rowKey && typeof rowKey === 'object') {
    const key = String(rowKey.key || '');
    return { key, label: rowKey.label || humanizeKey(key) };
  }
  const key = String(rowKey || '');
  return { key, label: humanizeKey(key) };
}

export function parseListText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listToText(list) {
  return Array.isArray(list) ? list.map((item) => String(item ?? '')).join('\n') : String(list ?? '');
}

export function emptyRow(rowKeys = []) {
  const row = {};
  for (const rk of rowKeys) row[rowKeyMeta(rk).key] = '';
  return row;
}

export function normalizeRow(row, rowKeys = []) {
  const out = {};
  for (const rk of rowKeys) {
    const { key } = rowKeyMeta(rk);
    out[key] = String(row?.[key] ?? '');
  }
  return out;
}

export function isRowEmpty(row) {
  return !Object.values(row || {}).some((v) => String(v ?? '').trim());
}

export function parseRows(rows, rowKeys = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => normalizeRow(row, rowKeys))
    .filter((row) => !isRowEmpty(row));
}

// Server value -> draft value.
export function toDraftValue(field, value) {
  switch (field.kind) {
    case 'list':
      return listToText(value);
    case 'rows':
      return (Array.isArray(value) ? value : []).map((row) => normalizeRow(row, field.rowKeys || []));
    default:
      return String(value ?? '');
  }
}

// Draft value -> payload value for POST.
export function toPayloadValue(field, draft) {
  switch (field.kind) {
    case 'list':
      return parseListText(draft);
    case 'rows':
      return parseRows(draft, field.rowKeys || []);
    default:
      return String(draft ?? '').trim();
  }
}

export function buildDraft(fields, serverValues = {}) {
  const draft = {};
  for (const field of fields) draft[field.key] = toDraftValue(field, serverValues?.[field.key]);
  return draft;
}

export function buildPayload(fields, draft = {}) {
  const payload = {};
  for (const field of fields) payload[field.key] = toPayloadValue(field, draft[field.key]);
  return payload;
}

export function isFieldFilled(field, draft) {
  const payload = toPayloadValue(field, draft);
  return Array.isArray(payload) ? payload.length > 0 : payload.length > 0;
}

export function sectionProgress(section, draft) {
  const fields = section.fields || [];
  const filled = fields.filter((f) => isFieldFilled(f, draft?.[f.key])).length;
  return { filled, total: fields.length };
}

// Text length used for char counters.
export function fieldLength(field, draftValue) {
  return String(draftValue ?? '').length;
}

export function isOverLimit(field, draftValue) {
  if (!field.maxLen || (field.kind !== 'text' && field.kind !== 'textarea')) return false;
  return fieldLength(field, draftValue) > field.maxLen;
}

// Progress from a countFilled()-style result { filled, total, requiredMissing }.
export function progressFrom(counts) {
  const total = Math.max(0, Number(counts?.total) || 0);
  const filled = Math.min(total, Math.max(0, Number(counts?.filled) || 0));
  const pct = total ? Math.round((filled / total) * 100) : 0;
  return {
    filled,
    total,
    pct,
    label: `${filled} of ${total} fields filled`,
    requiredMissing: Array.isArray(counts?.requiredMissing) ? counts.requiredMissing : [],
  };
}

export function stableStringify(value) {
  return JSON.stringify(value);
}
