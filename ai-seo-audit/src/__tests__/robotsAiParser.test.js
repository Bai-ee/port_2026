// robotsAiParser.test.js — Unit tests for path matching logic.
// Uses Node built-in test runner (node:test). No Jest.
//
// Run: node --test src/__tests__/robotsAiParser.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobotsTxt, resolveAccess, getEffectiveRules, patternToRegex } from '../robotsAiParser.js';

// ── patternToRegex ────────────────────────────────────────────────────────────

describe('patternToRegex', () => {
  test('exact prefix match', () => {
    const re = patternToRegex('/private/');
    assert.ok(re.test('/private/'));
    assert.ok(re.test('/private/page'));
    assert.ok(!re.test('/public/'));
  });

  test('wildcard *', () => {
    const re = patternToRegex('/api/*');
    assert.ok(re.test('/api/v1/users'));
    assert.ok(re.test('/api/'));
    assert.ok(!re.test('/apiv2/'));
  });

  test('end anchor $', () => {
    const re = patternToRegex('/*.pdf$');
    assert.ok(re.test('/docs/report.pdf'));
    assert.ok(re.test('/file.pdf'));
    assert.ok(!re.test('/pdf-guide'));
    assert.ok(!re.test('/docs/report.pdf.html'));
  });

  test('root path blocks everything', () => {
    const re = patternToRegex('/');
    assert.ok(re.test('/'));
    assert.ok(re.test('/blog/'));
    assert.ok(re.test('/anything'));
  });
});

// ── resolveAccess ─────────────────────────────────────────────────────────────

describe('resolveAccess', () => {
  test('empty rules → unspecified', () => {
    const { access } = resolveAccess([], '/blog/');
    assert.equal(access, 'unspecified');
  });

  test('Disallow: / blocks root', () => {
    const rules = [{ type: 'Disallow', path: '/' }];
    assert.equal(resolveAccess(rules, '/').access, 'blocked');
    assert.equal(resolveAccess(rules, '/blog/').access, 'blocked');
  });

  test('Disallow: /private/ does NOT block /public/', () => {
    const rules = [{ type: 'Disallow', path: '/private/' }];
    assert.equal(resolveAccess(rules, '/public/page').access, 'unspecified');
    assert.equal(resolveAccess(rules, '/private/secret').access, 'blocked');
  });

  test('wildcard blocking: Disallow: /api/* blocks /api/v1/users', () => {
    const rules = [{ type: 'Disallow', path: '/api/*' }];
    assert.equal(resolveAccess(rules, '/api/v1/users').access, 'blocked');
    assert.equal(resolveAccess(rules, '/apiv2/').access, 'unspecified');
  });

  test('end anchor: Disallow: /*.pdf$ blocks .pdf but not /pdf-guide', () => {
    const rules = [{ type: 'Disallow', path: '/*.pdf$' }];
    assert.equal(resolveAccess(rules, '/docs/report.pdf').access, 'blocked');
    assert.equal(resolveAccess(rules, '/pdf-guide').access, 'unspecified');
  });

  test('Allow overrides Disallow with longer match (most specific wins)', () => {
    const rules = [
      { type: 'Disallow', path: '/' },
      { type: 'Allow',    path: '/public/' },
    ];
    assert.equal(resolveAccess(rules, '/public/page').access, 'allowed');
    assert.equal(resolveAccess(rules, '/private/').access, 'blocked');
  });

  test('Allow wins over Disallow on same-length match (tie-break)', () => {
    const rules = [
      { type: 'Disallow', path: '/page' },
      { type: 'Allow',    path: '/page' },
    ];
    assert.equal(resolveAccess(rules, '/page').access, 'allowed');
  });

  test('empty Disallow path is skipped (not a restriction)', () => {
    const rules = [{ type: 'Disallow', path: '' }];
    assert.equal(resolveAccess(rules, '/blog/').access, 'unspecified');
  });
});

// ── getEffectiveRules ─────────────────────────────────────────────────────────

describe('getEffectiveRules', () => {
  test('specific agent rules take precedence over wildcard', () => {
    const raw = `
User-agent: *
Disallow: /

User-agent: GPTBot
Allow: /
    `.trim();
    const agents = parseRobotsTxt(raw);
    const rules = getEffectiveRules(agents, 'GPTBot');
    // Should use GPTBot-specific rules, not wildcard
    assert.equal(rules.length, 1);
    assert.equal(rules[0].type, 'Allow');
  });

  test('wildcard rules used when no specific agent match', () => {
    const raw = `
User-agent: *
Disallow: /private/
    `.trim();
    const agents = parseRobotsTxt(raw);
    const rules = getEffectiveRules(agents, 'UnknownBot');
    assert.equal(rules.length, 1);
    assert.equal(rules[0].type, 'Disallow');
    assert.equal(rules[0].path, '/private/');
  });

  test('agent with no rules → empty array', () => {
    const agents = parseRobotsTxt('User-agent: Googlebot\nAllow: /\n');
    const rules = getEffectiveRules(agents, 'GPTBot');
    assert.equal(rules.length, 0);
  });
});

// ── parseRobotsTxt ────────────────────────────────────────────────────────────

describe('parseRobotsTxt', () => {
  test('inline comments are stripped', () => {
    const raw = 'User-agent: GPTBot # LLM bot\nDisallow: / # block all\n';
    const agents = parseRobotsTxt(raw);
    const rules = agents.get('gptbot') || [];
    assert.equal(rules.length, 1);
    assert.equal(rules[0].path, '/');
  });

  test('case-insensitive agent names', () => {
    const raw = 'User-agent: GPTBOT\nDisallow: /\n';
    const agents = parseRobotsTxt(raw);
    assert.ok(agents.has('gptbot'));
  });

  test('blank lines reset agent context', () => {
    const raw = `
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Allow: /
    `.trim();
    const agents = parseRobotsTxt(raw);
    const gptRules    = agents.get('gptbot')    || [];
    const claudeRules = agents.get('claudebot') || [];
    assert.equal(gptRules.length, 1);
    assert.equal(gptRules[0].type, 'Disallow');
    assert.equal(claudeRules.length, 1);
    assert.equal(claudeRules[0].type, 'Allow');
  });

  test('multiple agents share rules', () => {
    const raw = `
User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /private/
    `.trim();
    const agents = parseRobotsTxt(raw);
    assert.equal(agents.get('gptbot')?.[0].path,    '/private/');
    assert.equal(agents.get('claudebot')?.[0].path, '/private/');
  });
});
