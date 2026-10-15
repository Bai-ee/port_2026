import test from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_NAMES } from '../../theme/tokens.js';
import {
  OWNED_CSS, BRIDGE_CSS, GENERATED_CSS, read, tokenRefs, stripComments,
} from './ws5-helpers.js';

const TOKEN_SET = new Set(TOKEN_NAMES);
// names that styles/theme/theme.generated.css actually declares (the real source of truth for the browser)
const declared = new Set([...stripComments(read(GENERATED_CSS)).matchAll(/(--t-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

test('the generated stylesheet declares exactly the manifest', () => {
  assert.deepEqual([...declared].sort(), [...TOKEN_SET].sort());
});

for (const file of [...OWNED_CSS, BRIDGE_CSS]) {
  test(`${file}: every var(--t-*) exists in the manifest and in theme.generated.css`, () => {
    const refs = [...new Set(tokenRefs(read(file)))];
    for (const r of refs) {
      assert.ok(TOKEN_SET.has(r), `${file} references ${r}, which is not in TOKEN_NAMES`);
      assert.ok(declared.has(r), `${file} references ${r}, which theme.generated.css does not declare`);
    }
  });

  test(`${file}: no bare --t-* name outside var() either (typos, e.g. in custom-property values or comments)`, () => {
    const bare = [...stripComments(read(file)).matchAll(/(?<![\w-])(--t-[a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((m) => m[1]);
    for (const b of new Set(bare)) assert.ok(TOKEN_SET.has(b), `${file} mentions ${b}, which is not in TOKEN_NAMES`);
  });
}

test('colors.css, bridge.css and the dashboard sheets reference the tokens they rely on (migration actually happened)', () => {
  const all = new Set(OWNED_CSS.flatMap((f) => tokenRefs(read(f))));
  for (const must of ['--t-text', '--t-surface', '--t-border-subtle', '--t-text-secondary', '--t-glass-strong', '--t-accent-bright', '--t-chrome', '--t-term-fg', '--t-dash-text-primary', '--t-danger-solid', '--t-on-solid', '--t-comet-1', '--t-inset']) {
    assert.ok(all.has(must) || read(BRIDGE_CSS).includes(must), `${must} is not referenced anywhere`);
  }
});
