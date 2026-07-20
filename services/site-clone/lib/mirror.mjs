// mirror.mjs — A2: mirror every asset reference (link/script/img/source/
// video/audio + inline style url() + <style> blocks, recursing into CSS
// url()/@import) from an allowlist of hosts, save under
// assets/<host>/<path>, and rewrite the page markup to local relative paths.
// Non-allowlisted hosts (social widgets, maps, analytics not worth mirroring)
// are left intact as absolute URLs, same as the manual runbook.
//
// Downloads run sequentially, one asset at a time — deliberately gentle on
// the target site rather than hammering it with concurrent requests.

import { load } from 'cheerio';
import path from 'path';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { fetchAsset } from './http.mjs';
import { resolveAssetHosts, hostAllowed } from './profile.mjs';

const ASSET_TAG_ATTRS = [
  ['link', 'href'],
  ['script', 'src'],
  ['img', 'src'],
  ['source', 'src'],
  ['video', 'src'],
  ['video', 'poster'],
  ['audio', 'src'],
];
const SRCSET_SELECTORS = ['img[srcset]', 'source[srcset]'];

function normalizeUrl(raw, baseUrl) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s || /^(data:|#|mailto:|tel:|javascript:)/i.test(s)) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  try {
    return new URL(s, baseUrl).toString();
  } catch {
    return null;
  }
}

/** query-hash filenames so `?v=` variants don't collide (A2). */
function localAssetPath(absUrl) {
  const u = new URL(absUrl);
  let p = u.pathname.replace(/^\//, '');
  if (!p) p = 'index';
  if (u.search) {
    const hash = createHash('sha1').update(u.search).digest('hex').slice(0, 8);
    const ext = path.extname(p);
    const base = ext ? p.slice(0, -ext.length) : p;
    p = `${base}.${hash}${ext}`;
  }
  return path.posix.join('assets', u.hostname, p);
}

function parseCssUrls(cssText) {
  const found = [];
  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let m;
  while ((m = urlRe.exec(cssText))) found.push(m[2]);
  const importRe = /@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)['"]?\s*\)?/g;
  while ((m = importRe.exec(cssText))) found.push(m[1]);
  return found;
}

/**
 * @param {object} args
 * @param {string} args.outDir
 * @param {Array<{path:string, html:string, status:number}>} args.pages
 * @param {string} args.origin
 * @param {object} args.profile
 * @param {number} [args.maxTotalBytes]
 * @param {number} [args.maxAssetBytes]
 * @param {(line:string)=>void} [args.log]
 */
export async function mirrorAssets({
  outDir, pages, origin, profile,
  maxTotalBytes = 150 * 1024 * 1024,
  maxAssetBytes = 25 * 1024 * 1024,
  log = () => {},
}) {
  const resolvedHosts = resolveAssetHosts(profile.assetHosts, new URL(origin).hostname);
  const assetMap = new Map(); // absUrl -> entry
  let totalBytes = 0;

  async function downloadOnce(absUrl) {
    if (assetMap.has(absUrl)) return assetMap.get(absUrl);
    const host = new URL(absUrl).hostname;
    if (!hostAllowed(host, resolvedHosts)) {
      const entry = { ok: false, reason: 'host-not-allowed' };
      assetMap.set(absUrl, entry);
      return entry;
    }

    try {
      const { buffer, status, contentType } = await fetchAsset(absUrl, { maxBytes: maxAssetBytes });
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
      if (totalBytes + buffer.length > maxTotalBytes) {
        throw new Error(`total asset budget exceeded (${maxTotalBytes} bytes)`);
      }

      const localPath = localAssetPath(absUrl);
      const fullPath = path.join(outDir, localPath);
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, buffer);
      totalBytes += buffer.length;

      const entry = { ok: true, localPath, bytes: buffer.length, contentType, absUrl };
      assetMap.set(absUrl, entry);
      log(`mirrorAssets: ${localPath} (${buffer.length}b)`);

      if (/text\/css/.test(contentType) || /\.css$/i.test(absUrl)) {
        const cssText = buffer.toString('utf8');
        let rewritten = cssText;
        for (const raw of parseCssUrls(cssText)) {
          const childAbs = normalizeUrl(raw, absUrl);
          if (!childAbs) continue;
          const child = await downloadOnce(childAbs);
          if (child.ok) {
            const rel = path.posix.relative(path.dirname(localPath), child.localPath);
            rewritten = rewritten.split(raw).join(rel);
          }
        }
        if (rewritten !== cssText) await writeFile(fullPath, rewritten, 'utf8');
      }

      return entry;
    } catch (err) {
      const entry = { ok: false, reason: err.message };
      assetMap.set(absUrl, entry);
      return entry;
    }
  }

  const rewrittenPages = [];
  for (const pg of pages) {
    const $ = load(pg.html);
    const pageUrl = origin + pg.path;

    for (const [tag, attr] of ASSET_TAG_ATTRS) {
      for (const el of $(tag).toArray()) {
        const abs = normalizeUrl($(el).attr(attr), pageUrl);
        if (!abs) continue;
        const entry = await downloadOnce(abs);
        if (entry.ok) $(el).attr(attr, entry.localPath);
      }
    }

    for (const sel of SRCSET_SELECTORS) {
      for (const el of $(sel).toArray()) {
        const raw = $(el).attr('srcset');
        if (!raw) continue;
        const rewritten = [];
        for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
          const [urlPart, descriptor] = part.split(/\s+/, 2);
          const abs = normalizeUrl(urlPart, pageUrl);
          if (!abs) { rewritten.push(part); continue; }
          const entry = await downloadOnce(abs);
          rewritten.push(entry.ok ? [entry.localPath, descriptor].filter(Boolean).join(' ') : part);
        }
        $(el).attr('srcset', rewritten.join(', '));
      }
    }

    for (const el of $('style').toArray()) {
      const cssText = $(el).html() || '';
      let rewritten = cssText;
      for (const raw of parseCssUrls(cssText)) {
        const abs = normalizeUrl(raw, pageUrl);
        if (!abs) continue;
        const entry = await downloadOnce(abs);
        if (entry.ok) rewritten = rewritten.split(raw).join(entry.localPath);
      }
      if (rewritten !== cssText) $(el).html(rewritten);
    }

    for (const el of $('[style*="url("]').toArray()) {
      const styleAttr = $(el).attr('style') || '';
      let rewritten = styleAttr;
      for (const raw of parseCssUrls(styleAttr)) {
        const abs = normalizeUrl(raw, pageUrl);
        if (!abs) continue;
        const entry = await downloadOnce(abs);
        if (entry.ok) rewritten = rewritten.split(raw).join(entry.localPath);
      }
      if (rewritten !== styleAttr) $(el).attr('style', rewritten);
    }

    rewrittenPages.push({ ...pg, html: $.html() });
  }

  const assets = [...assetMap.entries()]
    .filter(([, v]) => v.ok)
    .map(([absUrl, v]) => ({ url: absUrl, localPath: v.localPath, bytes: v.bytes, contentType: v.contentType }));

  return { pages: rewrittenPages, assets, totalBytes };
}
