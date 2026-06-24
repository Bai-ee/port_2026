#!/usr/bin/env node
'use strict';

const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '.env.local'), override: false, quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '..', '.env'), override: false, quiet: true });
} catch {
  // dotenv is a local convenience only. Deployed/CI environments can pass envs directly.
}

const fb = require('../api/_lib/firebase-admin.cjs');

const USAGE = `
Usage:
  node scripts/admin-access.cjs verify <email>
  node scripts/admin-access.cjs grant <email> --yes

Examples:
  node scripts/admin-access.cjs verify bryanballi@gmail.com
  node scripts/admin-access.cjs grant bryanballi@gmail.com --yes
`.trim();

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function summarizeAdminDoc(data) {
  if (!data) return null;
  return {
    email: data.email || null,
    role: data.role || null,
    active: data.active ?? null,
    dashboardCount: Array.isArray(data.adminDashboards) ? data.adminDashboards.length : 0,
    createdAt: data.createdAt && typeof data.createdAt.toDate === 'function'
      ? data.createdAt.toDate().toISOString()
      : null,
    updatedAt: data.updatedAt && typeof data.updatedAt.toDate === 'function'
      ? data.updatedAt.toDate().toISOString()
      : null,
  };
}

async function verify(email) {
  const snap = await fb.adminDb.collection('admins').doc(email).get();
  if (!snap.exists) {
    console.log(JSON.stringify({ ok: true, email, admin: false, doc: null }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    email,
    admin: true,
    doc: summarizeAdminDoc(snap.data() || {}),
  }, null, 2));
}

async function grant(email) {
  const ref = fb.adminDb.collection('admins').doc(email);
  const snap = await ref.get();
  const now = fb.FieldValue.serverTimestamp();
  const existing = snap.exists ? snap.data() || {} : {};

  await ref.set(
    {
      email,
      role: existing.role || 'admin',
      active: existing.active !== false,
      adminDashboards: Array.isArray(existing.adminDashboards) ? existing.adminDashboards : [],
      createdAt: existing.createdAt || now,
      updatedAt: now,
      grantedBy: 'scripts/admin-access.cjs',
    },
    { merge: true }
  );

  console.log(JSON.stringify({ ok: true, email, admin: true, action: snap.exists ? 'updated' : 'created' }, null, 2));
}

async function main() {
  const [action, rawEmail, ...flags] = process.argv.slice(2);
  const email = normalizeEmail(rawEmail);

  if (!['verify', 'grant'].includes(action) || !isValidEmail(email)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  if (action === 'grant' && !flags.includes('--yes')) {
    console.error('Refusing to grant admin access without --yes.');
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  if (action === 'verify') {
    await verify(email);
    return;
  }

  await grant(email);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
