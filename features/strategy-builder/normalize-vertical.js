/**
 * Normalize a raw vertical/industry string to the canonical kebab-case taxonomy
 * used by holidays-vertical-map.js and the Strategy Builder UI.
 *
 * Lead-gen seeds snake_case (e.g. "pet_services"); the holiday map and UI use
 * kebab-case (e.g. "pet-services"). Without this, seeded clients silently
 * resolve zero holidays. Apply at the InputsPane default and in the generate
 * route before signal resolution.
 */

export const CANONICAL_VERTICALS = [
  'restaurant', 'bar', 'cafe',
  'dog-walker', 'pet-services',
  'fitness', 'wellness',
  'salon', 'beauty',
  'real-estate',
  'retail', 'e-commerce',
  'healthcare', 'clinic',
  'auto', 'repair',
  'legal', 'accounting',
  'home-services', 'hvac',
  'gambling', 'e-games',
];

const CANONICAL = new Set([
  'restaurant', 'bar', 'cafe',
  'dog-walker', 'pet-services',
  'fitness', 'wellness',
  'salon', 'beauty',
  'real-estate',
  'retail', 'e-commerce',
  'healthcare', 'clinic',
  'auto', 'repair',
  'legal', 'accounting',
  'home-services', 'hvac',
  'gambling', 'e-games',
]);

const ALIASES = {
  petservices: 'pet-services',
  'dog-walking': 'dog-walker',
  dogwalker: 'dog-walker',
  dogwalking: 'dog-walker',
  homeservices: 'home-services',
  realestate: 'real-estate',
  realtor: 'real-estate',
  ecommerce: 'e-commerce',
  gym: 'fitness',
  'gym-fitness': 'fitness',
  medspa: 'beauty',
  'med-spa': 'beauty',
  spa: 'beauty',
  'auto-repair': 'repair',
  'auto-shop': 'auto',
  autoshop: 'auto',
  mechanic: 'repair',
  chiropractor: 'wellness',
  chiro: 'wellness',
  dental: 'healthcare',
  dentist: 'healthcare',
  lawyer: 'legal',
  attorney: 'legal',
  food: 'restaurant',
  eatery: 'restaurant',
  bistro: 'restaurant',
  pub: 'bar',
  // gambling / iGaming
  igaming: 'gambling',
  'i-gaming': 'gambling',
  casino: 'gambling',
  'online-casino': 'gambling',
  sportsbook: 'gambling',
  betting: 'gambling',
  'sports-betting': 'gambling',
  lottery: 'gambling',
  poker: 'gambling',
  // electronic / competitive games
  egames: 'e-games',
  'e-gaming': 'e-games',
  esports: 'e-games',
  'e-sports': 'e-games',
  gaming: 'e-games',
  'video-games': 'e-games',
  'game-studio': 'e-games',
};

/**
 * @param {string} raw
 * @returns {string} canonical kebab-case vertical, or '' when input is empty
 */
export function normalizeVertical(raw) {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (CANONICAL.has(v)) return v;
  if (ALIASES[v]) return ALIASES[v];

  if (/dog.?walk/.test(v)) return 'dog-walker';
  if (/pet|vet|groom|kennel/.test(v)) return 'pet-services';
  if (/restaurant|food|eatery|bistro|dine/.test(v)) return 'restaurant';
  if (/\bbar\b|pub|tavern|brewery/.test(v)) return 'bar';
  if (/cafe|coffee/.test(v)) return 'cafe';
  if (/gym|fitness|yoga|crossfit|pilates/.test(v)) return 'fitness';
  if (/spa|aesthetic|cosmetic|botox|skin/.test(v)) return 'beauty';
  if (/salon|hair|nail|barber/.test(v)) return 'salon';
  if (/real.?estate|realtor|broker|property/.test(v)) return 'real-estate';
  if (/dental|dentist|ortho/.test(v)) return 'healthcare';
  if (/clinic|medical|health/.test(v)) return 'healthcare';
  if (/law|attorney|legal/.test(v)) return 'legal';
  if (/account|bookkeep|cpa|\btax\b/.test(v)) return 'accounting';
  if (/hvac|heating|cooling/.test(v)) return 'hvac';
  if (/plumb|electric|roof|landscap|clean|pest|handyman/.test(v)) return 'home-services';
  if (/auto.?repair|mechanic|body.?shop|tire/.test(v)) return 'repair';
  if (/auto|dealer|\bcar\b/.test(v)) return 'auto';
  if (/commerce|online.?store|shopify/.test(v)) return 'e-commerce';
  if (/retail|shop|store|boutique/.test(v)) return 'retail';
  if (/wellness|therap|massage|chiro/.test(v)) return 'wellness';
  if (/casino|gambl|sportsbook|\bbet|wager|poker|lottery|igaming|i-gaming/.test(v)) return 'gambling';
  if (/esport|e-sport|egame|e-game|video.?game|game.?studio|twitch|streamer/.test(v)) return 'e-games';

  return v;
}
