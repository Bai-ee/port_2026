import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFilename, finalizeLinks } from '../lib/finalize.mjs';

test('pathToFilename maps root and nested paths to flat local files', () => {
  assert.equal(pathToFilename('/'), 'index.html');
  assert.equal(pathToFilename('/pages/menu-2'), 'pages-menu-2.html');
  assert.equal(pathToFilename('/pages/contact-us'), 'pages-contact-us.html');
});

const PROFILE = { commerceHrefPatterns: ['/cart', '/checkout', '/account', '/challenge'] };
const ORIGIN = 'https://rositas.com';

function page(p, html) { return { path: p, html }; }

test('finalizeLinks rewrites internal links to local files, leaves external links alone', () => {
  const pages = [
    page('/', '<a href="/pages/menu-2">Menu</a><a href="https://instagram.com/rositas">IG</a>'),
    page('/pages/menu-2', '<p>menu</p>'),
  ];
  const { pages: out } = finalizeLinks({ pages, origin: ORIGIN, profile: PROFILE });
  assert.match(out[0].html, /href="pages-menu-2\.html"/);
  assert.match(out[0].html, /href="https:\/\/instagram\.com\/rositas"/);
});

test('finalizeLinks maps an unknown internal path to index.html', () => {
  const pages = [page('/', '<a href="/pages/never-discovered">Ghost</a>')];
  const { pages: out } = finalizeLinks({ pages, origin: ORIGIN, profile: PROFILE });
  assert.match(out[0].html, /href="index\.html"/);
});

test('finalizeLinks neutralizes commerce hrefs with a data-localized marker', () => {
  const pages = [page('/', '<a href="/cart">Cart</a><a href="/account/login">Login</a>')];
  const { pages: out } = finalizeLinks({ pages, origin: ORIGIN, profile: PROFILE });
  assert.match(out[0].html, /<a href="#" data-localized="true">Cart<\/a>/);
  assert.match(out[0].html, /<a href="#" data-localized="true">Login<\/a>/);
});

test('finalizeLinks neutralizes cart/checkout forms and their submit buttons', () => {
  const pages = [page('/', '<form action="/cart/add"><button type="submit">Add</button></form>')];
  const { pages: out } = finalizeLinks({ pages, origin: ORIGIN, profile: PROFILE });
  assert.match(out[0].html, /<form action="#" onsubmit="return false">/);
  assert.match(out[0].html, /<button type="button" onclick="return false">Add<\/button>/);
});

test('finalizeLinks neutralizes button[name=add] regardless of a wrapping form', () => {
  const pages = [page('/', '<button name="add" type="submit">Add to cart</button>')];
  const { pages: out } = finalizeLinks({ pages, origin: ORIGIN, profile: PROFILE });
  assert.match(out[0].html, /type="button" onclick="return false"/);
});
