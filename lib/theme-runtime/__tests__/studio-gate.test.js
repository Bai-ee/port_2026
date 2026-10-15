import test from 'node:test';
import assert from 'node:assert/strict';
import { isStudioEnabled, hasStudioQuery } from '../studio-gate.js';
import { createFakeStorage } from './helpers.js';

const session = () => createFakeStorage();

test('production + ?theme-studio=1 => false, and nothing is written', () => {
  const s = session();
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?theme-studio=1', nodeEnv: 'production', sessionStorage: s }), false);
  assert.equal(s.map.size, 0);
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: false, search: '?theme-studio=1', nodeEnv: 'production', sessionStorage: s }), false);
});

test('production: a previously stored dev flag does not enable it', () => {
  const s = createFakeStorage({ 'theme-studio:dev:v1': '1' });
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '', nodeEnv: 'production', sessionStorage: s }), false);
});

test('test env (nodeEnv "test") never honours the query', () => {
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?theme-studio=1', nodeEnv: 'test', sessionStorage: session() }), false);
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?theme-studio=1', nodeEnv: undefined, sessionStorage: session() }), false);
});

test('admin => true in every environment', () => {
  for (const nodeEnv of ['production', 'development', 'test']) {
    assert.equal(isStudioEnabled({ isAdmin: true, adminReady: true, search: '', nodeEnv, sessionStorage: session() }), true);
  }
});

test('admin requires adminReady (still resolving => false)', () => {
  assert.equal(isStudioEnabled({ isAdmin: true, adminReady: false, search: '', nodeEnv: 'production', sessionStorage: session() }), false);
});

test('non-admin => false in production', () => {
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '', nodeEnv: 'production', sessionStorage: session() }), false);
});

test('dev + ?theme-studio=1 => true and remembered for the tab session', () => {
  const s = session();
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?theme-studio=1', nodeEnv: 'development', sessionStorage: s }), true);
  assert.equal(s.map.get('theme-studio:dev:v1'), '1');
  // later navigation without the query still works in the same session
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '', nodeEnv: 'development', sessionStorage: s }), true);
});

test('dev without the query or the stored flag => false for non-admins', () => {
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?other=1', nodeEnv: 'development', sessionStorage: session() }), false);
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?theme-studio=0', nodeEnv: 'development', sessionStorage: session() }), false);
});

test('dev: broken sessionStorage does not throw (query still works for this render)', () => {
  const s = createFakeStorage();
  s.failSet = true; s.failGet = true;
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '?theme-studio=1', nodeEnv: 'development', sessionStorage: s }), true);
  assert.equal(isStudioEnabled({ isAdmin: false, adminReady: true, search: '', nodeEnv: 'development', sessionStorage: s }), false);
});

test('hasStudioQuery parses with or without the leading ?', () => {
  assert.equal(hasStudioQuery('?a=1&theme-studio=1'), true);
  assert.equal(hasStudioQuery('theme-studio=1'), true);
  assert.equal(hasStudioQuery(''), false);
  assert.equal(hasStudioQuery(undefined), false);
});
