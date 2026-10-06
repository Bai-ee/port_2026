// Publisher sweep: (1) schedule story-ready Discogs records, (2) publish everything due.
// Usage: node --env-file=.env.local scripts/social/publish-due.mjs [--dry-run]
//   --dry-run  lists what would be scheduled and what is due; writes and posts nothing.
// Step 2 is the same function GET /api/social-posting?action=process-due runs.
//
// SINGLE PUBLISHER: the GitHub Actions workflow (.github/workflows/social-publish-sweep.yml)
// is the scheduled publisher. This script is a manual/dry-run tool; do NOT run it on a
// timer (the launchd plist is retired). Every publish goes through the atomic claim
// (scheduled|queued -> posting), so an accidental overlap cannot double-post, but a
// manual run still publishes live: use --dry-run first.
//   --max=N   publish at most N posts this run (default 3)
import { createRequire } from 'node:module';
import { discogsClientId } from '../../features/discogs-ingest/service.js';
import { scheduleReadyRecords } from '../../features/discogs-ingest/scheduler.js';
import { MAX_ATTEMPTS, processDuePosts, processDuePostsForAllClients } from '../../features/social-posting/twitter-service.js';

const dryRun = process.argv.includes('--dry-run');
// Default: publish only the owner's account. Other clients stay on the deployed cron unless --all-clients.
const allClients = process.argv.includes('--all-clients');
const clientId = discogsClientId();
const stamp = () => new Date().toISOString();
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const maxPerRun = maxArg ? Number(maxArg.split('=')[1]) || undefined : undefined;

// Read-only mirror of the due query (the real reader may also expire stale rows, which writes).
async function listDue() {
  const fb = createRequire(import.meta.url)('../../api/_lib/firebase-admin.cjs');
  const snap = await fb.adminDb.collection('social_posts').where('scheduledAt', '<=', stamp()).get();
  return snap.docs.map((d) => d.data()).filter((p) => p.status === 'scheduled' || p.status === 'queued'
      || (p.status === 'failed' && p.retryable === true && (Number(p.attempts) || 0) < MAX_ATTEMPTS))
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
    const opts = maxPerRun ? { maxPerRun } : {};
    const { posted, failed, skipped, needsReview, deferred } = allClients ? await processDuePostsForAllClients(opts) : await processDuePosts(clientId, opts);
    console.log(`posted ${posted.length}, failed ${failed.length}, skipped(claimed elsewhere) ${skipped.length}, deferred(over cap) ${deferred}`);
    for (const p of failed) console.log('  failed', p.id, p.errorClass, p.retryable ? '(will retry)' : '(no retry)', p.error);
    for (const p of needsReview) console.log('  NEEDS REVIEW (stale claim, may be live on X):', p.id);
  }
  console.log(`[${stamp()}] publish-due done`);
} catch (err) {
  console.error(`[${stamp()}] publish-due error:`, err.message);
  process.exit(1);
}
process.exit(0);
