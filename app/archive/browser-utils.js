// Pure helpers for the /archive browser panel. No React, no fetch, no
// Firestore — safe to unit test with `node --test` and safe to import from
// the client page.

// Human-readable byte size, e.g. `137.8 MB`. Whole bytes render with no
// decimal; everything above that gets one decimal place.
export function formatBytes(n) {
  const num = Number(n) || 0;
  if (!num) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = num;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : 1;
  return `${v.toFixed(decimals)} ${units[i]}`;
}

// LIST_DIRECTORY result -> a flat entries array, folders and files alike.
// The current worker contract returns `entries` directly:
//   { name, kind:'folder'|'file', sizeBytes?, modifiedAt?, ext?, movable? }
// An older worker only returns `folders: string[]` — synthesize folder-only
// entries from that so the browser panel degrades instead of breaking.
export function entriesFromResult(result) {
  if (!result) return [];
  if (Array.isArray(result.entries)) return result.entries;
  return (result.folders || []).map((name) => ({ name, kind: 'folder' }));
}

// Breadcrumb segments from the source root down to `relativePath`, e.g.
// segmentsFor('Housepit/San Francisco') ->
//   [{name:'ROOT',path:'.'}, {name:'Housepit',path:'Housepit'}, {name:'San Francisco',path:'Housepit/San Francisco'}]
export function segmentsFor(relativePath) {
  const normalized = relativePath && relativePath !== '.' ? relativePath : '';
  const parts = normalized.split('/').filter(Boolean);
  const segments = [{ name: 'ROOT', path: '.' }];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    segments.push({ name: part, path: acc });
  }
  return segments;
}

// Join a parent relative path with a child folder/file name, respecting the
// '.' root sentinel the worker contract uses.
export function joinPath(parent, name) {
  if (!parent || parent === '.') return name;
  return `${parent}/${name}`;
}

// A stable, worker-contract-safe collection id from an arbitrary relative
// path: lowercase, non [a-z0-9] runs collapse to a single '-', edges
// trimmed, capped at 64 chars (trimming any dash the cap re-exposes at the
// end). '.'/empty/unslugifiable input -> 'root'.
export function slugifyCollectionId(path) {
  const raw = path == null || path === '.' ? '' : String(path);
  if (!raw) return 'root';
  let slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return 'root';
  slug = slug.slice(0, 64).replace(/-+$/g, '');
  return slug || 'root';
}

// The deepest folder that contains every given relative path (file or
// folder paths alike — each path's own containing directory is what's
// compared, not the path itself). Empty input, or paths with nothing in
// common beyond the source root, -> '.'.
export function commonParent(paths) {
  if (!paths || paths.length === 0) return '.';
  const dirSegs = paths.map((p) => {
    const normalized = p && p !== '.' ? String(p) : '';
    const parts = normalized.split('/').filter(Boolean);
    return parts.slice(0, -1);
  });
  const first = dirSegs[0];
  const common = [];
  for (let i = 0; i < first.length; i += 1) {
    const seg = first[i];
    if (dirSegs.every((segs) => segs[i] === seg)) common.push(seg);
    else break;
  }
  return common.length ? common.join('/') : '.';
}

// Depth-first flatten of every currently-visible tree row, in the exact
// on-screen order, for shift-click range selection. `tree` = { path,
// entries, children } where `entries` are the root's own (unsorted-ok)
// entries and `children` is a plain object mapping an expanded folder's
// relativePath -> { entries }. A folder in `expandedPaths` with no entry in
// `children` (not loaded yet) simply renders no descendants.
export function flattenVisible(tree, expandedPaths) {
  const rows = [];
  const expanded = expandedPaths instanceof Set ? expandedPaths : new Set(expandedPaths || []);
  function walk(parentPath, entries, depth) {
    for (const entry of entries || []) {
      const path = joinPath(parentPath, entry.name);
      rows.push({ path, kind: entry.kind, depth, entry });
      if (entry.kind === 'folder' && expanded.has(path)) {
        const child = tree.children && tree.children[path];
        if (child && Array.isArray(child.entries)) walk(path, child.entries, depth + 1);
      }
    }
  }
  walk(tree.path == null ? '.' : tree.path, tree.entries, 0);
  return rows;
}

// Tallies a selection Map<relativePath, {kind, sizeBytes?}> into the
// selection-bar summary. Folder byte totals are unknown (implied subtree),
// so `bytes` only sums selected files.
export function summarizeSelection(selected) {
  let folders = 0;
  let files = 0;
  let bytes = 0;
  for (const meta of selected.values()) {
    if (meta && meta.kind === 'folder') folders += 1;
    else {
      files += 1;
      bytes += Number(meta && meta.sizeBytes) || 0;
    }
  }
  return { total: folders + files, folders, files, bytes };
}
