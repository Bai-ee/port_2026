// Brief Studio - draft shape + localStorage helpers. Pure and browser-safe
// (no React, no network). Drafts are per browser AND per client, and are only
// ever read or written for an admin (see useBriefDraft.js).

import { normalizeTheme } from '../invoice/themes/theme-schema.js';

export const BRIEF_DRAFT_KEY_PREFIX = 'brief-studio-draft-v1';
export const BRIEF_MAX_CHARS = 50000;

export function emptyBriefDraft() {
  return {
    title: '',
    text: '',
    themeId: null,
    publicToggle: true,
    savedSlug: '',
    ogSubhead: '',
    hideOgSubhead: false,
    ogTitleLines: ['', ''],
    ogLines: ['', ''],
  };
}

export function briefDraftKey(clientId) {
  const id = String(clientId || '').trim();
  return id ? `${BRIEF_DRAFT_KEY_PREFIX}:${id}` : '';
}

// Positions are kept (a blank line 1 with a filled line 2 stays that way); the
// server re-normalizes with normalizeClientBriefOg on publish.
const padLines = (list, min, max, maxLen) => {
  const next = (Array.isArray(list) ? list : []).slice(0, max).map((line) => String(line || '').slice(0, maxLen));
  while (next.length < min) next.push('');
  return next;
};

// Never trusts stored JSON: every field is re-validated.
export function normalizeBriefDraft(raw) {
  const base = emptyBriefDraft();
  if (!raw || typeof raw !== 'object') return base;
  return {
    title: String(raw.title || '').slice(0, 140),
    text: String(raw.text || '').slice(0, BRIEF_MAX_CHARS + 1),
    themeId: normalizeTheme(typeof raw.themeId === 'string' ? { id: raw.themeId } : null)?.id || null,
    publicToggle: raw.publicToggle !== false,
    savedSlug: /^client-brief-\d{8}-[0-9a-f]{16}$/.test(String(raw.savedSlug || '')) ? String(raw.savedSlug) : '',
    ogSubhead: String(raw.ogSubhead || '').slice(0, 160),
    hideOgSubhead: raw.hideOgSubhead === true,
    ogTitleLines: padLines(raw.ogTitleLines, 2, 3, 40),
    ogLines: padLines(raw.ogLines, 2, 2, 120),
  };
}

// Draft from a saved client brief (serializeBriefDoc shape).
export function draftFromSavedBrief(brief) {
  return normalizeBriefDraft({
    title: brief?.title,
    text: brief?.sourceText,
    themeId: brief?.theme,
    publicToggle: brief?.public !== false,
    savedSlug: brief?.briefSlug,
    ogSubhead: brief?.ogSubhead,
    hideOgSubhead: brief?.hideOgSubhead,
    ogTitleLines: brief?.ogTitleLines,
    ogLines: brief?.ogLines,
  });
}

export function readBriefDraft(storage, clientId) {
  const key = briefDraftKey(clientId);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? normalizeBriefDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeBriefDraft(storage, clientId, draft) {
  const key = briefDraftKey(clientId);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify(normalizeBriefDraft(draft)));
    return true;
  } catch {
    return false;
  }
}

export function clearBriefDraft(storage, clientId) {
  const key = briefDraftKey(clientId);
  if (!key || !storage) return;
  try { storage.removeItem(key); } catch { /* blocked storage */ }
}

// Draft after the picked client changes. Typed content survives a pick ONLY when
// no client was ever picked (`firstPick`); afterwards a switch loads the new
// client's stored draft or resets to empty (title, markdown, OG, theme, slug), so
// one client's text can never be saved under or published for another. A saved
// slug is never carried across.
export function draftAfterClientChange({ current, stored, hasClient, firstPick, isAdmin }) {
  if (!hasClient) {
    return isAdmin && firstPick ? { ...normalizeBriefDraft(current), savedSlug: '' } : emptyBriefDraft();
  }
  if (stored) return stored;
  return firstPick ? { ...normalizeBriefDraft(current), savedSlug: '' } : emptyBriefDraft();
}

// Records the slug a publish returned against the client it was published FOR,
// even when the operator has switched to another client meanwhile (the rail for
// the old client is gone and cannot call markSaved). Returning to that client
// then hydrates a draft that already knows its slug, so the next Publish updates
// instead of creating a duplicate. `snapshot` is the draft as submitted; it is
// used only when nothing is stored for that client yet.
export function recordSavedSlug(storage, clientId, slug, snapshot) {
  if (!briefDraftKey(clientId) || !slug) return false;
  const base = readBriefDraft(storage, clientId) || normalizeBriefDraft(snapshot);
  return writeBriefDraft(storage, clientId, { ...base, savedSlug: slug });
}
