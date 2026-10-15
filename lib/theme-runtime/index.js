// Public surface of the theme runtime (contract §7.5-7.6, §8).
// The draft store / applier / production definition (engine-importing) are intentionally NOT
// re-exported here: import them from their own modules so the main bundle never pulls the engine.

export { createPrefStore, getPrefStore, DEFAULT_PREFERENCE } from './pref-store.js';
export { useThemePreference, useResolvedMode, useThemeSelector, useStoreSelector } from './hooks.js';
export { readToken, onTokensChanged, emitTokensChanged, TOKENS_CHANGED_EVENT } from './read-token.js';
export { isStudioEnabled, hasStudioQuery } from './studio-gate.js';
export { createSafeStorage } from './storage.js';
export { syncSiteDraft } from './site-draft.js';
export { setSceneBridge, getSceneBridge } from './registry.js';
