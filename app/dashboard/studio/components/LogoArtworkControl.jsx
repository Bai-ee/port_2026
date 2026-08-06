'use client';

// Front-logo picker — the one custom (kind: 'logo-artwork') Inspector
// control for the hanging-tshirt element (docs/plans/STUDIO-HANGING-TSHIRT-
// SONNET-HANDOFF.md). Owns appearance.logoAssetId plus the coupled "Reset
// placement"/"Remove logo" actions (same coupled-control precedent as
// GlbAssetControl owning assetId+animationClip together) — the four
// placement sliders (X/Y/scale/rotation) and opacity stay plain generic
// `kind: 'slider'` controls declared in catalog.js.
//
// Deliberately browser-local, NOT the admin-only /api/dashboard/studio-
// assets GLB pipeline (that route is hardcoded to binary .glb — see
// api/_lib/studio-glb-assets.cjs) and NOT the main Cloth Studio sheet's own
// artwork library (ClothStudio.jsx BUILTIN_ARTWORKS/ARTWORK_LIB_KEY, which
// re-encodes uploads as JPEG via canvas.toDataURL and so silently discards
// alpha transparency — unacceptable for a logo the handoff requires to
// "preserve alpha without dark or white boxes"). This library
// (ClothStudio.jsx `logoLibrary`/TSHIRT_LOGO_LIB_KEY) stores the ORIGINAL
// uploaded file bytes as a data URL (PNG/JPEG/WebP, whichever the user
// supplied) with no re-encoding step, so alpha is never touched.

import React, { useState } from 'react';
import { Upload, Trash2, RotateCcw, XCircle } from 'lucide-react';
import { GLASS, ui } from './rail-ui';

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Matches catalog.js hanging-tshirt fieldSpec.appearance defaults exactly —
// "Reset placement" restores these, not an arbitrary neutral guess.
const LOGO_PLACEMENT_DEFAULTS = { logoX: 0, logoY: 0, logoScale: 1, logoRotation: 0, logoOpacity: 1 };

// CORRECTION (Codex review, P2): neither of these existed before — an
// oversized upload had no upfront warning (it just silently failed to
// persist, or in the worst case pushed the whole browser-local library over
// quota), and a low-resolution logo had no warning at all despite the
// handoff's explicit requirement to "surface an honest warning when the
// supplied logo is too small for the requested placement/output."
//
// Data URLs are ~4/3 the raw file's byte size (base64), and localStorage
// quotas are commonly ~5-10MB per origin, shared with every other
// localStorage key this app already writes (settings, artwork library,
// scene templates, presets) — 3MB keeps a single logo (≈4MB as a data URL)
// from being able to blow the whole origin's quota by itself.
const MAX_LOGO_FILE_BYTES = 3 * 1024 * 1024;
// A conservative "will look soft at a large placement/4K export" floor —
// approximate, not a promise (the actual sharpness a user sees also depends
// on LOGO SCALE and how large the shirt itself is framed), but honest
// enough to flag a genuinely undersized source image before it surprises
// someone in an export.
const MIN_LOGO_DIMENSION_PX = 512;

/** Decodes `dataUrl` far enough to read its pixel dimensions — browser-only (`Image`), used just for the upload-time resolution warning below. */
function readImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not read this image’s dimensions.'));
    img.src = dataUrl;
  });
}

export default function LogoArtworkControl({ instance, disabled, onChange, logoLibrary, onAddLogo, onDeleteLogo }) {
  const [status, setStatus] = useState(null); // { kind: 'error'|'info'|'warn', text }
  const [busy, setBusy] = useState(false);

  const assetId = instance.appearance.logoAssetId;
  const selected = (logoLibrary || []).find((a) => a.assetId === assetId) || null;

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus({ kind: 'error', text: 'Only PNG, JPEG, or WebP logos are supported.' });
      return;
    }
    if (file.size > MAX_LOGO_FILE_BYTES) {
      setStatus({ kind: 'error', text: `${file.name} is ${formatBytes(file.size)} — logos are capped at ${formatBytes(MAX_LOGO_FILE_BYTES)} so one upload can't fill the browser-local library on its own.` });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: `Reading ${file.name}…` });
    const reader = new FileReader();
    reader.onerror = () => {
      setStatus({ kind: 'error', text: 'Could not read that file.' });
      setBusy(false);
    };
    reader.onload = async () => {
      const dataUrl = reader.result;
      let dims = null;
      try {
        dims = await readImageDimensions(dataUrl);
      } catch { /* dimension check is a nice-to-have warning, not a hard requirement — proceed without it */ }
      try {
        const entry = onAddLogo({
          fileName: file.name, sizeBytes: file.size, mimeType: file.type, dataUrl,
          width: dims?.width || null, height: dims?.height || null,
        });
        onChange('appearance', 'logoAssetId', entry.assetId);
        const lowRes = dims && Math.max(dims.width, dims.height) < MIN_LOGO_DIMENSION_PX;
        if (!entry.persisted) {
          setStatus({ kind: 'warn', text: `${file.name} added for THIS SESSION ONLY — your browser couldn’t save it permanently (storage may be full). It will disappear on reload; delete another logo first, or re-upload after reloading.` });
        } else if (lowRes) {
          setStatus({ kind: 'warn', text: `${file.name} added (${dims.width}×${dims.height}px) — that’s below the ${MIN_LOGO_DIMENSION_PX}px we’d recommend for a large placement or a 4K export; it may look soft.` });
        } else {
          setStatus({ kind: 'info', text: `${file.name} added.` });
        }
      } catch (err) {
        setStatus({ kind: 'error', text: err.message || 'Could not save that logo — the browser-local library may be full.' });
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = () => {
    if (!selected) return;
    onDeleteLogo(selected.assetId);
    onChange('appearance', 'logoAssetId', '');
    setStatus(null);
  };

  const handleResetPlacement = () => {
    Object.entries(LOGO_PLACEMENT_DEFAULTS).forEach(([key, val]) => onChange('appearance', key, val));
  };

  const handleRemoveLogo = () => {
    onChange('appearance', 'logoAssetId', '');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <span style={ui.label}>FRONT LOGO</span>
      <select
        value={assetId || ''}
        disabled={disabled || busy}
        onChange={(e) => onChange('appearance', 'logoAssetId', e.target.value)}
        style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
      >
        <option value="">{(logoLibrary || []).length ? 'Choose a logo…' : 'No logos uploaded yet'}</option>
        {(logoLibrary || []).map((a) => (
          <option key={a.assetId} value={a.assetId}>{a.fileName} · {formatBytes(a.sizeBytes)}</option>
        ))}
      </select>

      <label
        style={{
          ...ui.btn(), height: 34, padding: '0 12px', fontSize: 10, width: '100%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled || busy ? 0.5 : 1,
        }}
      >
        <Upload size={12} strokeWidth={2.5} /> Upload logo (PNG/JPEG/WebP)
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} disabled={disabled || busy} style={{ display: 'none' }} />
      </label>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button" onClick={handleResetPlacement} disabled={disabled || busy}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled || busy ? 0.5 : 1 }}
        >
          <RotateCcw size={12} strokeWidth={2.5} /> Reset placement
        </button>
        <button
          type="button" onClick={handleRemoveLogo} disabled={disabled || busy || !assetId}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled || busy || !assetId ? 0.5 : 1 }}
        >
          <XCircle size={12} strokeWidth={2.5} /> Remove logo
        </button>
      </div>

      {selected ? (
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled || busy}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled || busy ? 0.5 : 1 }}
        >
          <Trash2 size={12} strokeWidth={2.5} /> Delete from library
        </button>
      ) : null}

      <span style={{ fontFamily: GLASS.sans, fontSize: 10, lineHeight: 1.4, color: GLASS.inkMute }}>
        Saved in this browser only — a logo won&apos;t appear on another device until re-uploaded there.
      </span>

      {status ? (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.4, color: status.kind === 'error' ? '#dc2626' : status.kind === 'warn' ? '#b45309' : GLASS.inkMute }}>
          {status.text}
        </span>
      ) : null}
    </div>
  );
}
