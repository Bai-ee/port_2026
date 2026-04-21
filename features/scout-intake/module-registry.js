'use strict';

const REGISTRY = {
  'multi-device-view': {
    cardId: 'multi-device-view',
    label: 'Multi-Device View',
    category: 'onboarding',
    dependencies: ['site-fetch', 'screenshots', 'device-mockup'],
    tech: ['browserless', 'firebase-storage', 'python-mockup'],
    cacheOnSuccess: true,
    retryOnFailure: true,
    foundational: true,
  },
  'social-preview': {
    cardId: 'social-preview',
    label: 'Social Preview Check',
    category: 'onboarding',
    dependencies: ['site-fetch', 'site-meta'],
    tech: ['html-fetch', 'meta-parser'],
    cacheOnSuccess: true,
    retryOnFailure: true,
  },
  'seo-performance': {
    cardId: 'seo-performance',
    label: 'SEO + Performance Snapshot',
    category: 'onboarding',
    dependencies: ['site-fetch', 'pagespeed', 'ai-seo'],
    tech: ['pagespeed-insights', 'anthropic', 'ai-seo-audit'],
    cacheOnSuccess: true,
    retryOnFailure: true,
  },
  'style-guide': {
    cardId: 'style-guide',
    label: 'Brand Snapshot',
    category: 'onboarding',
    dependencies: ['site-fetch', 'design-system-extractor', 'style-guide-synthesizer'],
    tech: ['html-fetch', 'css-parser', 'anthropic'],
    cacheOnSuccess: true,
    retryOnFailure: true,
  },
};

function getModuleDefinition(cardId) {
  return REGISTRY[cardId] || null;
}

function resolveModuleDependencies(cardIds) {
  const deps = new Set();
  for (const cardId of cardIds) {
    const mod = REGISTRY[cardId];
    if (mod) {
      for (const dep of mod.dependencies) deps.add(dep);
    }
  }
  return Array.from(deps);
}

function isFoundationalModule(cardId) {
  return Boolean(REGISTRY[cardId]?.foundational);
}

function getDefaultModuleConfig() {
  const config = {};
  for (const [cardId, def] of Object.entries(REGISTRY)) {
    config[cardId] = {
      enabled: Boolean(def.foundational),
      autoRunOnSignup: Boolean(def.foundational),
    };
  }
  return config;
}

function getDefaultModuleState(hasUrl = false) {
  const state = {};
  for (const [cardId, def] of Object.entries(REGISTRY)) {
    const foundational = Boolean(def.foundational);
    state[cardId] = {
      status: foundational && hasUrl ? 'queued' : (foundational ? 'idle' : 'disabled'),
      enabled: foundational,
    };
  }
  return state;
}

module.exports = {
  REGISTRY,
  getModuleDefinition,
  resolveModuleDependencies,
  isFoundationalModule,
  getDefaultModuleConfig,
  getDefaultModuleState,
};
