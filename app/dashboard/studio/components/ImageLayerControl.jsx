'use client';

// IMAGE control for the image-layer element (kind: 'layer-image' in
// StudioElementInspector's GenericControl). Owns appearance.uploadAssetId:
// upload a JPG/PNG/WebP or pick one already in the shared browser-local
// uploaded-images library (ClothStudio's deviceScreenLibrary — the same
// store the Device Mockup screens use; it's simply "images this browser
// uploaded"). The plane in the scene rebuilds to the image's own aspect
// ratio on load (factories.js imageLayerPlaneSize) — never stretched.

import React, { useRef, useState } from 'react';
import { Upload, Trash2, XCircle } from 'lucide-react';
import { GLASS, ui } from './rail-ui';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImageLayerControl({ instance, disabled, onChange, deviceScreenLibrary, onAddDeviceScreenImage, onDeleteDeviceScreenImage }) {
  const [status, setStatus] = useState('');
  const fileInputRef = useRef(null);
  const uploadAssetId = instance.appearance?.uploadAssetId || '';
  const library = deviceScreenLibrary || [];
  const active = library.find((a) => a.assetId === uploadAssetId) || null;

  const onUploadFile = (file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) { setStatus('PNG, JPEG, or WebP only.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setStatus(`Too large (${formatBytes(file.size)}) — max ${formatBytes(MAX_UPLOAD_BYTES)}.`); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const added = onAddDeviceScreenImage({ name: file.name, dataUrl: String(reader.result || ''), sizeBytes: file.size });
      onChange('appearance', 'uploadAssetId', added.assetId);
      setStatus(added.persisted
        ? `Using ${file.name}.`
        : `Using ${file.name} — but it could NOT be saved for next session (browser storage is full); it will be gone after reload.`);
    };
    reader.onerror = () => setStatus('Could not read that file.');
    reader.readAsDataURL(file);
  };

  return (
    <div id="cloth-image-layer-control" style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <span style={ui.label}>IMAGE</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(',')} style={{ display: 'none' }}
          onChange={(e) => { onUploadFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <button
          id="cloth-image-layer-upload-btn"
          style={{ ...ui.btn(), height: 28, padding: '0 12px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={12} strokeWidth={2.5} /> Upload image
        </button>
        {active ? (
          <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active.name}</span>
        ) : null}
      </div>
      {library.length ? (
        <div id="cloth-image-layer-library-list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...ui.label, color: GLASS.inkMute }}>UPLOADED IMAGES</span>
          {library.map((a) => (
            <div key={a.assetId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
              <button
                style={{ ...ui.btn(a.assetId === uploadAssetId), height: 26, padding: '0 10px', fontSize: 10 }}
                disabled={disabled || a.assetId === uploadAssetId}
                onClick={() => { onChange('appearance', 'uploadAssetId', a.assetId); setStatus(`Using ${a.name}.`); }}
              >
                {a.assetId === uploadAssetId ? 'In use' : 'Use'}
              </button>
              <button
                title="Remove from library"
                style={{ ...ui.btn(), height: 26, padding: '0 8px', fontSize: 10 }}
                disabled={disabled}
                onClick={() => { onDeleteDeviceScreenImage(a.assetId); if (a.assetId === uploadAssetId) onChange('appearance', 'uploadAssetId', ''); setStatus('Removed from library.'); }}
              >
                <Trash2 size={12} strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {uploadAssetId && !active ? (
        <span style={{ ...ui.label, color: '#b45309', textTransform: 'none', fontSize: 11 }}>
          The selected image isn&apos;t in this browser&apos;s library — showing the placeholder instead.
        </span>
      ) : null}
      {uploadAssetId ? (
        <button
          id="cloth-image-layer-clear-btn"
          style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={disabled}
          onClick={() => { onChange('appearance', 'uploadAssetId', ''); setStatus('Back to the placeholder.'); }}
        >
          <XCircle size={12} strokeWidth={2.5} /> Clear image
        </button>
      ) : null}
      {status ? <span style={{ ...ui.label, color: GLASS.inkMute, textTransform: 'none', fontSize: 11, lineHeight: 1.5 }}>{status}</span> : null}
    </div>
  );
}
