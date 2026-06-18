#!/usr/bin/env node
// migrate-social-queue-to-firestore.mjs
//
// One-time migration: copies posts from the legacy local file
// data/social-posting-queue.json into the Firestore `social_posts` collection
// (one doc per post, keyed by post.id). Idempotent — re-running overwrites the
// same docs. Safe to run before deleting the JSON file.
//
//   node scripts/migrate-social-queue-to-firestore.mjs        # migrate
//   node scripts/migrate-social-queue-to-firestore.mjs --dry  # preview only
//
// Reads FIREBASE_ADMIN_* credentials from .env.local.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const QUEUE_FILE = path.join(REPO_ROOT, 'data', 'social-posting-queue.json');
const DRY = process.argv.includes('--dry');

// Manual .env.local parse — matches scripts/reset-stuck-run.cjs.
const envPath = path.join(REPO_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseKey(raw) {
  return String(raw || '').replace(/^"|"$/g, '').replace(/\\n/g, '\n');
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: parseKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
    }),
  });
}
const db = getFirestore();

async function main() {
  if (!fs.existsSync(QUEUE_FILE)) {
    console.log(`No queue file at ${QUEUE_FILE} — nothing to migrate.`);
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8') || '{"posts":[]}');
  const posts = Array.isArray(parsed.posts) ? parsed.posts : [];
  const valid = posts.filter((p) => p && p.id && p.clientId);
  const skipped = posts.length - valid.length;

  console.log(`Found ${posts.length} post(s) (${valid.length} valid, ${skipped} skipped${skipped ? ' — missing id/clientId' : ''}).`);
  if (DRY) {
    for (const p of valid) console.log(`  would write social_posts/${p.id}  [${p.status}] client=${p.clientId}`);
    console.log('Dry run — no writes.');
    return;
  }

  let written = 0;
  // Ensure media fields exist so older docs match the current shape.
  for (const p of valid) {
    const doc = {
      mediaUrl: null,
      mediaType: null,
      mediaStoragePath: null,
      mediaContentType: null,
      mediaJobId: null,
      ...p,
    };
    await db.collection('social_posts').doc(p.id).set(doc);
    written += 1;
  }
  console.log(`Migrated ${written} post(s) into social_posts.`);
  console.log('Verify in Firestore, then you can delete data/social-posting-queue.json.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
