'use strict';

// scout-config-generator.js — Per-client enrichment config generator.
//
// Produces a dynamic, per-client config that scopes the external scouts
// (web search, reviews, weather, reddit, instagram, …) to what's relevant
// for this specific business.
//
// Design:
//   - One Haiku tool-use call does all the inference (cheap, ~$0.002/run).
//   - A CAPABILITIES registry drives what's in scope for THIS client and how
//     to finalize each section. Adding a new source (e.g. hyper-local events,
//     regulatory monitors, trade publications) is a single registry entry —
//     no changes to runner, scribe, or UI.
//   - Shape mirrors a `clients.js`-style entry from the external scout
//     library so an admin edit surface can later treat the stored doc as
//     if it were an editable .js module.
//   - Never overwrites an existing saved config unless { force: true } —
//     the product rule is "generate once" (one-shot at first intake).
//
// Entry point:
//   await ensureScoutConfig({ clientId, clientName, intakeResult, userContext, force?: false })
//
// Returns the (existing or freshly generated) scoutConfig, and a
// generation outcome that runner.js logs/warns on.

const { getScoutConfig, saveScoutConfig } = require('./scout-config-store');
const { callAnthropic, extractAnthropicUsage } = require('./_anthropic-client');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1400;

// ── Helpers ──────────────────────────────────────────────────────────────────

function str(v, fb = '') { return typeof v === 'string' && v.trim() ? v.trim() : fb; }
function arr(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }

function hostnameOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url); }
}

function detectInstagramFromSite(evidence) {
  const pages = evidence?.pages || [];
  for (const p of pages) {
    for (const link of arr(p.socialLinks)) {
      if (/instagram\.com\//i.test(link)) {
        const m = link.match(/instagram\.com\/([^/?#]+)/i);
        if (m && m[1] && !/^p\b|^reel\b|^tv\b/i.test(m[1])) return m[1].replace(/\/$/, '');
      }
    }
  }
  return null;
}

function detectContactAddress(evidence) {
  // Evidence contactClues entries look like `email:x@y.com` or `phone:+1...`.
  // We don't currently extract street addresses — this detector returns null
  // until intake is extended. The capability-registry still uses signals
  // *inferred by the LLM* from other surface text to enable weather/reviews.
  const pages = evidence?.pages || [];
  for (const p of pages) {
    for (const clue of arr(p.contactClues)) {
      if (clue.startsWith('phone:')) return { signal: 'phone_present' };
    }
  }
  return null;
}

// ── Capabilities registry ────────────────────────────────────────────────────
//
// Each entry describes one enrichment source. The Haiku call is prompted to
// fill every capability the detector marks `enabled`. Adding a new capability
// later = append one entry.
//
// Shape:
//   id                 — machine id, becomes a top-level key on scoutConfig
//   summary            — one-line description passed into the LLM prompt
//   detect(ctx)        — returns { enabled, reason, hints }
//                        When enabled=false the capability renders as `null`
//                        on the output and is omitted from the Haiku schema.
//   defaults(ctx, out) — post-process the LLM output section to apply safe
//                        defaults (thresholds, limits, user-agent envs, etc.)
//
// Capabilities below are the starting set. The user has stated this list
// will "grow substantially" — add new ones here without touching runner.

const CAPABILITIES = [
  {
    id: 'brandKeywords',
    summary: 'Exact brand and product name match strings to feed into web searches. Include the exact brand name quoted, the canonical hostname, and the top 1-2 product/service names.',
    detect: () => ({ enabled: true, reason: 'always' }),
    defaults: (_ctx, section) => (Array.isArray(section) ? section : []).slice(0, 8),
  },
  {
    id: 'competitors',
    summary: 'Likely named competitors in the same space. Infer from industry + positioning. Flag as INFERRED — admin review expected.',
    detect: () => ({ enabled: true, reason: 'always' }),
    defaults: (_ctx, section) => (Array.isArray(section) ? section : []).slice(0, 8),
  },
  {
    id: 'categoryTerms',
    summary: 'Category-level search terms capturing the broader conversation the brand sits inside (not the brand name). Mix of trends, tooling, region.',
    detect: () => ({ enabled: true, reason: 'always' }),
    defaults: (_ctx, section) => (Array.isArray(section) ? section : []).slice(0, 10),
  },
  {
    id: 'kols',
    summary: 'Handles, influencers, or industry voices worth tracking. Empty array if none can be confidently inferred.',
    detect: () => ({ enabled: true, reason: 'always' }),
    defaults: (_ctx, section) => (Array.isArray(section) ? section : []).slice(0, 8),
  },
  {
    id: 'reddit',
    summary: 'Reddit scouting config. ALWAYS enabled. Fill subreddits by category + geography and mention/opportunity queries scoped to the brand.',
    detect: () => ({ enabled: true, reason: 'always' }),
    defaults: (_ctx, section) => ({
      provider:                       'web-search',
      brandTerms:                     arr(section?.brandTerms).slice(0, 6),
      mentionQueries:                 arr(section?.mentionQueries).slice(0, 6),
      subreddits:                     arr(section?.subreddits).slice(0, 10),
      opportunityQueries:             arr(section?.opportunityQueries).slice(0, 8),
      limitPerQuery:                  3,
      maxMentions:                    5,
      maxParticipationOpportunities:  8,
    }),
  },
  {
    id: 'weather',
    summary: 'Weather config — only enable for local, weather-sensitive businesses (restaurants, services, events, retail with foot traffic). Provide 1-2 neighborhoods with lat/lon when possible.',
    detect: (ctx) => {
      // Heuristic: presence of a phone number on-site + industry hint in the
      // brand overview that reads local. Final decision deferred to LLM —
      // the detector just decides whether to ask.
      const hasPhone = detectContactAddress(ctx.evidence) != null;
      const industryText = str(ctx.snapshot?.brandOverview?.industry).toLowerCase();
      const localish = /restaurant|cafe|retail|salon|studio|gym|clinic|store|shop|service|event|bar|bakery|walker|groomer|cleaner|clinic|practice/.test(industryText);
      return { enabled: hasPhone && localish, reason: hasPhone && localish ? 'local_business_signal' : 'no_local_signal' };
    },
    defaults: (_ctx, section) => {
      if (!section) return null;
      return {
        provider:                     'nws',
        operationalWindowStartHour:   Number(section.operationalWindowStartHour ?? 7),
        operationalWindowHours:       Number(section.operationalWindowHours ?? 12),
        serviceNeighborhoods:         arr(section.serviceNeighborhoods).slice(0, 2).map((n) => ({
          name:      str(n.name),
          latitude:  Number(n.latitude),
          longitude: Number(n.longitude),
        })).filter((n) => n.name && Number.isFinite(n.latitude) && Number.isFinite(n.longitude)),
        thresholds: {
          heatWatchTempF:         80,
          heatRiskTempF:          85,
          coldRiskTempF:          35,
          highRainChancePct:      50,
          moderateRainChancePct:  30,
          windyMph:               18,
        },
      };
    },
  },
  {
    id: 'reviews',
    summary: 'Review scouting config — only for businesses with a likely Google/Yelp/TripAdvisor presence. Provide 1-3 query strings scoped to the business name + platform.',
    detect: (ctx) => {
      const industryText = str(ctx.snapshot?.brandOverview?.industry).toLowerCase();
      const reviewable = /restaurant|cafe|retail|salon|hotel|venue|studio|clinic|store|shop|bar|bakery|service|walker|groomer/.test(industryText);
      return { enabled: reviewable, reason: reviewable ? 'reviewable_vertical' : 'not_review_heavy' };
    },
    defaults: (_ctx, section) => {
      if (!section) return null;
      return {
        provider: 'web-search',
        sources:  arr(section.sources).slice(0, 3).map((s) => ({
          key:    str(s.key),
          label:  str(s.label),
          query:  str(s.query),
        })).filter((s) => s.query),
      };
    },
  },
  {
    id: 'instagram',
    summary: 'Instagram scouting config — only when a handle can be confidently detected. Fill handle + profileUrl.',
    detect: (ctx) => {
      const handle = detectInstagramFromSite(ctx.evidence);
      return { enabled: Boolean(handle), reason: handle ? 'handle_detected' : 'no_handle', hints: { handle } };
    },
    defaults: (ctx, _section) => {
      const handle = detectInstagramFromSite(ctx.evidence);
      if (!handle) return null;
      return {
        provider:   'web-search',
        handle,
        profileUrl: `https://instagram.com/${handle}`,
      };
    },
  },
  {
    id: 'scout',
    summary: 'Top-level scout analysis plan. searchPlan[] must contain 5 entries with labels BRAND, COMPETITORS, CATEGORY, KOLS, VIRAL WINDOWS. Each with a `query` string and one-line `goal`. Also set freshnessDays (1-14), sourceFocus paragraph, analysisInstructions paragraph, and kolSearchSuffix.',
    detect: () => ({ enabled: true, reason: 'always' }),
    defaults: (_ctx, section) => ({
      freshnessDays:         Number(section?.freshnessDays ?? 7),
      sourceFocus:           str(section?.sourceFocus),
      kolSearchSuffix:       str(section?.kolSearchSuffix),
      analysisInstructions:  str(section?.analysisInstructions),
      searchPlan:            arr(section?.searchPlan).slice(0, 5).map((p) => ({
        label: str(p.label),
        query: str(p.query),
        goal:  str(p.goal),
      })).filter((p) => p.label && p.query),
    }),
  },
];

// ── Tool schema (dynamic, driven by the active capabilities) ────────────────

function buildToolSchema(activeCaps) {
  // Map each capability to its JSON schema fragment. Only capabilities whose
  // detector marked them active are included — reduces the LLM's job and
  // avoids prompting it to fill weather config for a SaaS company.
  const properties = {
    clientType: {
      type: 'string',
      enum: ['local_business', 'online_service', 'saas', 'ecommerce', 'content', 'marketplace', 'other'],
      description: 'One-word classifier for the business.',
    },
    timeZone: {
      type: 'string',
      description: 'IANA timezone (e.g. "America/New_York"). Empty string if unknown.',
    },
  };

  for (const cap of activeCaps) {
    switch (cap.id) {
      case 'brandKeywords':
      case 'competitors':
      case 'categoryTerms':
      case 'kols':
        properties[cap.id] = { type: 'array', items: { type: 'string' }, description: cap.summary };
        break;
      case 'reddit':
        properties.reddit = {
          type: 'object',
          description: cap.summary,
          properties: {
            brandTerms:         { type: 'array', items: { type: 'string' } },
            mentionQueries:     { type: 'array', items: { type: 'string' } },
            subreddits:         { type: 'array', items: { type: 'string' } },
            opportunityQueries: { type: 'array', items: { type: 'string' } },
          },
          required: ['subreddits', 'mentionQueries'],
        };
        break;
      case 'weather':
        properties.weather = {
          type: 'object',
          description: cap.summary,
          properties: {
            operationalWindowStartHour: { type: 'number' },
            operationalWindowHours:     { type: 'number' },
            serviceNeighborhoods: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name:      { type: 'string' },
                  latitude:  { type: 'number' },
                  longitude: { type: 'number' },
                },
                required: ['name', 'latitude', 'longitude'],
              },
            },
          },
          required: ['serviceNeighborhoods'],
        };
        break;
      case 'reviews':
        properties.reviews = {
          type: 'object',
          description: cap.summary,
          properties: {
            sources: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key:   { type: 'string' },
                  label: { type: 'string' },
                  query: { type: 'string' },
                },
                required: ['key', 'query'],
              },
            },
          },
          required: ['sources'],
        };
        break;
      case 'instagram':
        // Instagram is detected structurally — no LLM fill needed.
        break;
      case 'scout':
        properties.scout = {
          type: 'object',
          description: cap.summary,
          properties: {
            freshnessDays:         { type: 'number' },
            sourceFocus:           { type: 'string' },
            kolSearchSuffix:       { type: 'string' },
            analysisInstructions:  { type: 'string' },
            searchPlan: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  query: { type: 'string' },
                  goal:  { type: 'string' },
                },
                required: ['label', 'query', 'goal'],
              },
            },
          },
          required: ['searchPlan', 'freshnessDays'],
        };
        break;
    }
  }

  const required = ['clientType'];
  for (const cap of activeCaps) {
    if (cap.id === 'instagram') continue; // filled structurally
    if (properties[cap.id]) required.push(cap.id);
  }

  return {
    name: 'write_scout_config',
    description: 'Emit a per-client enrichment config. Infer fields from the provided intake. Never invent specific facts outside the provided context.',
    input_schema: {
      type: 'object',
      required,
      properties,
    },
  };
}

// ── Prompt ──────────────────────────────────────────────────────────────────

function buildPrompt({ clientName, intakeResult, userContext, evidence, activeCaps }) {
  const bo = intakeResult?.snapshot?.brandOverview || {};
  const bt = intakeResult?.snapshot?.brandTone || {};
  const strat = intakeResult?.strategy || {};
  const siteMeta = intakeResult?.siteMeta || null;
  const url = intakeResult?.websiteUrl || '';
  const host = hostnameOf(url);

  // Pull the FULL crawl text. This is the ground truth — tells us what the
  // site actually says, not what a prior LLM inferred. We intentionally
  // prioritize this over any synth-derived fields below, because synth has
  // been observed to produce wrong/stale industry strings for some runs.
  const pages = evidence?.pages || [];
  const homepage = pages.find((p) => p.type === 'homepage') || pages[0] || null;
  const rawHeadlines = [];
  const rawBody = [];
  for (const p of pages) {
    if (p.h1?.[0]) rawHeadlines.push(p.h1[0]);
    if (p.title) rawHeadlines.push(p.title);
    for (const para of (p.bodyParagraphs || []).slice(0, 3)) rawBody.push(para);
  }
  const ogTags = siteMeta ? [
    siteMeta.title      ? `og:title — ${siteMeta.title}` : null,
    siteMeta.description ? `og:description — ${siteMeta.description}` : null,
    siteMeta.siteName   ? `og:site_name — ${siteMeta.siteName}` : null,
  ].filter(Boolean).join('\n  ') : '';

  const evidenceBlock = `
SITE EVIDENCE — GROUND TRUTH (this is what the site actually says — trust this before any prior inference)
- url: ${url}
- homepage <title>: ${homepage?.title || '(none)'}
- homepage <h1>: ${(homepage?.h1 || []).slice(0, 3).join(' | ') || '(none)'}
- homepage <meta description>: ${homepage?.metaDescription || '(none)'}
- additional headlines across pages: ${rawHeadlines.slice(0, 6).join(' | ') || '(none)'}
- body excerpts:
  ${rawBody.slice(0, 6).map((b) => `• ${b.slice(0, 200)}`).join('\n  ') || '(none)'}
${ogTags ? `- Open Graph / Twitter tags:\n  ${ogTags}` : ''}
- page types crawled: ${pages.map((p) => p.type).join(', ') || '(none)'}
`.trim();

  // Prior inference — explicitly labeled as potentially stale/wrong so the
  // LLM doesn't anchor on it when the evidence above says something else.
  const priorBlock = `
PRIOR INFERENCE (from an upstream synthesizer — MAY BE STALE OR INCORRECT; ignore any field that contradicts SITE EVIDENCE)
- industry (inferred): ${str(bo.industry) || '(empty)'}
- business model (inferred): ${str(bo.businessModel) || '(empty)'}
- target audience (inferred): ${str(bo.targetAudience) || '(empty)'}
- positioning (inferred): ${str(bo.positioning) || '(empty)'}
- tone (inferred): ${[bt.primary, bt.secondary].filter(Boolean).join(', ') || '(empty)'}
- post formats (inferred): ${Array.isArray(strat.postStrategy?.formats) ? strat.postStrategy.formats.join(', ') : '(empty)'}
`.trim();

  const userCtxLines = userContext
    ? Object.entries(userContext)
        .filter(([k, v]) => k !== '_meta' && v != null && String(v).trim())
        .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\n')
    : '';

  const capList = activeCaps.map((c) => `  - ${c.id}: ${c.summary}`).join('\n');

  return `You are preparing an enrichment config for a live client pipeline.

CLIENT
- name: ${clientName || host || 'Unknown'}
- site: ${url || '(none)'}
- host: ${host}

${evidenceBlock}

${priorBlock}

${userCtxLines ? `USER-PROVIDED CONTEXT\n${userCtxLines}\n` : ''}

ACTIVE CAPABILITIES (fill each one in your response)
${capList}

RULES — READ CAREFULLY
- AUTHORITY: SITE EVIDENCE is ALWAYS authoritative. PRIOR INFERENCE is a hint that was produced by another LLM and may be wrong for this site. If the PRIOR says "video automation" but the SITE EVIDENCE is about voice journaling, you MUST describe a voice journaling brand. Evidence wins every time.
- Do NOT produce an industry, competitors, category terms, or search queries that are unsupported by (or contradict) the SITE EVIDENCE. Ignore prior inference whenever it disagrees with the crawl.
- Read the <title>, <h1>, meta description, and body excerpts carefully. The core product / service / category should be obvious from that language.
- Every string should be concrete and searchable. No marketing filler.
- brandKeywords: exact-match quoted forms (e.g. "\\"Claire Calls\\""), include the hostname, include product names actually named on the site.
- competitors: name real alternatives in the same space as the CRAWLED content. These will be reviewed by a human — OK to be directional but must match the real category.
- categoryTerms: broad conversation the brand sits inside. Must reflect the CRAWLED category, not something inferred from an unrelated prior.
- kols: real handles/publications that cover this exact space. Empty array if not confidently inferable.
- reddit.subreddits: 5-10 subreddits relevant to the CRAWLED category + geography (when applicable). No leading "r/".
- reddit.mentionQueries: quoted brand/product strings from the site.
- reddit.opportunityQueries: non-branded phrasings buyers of THIS product would use.
- weather: only if this is a local, foot-traffic-sensitive business. Omit otherwise.
- reviews: only if Google/Yelp/TripAdvisor are likely sources of social proof. Omit otherwise.
- scout.searchPlan: exactly 5 entries, labels BRAND, COMPETITORS, CATEGORY, KOLS, VIRAL WINDOWS, in that order. Each query targets the CRAWLED business, not the prior-inferred business.
- timeZone: set to IANA zone only if inferrable from crawled content, else empty string.

Call write_scout_config with the filled config.`;
}

// ── Cost extraction ─────────────────────────────────────────────────────────

function extractUsage(response) {
  // Haiku 4.5 pricing
  return extractAnthropicUsage(response, {
    model: MODEL,
    inputRate: 0.000001,
    outputRate: 0.000005,
  });
}

function extractToolInput(response) {
  if (!Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'write_scout_config') {
      return block.input || null;
    }
  }
  return null;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Build a fresh scoutConfig. Does NOT consult the store — use
 * ensureScoutConfig for the cached/generate-once path.
 */
async function generateScoutConfig({ clientId, clientName, intakeResult, userContext, evidence, websiteUrl: websiteUrlArg = null }) {
  // websiteUrl can come from three places — take the first truthy.
  const websiteUrl = str(websiteUrlArg) || str(intakeResult?.websiteUrl) || str(evidence?.url) || null;
  const ctx = {
    clientId,
    clientName,
    intakeResult: { ...(intakeResult || {}), websiteUrl },
    userContext,
    evidence,
    snapshot: intakeResult?.snapshot || null,
  };

  // Run detectors — each capability either enabled, or skipped.
  const activeCaps = [];
  const inactive = [];
  for (const cap of CAPABILITIES) {
    const d = cap.detect(ctx);
    if (d.enabled) activeCaps.push(cap);
    else inactive.push({ id: cap.id, reason: d.reason });
  }

  const tool = buildToolSchema(activeCaps);
  const prompt = buildPrompt({ clientName, intakeResult, userContext, evidence, activeCaps });

  let response;
  try {
    response = await callAnthropic({
      model:       MODEL,
      max_tokens:  MAX_TOKENS,
      tools:       [tool],
      tool_choice: { type: 'any' },
      messages:    [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    return { ok: false, scoutConfig: null, runCostData: null, error: err.message };
  }

  const runCostData = extractUsage(response);
  const raw = extractToolInput(response);
  if (!raw) {
    return { ok: false, scoutConfig: null, runCostData, error: 'Generator returned no tool_use content.' };
  }

  // Apply defaults + dead capability sections → null.
  const scoutConfig = {
    clientId,
    clientName: clientName || hostnameOf(intakeResult?.websiteUrl) || clientId,
    clientDescriptor: '',
    timeZone: str(raw.timeZone) || null,
  };

  for (const cap of CAPABILITIES) {
    const section = raw[cap.id];
    const d = cap.detect(ctx);
    if (!d.enabled) {
      if (['weather', 'reviews', 'instagram'].includes(cap.id)) scoutConfig[cap.id] = null;
      continue;
    }
    scoutConfig[cap.id] = cap.defaults(ctx, section);
  }

  scoutConfig._meta = {
    generatedAt:      new Date().toISOString(),
    generatedFrom:    'intake-pipeline-v1',
    websiteUrl:       websiteUrl,
    capabilitiesActive:  activeCaps.map((c) => c.id),
    capabilitiesInactive: inactive,
    clientType:       str(raw.clientType) || 'other',
    runCostData,
  };

  return { ok: true, scoutConfig, runCostData, error: null };
}

/**
 * Read the cached scoutConfig; if absent, generate + save. When `force` is
 * true, regenerates and overwrites. Returns { scoutConfig, created, cost }.
 */
async function ensureScoutConfig({ clientId, clientName, intakeResult, userContext, evidence, websiteUrl: websiteUrlArg = null, force = false }) {
  if (!clientId) throw new Error('ensureScoutConfig: clientId required');

  const currentUrl = str(websiteUrlArg) || str(intakeResult?.websiteUrl) || str(evidence?.url) || null;

  if (!force) {
    const existing = await getScoutConfig(clientId);
    if (existing) {
      // Serve the cache ONLY when we can PROVE it was generated for the same
      // site. Missing cachedUrl = config from before the URL-stamp patch →
      // treat as stale and regenerate. This also catches reseeds to new URLs.
      const cachedUrl = existing?._meta?.websiteUrl || null;
      if (cachedUrl && currentUrl && cachedUrl === currentUrl) {
        return { scoutConfig: existing, created: false, cost: null, error: null };
      }
      const reason = !cachedUrl ? 'missing cached URL (pre-patch doc)'
        : !currentUrl ? 'no current URL to compare'
        : `URL changed (${cachedUrl} → ${currentUrl})`;
      console.log(`[scout-config] regenerating for ${clientId} — ${reason}`);
    }
  }

  const result = await generateScoutConfig({ clientId, clientName, intakeResult, userContext, evidence, websiteUrl: currentUrl });
  if (!result.ok) {
    return { scoutConfig: null, created: false, cost: result.runCostData, error: result.error };
  }

  try {
    await saveScoutConfig(clientId, result.scoutConfig);
  } catch (err) {
    return { scoutConfig: result.scoutConfig, created: false, cost: result.runCostData, error: `persist_failed: ${err.message}` };
  }

  return { scoutConfig: result.scoutConfig, created: true, cost: result.runCostData, error: null };
}

module.exports = {
  CAPABILITIES,
  generateScoutConfig,
  ensureScoutConfig,
};
