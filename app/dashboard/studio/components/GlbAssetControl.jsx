'use client';

// GLB asset picker — the one custom (kind: 'glb-asset') Inspector control
// for the glb-import element type (docs/plans/ORIGINAL-STUDIO-CINEMATIC-
// SETS-4K-PLAN.md "GLB import and asset safety"). Owns BOTH
// appearance.assetId and appearance.animationClip together (the animation
// list depends on which asset is selected — see catalog.js's comment on
// why this is one coupled control, not two independent bucket/key
// sliders), plus upload + delete against the admin-only /api/dashboard/
// studio-assets route. Fetches its OWN list only as a mount-time
// convenience refresh; the authoritative `glbAssets` state lives in
// ClothStudio.jsx (shared with the live factory's ctx.glbAssetsById — see
// that file's live-object-sync effect) so the UI and the actual renderer
// are always looking at the same library, never two independent copies.

import React, { useEffect, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { GLASS, ui } from './rail-ui';

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GlbAssetControl({ instance, disabled, onChange, authedFetch, glbAssets, onRefreshGlbAssets }) {
  const [status, setStatus] = useState(null); // { kind: 'error'|'info', text }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onRefreshGlbAssets?.().catch((err) => setStatus({ kind: 'error', text: err.message || 'Could not load the GLB library.' }));
    // Mount-time convenience refresh only — re-fetching on every render would
    // hammer the admin-only list endpoint for no reason; ClothStudio.jsx's
    // own state is the shared source of truth this component (and the live
    // factory) both read from afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const assetId = instance.appearance.assetId;
  const selected = (glbAssets || []).find((a) => a.assetId === assetId) || null;

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setBusy(true);
    setStatus({ kind: 'info', text: `Uploading ${file.name}…` });
    try {
      const reqRes = await authedFetch('/api/dashboard/studio-assets?action=request-upload', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, sizeBytes: file.size }),
      });
      const reqData = await reqRes.json();
      if (!reqRes.ok) throw new Error(reqData?.error || `HTTP ${reqRes.status}`);

      // Direct browser -> Storage PUT — never proxied through our own
      // server (the plan's explicit requirement). The signed URL itself is
      // the authorization; no auth header needed or sent here.
      const putRes = await fetch(reqData.uploadUrl, { method: 'PUT', headers: { 'content-type': 'model/gltf-binary' }, body: file });
      if (!putRes.ok) throw new Error(`Upload to storage failed: HTTP ${putRes.status}`);

      setStatus({ kind: 'info', text: 'Validating…' });
      const confirmRes = await authedFetch('/api/dashboard/studio-assets?action=confirm', {
        method: 'POST',
        body: JSON.stringify({ assetId: reqData.assetId, storagePath: reqData.storagePath, fileName: file.name }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData?.error || `HTTP ${confirmRes.status}`);

      await onRefreshGlbAssets?.();
      onChange('appearance', 'assetId', reqData.assetId);
      onChange('appearance', 'animationClip', '');
      setStatus({ kind: 'info', text: `${file.name} uploaded — ${confirmData.asset.meshCount} mesh(es), ${confirmData.asset.triangleEstimate.toLocaleString()} triangles (est.).` });
    } catch (err) {
      setStatus({ kind: 'error', text: err.message || 'Upload failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await authedFetch('/api/dashboard/studio-assets?action=delete', {
        method: 'POST',
        body: JSON.stringify({ assetId: selected.assetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      onChange('appearance', 'assetId', '');
      onChange('appearance', 'animationClip', '');
      await onRefreshGlbAssets?.();
      setStatus(null);
    } catch (err) {
      setStatus({ kind: 'error', text: err.message || 'Delete failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <span style={ui.label}>GLB ASSET</span>
      <select
        value={assetId || ''}
        disabled={disabled || busy}
        onChange={(e) => { onChange('appearance', 'assetId', e.target.value); onChange('appearance', 'animationClip', ''); }}
        style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
      >
        <option value="">{(glbAssets || []).length ? 'Choose an uploaded asset…' : 'No assets uploaded yet'}</option>
        {(glbAssets || []).map((a) => (
          <option key={a.assetId} value={a.assetId}>{a.fileName} · {formatBytes(a.sizeBytes)} · {a.meshCount} mesh{a.meshCount === 1 ? '' : 'es'}</option>
        ))}
      </select>

      <label
        style={{
          ...ui.btn(), height: 34, padding: '0 12px', fontSize: 10, width: '100%',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          cursor: disabled || busy ? 'not-allowed' : 'pointer', opacity: disabled || busy ? 0.5 : 1,
        }}
      >
        <Upload size={12} strokeWidth={2.5} /> Upload .glb
        <input type="file" accept=".glb,model/gltf-binary" onChange={handleUpload} disabled={disabled || busy} style={{ display: 'none' }} />
      </label>

      {selected ? (
        <button
          type="button"
          onClick={handleDelete}
          disabled={disabled || busy}
          style={{ ...ui.btn(), height: 30, padding: '0 10px', fontSize: 10, width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: disabled || busy ? 0.5 : 1 }}
        >
          <Trash2 size={12} strokeWidth={2.5} /> Delete this asset
        </button>
      ) : null}

      {selected && selected.animationNames?.length ? (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={ui.label}>ANIMATION</span>
          <select
            value={instance.appearance.animationClip || ''}
            disabled={disabled || busy}
            onChange={(e) => onChange('appearance', 'animationClip', e.target.value)}
            style={{ ...ui.btn(), appearance: 'none', width: '100%' }}
          >
            <option value="">No animation (static)</option>
            {selected.animationNames.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      ) : null}

      {status ? (
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.4, color: status.kind === 'error' ? '#dc2626' : GLASS.inkMute }}>
          {status.text}
        </span>
      ) : null}
    </div>
  );
}
