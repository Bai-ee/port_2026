'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Plus, Trash2, X } from 'lucide-react';

import { PILLARS, SERIES } from '../../../features/x-content-inventory/categories.js';
import {
  EFFORT_LEVELS,
  MEDIA_STATES,
  PLATFORMS,
  RIGHTS_STATES,
  STATUSES,
  validatePackage,
} from '../../../features/x-content-inventory/schema.js';

// InventoryPanel — the supply side of the posting engine, edited by hand.
//
// PURELY PRESENTATIONAL: it fetches nothing and persists nothing. `onSave` and
// `onDelete` hand the work back to the parent card, which owns the transport,
// and `savingId` is how the parent says which row is in flight.
//
// STYLE: this file emits NO CSS. Every class is `xce-` prefixed and the parent
// card owns the rules, because that card already carries the `<style jsx global>`
// block for this surface and two blocks would fight over the same selectors.
//
// VALIDATION: `audit` is the parent's whole-inventory pass (validateInventory),
// which is the right source for the row list. The editor re-runs the same pure
// `validatePackage` against the DRAFT, because a form that reports the last
// SAVED state blocks a save the user has already fixed. The audit entry is
// merged in only while the draft is untouched, so nothing the parent knows gets
// dropped and nothing stale survives the first keystroke.

const NEW_ID = '__new__';

const EMPTY_DRAFT = {
  id: '',
  title: '',
  story: '',
  series: '',
  pillar: '',
  // Documented safe default: anything a client touched starts needing clearance.
  rights: 'client-approval-needed',
  mediaState: '',
  effort: '',
  status: 'idea',
  platforms: [],
  cta: '',
  eraYear: '',
  eventDate: '',
  assetRefsText: '',
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function domId(value) {
  return slugify(value) || 'row';
}

function splitList(text) {
  return String(text || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The pillar keys read as sentences; a select needs the clause before the dash. */
function pillarShort(key) {
  const label = PILLARS[key];
  if (!label) return key || '';
  return label.split('—')[0].trim();
}

function seriesLabel(key) {
  return SERIES[key]?.label || '';
}

function toDraft(pkg) {
  if (!pkg) return { ...EMPTY_DRAFT };
  return {
    // Spread first so fields this form does not edit (entities, lastPostedAt,
    // postCount) survive a round trip instead of being silently erased.
    ...pkg,
    id: pkg.id ?? '',
    title: pkg.title ?? '',
    story: pkg.story ?? '',
    series: pkg.series ?? '',
    pillar: pkg.pillar ?? '',
    rights: pkg.rights ?? '',
    mediaState: pkg.mediaState ?? '',
    effort: pkg.effort ?? '',
    status: pkg.status ?? 'idea',
    platforms: Array.isArray(pkg.platforms) ? [...pkg.platforms] : [],
    cta: pkg.cta ?? '',
    eraYear: pkg.eraYear == null ? '' : String(pkg.eraYear),
    eventDate: typeof pkg.eventDate === 'string' ? pkg.eventDate.slice(0, 10) : '',
    assetRefsText: Array.isArray(pkg.assetRefs) ? pkg.assetRefs.join(', ') : '',
  };
}

function toPackage(draft) {
  const { assetRefsText, ...rest } = draft;
  const year = Number.parseInt(draft.eraYear, 10);
  return {
    ...rest,
    id: String(draft.id || '').trim(),
    title: String(draft.title || '').trim(),
    story: String(draft.story || '').trim(),
    platforms: [...(draft.platforms || [])],
    assetRefs: splitList(assetRefsText),
    cta: String(draft.cta || '').trim() || null,
    eraYear: Number.isFinite(year) ? year : null,
    eventDate: draft.eventDate ? draft.eventDate : null,
  };
}

/** `audit` is validateInventory's report; tolerate a bare results array too. */
function auditEntryFor(audit, id) {
  if (!id) return null;
  const rows = Array.isArray(audit) ? audit : (Array.isArray(audit?.results) ? audit.results : []);
  return rows.find((r) => r && r.id === id) || null;
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function countLabel(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default function InventoryPanel({ packages, audit, loading, error, savingId, onSave, onDelete }) {
  const rows = useMemo(() => (Array.isArray(packages) ? packages.filter(Boolean) : []), [packages]);

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [idTouched, setIdTouched] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A row deleted elsewhere must not leave an editor open over nothing.
  useEffect(() => {
    if (!editingId || editingId === NEW_ID) return;
    if (!rows.some((p) => p.id === editingId)) {
      setEditingId(null);
      setDirty(false);
      setConfirmDelete(false);
    }
  }, [rows, editingId]);

  const openRow = useCallback((pkg) => {
    setEditingId(pkg.id);
    setDraft(toDraft(pkg));
    setDirty(false);
    setIdTouched(true);
    setConfirmDelete(false);
  }, []);

  const openNew = useCallback(() => {
    setEditingId(NEW_ID);
    setDraft({ ...EMPTY_DRAFT });
    setDirty(false);
    setIdTouched(false);
    setConfirmDelete(false);
  }, []);

  const closeEditor = useCallback(() => {
    setEditingId(null);
    setDirty(false);
    setConfirmDelete(false);
  }, []);

  const setField = useCallback((name, value) => {
    setDirty(true);
    setConfirmDelete(false);
    setDraft((d) => ({ ...d, [name]: value }));
  }, []);

  const setTitle = useCallback((value) => {
    setDirty(true);
    setConfirmDelete(false);
    setDraft((d) => (idTouched ? { ...d, title: value } : { ...d, title: value, id: slugify(value) }));
  }, [idTouched]);

  const togglePlatform = useCallback((platform) => {
    setDirty(true);
    setConfirmDelete(false);
    setDraft((d) => {
      const list = Array.isArray(d.platforms) ? d.platforms : [];
      return {
        ...d,
        platforms: list.includes(platform) ? list.filter((p) => p !== platform) : [...list, platform],
      };
    });
  }, []);

  const payload = useMemo(() => toPackage(draft), [draft]);
  const live = useMemo(() => validatePackage(payload), [payload]);

  const duplicateId = useMemo(() => {
    if (!payload.id) return false;
    return rows.some((p) => p.id === payload.id && p.id !== editingId);
  }, [rows, payload.id, editingId]);

  const stored = useMemo(
    () => (editingId && editingId !== NEW_ID ? auditEntryFor(audit, editingId) : null),
    [audit, editingId],
  );

  const errors = useMemo(() => {
    const base = [...live.errors];
    if (duplicateId) base.push(`duplicate id: ${payload.id}`);
    return unique(dirty || !stored ? base : [...base, ...(stored.errors || [])]);
  }, [live.errors, duplicateId, payload.id, dirty, stored]);

  const warnings = useMemo(
    () => unique(dirty || !stored ? live.warnings : [...live.warnings, ...(stored.warnings || [])]),
    [live.warnings, dirty, stored],
  );

  const busy = savingId != null && (savingId === editingId || savingId === payload.id);
  const canSave = errors.length === 0 && !busy;

  async function handleSave() {
    if (!canSave) return;
    const wasNew = editingId === NEW_ID;
    const result = onSave?.(payload);
    if (result && typeof result.then === 'function') {
      try {
        await result;
      } catch {
        return;
      }
    }
    setDirty(false);
    setConfirmDelete(false);
    if (wasNew) setEditingId(payload.id);
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    onDelete?.(editingId);
    setConfirmDelete(false);
  }

  const total = rows.length;
  const valid = Array.isArray(audit?.results)
    ? audit.results.filter((r) => r && r.ok).length
    : null;

  return (
    <div id="x-content-inventory-panel" className="xce-inv">
      {/* ── Inventory list ──────────────────────────────────────────────── */}
      <section id="x-content-inventory-list-section" className="xce-inv-section">
        <div id="x-content-inventory-list-head" className="xce-inv-head">
          <span className="xce-inv-kicker">Inventory</span>
          <span className="xce-inv-count">
            {countLabel(total, 'package')}
            {valid != null ? ` · ${valid} valid` : ''}
          </span>
          <button
            type="button"
            id="x-content-inventory-add-button"
            className="xce-btn xce-btn-primary"
            onClick={openNew}
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {error ? (
          <p id="x-content-inventory-error" className="xce-notice xce-notice-error">{String(error)}</p>
        ) : null}

        {loading ? (
          <div id="x-content-inventory-loading" className="xce-empty">Loading packages…</div>
        ) : total === 0 ? (
          <div id="x-content-inventory-empty" className="xce-empty">No packages yet.</div>
        ) : (
          <ul id="x-content-inventory-list" className="xce-inv-list">
            {rows.map((pkg) => {
              const entry = auditEntryFor(audit, pkg.id);
              const warnCount = entry?.warnings?.length || 0;
              const errCount = entry?.errors?.length || 0;
              const active = editingId === pkg.id;
              const rowBusy = savingId != null && savingId === pkg.id;
              return (
                <li
                  id={`x-content-inventory-row-${domId(pkg.id)}`}
                  key={pkg.id || pkg.title}
                  className="xce-inv-row-item"
                >
                  <button
                    type="button"
                    className={`xce-inv-row${active ? ' is-active' : ''}${rowBusy ? ' is-busy' : ''}`}
                    onClick={() => openRow(pkg)}
                    aria-current={active ? 'true' : undefined}
                  >
                    <span className="xce-inv-thumb" data-series={pkg.series || 'none'} aria-hidden="true">
                      {pkg.series || '—'}
                    </span>
                    <span className="xce-inv-row-main">
                      <span className="xce-inv-row-title">{pkg.title || pkg.id || 'Untitled'}</span>
                      <span className="xce-inv-row-meta">
                        <span className="xce-inv-meta-item">{pillarShort(pkg.pillar) || 'no pillar'}</span>
                        {rowBusy ? <span className="xce-inv-meta-item">Saving…</span> : null}
                      </span>
                    </span>
                    <span className="xce-inv-row-flags">
                      <span className="xce-chip xce-chip-series">
                        {pkg.series || '—'}{seriesLabel(pkg.series) ? ` · ${seriesLabel(pkg.series)}` : ''}
                      </span>
                      <span className="xce-chip xce-chip-status" data-status={pkg.status || 'idea'}>
                        {pkg.status || 'idea'}
                      </span>
                      {errCount ? (
                        <span className="xce-chip xce-chip-error">
                          <AlertTriangle size={11} /> {countLabel(errCount, 'error')}
                        </span>
                      ) : null}
                      {warnCount ? (
                        <span className="xce-chip xce-chip-warn">{countLabel(warnCount, 'note')}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Editor ──────────────────────────────────────────────────────── */}
      {editingId ? (
        <section id="x-content-inventory-editor" className="xce-inv-section xce-editor">
          <div id="x-content-inventory-editor-head" className="xce-inv-head">
            <span className="xce-inv-kicker">{editingId === NEW_ID ? 'New package' : 'Edit package'}</span>
            <button
              type="button"
              id="x-content-inventory-editor-close-button"
              className="xce-btn xce-btn-ghost"
              onClick={closeEditor}
            >
              <X size={14} /> Close
            </button>
          </div>

          <form
            id="x-content-inventory-editor-form"
            className="xce-form"
            onSubmit={(e) => { e.preventDefault(); handleSave(); }}
          >
            <div id="x-content-inventory-title-field" className="xce-field xce-field-wide">
              <label className="xce-field-label" htmlFor="x-content-inventory-field-title">Title</label>
              <input
                id="x-content-inventory-field-title"
                className="xce-input"
                type="text"
                value={draft.title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What this post is, in your words"
              />
            </div>

            <div id="x-content-inventory-id-field" className="xce-field xce-field-wide">
              <label className="xce-field-label" htmlFor="x-content-inventory-field-id">Slug</label>
              <input
                id="x-content-inventory-field-id"
                className={`xce-input${editingId !== NEW_ID ? ' is-locked' : ''}`}
                type="text"
                value={draft.id}
                readOnly={editingId !== NEW_ID}
                onChange={(e) => { setIdTouched(true); setField('id', slugify(e.target.value)); }}
                placeholder="stable-slug"
              />
              <p className="xce-field-hint">
                {editingId === NEW_ID
                  ? 'Set once. Other rows and the ledger point at it.'
                  : 'Fixed after the first save.'}
              </p>
            </div>

            <div id="x-content-inventory-story-field" className="xce-field xce-field-wide">
              <label className="xce-field-label" htmlFor="x-content-inventory-field-story">Story</label>
              <textarea
                id="x-content-inventory-field-story"
                className="xce-textarea"
                rows={6}
                value={draft.story}
                onChange={(e) => setField('story', e.target.value)}
                placeholder="What happened, who was there, why it mattered"
              />
              <p className="xce-field-hint xce-hint-strong">
                No model can write this — you were there and it was not, and a thin story makes a weak post.
              </p>
            </div>

            <div className="xce-form-grid">
              <div id="x-content-inventory-series-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-series">Series</label>
                <select
                  id="x-content-inventory-field-series"
                  className="xce-select"
                  value={draft.series}
                  onChange={(e) => setField('series', e.target.value)}
                >
                  <option value="">Select a series</option>
                  {Object.keys(SERIES).map((key) => (
                    <option key={key} value={key}>{key} · {SERIES[key].label}</option>
                  ))}
                </select>
              </div>

              <div id="x-content-inventory-pillar-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-pillar">Pillar</label>
                <select
                  id="x-content-inventory-field-pillar"
                  className="xce-select"
                  value={draft.pillar}
                  onChange={(e) => setField('pillar', e.target.value)}
                >
                  <option value="">Select a pillar</option>
                  {Object.keys(PILLARS).map((key) => (
                    <option key={key} value={key}>{pillarShort(key)}</option>
                  ))}
                </select>
              </div>

              <div id="x-content-inventory-media-state-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-media-state">Media</label>
                <select
                  id="x-content-inventory-field-media-state"
                  className="xce-select"
                  value={draft.mediaState}
                  onChange={(e) => setField('mediaState', e.target.value)}
                >
                  <option value="">Select a media state</option>
                  {MEDIA_STATES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>

              <div id="x-content-inventory-effort-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-effort">Effort</label>
                <select
                  id="x-content-inventory-field-effort"
                  className="xce-select"
                  value={draft.effort}
                  onChange={(e) => setField('effort', e.target.value)}
                >
                  <option value="">Select an effort level</option>
                  {EFFORT_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
                <p className="xce-field-hint">Anything past ready cannot fill a slot inside 24 hours.</p>
              </div>
            </div>

            <div id="x-content-inventory-rights-field" className="xce-field xce-field-wide">
              <label className="xce-field-label" htmlFor="x-content-inventory-field-rights">Rights</label>
              <select
                id="x-content-inventory-field-rights"
                className="xce-select"
                value={draft.rights}
                onChange={(e) => setField('rights', e.target.value)}
              >
                <option value="">Select a rights state</option>
                {RIGHTS_STATES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <p id="x-content-inventory-rights-note" className="xce-field-note">
                Anything client-related stays out of owned until you hold the clearance.
              </p>
            </div>

            <div className="xce-form-grid">
              <div id="x-content-inventory-status-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-status">Status</label>
                <select
                  id="x-content-inventory-field-status"
                  className="xce-select"
                  value={draft.status}
                  onChange={(e) => setField('status', e.target.value)}
                >
                  {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>

              <div id="x-content-inventory-era-year-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-era-year">Era year</label>
                <input
                  id="x-content-inventory-field-era-year"
                  className="xce-input"
                  type="number"
                  inputMode="numeric"
                  min="1900"
                  max="2100"
                  value={draft.eraYear}
                  onChange={(e) => setField('eraYear', e.target.value)}
                  placeholder="1997"
                />
              </div>

              <div id="x-content-inventory-event-date-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-event-date">Event date</label>
                <input
                  id="x-content-inventory-field-event-date"
                  className="xce-input"
                  type="date"
                  value={draft.eventDate}
                  onChange={(e) => setField('eventDate', e.target.value)}
                />
                <p className="xce-field-hint">Drives the anniversary trigger.</p>
              </div>

              <div id="x-content-inventory-cta-field" className="xce-field">
                <label className="xce-field-label" htmlFor="x-content-inventory-field-cta">CTA</label>
                <input
                  id="x-content-inventory-field-cta"
                  className="xce-input"
                  type="text"
                  value={draft.cta}
                  onChange={(e) => setField('cta', e.target.value)}
                  placeholder="Where the self-reply sends people"
                />
              </div>
            </div>

            <div id="x-content-inventory-asset-refs-field" className="xce-field xce-field-wide">
              <label className="xce-field-label" htmlFor="x-content-inventory-field-asset-refs">Asset refs</label>
              <input
                id="x-content-inventory-field-asset-refs"
                className="xce-input"
                type="text"
                value={draft.assetRefsText}
                onChange={(e) => setField('assetRefsText', e.target.value)}
                placeholder="sha256, path or URL — comma separated"
              />
            </div>

            <div id="x-content-inventory-platforms-field" className="xce-field xce-field-wide">
              <span className="xce-field-label">Platforms</span>
              <div id="x-content-inventory-platform-toggles" className="xce-toggle-row">
                {PLATFORMS.map((platform) => {
                  const on = (draft.platforms || []).includes(platform);
                  return (
                    <button
                      type="button"
                      key={platform}
                      id={`x-content-inventory-platform-${platform}`}
                      className={`xce-toggle${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => togglePlatform(platform)}
                    >
                      {platform}
                    </button>
                  );
                })}
              </div>
            </div>

            {errors.length ? (
              <div id="x-content-inventory-editor-errors" className="xce-feedback xce-feedback-error">
                <p className="xce-feedback-head">
                  <AlertTriangle size={13} /> {countLabel(errors.length, 'error')} — save is blocked
                </p>
                <ul className="xce-feedback-list">
                  {errors.map((text, i) => <li key={i}>{text}</li>)}
                </ul>
              </div>
            ) : null}

            {warnings.length ? (
              <div id="x-content-inventory-editor-warnings" className="xce-feedback xce-feedback-warn">
                <p className="xce-feedback-head">{countLabel(warnings.length, 'note')} — advice, saving still works</p>
                <ul className="xce-feedback-list">
                  {warnings.map((text, i) => <li key={i}>{text}</li>)}
                </ul>
              </div>
            ) : null}

            <div id="x-content-inventory-editor-actions" className="xce-actions">
              <button type="submit" className="xce-btn xce-btn-primary" disabled={!canSave}>
                <Check size={14} /> {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="xce-btn xce-btn-ghost" onClick={closeEditor} disabled={busy}>
                Cancel
              </button>
              {editingId !== NEW_ID ? (
                <button
                  type="button"
                  id="x-content-inventory-delete-button"
                  className="xce-btn xce-btn-danger"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  <Trash2 size={14} /> {confirmDelete ? 'Confirm delete' : 'Delete'}
                </button>
              ) : null}
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
