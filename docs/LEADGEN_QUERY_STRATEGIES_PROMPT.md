# Lead Gen — Dynamic Query Strategies

## Objective

Replace the current 2-query default system (`buildDefaultQueries`) with a **strategy-based query builder**. The campaign builder modal gets multi-select strategy chips that dynamically compose 5–8 search queries from mix-and-match patterns. Each vertical defines its own domain-specific strategies, and a set of generic strategies work across all verticals.

The goal: smarter search terms that surface businesses most likely to convert — established independents with outdated websites — instead of casting a single wide net.

---

## Current State (what to replace)

**File:** `features/leadgen/vertical-map.js`

The current `buildDefaultQueries(verticalKey, zip)` function generates exactly 2 queries:

```js
// With ZIP:
[`${noun} near ${zip}`, `top rated ${noun2} near ${zip}`]
// Without ZIP:
[`top rated ${noun} united states`, `best ${noun2} reviews`]
```

This is too generic. Every campaign for a vertical gets the same 2 queries regardless of what kind of lead you're hunting.

**File:** `components/dashboard/leadgen/CampaignBuilderModal.jsx`

The modal calls `buildDefaultQueries(vertical, zip)` on vertical/zip change, populates a flat list of editable query strings. Strategy selection doesn't exist yet — just raw text inputs.

---

## Data Model Changes

### `features/leadgen/vertical-map.js`

Add a `queryStrategies` object to each vertical definition. Each strategy is a named array of **query fragments** (the noun/location templating happens at assembly time, not in the data).

#### Generic Strategies (apply to ALL verticals)

Create a new export `QUERY_STRATEGIES_GENERIC` that provides baseline strategies available for every vertical:

```js
export const QUERY_STRATEGIES_GENERIC = {
  broad: {
    label: 'Broad',
    description: 'Standard discovery — cast a wide net',
    templates: [
      '{noun} near {loc}',
      '{noun2} near {loc}',
    ],
    defaultOn: true,  // selected by default when creating a campaign
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
```

#### Vertical-Specific Strategies

Add `queryStrategies` to each vertical in `VERTICAL_MAP`. These are domain-specific strategies that only appear when that vertical is selected.

```js
lawyer: {
  // ...existing fields...
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

med_spa: {
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

custom: {
  queryStrategies: {},  // No strategies — user writes everything manually
},
```

---

## New Function: `buildStrategicQueries`

**File:** `features/leadgen/vertical-map.js`

Replace `buildDefaultQueries` with a new function. Keep the old one for backward compatibility but have the modal call the new one.

```js
/**
 * Build query strings from selected strategies.
 *
 * @param {string} verticalKey   – key into VERTICAL_MAP
 * @param {string[]} strategyIds – selected strategy IDs (e.g. ['broad', 'intent', 'niche'])
 * @param {string} zip           – optional ZIP code
 * @returns {{ query: string, strategy: string }[]}
 */
export function buildStrategicQueries(verticalKey, strategyIds, zip) {
  const def = VERTICAL_MAP[verticalKey];
  if (!def) return [{ query: '', strategy: 'custom' }];

  const noun  = def.queryNoun || verticalKey;
  const noun2 = def.queryNounAlt || noun;
  const loc   = zip ? zip : 'united states';

  // Merge generic + vertical-specific strategies
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
        .replace(/\{noun\}/g, noun)
        .replace(/\{noun2\}/g, noun2)
        .replace(/\{loc\}/g, loc);
      queries.push({ query: q, strategy: id });
    }
  }

  // Dedupe by query string (case-insensitive)
  const seen = new Set();
  return queries.filter(({ query }) => {
    const key = query.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

Also export a helper to get available strategies for a vertical:

```js
/**
 * Returns all strategies available for a given vertical (generic + vertical-specific).
 * Each entry has: { id, label, description, defaultOn }
 */
export function getStrategiesForVertical(verticalKey) {
  const def = VERTICAL_MAP[verticalKey];
  const verticalStrategies = def?.queryStrategies || {};

  const all = [];

  // Generic strategies first
  for (const [id, strat] of Object.entries(QUERY_STRATEGIES_GENERIC)) {
    all.push({ id, ...strat, source: 'generic' });
  }

  // Vertical-specific strategies
  for (const [id, strat] of Object.entries(verticalStrategies)) {
    all.push({ id, ...strat, source: 'vertical' });
  }

  return all;
}

/**
 * Returns the default-on strategy IDs for a vertical.
 */
export function getDefaultStrategyIds(verticalKey) {
  const strategies = getStrategiesForVertical(verticalKey);
  return strategies.filter((s) => s.defaultOn).map((s) => s.id);
}
```

---

## UI Changes: `CampaignBuilderModal.jsx`

### New State

```js
const [selectedStrategies, setSelectedStrategies] = useState([]);
const [availableStrategies, setAvailableStrategies] = useState([]);
```

### Update the Reset/Init Logic

On modal open and when vertical changes, refresh available strategies and defaults:

```js
useEffect(() => {
  if (open) {
    const v = VERTICAL_KEYS[0];
    setVertical(v);
    setZip('');
    setMaxPerRun(20);
    // NEW: Initialize strategies
    const strats = getStrategiesForVertical(v);
    setAvailableStrategies(strats);
    const defaults = getDefaultStrategyIds(v);
    setSelectedStrategies(defaults);
    setQueries(buildStrategicQueries(v, defaults, '').map(q => q.query));
    setQueriesEdited(false);
    setEnabled(true);
  }
}, [open]);

// When vertical changes, refresh strategies
useEffect(() => {
  if (!open) return;
  const strats = getStrategiesForVertical(vertical);
  setAvailableStrategies(strats);
  // Reset to new vertical's defaults (unless user manually edited)
  if (!queriesEdited) {
    const defaults = getDefaultStrategyIds(vertical);
    setSelectedStrategies(defaults);
    setQueries(buildStrategicQueries(vertical, defaults, zip).map(q => q.query));
  }
}, [vertical, open]);

// When strategies or zip change (and not manually edited), rebuild queries
useEffect(() => {
  if (!open || queriesEdited) return;
  setQueries(buildStrategicQueries(vertical, selectedStrategies, zip).map(q => q.query));
}, [selectedStrategies, zip, open]);
```

### Strategy Chip Toggle Handler

```js
function toggleStrategy(id) {
  setSelectedStrategies((prev) => {
    const next = prev.includes(id)
      ? prev.filter((s) => s !== id)
      : [...prev, id];
    // At least one strategy must remain selected
    return next.length > 0 ? next : prev;
  });
  // Reset the "edited" flag so queries auto-rebuild
  if (queriesEdited) setQueriesEdited(false);
}
```

### Update resetQueries

```js
const resetQueries = () => {
  const defaults = getDefaultStrategyIds(vertical);
  setSelectedStrategies(defaults);
  setQueries(buildStrategicQueries(vertical, defaults, zip).map(q => q.query));
  setQueriesEdited(false);
};
```

### JSX: Strategy Chips Section

Insert between the ZIP/max-per-run row and the search queries section:

```jsx
<div className="leadgen-field">
  <div className="leadgen-strategies-head">
    <span className="leadgen-field-label">Search strategies</span>
    <span className="leadgen-field-hint leadgen-field-hint--inline">
      {selectedStrategies.length} of {availableStrategies.length} active
    </span>
  </div>
  <div className="leadgen-strategies">
    {availableStrategies.map((s) => {
      const isOn = selectedStrategies.includes(s.id);
      return (
        <button
          key={s.id}
          type="button"
          className={`leadgen-strategy-chip ${isOn ? 'leadgen-strategy-chip--on' : ''}`}
          onClick={() => toggleStrategy(s.id)}
          title={s.description}
        >
          <span className="leadgen-strategy-chip-label">{s.label}</span>
          {s.source === 'vertical' ? (
            <span className="leadgen-strategy-chip-badge">
              {VERTICAL_MAP[vertical]?.label}
            </span>
          ) : null}
        </button>
      );
    })}
  </div>
</div>
```

### CSS for Strategy Chips

Add to the `<style jsx>` block:

```css
.leadgen-strategies-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}
.leadgen-strategies {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

:global(.leadgen-strategy-chip) {
  font-family: inherit;
  font-size: 11px;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(0,0,0,0.12);
  background: #fff;
  color: #555;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 160ms ease;
  user-select: none;
}
:global(.leadgen-strategy-chip:hover) {
  border-color: #1a1a1a;
  color: #1a1a1a;
}
:global(.leadgen-strategy-chip--on) {
  background: #1a1a1a;
  border-color: #1a1a1a;
  color: #fff;
}
:global(.leadgen-strategy-chip--on:hover) {
  background: #333;
  border-color: #333;
}
:global(.leadgen-strategy-chip-badge) {
  font-size: 8.5px;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: 999px;
  background: rgba(255,255,255,0.15);
  color: inherit;
  text-transform: uppercase;
  font-weight: 600;
}
:global(.leadgen-strategy-chip:not(.leadgen-strategy-chip--on) .leadgen-strategy-chip-badge) {
  background: rgba(0,0,0,0.05);
}
```

---

## Campaign Data Shape Update

When saving the campaign, also store the selected strategy IDs so they can be restored when re-editing or re-running:

```js
const campaign = {
  id,
  enabled,
  vertical,
  strategies: selectedStrategies,  // ← NEW
  queries: cleanedQueries,
  location: { ... },
  maxProspectsPerRun: Number(maxPerRun) || 20,
  lastRunAt: null,
  createdAt: new Date().toISOString(),
};
```

---

## Backward Compatibility

- **Keep `buildDefaultQueries` exported** — the prospector (`features/leadgen/prospector.js`) uses it as a fallback when `campaign.queries` is empty (line 121). It will still work for older campaigns that don't have strategies.
- **Prospector doesn't change** — it receives `campaign.queries` (the final assembled strings) and iterates them. The strategy system is purely a UI/composition concern; by the time queries reach the prospector, they're plain strings.

---

## File Manifest

| Action | Path | What Changes |
|--------|------|-------------|
| MODIFY | `features/leadgen/vertical-map.js` | Add `QUERY_STRATEGIES_GENERIC`, `queryStrategies` per vertical, `buildStrategicQueries()`, `getStrategiesForVertical()`, `getDefaultStrategyIds()` |
| MODIFY | `components/dashboard/leadgen/CampaignBuilderModal.jsx` | Add strategy chip state, toggle handler, chip UI section, update query-building effects, update campaign save shape |

**Only 2 files change.** No API changes, no new files, no new dependencies.

---

## Implementation Order

1. Add `QUERY_STRATEGIES_GENERIC` and `queryStrategies` to each vertical in `vertical-map.js`
2. Add `buildStrategicQueries`, `getStrategiesForVertical`, `getDefaultStrategyIds` functions
3. Update `CampaignBuilderModal.jsx` state + effects
4. Add the strategy chip UI + CSS
5. Update campaign save payload to include `strategies`
6. Test: select Lawyer + ZIP 60115, toggle Intent + Niche, verify 6–8 queries appear
7. Test: switch to Custom vertical, verify no strategies appear, only manual input
8. Test: save campaign, verify `strategies` array persists in Firestore config

---

## Complete Strategy Map Reference

| Strategy ID | Type | Default On | Description | Example Template |
|------------|------|-----------|-------------|-----------------|
| `broad` | Generic | Yes | Wide net discovery | `{noun} near {loc}` |
| `rated` | Generic | Yes | High-rated businesses | `top rated {noun} near {loc}` |
| `affordable` | Generic | No | Budget-positioned independents | `affordable {noun} near {loc}` |
| `local_independent` | Generic | No | Family-owned / local | `family owned {noun} near {loc}` |
| `emergency` | Generic | No | Urgent inbound seekers | `emergency {noun} near {loc}` |
| `intent` | Per-vertical | Yes | Growth signals (consultations, accepting clients) | Varies by vertical |
| `niche` | Per-vertical | No | Sub-specialty targeting | Varies by vertical |
| `seasonal` | Per-vertical | No | Time-sensitive services | Varies by vertical |
