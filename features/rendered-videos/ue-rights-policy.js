// Owner decision D1 (2026-10-11), applied to STORED rendered-video packages.
// Pure + injected store so it is unit-testable; the CLI is scripts/x-content/apply-ue-rights-policy.mjs.
//
//   BAI-EE mixes      -> rights 'owned',   approval {state:'none'}
//   every other mix   -> rights 'cleared', approval {state:'none'},
//                        rightsSource {by:'owner', policy:'ue-hosted-cleared', at:'2026-10-11'}
//   rightsSetBy:'human' rows are NEVER touched (a human choice always wins).
//   Retired rows are skipped. An 'approved'/'rejected' approval state is never overwritten.
//
// Idempotent: a row already on policy produces no patch. Reports COUNTS only.

import { normName, OWNER_ARTISTS } from '../ue-content/adapter.js';
import { UE_RIGHTS_SOURCE } from './adapter.js';

const OWNER_KEYS = OWNER_ARTISTS.map(normName);
const LEGACY_TAG = 'rights:third-party-unconfirmed';
const POLICY_TAG = 'rights:ue-hosted-cleared';

const sameSource = (a, b) => !!a && !!b && a.by === b.by && a.policy === b.policy && a.at === b.at;

export function isOwnerMix(pkg = {}) {
  const names = [...(Array.isArray(pkg.entities) ? pkg.entities : [])];
  const head = String(pkg.title || '').split(' – ')[0];
  if (head) names.push(head);
  return names.some((n) => OWNER_KEYS.includes(normName(n)));
}

/** The patch that brings one package onto D1 policy, or null (already on policy / out of scope). */
export function policyPatch(pkg) {
  const owner = isOwnerMix(pkg);
  const patch = {};
  const wantRights = owner ? 'owned' : 'cleared';
  if (pkg.rights !== wantRights) patch.rights = wantRights;
  const state = pkg.approval?.state;
  if (!state || state === 'needed') patch.approval = { state: 'none' };
  if (!owner && !sameSource(pkg.rightsSource, UE_RIGHTS_SOURCE)) patch.rightsSource = { ...UE_RIGHTS_SOURCE };
  const tags = Array.isArray(pkg.tags) ? pkg.tags : [];
  if (!owner) {
    if (tags.includes(LEGACY_TAG) || !tags.includes(POLICY_TAG)) {
      patch.tags = [...new Set([...tags.filter((t) => t !== LEGACY_TAG), POLICY_TAG])].sort();
    }
  } else if (tags.includes(LEGACY_TAG)) {
    patch.tags = tags.filter((t) => t !== LEGACY_TAG);
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * @param {{ listPackages(): Promise<object[]>, applyPatches?(items: {id:string, patch:object}[]): Promise<void> }} store
 * @param {{ write?: boolean }} [opts]  dry-run unless write === true
 * @returns counts only
 */
export async function applyUeRightsPolicy(store, { write = false } = {}) {
  const counts = { scanned: 0, owned: 0, cleared: 0, wouldChange: 0, alreadyOnPolicy: 0, skippedHuman: 0, skippedRetired: 0, written: 0, dryRun: !write };
  const items = [];
  for (const pkg of (await store.listPackages()) || []) {
    if (pkg?.source?.kind !== 'rendered-video') continue;
    counts.scanned += 1;
    if (pkg.rightsSetBy === 'human') { counts.skippedHuman += 1; continue; }
    if (pkg.status === 'retired') { counts.skippedRetired += 1; continue; }
    const patch = policyPatch(pkg);
    if (!patch) { counts.alreadyOnPolicy += 1; continue; }
    counts[isOwnerMix(pkg) ? 'owned' : 'cleared'] += 1;
    counts.wouldChange += 1;
    items.push({ id: pkg.id, patch });
  }
  if (write && items.length) {
    await store.applyPatches(items);
    counts.written = items.length;
  }
  return counts;
}
