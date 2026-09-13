// Accounts worth quote-reacting to.
//
// A quote-tweet inherits the reading audience of the post it quotes, which is
// why it is @bai_ee's highest-reach format on paper and its worst in practice:
// the format was right, the targets were not (100 avg views against the model
// account's 11,451 on the identical format).
//
// This list is derived, not invented. It is the accounts @seb__design actually
// quoted and retweeted over 65 days, weighted by likes earned + retweet
// frequency + quote frequency. **31 accounts cover 80% of his quote-derived
// likes** out of the 195 he quoted at least once, so a list this size is the
// right shape — long enough to always have something live, short enough to
// stay curated.
//
// `vein` matters: the measured top veins are japanese/asian design (187.4 avg
// likes), retro/pre-internet (65.7) and motion (59.6). `bryan` entries are not
// in the model's corpus — they are the lanes only this account can credibly
// occupy, and they are unproven, marked accordingly.

/** @typedef {{handle:string, vein:string, note?:string, unproven?:boolean}} WatchedAccount */

/** @type {WatchedAccount[]} */
export const WATCHLIST = [
  // --- proven: highest value in the model's corpus -------------------------
  { handle: 'rare_jpg', vein: 'japanese-asian-design', note: 'source of the model account\'s single best post (1,585 likes)' },
  { handle: 'interiorsuckerr', vein: 'retro-analog-preinternet', note: 'most-quoted account, 7 quotes / 1,420 likes' },
  { handle: 'DesignReviewed', vein: 'retro-analog-preinternet', note: 'archival poster/print scans' },
  { handle: 'csidearchives', vein: 'retro-analog-preinternet' },
  { handle: 'jmdsgn', vein: 'editorial-typography' },
  { handle: 'butter91138', vein: 'japanese-asian-design' },
  { handle: 'tndhjm', vein: 'japanese-asian-design' },
  { handle: 'rhytkm', vein: 'japanese-asian-design' },
  { handle: 'xiaoxiaodong01', vein: 'japanese-asian-design' },
  { handle: 'jesper_alpacka', vein: 'motion-generative' },
  { handle: 'AnatoleOis', vein: 'motion-generative' },
  { handle: 'iDID_team', vein: 'editorial-typography' },
  { handle: 'neybell_', vein: 'editorial-typography' },
  { handle: 'applefiles_', vein: 'retro-analog-preinternet' },
  { handle: 'SciFiArchives', vein: 'retro-analog-preinternet' },
  { handle: 'nono_ai_archive', vein: 'retro-analog-preinternet' },
  { handle: 'abduzeedo', vein: 'editorial-typography' },
  { handle: 'cameronmoll', vein: 'editorial-typography' },
  { handle: 'its_sslvr', vein: 'editorial-typography' },
  { handle: 'ggsimm', vein: 'motion-generative' },
  { handle: 'motion_so', vein: 'motion-generative' },
  { handle: 'avstorm', vein: 'motion-generative' },
  { handle: 'marcelkargul', vein: 'motion-generative' },
  { handle: 'blak3shao', vein: 'motion-generative' },
  { handle: 'nitishkmrk', vein: 'editorial-typography' },
  { handle: 'thatguybg', vein: 'editorial-typography' },
  { handle: 'RaminNasibov', vein: 'editorial-typography' },
  { handle: 'benjitaylor', vein: 'motion-generative' },
  { handle: 'CharlesPattson', vein: 'retro-analog-preinternet' },
  { handle: 'MengTo', vein: 'craft-tools' },
  { handle: 'figma', vein: 'craft-tools', note: 'quoted 6x but only 137 likes total — low ceiling, keep for tool news' },
  { handle: 'edo_lunardi', vein: 'motion-generative' },
  { handle: 'vanschneider', vein: 'craft-tools' },

  // --- unproven: Bryan-specific veins, not in the model's corpus ------------
  // These are the lanes only this account can credibly occupy. No measured
  // performance behind them yet; treat their first 30 days as an experiment.
  { handle: 'npm_i_shaders', vein: 'motion-generative', unproven: true },
  { handle: 'threejs', vein: 'motion-generative', unproven: true },
  { handle: 'jh3yy', vein: 'craft-tools', unproven: true, note: 'already retweeted 5x by @bai_ee' },
  { handle: 'emilkowalski_', vein: 'craft-tools', unproven: true },
  { handle: 'iDankyMcgee', vein: 'work-adjacent', unproven: true, note: 'Critters Quest illustrator, retweeted 7x' },
  { handle: 'crittersquest', vein: 'work-adjacent', unproven: true, note: '⚠️ client account — quote the DESIGN, never a token announcement' },
];

/** Veins ranked by measured average likes on the model account. */
export const VEIN_WEIGHTS = {
  'japanese-asian-design': 1.0,
  'retro-analog-preinternet': 0.75,
  'motion-generative': 0.7,
  'editorial-typography': 0.6,
  'craft-tools': 0.45,
  'work-adjacent': 0.5,
};

export const HANDLES = WATCHLIST.map((a) => a.handle);

export function veinOf(handle) {
  const h = String(handle || '').replace(/^@/, '').toLowerCase();
  const hit = WATCHLIST.find((a) => a.handle.toLowerCase() === h);
  return hit ? hit.vein : null;
}
