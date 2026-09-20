// Public, read-only catalog for the Studio's Video Remix tool
// (/dashboard/studio?tool=remix).
//
// WHY THIS EXISTS: the Studio is a public surface — every other tool (cloth,
// paint, loop, invoice) is fully usable signed out. Remix was the exception
// only because its data came from `/api/dashboard/media`, which is Bearer-gated
// for the whole client workspace. Rather than weaken that route, this one
// serves the narrow slice the editor needs to render a real timeline.
//
// ⚠️ SCOPE — read this before widening it:
//   - EXPOSED: source folder names, look/overlay options, logo filenames,
//     artist names + mix titles, and (per folder) signed read URLs to the
//     source clips. Those signed URLs are time-limited but are real, playable
//     video — anyone with this endpoint can pull the EditVideos source footage.
//   - NOT EXPOSED, and must stay that way: anything client-scoped
//     (dashboard_state, captures, media_jobs), any WRITE, and the render queue.
//     Rendering still goes through the authed create-video-remix action, so a
//     signed-out visitor can browse and preview but cannot spend a render.
//
// Failures are reported EXPLICITLY rather than as empty arrays. The bridge's
// own listArtists/listLogos swallow errors and return [], which made a dead
// credential look identical to an empty bucket — the editor could not tell the
// difference and neither could we. `bridgeOk:false` + `error` is the fix.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const bridge = require('../../../../api/_lib/editvideos-bridge.cjs');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The daily-email default (DEFAULT_DAILY_VIDEO_SOURCE_FOLDERS in
// app/api/worker/pre-digest-video/route.js). Kept in sync by hand — this route
// cannot import that worker module without dragging its Firestore deps in.
const DEFAULT_FOLDER = 'skyline';

// Clip listing is the expensive call (bucket list + a signed URL per file), and
// the bridge already caches folder media internally. Cache at the edge too so a
// shared link can't hammer the bucket.
const CACHE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CACHE_HEADERS });
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const wantFolder = (params.get('folder') || '').trim();
  const withClips = params.get('clips') !== '0';

  let folders = [];
  let options = { filters: [], overlays: [], artists: [], logos: [] };
  let bridgeOk = true;
  let error = null;

  try {
    const raw = await bridge.listSourceFolders();
    folders = (Array.isArray(raw) ? raw : [])
      .map((f) => (typeof f === 'string' ? f : (f?.name || f?.folder || f?.path || '')))
      .filter(Boolean);
  } catch (err) {
    bridgeOk = false;
    error = err?.message || 'listSourceFolders failed';
  }

  try {
    options = await bridge.listOptions();
  } catch (err) {
    bridgeOk = false;
    error = error || err?.message || 'listOptions failed';
  }

  // `listOptions` degrades to empty arrays instead of throwing, so an empty
  // artist AND logo list alongside folders we could not read is the signature
  // of a dead bridge credential, not an empty bucket. Say so.
  if (bridgeOk && !folders.length) {
    bridgeOk = false;
    error = error || 'EditVideos bucket returned no source folders';
  }

  // Resolve the folder to preview: an explicit request, else the daily-email
  // default, else whatever the bucket actually has.
  const folder = folders.includes(wantFolder)
    ? wantFolder
    : (folders.includes(DEFAULT_FOLDER) ? DEFAULT_FOLDER : folders[0] || null);

  let clips = [];
  if (withClips && folder) {
    try {
      const media = await bridge.listFolderMedia(folder, { limit: 120 });
      clips = (Array.isArray(media?.files) ? media.files : [])
        // Only what the editor needs — drop fullPath so the bucket layout
        // isn't handed out alongside the URLs.
        .map((file) => ({
          name: file.name,
          kind: file.kind,
          size: file.size,
          url: file.url,
          posterUrl: file.posterUrl,
        }));
    } catch (err) {
      error = error || err?.message || 'listFolderMedia failed';
    }
  }

  return json({
    ok: true,
    bridgeOk,
    error,
    defaultFolder: folder,
    folders,
    options,
    folder,
    clips,
  });
}
