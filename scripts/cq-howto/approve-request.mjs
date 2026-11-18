#!/usr/bin/env node
// Owner-only: approve / mark a CQ-HowTo request in Firestore howto_requests/{id}. NOT callable from MCP or the agent catalog.
//
//   node scripts/cq-howto/approve-request.mjs --id <id> --spec <specs/<id>.json> [--image-revision <rev>]
//        [--status approved|building|rejected] [--note "..."] [--write]
//
// Default is a DRY RUN (reads the record, prints the computed specHash and the planned write). Only --write updates it.
// Reads FIREBASE_ADMIN_* from .env.local (same pattern as scripts/migrate-social-queue-to-firestore.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { howtoSpecHash } from '../../features/brief-video/howto.js';
import { HOWTO_ID_RE } from '../../features/brief-video/howto-request.js';

const STATUSES = ['approved', 'building', 'rejected'];

export function parseArgs(argv) {
  const out = { write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a.startsWith('--')) out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
  }
  return out;
}

/** Pure: decide what to write. Returns { ok, error } or { ok:true, update, specHash }. */
export function planApproval({ args, spec, current, now = new Date().toISOString() }) {
  const status = args.status || 'approved';
  if (!HOWTO_ID_RE.test(String(args.id || ''))) return { ok: false, error: 'id must match [a-z0-9-]{3,48}' };
  if (!STATUSES.includes(status)) return { ok: false, error: `status must be one of ${STATUSES.join(', ')}` };
  if (!current) return { ok: false, error: `howto_requests/${args.id} does not exist (nothing was submitted)` };
  const update = { status, updatedAt: now };
  let specHash = null;
  if (status === 'approved') {
    if (!spec) return { ok: false, error: 'approved needs --spec <path to specs/<id>.json>' };
    if (spec.mode !== 'final') return { ok: false, error: `spec.mode must be "final" (got ${JSON.stringify(spec.mode)})` };
    if (spec.id !== args.id) return { ok: false, error: `spec.id ${JSON.stringify(spec.id)} does not match --id ${args.id}` };
    specHash = howtoSpecHash(spec);
    Object.assign(update, { specHash, approvedAt: now, approvedBy: 'owner-script' });
    if (args.imageRevision) update.imageRevision = String(args.imageRevision);
  }
  if (args.note) update.note = String(args.note);
  return { ok: true, update, specHash };
}

async function openDb() {
  const { cert, getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const envPath = path.join(root, '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n'),
    }) });
  }
  return getFirestore();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const spec = args.spec ? JSON.parse(fs.readFileSync(path.resolve(args.spec), 'utf8')) : null;
  const db = await openDb();
  const res = await applyApproval({ db, args, spec });
  if (res.current !== undefined) console.log('current record:', res.current ? JSON.stringify({ ...res.current, request: res.current.request ? '[request omitted]' : undefined }, null, 2) : null);
  if (!res.ok) { console.error(`REFUSED: ${res.error}`); process.exit(1); }
  if (res.specHash) console.log('computed specHash:', res.specHash);
  console.log(args.write ? 'WRITTEN:' : 'DRY RUN (add --write to apply). Would write:', JSON.stringify(res.update, null, 2));
}

/** Dry run = plain read. --write = read + checks + update in ONE transaction (re-checks inside). */
export async function applyApproval({ db, args, spec, now }) {
  const ref = db.collection('howto_requests').doc(String(args.id || '_'));
  if (!args.write) {
    const snap = await ref.get();
    const current = snap.exists ? snap.data() : null;
    return { ...planApproval({ args, spec, current, now }), current };
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    const plan = planApproval({ args, spec, current, now });
    if (plan.ok) tx.update(ref, plan.update);
    return { ...plan, current };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
