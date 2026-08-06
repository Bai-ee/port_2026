// container-paths.test.mjs — Fast-follow regression guard (STUDIO-
// DETERMINISTIC-FINAL-RENDER-SONNET-HANDOFF.md, post-Environment/IBL-parity
// review). Two REAL packaging bugs were found by hand in this same session
// (BUILTIN_ENV_HDR_ASSETS reaching `../../public/hdr/...`, then
// BUILTIN_ARTWORK_ASSETS reaching `../../public/img/...`) — both
// unreachable from Dockerfile.proof's `--source .` build (the build context
// is ONLY services/studio-render/; see scripts/vendor-elements.mjs's own
// header comment for the full reasoning). This test statically scans every
// top-level .mjs file in this directory for `path.resolve(__dirname, ...)`
// calls and fails if ANY of them resolve outside this service directory AND
// outside node_modules/ (the one legitimate exception — anything under
// node_modules/ is installed fresh by the Dockerfile's own `npm install`
// step, using THIS directory's own package.json, so it's genuinely present
// in the built image). A future third instance of this exact bug class —
// someone adding a new `path.resolve(__dirname, '../../public/...')` or
// similar — fails this test immediately instead of silently shipping a
// container that 500s on its first real render.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function topLevelMjsFiles() {
  return readdirSync(SERVICE_DIR).filter((f) => f.endsWith('.mjs'));
}

/**
 * Extracts the literal string argument from every `path.resolve(__dirname,
 * '<literal>')` call in `source` (single/double/backtick-quoted, no
 * template interpolation — a dynamically-constructed path is exactly the
 * kind of thing that would ALSO defeat this static check, but nothing in
 * this codebase's render pipeline currently builds one, and a future
 * dynamic path deserves its own explicit review, not a false pass here).
 */
function extractDirnameResolves(source) {
  const re = /path\.resolve\(\s*__dirname\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/g;
  const out = [];
  let m = re.exec(source);
  while (m) {
    out.push(m[2]);
    m = re.exec(source);
  }
  return out;
}

function isAllowed(resolvedPath) {
  const insideService = resolvedPath === SERVICE_DIR || resolvedPath.startsWith(SERVICE_DIR + path.sep);
  const insideNodeModules = resolvedPath.includes(`${path.sep}node_modules${path.sep}`);
  return insideService || insideNodeModules;
}

// ── The detector itself is sound (not a silent no-op) ──────────────────────

test('extractDirnameResolves finds every path.resolve(__dirname, ...) literal in a source string, single/double/backtick-quoted', () => {
  const fixture = `
    const A = path.resolve(__dirname, '../../public/img/x.jpg');
    const B = path.resolve(__dirname, "assets/hdr/y.hdr");
    const C = path.resolve(__dirname, \`node_modules/three/build/three.module.min.js\`);
    const notAMatch = somethingElse(__dirname, 'z');
  `;
  assert.deepEqual(extractDirnameResolves(fixture), [
    '../../public/img/x.jpg',
    'assets/hdr/y.hdr',
    'node_modules/three/build/three.module.min.js',
  ]);
});

test('isAllowed accepts paths inside this service dir and inside node_modules, rejects everything else', () => {
  assert.equal(isAllowed(path.join(SERVICE_DIR, 'assets/hdr/x.hdr')), true);
  assert.equal(isAllowed(path.join(SERVICE_DIR, 'node_modules/three/build/three.module.min.js')), true);
  assert.equal(isAllowed(path.resolve(SERVICE_DIR, '../../node_modules/three/build/three.module.min.js')), true);
  assert.equal(isAllowed(path.resolve(SERVICE_DIR, '../../public/img/x.jpg')), false);
  assert.equal(isAllowed(path.resolve(SERVICE_DIR, '../../public/hdr/x.hdr')), false);
  assert.equal(isAllowed('/etc/passwd'), false);
});

// ── The actual regression guard ─────────────────────────────────────────────

test('every path.resolve(__dirname, ...) in the render pipeline\'s top-level .mjs files resolves inside this service directory or node_modules/ — never public/ or any other path unreachable from a Dockerfile.proof `--source .` build', () => {
  const offenders = [];
  for (const file of topLevelMjsFiles()) {
    const source = readFileSync(path.join(SERVICE_DIR, file), 'utf8');
    for (const rel of extractDirnameResolves(source)) {
      const resolved = path.resolve(SERVICE_DIR, rel);
      if (!isAllowed(resolved)) {
        offenders.push(`${file}: path.resolve(__dirname, '${rel}') -> ${resolved}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Found path(s) reaching outside services/studio-render/ and outside node_modules/ — unreachable from Dockerfile.proof's \`--source .\` build:\n${offenders.join('\n')}\n\nFix: vendor the real file into services/studio-render/assets/ (or vendor/), then point the constant at the vendored copy — see BUILTIN_ENV_HDR_ASSETS' or BUILTIN_ARTWORK_ASSETS' own comment in art-render.mjs for the established pattern.`,
  );
});

test('sanity: at least one real path.resolve(__dirname, ...) call was actually found and checked (the scan isn\'t silently matching zero files)', () => {
  let total = 0;
  for (const file of topLevelMjsFiles()) {
    total += extractDirnameResolves(readFileSync(path.join(SERVICE_DIR, file), 'utf8')).length;
  }
  assert.ok(total > 0, 'expected at least one path.resolve(__dirname, ...) call across this directory\'s .mjs files');
});
