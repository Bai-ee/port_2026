// "My Themes" library (pure; storage injected). Named snapshots of theme
// definitions kept in one JSON blob under STORAGE_KEYS.library. Nothing here
// throws on bad storage: a corrupt or unreadable blob reads as empty plus a notice.

import { STORAGE_KEYS } from '../theme/constants.js';
import { normalizeDefinition, validateDefinition, hashDefinition } from '../theme/validate.js';
import { resolveTheme } from '../theme/resolve.js';

export const LIBRARY_CAP = 50;
export const LIBRARY_SCHEMA = 'hitloop.theme-library';
export const LIBRARY_VERSION = 1;
const NAME_MAX = 80;

function adaptStorage(storage) {
  if (!storage) return { get: () => null, set: () => false };
  if (typeof storage.get === 'function') {
    return { get: (k) => storage.get(k), set: (k, v) => storage.set(k, v) !== false };
  }
  return {
    get: (k) => storage.getItem(k),
    set: (k, v) => { storage.setItem(k, v); return true; },
  };
}

function cleanName(name, fallback = 'Untitled theme') {
  const n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return n || fallback;
}

/** Light-mode swatches for the list: accent, page, text. */
export function previewOf(definition) {
  try {
    const r = resolveTheme(definition, 'light', { assumeCanonical: true }).roles;
    return { accent: r.accent.hex, page: r.page.hex, text: r.text.hex };
  } catch {
    return { accent: '#000000', page: '#ffffff', text: '#000000' };
  }
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const v = validateDefinition(raw.definition);
  if (!v.ok) return null;
  const definition = v.definition;
  const t = (x, d) => (Number.isFinite(x) ? x : d);
  return {
    id: raw.id,
    name: cleanName(raw.name, definition.meta.name),
    starred: raw.starred === true,
    createdAt: t(raw.createdAt, 0),
    updatedAt: t(raw.updatedAt, t(raw.createdAt, 0)),
    hash: hashDefinition(definition),
    definition,
    preview: previewOf(definition),
  };
}

export function createLibrary({ storage, now = () => Date.now(), cap = LIBRARY_CAP } = {}) {
  const store = adaptStorage(storage);
  let counter = 0;
  const newId = () => `lib_${now().toString(36)}_${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  /** { entries, notice } — never throws. */
  function read() {
    let raw;
    try { raw = store.get(STORAGE_KEYS.library); } catch { return { entries: [], notice: 'Your saved themes could not be read, so the list is empty.' }; }
    if (raw == null || raw === '') return { entries: [], notice: '' };
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { entries: [], notice: 'Your saved themes were corrupt and could not be read. The list starts empty.' }; }
    const list = parsed && Array.isArray(parsed.entries) ? parsed.entries : null;
    if (!list) return { entries: [], notice: 'Your saved themes were in an unknown format. The list starts empty.' };
    const entries = [];
    let dropped = 0;
    for (const e of list) {
      const s = sanitizeEntry(e);
      if (s) entries.push(s); else dropped += 1;
    }
    return { entries, notice: dropped ? `${dropped} unreadable ${dropped === 1 ? 'theme was' : 'themes were'} skipped.` : '' };
  }

  function write(entries) {
    try {
      return !!store.set(STORAGE_KEYS.library, JSON.stringify({ schema: LIBRARY_SCHEMA, version: LIBRARY_VERSION, entries }));
    } catch { return false; }
  }

  const sorted = (entries) => entries.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  /** Evict oldest unstarred until within cap. Returns { entries, evicted[] }. */
  function enforceCap(entries) {
    const out = entries.slice();
    const evicted = [];
    while (out.length > cap) {
      let idx = -1;
      for (let i = 0; i < out.length; i += 1) {
        if (!out[i].starred && (idx < 0 || out[i].updatedAt < out[idx].updatedAt)) idx = i;
      }
      if (idx < 0) break;
      evicted.push(out.splice(idx, 1)[0]);
    }
    return { entries: out, evicted };
  }

  const fail = (notice) => ({ ok: false, notice });
  const STORAGE_FAIL = 'Could not save to this browser (storage is unavailable or full).';

  function mutate(id, fn) {
    const { entries } = read();
    const i = entries.findIndex((e) => e.id === id);
    if (i < 0) return fail('That theme no longer exists.');
    const next = entries.slice();
    const updated = fn(entries[i]);
    next[i] = updated;
    if (!write(next)) return fail(STORAGE_FAIL);
    return { ok: true, entry: updated, notice: '' };
  }

  function add(entries, base, { fresh = true } = {}) {
    const t = now();
    const entry = { ...base, id: newId(), createdAt: t, updatedAt: t };
    const { entries: capped, evicted } = enforceCap([...entries, entry]);
    if (!capped.includes(entry)) {
      return fail(`Your library is full (${cap} themes, all starred). Unstar or delete one first.`);
    }
    if (!write(capped)) return fail(STORAGE_FAIL);
    const notice = evicted.length ? `Library is full: removed the oldest unstarred theme "${evicted[0].name}".` : '';
    return { ok: true, entry, evicted, notice, fresh };
  }

  return {
    cap,

    /** { entries (newest first), notice } */
    list() {
      const { entries, notice } = read();
      return { entries: sorted(entries), notice };
    },

    save({ name, definition } = {}) {
      const def = normalizeDefinition(definition);
      const { entries } = read();
      return add(entries, {
        name: cleanName(name, def.meta.name),
        starred: false,
        hash: hashDefinition(def),
        definition: def,
        preview: previewOf(def),
      });
    },

    /** { ok, definition (canonical), entry } */
    load(id) {
      const e = read().entries.find((x) => x.id === id);
      if (!e) return fail('That theme no longer exists.');
      return { ok: true, entry: e, definition: normalizeDefinition(e.definition), notice: '' };
    },

    rename(id, name) {
      return mutate(id, (e) => ({ ...e, name: cleanName(name, e.name), updatedAt: now() }));
    },

    duplicate(id) {
      const { entries } = read();
      const src = entries.find((x) => x.id === id);
      if (!src) return fail('That theme no longer exists.');
      return add(entries, {
        name: cleanName(`${src.name} copy`),
        starred: false,
        hash: src.hash,
        definition: src.definition,
        preview: src.preview,
      });
    },

    remove(id) {
      const { entries } = read();
      if (!entries.some((e) => e.id === id)) return fail('That theme no longer exists.');
      if (!write(entries.filter((e) => e.id !== id))) return fail(STORAGE_FAIL);
      return { ok: true, notice: '' };
    },

    /** star(id) toggles; star(id, true|false) sets. Does not change updatedAt. */
    star(id, value) {
      return mutate(id, (e) => ({ ...e, starred: typeof value === 'boolean' ? value : !e.starred }));
    },

    exportAll() {
      const { entries } = read();
      return JSON.stringify({
        schema: LIBRARY_SCHEMA,
        version: LIBRARY_VERSION,
        exportedAt: now(),
        entries: sorted(entries).map(({ preview, ...rest }) => rest),
      }, null, 2);
    },

    /** merge:true (default) adds to the library; merge:false replaces it. Imported entries get fresh ids. */
    importAll(json, { merge = true } = {}) {
      let parsed;
      try { parsed = typeof json === 'string' ? JSON.parse(json.replace(/^﻿/, '')) : json; } catch { return { ...fail('That file is not valid JSON.'), added: 0, skipped: 0 }; }
      const list = parsed && parsed.schema === LIBRARY_SCHEMA && Array.isArray(parsed.entries) ? parsed.entries : null;
      if (!list) return { ...fail('That file is not a Studio theme library export.'), added: 0, skipped: 0 };

      let entries = merge ? read().entries : [];
      const known = new Set(entries.map((e) => e.hash + '|' + e.name));
      let added = 0;
      let skipped = 0;
      for (const raw of list) {
        const s = sanitizeEntry({ ...raw, id: typeof raw?.id === 'string' && raw.id ? raw.id : 'x' });
        if (!s) { skipped += 1; continue; }
        const key = `${s.hash}|${s.name}`;
        if (known.has(key)) { skipped += 1; continue; }
        known.add(key);
        entries.push({ ...s, id: newId() });
        added += 1;
      }
      const { entries: capped, evicted } = enforceCap(entries);
      let notice = `Imported ${added} ${added === 1 ? 'theme' : 'themes'}${skipped ? `, skipped ${skipped} (duplicates or invalid)` : ''}.`;
      if (capped.length > cap) {
        notice += ` Library limit is ${cap}; some starred themes could not be kept.`;
        capped.length = cap;
      }
      if (evicted.length) notice += ` Removed ${evicted.length} oldest unstarred to stay within ${cap}.`;
      if (!write(capped)) return { ...fail(STORAGE_FAIL), added: 0, skipped };
      return { ok: true, added, skipped, notice };
    },
  };
}
