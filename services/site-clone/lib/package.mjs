// package.mjs — write the recreated pages + a zero-dependency offline server
// to disk, and zip the result. Split into two steps because verifyStatic
// needs the loose files on disk BEFORE the final zip (which should reflect
// post-compression image bytes) exists.

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SERVE_SCRIPT = `// serve.mjs — zero-dependency static server for the recreated site.
import http from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

server.listen(8000, () => console.log('Serving at http://localhost:8000'));
`;

function buildReadme({ targetUrl, pageCount, assetCount }) {
  return `# Static site recreation

Recreated from: ${targetUrl}
${pageCount} pages, ${assetCount} assets.

## Run offline

\`\`\`
node serve.mjs
\`\`\`

Then open http://localhost:8000
`;
}

/** Write pages + serve.mjs + README.md as loose files under outDir (no zip). */
export async function writeSiteFiles({ outDir, pages, targetUrl, assetCount }) {
  for (const pg of pages) {
    await writeFile(path.join(outDir, pg.file), pg.html, 'utf8');
  }
  await writeFile(path.join(outDir, 'serve.mjs'), SERVE_SCRIPT, 'utf8');
  await writeFile(path.join(outDir, 'README.md'), buildReadme({ targetUrl, pageCount: pages.length, assetCount }), 'utf8');
}

/** Zip an already-written outDir into zipPath (shells out to the system `zip`). */
export async function zipSite({ outDir, zipPath }) {
  await mkdir(path.dirname(zipPath), { recursive: true });
  await execFileAsync('zip', ['-r', '-q', zipPath, '.'], { cwd: outDir });
  return { zipPath };
}
