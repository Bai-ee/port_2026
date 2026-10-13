import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRedirectPath } from '../../../lib/safe-redirect.js';

test('/login?redirect= only accepts same-origin relative paths', () => {
  for (const ok of ['/dashboard', '/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb', '/a/b?c=d#e', '/']) assert.equal(safeRedirectPath(ok), ok, ok);
  for (const bad of ['//evil.test', '//evil.test/path', '/\\evil.test', '/\\/evil.test', 'https://evil.test', 'http://evil.test/x', 'javascript:alert(1)', 'evil.test', '', '   ', '/a\nb', '/a\\b', '/\u0000x', null, undefined, 42, {}]) {
    assert.equal(safeRedirectPath(bad), '/dashboard', JSON.stringify(bad));
  }
  assert.equal(safeRedirectPath('//evil.test', '/home'), '/home');
  assert.equal(safeRedirectPath('  /dashboard/studio  '), '/dashboard/studio');
});
