// Lease for the public review page's background sync. syncRenderedVideos only writes meta.lastSyncAtMs at the END of a
// run, so concurrent list calls would all pass its throttle; this stamps syncStartedAtMs up front, atomically.
import { SYNC_THROTTLE_MS } from './sync.js';

export const SYNC_LEASE_MS = 5 * 60 * 1000;

/**
 * @param {{ transact: (fn: (tx: { read(): Promise<object|null>, merge(patch: object): void }) => Promise<unknown>) => Promise<unknown> }} deps
 *   transact runs fn inside one transaction on content_buckets/<owner>/meta/rendered-videos.
 * @returns {Promise<{ acquired: true } | { acquired: false, skipped: 'throttled'|'leased' }>}
 */
export async function acquireSyncLease(deps, { now }) {
  return deps.transact(async (tx) => {
    const meta = (await tx.read()) || {};
    if (Number.isFinite(meta.lastSyncAtMs) && now - meta.lastSyncAtMs < SYNC_THROTTLE_MS) return { acquired: false, skipped: 'throttled' };
    if (Number.isFinite(meta.syncStartedAtMs) && now - meta.syncStartedAtMs < SYNC_LEASE_MS) return { acquired: false, skipped: 'leased' };
    tx.merge({ syncStartedAtMs: now });
    return { acquired: true };
  });
}
