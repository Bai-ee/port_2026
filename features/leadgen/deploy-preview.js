// Lead Gen — Deploy Preview
// Deploys a client folder (index.html + gsap-kit.js + assets) to Vercel as a
// static preview and returns the public URL. Requires: VERCEL_API_TOKEN.

import { readFileSync, existsSync } from 'fs';
import { readdir }                   from 'fs/promises';
import path                          from 'path';
import { clientRoot, subdir as clientSubdir } from './client-folder.js';

const VERCEL_API   = 'https://api.vercel.com';
const DEPLOY_TIMEOUT = 120_000; // 2 min wait for deployment to become ready

// ─── FILE COLLECTION ──────────────────────────────────────────────────────────

async function collectFiles(dir, baseDir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath  = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      // Skip pipeline metadata subdirs (01-onboarding, 02-scraped, …) — they
      // hold review artifacts only, never deploy bundle contents.
      if (/^\d{2}-/.test(entry.name)) continue;
      const nested = await collectFiles(fullPath, baseDir);
      files.push(...nested);
    } else {
      // Skip draft/debug files
      if (/\.(md|txt|json)$/.test(entry.name) && entry.name !== 'gsap-kit.js') continue;
      files.push({ relPath, fullPath });
    }
  }
  return files;
}

function mimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.gif':  'image/gif',
    '.ico':  'image/x-icon',
  };
  return map[ext] || 'application/octet-stream';
}

// ─── DEPLOYMENT ───────────────────────────────────────────────────────────────

export async function deployPreview(slug) {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) throw new Error('VERCEL_API_TOKEN not set');

  const slugDir = clientRoot(slug);
  if (!existsSync(slugDir)) throw new Error(`Client dir not found: ${slugDir}`);

  const rawFiles = await collectFiles(slugDir, slugDir);

  // Always include index.html and gsap-kit.js; include assets/
  const deployFiles = rawFiles.filter(({ relPath }) =>
    relPath === 'index.html' ||
    relPath === 'gsap-kit.js' ||
    relPath.startsWith('assets/')
  );

  if (!deployFiles.find(f => f.relPath === 'index.html')) {
    throw new Error(`index.html not found in ${slugDir}`);
  }

  const files = deployFiles.map(({ relPath, fullPath }) => ({
    file:     relPath,
    data:     readFileSync(fullPath).toString('base64'),
    encoding: 'base64',
  }));

  const projectName = `leadgen-preview-${slug}`.slice(0, 52); // Vercel name limit
  const teamId      = process.env.VERCEL_TEAM_ID || undefined;

  const body = {
    name: projectName,
    files,
    target: 'preview',
    projectSettings: { framework: null, devCommand: null, buildCommand: null, outputDirectory: '.' },
  };

  const url = `${VERCEL_API}/v13/deployments${teamId ? `?teamId=${teamId}` : ''}`;

  const res  = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Vercel deploy failed (${res.status}): ${JSON.stringify(data).slice(0, 400)}`);
  }

  const previewUrl = `https://${data.url}`;
  const deployId   = data.id;

  // Wait for deployment to become ready (poll up to DEPLOY_TIMEOUT)
  const readyUrl = await waitForReady(deployId, token, teamId, DEPLOY_TIMEOUT);

  // Write preview-meta.json
  const meta = {
    previewUrl: readyUrl || previewUrl,
    deployId,
    slug,
    deployedAt: new Date().toISOString(),
    fileCount: files.length,
  };

  const { writeFileSync, mkdirSync } = await import('fs');
  const deployDir = clientSubdir(slug, 'deploy');
  mkdirSync(deployDir, { recursive: true });
  writeFileSync(path.join(deployDir, 'preview-meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  return meta;
}

async function waitForReady(deployId, token, teamId, timeoutMs) {
  const start    = Date.now();
  const pollUrl  = `${VERCEL_API}/v13/deployments/${deployId}${teamId ? `?teamId=${teamId}` : ''}`;
  const interval = 3000; // poll every 3s

  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, interval));
    try {
      const res  = await fetch(pollUrl, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.readyState === 'READY' || data.state === 'READY') {
        return `https://${data.url}`;
      }
      if (data.readyState === 'ERROR' || data.state === 'ERROR') {
        throw new Error(`Vercel deployment errored: ${data.errorCode || 'unknown'}`);
      }
    } catch (err) {
      if (err.message.startsWith('Vercel deployment errored')) throw err;
      // Network hiccup — keep polling
    }
  }

  // Timeout reached — return the URL anyway; Vercel may still be processing
  console.warn(`[deploy-preview] Timeout waiting for deploy ${deployId} — returning URL anyway`);
  return null;
}
