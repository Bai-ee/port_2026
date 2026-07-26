#!/usr/bin/env node
// READ-ONLY preflight for Social Auto-Publish. Writes nothing, calls no
// external API, spends nothing. Run this BEFORE deploying the */30 process-due
// cron — that cron is the one thing in this feature that can publish to a live
// account with no human action, and its first run drains whatever is already
// due in `social_posts`.
//
//   node scripts/preflight-social-auto-publish.cjs
//
// Reports, per bucket:
//   WOULD POST   — due, inside the 12h staleness window → the cron publishes these
//   WOULD EXPIRE — due but >12h stale → marked 'expired', never posted
//   PENDING      — awaiting_approval rows the roll-up will list
//   CONNECTED    — which clients have an X account wired, and to which handle
//   MODES        — each client's autoPublish mode (off / auto / approval)

require('../features/not-the-rug-brief/load-env');

const fb = require('../api/_lib/firebase-admin.cjs');
const digestConfig = require('../features/intelligence/_digest-config.js');

const STALE_DUE_MS = 12 * 60 * 60 * 1000;
const DUE_STATUSES = new Set(['scheduled', 'queued', 'failed']);

function line(label, value) {
  console.log(`  ${String(label).padEnd(22)} ${value}`);
}

async function main() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const snap = await fb.adminDb.collection('social_posts').where('scheduledAt', '<=', nowIso).get();
  const wouldPost = [];
  const wouldExpire = [];
  for (const doc of snap.docs) {
    const post = doc.data();
    if (!DUE_STATUSES.has(post.status)) continue;
    const ms = Date.parse(post.scheduledAt);
    (Number.isFinite(ms) && now - ms > STALE_DUE_MS ? wouldExpire : wouldPost).push(post);
  }

  console.log('\n=== process-due cron: what the FIRST run would do ===\n');
  console.log(`WOULD POST (live writes): ${wouldPost.length}`);
  for (const p of wouldPost) {
    line(p.clientId, `${p.status} · ${p.scheduledAt} · ${p.mediaUrl ? 'media' : 'text'} · "${String(p.content || '').slice(0, 60)}"`);
  }
  console.log(`\nWOULD EXPIRE (no post): ${wouldExpire.length}`);
  for (const p of wouldExpire.slice(0, 10)) {
    line(p.clientId, `${p.status} · ${p.scheduledAt}`);
  }
  if (wouldExpire.length > 10) line('', `…and ${wouldExpire.length - 10} more`);

  const pendingSnap = await fb.adminDb.collection('social_posts').where('status', '==', 'awaiting_approval').get();
  console.log(`\n=== awaiting_approval (roll-up would list): ${pendingSnap.size} ===\n`);
  pendingSnap.forEach((doc) => {
    const p = doc.data();
    line(p.clientId, `${p.createdAt} · ${p.platform || 'x'} · ${p.mediaUrl ? 'media' : 'NO MEDIA (skipped by roll-up)'}`);
  });

  const acctSnap = await fb.adminDb.collection('social_accounts').get();
  console.log(`\n=== connected social accounts: ${acctSnap.size} ===\n`);
  acctSnap.forEach((doc) => {
    const platforms = doc.data()?.platforms || {};
    for (const [key, acct] of Object.entries(platforms)) {
      if (!acct) continue;
      const scopes = Array.isArray(acct.scope) ? acct.scope : [];
      const mediaOk = acct.authMode === 'oauth1' || scopes.includes('media.write');
      line(doc.id, `${key} → @${acct.username || '?'} · ${acct.authMode} · media.write ${mediaOk ? 'OK' : 'MISSING (video will fail)'}`);
    }
  });

  const cfgSnap = await fb.adminDb.collection('digest_config').get();
  console.log('\n=== autoPublish modes (anything not "off" can publish) ===\n');
  let anyOn = false;
  for (const doc of cfgSnap.docs) {
    const cfg = await digestConfig.getDigestConfig(doc.id);
    const platforms = cfg?.autoPublish?.platforms || {};
    for (const [key, p] of Object.entries(platforms)) {
      if (!p || p.mode === 'off') continue;
      anyOn = true;
      line(doc.id, `${key} → ${p.mode} · cap ${p.maxPerDay}/day · daily email ${cfg?.schedule?.enabled ? 'ON' : 'off'}`);
    }
  }
  if (!anyOn) console.log('  (none — every client is off)');

  console.log('\nRead-only preflight complete. Nothing was written.\n');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('preflight failed:', err.message);
  process.exit(1);
});
