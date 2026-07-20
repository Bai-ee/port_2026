#!/usr/bin/env node
// deploy-cms.mjs — Phase 5d automation: host a built CMS project publicly on
// Vercel (HITLOOP's team → free-plan *.vercel.app URL) with its DB on Turso.
//
//   node --env-file=.env.local services/site-clone/deploy-cms.mjs --job <jobId>
//
// Steps (the SSOT §5d recipe, automated):
//   1. Turso Platform API: ensure group `default` (fresh orgs have none;
//      aws-* locations only) → ensure DB → mint DB token.
//   2. Seed the cloud DB from the project dir (env vars beat .env, so the
//      local file-DB setup stays intact).
//   3. Vercel: link project, set production env (DATABASE_URI /
//      DATABASE_AUTH_TOKEN / PAYLOAD_SECRET), deploy --prod.
//   4. Verify site + /admin respond, write job.cms.hostedUrl/hostedAdminUrl.
//
// Requires in env: TURSO_API_TOKEN, TURSO_ORG, VERCEL_AUTH_TOKEN.
// Requires on disk: .out/<jobId>/<project>-cms (build-cms.mjs output).

import path from 'path';
import { readdir, readFile, writeFile } from 'fs/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TURSO_API = 'https://api.turso.tech/v1';
const TURSO_LOCATION = 'aws-us-east-2';

function requireEnv(name) {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`${name} is required in the environment.`);
  return v;
}

async function tursoFetch(pathname, options = {}) {
  const res = await fetch(`${TURSO_API}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${requireEnv('TURSO_API_TOKEN')}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

/** Ensure group + database exist, mint a DB token. 409/exists are fine. */
async function ensureTursoDatabase({ org, dbName, log }) {
  const grp = await tursoFetch(`/organizations/${org}/groups`, {
    method: 'POST',
    body: JSON.stringify({ name: 'default', location: TURSO_LOCATION }),
  });
  if (![200, 409].includes(grp.status) && !String(grp.data?.error || '').includes('already exists')) {
    throw new Error(`Turso group create failed (${grp.status}): ${grp.data?.error || 'unknown'}`);
  }
  const db = await tursoFetch(`/organizations/${org}/databases`, {
    method: 'POST',
    body: JSON.stringify({ name: dbName, group: 'default' }),
  });
  if (![200, 409].includes(db.status) && !String(db.data?.error || '').includes('already exists')) {
    throw new Error(`Turso db create failed (${db.status}): ${db.data?.error || 'unknown'}`);
  }
  const tok = await tursoFetch(`/organizations/${org}/databases/${dbName}/auth/tokens`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!tok.data?.jwt) throw new Error(`Turso token mint failed (${tok.status}).`);
  const info = await tursoFetch(`/organizations/${org}/databases/${dbName}`);
  const host = info.data?.database?.Hostname;
  if (!host) throw new Error('Turso db hostname missing.');
  log(`deployCms: turso db ready — libsql://${host}`);
  return { url: `libsql://${host}`, authToken: tok.data.jwt };
}

function run(cmd, args, { cwd, env = {}, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (b) => { out = (out + b.toString()).slice(-8000); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${label || cmd} exited ${code}: …${out.slice(-500)}`))));
    child.on('error', reject);
  });
}

async function httpStatus(url) {
  try { return (await fetch(url, { redirect: 'manual' })).status; } catch { return 0; }
}

export async function deployCms({ jobId, log = console.log }) {
  const org = requireEnv('TURSO_ORG');
  const vercelToken = requireEnv('VERCEL_AUTH_TOKEN');

  const outDir = path.join(__dirname, '.out', jobId);
  const entries = await readdir(outDir).catch(() => []);
  const projectDirName = entries.find((e) => e.endsWith('-cms'));
  if (!projectDirName) throw new Error(`No <project>-cms dir under .out/${jobId} — run build-cms.mjs first.`);
  const projectDir = path.join(outDir, projectDirName);
  const projectName = projectDirName; // e.g. tony-soccer-cms → vercel project + turso db seed
  const dbName = projectDirName.replace(/-cms$/, '');

  // 1. Turso
  const db = await ensureTursoDatabase({ org, dbName, log });

  // 2. Seed cloud (env override beats the project's .env)
  log('deployCms: seeding cloud DB…');
  await run('npm', ['run', 'seed'], {
    cwd: projectDir,
    env: { DATABASE_URI: db.url, DATABASE_AUTH_TOKEN: db.authToken },
    label: 'cloud seed',
  });

  // 3. Vercel link + env + deploy
  await writeFile(path.join(projectDir, '.vercelignore'), '*.db\n.env\n.env.example\nnode_modules\n.next\n');
  log(`deployCms: linking vercel project ${projectName}…`);
  await run('npx', ['vercel', 'link', '--yes', '--project', projectName, '--token', vercelToken], { cwd: projectDir, label: 'vercel link' });

  const envSecret = (await readFile(path.join(projectDir, '.env'), 'utf8')).match(/^PAYLOAD_SECRET=(.*)$/m)?.[1] || '';
  const envPairs = [
    ['DATABASE_URI', db.url],
    ['DATABASE_AUTH_TOKEN', db.authToken],
    ['PAYLOAD_SECRET', envSecret],
  ];
  for (const [key, value] of envPairs) {
    // `env add` fails if the var exists — remove first (ignore absence).
    await run('bash', ['-c', `npx vercel env rm ${key} production --yes --token '${vercelToken}' >/dev/null 2>&1; printf '%s' '${value.replace(/'/g, `'\\''`)}' | npx vercel env add ${key} production --token '${vercelToken}'`], { cwd: projectDir, label: `env ${key}` });
  }

  log('deployCms: deploying to vercel (build takes a few minutes)…');
  await run('npx', ['vercel', 'deploy', '--prod', '--yes', '--token', vercelToken], { cwd: projectDir, label: 'vercel deploy' });

  // 4. Verify on the stable project alias
  const hostedUrl = `https://${projectName}.vercel.app`;
  let site = 0;
  let admin = 0;
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    site = await httpStatus(hostedUrl);
    admin = await httpStatus(`${hostedUrl}/admin`);
    if (site === 200 && admin === 200) break;
  }
  const ok = site === 200 && admin === 200;
  log(`deployCms: ${hostedUrl} — site ${site}, /admin ${admin} — ${ok ? 'LIVE' : 'NOT VERIFIED'}`);
  if (!ok) throw new Error(`Hosted CMS did not verify (site ${site}, admin ${admin}).`);
  return { hostedUrl, hostedAdminUrl: `${hostedUrl}/admin`, dbName, projectName };
}

// ── CLI ────────────────────────────────────────────────────────────────────
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  (async () => {
    const i = process.argv.indexOf('--job');
    const jobId = i === -1 ? null : process.argv[i + 1];
    if (!jobId) { console.error('Usage: deploy-cms.mjs --job <jobId>'); process.exit(1); }
    const cloneJobs = await import('../../api/_lib/clone-jobs.cjs').then((m) => m.default ?? m);
    const log = (line) => {
      console.log(`[host ${jobId}] ${line}`);
      cloneJobs.appendJobLog(jobId, line).catch(() => {});
    };
    const job = await cloneJobs.getCloneJob(jobId);
    if (!job) throw new Error(`Job ${jobId} not found.`);
    const result = await deployCms({ jobId, log });
    await cloneJobs.updateJobFields(jobId, {
      cms: { ...(job.cms || {}), hostedUrl: result.hostedUrl, hostedAdminUrl: result.hostedAdminUrl },
      hostRequest: null,
    });
    console.log(`Done. Live: ${result.hostedUrl} · Admin: ${result.hostedAdminUrl}`);
    process.exit(0);
  })().catch((err) => { console.error(err); process.exit(1); });
}
