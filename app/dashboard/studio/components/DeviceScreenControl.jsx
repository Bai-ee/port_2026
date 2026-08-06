'use client';

// WEBSITE SCREEN control — the device-mockup element's one custom Inspector
// control (kind: 'device-screen', registered in StudioElementInspector's
// GenericControl, same coupled-control precedent as GlbAssetControl/
// LogoArtworkControl). Owns BOTH screen-source fields together:
//
//   appearance.captureUrl   (Phase 2) — paste any website URL, CAPTURE calls
//     the PUBLIC route app/api/public/studio-device-capture (plain fetch —
//     deliberately NOT authedFetch; HOLO PAPER is a public tool and the
//     route's own quota/SSRF guardrails are the protection, owner decision
//     2026-07-31), and the returned same-origin image URL becomes the
//     scrolling screen texture. Successful captures are also remembered in
//     a small browser-local RECENT list for one-click reuse (free — the
//     serving GET is cached, no browserless call).
//   appearance.uploadAssetId (Phase 3) — an uploaded image from the
//     browser-local deviceScreenLibrary (ClothStudio state, original-bytes
//     data URLs, same pattern as the T-shirt logo library).
//   appearance.captureSourceUrl / captureViewport (Recovery round 2, Defect
//     1) — WHICH site/viewport captureUrl is actually an image OF, written
//     alongside captureUrl at every selection below. The Quick Export live
//     guard and the Proof/Final Render pin planner (elements/video-export.js)
//     only trust a capture as "of the current live site" when both match
//     the live URL/viewport exactly — this is what stops a stale capture
//     (of a different, earlier site) from silently exporting/rendering the
//     wrong website while Go Live points elsewhere.
//
// Selecting either source CLEARS the other, so exactly one is ever active —
// matching factories.js deviceWantedScreenSource's upload-over-capture
// priority without ever leaning on it in normal use. USE PLACEHOLDER clears
// both (and their provenance). The capture viewport always follows the
// instance's own DEVICE selection, so what you capture matches the hardware
// you're showing.

//   SHARE TAB (Phase 9, docs/plans/STUDIO-VIDEO-EXPORT-RESTORE-SONNET-
//     HANDOFF.md §9) — the ONLY screen source that puts the user's LIVE site
//     into the 3D scene as a real texture, so the Diffusion Camera / bloom /
//     treatment / grain actually apply to it. Go Live cannot do that (its
//     iframe is DOM behind an alpha hole in the canvas, which no GPU pass can
//     reach) and cross-origin pixels can't be read into a texture at all —
//     a consented getDisplayMedia share is the one legitimate way in.
//     Session-scoped: a MediaStream doesn't survive a reload, so nothing about
//     it is persisted and the copy below says so plainly. Rendered ONLY when
//     the host passes `onStartScreenShare` (ClothStudio's PRIMARY device
//     panel does; the Inspector's duplicate-device instances do not, and are
//     therefore completely unchanged).

import React, { useRef, useState } from 'react';
import { Globe, Upload, Trash2, XCircle, RefreshCw, MonitorPlay, Square } from 'lucide-react';
import { GLASS, ui } from './rail-ui';

// Small browser-local memory of successful captures (url/viewport/imageUrl)
// — component-owned on purpose (no ClothStudio plumbing): it's a
// convenience list, not an asset store; losing it costs nothing but a
// re-capture (and same-URL re-captures within 24h are served from the
// route's own cache anyway).
const RECENT_CAPTURES_KEY = 'holocloth-device-captures-recent-v1';
const RECENT_CAPTURES_MAX = 8;
const loadRecentCaptures = () => {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(window.localStorage.getItem(RECENT_CAPTURES_KEY) || '[]') || []; } catch { return []; }
};

// Mirrors LogoArtworkControl's caps: base64 is ~4/3 of raw bytes and the
// localStorage origin quota is shared with every other Studio library.
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DeviceScreenControl({
  instance, disabled, onChange, deviceScreenLibrary, onAddDeviceScreenImage, onDeleteDeviceScreenImage,
  idPrefix = 'cloth-device-screen',
  screenShare = null, screenShareStatus = '', screenShareBusy = false,
  onStartScreenShare = null, onStopScreenShare = null,
}) {
  const [urlDraft, setUrlDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // Phase 6 — the user-reachable way out of a cached capture that is fresh
  // but wrong. The route has always accepted `refresh: true`; nothing in the
  // UI ever sent it, so a bad/outdated cached capture of a URL could not be
  // replaced for 24h by any action available to the user. Off by default:
  // a normal re-capture of the same URL inside 24h stays free.
  const [forceRecapture, setForceRecapture] = useState(false);
  const [recent, setRecent] = useState(loadRecentCaptures);
  const fileInputRef = useRef(null);

  const captureUrl = instance.appearance?.captureUrl || '';
  const uploadAssetId = instance.appearance?.uploadAssetId || '';
  const viewport = instance.appearance?.viewport || 'desktop';
  const activeUpload = (deviceScreenLibrary || []).find((a) => a.assetId === uploadAssetId) || null;

  // Exactly one source active: every selection writes ALL FOUR fields —
  // captureUrl/uploadAssetId AND their capture provenance
  // (captureSourceUrl/captureViewport, Recovery round 2, Defect 1). A call
  // that omits captureSourceUrl/captureViewport (upload, clear/placeholder)
  // clears them along with the source they belong to — provenance can never
  // outlive the capture it describes.
  const setSource = (bucketValues) => {
    onChange('appearance', 'captureUrl', bucketValues.captureUrl ?? '');
    onChange('appearance', 'uploadAssetId', bucketValues.uploadAssetId ?? '');
    onChange('appearance', 'captureSourceUrl', bucketValues.captureSourceUrl ?? '');
    onChange('appearance', 'captureViewport', bucketValues.captureViewport ?? '');
  };

  const rememberCapture = (url, imageUrl) => {
    const entry = { url, viewport, imageUrl, at: Date.now() };
    const next = [entry, ...recent.filter((r) => r.imageUrl !== imageUrl)].slice(0, RECENT_CAPTURES_MAX);
    setRecent(next);
    try { window.localStorage.setItem(RECENT_CAPTURES_KEY, JSON.stringify(next)); } catch { /* non-critical */ }
  };

  const runCapture = async () => {
    const url = urlDraft.trim();
    if (!url || busy) return;
    setBusy(true);
    setStatus(`Capturing ${viewport} view${forceRecapture ? ' (fresh — ignoring the 24h cache)' : ''} — can take up to a minute…`);
    try {
      const res = await fetch('/api/public/studio-device-capture', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, viewport, ...(forceRecapture ? { refresh: true } : null) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setStatus(data?.error || `Capture failed (${res.status}).`);
        return;
      }
      setSource({ captureUrl: data.imageUrl, captureSourceUrl: url, captureViewport: viewport });
      rememberCapture(url, data.imageUrl);
      setStatus(
        data.cached
          ? (data.stale ? 'Loaded an earlier capture (fresh capture failed).' : 'Loaded from today’s capture cache.')
          : data.fellBackToViewport
            // Phase 6: the full page couldn't be rendered in time, so this is
            // one screen-height of the site. Say so — the device's scroll
            // animation has nothing to travel on a viewport-height texture.
            ? 'Captured — but only the top screenful; the full page took too long to render, so the screen won’t scroll.'
            : 'Captured.'
      );
    } catch (err) {
      setStatus(`Capture failed: ${String(err?.message || err)}`);
    } finally {
      setBusy(false);
    }
  };

  const onUploadFile = (file) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) { setStatus('PNG, JPEG, or WebP only.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setStatus(`Too large (${formatBytes(file.size)}) — max ${formatBytes(MAX_UPLOAD_BYTES)}.`); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const added = onAddDeviceScreenImage({ name: file.name, dataUrl: String(reader.result || ''), sizeBytes: file.size });
      setSource({ uploadAssetId: added.assetId });
      setStatus(added.persisted
        ? `Using ${file.name}.`
        : `Using ${file.name} — but it could NOT be saved for next session (browser storage is full); it will be gone after reload.`);
    };
    reader.onerror = () => setStatus('Could not read that file.');
    reader.readAsDataURL(file);
  };

  return (
    <div id={`${idPrefix}-control`} style={{ display: 'flex', flexDirection: 'column', gap: 6, opacity: disabled ? 0.4 : 1 }}>
      <span style={ui.label}>WEBSITE SCREEN</span>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          id={`${idPrefix}-url-input`}
          type="text"
          placeholder="yoursite.com"
          value={urlDraft}
          disabled={disabled || busy}
          onChange={(e) => setUrlDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runCapture(); }}
          style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10 }}
        />
        <button
          id={`${idPrefix}-capture-btn`}
          style={{ ...ui.btn(busy), padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={disabled || busy || !urlDraft.trim()}
          onClick={runCapture}
        >
          <Globe size={12} strokeWidth={2.5} /> {busy ? 'Capturing…' : 'Capture'}
        </button>
      </div>

      <div id={`${idPrefix}-force-recapture-row`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          id={`${idPrefix}-force-recapture-toggle`}
          title="Ignore the 24h capture cache and take a brand-new screenshot. Use this if the saved capture is of the wrong site or out of date."
          style={{ ...ui.btn(forceRecapture), height: 26, padding: '0 10px', fontSize: 10 }}
          disabled={disabled || busy}
          onClick={() => setForceRecapture((v) => !v)}
        >
          <RefreshCw size={12} strokeWidth={2.5} /> Force fresh
        </button>
        <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>
          {forceRecapture ? 'Next capture ignores the 24h cache.' : 'Re-captures within 24h reuse the cached image.'}
        </span>
      </div>

      {recent.length ? (
        <div id={`${idPrefix}-recent-list`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...ui.label, color: GLASS.inkMute }}>RECENT CAPTURES</span>
          {recent.map((r) => (
            <div key={r.imageUrl} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.url} <span style={{ color: GLASS.inkMute }}>· {r.viewport}</span>
              </span>
              <button
                style={{ ...ui.btn(captureUrl === r.imageUrl), height: 26, padding: '0 10px', fontSize: 10 }}
                disabled={disabled || busy || captureUrl === r.imageUrl}
                onClick={() => { setSource({ captureUrl: r.imageUrl, captureSourceUrl: r.url, captureViewport: r.viewport }); setStatus(`Using capture of ${r.url}.`); }}
              >
                {captureUrl === r.imageUrl ? 'In use' : 'Use'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          ref={fileInputRef} type="file" accept={ACCEPTED_TYPES.join(',')} style={{ display: 'none' }}
          onChange={(e) => { onUploadFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <button
          id={`${idPrefix}-upload-btn`}
          style={{ ...ui.btn(), height: 28, padding: '0 12px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={disabled || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={12} strokeWidth={2.5} /> Upload image
        </button>
        {activeUpload ? (
          <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeUpload.name}
          </span>
        ) : null}
        {activeUpload ? (
          <button
            id={`${idPrefix}-upload-delete-btn`}
            title="Remove this image from the library"
            style={{ ...ui.btn(), height: 26, padding: '0 8px', fontSize: 10 }}
            disabled={disabled || busy}
            onClick={() => { onDeleteDeviceScreenImage(activeUpload.assetId); setSource({}); setStatus('Upload removed — back to the placeholder site.'); }}
          >
            <Trash2 size={12} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
      {uploadAssetId && !activeUpload ? (
        <span style={{ ...ui.label, color: '#b45309', textTransform: 'none', fontSize: 11 }}>
          The selected upload isn&apos;t in this browser&apos;s library — showing the placeholder site instead.
        </span>
      ) : null}

      {captureUrl || uploadAssetId ? (
        <button
          id={`${idPrefix}-clear-btn`}
          style={{ ...ui.btn(), height: 26, padding: '0 10px', fontSize: 10, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 5 }}
          disabled={disabled || busy}
          onClick={() => { setSource({}); setStatus('Back to the placeholder site.'); }}
        >
          <XCircle size={12} strokeWidth={2.5} /> Use placeholder
        </button>
      ) : null}
      {status ? <span style={{ ...ui.label, color: GLASS.inkMute, textTransform: 'none', fontSize: 11, lineHeight: 1.5 }}>{status}</span> : null}
      <span style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
        Captures the full page at the selected DEVICE’s viewport and scrolls it on the screen, or uses an uploaded image. Shared daily capture limits apply; re-capturing the same site is free for 24h.
      </span>

      {onStartScreenShare ? (
        <div id={`${idPrefix}-share-section`} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
          <span style={ui.label}>SHARE TAB — LIVE SITE WITH EFFECTS</span>
          <div id={`${idPrefix}-share-row`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              id={`${idPrefix}-share-start-btn`}
              style={{ ...ui.btn(Boolean(screenShare)), height: 28, padding: '0 12px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}
              disabled={disabled || busy || screenShareBusy}
              onClick={onStartScreenShare}
            >
              <MonitorPlay size={12} strokeWidth={2.5} />
              {screenShare ? 'Share a different tab' : (screenShareBusy ? 'Waiting for the picker…' : 'Share a tab')}
            </button>
            {screenShare && onStopScreenShare ? (
              <button
                id={`${idPrefix}-share-stop-btn`}
                style={{ ...ui.btn(), height: 28, padding: '0 12px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 5 }}
                disabled={disabled}
                onClick={onStopScreenShare}
              >
                <Square size={12} strokeWidth={2.5} /> Stop sharing
              </button>
            ) : null}
          </div>
          {screenShare ? (
            <span id={`${idPrefix}-share-live-readout`} style={{ ...ui.label, color: GLASS.ink, textTransform: 'none', fontSize: 11 }}>
              Live · {screenShare.sourceWidth}×{screenShare.sourceHeight}{screenShare.surface && screenShare.surface !== 'browser' ? ` · ${screenShare.surface}` : ''} — centre-cropped to fill the screen.
            </span>
          ) : null}
          {screenShareStatus ? (
            <span id={`${idPrefix}-share-status`} style={{ ...ui.label, color: GLASS.inkMute, textTransform: 'none', fontSize: 11, lineHeight: 1.5 }}>
              {screenShareStatus}
            </span>
          ) : null}
          <span id={`${idPrefix}-share-note`} style={{ fontFamily: GLASS.sans, fontSize: 11, lineHeight: 1.5, color: GLASS.inkMute }}>
            Share the tab your site is open in and it becomes a real texture on the screen — so the Diffusion Camera, bloom, treatment and grain all apply to it, live in the preview, and a normal Export Video records it. This Studio tab is deliberately left out of the picker (no feedback loop). Scroll in your own tab and it shows here; AUTO SCROLL / SCROLL POSITION don’t apply. Turning Go Live on, or picking a Capture/uploaded image, stops the share. Final Render runs on a server that can’t see your shared tab — use Go Live or Capture for that one. <strong style={{ color: GLASS.ink, fontWeight: 600 }}>This lasts for the session only — a shared tab can’t be saved, so you’ll re-share it after a reload.</strong>
          </span>
        </div>
      ) : null}
    </div>
  );
}
