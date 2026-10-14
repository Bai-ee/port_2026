// Scan veins -> strategy pillar and the calendar lanes that prefer them.
// Decides which vein a quote-react slot favours; never judges a post or picks one.
// Pure; every vein in x-quote-targets/watchlist.js (VEIN_WEIGHTS + the home seed list) must appear here (a test enforces it).
// Works on the vein vocabulary only, never on handles, so it is the same for every client's watchlist.

import { VEIN_WEIGHTS } from '../../x-quote-targets/watchlist.js';

/** Quote-react is P1 (curation), so every watchlist vein maps to P1.
 * `lanes` are the calendar lanes (work/craft/music/meta) that prefer the vein. */
export const VEIN_MAP = {
  'japanese-asian-design': { pillar: 'P1', lanes: ['work', 'music'] },
  'retro-analog-preinternet': { pillar: 'P1', lanes: ['music', 'meta'] },
  'editorial-typography': { pillar: 'P1', lanes: ['work', 'meta'] },
  'motion-generative': { pillar: 'P1', lanes: ['craft', 'work'] },
  'craft-tools': { pillar: 'P1', lanes: ['craft', 'meta'] },
  'work-adjacent': { pillar: 'P1', lanes: ['work', 'meta'] },
};

/** Veins a slot lane prefers, strongest measured vein first. A lane that already
 * IS a vein name (older callers) prefers just itself. */
export function veinsForLane(lane) {
  if (!lane) return [];
  if (VEIN_MAP[lane]) return [lane];
  return Object.keys(VEIN_MAP)
    .filter((v) => VEIN_MAP[v].lanes.includes(lane))
    .sort((a, b) => (VEIN_WEIGHTS[b] ?? 0) - (VEIN_WEIGHTS[a] ?? 0) || a.localeCompare(b));
}

export const pillarForVein = (vein) => VEIN_MAP[vein]?.pillar ?? null;
