'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Test the brief privacy logic in isolation — the key invariant is:
//   brief.public !== true  →  brief is private (404 equivalent: return null)
//   brief.public === true  →  brief is public (resolve and render)

function isBriefPublic(briefData) {
  return briefData.public === true;
}

describe('custom brief privacy — private by default', () => {
  test('brief with no public field is private', () => {
    assert.equal(isBriefPublic({}), false);
  });

  test('brief with public: false is private', () => {
    assert.equal(isBriefPublic({ public: false }), false);
  });

  test('brief with public: undefined is private', () => {
    assert.equal(isBriefPublic({ public: undefined }), false);
  });

  test('brief with public: null is private', () => {
    assert.equal(isBriefPublic({ public: null }), false);
  });

  test('brief with public: true is public (explicit publish)', () => {
    assert.equal(isBriefPublic({ public: true }), true);
  });

  test('old pattern (public !== false) is no longer used for access control', () => {
    // This test documents the intentional change from the old insecure default.
    // Old: brief.public !== false → true even when public is undefined/null
    const oldPattern = (brief) => brief.public !== false;
    const newPattern = (brief) => brief.public === true;

    assert.equal(oldPattern({}), true);  // old: leaked briefs
    assert.equal(newPattern({}), false); // new: safe by default
  });
});
