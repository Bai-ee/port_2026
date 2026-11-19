import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import {
  appendUnlistedToIndex,
  buildIndexMarkdown,
  buildManifest,
  slugify,
  todayIso,
} from '../../../../../features/knowledge-base/brain-layout.js';
import { attachSourceIds, listKnowledgeItems, readItemBytes } from '../../../../../features/knowledge-base/store.js';
import { buildZip } from '../../../../../features/knowledge-base/zip.js';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

export const runtime = 'nodejs';
export const maxDuration = 120;

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return context;
}

// Brain export for the Source Library.
//   ?format=zip       whole brain as <project>-brain-<date>.zip (default)
//   ?format=manifest  generated manifest.json
//   ?format=index     INDEX.md (uploaded index plus files it does not list yet)
// Files are written byte-for-byte; manifest.json is regenerated from the
// exported bytes so its hashes always match the zip.

const MAX_EXPORT_BYTES = 4 * 1024 * 1024; // Vercel response body limit is ~4.5 MB.

function projectName(items, texts) {
  const manifest = items.find((item) => item.brainRole === 'manifest');
  if (manifest && texts.has(manifest.id)) {
    try {
      const parsed = JSON.parse(texts.get(manifest.id));
      if (parsed?.project) return String(parsed.project);
    } catch {
      // fall through
    }
  }
  const master = items.find((item) => item.brainRole === 'master');
  if (master && texts.has(master.id)) {
    const heading = texts.get(master.id).match(/^#\s+(.+?)(\s+[—-]\s+.*)?$/m);
    if (heading) return heading[1].trim();
  }
  return null;
}

export async function GET(request) {
  let context;
  try {
    context = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  const format = new URL(request.url).searchParams.get('format') || 'zip';
  const today = todayIso();

  try {
    const items = await attachSourceIds({
      clientId: context.clientId,
      items: (await listKnowledgeItems(context.clientId)).filter((item) => item.status !== 'error'),
    });

    const bytes = new Map();
    let total = 0;
    for (const item of items) {
      const buffer = await readItemBytes({ clientId: context.clientId, item });
      total += buffer.length;
      if (total > MAX_EXPORT_BYTES) {
        return json({ error: 'This brain is larger than 4 MB, which is too big for a single download.' }, 413);
      }
      bytes.set(item.id, buffer);
    }
    const texts = new Map(
      items
        .filter((item) => item.brainRole === 'manifest' || item.brainRole === 'master' || item.brainRole === 'index')
        .map((item) => [item.id, bytes.get(item.id).toString('utf8')])
    );
    const project = projectName(items, texts);

    const withHashes = items.map((item) => ({
      ...item,
      sizeBytes: bytes.get(item.id).length,
      sha256: createHash('sha256').update(bytes.get(item.id)).digest('hex'),
    }));
    const uploadedIndex = items.find((item) => item.brainRole === 'index');
    const indexMarkdown = uploadedIndex
      ? appendUnlistedToIndex(texts.get(uploadedIndex.id), withHashes, { today })
      : buildIndexMarkdown({ project, items: withHashes, today });
    const indexBuffer = Buffer.from(indexMarkdown, 'utf8');

    const manifest = buildManifest({ project, items: withHashes.filter((item) => item.brainRole !== 'index') });
    manifest.files.push({
      path: 'INDEX.md',
      bytes: indexBuffer.length,
      sha256: createHash('sha256').update(indexBuffer).digest('hex'),
    });
    manifest.files.sort((a, b) => a.path.localeCompare(b.path));
    const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    if (format === 'manifest') {
      return new NextResponse(manifestBuffer, {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    if (format === 'index') {
      return new NextResponse(indexBuffer, {
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    const folder = `${slugify(project || context.clientId, 'client')}-brain-${today}`;
    const entries = withHashes
      .filter((item) => item.brainRole !== 'index' && item.brainRole !== 'manifest')
      .map((item) => ({ path: `${folder}/${item.brainPath}`, data: bytes.get(item.id) }));
    entries.push({ path: `${folder}/INDEX.md`, data: indexBuffer });
    entries.push({ path: `${folder}/manifest.json`, data: manifestBuffer });
    entries.sort((a, b) => a.path.localeCompare(b.path));

    return new NextResponse(buildZip(entries), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${folder}.zip"`,
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[knowledge-base/brain] export failed', err);
    return json({ error: err.message || 'Brain export failed.' }, err.status || 500);
  }
}
