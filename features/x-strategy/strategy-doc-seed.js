// strategy-doc-seed.js - the starting DRAFT of the Strategy document, shown until the client's doc is saved once.
// Every section starts EMPTY: no client inherits another client's strategy from code. A client's doc is filled by
// the owner, the chat agent (confirmed proposal), or the approved Client Brain. The home client's former seed text
// lives in scripts/x-content/seed-home-priors.mjs and is written to its own x_strategy_docs doc only when absent.
// Client-safe: plain data.

import { SECTION_KEYS } from './strategy-doc.js';

export const SEED_STRATEGY_SECTIONS = Object.freeze(Object.fromEntries(SECTION_KEYS.map((k) => [k, ''])));
