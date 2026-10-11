// Links timeline-entry media to NAS content packages by exact (or case/URL-decode folded) archive path.
// NEVER matches by filename alone. PURE.
const posix = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
const decode = (p) => { try { return decodeURIComponent(p); } catch { return p; } };
const fold = (p) => decode(posix(p)).toLowerCase();

export function matchEntries(entries, packages, { archiveRootRel = '' } = {}) {
  const root = posix(archiveRootRel);
  const exact = new Map();
  const folded = new Map(); // folded path -> Set(packageId)
  for (const pkg of packages || []) {
    const rel = pkg?.nas?.relativePath;
    if (!pkg?.id || !rel) continue;
    const p = posix(rel);
    if (!exact.has(p)) exact.set(p, pkg.id);
    const f = fold(p);
    if (!folded.has(f)) folded.set(f, new Set());
    folded.get(f).add(pkg.id);
  }
  const links = []; const unmatched = [];
  let media = 0; const withMatch = new Set();
  for (const e of entries || []) {
    for (const m of e.media || []) {
      media += 1;
      const rel = posix(m.relPath);
      const cand = root ? `${root}/${rel}` : rel;
      let packageId = exact.get(cand);
      if (!packageId) {
        const ids = folded.get(fold(cand));
        if (ids && ids.size === 1) [packageId] = [...ids]; // ambiguous folded match is never guessed
      }
      if (packageId) { links.push({ entryId: e.id, packageId, relPath: m.relPath }); withMatch.add(e.id); }
      else unmatched.push({ entryId: e.id, relPath: m.relPath });
    }
  }
  return { links, unmatched, stats: { media, matched: links.length, unmatched: unmatched.length, entriesWithMatch: withMatch.size } };
}
