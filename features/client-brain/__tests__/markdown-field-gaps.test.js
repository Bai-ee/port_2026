import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileClientBrainMarkdown } from '../markdown.cjs';
import { buildUseForContext } from '../store.cjs';
import { projectBrainToVoiceProfile } from '../../not-the-rug-brief/voice-resolver.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const HITLOOP_MD = 'features/client-brain/__tests__/fixtures/hitloop-CLIENT_BRAIN.md';

const VOLATILE = new Set(['markdownSource', 'compiledAt', 'generatedAt', 'updatedAt', 'lastValidatedAt', 'lastImportedAt', 'lastUpdatedAt']);
const NEW_KEYS = {
  markdownMeta: ['sourceStandard'],
  identity: ['mission'],
  positioning: ['authorityClaims', 'differentiators', 'longTerm', 'principles', 'channelOneLiners'],
};

// Compiled output minus timestamps and minus the keys this change introduced.
function legacyView(compiled) {
  const out = JSON.parse(JSON.stringify(compiled, (k, v) => (VOLATILE.has(k) ? undefined : v)));
  for (const [section, keys] of Object.entries(NEW_KEYS)) keys.forEach((k) => delete out[section][k]);
  return out;
}

// sha256 of legacyView() taken from the compiler BEFORE the field-gap change
// (2026-10-13). If a brain's Markdown is edited on purpose, re-capture its hash.
const LEGACY_HASHES = {
  'docs/company-brain/clients/bryan-balli/CLIENT_BRAIN.md': 'e288aa3edffee3f7906524f2116faf43cd37a8289c39c38c5be5efbea9bd39fa',
  'docs/company-brain/BRYAN_EXAMPLE_CLIENT_BRAIN.md': '1499230f45d65ca6ab14f004a3a31ca3aa37b665e4226b9a8509c1c006cf5d8a',
  'marketing/CLIENT_BRAIN.md': '75ee93a3eb30c9def91af888eb27abdc612af69a777d63f8f5a2907cd2cbb0c4',
};

for (const [rel, hash] of Object.entries(LEGACY_HASHES)) {
  test(`back-compat: ${rel} compiles to the pre-change legacy fields`, () => {
    const compiled = compileClientBrainMarkdown(read(rel), { clientId: 'x' });
    const digest = crypto.createHash('sha256').update(JSON.stringify(legacyView(compiled))).digest('hex');
    assert.equal(digest, hash);
  });
}

const MINIMAL = `---
clientId: acme
clientName: Acme
status: approved
---

# Client Brain

## Identity Intelligence

### Name
Acme

### Category To Own
- Widgets

### Positioning
Acme makes widgets.
`;

test('absent narrative fields add no new keys', () => {
  const b = compileClientBrainMarkdown(MINIMAL);
  for (const [section, keys] of Object.entries(NEW_KEYS)) {
    keys.forEach((k) => assert.equal(k in b[section], false, `${section}.${k} should be absent`));
  }
});

test('HITLOOP brain compiles every identity narrative field', () => {
  const b = compileClientBrainMarkdown(read(HITLOOP_MD), { clientId: 'hitloop' });
  assert.match(b.identity.mission, /scattered client information to approved/);
  assert.match(b.positioning.longTerm, /creative operating system for teams/);
  assert.equal(b.positioning.differentiators.length, 7);
  assert.ok(b.positioning.differentiators.some((d) => /portable strategic Brain that can be exported, reviewed, updated, and reloaded/.test(d)));
  assert.equal(b.positioning.principles.length, 10);
  assert.ok(b.positioning.principles.includes('Research belongs upstream from runtime.'));
  assert.deepEqual(Object.keys(b.positioning.channelOneLiners), ['strategic', 'safePublic', 'linkedin', 'x']);
  assert.match(b.positioning.channelOneLiners.x, /human-approved AI workflows/);
  assert.match(b.positioning.channelOneLiners.safePublic, /one approved client context/);
  assert.equal(b.markdownMeta.sourceStandard, 'studio-intelligence-standard-v1');
});

test('Metrics and Authority Claim bullets keep their commas', () => {
  const b = compileClientBrainMarkdown(read(HITLOOP_MD), { clientId: 'hitloop' });
  assert.deepEqual(b.proof.metrics, [
    'Engagements start at $3,500',
    'Scoped web builds typically run 2-6 weeks',
    'Intake brief with dashboard prototype can be ready in under a week',
    'Design system extraction can run in 3-5 days',
  ]);
  assert.equal(b.positioning.authorityClaims.length, 5);
  assert.match(b.positioning.authorityClaims[3], /^Converts onboarding, websites, docs, social context, and source material/);
  assert.equal(b.positioning.authorityPosition, b.positioning.authorityClaims[0]);
});

test('plain list fields still split comma-separated values', () => {
  const md = MINIMAL.replace('### Positioning', '### Offers\n- design, dev, strategy\n\n### Positioning');
  assert.deepEqual(compileClientBrainMarkdown(md).offers.services, ['design', 'dev', 'strategy']);
});

test('HITLOOP compile is complete: no gaps, high confidence, 4 drivers', () => {
  const b = compileClientBrainMarkdown(read(HITLOOP_MD), { clientId: 'hitloop' });
  assert.deepEqual(b.missingData, []);
  assert.deepEqual(b.contradictions, []);
  assert.equal(b.confidence, 'high');
  assert.equal(b.decisions.decisionDrivers.length, 4);
});

test('voice profile carries every Formatting Rules key incl. long/punctuation/links', () => {
  const b = compileClientBrainMarkdown(read(HITLOOP_MD), { clientId: 'hitloop' });
  const fr = projectBrainToVoiceProfile(b, 'hitloop').formatting_rules;
  assert.deepEqual(Object.keys(fr), ['short_posts', 'medium_posts', 'long_posts', 'caps_usage', 'emojis', 'punctuation', 'links']);
  assert.match(fr.links, /only when the post needs a concrete source/);
});

test('loadClientBrainContext block surfaces narrative fields per useFor, within budget', () => {
  const b = compileClientBrainMarkdown(read(HITLOOP_MD), { clientId: 'hitloop' });
  const social = buildUseForContext(b, 'socialPosts');
  assert.match(social, /X one-liner: .*human-approved AI workflows/);
  assert.match(social, /Principles: .*Research belongs upstream/);
  assert.doesNotMatch(social, /Public one-liner|Mission:/);

  const copy = buildUseForContext(b, 'copy');
  assert.match(copy, /Public one-liner: .*one approved client context/);
  assert.match(copy, /Differentiators: /);
  assert.match(copy, /Authority: .*Converts onboarding, websites/);
  assert.match(copy, /Mission: /);
  assert.doesNotMatch(copy, /X one-liner/);

  const proof = buildUseForContext(b, 'proof');
  assert.match(proof, /Metrics: Engagements start at \$3,500/);

  // The channel one-liner sits right under About so it survives real caller
  // budgets (1500-2500); the longer narrative lists are appended last.
  const lines = social.split('\n');
  assert.match(lines[3], /^X one-liner: /);
  assert.match(lines[lines.length - 1], /^Principles: /);
  for (const max of [1500, 2500]) assert.match(social.slice(0, max), /X one-liner: /);
  assert.match(copy.slice(0, 1500), /Public one-liner: /);
});

test('buildUseForContext prints About/Positioning once and caps long lists', () => {
  const b = compileClientBrainMarkdown(read(HITLOOP_MD), { clientId: 'hitloop' });
  const copy = buildUseForContext(b, 'copy');
  assert.doesNotMatch(copy, /^Positioning: /m);
  assert.equal(copy.match(/^Differentiation: (.*)$/m)[1].split('; ').length, 6);
  assert.equal(copy.match(/^Do: (.*)$/m)[1].split('; ').length, 12);
  assert.equal(copy.match(/^Do not: (.*)$/m)[1].split('; ').length, 24);
  // A distinct positioning line is still printed.
  const distinct = buildUseForContext({ ...b, positioning: { ...b.positioning, oneLiner: 'Something else.' } }, 'copy');
  assert.match(distinct, /^Positioning: Something else\.$/m);
});

test('buildUseForContext output is unchanged for a brain without narrative fields', () => {
  const b = compileClientBrainMarkdown(MINIMAL);
  for (const useFor of ['socialPosts', 'copy', 'strategy', 'proof', 'emailDigest']) {
    assert.equal(buildUseForContext(b, useFor), buildUseForContext(legacyView(b), useFor));
  }
});
