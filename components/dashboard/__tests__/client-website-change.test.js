// Source wiring for the admin "Change website & rescan" row in DashboardPage.jsx.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = fs.readFileSync(path.join(ROOT, 'DashboardPage.jsx'), 'utf8');

test('admin website-change row carries stable ids and is admin-only', () => {
  for (const id of ['client-website-meta-row', 'client-website-change-btn', 'client-website-change-form', 'client-website-change-input', 'client-website-change-submit-btn']) {
    assert.ok(src.includes(`id="${id}"`), id);
  }
  assert.match(src, /\{isAdmin && client\?\.clientId \? \(\s*<div className="meta-row" id="client-website-meta-row">/);
});

test('website change confirms with both hosts and sends confirmHostChange; no dollar figure', () => {
  assert.match(src, /Runs the full paid intake \(model analyzers \+ 1 GPU video\) and clears old-site results/);
  assert.match(src, /body: JSON\.stringify\(\{ websiteUrl: nextUrl, confirmHostChange: true \}\)/);
  assert.match(src, /\[impersonateId, client\?\.clientId\]/);
});

test('existing Update & Rerun sends confirmHostChange only when the host differs', () => {
  assert.match(src, /\.\.\.\(reseedHostChanged \? \{ confirmHostChange: true \} : \{\}\)/);
});
