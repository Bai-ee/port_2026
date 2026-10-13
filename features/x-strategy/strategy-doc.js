// strategy-doc.js - pure logic for the owner's Strategy document, x_strategy_docs/{clientId}.
// Client-safe: no node:/firebase imports, no I/O. Store: strategy-doc-store.js. Seed: strategy-doc-seed.js.
//
// The document is the top of the strategy hierarchy: doc (why/what) -> plan knobs (how much) -> daily loop.
// The owner edits it directly ('manual'); the chat agent changes it only through a confirmed proposal ('chat').
// Decisions (see tests):
// - Fixed section keys; an edit replaces whole sections. Unknown keys are rejected, never stored.
// - History is ordered OLDEST FIRST, capped at DOC_HISTORY_CAP; each entry stores only the CHANGED sections'
//   before/after text, so any retained version can be restored without bloating the doc.
// - A doc that only holds the seed draft is `confirmed:false` until the owner's first save. Consumers that act on
//   strategy (the drafter) read only a confirmed doc; the chat sees a draft but is told it is a draft.

export const STRATEGY_DOC_SECTIONS = Object.freeze([
  { key: 'thesis', title: 'Thesis', hint: 'What this account is for and the one rule everything else follows.' },
  { key: 'audience', title: 'Audience', hint: 'Who you are trying to reach, and what they come for.' },
  { key: 'tracks', title: 'Tracks', hint: 'The content lanes (design, music, ...) and why each exists.' },
  { key: 'formats', title: 'Formats', hint: 'Which post types do which job (reach vs conversion) and how they are built.' },
  { key: 'rules', title: 'Rules', hint: 'Do / don\'t. Short, checkable lines.' },
  { key: 'algorithm', title: 'Algorithm', hint: 'What the X ranking rewards and penalizes, as it applies to you.' },
  { key: 'decisions', title: 'Decisions', hint: 'Settled calls, each with its date and the evidence. Not relitigated without new data.' },
  { key: 'open', title: 'Open questions', hint: 'What we are still testing or need data for.' },
]);
export const SECTION_KEYS = Object.freeze(STRATEGY_DOC_SECTIONS.map((s) => s.key));
export const SECTION_MAX = 2000;
export const DOC_HISTORY_CAP = 25;
export const REASON_MAX = 200;
export const DOC_SOURCES = Object.freeze(['manual', 'chat', 'seed']);

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const cleanText = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

function toIso(now) {
  const d = now === undefined ? new Date() : new Date(now);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export const sectionTitle = (key) => STRATEGY_DOC_SECTIONS.find((s) => s.key === key)?.title ?? key;

/** Every section key present (missing -> ''); unknown keys dropped. */
export function normalizeSections(raw) {
  const src = isPlain(raw) ? raw : {};
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, typeof src[k] === 'string' ? cleanText(src[k]) : '']));
}

/** Validate an edit map ({key: text}). @returns {{ok:boolean, errors:string[], edits?:object}} */
export function validateEdits(edits) {
  const errors = [];
  if (!isPlain(edits) || !Object.keys(edits).length) return { ok: false, errors: ['sections must be a non-empty object'] };
  const out = {};
  for (const [k, v] of Object.entries(edits)) {
    if (!SECTION_KEYS.includes(k)) { errors.push(`unknown section: ${String(k).slice(0, 40)}`); continue; }
    if (typeof v !== 'string') { errors.push(`${k} must be a string`); continue; }
    const text = cleanText(v);
    if (text.length > SECTION_MAX) { errors.push(`${k} must be at most ${SECTION_MAX} characters`); continue; }
    out[k] = text;
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [], edits: out };
}

/** Fresh version-0 shape (never persisted by get). */
export function emptyDoc() {
  return { version: 0, updatedAt: null, updatedBy: null, confirmed: false, sections: normalizeSections({}), lastReview: null, history: [] };
}

/** The seeded draft as a version-0 doc (not persisted until the owner saves). */
export function draftDoc(seedSections) {
  return { ...emptyDoc(), sections: normalizeSections(seedSections), isDraft: true };
}

/**
 * Apply section edits. `doc` null/undefined = absent (version 0).
 * @param {{sections:object, by:string, source:'manual'|'chat'|'seed', reason?:string, proposalId?:string,
 *          expectedVersion:number, now?:any, base?:object}} req  `base` = sections to start from when no doc exists
 *          (the seed draft), so a first save of one section keeps the other drafted sections.
 * @returns {object | {error:'invalid'|'version-conflict'|'noop', errors?:string[], currentVersion?:number}}
 */
export function applyDocEdit(doc, req = {}) {
  const current = doc ?? { ...emptyDoc(), sections: normalizeSections(req.base) };
  const { by, source, reason, proposalId, expectedVersion, now } = req;
  const errors = [];
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) errors.push('expectedVersion must be a non-negative integer');
  if (typeof by !== 'string' || !by.trim()) errors.push('by is required');
  if (!DOC_SOURCES.includes(source)) errors.push(`source must be one of ${DOC_SOURCES.join(', ')}`);
  const v = validateEdits(req.sections);
  if (!v.ok) errors.push(...v.errors);
  if (errors.length) return { error: 'invalid', errors };
  if (expectedVersion !== (current.version ?? 0)) return { error: 'version-conflict', currentVersion: current.version ?? 0 };

  const beforeAll = normalizeSections(current.sections);
  const changed = Object.keys(v.edits).filter((k) => beforeAll[k] !== v.edits[k]);
  // Saving an unchanged draft still confirms it (the owner read it and said "this is my strategy").
  const confirming = !current.confirmed && source === 'manual';
  if (!changed.length && !confirming) return { error: 'noop' };

  const at = toIso(now);
  const version = (current.version ?? 0) + 1;
  const sections = { ...beforeAll, ...v.edits };
  const entry = {
    version, at, by, source, ...(proposalId ? { proposalId } : {}),
    reason: String(reason ?? '').slice(0, REASON_MAX),
    changed,
    before: Object.fromEntries(changed.map((k) => [k, beforeAll[k]])),
    after: Object.fromEntries(changed.map((k) => [k, sections[k]])),
    ...(confirming ? { confirmed: true } : {}),
  };
  return {
    version, updatedAt: at, updatedBy: by,
    confirmed: current.confirmed || source === 'manual',
    sections,
    lastReview: current.lastReview ?? null,
    history: [...(current.history ?? []), entry].slice(-DOC_HISTORY_CAP),
  };
}

/**
 * Sections as they stood right AFTER `version`, rebuilt by walking history backwards from the current doc.
 * @returns {object|null} sections, or null when that version is no longer reconstructable (history capped).
 */
export function sectionsAtVersion(doc, version) {
  if (!doc || !Number.isInteger(version) || version < 1 || version > doc.version) return null;
  const hist = doc.history ?? [];
  const oldest = hist[0]?.version;
  // Undoing entries newer than `version` needs every one of them to be retained.
  if (version < doc.version && (oldest === undefined || oldest > version + 1)) return null;
  const sections = normalizeSections(doc.sections);
  for (let i = hist.length - 1; i >= 0 && hist[i].version > version; i -= 1) {
    for (const k of hist[i].changed ?? []) sections[k] = hist[i].before?.[k] ?? '';
  }
  return sections;
}

/** Restore `version` as a NEW version (history never rewinds). */
export function revertDoc(doc, version, { by, now } = {}) {
  if (!doc) return { error: 'invalid', errors: ['no strategy document to revert'] };
  if (typeof by !== 'string' || !by.trim()) return { error: 'invalid', errors: ['by is required'] };
  const target = sectionsAtVersion(doc, version);
  if (!target) return { error: 'version-unavailable' };
  return applyDocEdit(doc, { sections: target, by, source: 'manual', reason: `restore v${version}`, expectedVersion: doc.version, now });
}

/** Stamp the last strategy review (Review button / session opener). Not a content change: no version bump. */
export function withLastReview(doc, review) {
  if (!doc) return null;
  return { ...clone(doc), lastReview: isPlain(review) ? clone(review) : null };
}

/**
 * Plain-text rendering for prompts. `only` limits to some sections; `maxChars` caps the result.
 * Empty sections are skipped; a draft is labelled so a reader never mistakes it for confirmed strategy.
 */
export function renderDocText(doc, { only = null, maxChars = 8000 } = {}) {
  if (!doc) return '';
  const sections = normalizeSections(doc.sections);
  const keys = (Array.isArray(only) ? only : SECTION_KEYS).filter((k) => SECTION_KEYS.includes(k) && sections[k]);
  if (!keys.length) return '';
  const head = doc.confirmed
    ? `STRATEGY DOCUMENT v${doc.version} (confirmed by the owner)`
    : 'STRATEGY DOCUMENT (DRAFT - the owner has not confirmed it yet; treat as a proposal, not settled strategy)';
  const body = keys.map((k) => `## ${sectionTitle(k)}\n${sections[k]}`).join('\n\n');
  const text = `${head}\n\n${body}`;
  return text.length > maxChars ? `${text.slice(0, maxChars - 20).trimEnd()}\n...[truncated]` : text;
}

export const GUIDANCE_SECTIONS = Object.freeze(['rules', 'formats']);
export const GUIDANCE_MAX = 1800;

/**
 * The part of a CONFIRMED doc the drafter follows (Rules + Formats), or '' for a draft / missing doc.
 * Kept short on purpose: it rides inside every drafting prompt.
 */
export function strategyGuidance(doc) {
  if (!doc?.confirmed) return '';
  const sections = normalizeSections(doc.sections);
  const parts = GUIDANCE_SECTIONS.filter((k) => sections[k]).map((k) => `${sectionTitle(k)}:\n${sections[k]}`);
  if (!parts.length) return '';
  const text = `The owner's confirmed strategy (v${doc.version}) - follow it:\n${parts.join('\n\n')}`;
  return text.length > GUIDANCE_MAX ? `${text.slice(0, GUIDANCE_MAX - 3).trimEnd()}...` : text;
}

/** One-line description of a history entry, for chat event lines and the History list. */
export function describeDocChange(entry) {
  if (!entry) return '';
  const who = entry.source === 'chat' ? 'from chat' : entry.source === 'seed' ? 'seeded' : `by ${entry.by || 'owner'}`;
  const what = (entry.changed ?? []).map(sectionTitle).join(', ');
  const verb = entry.confirmed && !what ? 'confirmed' : `${what || 'no sections'} edited`;
  return `Strategy v${entry.version} - ${verb} ${who}${entry.reason ? ` (${entry.reason})` : ''}`;
}
