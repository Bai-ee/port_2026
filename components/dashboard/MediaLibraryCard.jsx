'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderPlus, Pencil, RotateCw, Trash2, Upload, X } from 'lucide-react';

// Media Library — a management-only workspace over the shared EditVideos
// source bucket: folder rail + file grid, drag-and-drop move, multi-select,
// rename/delete folders, upload. Reads/writes the media_assets Firestore
// index (api/_lib/media-assets.cjs) via app/api/dashboard/media's
// media-index/move-media/rename-folder/delete-folder/create-folder actions —
// see docs/source-of-truth/VIDEO-REMIX-EDITVIDEOS-BRIDGE.md. The video-remix
// card's build UI is untouched and keeps using the folders/folder-files
// actions directly; this card never renders clip-order or "Use for Remix".

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function sanitizeFolderNamePreview(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// First-frame JPEG poster, captured client-side at upload time (no server
// transcode). objectURL → hidden <video> → seek ~0.1s → canvas → JPEG blob,
// scaled to a max width of 480px. Resolves null (never rejects) on a decode
// error or if nothing happens within 3s — legacy/undecodable codecs (older
// .mov/HEVC) just get the icon fallback tile in MediaThumb, never a black
// square. Deferred: a server-side FFmpeg backfill for existing files
// (docs/plans/VIDEO-REMIX-MEDIA-PERF-PLAN.md Phase 3).
function captureVideoPoster(file) {
  return new Promise((resolve) => {
    if (!file || !String(file.type || '').startsWith('video/') || typeof document === 'undefined') {
      resolve(null);
      return;
    }
    let settled = false;
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    const timer = setTimeout(() => finish(null), 3000);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      URL.revokeObjectURL(objectUrl);
    }
    function finish(result) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    }
    function onError() { finish(null); }
    function onLoadedData() {
      try {
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
        video.currentTime = Math.min(0.1, duration / 2);
      } catch {
        finish(null);
      }
    }
    function onSeeked() {
      try {
        const maxWidth = 480;
        const scale = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob || null), 'image/jpeg', 0.7);
      } catch {
        finish(null);
      }
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.src = objectUrl;
  });
}

function uploadFileToSignedUrl({ file, upload, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method || 'PUT', upload.uploadUrl);
    xhr.setRequestHeader('Content-Type', upload.contentType || file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed before storage accepted the file.'));
    xhr.send(file);
  });
}

// Exported so the video-remix modal can render the same never-a-black-square
// thumbnail. All styles are inline: this component renders outside
// MediaLibraryCard's scoped <style jsx>, so it must not rely on any parent's
// class names. posterUrl → <img>. Video without a poster renders the icon
// tile as the base layer and fades the <video> in only once the browser has
// actually decoded a frame (loadeddata) — undecodable .mov/HEVC never fires
// it (and often never fires error either), so the tile simply stays.
const THUMB_FALLBACK_STYLE = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  background: 'linear-gradient(135deg, rgba(42,36,32,0.05), rgba(42,36,32,0.12))',
  color: 'rgba(42,36,32,0.6)',
};
const THUMB_GLYPHS = { video: '▶', image: '◻', other: '▤' };

function ThumbFallbackTile({ kind, ext, style }) {
  return (
    <div style={{ ...THUMB_FALLBACK_STYLE, ...style }} aria-hidden="true">
      <span style={{ fontSize: 15, lineHeight: 1 }}>{THUMB_GLYPHS[kind] || THUMB_GLYPHS.other}</span>
      <span style={{ fontFamily: 'var(--font-mono, "Space Mono", ui-monospace, monospace)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>{ext}</span>
    </div>
  );
}

// Mount-when-near-viewport gate (same IntersectionObserver pattern as
// DashboardPage's LazyVideoThumb): keeps a folder of poster-less videos from
// firing every metadata fetch at once — off-screen tiles stay on the instant
// fallback tile until scrolled close.
function useInView(ref, rootMargin = '200px') {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return visible;
}

export function MediaThumb({ file, style, eager = false }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const hostRef = useRef(null);
  const inView = useInView(hostRef);
  const kind = file?.kind || 'other';
  const ext = String(file?.name || '').split('.').pop()?.toUpperCase().slice(0, 4) || '?';

  if (file?.posterUrl) {
    return (
      <img
        src={file.posterUrl}
        alt={file.name || ''}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }}
      />
    );
  }
  if (kind === 'image' && file?.url) {
    return (
      <img
        src={file.url}
        alt={file.name || ''}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : undefined}
        decoding="async"
        style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }}
      />
    );
  }
  if (kind === 'video' && file?.url && !videoFailed) {
    const src = /#t=/.test(file.url) ? file.url : `${file.url}#t=0.1`;
    return (
      <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
        <ThumbFallbackTile kind={kind} ext={ext} style={{ position: 'absolute', inset: 0 }} />
        {inView ? (
          <video
            src={src}
            preload="metadata"
            muted
            playsInline
            onLoadedData={() => setFrameReady(true)}
            onError={() => setVideoFailed(true)}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: frameReady ? 1 : 0,
              transition: 'opacity 160ms ease',
            }}
          />
        ) : null}
      </div>
    );
  }
  return <ThumbFallbackTile kind={kind} ext={ext} style={style} />;
}

export default function MediaLibraryCard({ getIdToken, isAdmin }) {
  const [folders, setFolders] = useState([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [selection, setSelection] = useState(new Set());
  const [lastClickedIndex, setLastClickedIndex] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTargetOpen, setMoveTargetOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState([]);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadInputRef = useRef(null);

  const apiFetch = useCallback(async (action, { method = 'GET', body, query = {} } = {}) => {
    const token = await getIdToken();
    const qs = new URLSearchParams({ action, ...query }).toString();
    const res = await fetch(`/api/dashboard/media?${qs}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }, [getIdToken]);

  const loadFolders = useCallback(async () => {
    setFoldersLoading(true);
    try {
      const data = await apiFetch('media-index');
      const list = Array.isArray(data.folders) ? data.folders : [];
      setFolders(list);
      return list;
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not load folders.' });
      return [];
    } finally {
      setFoldersLoading(false);
    }
  }, [apiFetch]);

  const loadFiles = useCallback(async (folder) => {
    if (!folder) { setFiles([]); return; }
    setFilesLoading(true);
    try {
      const data = await apiFetch('media-index', { query: { folder } });
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not load files.' });
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadFolders();
      if (!cancelled && list.length) setSelectedFolder((prev) => prev || list[0].name);
    })();
    return () => { cancelled = true; };
  }, [loadFolders]);

  useEffect(() => {
    setSelection(new Set());
    setPreviewFile(null);
    setLastClickedIndex(null);
    if (selectedFolder) loadFiles(selectedFolder);
    else setFiles([]);
  }, [selectedFolder, loadFiles]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  function toggleSelect(fullPath, index, range) {
    setSelection((prev) => {
      const next = new Set(prev);
      if (range && lastClickedIndex != null) {
        const [start, end] = [lastClickedIndex, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i += 1) next.add(files[i].fullPath);
        return next;
      }
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
    if (!range) setLastClickedIndex(index);
  }

  function handleTileClick(file, index, e) {
    if (!isAdmin) { setPreviewFile(file); return; }
    toggleSelect(file.fullPath, index, e.shiftKey);
  }

  function handleDragStart(e, file) {
    const dragPaths = selection.has(file.fullPath) && selection.size > 0 ? Array.from(selection) : [file.fullPath];
    if (!selection.has(file.fullPath)) setSelection(new Set([file.fullPath]));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', JSON.stringify(dragPaths));
    const badge = document.createElement('div');
    badge.textContent = `${dragPaths.length} file${dragPaths.length > 1 ? 's' : ''}`;
    Object.assign(badge.style, {
      position: 'absolute', top: '-1000px', padding: '6px 14px', borderRadius: '999px',
      background: '#2a2420', color: '#fff', fontSize: '12px', fontWeight: '700', fontFamily: 'inherit',
    });
    document.body.appendChild(badge);
    e.dataTransfer.setDragImage(badge, 20, 16);
    setTimeout(() => { if (badge.parentNode) badge.parentNode.removeChild(badge); }, 0);
  }

  async function moveFilesTo(targetFolder, fullPaths) {
    if (!isAdmin || busy || !fullPaths.length || targetFolder === selectedFolder) return;
    setBusy('move');
    try {
      const data = await apiFetch('move-media', {
        method: 'POST',
        body: { files: fullPaths.map((fullPath) => ({ fullPath })), targetFolder },
      });
      setFolders(Array.isArray(data.folders) ? data.folders : folders);
      setSelection(new Set());
      setMoveTargetOpen(false);
      const failedCount = data.failed?.length || 0;
      setNotice({
        kind: failedCount ? 'error' : 'ok',
        text: `Moved ${data.moved?.length || 0} file(s) to ${targetFolder}.${failedCount ? ` ${failedCount} failed.` : ''}`,
      });
      await loadFiles(selectedFolder);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Move failed.' });
    } finally {
      setBusy('');
    }
  }

  function handleFolderDrop(e, folderName) {
    e.preventDefault();
    setDragOverFolder('');
    let fullPaths = [];
    try { fullPaths = JSON.parse(e.dataTransfer.getData('application/json') || '[]'); } catch { fullPaths = []; }
    if (fullPaths.length) moveFilesTo(folderName, fullPaths);
  }

  async function deleteSelected() {
    if (!isAdmin || busy || !selection.size) return;
    const count = selection.size;
    if (typeof window !== 'undefined' && !window.confirm(`Delete ${count} file(s)? This cannot be undone.`)) return;
    setBusy('delete');
    try {
      const data = await apiFetch('delete-source-media', {
        method: 'POST',
        body: { files: Array.from(selection).map((fullPath) => ({ fullPath })) },
      });
      setSelection(new Set());
      setNotice({ kind: 'ok', text: `Deleted ${data.deleted?.length || 0} file(s).${data.errors?.length ? ` ${data.errors.length} failed.` : ''}` });
      await Promise.all([loadFiles(selectedFolder), loadFolders()]);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Delete failed.' });
    } finally {
      setBusy('');
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!isAdmin || busy || !name) return;
    setBusy('create-folder');
    try {
      const data = await apiFetch('create-folder', { method: 'POST', body: { name } });
      setFolders(Array.isArray(data.folders) ? data.folders : folders);
      setNewFolderOpen(false);
      setNewFolderName('');
      setSelectedFolder(data.folder || name);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not create folder.' });
    } finally {
      setBusy('');
    }
  }

  async function renameFolder(folder) {
    const newName = renameValue.trim();
    if (!isAdmin || busy || !newName) return;
    setBusy('rename');
    try {
      const data = await apiFetch('rename-folder', { method: 'POST', body: { folder, newName } });
      setFolders(Array.isArray(data.folders) ? data.folders : folders);
      setRenamingFolder(null);
      setRenameValue('');
      if (selectedFolder === folder) setSelectedFolder(data.newFolder || newName);
      setNotice({ kind: 'ok', text: `Renamed to ${data.newFolder}.${data.failed?.length ? ` ${data.failed.length} file(s) failed to move.` : ''}` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Rename failed.' });
    } finally {
      setBusy('');
    }
  }

  async function deleteFolder(folder) {
    if (!isAdmin || busy) return;
    const info = folders.find((f) => f.name === folder);
    const count = info?.count || 0;
    const label = count ? `"${folder}" and its ${count} file(s)` : `"${folder}"`;
    if (typeof window !== 'undefined' && !window.confirm(`Delete folder ${label}? This cannot be undone.`)) return;
    setBusy('delete-folder');
    try {
      const data = await apiFetch('delete-folder', { method: 'POST', body: { folder } });
      const nextFolders = Array.isArray(data.folders) ? data.folders : [];
      setFolders(nextFolders);
      if (selectedFolder === folder) setSelectedFolder(nextFolders[0]?.name || '');
      setNotice({ kind: 'ok', text: `Deleted folder "${folder}".${data.failed?.length ? ` ${data.failed.length} file(s) failed.` : ''}` });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Delete folder failed.' });
    } finally {
      setBusy('');
    }
  }

  function addUploadFiles(fileList) {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    setUploadError('');
    setUploadQueue((prev) => [
      ...prev,
      ...list.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'queued',
        progress: 0,
      })),
    ]);
  }

  const runUpload = useCallback(async () => {
    if (uploadLoading || !selectedFolder) return;
    const pending = uploadQueue.filter((item) => item.status === 'queued');
    if (!pending.length) return;
    setUploadLoading(true);
    setUploadError('');
    try {
      const data = await apiFetch('create-upload-session', {
        method: 'POST',
        body: {
          folderMode: 'existing',
          folderName: selectedFolder,
          orientation: 'auto',
          files: pending.map((item) => ({
            name: item.name, type: item.type, size: item.size,
            withPoster: String(item.type || '').startsWith('video/'),
          })),
        },
      });
      const uploads = Array.isArray(data?.session?.uploads) ? data.session.uploads : [];
      if (uploads.length !== pending.length) throw new Error('Upload session did not return a URL for every file.');

      const completedRows = [];
      for (let i = 0; i < uploads.length; i += 1) {
        const item = pending[i];
        const upload = uploads[i];
        setUploadQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading' } : q)));

        // Capture the poster before the XHR reads the File, then upload the
        // source bytes, then (best-effort) the poster JPEG. A failed poster
        // capture/upload never fails the file upload itself.
        const posterBlob = upload.posterUpload ? await captureVideoPoster(item.file).catch(() => null) : null;

        await uploadFileToSignedUrl({
          file: item.file,
          upload,
          onProgress: (progress) => setUploadQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, progress } : q))),
        });

        let posterPath = null;
        if (posterBlob && upload.posterUpload) {
          try {
            await uploadFileToSignedUrl({ file: posterBlob, upload: upload.posterUpload, onProgress: () => {} });
            posterPath = upload.posterUpload.storagePath;
          } catch {
            posterPath = null;
          }
        }

        setUploadQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'done', progress: 100 } : q)));
        completedRows.push({
          fullPath: upload.storagePath, name: upload.safeName, size: upload.size, contentType: upload.contentType, kind: upload.kind, posterPath,
        });
      }

      await apiFetch('complete-upload', { method: 'POST', body: { folder: data.session.folder, files: completedRows } });
      await Promise.all([loadFiles(selectedFolder), loadFolders()]);
    } catch (err) {
      setUploadError(err.message || 'Upload failed.');
      setUploadQueue((prev) => prev.map((q) => (q.status === 'uploading' ? { ...q, status: 'error', error: err.message } : q)));
    } finally {
      setUploadLoading(false);
    }
  }, [uploadQueue, uploadLoading, selectedFolder, apiFetch, loadFiles, loadFolders]);

  const otherFolders = folders.filter((f) => f.name !== selectedFolder);

  return (
    <div id="media-library-workspace">
      <div id="media-library-folder-rail">
        {isAdmin ? (
          <div id="media-library-new-folder-row">
            {newFolderOpen ? (
              <div className="ml-inline-edit-stack">
                <div className="ml-inline-edit">
                  <input
                    value={newFolderName}
                    autoFocus
                    placeholder="folder-name"
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createFolder();
                      if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName(''); }
                    }}
                  />
                  <button type="button" onClick={createFolder} disabled={!!busy || !newFolderName.trim()}><Check size={13} /></button>
                  <button type="button" onClick={() => { setNewFolderOpen(false); setNewFolderName(''); }}><X size={13} /></button>
                </div>
                {newFolderName.trim() ? <span className="ml-folder-preview-hint">Saves as: {sanitizeFolderNamePreview(newFolderName) || '—'}</span> : null}
              </div>
            ) : (
              <button type="button" className="ml-new-folder-btn" onClick={() => setNewFolderOpen(true)}>
                <FolderPlus size={14} /> New folder
              </button>
            )}
          </div>
        ) : null}

        {foldersLoading && !folders.length ? (
          <>
            <div className="ml-skeleton-row" />
            <div className="ml-skeleton-row" />
            <div className="ml-skeleton-row" />
            <div className="ml-skeleton-row" />
          </>
        ) : folders.length ? (
          folders.map((folder) => {
            const isActive = folder.name === selectedFolder;
            const isDragOver = dragOverFolder === folder.name;
            const isRenaming = renamingFolder === folder.name;
            return (
              <div
                key={folder.name}
                className={`ml-folder-row${isActive ? ' is-active' : ''}${isDragOver ? ' is-drag-over' : ''}`}
                onClick={() => !isRenaming && setSelectedFolder(folder.name)}
                onDragOver={isAdmin ? (e) => { e.preventDefault(); setDragOverFolder(folder.name); } : undefined}
                onDragLeave={isAdmin ? () => setDragOverFolder((prev) => (prev === folder.name ? '' : prev)) : undefined}
                onDrop={isAdmin ? (e) => handleFolderDrop(e, folder.name) : undefined}
              >
                {isRenaming ? (
                  <div className="ml-inline-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameFolder(folder.name);
                        if (e.key === 'Escape') setRenamingFolder(null);
                      }}
                    />
                    <button type="button" onClick={() => renameFolder(folder.name)} disabled={!!busy}><Check size={13} /></button>
                    <button type="button" onClick={() => setRenamingFolder(null)}><X size={13} /></button>
                  </div>
                ) : (
                  <>
                    <span className="ml-folder-name">{folder.name}</span>
                    <span className="ml-folder-count">{folder.count}</span>
                    {isAdmin ? (
                      <span className="ml-folder-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" title="Rename folder" onClick={() => { setRenamingFolder(folder.name); setRenameValue(folder.name); }}>
                          <Pencil size={12} />
                        </button>
                        <button type="button" title="Delete folder" onClick={() => deleteFolder(folder.name)}>
                          <Trash2 size={12} />
                        </button>
                      </span>
                    ) : null}
                  </>
                )}
              </div>
            );
          })
        ) : (
          <div className="ml-empty"><strong>No folders yet.</strong> Create one to organize source media.</div>
        )}
      </div>

      <div id="media-library-file-grid">
        <div id="media-library-content-header">
          <span className="ml-content-label">
            {selectedFolder ? `Folder · ${selectedFolder} · ${files.length} file${files.length === 1 ? '' : 's'}` : 'No folder selected'}
          </span>
          <button
            type="button"
            className="ml-refresh-btn"
            title="Refresh folders and files"
            disabled={foldersLoading || filesLoading}
            onClick={() => { loadFolders(); if (selectedFolder) loadFiles(selectedFolder); }}
          >
            <RotateCw size={13} />
          </button>
        </div>

        {isAdmin ? (
          <div
            id="media-library-upload-zone"
            onClick={() => uploadInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addUploadFiles(e.dataTransfer.files); }}
          >
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              hidden
              accept="video/*,image/*,.mov,.mp4,.m4v,.avi,.mkv,.webm,.png,.jpg,.jpeg,.gif,.svg,.webp"
              onChange={(e) => { addUploadFiles(e.target.files); e.target.value = ''; }}
            />
            <Upload size={16} />
            <span>{selectedFolder ? `Drop files to upload into ${selectedFolder}` : 'Create or select a folder first'}</span>
          </div>
        ) : null}

        {uploadQueue.length ? (
          <div className="ml-upload-queue">
            {uploadQueue.map((item) => (
              <div key={item.id} className={`ml-upload-row ml-upload-${item.status}`}>
                <span className="ml-upload-name">{item.name}</span>
                <span className="ml-upload-bar"><span style={{ width: `${Math.max(0, Math.min(100, item.progress || 0))}%` }} /></span>
                <span className="ml-upload-status">{item.status}</span>
              </div>
            ))}
            <div className="ml-upload-actions">
              {uploadQueue.some((i) => i.status === 'done' || i.status === 'error') ? (
                <button type="button" onClick={() => setUploadQueue((prev) => prev.filter((i) => i.status === 'queued' || i.status === 'uploading'))}>
                  Clear finished
                </button>
              ) : null}
              {uploadQueue.some((i) => i.status === 'queued') ? (
                <button type="button" className="ml-upload-run" disabled={uploadLoading || !selectedFolder} onClick={runUpload}>
                  {uploadLoading ? 'Uploading…' : 'Upload'}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {uploadError ? <p className="ml-error">{uploadError}</p> : null}

        <div className="ml-tiles">
          {filesLoading ? (
            Array.from({ length: 8 }, (_, i) => <div key={`skeleton-${i}`} className="ml-skeleton-tile" />)
          ) : files.length ? (
            files.map((file, index) => {
              const selected = selection.has(file.fullPath);
              return (
                <div
                  key={file.fullPath}
                  className={`ml-tile${selected ? ' is-selected' : ''}`}
                  draggable={isAdmin}
                  onDragStart={isAdmin ? (e) => handleDragStart(e, file) : undefined}
                  onClick={(e) => handleTileClick(file, index, e)}
                  onDoubleClick={() => setPreviewFile(file)}
                >
                  <div className="ml-tile-thumb">
                    <MediaThumb file={file} eager={index < 6} />
                    {isAdmin && selected ? <span className="ml-tile-check"><Check size={12} /></span> : null}
                  </div>
                  <span className="ml-tile-name">{file.name}</span>
                  <span className="ml-tile-meta">{formatBytes(file.size)}</span>
                </div>
              );
            })
          ) : (
            <div className="ml-empty">
              {selectedFolder
                ? <><strong>Empty folder.</strong> Drop files above to upload into {selectedFolder}.</>
                : <><strong>No folder selected.</strong> Select or create a folder to get started.</>}
            </div>
          )}
        </div>
      </div>

      {isAdmin && selection.size > 0 ? (
        <div id="media-library-selection-bar">
          <span className="ml-selection-count">{selection.size} selected</span>
          <div className="ml-move-to">
            <button type="button" onClick={() => setMoveTargetOpen((v) => !v)} disabled={!!busy}>
              Move to <ChevronDown size={12} />
            </button>
            {moveTargetOpen ? (
              <div className="ml-move-menu">
                {otherFolders.length ? otherFolders.map((f) => (
                  <button key={f.name} type="button" onClick={() => moveFilesTo(f.name, Array.from(selection))}>
                    {f.name}
                  </button>
                )) : <div className="ml-empty">No other folders yet.</div>}
              </div>
            ) : null}
          </div>
          <button type="button" className="ml-selection-delete" onClick={deleteSelected} disabled={!!busy}>
            Delete ({selection.size})
          </button>
          <button type="button" onClick={() => setSelection(new Set())}>Clear</button>
        </div>
      ) : null}

      {notice ? <p className={`ml-notice ml-notice-${notice.kind}`}>{notice.text}</p> : null}

      {previewFile ? (
        <div className="ml-preview-backdrop" onClick={() => setPreviewFile(null)}>
          <div className="ml-preview-panel" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="ml-preview-close" onClick={() => setPreviewFile(null)}><X size={16} /></button>
            {previewFile.kind === 'video' && previewFile.url ? (
              <video src={previewFile.url} controls autoPlay playsInline />
            ) : previewFile.kind === 'image' && previewFile.url ? (
              <img src={previewFile.url} alt={previewFile.name || ''} />
            ) : (
              <ThumbFallbackTile
                kind={previewFile.kind || 'other'}
                ext={String(previewFile.name || '').split('.').pop()?.toUpperCase().slice(0, 4) || '?'}
                style={{ width: 160, height: 160, borderRadius: 8 }}
              />
            )}
            <div className="ml-preview-meta">{previewFile.name} · {formatBytes(previewFile.size)}</div>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        /* Kit tokens (public/docs/dashboard-modal-component-style-guide.html):
           --line rgba(42,36,32,.12), radii 8/16, Space Mono labels, glass
           surfaces, spring lift cubic-bezier(0.34,1.56,0.64,1) 140-220ms. */
        #media-library-workspace { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 16px; align-items: start; }

        /* minmax(0,1fr) + min-width:0 on rows: without them a long unbreakable
           folder name (assets/chicago-skyline-videos) sets the rows' min-content
           wider than the 232px track and they paint into the file grid. */
        #media-library-folder-rail { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; align-content: start; position: sticky; top: 0; }
        #media-library-new-folder-row { min-width: 0; }
        .ml-new-folder-btn { display: inline-flex; align-items: center; gap: 6px; width: 100%; min-height: 38px; padding: 0 12px; border: 1px dashed rgba(42,36,32,0.24); border-radius: 8px; background: rgba(255,255,255,0.42); color: rgba(42,36,32,0.72); font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; transition: background 160ms ease, border-color 160ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ml-new-folder-btn:hover { border-color: rgba(42,36,32,0.4); background: rgba(255,255,255,0.82); transform: translateY(-1px); }
        .ml-new-folder-btn:active { transform: translateY(0); transition-duration: 80ms; }
        .ml-inline-edit-stack { display: grid; gap: 4px; }
        .ml-folder-preview-hint { font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 10px; color: rgba(42,36,32,0.52); padding-left: 2px; }
        .ml-inline-edit { display: flex; gap: 4px; align-items: center; }
        .ml-inline-edit input { flex: 1; min-width: 0; min-height: 32px; border: 1px solid rgba(42,36,32,0.2); border-radius: 8px; padding: 0 8px; font: inherit; font-size: 12px; background: rgba(255,255,255,0.9); }
        .ml-inline-edit button { min-height: 32px; min-width: 32px; padding: 0; border: 1px solid rgba(42,36,32,0.14); border-radius: 8px; background: rgba(255,255,255,0.7); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background 140ms ease; }
        .ml-inline-edit button:hover:not(:disabled) { background: rgba(255,255,255,1); }

        .ml-folder-row { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; min-height: 38px; padding: 0 10px; border: 1px solid rgba(42,36,32,0.12); border-radius: 8px; background: rgba(255,255,255,0.55); cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.35); transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ml-folder-row:hover { background: rgba(255,255,255,0.92); border-color: rgba(42,36,32,0.18); transform: translateY(-1px); box-shadow: 0 4px 14px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); }
        .ml-folder-row.is-active { border-color: rgba(42,36,32,0.4); background: rgba(255,255,255,0.98); }
        .ml-folder-row.is-active::before { content: ''; position: absolute; left: -1px; top: 7px; bottom: 7px; width: 3px; border-radius: 999px; background: linear-gradient(180deg, hsl(185,100%,45%), hsl(262,100%,55%), hsl(314,100%,50%)); }
        .ml-folder-row.is-drag-over { border-color: hsl(262,100%,55%); background: rgba(139,92,246,0.08); box-shadow: 0 0 0 2px rgba(139,92,246,0.18); }
        .ml-folder-name { flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: #2a2420; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ml-folder-count { font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 10px; color: rgba(42,36,32,0.52); padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(42,36,32,0.1); background: rgba(255,255,255,0.5); }
        .ml-folder-actions { display: inline-flex; gap: 4px; opacity: 0; transition: opacity 140ms ease; }
        .ml-folder-row:hover .ml-folder-actions, .ml-folder-row:focus-within .ml-folder-actions { opacity: 1; }
        .ml-folder-actions button { min-height: 24px; min-width: 24px; padding: 0; border: none; background: transparent; color: rgba(42,36,32,0.52); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; transition: background 140ms ease, color 140ms ease; }
        .ml-folder-actions button:hover { background: rgba(42,36,32,0.08); color: #2a2420; }
        @media (hover: none) { .ml-folder-actions { opacity: 1; } }

        #media-library-file-grid { display: grid; gap: 12px; align-content: start; min-width: 0; }
        #media-library-content-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 28px; }
        .ml-content-label { min-width: 0; font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.52); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ml-refresh-btn { min-height: 28px; min-width: 28px; padding: 0; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.52); color: rgba(42,36,32,0.62); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background 160ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ml-refresh-btn:hover:not(:disabled) { background: rgba(255,255,255,0.92); transform: translateY(-1px); }
        .ml-refresh-btn:disabled { opacity: 0.45; cursor: default; }

        #media-library-upload-zone { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 56px; border: 1px dashed rgba(42,36,32,0.24); border-radius: 8px; background: rgba(255,255,255,0.42); color: rgba(42,36,32,0.6); font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 11px; letter-spacing: 0.04em; cursor: pointer; text-align: center; padding: 10px; transition: background 160ms ease, border-color 160ms ease; }
        #media-library-upload-zone:hover { border-color: hsl(262,100%,55%); background: rgba(255,255,255,0.72); }
        .ml-upload-queue { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid rgba(42,36,32,0.12); border-radius: 8px; background: rgba(255,255,255,0.55); }
        .ml-upload-row { display: grid; grid-template-columns: minmax(0,1fr) 80px auto; align-items: center; gap: 8px; font-size: 11px; }
        .ml-upload-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ml-upload-bar { height: 5px; border-radius: 3px; background: rgba(42,36,32,0.1); overflow: hidden; }
        .ml-upload-bar span { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, hsl(185,100%,45%), hsl(262,100%,55%)); transition: width 160ms ease; }
        .ml-upload-status { text-transform: uppercase; color: rgba(42,36,32,0.5); font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 10px; }
        .ml-upload-error .ml-upload-status { color: #9f1f17; }
        .ml-upload-actions { display: flex; gap: 8px; justify-content: flex-end; }
        .ml-upload-actions button { min-height: 30px; padding: 0 12px; font-size: 11px; font-weight: 700; border: 1px solid rgba(42,36,32,0.14); border-radius: 999px; background: rgba(255,255,255,0.7); cursor: pointer; transition: background 160ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ml-upload-actions button:hover:not(:disabled) { background: rgba(255,255,255,1); transform: translateY(-1px); }
        .ml-upload-run { background: #2a2420 !important; color: #fff !important; border-color: #2a2420 !important; }

        .ml-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(108px, 1fr)); gap: 10px; }
        .ml-tile { display: grid; gap: 4px; padding: 6px; border: 1px solid rgba(42,36,32,0.12); border-radius: 12px; background: rgba(255,255,255,0.55); cursor: pointer; user-select: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.35); transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ml-tile:hover { border-color: rgba(42,36,32,0.2); background: rgba(255,255,255,0.92); transform: translateY(-1px); box-shadow: 0 6px 18px rgba(42,36,32,0.1), inset 0 1px 0 rgba(255,255,255,0.5); }
        .ml-tile:active { transform: translateY(0); transition-duration: 80ms; }
        .ml-tile.is-selected { border-color: #2a2420; background: rgba(255,255,255,0.98); box-shadow: 0 0 0 2px rgba(42,36,32,0.2); }
        .ml-tile-thumb { position: relative; aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; background: rgba(42,36,32,0.05); }
        .ml-tile-check { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 999px; background: #2a2420; color: #fff; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }
        .ml-tile-name { font-size: 11px; font-weight: 600; color: #2a2420; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ml-tile-meta { font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 10px; font-variant-numeric: tabular-nums; color: rgba(42,36,32,0.5); }

        @keyframes ml-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        .ml-skeleton-tile { aspect-ratio: 1 / 1.28; border-radius: 12px; background: rgba(42,36,32,0.06); animation: ml-pulse 1.2s ease-in-out infinite; }
        .ml-skeleton-row { min-height: 38px; border-radius: 8px; background: rgba(42,36,32,0.06); animation: ml-pulse 1.2s ease-in-out infinite; }

        #media-library-selection-bar { grid-column: 2 / 3; position: sticky; bottom: 0; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid rgba(42,36,32,0.14); border-radius: 12px; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); box-shadow: 0 -4px 20px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); z-index: 2; }
        .ml-selection-count { font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #2a2420; }
        .ml-move-to { position: relative; }
        .ml-move-to > button { display: inline-flex; align-items: center; gap: 4px; min-height: 32px; padding: 0 12px; border: 1px solid rgba(42,36,32,0.16); border-radius: 999px; background: rgba(255,255,255,0.7); font-size: 12px; font-weight: 700; cursor: pointer; transition: background 160ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1); }
        .ml-move-to > button:hover:not(:disabled) { background: rgba(255,255,255,1); transform: translateY(-1px); }
        .ml-move-menu { position: absolute; bottom: calc(100% + 6px); left: 0; min-width: 160px; max-height: 200px; overflow: auto; border: 1px solid rgba(42,36,32,0.14); border-radius: 8px; background: #fff; box-shadow: 0 8px 24px rgba(42,36,32,0.16); padding: 4px; display: grid; gap: 2px; }
        .ml-move-menu button { text-align: left; min-height: 30px; padding: 0 10px; border: none; border-radius: 6px; background: transparent; font-size: 12px; cursor: pointer; transition: background 140ms ease; }
        .ml-move-menu button:hover { background: rgba(42,36,32,0.06); }
        .ml-selection-delete { min-height: 32px; padding: 0 12px; border: 1px solid rgba(159,31,23,0.3); border-radius: 999px; background: rgba(159,31,23,0.08); color: #9f1f17; font-size: 12px; font-weight: 700; cursor: pointer; transition: background 160ms ease; }
        .ml-selection-delete:hover:not(:disabled) { background: rgba(159,31,23,0.14); }
        #media-library-selection-bar > button:last-child { margin-left: auto; min-height: 32px; padding: 0 12px; border: none; background: transparent; font-size: 12px; color: rgba(42,36,32,0.5); cursor: pointer; }
        #media-library-selection-bar > button:last-child:hover { color: #2a2420; }

        .ml-empty { grid-column: 1 / -1; padding: 20px 16px; text-align: center; font-size: 12.5px; line-height: 1.5; color: rgba(42,36,32,0.55); border: 1px dashed rgba(42,36,32,0.16); border-radius: 8px; background: rgba(255,255,255,0.3); }
        .ml-empty strong { color: #2a2420; margin-right: 4px; }
        .ml-notice { grid-column: 2 / 3; margin: 0; font-size: 12px; }
        .ml-notice-ok { color: #285f3b; }
        .ml-notice-error, .ml-error { color: #9f1f17; margin: 0; font-size: 12px; }

        .ml-preview-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 24px; }
        .ml-preview-panel { position: relative; max-width: min(720px, 100%); max-height: 90vh; background: #15151c; border: 1px solid rgba(255,255,255,0.14); border-radius: 16px; padding: 12px; display: grid; gap: 8px; justify-items: center; box-shadow: 0 18px 48px rgba(20,20,30,0.4); }
        .ml-preview-panel video, .ml-preview-panel img { max-width: 100%; max-height: 70vh; border-radius: 8px; }
        .ml-preview-close { position: absolute; top: -14px; right: -14px; width: 30px; height: 30px; border-radius: 999px; background: #fff; border: none; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
        .ml-preview-meta { color: rgba(255,255,255,0.7); font-family: var(--font-mono, "Space Mono", ui-monospace, monospace); font-size: 11px; }

        #media-library-workspace button:focus-visible, #media-library-workspace input:focus-visible { outline: 2px solid hsl(262,100%,55%); outline-offset: 2px; }

        @media (max-width: 480px) {
          #media-library-workspace { grid-template-columns: minmax(0, 1fr); }
          /* Folders stack as full-width line items in a capped scrollable list
             (horizontal chips collapsed names to nothing on narrow screens). */
          #media-library-folder-rail { position: static; max-height: 224px; overflow-y: auto; overscroll-behavior: contain; padding: 2px; }
          .ml-folder-actions { opacity: 1; }
          .ml-tiles { grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); }
          .ml-notice { grid-column: 1 / -1; }
          /* Sticky has no inner scroller to stick to on mobile — pin the
             selection bar to the viewport bottom instead. z-index stays below
             the preview backdrop (50). */
          #media-library-selection-bar {
            grid-column: 1 / -1;
            position: fixed;
            left: var(--mobile-gutter, 8px);
            right: var(--mobile-gutter, 8px);
            bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
            z-index: 40;
            box-shadow: 0 10px 32px rgba(42,36,32,0.22);
          }
          /* Keep the last tile row reachable above the pinned bar. */
          #media-library-workspace:has(#media-library-selection-bar) { padding-bottom: 72px; }
        }
      `}</style>
    </div>
  );
}
