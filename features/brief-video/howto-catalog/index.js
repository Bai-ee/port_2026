// Vendored CQ-HowTo catalog (copied from the hitloop-video hub by scripts/sync-howto-catalog.mjs) and the pure checks on it.
// catalogCheck covers only the catalog ids (panel/preset/action/host/art) with the hub's reason strings. It does NOT check timing:
// the author also runs the vendored hub requestToSpec.mjs (frames, step minimums, total length), and only a request that passes both renders.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const sortKeysDeep = (v) => {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeysDeep(v[k])]));
  return v;
};

export const loadHowtoCatalog = () => ({ catalog: require('./catalog.json'), campaign: require('./campaign.json') });

/** sha256 hex (first 16) of the catalog + campaign canonical JSON: changes when the vendored copy changes. */
export const catalogHash = (catalog, campaign) =>
  createHash('sha256').update(JSON.stringify(sortKeysDeep({ catalog, campaign }))).digest('hex').slice(0, 16);

/** Plain-English meaning of each game scene (panel) for the Creative Brief template and the author prompt. */
export const PANEL_DESCRIPTIONS = Object.freeze({
  spotTile: 'Selecting a resource spot on the map (spot tile).',
  spotTileWide: 'Selecting a resource spot on the map (wide spot tile).',
  spotInfo: 'The spot info panel for a resource spot.',
  critterSelection: 'Choosing a critter and sending it out to gather.',
  spotClaimReward: 'The claim reward screen once gathering is done.',
});
export const ESTABLISH_DESCRIPTION = 'Town establishing shot (the opening view of the town, set with establish.view).';

/** Art paths that exist in the hub (art.json, synced from public/art/posters). */
export const ART_AVAILABLE = Object.freeze([...require('./art.json').art]);

/** Catalog problems of a request, as stable reason strings (steps are 1-based): unknown-panel, unknown-action, unknown-preset, unknown-host, art-missing. */
export function catalogCheck(request, catalog, art = ART_AVAILABLE) {
  const reasons = [];
  const r = request && typeof request === 'object' ? request : {};
  const cursorNoHost = r.skeleton === 'cursor' && r.host?.name === 'none';
  const hostName = typeof r.host?.name === 'string' && r.host.name.trim() ? r.host.name.trim() : 'mayor';
  if (!cursorNoHost && !(catalog?.hosts || []).includes(hostName)) reasons.push(`unknown-host:${hostName}`);
  const src = r.end?.art?.src;
  if (typeof src === 'string' && src && !art.includes(src)) reasons.push(`art-missing:${src}`);
  (Array.isArray(r.steps) ? r.steps : []).forEach((s, i) => {
    const n = i + 1;
    const panel = typeof s?.panel === 'string' ? s.panel.trim() : '';
    const def = catalog?.panels?.[panel];
    if (!panel || !def) { if (panel) reasons.push(`unknown-panel:${n}:${panel}`); return; }
    const preset = typeof s?.preset === 'string' ? s.preset.trim() : '';
    if (preset && !def.presets.includes(preset)) reasons.push(`unknown-preset:${n}:${preset}`);
    (Array.isArray(s?.clicks) ? s.clicks : []).forEach((c) => {
      const a = typeof c?.action === 'string' ? c.action.trim() : '';
      if (a && !def.actions.includes(a)) reasons.push(`unknown-action:${n}:${a}`);
    });
  });
  return reasons;
}
