import test from 'node:test';
import assert from 'node:assert/strict';
import { scanLiterals, loadAllowlist, isAllowed } from '../../theme/dev/scan-literals.js';
import { OWNED_CSS, read, ROOT } from './ws5-helpers.js';
import fs from 'node:fs';
import path from 'node:path';

const allowlistJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/theme-migration/allowlists/ws5.json'), 'utf8'));
const allowlist = loadAllowlist(allowlistJson);
const LEGEND = new Set(Object.keys(allowlistJson.legend));

// non-shadow findings only: black shadows (box-shadow / text-shadow / drop-shadow) are exception X6
const findings = (file) => scanLiterals(read(file), { file, type: 'css' }).filter((f) => !f.blackShadow);

test('allowlist entries are well formed: file, literal, reason, exceptionId (known), count', () => {
  assert.ok(allowlist.length > 0);
  const seen = new Set();
  for (const e of allowlistJson.entries) {
    assert.ok(OWNED_CSS.includes(e.file), `${e.file} is not a WS5 file`);
    assert.ok(typeof e.reason === 'string' && e.reason.length >= 10, `reason missing for ${e.file} ${e.literal}`);
    for (const id of e.exceptionId.split(' / ')) assert.ok(LEGEND.has(id), `unknown exceptionId ${id}`);
    assert.ok(Number.isInteger(e.count) && e.count >= 1, `count for ${e.file} ${e.literal}`);
    const key = `${e.file}\u0000${e.literal}`;
    assert.ok(!seen.has(key), `duplicate allowlist entry ${e.file} ${e.literal}`);
    seen.add(key);
  }
});

for (const file of OWNED_CSS) {
  test(`${file}: every remaining colour literal is allowlisted (black shadows exempt)`, () => {
    const stray = findings(file).filter((f) => !isAllowed(f, file, allowlist));
    assert.deepEqual(
      stray.map((f) => `${f.line}:${f.column} ${f.property || '?'} ${f.literal}`),
      [],
      `${file} has theme-sensitive literals that are neither migrated to tokens nor allowlisted`,
    );
  });

  test(`${file}: allowlist counts are exact (no stale entry, no silently added literal)`, () => {
    const counts = new Map();
    for (const f of findings(file)) counts.set(f.normalized, (counts.get(f.normalized) || 0) + 1);
    const entries = allowlist.filter((e) => e.file === file);
    for (const e of entries) {
      assert.equal(counts.get(e.normalizedLiteral) || 0, e.count, `${file}: ${e.literal} occurs ${counts.get(e.normalizedLiteral) || 0}x, allowlist says ${e.count}x`);
      counts.delete(e.normalizedLiteral);
    }
    assert.deepEqual([...counts.keys()], [], `${file}: literals without an allowlist entry`);
  });
}

test('the highest-volume legacy literals are gone from the migrated files (spot check of the migration itself)', () => {
  // #2a2420 ink and the translucent ink / white ladders were 86 / 86 / 60 occurrences in the dashboard CSS.
  // Ink-tinted shadows stay literal on purpose (X6), so only non-shadow declarations are checked.
  const LADDER = new Set([
    ...[0.08, 0.12, 0.22, 0.38, 0.52, 0.72].map((a) => `rgba(42,36,32,${a})`),
    ...[0.5, 0.62, 0.78].map((a) => `rgba(255,255,255,${a})`),
    '#2a2420',
  ]);
  for (const file of OWNED_CSS.filter((f) => f.startsWith('styles/dashboard/') && !f.endsWith('11-creative-brief.css'))) {
    const left = scanLiterals(read(file), { file, type: 'css' })
      .filter((f) => !/shadow/.test(f.property || '') && LADDER.has(f.normalized))
      .map((f) => `${f.line} ${f.property} ${f.literal}`);
    assert.deepEqual(left, [], `${file} still has legacy ladder literals outside shadows`);
  }
});

test('no mode selector survives for status/flag colours (.tr--flag uses the danger token without a [data-dashboard-theme="light"] override)', () => {
  const css = read('styles/dashboard/01-base.css');
  assert.ok(!/\[data-dashboard-theme="light"\]/.test(css));
  assert.match(css, /\.tr--flag td:first-child::before\s*\{[^}]*background:\s*var\(--t-danger-solid\)/);
});

test('dark-only tile-blocked overrides use theme tokens (the light look is left as authored)', () => {
  const css = read('styles/dashboard/01-base.css');
  const m = /\[data-dashboard-theme="dark"\] \.tile-blocked-title\s*\{\s*color:\s*([^;]+);/.exec(css);
  assert.ok(m, 'dark title rule exists');
  assert.equal(m[1].trim(), 'var(--t-on-overlay)');
  assert.match(css, /\[data-dashboard-theme="dark"\] \.tile-blocked-overlay\s*\{[^}]*background:\s*var\(--t-overlay\)/);
  assert.ok(!/\.tile-blocked-(title|upgrade-btn)[^{]*\{[^}]*--t-text-inverse/.test(css), 'text-inverse must not be used on the dark scrim (contract section 19.1)');
});
