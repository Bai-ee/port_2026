// Archive readers. Adapters never touch the filesystem directly: they take a reader, so every
// adapter is testable with an in-memory map and runs against a mounted NAS folder in production.
//
// Reader interface (all paths are POSIX, relative to the archive root, never absolute):
//   read(rel)   -> string | null      utf8 text of a file, null when missing/unreadable
//   list(rel)   -> string[]           names directly inside a directory ([] when missing)
//   exists(rel) -> boolean
//   isDir(rel)  -> boolean
//   root        -> string             label only (absolute path for dir readers, 'memory' for maps)
import fs from 'node:fs';
import path from 'node:path';

const clean = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');

function safeJoin(root, rel) {
  const r = clean(rel);
  if (r.split('/').includes('..')) return null;
  const abs = path.join(root, r);
  const back = path.relative(root, abs);
  return back.startsWith('..') || path.isAbsolute(back) ? null : abs;
}

export function readerFromDir(rootAbs) {
  const root = path.resolve(rootAbs);
  return {
    root,
    read(rel) { const p = safeJoin(root, rel); if (!p) return null; try { return fs.readFileSync(p, 'utf8'); } catch { return null; } },
    list(rel = '') { const p = safeJoin(root, rel); if (!p) return []; try { return fs.readdirSync(p).filter((n) => !n.startsWith('.')); } catch { return []; } },
    exists(rel) { const p = safeJoin(root, rel); return !!p && fs.existsSync(p); },
    isDir(rel) { const p = safeJoin(root, rel); try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; } },
  };
}

/** In-memory reader for tests: `files` is { 'posts/posts_1.html': '<html>…' }. Directories are implied by paths. */
export function readerFromMap(files) {
  const map = new Map(Object.entries(files).map(([k, v]) => [clean(k), String(v)]));
  const dirs = new Set(['']);
  for (const k of map.keys()) { const parts = k.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
  return {
    root: 'memory',
    read(rel) { return map.has(clean(rel)) ? map.get(clean(rel)) : null; },
    list(rel = '') {
      const d = clean(rel); const prefix = d ? `${d}/` : ''; const out = new Set();
      for (const k of [...map.keys(), ...dirs]) if (k.startsWith(prefix) && k !== d && k.length > prefix.length) out.add(k.slice(prefix.length).split('/')[0]);
      return [...out].sort();
    },
    exists(rel) { const c = clean(rel); return map.has(c) || dirs.has(c); },
    isDir(rel) { return dirs.has(clean(rel)); },
  };
}
