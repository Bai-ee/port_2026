'use strict';

// site-clone-publish.cjs — Phase 3 delivery: upload the recreated site's zip
// to Storage (client-scoped, matches repo convention) and deploy the loose
// files to Vercel as a live preview. Modeled on vercel-briefs.cjs's deployment
// flow, but as its own sibling module — vercel-briefs.cjs's single-HTML brief
// deploy path stays untouched (see plan "Keep vs change").

const fs = require('fs/promises');
const path = require('path');
const { createHash } = require('crypto');
const { saveBufferArtifact } = require('./storage-artifacts.cjs');

const VERCEL_API_BASE = 'https://api.vercel.com';
const SKIP_FILES = new Set(['serve.mjs', 'README.md']); // offline-run helpers, not part of the live deploy

function getVercelConfig() {
  const token = String(process.env.VERCEL_AUTH_TOKEN || process.env.VERCEL_API_TOKEN || '').trim();
  if (!token) return { enabled: false, reason: 'VERCEL_AUTH_TOKEN / VERCEL_API_TOKEN is not configured.' };
  return {
    enabled: true,
    token,
    teamId: String(process.env.VERCEL_TEAM_ID || '').trim() || null,
    teamSlug: String(process.env.VERCEL_TEAM_SLUG || '').trim() || null,
  };
}

function queryForTeam(config) {
  const params = new URLSearchParams();
  if (config.teamId) params.set('teamId', config.teamId);
  else if (config.teamSlug) params.set('slug', config.teamSlug);
  return params.toString();
}

function withTeamQuery(config, p) {
  const q = queryForTeam(config);
  return q ? `${p}${p.includes('?') ? '&' : '?'}${q}` : p;
}

async function vercelFetch(config, p, options = {}) {
  const response = await fetch(`${VERCEL_API_BASE}${withTeamQuery(config, p)}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.token}`, ...(options.headers || {}) },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');
  if (!response.ok) {
    const apiError = typeof payload === 'object' ? payload?.error : null;
    const message = typeof payload === 'string'
      ? payload.slice(0, 500)
      : apiError?.message || JSON.stringify(payload).slice(0, 500);
    const error = new Error(`Vercel API ${response.status}: ${message || response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function absoluteVercelUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function pickDeploymentUrl(deploy) {
  const aliases = Array.isArray(deploy?.alias) ? deploy.alias : [];
  return absoluteVercelUrl(aliases[0] || deploy?.url || '');
}

/** hitloop-clone-<client-job seed>-<hash>, same convention as vercel-briefs.cjs. */
function siteCloneProjectName({ clientId, jobId }) {
  const seed = `${clientId || 'client'}-${jobId || 'clone'}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const digest = createHash('sha1').update(seed || 'site-clone').digest('hex').slice(0, 8);
  return `hitloop-clone-${(seed || 'site-clone').slice(0, 30)}-${digest}`
    .replace(/-+/g, '-')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

async function collectSiteFiles(siteDir) {
  const files = [];
  async function walk(dir, prefix) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!prefix && SKIP_FILES.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(abs, rel);
      } else {
        files.push({ file: rel, abs });
      }
    }
  }
  await walk(siteDir, '');
  return files;
}

/**
 * Vercel's deployment-creation endpoint caps inline `data` at a 10MB total
 * request body — a full clone (~200+ files, ~24MB) blows past that. Upload
 * each file individually to the content-addressable /v2/files endpoint
 * (raw bytes + an x-vercel-digest SHA1 header) and reference it in the
 * deployment by {file, sha, size} instead of inlining its bytes.
 */
async function uploadFile(config, { abs }) {
  const buffer = await fs.readFile(abs);
  const sha = createHash('sha1').update(buffer).digest('hex');
  await vercelFetch(config, '/v2/files', {
    method: 'POST',
    headers: { 'Content-Length': String(buffer.length), 'x-vercel-digest': sha },
    body: buffer,
  });
  return { sha, size: buffer.length };
}

async function uploadSiteFiles(config, siteFiles) {
  const deployFiles = [];
  for (const { file, abs } of siteFiles) {
    // eslint-disable-next-line no-await-in-loop
    const { sha, size } = await uploadFile(config, { abs });
    deployFiles.push({ file, sha, size });
  }
  return deployFiles;
}

async function createDeployment(config, { projectName, files }) {
  return vercelFetch(config, '/v13/deployments?skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      project: projectName,
      target: 'production',
      projectSettings: { framework: null, buildCommand: null, devCommand: null, installCommand: null, outputDirectory: null },
      files,
      meta: { hitloopSource: 'site-clone' },
    }),
  });
}

async function getDeployment(config, idOrUrl) {
  return vercelFetch(config, `/v13/deployments/${encodeURIComponent(idOrUrl)}`);
}

async function pollDeployment(config, deployment) {
  const id = deployment?.id || deployment?.uid || deployment?.url;
  if (!id) return deployment;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const current = await getDeployment(config, id);
    const state = String(current.readyState || current.state || '').toUpperCase();
    if (['READY', 'ERROR', 'CANCELED'].includes(state)) return current;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return getDeployment(config, id);
}

/**
 * Publish a completed clone run: zip -> Storage (always), site/ -> Vercel
 * preview (best-effort — a Vercel failure still returns the zip result so the
 * job completes with a downloadable zip and no preview rather than failing
 * outright).
 *
 * @param {object} args
 * @param {string} args.clientId
 * @param {string} args.jobId
 * @param {string} args.siteDir   local directory of the recreated site (loose files)
 * @param {string} args.zipPath   local path to the already-built zip
 * @param {(line:string)=>void} [args.log]
 */
async function publishSiteClone({ clientId, jobId, siteDir, zipPath, log = () => {} }) {
  const zipBuffer = await fs.readFile(zipPath);
  const storagePath = `clients/${clientId}/site-clone/${jobId}/site.zip`;
  const zip = await saveBufferArtifact({
    storagePath,
    buffer: zipBuffer,
    contentType: 'application/zip',
    metadata: { jobId, clientId },
  });
  log(`publishSiteClone: zip uploaded to Storage (${zip.sizeBytes}b)`);

  let preview = null;
  const config = getVercelConfig();
  if (!config.enabled) {
    log(`publishSiteClone: skipping Vercel preview — ${config.reason}`);
  } else {
    try {
      const siteFiles = await collectSiteFiles(siteDir);
      const deployFiles = await uploadSiteFiles(config, siteFiles);
      const projectName = siteCloneProjectName({ clientId, jobId });
      const deploy = await createDeployment(config, { projectName, files: deployFiles });
      const finalDeploy = await pollDeployment(config, deploy).catch(() => deploy);
      const readyState = String(finalDeploy?.readyState || finalDeploy?.state || '').toUpperCase();
      if (['ERROR', 'CANCELED'].includes(readyState)) {
        throw new Error(finalDeploy?.errorMessage || finalDeploy?.error?.message || `Vercel deployment ${readyState.toLowerCase()}.`);
      }
      preview = {
        vercelUrl: pickDeploymentUrl(finalDeploy || deploy),
        deploymentId: finalDeploy?.id || deploy?.id || null,
        projectName,
      };
      log(`publishSiteClone: Vercel preview ready at ${preview.vercelUrl}`);
    } catch (err) {
      log(`publishSiteClone: Vercel preview failed (${err.message}) — zip is still available`);
      preview = null;
    }
  }

  return {
    zip: { storagePath: zip.storagePath, downloadUrl: zip.downloadUrl, bytes: zip.sizeBytes },
    preview,
  };
}

module.exports = { publishSiteClone, getVercelConfig, siteCloneProjectName };
