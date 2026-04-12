// config-loader.js — Runtime config loading strategy
//
// Resolves a runtime config object from two sources:
//
//   1. Static local registry (clients.js) — local dev and known clients.
//      Pass no firestoreClientConfig → uses the static registry.
//
//   2. Firestore client_configs document — dynamic / newly provisioned clients.
//      Pass the client_configs/{clientId} doc from Firestore → builds a generic
//      runtime config from sourceInputs and providerConfig.
//
// The Phase 3 worker will always pass a firestoreClientConfig.
// The local dev CLI (run.js) passes nothing and falls back to the static registry.

const { getClientConfig } = require('./clients');

// ─── Generic agent data template ──────────────────────────────────────────────

const DEFAULT_AGENT_DATA_TEMPLATE = `{
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","url":"..."}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","url":"..."}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"..."}],
  "contentOpportunities": {
    "found": true,
    "opportunities": [{"topic":"...","whyNow":"...","format":"...","priority":"high|medium|low","source":"...","url":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  },
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"..."}]
}`;

// ─── Default intelligence config for generic clients ──────────────────────────

const DEFAULT_INTELLIGENCE_CONFIG = {
  primarySignalsKey: 'categoryTrends',
  primarySignalsLabel: 'Category Signals',
  promptPrimarySignalLabel: 'Category Context',
  primarySignalsFallback: 'No category signals detected this cycle.',
  contentOpportunitiesKey: 'contentOpportunities',
  contentOpportunitiesLabel: 'Content Opportunities',
  promptContentOpportunitiesLabel: 'Content Opportunities',
  contentOpportunitiesFallback: 'Scout found NO content opportunities this cycle.',
  brandMentionsLabel: 'Brand Mentions',
  relationshipSignalsKey: 'competitorIntel',
  relationshipSignalsLabel: 'Competitor Intel',
  promptRelationshipSignalsLabel: 'Competitor Intel',
  relationshipSignalsFallback: 'No competitor intel surfaced this cycle.',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHostname(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url || '');
  }
}

function deriveCompanyName(hostname, clientId) {
  if (!hostname) return clientId || 'Client';
  const root = hostname.split('.')[0] || clientId || 'Client';
  return root
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName }) {
  const brandQuery = [`"${companyName}"`, hostname ? `"${hostname}"` : null, hostname ? `site:${hostname}` : null]
    .filter(Boolean)
    .join(' OR ');

  const ideaTerms = ideaDescription
    ? ideaDescription.split(/[\s,./]+/).filter((t) => t.length > 3).slice(0, 6).join(' OR ')
    : null;

  const categoryQuery = ideaTerms || `${companyName} industry trends 2026`;
  const opportunityQuery = ideaDescription
    ? `best ${ideaDescription.split(/\s+/).slice(0, 4).join(' ')}`
    : `${companyName} reviews OR ${hostname} competitors`;

  return [
    {
      label: 'BRAND',
      query: brandQuery,
      goal: 'Find direct brand mentions, direct web coverage, and community discussion.',
    },
    {
      label: 'CATEGORY',
      query: categoryQuery,
      goal: 'Capture broader category movement and external narratives the brand can react to.',
    },
    {
      label: 'CONTENT OPPORTUNITIES',
      query: opportunityQuery,
      goal: 'Find live conversations and topics where the brand can contribute credibly.',
    },
  ];
}

// ─── Core builder ─────────────────────────────────────────────────────────────

/**
 * Build a generic runtime config from a Firestore client_configs document.
 *
 * This is used when the client is not in the static registry (newly provisioned
 * clients). The runtime config shape is identical to the static registry shape
 * so all pipeline modules (xscout, scribe, guardian) can consume it without changes.
 *
 * @param {string} clientId
 * @param {object} clientConfig - client_configs/{clientId} document from Firestore
 */
function buildRuntimeConfigFromFirestore(clientId, clientConfig) {
  const sourceInputs = clientConfig?.sourceInputs || {};
  const websiteUrl = String(sourceInputs.websiteUrl || '');
  const ideaDescription = String(sourceInputs.ideaDescription || '').trim();
  const hostname = extractHostname(websiteUrl);
  const companyName = deriveCompanyName(hostname, clientId);

  return {
    clientId,
    clientName: companyName,
    clientDescriptor: ideaDescription || `a business at ${websiteUrl || clientId}`,
    websiteUrl,
    brandKeywords: [
      companyName ? `"${companyName}"` : null,
      hostname ? `"${hostname}"` : null,
    ].filter(Boolean),
    competitors: [],
    categoryTerms: ideaDescription
      ? ideaDescription.split(/[,.\n]+/).map((t) => t.trim()).filter(Boolean).slice(0, 6)
      : [],
    kols: [],
    upcomingEvents: [],

    scout: {
      freshnessDays: 7,
      sourceFocus: ideaDescription
        ? `Focus on "${ideaDescription}". Find market signals, competitor activity, content opportunities, and audience conversations relevant to ${websiteUrl || companyName}.`
        : `Focus on brand signals, competitor activity, and content opportunities for ${websiteUrl || companyName}.`,
      searchPlan: buildSearchPlan({ websiteUrl, ideaDescription, hostname, companyName }),
      agentDataTemplate: DEFAULT_AGENT_DATA_TEMPLATE,
    },

    intelligence: DEFAULT_INTELLIGENCE_CONFIG,

    viralTargets: {
      hashtags: [],
      injectableTopics: ideaDescription ? [ideaDescription] : [],
      viralTriggers: [],
      exclusions: ['politics', 'lawsuit', 'hack', 'exploit', 'scam'],
    },

    scribe: {
      role: 'content writer',
      fallbackTone: `Tone: clear, credible, human, specific to ${companyName}.\nNever use: generic hype language, forced urgency, or empty superlatives.`,
    },

    guardian: {
      reviewerContext: ideaDescription || `a business at ${websiteUrl || clientId}`,
      competitorNames: [],
      restrictedPatterns: [],
    },

    providerConfig: clientConfig?.providerConfig || { defaultProvider: 'anthropic' },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Load a runtime config for a given clientId.
 *
 * Strategy:
 *   1. If firestoreClientConfig is provided, build a runtime config from it.
 *      This is the production path — used by the Phase 3 worker.
 *   2. If the clientId is in the static registry, use that config.
 *      This is the local dev path — used by run.js and standalone module execution.
 *   3. Otherwise throw — cannot run without a config source.
 *
 * @param {string} clientId
 * @param {object|null} [firestoreClientConfig] - client_configs/{clientId} Firestore doc
 */
function loadRuntimeConfig(clientId, firestoreClientConfig = null) {
  if (firestoreClientConfig) {
    return buildRuntimeConfigFromFirestore(clientId, firestoreClientConfig);
  }

  const staticConfig = getClientConfig(clientId);
  if (staticConfig) {
    return staticConfig;
  }

  throw new Error(
    `No runtime config found for clientId "${clientId}". ` +
    `Pass a Firestore client_config document or add the client to the static registry in clients.js.`
  );
}

module.exports = {
  buildRuntimeConfigFromFirestore,
  loadRuntimeConfig,
};
