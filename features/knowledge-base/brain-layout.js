// Source Library brain layout.
//
// Mirrors the folder format of the company brain kept outside HITLOOP
// (reference: the Critters Quest brain, 2026-11-19):
//
//   MASTER_BRAIN.md            role "master"   consolidated working knowledge
//   INDEX.md                   role "index"    table of contents
//   manifest.json              role "manifest" sha256 + bytes per file
//   STRATEGY_WORKING_BRIEF.md  role "brief"    UPPER_CASE working docs
//   2026-11-19-<slug>.md|json  role "analysis" dated reviews (md + json pairs)
//   sources/...                role "source"   raw evidence, kept byte-for-byte
//   versions/<label>/...       role "version"  snapshots taken before an update
//
// Everything here is pure (no Firestore, no network) so it can be unit tested.

export const BRAIN_ROLES = ['master', 'index', 'manifest', 'brief', 'analysis', 'source', 'version'];

export const BRAIN_ROLE_LABELS = {
  master: 'Master',
  index: 'Index',
  manifest: 'Manifest',
  brief: 'Brief',
  analysis: 'Analysis',
  source: 'Source',
  version: 'Version',
};

const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?=[-_.\s]|$)/;

export function todayIso(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function slugify(value, fallback = 'document') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function splitExt(name) {
  const value = String(name || '');
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return { base: value, ext: '' };
  return { base: value.slice(0, dot), ext: value.slice(dot).toLowerCase() };
}

// Clean a browser-supplied relative path: forward slashes, no "." / ".."
// segments, no leading slash, no hidden/OS junk segments.
export function normalizeBrainPath(path) {
  const segments = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim().replace(/[?%*:|"<>]/g, '-'))
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  return segments.join('/');
}

export function isJunkPath(path) {
  return normalizeBrainPath(path)
    .split('/')
    .some((segment) => segment.startsWith('.') || segment === '__MACOSX' || segment === 'Thumbs.db' || segment === 'desktop.ini');
}

// A folder pick gives paths like "brain/INDEX.md". When every path shares the
// same first folder, that folder is the brain root and is dropped.
export function stripCommonRoot(paths) {
  const clean = (Array.isArray(paths) ? paths : []).map(normalizeBrainPath);
  const firsts = clean.map((path) => (path.includes('/') ? path.split('/')[0] : null));
  const root = firsts[0];
  if (!root || clean.length === 0 || firsts.some((first) => first !== root)) return clean;
  if (root === 'sources' || root === 'versions') return clean;
  return clean.map((path) => path.slice(root.length + 1));
}

function dateFrom(name) {
  const match = String(name || '').match(DATE_PREFIX);
  return match ? match[1] : null;
}

function isUpperCaseDocName(base) {
  return /^[A-Z0-9][A-Z0-9_-]*$/.test(base) && /[A-Z]/.test(base);
}

// Decide where a file lives in the brain and what role it plays.
// `path` is the path relative to the brain root (or just a file name for a
// loose drop). Loose files that are not one of the recognised root documents
// are raw evidence and are filed under sources/ with a date prefix.
export function classifyBrainPath(path, { today = todayIso() } = {}) {
  const clean = normalizeBrainPath(path);
  const segments = clean.split('/').filter(Boolean);
  const fileName = segments[segments.length - 1] || 'document.txt';
  const { base, ext } = splitExt(fileName);

  if (segments[0] === 'versions' && segments.length >= 3) {
    const versionLabel = segments[1];
    return {
      brainPath: clean,
      brainRole: 'version',
      brainDate: dateFrom(versionLabel) || dateFrom(fileName),
      versionLabel,
    };
  }

  if (segments[0] === 'sources' && segments.length >= 2) {
    return {
      brainPath: clean,
      brainRole: 'source',
      brainDate: dateFrom(fileName),
      versionLabel: null,
    };
  }

  if (segments.length === 1) {
    const upper = fileName.toUpperCase();
    if (upper === 'MASTER_BRAIN.MD') return rootDoc(fileName, 'master');
    if (upper === 'INDEX.MD') return rootDoc(fileName, 'index');
    if (fileName.toLowerCase() === 'manifest.json') return rootDoc(fileName, 'manifest');
    if ((ext === '.md' || ext === '.markdown') && isUpperCaseDocName(base)) return rootDoc(fileName, 'brief');
    const date = dateFrom(fileName);
    if (date && (ext === '.md' || ext === '.json' || ext === '.markdown')) {
      return { brainPath: fileName, brainRole: 'analysis', brainDate: date, versionLabel: null };
    }
  }

  // Anything else is raw evidence. Keep its sub-folders under sources/ and
  // make sure the file name starts with a date, like the rest of the brain.
  const date = dateFrom(fileName) || today;
  const datedName = dateFrom(fileName) ? fileName : `${today}-${slugify(base)}${ext}`;
  const subFolders = segments.slice(0, -1).filter((segment) => segment !== 'sources');
  return {
    brainPath: ['sources', ...subFolders, datedName].join('/'),
    brainRole: 'source',
    brainDate: date,
    versionLabel: null,
  };
}

function rootDoc(fileName, role) {
  return { brainPath: fileName, brainRole: role, brainDate: null, versionLabel: null };
}

// Path for pasted text / imported URLs, which have no file name of their own.
export function brainPathForTitle(title, { ext = '.md', today = todayIso() } = {}) {
  return classifyBrainPath(`${slugify(title, 'note')}${ext}`, { today });
}

// When a changed file replaces one already in the brain, the old copy is kept
// under versions/<date>-before-<slug>/<original path>.
export function versionPathFor(brainPath, { today = todayIso(), label = null } = {}) {
  const clean = normalizeBrainPath(brainPath);
  const versionLabel = label || `${today}-before-${slugify(splitExt(clean.split('/').pop()).base, 'update')}`;
  return { brainPath: `versions/${versionLabel}/${clean}`, versionLabel };
}

// Items written before the brain layout existed have no brainPath. Show them
// as sources, named after their file or title.
export function legacyBrainFields(item) {
  const createdDate = String(item?.createdAt || '').slice(0, 10);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(createdDate) ? createdDate : todayIso();
  const name = item?.fileName || `${slugify(item?.title, 'note')}${item?.type === 'url' ? '.url.md' : '.md'}`;
  return { ...classifyBrainPath(name, { today }), legacy: true };
}

const ROLE_ORDER = { master: 0, index: 1, manifest: 2, brief: 3, analysis: 4, source: 5, version: 6 };

export function sortBrainItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const roleDelta = (ROLE_ORDER[a.brainRole] ?? 9) - (ROLE_ORDER[b.brainRole] ?? 9);
    if (roleDelta) return roleDelta;
    if (a.brainRole === 'analysis' || a.brainRole === 'version') {
      const dateDelta = String(b.brainDate || '').localeCompare(String(a.brainDate || ''));
      if (dateDelta) return dateDelta;
    }
    return String(a.brainPath || '').localeCompare(String(b.brainPath || ''));
  });
}

// Group items for the folder view: Root, Analysis, Sources, then one group
// per version snapshot.
export function groupBrainItems(items) {
  const sorted = sortBrainItems(items);
  const groups = [
    { id: 'root', label: 'Root', items: [] },
    { id: 'analysis', label: 'Analysis', items: [] },
    { id: 'sources', label: 'sources/', items: [] },
  ];
  const versions = new Map();
  for (const item of sorted) {
    if (item.brainRole === 'version') {
      const label = item.versionLabel || 'snapshot';
      if (!versions.has(label)) versions.set(label, { id: `version-${label}`, label: `versions/${label}/`, items: [] });
      versions.get(label).items.push(item);
    } else if (item.brainRole === 'analysis') {
      groups[1].items.push(item);
    } else if (item.brainRole === 'source') {
      groups[2].items.push(item);
    } else {
      groups[0].items.push(item);
    }
  }
  const versionGroups = [...versions.values()].sort((a, b) => b.label.localeCompare(a.label));
  return [...groups, ...versionGroups].filter((group) => group.items.length > 0);
}

// Source IDs (D1, X1–X11, ...) live in sources/*source-register.md as a
// markdown table whose first column is the ID and whose other cells link to
// files. Returns { "sources/<file>": ["D2", ...] }.
export function parseSourceRegister(markdown, { registerPath = 'sources/source-register.md' } = {}) {
  const map = {};
  const registerDir = registerPath.includes('/') ? registerPath.slice(0, registerPath.lastIndexOf('/')) : '';
  for (const line of String(markdown || '').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const id = cells[0].replace(/\*/g, '');
    if (!/^[A-Z]{1,3}\d+([–-][A-Z]{0,3}\d+)?$/.test(id)) continue;
    const links = [...line.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
    for (const link of links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      const resolved = resolveRelative(registerDir, link);
      if (!resolved) continue;
      map[resolved] = [...new Set([...(map[resolved] || []), id])];
    }
  }
  return map;
}

function resolveRelative(dir, link) {
  const parts = dir ? dir.split('/') : [];
  for (const segment of String(link).split('#')[0].split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

// manifest.json in the same shape as the reference brain: every file,
// version snapshots included, except manifest.json itself.
export function buildManifest({ project, items, generatedAt = new Date().toISOString() }) {
  const files = sortByPath(items)
    .filter((item) => item.brainRole !== 'manifest')
    .map((item) => ({
      path: item.brainPath,
      bytes: Number(item.sizeBytes) || Number(item.charCount) || 0,
      sha256: item.sha256 || null,
    }));
  return {
    schema_version: 1,
    project: project || null,
    generated_by: 'HITLOOP Source Library',
    generated_at: generatedAt,
    files,
  };
}

function sortByPath(items) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => String(a.brainPath).localeCompare(String(b.brainPath)));
}

function mdLink(item) {
  const label = item.title && item.title !== item.brainPath.split('/').pop() ? item.title : item.brainPath.split('/').pop();
  return `[${label}](${encodeURI(item.brainPath)})`;
}

// INDEX.md that lists every file by group. Used when the uploaded brain has
// no INDEX.md of its own, or when the owner wants the current file list.
export function buildIndexMarkdown({ project, items, today = todayIso() }) {
  const groups = groupBrainItems(items.filter((item) => item.brainRole !== 'index'));
  const lines = [`# ${project ? `${project} brain` : 'Brain'} — index`, `Generated **${today}** by the HITLOOP Source Library.`, ''];
  for (const group of groups) {
    lines.push(`## ${group.label}`);
    for (const item of group.items) {
      const ids = Array.isArray(item.sourceIds) && item.sourceIds.length ? ` (${item.sourceIds.join(', ')})` : '';
      lines.push(`- ${mdLink(item)}${ids}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

// Keep an uploaded INDEX.md as written and append the files it does not link
// yet (added in HITLOOP after the brain was imported).
export function appendUnlistedToIndex(indexMarkdown, items, { today = todayIso() } = {}) {
  const text = String(indexMarkdown || '');
  const linked = new Set([...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => decodeURI(match[1]).replace(/^\.\//, '')));
  const unlisted = sortBrainItems(items).filter((item) => (
    item.brainRole !== 'index' && item.brainRole !== 'manifest' && item.brainRole !== 'version' && !linked.has(item.brainPath)
  ));
  if (!unlisted.length) return text;
  const lines = ['', `## Added in HITLOOP (listed ${today})`, ...unlisted.map((item) => `- ${mdLink(item)}`), ''];
  return `${text.replace(/\s+$/, '')}\n${lines.join('\n')}`;
}

export function findSourceRegister(items) {
  return sortBrainItems(items).find((item) => item.brainRole === 'source' && /source-register\.md$/i.test(item.brainPath)) || null;
}
