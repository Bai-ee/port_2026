'use strict';

// index.js — Source registry for the Client Intelligence Layer
// Phase 1: registry scaffolding only.
// Phase 2 will register: features/intelligence/pagespeed.js

/**
 * Each registered module must conform to:
 * {
 *   defaultEnabled: boolean,
 *   fetch: async (clientData: object) => SourceRecord
 * }
 */
const _registry = new Map();

/**
 * Register an intelligence source module.
 * @param {string} sourceId   — stable id (e.g. 'pagespeed-insights')
 * @param {{ defaultEnabled?: boolean, fetch: Function }} mod
 */
function registerSource(sourceId, mod) {
  if (!sourceId || typeof sourceId !== 'string') {
    throw new Error('registerSource: sourceId must be a non-empty string');
  }
  if (!mod || typeof mod.fetch !== 'function') {
    throw new Error(`registerSource(${sourceId}): module must export a fetch function`);
  }
  _registry.set(sourceId, {
    defaultEnabled: mod.defaultEnabled ?? false,
    fetch: mod.fetch,
  });
}

/**
 * Retrieve a registered source module by id.
 * @returns {{ defaultEnabled: boolean, fetch: Function } | undefined}
 */
function getSourceModule(sourceId) {
  return _registry.get(sourceId);
}

/**
 * List the ids of all registered sources.
 * @returns {string[]}
 */
function listRegisteredSources() {
  return [..._registry.keys()];
}

/**
 * List metadata for all registered sources (id + defaultEnabled).
 * @returns {Array<{ id: string, defaultEnabled: boolean }>}
 */
function listRegisteredSourceMeta() {
  return [..._registry.entries()].map(([id, mod]) => ({
    id,
    defaultEnabled: mod.defaultEnabled,
  }));
}

module.exports = {
  registerSource,
  getSourceModule,
  listRegisteredSources,
  listRegisteredSourceMeta,
};
