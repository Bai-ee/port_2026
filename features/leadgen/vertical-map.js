// Lead Gen — Vertical classifier
// Maps Google Business Profile categories to internal verticals + sub-verticals,
// and carries baseline economics per vertical (avg deal value + close rate).
// Source: docs/LEAD_GEN_PIPELINE_PLAN.md §1.4

// ── Generic strategies available across every vertical ───────────────────────
export const QUERY_STRATEGIES_GENERIC = {
  broad: {
    label: 'Broad',
    description: 'Standard discovery — cast a wide net',
    templates: [
      '{noun} near {loc}',
      '{noun2} near {loc}',
    ],
    defaultOn: true,
  },
  rated: {
    label: 'Top Rated',
    description: 'Successful businesses with strong reviews',
    templates: [
      'top rated {noun} near {loc}',
      'best {noun2} reviews near {loc}',
    ],
    defaultOn: true,
  },
  affordable: {
    label: 'Affordable',
    description: 'Budget-positioned independents (less likely to have agencies)',
    templates: [
      'affordable {noun} near {loc}',
      'cheap {noun2} near {loc}',
    ],
    defaultOn: false,
  },
  local_independent: {
    label: 'Local / Family',
    description: 'Family-owned and local independents — prime upgrade candidates',
    templates: [
      'family owned {noun} near {loc}',
      'local {noun2} near {loc}',
    ],
    defaultOn: false,
  },
  emergency: {
    label: 'Emergency / Urgent',
    description: 'Businesses relying on urgent inbound — need strong web presence',
    templates: [
      'emergency {noun} near {loc}',
      '{noun} open now near {loc}',
    ],
    defaultOn: false,
  },
};

export const VERTICAL_MAP = {
  lawyer: {
    label: 'Lawyer',
    queryNoun: 'lawyer',
    gbpCategories: [
      'Attorney', 'Law firm', 'Personal injury attorney',
      'Family law attorney', 'Criminal justice attorney',
      'Immigration attorney', 'Bankruptcy attorney',
      'Real estate attorney', 'Tax attorney',
      'Corporate lawyer', 'Employment attorney',
    ],
    subVerticalFromCategory: {
      'Personal injury attorney': 'personal_injury',
      'Family law attorney': 'family_law',
      'Criminal justice attorney': 'criminal_defense',
      'Immigration attorney': 'immigration',
      'Bankruptcy attorney': 'bankruptcy',
      'Real estate attorney': 'real_estate',
      'Tax attorney': 'tax',
      'Corporate lawyer': 'corporate',
      'Employment attorney': 'employment',
    },
    avgDealValue: { min: 3000, max: 15000 },
    closeProbability: 0.08,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Lawyers actively seeking clients — free consultations, accepting cases',
        templates: [
          '{noun} free consultation near {loc}',
          '{noun} accepting new cases near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Niche Practice',
        description: 'Sub-specialty solo/small firms with less marketing spend',
        templates: [
          'DUI attorney near {loc}',
          'workers comp lawyer near {loc}',
          'estate planning attorney near {loc}',
          'immigration lawyer near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  dental: {
    label: 'Dental',
    queryNoun: 'dentist',
    gbpCategories: [
      'Dentist', 'Cosmetic dentist', 'Orthodontist',
      'Pediatric dentist', 'Oral surgeon', 'Endodontist',
      'Periodontist', 'Dental implants provider',
    ],
    avgDealValue: { min: 2000, max: 8000 },
    closeProbability: 0.06,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Practices actively seeking patients',
        templates: [
          'dentist accepting new patients near {loc}',
          'dentist walk ins welcome near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Specialty',
        description: 'Niche dental practices — often independent with older websites',
        templates: [
          'pediatric dentist near {loc}',
          'cosmetic dentist near {loc}',
          'emergency dentist near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  home_services: {
    label: 'Home Services',
    queryNoun: 'home services contractor',
    gbpCategories: [
      'HVAC contractor', 'Plumber', 'Roofing contractor',
      'Electrician', 'General contractor', 'Landscaper',
      'Pest control service', 'Painting contractor',
      'Garage door supplier', 'Fencing contractor',
    ],
    avgDealValue: { min: 1500, max: 5000 },
    closeProbability: 0.10,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Contractors advertising availability — actively seeking jobs',
        templates: [
          '{noun} free estimate near {loc}',
          '{noun} same day service near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Trade-Specific',
        description: 'Individual trades — more targeted than umbrella "contractor"',
        templates: [
          'plumber near {loc}',
          'electrician near {loc}',
          'roofer near {loc}',
          'HVAC repair near {loc}',
        ],
        defaultOn: false,
      },
      seasonal: {
        label: 'Seasonal / Urgent',
        description: 'Emergency/seasonal searches — businesses that depend on urgent visibility',
        templates: [
          'emergency plumber near {loc}',
          'AC repair near {loc}',
          'furnace repair near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  restaurant: {
    label: 'Restaurant / Hospitality',
    // Restaurant queries default to catering/private dining — raw "restaurant"
    // is too noisy for our offer (we want venues with bookings, not diners).
    queryNoun: 'catering service',
    queryNounAlt: 'private dining',
    gbpCategories: [
      'Restaurant', 'Catering service', 'Event venue',
      'Banquet hall', 'Bar', 'Bakery', 'Café',
      'Food truck', 'Caterer',
    ],
    qualifyingSignals: ['catering', 'event', 'banquet', 'private dining'],
    avgDealValue: { min: 1000, max: 4000 },
    closeProbability: 0.12,
    queryStrategies: {
      intent: {
        label: 'Event-Focused',
        description: 'Venues seeking event/catering bookings — higher value, need web presence',
        templates: [
          'private dining near {loc}',
          'catering service near {loc}',
          'event venue near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Cuisine-Specific',
        description: 'Independent restaurants by cuisine — often have dated websites',
        templates: [
          'family restaurant near {loc}',
          'authentic mexican restaurant near {loc}',
          'italian restaurant near {loc}',
        ],
        defaultOn: false,
      },
    },
  },

  // ── Added per operator defaults ────────────────────────────────────────
  med_spa: {
    label: 'Med Spa / Aesthetics',
    queryNoun: 'med spa',
    gbpCategories: [
      'Medical spa', 'Skin care clinic', 'Laser hair removal service',
      'Botox clinic', 'Aesthetician', 'Cosmetic surgeon', 'Day spa',
    ],
    avgDealValue: { min: 2000, max: 8000 },
    closeProbability: 0.07,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Med spas advertising consultations or specials',
        templates: [
          'med spa free consultation near {loc}',
          'botox specials near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Treatment-Specific',
        description: 'Specific treatments — attracts independent practitioners',
        templates: [
          'laser hair removal near {loc}',
          'microneedling near {loc}',
          'lip filler near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  auto_repair: {
    label: 'Auto Repair',
    queryNoun: 'auto repair shop',
    gbpCategories: [
      'Auto repair shop', 'Mechanic', 'Brake shop', 'Tire shop',
      'Auto body shop', 'Transmission shop', 'Oil change service',
      'Car repair and maintenance service',
    ],
    avgDealValue: { min: 1500, max: 4000 },
    closeProbability: 0.09,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Shops advertising availability and estimates',
        templates: [
          'auto repair free estimate near {loc}',
          'mechanic walk in near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Specialty',
        description: 'Specialty shops — often independent with basic websites',
        templates: [
          'transmission repair near {loc}',
          'brake shop near {loc}',
          'auto body shop near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  chiropractor: {
    label: 'Chiropractor',
    queryNoun: 'chiropractor',
    gbpCategories: [
      'Chiropractor', 'Wellness center', 'Sports medicine clinic',
    ],
    avgDealValue: { min: 1500, max: 5000 },
    closeProbability: 0.07,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Chiropractors seeking new patients',
        templates: [
          'chiropractor accepting new patients near {loc}',
          'chiropractor free consultation near {loc}',
        ],
        defaultOn: true,
      },
    },
  },
  gym_fitness: {
    label: 'Gym / Fitness',
    queryNoun: 'gym',
    gbpCategories: [
      'Gym', 'Yoga studio', 'Pilates studio', 'CrossFit gym',
      'Boxing gym', 'Personal trainer', 'Fitness center',
      'Martial arts school', 'Indoor cycling',
    ],
    avgDealValue: { min: 1000, max: 4000 },
    closeProbability: 0.10,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Studios/gyms advertising trials and membership deals',
        templates: [
          'gym free trial near {loc}',
          'yoga studio first class free near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Studio Type',
        description: 'Specific fitness niches — often small independents',
        templates: [
          'CrossFit gym near {loc}',
          'boxing gym near {loc}',
          'pilates studio near {loc}',
          'martial arts school near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  real_estate: {
    label: 'Real Estate',
    queryNoun: 'real estate agency',
    gbpCategories: [
      'Real estate agency', 'Real estate agents', 'Real estate consultant',
      'Property management company', 'Real estate broker',
    ],
    avgDealValue: { min: 2000, max: 10000 },
    closeProbability: 0.05,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Agents/agencies actively advertising listings',
        templates: [
          'real estate agent near {loc}',
          'homes for sale by agent near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Specialty',
        description: 'Property management and commercial — often basic web presence',
        templates: [
          'property management company near {loc}',
          'commercial real estate near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  wedding_event: {
    label: 'Wedding / Event',
    queryNoun: 'wedding photographer',
    queryNounAlt: 'wedding venue',
    gbpCategories: [
      'Wedding photographer', 'Wedding venue', 'Wedding planner',
      'Event planner', 'Event venue', 'Banquet hall',
      'Florist', 'DJ service', 'Wedding service',
    ],
    avgDealValue: { min: 2000, max: 8000 },
    closeProbability: 0.08,
    queryStrategies: {
      intent: {
        label: 'Booking-Ready',
        description: 'Vendors advertising availability for upcoming season',
        templates: [
          'wedding photographer available near {loc}',
          'wedding venue booking near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Vendor Type',
        description: 'Specific wedding vendor types — many have portfolio-only sites',
        templates: [
          'wedding florist near {loc}',
          'wedding DJ near {loc}',
          'event planner near {loc}',
        ],
        defaultOn: false,
      },
    },
  },
  pet_services: {
    label: 'Pet Services',
    queryNoun: 'veterinarian',
    queryNounAlt: 'pet groomer',
    gbpCategories: [
      'Veterinarian', 'Pet groomer', 'Dog day care center',
      'Dog trainer', 'Pet boarding service', 'Animal hospital',
      'Pet supply store',
    ],
    avgDealValue: { min: 1500, max: 4000 },
    closeProbability: 0.09,
    queryStrategies: {
      intent: {
        label: 'Intent Signals',
        description: 'Pet businesses seeking new clients',
        templates: [
          'veterinarian accepting new patients near {loc}',
          'dog groomer near me near {loc}',
        ],
        defaultOn: true,
      },
      niche: {
        label: 'Service Type',
        description: 'Specific pet service niches',
        templates: [
          'dog daycare near {loc}',
          'dog trainer near {loc}',
          'pet boarding near {loc}',
        ],
        defaultOn: false,
      },
    },
  },

  // Freeform — no GBP category bias, no auto-fill queries; user types whatever.
  custom: {
    label: 'Custom (any query)',
    queryNoun: null,
    gbpCategories: [],
    avgDealValue: { min: 1000, max: 10000 },
    closeProbability: 0.05,
    queryStrategies: {},
  },
};

export const VERTICAL_KEYS = Object.keys(VERTICAL_MAP);

export function getVerticalLabel(key) {
  return VERTICAL_MAP[key]?.label || key;
}

// ── Strategy helpers ─────────────────────────────────────────────────────────

/**
 * Returns all strategies available for a given vertical (generic + vertical-specific).
 * Each entry has: { id, label, description, defaultOn, source, templates }
 */
export function getStrategiesForVertical(verticalKey) {
  const def = VERTICAL_MAP[verticalKey];
  const verticalStrategies = def?.queryStrategies || {};
  const all = [];

  for (const [id, strat] of Object.entries(QUERY_STRATEGIES_GENERIC)) {
    all.push({ id, ...strat, source: 'generic' });
  }
  for (const [id, strat] of Object.entries(verticalStrategies)) {
    all.push({ id, ...strat, source: 'vertical' });
  }

  return all;
}

/** Returns the default-on strategy IDs for a vertical. */
export function getDefaultStrategyIds(verticalKey) {
  return getStrategiesForVertical(verticalKey)
    .filter((s) => s.defaultOn)
    .map((s) => s.id);
}

/**
 * Build query strings from selected strategies.
 * @returns {{ query: string, strategy: string }[]}
 */
export function buildStrategicQueries(verticalKey, strategyIds, zip) {
  const def = VERTICAL_MAP[verticalKey];
  if (!def) return [{ query: '', strategy: 'custom' }];

  const noun  = def.queryNoun  || verticalKey;
  const noun2 = def.queryNounAlt || noun;
  const loc   = zip ? zip : 'united states';

  const allStrategies = {
    ...QUERY_STRATEGIES_GENERIC,
    ...(def.queryStrategies || {}),
  };

  const queries = [];
  for (const id of strategyIds) {
    const strat = allStrategies[id];
    if (!strat) continue;
    for (const tpl of strat.templates) {
      const q = tpl
        .replace(/\{noun\}/g,  noun)
        .replace(/\{noun2\}/g, noun2)
        .replace(/\{loc\}/g,   loc);
      queries.push({ query: q, strategy: id });
    }
  }

  const seen = new Set();
  return queries.filter(({ query }) => {
    const key = query.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Legacy helper (kept for backward compat — prospector fallback) ───────────
// Build the 2 default query strings for a campaign. ZIP-aware.
// Empty array for `custom` — user writes their own.
export function buildDefaultQueries(verticalKey, zip) {
  const def = VERTICAL_MAP[verticalKey];
  if (!def || !def.queryNoun) return [''];
  const noun  = def.queryNoun;
  const noun2 = def.queryNounAlt || noun;
  const z = String(zip || '').trim();
  if (z) {
    return [
      `${noun} near ${z}`,
      `top rated ${noun2} near ${z}`,
    ];
  }
  return [
    `top rated ${noun} united states`,
    `best ${noun2} reviews`,
  ];
}

export function classifyByGbpCategory(category) {
  if (!category) return null;
  for (const [key, def] of Object.entries(VERTICAL_MAP)) {
    if (def.gbpCategories.some((c) => c.toLowerCase() === category.toLowerCase())) {
      return {
        vertical: key,
        subVertical: def.subVerticalFromCategory?.[category] || null,
      };
    }
  }
  return null;
}
