'use client';

// Invoice Studio rail — LogoControl (design-layer plan Q2, Lane B). Mounted
// inside CoverCard's identity/logo subsection. Accepts a PNG/JPEG/WebP or
// sanitized SVG, enforces the 300 KB cap, and writes/clears
// `invoice.logoDataUrl` via draft.applyFieldEdit — the same one write path
// every other rail control uses (see useInvoiceDraft.js's own header
// comment). Client-only file I/O: FileReader + the browser's DOMParser
// (inside svg-sanitizer.js) — no server call, matching L12/no-new-API-route.

import React, { useCallback, useId, useRef, useState } from 'react';
import { GLASS, ui } from '../../components/rail-ui';
import { RailField, RailEmptyHint } from './rail-field-controls';
import { sanitizeSvgMarkup, svgTextToDataUrl } from '../identity/svg-sanitizer.js';

const MAX_LOGO_BYTES = 300 * 1024;
const ACCEPTED_RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read file.')));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read file.')));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

function isSvgFile(file) {
  const type = String(file?.type || '').toLowerCase();
  if (type === 'image/svg+xml') return true;
  if (type) return false; // a known, non-SVG mime type is authoritative
  return /\.svg$/i.test(String(file?.name || ''));
}

export default function LogoControl({ draft }) {
  const { invoice } = draft;
  const inputId = useId();
  const inputRef = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(async (fileList) => {
    const file = fileList && fileList[0];
    if (!file) return;
    setError('');
    if (file.size > MAX_LOGO_BYTES) {
      setError(`"${file.name}" is ${(file.size / 1024).toFixed(0)} KB — the logo limit is 300 KB.`);
      return;
    }
    setBusy(true);
    try {
      if (isSvgFile(file)) {
        const text = await readAsText(file);
        const result = sanitizeSvgMarkup(text);
        if (!result.ok) {
          setError(`SVG rejected: ${result.reason}`);
          return;
        }
        draft.applyFieldEdit('logoDataUrl', svgTextToDataUrl(result.svgText), 'rail');
        return;
      }
      const type = String(file.type || '').toLowerCase();
      if (!ACCEPTED_RASTER_MIMES.has(type)) {
        setError('Unsupported file type — use PNG, JPEG, WebP, or SVG.');
        return;
      }
      const dataUrl = await readAsDataUrl(file);
      draft.applyFieldEdit('logoDataUrl', dataUrl, 'rail');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  }, [draft]);

  const onInputChange = useCallback((e) => {
    handleFiles(e.target.files);
    e.target.value = ''; // allow re-selecting the same filename after an error
  }, [handleFiles]);

  const removeLogo = useCallback(() => {
    setError('');
    draft.applyFieldEdit('logoDataUrl', null, 'rail');
  }, [draft]);

  return (
    <div id="invoice-rail-cover-logo-control" style={{ display: 'grid', gap: 8 }}>
      <RailField label="Logo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {invoice.logoDataUrl ? (
            <span
              id="invoice-rail-cover-logo-preview"
              style={{
                width: 44, height: 44, borderRadius: 8, border: '1px solid ' + GLASS.hair,
                background: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={invoice.logoDataUrl} alt="Uploaded logo preview" style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </span>
          ) : (
            <RailEmptyHint>No logo uploaded.</RailEmptyHint>
          )}

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            style={{ ...ui.btn(false), opacity: busy ? 0.6 : 1, cursor: busy ? 'wait' : 'pointer' }}
          >
            {invoice.logoDataUrl ? 'Replace logo' : 'Upload logo'}
          </button>
          {invoice.logoDataUrl ? (
            <button
              type="button"
              onClick={removeLogo}
              style={{ ...ui.btn(false), color: '#dc2626', borderColor: 'rgba(220,38,38,0.35)' }}
            >
              Remove logo
            </button>
          ) : null}

          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={onInputChange}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
            aria-label="Upload logo file"
          />
        </div>
      </RailField>
      {error ? (
        <span id="invoice-rail-cover-logo-error" role="alert" style={{ fontSize: 11.5, color: '#dc2626', lineHeight: 1.4 }}>
          {error}
        </span>
      ) : (
        <RailEmptyHint>PNG, JPEG, WebP, or SVG. 300 KB max. SVGs are sanitized: scripts, event handlers, and external references are rejected.</RailEmptyHint>
      )}
    </div>
  );
}
