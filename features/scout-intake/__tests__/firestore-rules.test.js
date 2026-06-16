'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rulesPath = path.join(__dirname, '../../../firestore.rules');

describe('firestore.rules tenant isolation guardrails', () => {
  test('users docs are not broadly self-writable', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    assert.equal(
      rules.includes('allow read, write: if request.auth != null && request.auth.uid == userId'),
      false
    );
    assert.match(rules, /allow create: if validOwnUserProfile\(userId\)/);
    assert.match(rules, /allow update: if validOwnUserProfile\(userId\)/);
  });

  test('clientId and role remain server-owned on user profile updates', () => {
    const rules = fs.readFileSync(rulesPath, 'utf8');
    assert.match(rules, /request\.resource\.data\.clientId == resource\.data\.clientId/);
    assert.match(rules, /request\.resource\.data\.role == resource\.data\.role/);

    const safeKeysBlock = rules.match(/function safeUserWritableKeys\(\) \{[\s\S]*?\n    \}/)?.[0] || '';
    assert.equal(safeKeysBlock.includes("'clientId'"), false);
    assert.equal(safeKeysBlock.includes("'role'"), false);
  });
});
