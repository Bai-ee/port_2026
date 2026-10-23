// upload-ingest.js — turns a file uploaded into a bucket's EditVideos folder into a ContentPackage.
//
// Pure: no fs, no network, no clock (`now` is injected). The id is derived from clientId + fullPath so
// re-ingesting the same upload is idempotent; the route reports it under `existing` and never overwrites edits.
// Rows mirror rendered-video rows (status 'idea', `ev:` assetRefs, posterRef) so the same publisher/calendar paths apply.

import { createHash } from 'node:crypto';
import { ENGINE_IDS } from './engines.js';

export const MAX_UPLOAD_FILES = 25;
const PLACEHOLDER_STORY = '[add your memory]';

const fail = (message) => Object.assign(new Error(message), { status: 400 });

/** Throws 400 unless `path` is a relative, traversal-free path (optionally inside `folder`). */
export function assertUploadPath(path, folder) {
  const p = typeof path === 'string' ? path : '';
  if (!p || p.startsWith('/') || p.split('/').includes('..')) throw fail(`Invalid upload path: ${p || '(empty)'}`);
  if (folder !== undefined) {
    const f = String(folder ?? '').replace(/\/+$/, '');
    if (!f || f.startsWith('/') || f.split('/').includes('..')) throw fail('Invalid upload folder.');
    if (!p.startsWith(`${f}/`)) throw fail(`Upload ${p} is not inside folder ${f}.`);
  }
  return p;
}

/** Stable id: `upload-` + 16 hex of sha1(clientId + NUL + fullPath). */
export function uploadPackageId(clientId, fullPath) {
  return `upload-${createHash('sha1').update(`${clientId}\u0000${fullPath}`).digest('hex').slice(0, 16)}`;
}

/** "my_clip-final.v2.mp4" -> "my clip final v2" */
export function titleFromFilename(name) {
  const base = String(name ?? '').split('/').pop().replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const t = base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (t || 'Untitled upload').slice(0, 120);
}

/**
 * @param {{ clientId: string, bucket: {id:string}, file: {fullPath:string,name?:string,kind?:string,posterPath?:string}, now?: number }} input
 * @returns {import('./schema.js').ContentPackage}
 */
export function packageFromUpload({ clientId, bucket, file, now = Date.now() }) {
  if (!clientId || typeof clientId !== 'string') throw fail('clientId is required.');
  if (!bucket?.id) throw fail('bucket is required.');
  const fullPath = assertUploadPath(file?.fullPath);
  const isVideo = file?.kind === 'video' || (file?.kind !== 'image' && /\.(mp4|mov|m4v|webm)$/i.test(fullPath));
  const iso = new Date(now).toISOString();
  const posterPath = file?.posterPath ? assertUploadPath(file.posterPath) : null;
  return {
    id: uploadPackageId(clientId, fullPath),
    clientId,
    bucketId: bucket.id,
    ...(ENGINE_IDS.includes(bucket.id) ? { engine: bucket.id } : {}),
    // Video -> C4 (Own Productions, media: video); still -> C3 (media: still). Both pillar 'made-this' (owner's own upload).
    series: isVideo ? 'C4' : 'C3',
    pillar: 'made-this',
    title: titleFromFilename(file?.name || fullPath),
    story: PLACEHOLDER_STORY,
    assetRefs: [`ev:${fullPath}`],
    ...(posterPath ? { posterRef: `ev:${posterPath}` } : {}),
    mediaState: isVideo ? 'video' : 'still',
    format: isVideo ? 'video' : 'still',
    effort: 'ready',
    rights: 'owned',
    rightsSetBy: 'human',
    rightsSetAt: iso,
    approval: { state: 'none' },
    platforms: ['x'],
    cta: null,
    eraYear: null,
    eventDate: null,
    entities: [],
    status: 'idea',
    lastPostedAt: null,
    postCount: 0,
    priority: 'evergreen',
    expiresAt: null,
    campaign: null,
    related: [],
    tags: [],
    source: { kind: 'upload', externalId: fullPath },
  };
}
