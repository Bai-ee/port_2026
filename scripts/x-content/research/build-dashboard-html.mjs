#!/usr/bin/env node
/**
 * Render docs/audits/x-dashboard.html from the template + its three JSON
 * payloads.
 *
 * The artifact used to be assembled by hand, which meant the template and the
 * page could drift apart silently. This makes the template the source and the
 * page the output.
 *
 * Payload sources, in order of preference:
 *   #payload  docs/audits/x-dashboard-data.json  (built by build-dashboard-data.mjs)
 *   #pack     carried forward from the existing page, with `audienceGraph`
 *             refreshed from docs/audits/x-audience-graph.json
 *   #cal      carried forward from the existing page
 *
 * `pack` and `cal` are written copy, not derived data — there is no generator
 * for them, so they are read back out of the current page and re-inlined. Edit
 * them in place in the page, or here, but not in two places at once.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

const TEMPLATE = path.join(REPO_ROOT, 'docs/audits/x-dashboard.template.html');
const OUT = path.join(REPO_ROOT, 'docs/audits/x-dashboard.html');
const DATA = path.join(REPO_ROOT, 'docs/audits/x-dashboard-data.json');
const AUDIENCE = path.join(REPO_ROOT, 'docs/audits/x-audience-graph.json');

/** The template is a fragment; the published page is a document. */
const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>:root{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
`;

function extractJson(html, id) {
  const re = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`);
  const m = re.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (err) {
    throw new Error(`#${id} in the existing page is not valid JSON: ${err.message}`);
  }
}

function main() {
  const template = readFileSync(TEMPLATE, 'utf8');
  const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';

  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const pack = extractJson(previous, 'pack') || {};
  const cal = extractJson(previous, 'cal') || {};

  if (existsSync(AUDIENCE)) {
    pack.audienceGraph = JSON.parse(readFileSync(AUDIENCE, 'utf8'));
  } else {
    console.warn('! x-audience-graph.json missing — the audience section will not render.');
  }

  // The template carries no <head>/<body> tags — it opens with <title>/<style>
  // and runs straight into the masthead. That boundary is the split point.
  const SPLIT = '<header class="masthead">';
  const headEnd = template.indexOf(SPLIT);
  if (headEnd === -1) throw new Error(`template has no ${SPLIT}`);

  const head = template.slice(0, headEnd);
  const body = template.slice(headEnd);

  let out =
    HEAD +
    head.trimStart() +
    '</head>\n<body>\n' +
    body.replace(/^\s*/, '') +
    '\n</body>\n</html>';

  out = out
    .replace('/*__DATA__*/', () => JSON.stringify(data, null, 1))
    .replace('/*__PACK__*/', () => JSON.stringify(pack, null, 1))
    .replace('/*__CAL__*/', () => JSON.stringify(cal, null, 1));

  for (const token of ['/*__DATA__*/', '/*__PACK__*/', '/*__CAL__*/']) {
    if (out.includes(token)) throw new Error(`placeholder ${token} was not filled`);
  }

  writeFileSync(OUT, out, 'utf8');

  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
  console.log(`wrote ${path.relative(REPO_ROOT, OUT)} — ${kb}KB`);
  console.log(
    `  payload: ${data.seb.posts.length + data.baiee.posts.length} posts · ` +
      `pack keys: ${Object.keys(pack).join(', ')} · ` +
      `cal days: ${(cal.days || []).length}`
  );
}

main();
