#!/usr/bin/env node
// Backfill facets onto existing discogs-* packages.
//   node scripts/discogs/backfill-facets.mjs                 DRY RUN, offline (derives from fields already on the package)
//   node scripts/discogs/backfill-facets.mjs --discogs       OWNER ONLY: also GET api.discogs.com/releases/<id> for genres/styles
//   node scripts/discogs/backfill-facets.mjs --write         OWNER ONLY: upsert (needs Firestore creds); default is print-only
// Env: DISCOGS_TOKEN (optional, raises Discogs rate limit). Facets never touch humanEdits.
import { normalizeFacets } from '../../features/x-content-inventory/facets.js';
import { detectGear } from '../../features/discogs-ingest/draft-builder.js';

/** Offline: package fields -> machine facets. Pure. `release` = optional Discogs release JSON. */
export function deriveFacets(pkg, release = null) {
  const [artistPart] = String(pkg.title || '').split(' – ');
  const people = release?.artists?.length ? release.artists.map((a) => String(a.name || '').replace(/\s*\(\d+\)$/, '')) : [artistPart];
  const labels = release?.labels?.length ? release.labels.map((l) => l.name) : (pkg.entities || []).slice(1, 2);
  const styles = release?.styles || [];
  const genres = [...(release?.genres || []), ...styles];
  // Everyone credited: release-level extraartists + per-track artists/credits.
  const clean = (n) => String(n || '').replace(/\s*\(\d+\)$/, '').trim();
  const credits = [
    ...(release?.extraartists || []).map((a) => a.name),
    ...(release?.tracklist || []).flatMap((t) => [...(t.artists || []), ...(t.extraartists || [])].map((a) => a.name)),
  ].map(clean).filter((n) => n && !people.map((p) => p.toLowerCase()).includes(n.toLowerCase()));
  const catalogNumbers = (release?.labels || []).map((l) => l.catno).filter((c) => c && c !== 'none');
  return normalizeFacets({
    people, labels, credits, catalogNumbers,
    // Discogs uses year 0 for "unknown" — never store it.
    eraYear: [pkg.eraYear, release?.year].map(Number).find((y) => y > 1900) ?? null,
    genres,
    gear: detectGear(styles),
    vibe: { kind: 'record' },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRelease(id) {
  const headers = { 'User-Agent': 'HitloopFacetBackfill/1.0 (+https://hitloop.com)' };
  if (process.env.DISCOGS_TOKEN) headers.Authorization = `Discogs token=${process.env.DISCOGS_TOKEN}`;
  const res = await fetch(`https://api.discogs.com/releases/${id}`, { headers });
  if (!res.ok) throw new Error(`Discogs ${res.status}`);
  return res.json();
}

async function main() {
  const useDiscogs = process.argv.includes('--discogs');
  const write = process.argv.includes('--write');
  // Load .env.local (Firebase admin credentials) the same way the other owner scripts do.
  const { createRequire } = await import('node:module');
  createRequire(import.meta.url)('../../features/not-the-rug-brief/load-env');
  const { readInventory, upsertPackage } = await import('../../features/x-content-inventory/store.js');
  const { packages } = await readInventory({});
  const rows = packages.filter((p) => String(p.id).startsWith('discogs-'));
  console.log(`${rows.length} discogs packages | mode: ${useDiscogs ? 'discogs-api' : 'offline'} | ${write ? 'WRITE' : 'dry run'}`);
  console.log('id\tpeople\tlabels\teraYear\tgenres');
  for (const pkg of rows) {
    let release = null;
    if (useDiscogs) {
      try { release = await fetchRelease(pkg.id.replace('discogs-', '')); } catch (e) { console.error(`${pkg.id}: ${e.message}`); }
      await sleep(process.env.DISCOGS_TOKEN ? 1200 : 2600); // unauthenticated limit is 25/min
    }
    const facets = { ...(pkg.facets || {}), ...deriveFacets(pkg, release) };
    console.log([pkg.id, (facets.people || []).join('|'), (facets.labels || []).join('|'), facets.eraYear ?? '', (facets.genres || []).join('|')].join('\t'));
    if (write) await upsertPackage({ ...pkg, facets }, { returnPackages: false });
  }
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
