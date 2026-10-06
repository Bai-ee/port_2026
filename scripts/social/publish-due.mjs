// Publisher sweep: (1) schedule story-ready Discogs records, (2) publish everything due.
// Usage: node --env-file=.env.local scripts/social/publish-due.mjs [--dry-run]
//   --dry-run  lists what would be scheduled and what is due; writes and posts nothing.
// Step 2 is the same function GET /api/social-posting?action=process-due runs.
import { createRequire } from 'node:module';
import { discogsClientId } from '../../features/discogs-ingest/service.js';
import { scheduleReadyRecords } from '../../features/discogs-ingest/scheduler.js';
import { processDuePosts, processDuePostsForAllClients } from '../../features/social-posting/twitter-service.js';

const dryRun = process.argv.includes('--dry-run');
// Default: publish only the owner's account. Other clients stay on the deployed cron unless --all-clients.
const allClients = process.argv.includes('--all-clients');
const clientId = discogsClientId();
const stamp = () => new Date().toISOString();
const DUE_STATUSES = new Set(['scheduled', 'queued', 'failed']);

// Read-only mirror of the due query (the real reader may also expire stale rows, which writes).
async function listDue() {
  const fb = createRequire(import.meta.url)('../../api/_lib/firebase-admin.cjs');
  const snap = await fb.adminDb.collection('social_posts').where('scheduledAt', '<=', stamp()).get();
  return snap.docs.map((d) => d.data()).filter((p) => DUE_STATUSES.has(p.status))
    .map((p) => ({ id: p.id, clientId: p.clientId, status: p.status, scheduledAt: p.scheduledAt, content: String(p.content || '').slice(0, 60) }));
}

try {
  console.log(`[${stamp()}] publish-due start${dryRun ? ' (dry-run)' : ''} scope=${allClients ? 'all clients' : clientId}`);
  const scheduling = await scheduleReadyRecords({ clientId, dryRun });
  console.log('schedule:', JSON.stringify(scheduling, null, 2));
  if (dryRun) {
    const due = (await listDue()).filter((p) => allClients || p.clientId === clientId);
    console.log(`due now (would be posted): ${due.length}`);
    for (const p of due) console.log(' ', JSON.stringify(p));
  } else {
    const { posted, failed } = allClients ? await processDuePostsForAllClients() : await processDuePosts(clientId);
    console.log(`posted ${posted.length}, failed ${failed.length}`);
    for (const p of failed) console.log('  failed', p.id, p.error);
  }
  console.log(`[${stamp()}] publish-due done`);
} catch (err) {
  console.error(`[${stamp()}] publish-due error:`, err.message);
  process.exit(1);
}
process.exit(0);
