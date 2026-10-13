import test from 'node:test';
import assert from 'node:assert/strict';

test('next.config: /oauth/* is never frameable (CSP frame-ancestors + X-Frame-Options), other routes untouched', async () => {
  const mod = await import('../../../next.config.mjs');
  const rules = await mod.default.headers();
  const oauth = rules.find((r) => r.source === '/oauth/:path*');
  assert.ok(oauth, 'rule for /oauth/:path* exists');
  const h = Object.fromEntries(oauth.headers.map((x) => [x.key, x.value]));
  assert.equal(h['Content-Security-Policy'], "frame-ancestors 'none'");
  assert.equal(h['X-Frame-Options'], 'DENY');
  for (const r of rules.filter((x) => x.source !== '/oauth/:path*')) {
    assert.ok(!r.headers.some((x) => /frame/i.test(x.key) || /frame-ancestors/.test(x.value)), `${r.source} must not get frame headers`);
  }
});
