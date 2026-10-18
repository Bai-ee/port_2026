// media-signers.js — server side of media-link.js: turn a located ref into a URL, and list render captures.
// ev bucket = EditVideos (v4 signed, 6.9 days; same signer the daily loop and Telegram use);
// hitloop bucket = permanent Firebase token URL (tokenUrlFor; null when the object is missing).

import { createRequire } from 'node:module';
import { tokenUrlFor } from './thumbs.js';

const require = createRequire(import.meta.url);
const EV_LONG_SIGN_MS = 6.9 * 24 * 60 * 60 * 1000; // v4 signed URLs cap at 7 days

function firebase() {
  const fb = require('../../api/_lib/firebase-admin.cjs');
  void fb.adminDb; // initialize the Hitloop app BEFORE the named EditVideos bridge app
  return fb;
}

/** {bucket:'ev'|'hitloop', path} -> url | null. Never throws. */
export async function signMediaRef({ bucket, path } = {}) {
  try {
    const fb = firebase();
    if (bucket === 'ev') {
      const file = require('../../api/_lib/editvideos-bridge.cjs').bridgeBucket().file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [url] = await file.getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + EV_LONG_SIGN_MS });
      return url;
    }
    return await tokenUrlFor(fb.adminStorage.bucket(), path);
  } catch {
    return null;
  }
}

const textOf = (c) => String(c?.label || c?.title || c?.name || c?.fileName || c?.recipeName || c?.siteUrl || '').slice(0, 160);
const kindOf = (c) => (/image/.test(String(c?.contentType || c?.type || '')) ? 'image' : 'video');

/** Studio / Video Remix renders and archived (Arweave) assets of one client, newest first. Pure over the state doc. */
export function capturesOf(state) {
  const out = [];
  const add = (list, type) => {
    for (const c of Array.isArray(list) ? list : []) {
      const url = c?.downloadUrl || c?.url || c?.videoUrl || c?.arweaveUrl || null;
      if (!url && !c?.storagePath) continue;
      out.push({
        id: String(c.jobId || c.id || c.transactionId || c.storagePath || url).slice(0, 160),
        type, kind: kindOf(c), title: textOf(c) && textOf(c) !== type ? `${textOf(c)} (${type})` : type,
        url, storagePath: c.storagePath || null, createdAt: c.createdAt || c.archivedAt || null,
      });
    }
  };
  add(state?.studioCaptures, 'studio-render');
  add(state?.mediaCaptures, 'video-remix');
  add(state?.archivePublishing?.archivedAssets, 'arweave');
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export async function readMediaCapturesFromDb(db, clientId) {
  const snap = await db.collection('dashboard_state').doc(clientId).get();
  return snap.exists ? capturesOf(snap.data()) : [];
}
