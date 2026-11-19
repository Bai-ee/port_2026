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
