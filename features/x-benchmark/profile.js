// The per-client X growth profile: who this account is, who it is measured
// against, and how much autonomy it grants.
//
// Stored at `client_configs/{clientId}.marketingBriefConfig.xGrowth` — the same
// document and the same save route as the rest of the client's X-adjacent
// settings (`brandXHandle`, `kols`), so there is one write path and one stale-
// form guard rather than a second parallel config surface.
//
// ⚠️ The save route normalizes an EXPLICIT field list. A block that is not
// normalized there is silently dropped on every save — the trap `brandXHandle`
// already hit once. `normalizeXGrowthProfile` exists to be called from exactly
// that place.
//
// Pure: no Firestore, no network, no clock.

/** Publishing autonomy, mirroring Social Auto-Publish's vocabulary so a client
 * only has to learn one model:
 *   off      — nothing is drafted or published
 *   approval — drafts are prepared and wait for a human (the default)
 *   auto     — drafts publish on schedule without review
 */
export const X_GROWTH_MODES = ['off', 'approval', 'auto'];

/** At most this many benchmark accounts. More than a handful stops being a
 * comparison and starts being an average, which is exactly the thing a
 * benchmark is supposed to beat. */
export const MAX_BENCHMARK_HANDLES = 5;

export const MAX_LANES = 12;

/** Cadence tiers, in authored posts per active day. The gap report recommends
 * one; a client can pin a lower one and the calendar will respect it. Tier 1
 * is "the account is alive", tier 4 is the model account's measured rate. */
export const TIERS = {
  1: { authoredPerDay: 4, label: 'Foundation' },
  2: { authoredPerDay: 8, label: 'Working' },
  3: { authoredPerDay: 12, label: 'Competitive' },
  4: { authoredPerDay: 16, label: 'Saturation' },
};

export const DEFAULT_X_GROWTH_PROFILE = {
  enabled: false,
  mode: 'approval',
  ownHandle: '',
  benchmarkHandles: [],
  lanes: [],
  tierOverride: null,
  timezone: '',
};

function cleanHandle(value, max = 40) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/^@+/, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, max);
}

function toList(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return input.split(/[\n,]/);
  return [];
}

function cleanLabel(value, max = 40) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Normalize an incoming profile for storage.
 *
 * Follows the save route's established convention: an UNDEFINED field falls
 * back to what was already stored, so a partial save never silently clears a
 * setting the form did not render. An explicitly empty value does clear it.
 *
 * @param {object|undefined} input - the incoming block
 * @param {object|null} prior - what is currently stored
 * @returns {object} the block to persist
 */
export function normalizeXGrowthProfile(input, prior = null) {
  const base = { ...DEFAULT_X_GROWTH_PROFILE, ...(prior && typeof prior === 'object' ? prior : {}) };
  if (input === undefined) return { ...base };
  const src = (input && typeof input === 'object') ? input : {};

  const mode = X_GROWTH_MODES.includes(src.mode) ? src.mode : base.mode;

  const benchmarkHandles = src.benchmarkHandles !== undefined
    ? [...new Set(toList(src.benchmarkHandles).map((h) => cleanHandle(h)).filter(Boolean))]
      .slice(0, MAX_BENCHMARK_HANDLES)
    : base.benchmarkHandles;

  const lanes = src.lanes !== undefined
    ? [...new Set(toList(src.lanes).map((l) => cleanLabel(l)).filter(Boolean))].slice(0, MAX_LANES)
    : base.lanes;

  const rawTier = src.tierOverride !== undefined ? src.tierOverride : base.tierOverride;
  const tierNum = Number(rawTier);
  const tierOverride = Object.prototype.hasOwnProperty.call(TIERS, String(tierNum)) ? tierNum : null;

  return {
    enabled: src.enabled !== undefined ? src.enabled === true : base.enabled === true,
    mode,
    ownHandle: src.ownHandle !== undefined ? cleanHandle(src.ownHandle) : cleanHandle(base.ownHandle),
    benchmarkHandles,
    lanes,
    tierOverride,
    timezone: src.timezone !== undefined ? cleanLabel(src.timezone, 64) : cleanLabel(base.timezone, 64),
  };
}

/**
 * Resolve the profile a runtime should actually use.
 *
 * The handle is the one place worth falling back: a client who connected their
 * X account in the Social Accounts card has already told us who they are, and
 * making them retype it into a second field is the kind of friction that leaves
 * the profile half-filled. Config wins when both exist, because the connected
 * account can be a different identity than the one being grown.
 *
 * @param {object} input
 * @param {object} [input.config] - stored xGrowth block
 * @param {object} [input.socialAccount] - the client's connected X account, if any
 * @param {object} [input.clientBrain] - approved Client Brain context, if any
 */
export function resolveXGrowthProfile(input = {}) {
  const profile = normalizeXGrowthProfile(input.config, null);
  const connected = cleanHandle(
    input.socialAccount?.username
    ?? input.socialAccount?.handle
    ?? input.socialAccount?.screenName
    ?? '',
  );

  const ownHandle = profile.ownHandle || connected;
  const lanes = profile.lanes.length
    ? profile.lanes
    : (Array.isArray(input.clientBrain?.lanes) ? input.clientBrain.lanes.map((l) => cleanLabel(l)).filter(Boolean).slice(0, MAX_LANES) : []);

  const ready = Boolean(ownHandle) && profile.benchmarkHandles.length > 0;

  return {
    ...profile,
    ownHandle,
    lanes,
    handleSource: profile.ownHandle ? 'config' : (connected ? 'connected-account' : 'none'),
    ready,
    // Why the profile cannot run yet, in the order a UI should ask for them.
    missing: [
      ...(ownHandle ? [] : ['ownHandle']),
      ...(profile.benchmarkHandles.length ? [] : ['benchmarkHandles']),
    ],
  };
}

/**
 * The cadence tier to aim for.
 *
 * A pinned tier always wins — a client who knows they cannot write eight posts
 * a day should not be handed a calendar with eight slots on it. Otherwise the
 * recommendation is the tier ABOVE current output, never the benchmark's tier
 * in one jump: the measured failure mode is spiking for a week and stopping,
 * and a tier that is held beats a tier that is spiked.
 *
 * @param {object} input
 * @param {number|null} [input.tierOverride]
 * @param {number|null} [input.currentAuthoredPerDay]
 * @returns {{tier:number, authoredPerDay:number, label:string, source:string}}
 */
export function resolveTier(input = {}) {
  const override = Number(input.tierOverride);
  if (Object.prototype.hasOwnProperty.call(TIERS, String(override))) {
    return { tier: override, ...TIERS[override], source: 'pinned' };
  }
  const current = Number(input.currentAuthoredPerDay);
  if (!Number.isFinite(current) || current <= 0) {
    return { tier: 1, ...TIERS[1], source: 'default' };
  }
  const tiers = Object.keys(TIERS).map(Number).sort((a, b) => a - b);
  const next = tiers.find((t) => TIERS[t].authoredPerDay > current);
  const tier = next ?? tiers[tiers.length - 1];
  return { tier, ...TIERS[tier], source: 'next-step' };
}
