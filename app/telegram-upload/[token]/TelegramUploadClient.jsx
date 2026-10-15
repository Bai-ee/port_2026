'use client';

import { useState } from 'react';

const MAX_BYTES = 2 * 1024 * 1024 * 1024;

async function post(body) {
  const res = await fetch('/api/telegram/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed. Please try again.');
  return data;
}

function putWithProgress(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload was interrupted. Please try again.')));
    xhr.onerror = () => reject(new Error('The upload was interrupted. Please try again.'));
    xhr.send(file);
  });
}

export default function TelegramUploadClient({ token }) {
  const [phase, setPhase] = useState('idle'); // idle | uploading | done | error
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) { setPhase('error'); setMessage('That file is over the 2 GB limit.'); return; }
    const contentType = file.type === 'image/heif' ? 'image/heic' : file.type;
    setPhase('uploading'); setPercent(0); setMessage('');
    try {
      const { uploadUrl } = await post({ token, action: 'start', contentType, bytes: file.size, fileName: file.name });
      if (uploadUrl) await putWithProgress(uploadUrl, file, contentType, setPercent);
      await post({ token, action: 'complete', contentType, bytes: file.size, fileName: file.name });
      setPhase('done');
    } catch (err) {
      setPhase('error'); setMessage(err.message || 'Upload failed. Please try again.');
    }
  }

  return (
    <div id="telegram-upload-form" style={{ width: '100%', maxWidth: 420 }}>
      <h1 style={{ fontSize: 22, margin: '0 0 16px' }}>Upload your video</h1>
      {phase === 'done' ? (
        <p id="telegram-upload-success">Saved to your HITLOOP library. You can go back to Telegram.</p>
      ) : (
        <>
          <input id="telegram-upload-file-input" type="file" accept="image/*,video/*" onChange={onPick} disabled={phase === 'uploading'} style={{ width: '100%', fontSize: 16 }} />
          {phase === 'uploading' && (
            <div id="telegram-upload-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} style={{ marginTop: 16 }}>
              <div style={{ height: 8, background: 'color-mix(in srgb, var(--t-text) 8%, transparent)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: 'var(--t-text-strong)' }} />
              </div>
              <p style={{ fontSize: 13, margin: '6px 0 0' }}>{percent}%</p>
            </div>
          )}
          {phase === 'error' && <p id="telegram-upload-error" role="alert" style={{ marginTop: 16 }}>{message}</p>}
        </>
      )}
    </div>
  );
}
