// server.mjs — Phase 4 Cloud Run HTTP wrapper. CPU-only (no GPU, unlike
// studio-render): the Vercel app fires POST /clone (shared-secret gated)
// right after job creation; this service claims the job via clone-jobs.cjs
// (direct Firestore access — this container lives in the same trust boundary
// as the rest of the monorepo, unlike the separate-repo EditVideos bridge) and
// runs the full pipeline within the request lifecycle. Cloud Run supports up
// to a 60-minute request timeout, comfortably enough for an 11-page site.
//
// This intentionally does NOT add `lease`/`complete` HTTP actions to
// app/api/dashboard/site-clone/route.js the way the EditVideos bridge does —
// that pattern exists because EditVideos is a separate repository without
// direct Firestore trust. This worker already shares this monorepo's Firebase
// Admin credentials (same as the CLI in run-clone.mjs), so claim/log/complete
// go straight through clone-jobs.cjs, matching the already-proven Phase 2/3
// code path exactly. Only the *trigger* (this HTTP endpoint) is new.

import { createServer } from 'node:http';
import { runForJob } from './run-clone.mjs';

const PORT = Number(process.env.PORT) || 8080;
const SHARED_SECRET = process.env.SITE_CLONE_SHARED_SECRET || '';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') { json(res, 200, { ok: true }); return; }

  if (req.method !== 'POST' || req.url !== '/clone') {
    json(res, 404, { error: 'Not found' });
    return;
  }

  const provided = req.headers['x-worker-secret'] || '';
  if (!SHARED_SECRET || !timingSafeEqual(String(provided), SHARED_SECRET)) {
    json(res, 401, { error: 'Unauthorized: missing or invalid x-worker-secret.' });
    return;
  }

  let jobId;
  try {
    const body = JSON.parse((await readBody(req)) || '{}');
    jobId = String(body.jobId || '').trim();
  } catch {
    json(res, 400, { error: 'Invalid JSON body.' });
    return;
  }
  if (!jobId) { json(res, 400, { error: 'jobId is required.' }); return; }

  try {
    const result = await runForJob(jobId, {
      log: (line) => console.log(`[site-clone ${jobId}] ${line}`),
    });
    json(res, result.ok ? 200 : 502, result);
  } catch (err) {
    json(res, 500, { ok: false, jobId, reason: err.message });
  }
});

server.listen(PORT, () => console.log(`site-clone worker listening on :${PORT}`));
