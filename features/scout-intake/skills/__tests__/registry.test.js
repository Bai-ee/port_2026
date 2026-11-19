'use strict';

// The skill registry reads skills/*.md from disk at runtime. In production the
// .md files must be bundled (next.config.mjs outputFileTracingIncludes) or every
// analyzer skill fails with "Skill 'X' not found in registry".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listSkillIds, getSkillPath } = require('../_registry');

test('registry lists the skills that were silently failing in production', () => {
  const ids = listSkillIds();
  assert.ok(ids.includes('seo-depth-audit'));
  assert.ok(ids.includes('design-evaluation'));
  assert.ok(fs.existsSync(getSkillPath('seo-depth-audit')));
});

test('next.config.mjs bundles the skill .md files into every route', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../../../next.config.mjs'), 'utf8');
  assert.ok(src.includes("'./features/scout-intake/skills/*.md'"));
});

test('resolveSkillsDir falls back to the next candidate when the first is unreadable or empty', () => {
  const { resolveSkillsDir } = require('../_skills-dir');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-cwd-'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-empty-'));
  fs.writeFileSync(path.join(tmp, 'demo-skill.md'), '# demo');
  fs.writeFileSync(path.join(empty, '_runner.js'), '');
  const missing = path.join(tmp, 'does-not-exist');
  assert.equal(resolveSkillsDir([missing, empty, tmp]), tmp);
  assert.equal(resolveSkillsDir([missing, empty]), null);
});
