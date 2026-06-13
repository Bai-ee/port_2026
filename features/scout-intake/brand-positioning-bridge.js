'use strict';

// brand-positioning-bridge.js
//
// Derives sub-layer search terms from snapshot.brandOverview positioning fields
// and writes them to client_configs/{clientId}.scoutConfig.positioningContext.
//
// "Sub-layer" means: not searching for the brand name (top-layer), but for the
// specific community conversations where the target audience is discussing the
// pain point this brand solves. These become viralTriggers and audienceSignals
// in the runtime search plan, producing materially better brief content.
//
// Called fire-and-forget whenever brandOverview is saved with meaningful content.

const fb = require('../../api/_lib/firebase-admin.cjs');
const { callAnthropic } = require('./_anthropic-client');

const TRIGGER_FIELDS = ['positioning', 'targetAudience', 'businessModel'];

function isSubstantive(v) {
  return typeof v === 'string' && v.trim().length >= 15;
}

function hasMeaningfulPositioning(brandOverview) {
  return TRIGGER_FIELDS.some((f) => isSubstantive(brandOverview?.[f]));
}


// ── Haiku tool ─────────────────────────────────────────────────────────────────

const BRIDGE_TOOL = {
  name: 'extract_positioning_search_terms',
  description: 'Extract sub-layer search terms from brand positioning. These go BELOW the brand name — they find the community conversations where the target audience is discussing the problem this brand solves, BEFORE they found a solution.',
  input_schema: {
    type: 'object',
    required: ['viralTriggers', 'audienceSignals', 'categorySignals'],
    properties: {
      viralTriggers: {
        type: 'array',
        description: 'Search queries for the WEDGE conversations — where the positioning is the answer. Find communities discussing the problem, not the brand. Reddit threads, forum posts, complaints about the old solution. 3-5 items. Append "site:reddit.com" to at least one.',
        items: { type: 'string' },
      },
      audienceSignals: {
        type: 'array',
        description: 'Queries that surface the target audience discussing their specific pain points — what they search AFTER being burned by the old solution. Not broad category terms. 2-4 items.',
        items: { type: 'string' },
      },
      categorySignals: {
        type: 'array',
        description: 'Sub-niche category terms — not the broad category but the specific competitive sub-space this positioning occupies. 2-3 items.',
        items: { type: 'string' },
      },
    },
  },
};

async function deriveFromPositioning(brandOverview) {
  const { positioning = '', targetAudience = '', businessModel = '', headline = '' } = brandOverview;

  const prompt = `Extract sub-layer search terms from this brand positioning for a marketing intelligence scout.

The scout runs daily searches to find relevant community conversations. Avoid generic top-layer queries (brand name, broad industry terms). Find the SPECIFIC conversations this positioning is built to answer.

POSITIONING: ${positioning || '(empty)'}
TARGET AUDIENCE: ${targetAudience || '(empty)'}
BUSINESS MODEL: ${businessModel || '(empty)'}
HEADLINE: ${headline || '(empty)'}

Focus on: Reddit threads, community forums, complaint posts — where the audience discusses the problem BEFORE finding a solution like this one. Include at least one "site:reddit.com" query in viralTriggers.`;

  const response = await callAnthropic({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    tools: [BRIDGE_TOOL],
    tool_choice: { type: 'tool', name: 'extract_positioning_search_terms' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content?.find((b) => b.type === 'tool_use');
  if (!toolUse?.input) throw new Error('No tool_use in positioning bridge response');

  return {
    viralTriggers: Array.isArray(toolUse.input.viralTriggers) ? toolUse.input.viralTriggers : [],
    audienceSignals: Array.isArray(toolUse.input.audienceSignals) ? toolUse.input.audienceSignals : [],
    categorySignals: Array.isArray(toolUse.input.categorySignals) ? toolUse.input.categorySignals : [],
    derivedAt: new Date().toISOString(),
    isDefault: false,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Derive sub-layer search terms from brandOverview positioning fields and write
 * to client_configs/{clientId}.scoutConfig.positioningContext.
 * Non-fatal — intended for fire-and-forget use.
 *
 * @param {string} clientId
 * @param {object} brandOverview - snapshot.brandOverview fields
 */
async function applyPositioningBridge(clientId, brandOverview) {
  if (!clientId) return;

  try {
    // Only derive when there's actual positioning content to work from.
    // No data → no write. Wrong defaults are worse than no defaults.
    if (!hasMeaningfulPositioning(brandOverview)) return;

    const positioningContext = await deriveFromPositioning(brandOverview);

    const ref = fb.adminDb.collection('client_configs').doc(clientId);
    try {
      await ref.update({ 'scoutConfig.positioningContext': positioningContext });
    } catch (updateErr) {
      // Doc may not exist yet — fall back to set with merge
      if (updateErr.code === 5 || String(updateErr.message).includes('NOT_FOUND')) {
        await ref.set({ scoutConfig: { positioningContext } }, { merge: true });
      } else {
        throw updateErr;
      }
    }

    const label = positioningContext.isDefault ? 'default framework' : 'derived from positioning';
    console.log(`[positioning-bridge] positioningContext written for ${clientId} (${label}): ${positioningContext.viralTriggers.length} triggers`);
  } catch (err) {
    console.warn(`[positioning-bridge] non-fatal failure for ${clientId}: ${err.message}`);
  }
}

module.exports = { applyPositioningBridge };
