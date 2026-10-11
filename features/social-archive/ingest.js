// Archive ingest: detect -> parse -> sanitize -> match -> (optionally) write. Dry run writes nothing, ever.
import { sanitizeEntry, ADAPTER_VERSION } from './schema.js';
import { matchEntries } from './match.js';
import { upsertEntries, linkEntriesToPackages, rebuildDays, saveArchive } from './timeline-store.js';

// Adapter files are loaded lazily so one broken/missing adapter never blocks the others.
export const ADAPTERS = {
  facebook: () => import('./adapters/facebook.js'),
  x: () => import('./adapters/x.js'),
  instagram: () => import('./adapters/instagram.js'),
};

/** NAS packages (`nas-<sha16>` docs in x_content_packages) as { id, nas:{ relativePath, sha256 } }. */
export async function loadNasPackages(db, clientId) {
  void clientId; // x_content_packages is a single global collection (not per-client)
  const snap = await db.collection('x_content_packages').where('bucketId', '==', 'nas').get();
  return snap.docs
    .filter((d) => d.id.startsWith('nas-') && d.data()?.nas?.relativePath)
    .map((d) => ({ id: d.id, nas: { relativePath: d.data().nas.relativePath, sha256: d.data().nas.sha256 } }));
}

const nowIso = (now) => new Date(typeof now === 'function' ? now() : (now ?? Date.now())).toISOString();

export async function ingestArchive({
  db, clientId, platform, account, archiveName, reader, archiveRootRel,
  adapter, packages, dryRun = true, now,
}) {
  const mod = adapter || (ADAPTERS[platform] ? await ADAPTERS[platform]() : null);
  if (!mod) throw new Error(`No adapter for platform "${platform}"`);
  if (!mod.detect(reader)) throw new Error(`${mod.ADAPTER || platform}: this folder does not look like a ${platform} export`);

  const parsed = await mod.parse({ reader, account, archiveName });
  const rejected = {};
  const bump = (r) => { rejected[r] = (rejected[r] || 0) + 1; };
  const entries = []; const seen = new Set();
  for (const raw of parsed.entries || []) {
    const { entry, error } = sanitizeEntry(raw, { archiveName, adapterVersion: ADAPTER_VERSION });
    if (error) { bump(error); continue; }
    if (seen.has(entry.id)) { bump('duplicate-id'); continue; }
    seen.add(entry.id); entries.push(entry);
  }

  const pkgs = packages || await loadNasPackages(db, clientId);
  const match = matchEntries(entries, pkgs, { archiveRootRel });

  const byKind = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const tss = entries.map((e) => e.ts).sort();
  const days = [...new Set(entries.map((e) => e.day))].sort();
  const report = {
    platform, account, archiveName, dryRun, entries: entries.length, rejected, byKind,
    firstTs: tss[0] || null, lastTs: tss[tss.length - 1] || null, days: days.length,
    withMedia: entries.filter((e) => e.media.length).length,
    media: { total: match.stats.media, matched: match.stats.matched, unmatched: match.stats.unmatched },
    unmatchedSample: match.unmatched.slice(0, 10),
    warnings: [...(parsed.warnings || [])],
  };
  if (dryRun) return report;

  const stamp = nowIso(now);
  await upsertEntries(db, clientId, entries);
  const entriesById = Object.fromEntries(entries.map((e) => [e.id, e]));
  await linkEntriesToPackages(db, clientId, match.links, entriesById);
  await rebuildDays(db, clientId, days, { now: stamp });
  await saveArchive(db, clientId, {
    platform, account, archiveName, adapter: mod.ADAPTER || platform, adapterVersion: ADAPTER_VERSION,
    ...(parsed.exportedAt ? { exportedAt: parsed.exportedAt } : {}),
    entries: entries.length, firstTs: report.firstTs, lastTs: report.lastTs,
    withMedia: report.withMedia, matched: match.stats.matched, unmatched: match.stats.unmatched,
    ingestedAt: stamp,
  });
  return report;
}
