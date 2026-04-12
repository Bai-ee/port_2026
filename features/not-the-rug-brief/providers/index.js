// providers/index.js — Provider factory
//
// createProvider(providerConfig) — instantiate a provider by name.
// initProvider(providerConfig)   — initialize the module-level singleton.
// getProvider()                  — return the current singleton (default: anthropic).
//
// The singleton pattern lets existing modules call getProvider() once and cache
// the result locally without each module needing to know the active provider name.
// initProvider() is called by runtime.js before the pipeline starts so the correct
// provider is in place for all modules that run under that pipeline invocation.
//
// Supported providers (Phase 2): anthropic
// Future providers: kimi, minimax, openai — add cases below when credentials exist.

const { createAnthropicAdapter } = require('./anthropic');

const SUPPORTED_PROVIDERS = ['anthropic'];

let _singleton = null;

/**
 * Instantiate a provider adapter by name.
 * @param {object} [providerConfig] - e.g. { defaultProvider: 'anthropic' }
 */
function createProvider(providerConfig = {}) {
  const name = String(providerConfig?.defaultProvider || 'anthropic').toLowerCase();
  switch (name) {
    case 'anthropic':
      return createAnthropicAdapter();
    default:
      throw new Error(
        `Unsupported provider "${name}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`
      );
  }
}

/**
 * Initialize and store the module-level provider singleton.
 * Call this once at pipeline startup (e.g. from runtime.js) before any module
 * calls getProvider().
 * @param {object} [providerConfig]
 * @returns {object} The initialized provider
 */
function initProvider(providerConfig = {}) {
  _singleton = createProvider(providerConfig);
  return _singleton;
}

/**
 * Return the current provider singleton.
 * Falls back to Anthropic if initProvider() has not been called yet
 * (preserves backwards compat for standalone module execution).
 */
function getProvider() {
  if (!_singleton) {
    _singleton = createAnthropicAdapter();
  }
  return _singleton;
}

module.exports = {
  createProvider,
  initProvider,
  getProvider,
  SUPPORTED_PROVIDERS,
};
