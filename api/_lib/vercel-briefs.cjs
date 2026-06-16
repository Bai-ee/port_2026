'use strict';

const { createHash } = require('crypto');

const VERCEL_API_BASE = 'https://api.vercel.com';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getVercelConfig() {
  const token = String(process.env.VERCEL_AUTH_TOKEN || process.env.VERCEL_API_TOKEN || '').trim();
  if (!token) {
    return {
      enabled: false,
      reason: 'VERCEL_AUTH_TOKEN / VERCEL_API_TOKEN is not configured.',
    };
  }

  return {
    enabled: true,
    token,
    teamId: String(process.env.VERCEL_TEAM_ID || '').trim() || null,
    teamSlug: String(process.env.VERCEL_TEAM_SLUG || '').trim() || null,
  };
}

function vercelProjectName({ clientSlug, briefSlug, title }) {
  const seed = `${clientSlug || 'client'}-${briefSlug || title || 'brief'}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const digest = createHash('sha1').update(seed || 'custom-brief').digest('hex').slice(0, 8);
  return `hitloop-${(seed || 'custom-brief').slice(0, 38)}-${digest}`
    .replace(/-+/g, '-')
    .slice(0, 63)
    .replace(/-+$/g, '');
}

function queryForTeam(config) {
  const params = new URLSearchParams();
  if (config.teamId) params.set('teamId', config.teamId);
  else if (config.teamSlug) params.set('slug', config.teamSlug);
  return params.toString();
}

function withTeamQuery(config, path) {
  const teamQuery = queryForTeam(config);
  if (!teamQuery) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${teamQuery}`;
}

async function vercelFetch(config, path, options = {}) {
  const response = await fetch(`${VERCEL_API_BASE}${withTeamQuery(config, path)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      ...(options.headers || {}),
    },
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    const apiError = typeof payload === 'object' ? payload?.error : null;
    const message = typeof payload === 'string'
      ? payload.slice(0, 500)
      : apiError?.message || payload?.message || JSON.stringify(payload).slice(0, 500);
    const error = new Error(`Vercel API ${response.status}: ${message || response.statusText}`);
    error.status = response.status;
    error.payload = payload;
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

function managedHeadTags(meta = {}) {
  const title = meta.title || 'Custom Brief';
  const description = meta.description || 'Custom brief.';
  const imageUrl = meta.imageUrl || '';
  const imageAlt = meta.imageAlt || `${title} preview image`;
  const publicUrl = meta.publicUrl || '';
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    publicUrl ? `<link rel="canonical" href="${esc(publicUrl)}">` : '',
    `<meta property="og:type" content="article">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    publicUrl ? `<meta property="og:url" content="${esc(publicUrl)}">` : '',
    imageUrl ? `<meta property="og:image" content="${esc(imageUrl)}">` : '',
    imageUrl ? `<meta property="og:image:secure_url" content="${esc(imageUrl)}">` : '',
    imageUrl ? `<meta property="og:image:width" content="1200">` : '',
    imageUrl ? `<meta property="og:image:height" content="630">` : '',
    imageUrl ? `<meta property="og:image:alt" content="${esc(imageAlt)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    imageUrl ? `<meta name="twitter:image" content="${esc(imageUrl)}">` : '',
    imageUrl ? `<meta name="twitter:image:alt" content="${esc(imageAlt)}">` : '',
  ].filter(Boolean).join('\n');
}

function stripManagedMetadata(html) {
  return String(html || '')
    .replace(/<title[\s\S]*?<\/title>/i, '')
    .replace(/<link\s+[^>]*rel\s*=\s*["']canonical["'][^>]*>/gi, '')
    .replace(/<meta\s+[^>]*(?:name|property)\s*=\s*["'](?:description|og:title|og:description|og:url|og:type|og:image|og:image:secure_url|og:image:width|og:image:height|og:image:alt|twitter:card|twitter:title|twitter:description|twitter:image|twitter:image:alt)["'][^>]*>/gi, '');
}

function injectOpenGraphMetadata(html, meta) {
  const tags = managedHeadTags(meta);
  const body = stripManagedMetadata(html);
  if (/<head[^>]*>/i.test(body)) {
    return body.replace(/<head([^>]*)>/i, `<head$1>\n${tags}\n`);
  }
  if (/<html[^>]*>/i.test(body)) {
    return body.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${tags}\n</head>\n`);
  }
  return `<!doctype html><html><head>${tags}</head><body>${body}</body></html>`;
}

async function createDeployment(config, { projectName, title, html, meta }) {
  return vercelFetch(config, '/v13/deployments?skipAutoDetectionConfirmation=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      project: projectName,
      target: 'production',
      projectSettings: {
        framework: null,
        buildCommand: null,
        devCommand: null,
        installCommand: null,
        outputDirectory: null,
      },
      files: [
        { file: 'index.html', data: html },
        {
          file: 'vercel.json',
          data: JSON.stringify({
            cleanUrls: true,
            trailingSlash: false,
            headers: [
              {
                source: '/(.*)',
                headers: [
                  { key: 'Cache-Control', value: 'public, max-age=60' },
                ],
              },
            ],
          }),
        },
      ],
      meta: {
        hitloopSource: 'custom-brief',
        title: title || projectName,
        ...(meta || {}),
      },
    }),
  });
}

async function getDeployment(config, idOrUrl) {
  return vercelFetch(config, `/v13/deployments/${encodeURIComponent(idOrUrl)}`);
}

async function pollDeployment(config, deployment) {
  const id = deployment?.id || deployment?.uid || deployment?.url;
  if (!id) return deployment;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const current = await getDeployment(config, id);
    const state = String(current.readyState || current.state || '').toUpperCase();
    if (['READY', 'ERROR', 'CANCELED'].includes(state)) return current;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return getDeployment(config, id);
}

function projectNameFromVercelUrl(value) {
  try {
    const host = new URL(absoluteVercelUrl(value)).hostname;
    if (!host.endsWith('.vercel.app')) return '';
    return host.slice(0, -'.vercel.app'.length);
  } catch {
    return '';
  }
}

async function deleteProject(config, projectName) {
  return vercelFetch(config, `/v9/projects/${encodeURIComponent(projectName)}`, {
    method: 'DELETE',
  });
}

async function deleteCustomBriefFromVercel({ projectName, deploymentId, url }) {
  const resolvedProjectName = String(projectName || '').trim() || projectNameFromVercelUrl(url);
  if (!resolvedProjectName && !deploymentId && !url) {
    return {
      ok: true,
      skipped: true,
      reason: 'No Vercel deployment is linked to this brief.',
    };
  }
  if (!resolvedProjectName) {
    return {
      ok: false,
      skipped: true,
      reason: 'The linked Vercel deployment does not include a project name.',
    };
  }

  const config = getVercelConfig();
  if (!config.enabled) {
    const error = new Error(config.reason);
    error.status = 400;
    throw error;
  }

  try {
    const result = await deleteProject(config, resolvedProjectName);
    return {
      ok: true,
      skipped: false,
      projectName: resolvedProjectName,
      result,
    };
  } catch (error) {
    if (Number(error?.status) === 404) {
      return {
        ok: true,
        skipped: false,
        alreadyDeleted: true,
        projectName: resolvedProjectName,
      };
    }
    throw error;
  }
}

async function launchCustomBriefToVercel({
  clientSlug,
  briefSlug,
  title,
  description,
  publicUrl,
  imageUrl,
  imageAlt,
  html,
}) {
  const config = getVercelConfig();
  if (!config.enabled) {
    const error = new Error(config.reason);
    error.status = 400;
    throw error;
  }

  const projectName = vercelProjectName({ clientSlug, briefSlug, title });
  const htmlWithMeta = injectOpenGraphMetadata(html, {
    title,
    description,
    publicUrl,
    imageUrl,
    imageAlt,
  });
  const deploy = await createDeployment(config, {
    projectName,
    title,
    html: htmlWithMeta,
    meta: {
      clientSlug: clientSlug || '',
      briefSlug: briefSlug || '',
    },
  });
  const finalDeploy = await pollDeployment(config, deploy).catch(() => deploy);
  const readyState = String(finalDeploy?.readyState || finalDeploy?.state || deploy.readyState || '').toUpperCase();

  if (['ERROR', 'CANCELED'].includes(readyState)) {
    const error = new Error(finalDeploy?.errorMessage || finalDeploy?.error?.message || `Vercel deployment ${readyState.toLowerCase()}.`);
    error.status = 502;
    error.payload = finalDeploy;
    throw error;
  }

  return {
    projectName,
    deployment: finalDeploy || deploy,
    url: pickDeploymentUrl(finalDeploy || deploy),
    inspectorUrl: finalDeploy?.inspectorUrl || deploy.inspectorUrl || '',
  };
}

module.exports = {
  deleteCustomBriefFromVercel,
  getVercelConfig,
  launchCustomBriefToVercel,
};
