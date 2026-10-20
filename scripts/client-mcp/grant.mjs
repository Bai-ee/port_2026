#!/usr/bin/env node
// Owner tool for client MCP connect links (docs/source-of-truth/CLIENT-MCP-SERVER.md).
//
// A connect link is the credential: whoever adds it to ChatGPT/Claude gets READ-ONLY access to that one client.
// Only SHA-256(secret) is stored; the URL is printed once by `create` and cannot be shown again (create a new one).
// Revoking cuts every connection made with that link off on its next call.
//
// Usage (from a checkout with .env.local pointing at the target Firestore):
//   node scripts/client-mcp/grant.mjs create --client nottherug-ten-QSMYxuuv --label "Not The Rug" [--note "client"]
//   node scripts/client-mcp/grant.mjs list [--client <id>]
//   node scripts/client-mcp/grant.mjs revoke --id <first 12+ chars of the grant id>
// Origin for printed links: MCP_PUBLIC_ORIGIN, else https://hitloop.agency (override with --origin).

import path from 'node:path';
import { createRequire } from 'node:module';
import { randomToken } from '../../features/mcp/oauth.js';
import { GRANT_COLLECTION, grantIdOf, clientResourceUrl } from '../../features/client-mcp/grants.js';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: path.join(process.cwd(), '.env.local'), quiet: true });
const { adminDb } = require('../../api/_lib/firebase-admin.cjs');

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const die = (m) => { console.error(m); process.exit(1); };
const col = () => adminDb.collection(GRANT_COLLECTION);

async function create() {
  const clientId = opt('client');
  if (!CLIENT_ID_RE.test(String(clientId || ''))) die('--client <id> is required.');
  const client = await adminDb.collection('clients').doc(clientId).get();
  if (!client.exists) die(`No client "${clientId}" in the clients collection.`);
  const label = String(opt('label') || client.data()?.companyName || clientId).slice(0, 80);
  const secret = randomToken(32);
  const gid = grantIdOf(secret);
  await col().doc(gid).set({ clientId, label, note: String(opt('note') || '').slice(0, 120), revoked: false, createdAt: new Date().toISOString() });
  const origin = String(opt('origin') || process.env.MCP_PUBLIC_ORIGIN || 'https://hitloop.agency').replace(/\/+$/, '');
  console.log(`Grant ${gid.slice(0, 12)} for ${clientId} (${label}).`);
  console.log(`Connect URL (shown once, treat it like a password):\n${clientResourceUrl(origin, secret)}`);
}

async function list() {
  const clientId = opt('client');
  const snap = clientId ? await col().where('clientId', '==', clientId).get() : await col().get();
  if (snap.empty) return console.log('No grants.');
  for (const d of snap.docs) {
    const g = d.data();
    console.log(`${d.id.slice(0, 12)}  ${g.revoked ? 'REVOKED' : 'active '}  ${g.clientId}  ${g.label}${g.note ? `  (${g.note})` : ''}  created ${g.createdAt}`);
  }
}

async function revoke() {
  const prefix = String(opt('id') || '');
  if (!/^[a-f0-9]{12,64}$/.test(prefix)) die('--id <first 12+ hex chars of the grant id> is required (see list).');
  const snap = await col().get();
  const hits = snap.docs.filter((d) => d.id.startsWith(prefix));
  if (hits.length !== 1) die(hits.length ? 'That prefix matches more than one grant; give more characters.' : 'No grant with that id.');
  await hits[0].ref.update({ revoked: true, revokedAt: new Date().toISOString() });
  console.log(`Revoked ${hits[0].id.slice(0, 12)} (${hits[0].data().clientId}).`);
}

const run = { create, list, revoke }[cmd];
if (!run) die('Usage: grant.mjs create --client <id> [--label <name>] [--note <text>] | list [--client <id>] | revoke --id <prefix>');
run().then(() => process.exit(0), (e) => die(e?.message || String(e)));
