'use strict';

const fb = require('../../api/_lib/firebase-admin.cjs');
const { compileClientBrainMarkdown, createClientBrainMarkdownTemplate } = require('./markdown.cjs');

const CLIENT_BRAIN_VERSION = 1;
const DEFAULT_USE_FOR = Object.freeze({
  tone: true,
  strategy: true,
  copy: true,
  audience: true,
  proof: true,
  positioning: true,
  offers: true,
  emailDigest: true,
  socialPosts: true,
  marketingInsights: true,
});

const DEFAULT_DECISION_STATUS = 'suggested';
const MARKETING_BRIEF_CARD_ID = 'marketing-brief';
const MARKET_INSIGHTS_CARD_ID = 'market-insights';
const DEFAULT_MARKETING_SOURCE_PLATFORMS = Object.freeze(['web', 'x', 'reddit', 'hackernews', 'instagram']);
const ACQUISITION_METHODS = new Set(['automatic', 'interview', 'research', 'feedback', 'manual']);

const VALID_SOURCE_TYPES = new Set([
  'onboarding',
  'website',
  'upload',
  'brand_guide',
  'social_profile',
  'past_posts',
  'product_page',
  'competitor',
  'audience_note',
  'client_goal',
  'internal_note',
  'email_digest',
  'marketing_insight',
  'creative_brief',
  'project_strategy',
  'manual_note',
  'repo_doc',
  'analytics',
  'crm',
  'campaign',
  'knowledge_base',
  'other',
]);

// Which Client Brain sections each downstream `useFor` purpose should surface.
const USE_FOR_SECTIONS = Object.freeze({
  tone: ['voice'],
  copy: ['voice', 'positioning'],
  strategy: ['positioning', 'content', 'audience'],
  audience: ['audience'],
  proof: ['proof'],
  positioning: ['positioning'],
  offers: ['offers'],
  emailDigest: ['voice', 'positioning', 'proof'],
  socialPosts: ['voice', 'content', 'offers'],
  marketingInsights: ['positioning', 'audience'],
});

function nowIso() {
  return new Date().toISOString();
}

function compact(value, max = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

// Length-cap that preserves newlines (compact() collapses them).
function capText(value, max = 2500) {
  const text = String(value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

// True if at least one enabled source votes the brain usable for `dim`.
// No sourceRefs at all => permissive (legacy brains predate per-source useFor).
function sectionEnabled(sourceRefs, dim) {
  if (!Array.isArray(sourceRefs) || !sourceRefs.length) return true;
  const enabled = sourceRefs.filter((s) => s.enabled !== false);
  if (!enabled.length) return false;
  return enabled.some((s) => s.useFor?.[dim] !== false);
}

// Build a compact, labeled CLIENT CONTEXT block scoped to the requested
// useFor purpose(s). Returns '' when no enabled source allows any requested
// purpose — the read-time enforcement of the per-source useFor toggles.
function buildUseForContext(brain, useForInput) {
  const dims = (Array.isArray(useForInput) ? useForInput : [useForInput]).filter(Boolean);
  const allowed = dims.filter((d) => sectionEnabled(brain?.sourceRefs, d));
  if (!allowed.length) return '';

  const want = new Set();
  for (const d of allowed) (USE_FOR_SECTIONS[d] || []).forEach((s) => want.add(s));

  const id = brain.identity || {};
  const pos = brain.positioning || {};
  const voice = brain.voice || {};
  const aud = brain.audience || {};
  const proof = brain.proof || {};
  const offers = brain.offers || {};
  const content = brain.content || {};

  const doNot = (Array.isArray(brain.sourceRefs) ? brain.sourceRefs : [])
    .filter((s) => s.enabled !== false && s.doNotUseNotes)
    .map((s) => s.doNotUseNotes);

  const line = (label, val) => {
    const text = Array.isArray(val) ? val.filter(Boolean).join('; ') : String(val || '').trim();
    return text ? `${label}: ${text}` : '';
  };

  const lines = [
    'CLIENT CONTEXT',
    line('Identity', [id.name, id.category, id.primaryUrl].filter(Boolean).join(' · ')),
    line('About', id.description),
  ];
  if (want.has('positioning')) {
    lines.push(line('Positioning', pos.oneLiner || pos.authorityPosition));
    lines.push(line('Differentiation', pos.differentiation));
  }
  if (want.has('voice')) {
    lines.push(line('Voice', voice.toneSummary || voice.writingRules));
    lines.push(line('Do', voice.preferredWords));
    lines.push(line('Do not', [...(voice.bannedWords || []), ...doNot]));
    const fmt = voice.formattingRules && !Array.isArray(voice.formattingRules) && typeof voice.formattingRules === 'object'
      ? Object.entries(voice.formattingRules).map(([k, v]) => `${k}: ${v}`)
      : voice.formattingRules;
    lines.push(line('Copy rules', fmt));
    // Voice pillars as do/avoid guidance.
    (Array.isArray(voice.pillars) ? voice.pillars : []).slice(0, 4).forEach((p) => {
      const guide = [p.do ? `do: ${p.do}` : '', p.dont ? `avoid: ${p.dont}` : ''].filter(Boolean).join('; ');
      lines.push(line(`Voice pillar — ${p.name || p.description}`, guide || p.description));
    });
    // Few-shot example posts — the strongest "sound like me" signal. Match the
    // voice, never copy verbatim. Sourced from CLIENT_BRAIN.md > Example Posts.
    const examples = (Array.isArray(content.postExamples) ? content.postExamples : [])
      .map((e) => compact(typeof e === 'string' ? e : e.post, 220))
      .filter(Boolean)
      .slice(0, 4);
    if (examples.length) {
      lines.push('Example posts (imitate this voice, do not copy verbatim):');
      examples.forEach((post) => lines.push(`- ${post}`));
    }
  } else if (doNot.length) {
    lines.push(line('Do not', doNot));
  }
  if (want.has('audience')) {
    lines.push(line('Audience', aud.primary));
    lines.push(line('Motivations', aud.motivations));
    lines.push(line('Objections', aud.objections));
  }
  if (want.has('proof')) {
    lines.push(line('Proof', proof.projects));
    lines.push(line('Metrics', proof.metrics));
  }
  if (want.has('offers')) {
    lines.push(line('Offers', offers.services));
    lines.push(line('CTAs', offers.callsToAction));
  }
  if (want.has('content')) {
    lines.push(line('Content pillars', content.pillars));
  }
  return lines.filter(Boolean).join('\n');
}

function asArray(value, limit = 12) {
  if (Array.isArray(value)) return value.map((v) => compact(typeof v === 'string' ? v : JSON.stringify(v), 160)).filter(Boolean).slice(0, limit);
  const text = compact(value, 240);
  return text ? [text] : [];
}

function cleanList(input, { maxItems = 20, maxLen = 160 } = {}) {
  const rows = Array.isArray(input)
    ? input
    : String(input || '').split(/[\n,]+/);
  return rows
    .map((item) => String(item || '').trim().slice(0, maxLen))
    .filter(Boolean)
    .filter((item, index, arr) => {
      const key = item.toLowerCase().replace(/^@+/, '').replace(/^["']|["']$/g, '');
      return arr.findIndex((other) => other.toLowerCase().replace(/^@+/, '').replace(/^["']|["']$/g, '') === key) === index;
    })
    .slice(0, maxItems);
}

function cleanSearchRows(input, limit = 8) {
  return (Array.isArray(input) ? input : [])
    .map((row, index) => ({
      label: compact(row?.label || `SEARCH ${index + 1}`, 60),
      query: compact(row?.query, 600),
      goal: compact(row?.goal, 240),
    }))
    .filter((row) => row.query)
    .slice(0, limit);
}

function normalizeAcquisition(meta = {}) {
  const acquisition = meta.acquisition && typeof meta.acquisition === 'object' ? meta.acquisition : {};
  const method = ACQUISITION_METHODS.has(acquisition.method)
    ? acquisition.method
    : ACQUISITION_METHODS.has(meta.method)
      ? meta.method
      : meta.updatedBy === 'operator'
        ? 'manual'
        : 'automatic';
  return {
    method,
    confidenceReason: acquisition.confidenceReason || meta.confidenceReason || (method === 'feedback' ? 'Promoted from card settings.' : 'Derived from enabled Client Brain sources.'),
    researchRequired: Boolean(acquisition.researchRequired),
    lastValidatedAt: acquisition.lastValidatedAt || meta.updatedAt || nowIso(),
    validationStatus: acquisition.validationStatus || (meta.status === 'approved' ? 'approved' : 'pending'),
  };
}

function decisionValue(value, meta = {}) {
  return {
    value,
    status: meta.status || DEFAULT_DECISION_STATUS,
    confidence: meta.confidence || 'medium',
    sourceIds: Array.isArray(meta.sourceIds) ? meta.sourceIds.filter(Boolean) : [],
    updatedBy: meta.updatedBy || 'system',
    updatedAt: meta.updatedAt || nowIso(),
    appliedToCards: Array.isArray(meta.appliedToCards) ? meta.appliedToCards.filter(Boolean) : [],
    acquisition: normalizeAcquisition(meta),
  };
}

function decisionList(input, meta = {}, opts = {}) {
  return decisionValue(cleanList(input, opts), meta);
}

function decisionScalar(input, meta = {}) {
  return decisionValue(compact(input, meta.max || 400), meta);
}

function valueOfDecision(decision, fallback) {
  if (decision && typeof decision === 'object' && Object.prototype.hasOwnProperty.call(decision, 'value')) {
    return decision.value;
  }
  return fallback;
}

function slugify(value, fallback = 'decision-driver') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function dateFromFirestore(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value._seconds) return new Date(value._seconds * 1000).toISOString();
  return null;
}

function clientBrainRef(clientId) {
  return fb.adminDb.collection('clients').doc(clientId).collection('client_brain').doc('current');
}

// Light single-doc read of the raw Client Brain (no bundle, no sourceRefs
// merge). Used by the voice resolver, which needs the structured brain rather
// than the precomputed context string. Returns null when absent.
async function readClientBrainDoc(clientId) {
  if (!clientId) return null;
  const snap = await clientBrainRef(clientId).get();
  return snap.exists ? (snap.data() || null) : null;
}

function dashboardStateRef(clientId) {
  return fb.adminDb.collection('dashboard_state').doc(clientId);
}

function confidenceFromSources(sourceRefs = []) {
  const enabled = sourceRefs.filter((src) => src.enabled !== false);
  if (!enabled.length) return 'low';
  const score = enabled.reduce((sum, src) => {
    const trust = src.trustLevel === 'high' ? 3 : src.trustLevel === 'medium' ? 2 : 1;
    const fresh = src.freshness === 'current' ? 3 : src.freshness === 'recent' ? 2 : src.freshness === 'stale' ? 0 : 1;
    const rel = src.relevance === 'high' ? 3 : src.relevance === 'medium' ? 2 : 1;
    return sum + trust + fresh + rel;
  }, 0) / enabled.length;
  if (score >= 7) return 'high';
  if (score >= 4.7) return 'medium';
  return 'low';
}

function normalizeUseFor(input) {
  return { ...DEFAULT_USE_FOR, ...(input && typeof input === 'object' ? input : {}) };
}

function normalizeSourceRef(raw = {}) {
  const id = compact(raw.id, 80).replace(/[^a-z0-9:_-]+/gi, '-').replace(/^-+|-+$/g, '') || `source-${Date.now()}`;
  const sourceType = VALID_SOURCE_TYPES.has(raw.sourceType) ? raw.sourceType : 'other';
  return {
    id,
    sourceType,
    label: compact(raw.label || id, 120),
    enabled: raw.enabled !== false,
    trustLevel: ['low', 'medium', 'high'].includes(raw.trustLevel) ? raw.trustLevel : 'medium',
    freshness: ['stale', 'recent', 'current', 'unknown'].includes(raw.freshness) ? raw.freshness : 'unknown',
    relevance: ['low', 'medium', 'high'].includes(raw.relevance) ? raw.relevance : 'medium',
    useFor: normalizeUseFor(raw.useFor),
    url: raw.url || null,
    filePath: raw.filePath || null,
    summary: compact(raw.summary, 600),
    extractedFields: raw.extractedFields && typeof raw.extractedFields === 'object' ? raw.extractedFields : {},
    manualNotes: compact(raw.manualNotes, 800),
    doNotUseNotes: compact(raw.doNotUseNotes, 800),
    lastImportedAt: raw.lastImportedAt || null,
    lastUpdatedAt: raw.lastUpdatedAt || null,
  };
}

function mergeSourceRefs(autoRefs = [], existingRefs = []) {
  const byId = new Map();
  for (const ref of autoRefs.map(normalizeSourceRef)) byId.set(ref.id, ref);
  for (const existing of existingRefs.map(normalizeSourceRef)) {
    const base = byId.get(existing.id) || {};
    byId.set(existing.id, {
      ...base,
      ...existing,
      useFor: { ...normalizeUseFor(base.useFor), ...normalizeUseFor(existing.useFor) },
    });
  }
  return Array.from(byId.values());
}

async function loadClientBundle(clientId) {
  const [clientSnap, configSnap, dashSnap, masterSnap, kbItemsSnap] = await Promise.all([
    fb.adminDb.collection('clients').doc(clientId).get(),
    fb.adminDb.collection('client_configs').doc(clientId).get(),
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    fb.adminDb.collection('clients').doc(clientId).collection('intelligence').doc('master').get(),
    fb.adminDb.collection('knowledge_base').doc(clientId).collection('items').orderBy('createdAt', 'desc').limit(20).get().catch(() => null),
  ]);

  return {
    client: clientSnap.exists ? { id: clientSnap.id, ...(clientSnap.data() || {}) } : { id: clientId },
    clientConfig: configSnap.exists ? (configSnap.data() || {}) : {},
    dashboardState: dashSnap.exists ? (dashSnap.data() || {}) : {},
    intelligenceMaster: masterSnap.exists ? (masterSnap.data() || {}) : null,
    knowledgeItems: kbItemsSnap?.docs?.map((doc) => ({ id: doc.id, ...(doc.data() || {}) })) || [],
  };
}

function buildAutoSourceRefs({ client, clientConfig, dashboardState, intelligenceMaster, knowledgeItems }) {
  const sourceInputs = clientConfig?.sourceInputs || {};
  const brandOverview = dashboardState?.snapshot?.brandOverview || {};
  const visualIdentity = dashboardState?.snapshot?.visualIdentity || {};
  const marketingBrief = dashboardState?.marketingBrief || {};
  const onboardingSummary = dashboardState?.briefSummaries?.onboarding || {};
  const siteMeta = dashboardState?.siteMeta || {};
  const refs = [];

  refs.push(normalizeSourceRef({
    id: 'client-record',
    sourceType: 'manual_note',
    label: 'Client record',
    trustLevel: 'high',
    freshness: 'current',
    relevance: 'high',
    summary: compact([
      client?.companyName || client?.businessName || client?.dashboardTitle || client?.name,
      client?.websiteUrl || sourceInputs.websiteUrl,
      client?.ideaDescription || sourceInputs.ideaDescription,
    ].filter(Boolean).join(' · '), 500),
    extractedFields: {
      name: client?.companyName || client?.businessName || client?.dashboardTitle || client?.name || '',
      primaryUrl: client?.websiteUrl || sourceInputs.websiteUrl || '',
      description: client?.ideaDescription || sourceInputs.ideaDescription || '',
    },
    lastUpdatedAt: dateFromFirestore(client?.updatedAt) || null,
  }));

  if (sourceInputs.websiteUrl || clientConfig.websiteUrl || client?.websiteUrl) {
    refs.push(normalizeSourceRef({
      id: 'website-source-input',
      sourceType: 'website',
      label: 'Website URL',
      trustLevel: 'high',
      freshness: 'current',
      relevance: 'high',
      url: sourceInputs.websiteUrl || clientConfig.websiteUrl || client?.websiteUrl,
      summary: sourceInputs.websiteUrl || clientConfig.websiteUrl || client?.websiteUrl,
      extractedFields: sourceInputs,
      lastUpdatedAt: dateFromFirestore(clientConfig?.updatedAt) || null,
    }));
  }

  if (Object.keys(brandOverview).length) {
    refs.push(normalizeSourceRef({
      id: 'brand-overview',
      sourceType: 'onboarding',
      label: 'Brand overview synthesis',
      trustLevel: 'medium',
      freshness: 'recent',
      relevance: 'high',
      summary: brandOverview.summary || brandOverview.positioning || brandOverview.headline || '',
      extractedFields: brandOverview,
      lastUpdatedAt: dateFromFirestore(dashboardState?.updatedAt) || null,
    }));
  }

  if (Object.keys(visualIdentity).length) {
    refs.push(normalizeSourceRef({
      id: 'brand-snapshot',
      sourceType: 'brand_guide',
      label: 'Brand snapshot',
      trustLevel: 'medium',
      freshness: 'recent',
      relevance: 'high',
      summary: visualIdentity.styleGuide?.summary || visualIdentity.summary || visualIdentity.voice || '',
      extractedFields: visualIdentity,
      lastUpdatedAt: dateFromFirestore(dashboardState?.updatedAt) || null,
    }));
  }

  if (Object.keys(siteMeta).length) {
    refs.push(normalizeSourceRef({
      id: 'site-meta',
      sourceType: 'website',
      label: 'Homepage metadata',
      trustLevel: 'medium',
      freshness: 'recent',
      relevance: 'medium',
      url: siteMeta.canonical || sourceInputs.websiteUrl || client?.websiteUrl || null,
      summary: [siteMeta.title, siteMeta.description].filter(Boolean).join(' — '),
      extractedFields: siteMeta,
      lastUpdatedAt: dateFromFirestore(dashboardState?.updatedAt) || null,
    }));
  }

  if (marketingBrief?.scoutBrief || marketingBrief?.headline) {
    refs.push(normalizeSourceRef({
      id: 'marketing-brief',
      sourceType: 'marketing_insight',
      label: 'Marketing insights',
      trustLevel: 'medium',
      freshness: 'recent',
      relevance: 'high',
      summary: marketingBrief.scoutBrief?.humanBrief || marketingBrief.headline || '',
      extractedFields: {
        headline: marketingBrief.headline || '',
        contentOpportunities: marketingBrief.contentOpportunities || [],
        scoutBrief: marketingBrief.scoutBrief ? { humanBrief: marketingBrief.scoutBrief.humanBrief || '', generatedAt: marketingBrief.scoutBrief.generatedAt || null } : null,
      },
      lastUpdatedAt: marketingBrief.generatedAtIso || dateFromFirestore(dashboardState?.updatedAt) || null,
    }));
  }

  if (onboardingSummary.summary) {
    refs.push(normalizeSourceRef({
      id: 'creative-brief-summary',
      sourceType: 'creative_brief',
      label: 'Creative brief summary',
      trustLevel: 'medium',
      freshness: 'recent',
      relevance: 'high',
      summary: onboardingSummary.summary,
      extractedFields: onboardingSummary,
      lastUpdatedAt: onboardingSummary.generatedAtIso || null,
    }));
  }

  if (intelligenceMaster?.digest) {
    refs.push(normalizeSourceRef({
      id: 'client-intelligence-digest',
      sourceType: 'analytics',
      label: 'Client intelligence digest',
      trustLevel: 'medium',
      freshness: 'recent',
      relevance: 'medium',
      summary: intelligenceMaster.digest.summary || '',
      extractedFields: intelligenceMaster.digest,
      lastUpdatedAt: dateFromFirestore(intelligenceMaster.meta?.updatedAt) || null,
    }));
  }

  if (knowledgeItems.length) {
    refs.push(normalizeSourceRef({
      id: 'knowledge-base',
      sourceType: 'knowledge_base',
      label: 'Knowledge Base uploads',
      trustLevel: 'high',
      freshness: 'current',
      relevance: 'high',
      summary: `${knowledgeItems.length} uploaded item(s): ${knowledgeItems.slice(0, 6).map((item) => item.title || item.fileName || item.id).join(', ')}`,
      extractedFields: {
        itemCount: knowledgeItems.length,
        titles: knowledgeItems.map((item) => item.title || item.fileName || item.id).filter(Boolean).slice(0, 20),
      },
      lastUpdatedAt: dateFromFirestore(knowledgeItems[0]?.updatedAt || knowledgeItems[0]?.createdAt) || null,
    }));
  }

  return refs.filter((ref) => ref.summary || Object.keys(ref.extractedFields || {}).length);
}

// Flag fields where enabled sources disagree, so the card can surface them and
// the operator can resolve before approving. Compares normalized values across
// enabled sources for the few identity fields multiple sources carry.
function detectContradictions(sourceRefs = []) {
  const enabled = sourceRefs.filter((s) => s.enabled !== false);
  const checks = [
    { field: 'identity.name', pick: (f) => f.name },
    { field: 'identity.category', pick: (f) => f.industry || f.category || f.vertical },
    { field: 'identity.primaryUrl', pick: (f) => f.primaryUrl || f.websiteUrl || f.url },
  ];
  const out = [];
  for (const { field, pick } of checks) {
    const seen = new Map();
    for (const s of enabled) {
      const val = compact(pick(s.extractedFields || {}), 120);
      if (!val) continue;
      const norm = val.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\s+/g, ' ').trim();
      if (!seen.has(norm)) seen.set(norm, { value: val, sources: [] });
      seen.get(norm).sources.push(s.label || s.id);
    }
    if (seen.size > 1) {
      out.push({
        field,
        values: Array.from(seen.values()).map((v) => ({ value: v.value, sources: v.sources })),
        note: `Enabled sources disagree on ${field}.`,
      });
    }
  }
  return out;
}

// Confidence that reflects the whole brain, not just source quality: source
// confidence demoted one rank per signal — any high-priority gap, any
// contradiction. low|medium|high.
function computeBrainConfidence({ sourceRefs = [], missingData = [], contradictions = [] }) {
  const base = confidenceFromSources(sourceRefs);
  let rank = base === 'high' ? 3 : base === 'medium' ? 2 : 1;
  if (missingData.some((m) => m.priority === 'high')) rank -= 1;
  if (contradictions.length) rank -= 1;
  rank = Math.max(1, rank);
  return rank >= 3 ? 'high' : rank === 2 ? 'medium' : 'low';
}

function buildClientBrainDraft({ clientId, bundle, sourceRefs }) {
  const enabled = sourceRefs.filter((src) => src.enabled !== false);
  const byId = Object.fromEntries(sourceRefs.map((src) => [src.id, src]));
  const brand = byId['brand-overview']?.extractedFields || {};
  const snapshot = byId['brand-snapshot']?.extractedFields || {};
  const clientFields = byId['client-record']?.extractedFields || {};
  const website = byId['website-source-input']?.extractedFields || {};
  const marketing = byId['marketing-brief']?.extractedFields || {};
  const kb = byId['knowledge-base']?.extractedFields || {};

  const name =
    clientFields.name ||
    bundle.client?.companyName ||
    bundle.client?.businessName ||
    bundle.client?.dashboardTitle ||
    bundle.client?.name ||
    clientId;
  const primaryUrl = clientFields.primaryUrl || website.websiteUrl || bundle.client?.websiteUrl || '';
  const category = brand.industry || bundle.dashboardState?.marketCategory?.value || bundle.dashboardState?.leadgen?.vertical || '';
  const description = brand.summary || brand.positioning || clientFields.description || marketing.headline || '';
  const voiceRules = asArray(snapshot.voice || snapshot.tone || snapshot.styleGuide?.summary, 4);
  const contentPillars = [
    ...asArray(marketing.scoutBrief?.humanBrief, 3),
    ...asArray(marketing.contentOpportunities, 6),
    ...asArray(brand.contentPillars, 6),
  ].slice(0, 8);
  const services = asArray(brand.products || brand.services || website.services || bundle.dashboardState?.leadgen?.offers, 8);
  const proof = [
    ...asArray(brand.proof || brand.projects, 6),
    ...(kb.titles ? kb.titles.slice(0, 6).map((title) => `Knowledge source: ${title}`) : []),
  ].slice(0, 8);

  const missingData = [];
  if (!description) missingData.push({ field: 'identity.description', reason: 'No strong client description found in enabled sources.', priority: 'high' });
  if (!category) missingData.push({ field: 'identity.category', reason: 'No category/vertical set.', priority: 'medium' });
  if (!voiceRules.length) missingData.push({ field: 'voice.toneSummary', reason: 'No voice or tone samples found.', priority: 'high' });
  if (!services.length) missingData.push({ field: 'offers.services', reason: 'No offer/service list found.', priority: 'medium' });
  if (!proof.length) missingData.push({ field: 'proof.projects', reason: 'No proof points, case studies, or source-backed claims found.', priority: 'medium' });

  const contradictions = detectContradictions(sourceRefs);
  const confidence = computeBrainConfidence({ sourceRefs, missingData, contradictions });

  const shortContextParts = [
    `${name}${category ? ` is in ${category}` : ''}${primaryUrl ? ` (${primaryUrl})` : ''}.`,
    description,
    voiceRules.length ? `Voice: ${voiceRules.join('; ')}.` : '',
    services.length ? `Offers: ${services.join('; ')}.` : '',
    contentPillars.length ? `Content pillars: ${contentPillars.slice(0, 5).join('; ')}.` : '',
  ].filter(Boolean);

  const longContextParts = [
    `CLIENT IDENTITY\n${shortContextParts.join('\n')}`,
    `POSITIONING\n${compact(brand.positioning || brand.headline || description, 900) || 'No approved positioning yet.'}`,
    `AUDIENCE\n${asArray(brand.targetAudience || brand.audience || website.targetAudience, 8).join('\n') || 'No audience profile captured yet.'}`,
    `DO / DON'T\nUse: ${asArray(snapshot.preferredWords || snapshot.voice, 8).join(', ') || 'source-backed language'}\nAvoid: ${asArray(snapshot.bannedWords || snapshot.avoid, 8).join(', ') || 'generic agency hype, unsupported claims'}`,
    `SOURCE CONFIDENCE\n${enabled.length}/${sourceRefs.length} sources enabled. Confidence: ${confidence}.${contradictions.length ? ` ${contradictions.length} unresolved contradiction(s).` : ''}`,
  ];

  return {
    clientId,
    version: CLIENT_BRAIN_VERSION,
    status: 'generated',
    identity: {
      name,
      category,
      description,
      stage: brand.stage || '',
      location: bundle.dashboardState?.leadgen?.city || brand.location || '',
      primaryUrl,
    },
    positioning: {
      oneLiner: brand.headline || brand.positioning || description,
      authorityPosition: brand.authorityPosition || '',
      differentiation: asArray(brand.differentiation || brand.valueProps, 8),
      valueProps: asArray(brand.valueProps || brand.services, 8),
      avoidPositioning: asArray(brand.avoidPositioning, 8),
    },
    voice: {
      toneSummary: voiceRules.join(' '),
      writingRules: voiceRules,
      preferredWords: asArray(snapshot.preferredWords || snapshot.keywords, 10),
      bannedWords: asArray(snapshot.bannedWords || snapshot.avoid, 10),
      formattingRules: ['Keep claims source-backed.', 'Prefer concise, concrete language over hype.'],
      exampleGood: [],
      exampleBad: [],
      // Voice superset carried for the post pipeline (Scribe/Guardian via
      // resolveVoiceProfile). Empty on generated brains — populated by the
      // file->brain seed or Client Brain card edits. See voice-resolver.js.
      pillars: [],
      avoidPatterns: [],
      instagramFormatting: {},
      scribeInstructions: '',
      dailyBriefVoice: {},
    },
    audience: {
      primary: asArray(brand.targetAudience || brand.audience, 8),
      secondary: [],
      motivations: asArray(brand.motivations, 8),
      objections: asArray(brand.objections, 8),
      platforms: asArray(bundle.clientConfig?.marketingBriefConfig?.sourcePlatforms, 8),
    },
    offers: {
      services,
      products: asArray(brand.products, 8),
      callsToAction: asArray(bundle.clientConfig?.strategyBuilder?.campaign?.ctaText || bundle.dashboardState?.strategyBuilder?.config?.campaign?.ctaText, 4),
    },
    proof: {
      projects: proof,
      metrics: asArray(brand.metrics, 8),
      testimonials: asArray(brand.testimonials, 6),
      workHistory: asArray(brand.workHistory, 8),
    },
    content: {
      pillars: contentPillars,
      recurringSeries: [],
      postExamples: [],
      linkedInStyle: '',
      twitterStyle: '',
      emailDigestStyle: '',
    },
    aiContextPack: {
      shortContext: compact(shortContextParts.join(' '), 1800),
      longContext: compact(longContextParts.join('\n\n'), 5200),
      promptRules: [
        'Use Client Brain as strategic context, not as permission to invent facts.',
        'Prefer enabled, high-trust, current sources.',
        'Do not use disabled sources or fields flagged with doNotUseNotes.',
      ],
      downstreamUsage: ['creative-brief', 'social-preview', 'post-me', 'email-digest', 'marketing-insights', 'strategy-builder', 'knowledge-base'],
    },
    missingData,
    contradictions,
    confidence,
    generatedBy: 'deterministic',
    sourceRefs,
    generatedAt: nowIso(),
  };
}

function publicBrain(brain, sourceRefs) {
  if (!brain) {
    return {
      clientId: null,
      version: CLIENT_BRAIN_VERSION,
      status: 'draft',
      sourceRefs,
      identity: {},
      positioning: {},
      voice: {},
      audience: {},
      offers: {},
      proof: {},
      content: {},
      discovery: {},
      decisions: {},
      decisionAcquisition: {},
      completion: { score: 0, domains: {}, informationalOnly: true },
      missingDecisionQueue: [],
      aiContextPack: {},
      missingData: [],
      contradictions: [],
      confidence: 'low',
    };
  }
  return {
    ...brain,
    sourceRefs,
  };
}

function buildDashboardMirror(brain) {
  const sourceRefs = Array.isArray(brain?.sourceRefs) ? brain.sourceRefs : [];
  const missing = Array.isArray(brain?.missingData) ? brain.missingData : [];
  const contradictions = Array.isArray(brain?.contradictions) ? brain.contradictions : [];
  const enabledCount = sourceRefs.filter((src) => src.enabled !== false).length;
  return {
    clientId: brain.clientId,
    status: brain.status || 'draft',
    version: brain.version || CLIENT_BRAIN_VERSION,
    generatedAt: brain.generatedAt || null,
    approvedAt: brain.approvedAt || null,
    updatedAtIso: nowIso(),
    confidence: computeBrainConfidence({ sourceRefs, missingData: missing, contradictions }),
    sourceCount: sourceRefs.length,
    enabledSourceCount: enabledCount,
    highPriorityMissingCount: missing.filter((m) => m.priority === 'high').length,
    contradictionCount: contradictions.length,
    completionScore: brain.completion?.score || 0,
    missingDecisionCount: Array.isArray(brain.missingDecisionQueue) ? brain.missingDecisionQueue.length : 0,
    identity: brain.identity || {},
    aiContextPack: {
      shortContext: brain.aiContextPack?.shortContext || '',
      longContext: brain.aiContextPack?.longContext || '',
    },
  };
}

function buildSearchRowsFromDecisions(decisions) {
  const keywords = cleanList(valueOfDecision(decisions?.search?.keywords, []), { maxItems: 8 });
  const topics = cleanList(valueOfDecision(decisions?.search?.topicsToMonitor, []), { maxItems: 8 });
  const competitors = cleanList(valueOfDecision(decisions?.search?.competitorTerms, []), { maxItems: 8 });
  const rows = [];
  if (keywords.length) {
    rows.push({
      label: 'BRAND',
      query: keywords.join(' OR '),
      goal: 'Find current mentions, questions, and language around the client and its offers.',
    });
  }
  if (topics.length) {
    rows.push({
      label: 'CATEGORY',
      query: topics.join(' OR '),
      goal: 'Find market conversations, timely angles, and category language worth acting on.',
    });
  }
  if (competitors.length) {
    rows.push({
      label: 'COMPETITORS',
      query: competitors.join(' OR '),
      goal: 'Track competitor positioning, offers, launches, and audience reactions.',
    });
  }
  return rows.slice(0, 8);
}

function buildIntelligenceDomains({ identity = {}, positioning = {}, voice = {}, audience = {}, offers = {}, proof = {}, content = {}, marketingBriefConfig = {}, scoutConfig = {}, dashboardState = {}, sourceIds = [], meta = {} } = {}) {
  const domainMeta = { ...meta, appliedToCards: [] };
  const brandKeywords = [
    identity.name,
    ...cleanList(marketingBriefConfig.brandKeywords, { maxItems: 12 }),
    ...cleanList(scoutConfig.brandKeywords, { maxItems: 12 }),
  ];
  const categoryTerms = [
    identity.category,
    dashboardState.marketCategory?.value,
    ...cleanList(marketingBriefConfig.categoryTerms, { maxItems: 12 }),
    ...cleanList(scoutConfig.categoryTerms, { maxItems: 12 }),
    ...cleanList(content.pillars, { maxItems: 12 }),
  ];
  const competitors = [
    ...cleanList(marketingBriefConfig.competitors, { maxItems: 20 }),
    ...cleanList(scoutConfig.competitors, { maxItems: 20 }),
  ];
  const handles = [
    ...cleanList(marketingBriefConfig.kols, { maxItems: 20 }),
    ...cleanList(scoutConfig.kols, { maxItems: 20 }),
  ];
  const publications = cleanList(marketingBriefConfig.publications || scoutConfig.publications, { maxItems: 20 });
  const communities = cleanList(marketingBriefConfig.communities || scoutConfig.communities || scoutConfig.reddit?.subreddits, { maxItems: 20 });
  const podcasts = cleanList(marketingBriefConfig.podcasts || scoutConfig.podcasts, { maxItems: 20 });
  const events = cleanList(marketingBriefConfig.events || marketingBriefConfig.conferences || scoutConfig.events || scoutConfig.conferences, { maxItems: 20 });
  const directories = cleanList(marketingBriefConfig.directories || scoutConfig.directories, { maxItems: 20 });
  const awards = cleanList(marketingBriefConfig.awards || scoutConfig.awards, { maxItems: 20 });
  const socialEcosystems = cleanList(marketingBriefConfig.socialEcosystems || scoutConfig.socialEcosystems, { maxItems: 20 });
  const hashtags = cleanList(marketingBriefConfig.hashtags || scoutConfig.hashtags, { maxItems: 20 });
  const watchLists = cleanList(marketingBriefConfig.watchLists || scoutConfig.watchLists || scoutConfig.kols || marketingBriefConfig.kols, { maxItems: 30 });
  const primaryPlatforms = cleanList(marketingBriefConfig.sourcePlatforms?.length ? marketingBriefConfig.sourcePlatforms : DEFAULT_MARKETING_SOURCE_PLATFORMS, { maxItems: 10 });
  const proofPoints = [
    ...cleanList(proof.projects, { maxItems: 12 }),
    ...cleanList(proof.workHistory, { maxItems: 12 }),
    ...cleanList(proof.metrics, { maxItems: 12 }),
    ...cleanList(proof.testimonials, { maxItems: 8 }),
  ];
  const doNotSay = [
    ...cleanList(voice.bannedWords, { maxItems: 20 }),
    ...cleanList(voice.avoidPatterns, { maxItems: 20 }),
  ];

  return {
    identity: {
      who: decisionScalar(identity.description || positioning.oneLiner || identity.name, domainMeta),
      selling: decisionList(offers.services || offers.products, domainMeta, { maxItems: 12 }),
      hiredBy: decisionList(audience.primary, domainMeta, { maxItems: 12 }),
      categoryToOwn: decisionList(categoryTerms, domainMeta, { maxItems: 12 }),
      categoryToAvoid: decisionList(positioning.avoidPositioning || doNotSay, domainMeta, { maxItems: 12 }),
      legitimateAuthority: decisionList(proofPoints, { ...domainMeta, sourceIds }, { maxItems: 12 }),
    },
    market: {
      directCompetitors: decisionList(competitors, domainMeta, { maxItems: 20 }),
      adjacentCompetitors: decisionList([], domainMeta, { maxItems: 20 }),
      thoughtLeaders: decisionList(handles, domainMeta, { maxItems: 20 }),
      publications: decisionList(publications, domainMeta, { maxItems: 20 }),
      communities: decisionList(communities, domainMeta, { maxItems: 20 }),
      brandsToolsStartups: decisionList([...competitors, ...categoryTerms], domainMeta, { maxItems: 24 }),
      keywords: decisionList([...brandKeywords, ...categoryTerms], domainMeta, { maxItems: 24 }),
    },
    discovery: {
      keywords: decisionList([...brandKeywords, ...categoryTerms], domainMeta, { maxItems: 24 }),
      primaryPlatforms: decisionList(primaryPlatforms, domainMeta, { maxItems: 10 }),
      communities: decisionList(communities, domainMeta, { maxItems: 20 }),
      publications: decisionList(publications, domainMeta, { maxItems: 20 }),
      podcasts: decisionList(podcasts, domainMeta, { maxItems: 20 }),
      events: decisionList(events, domainMeta, { maxItems: 20 }),
      directories: decisionList(directories, domainMeta, { maxItems: 20 }),
      awards: decisionList(awards, domainMeta, { maxItems: 20 }),
      socialEcosystems: decisionList(socialEcosystems, domainMeta, { maxItems: 20 }),
      hashtags: decisionList(hashtags, domainMeta, { maxItems: 20 }),
      watchLists: decisionList(watchLists, domainMeta, { maxItems: 30 }),
    },
    authority: {
      trustReasons: decisionList(proofPoints, { ...domainMeta, sourceIds }, { maxItems: 16 }),
      workHistory: decisionList(proof.workHistory || proof.projects, domainMeta, { maxItems: 12 }),
      metrics: decisionList(proof.metrics, domainMeta, { maxItems: 12 }),
      allowedClaims: decisionList([...proofPoints, positioning.oneLiner].filter(Boolean), domainMeta, { maxItems: 16 }),
      prohibitedClaims: decisionList(doNotSay, domainMeta, { maxItems: 20 }),
    },
    content: {
      recurringThemes: decisionList(content.pillars || categoryTerms, domainMeta, { maxItems: 16 }),
      topicsToOwn: decisionList(categoryTerms, domainMeta, { maxItems: 16 }),
      topicsToAvoid: decisionList(doNotSay, domainMeta, { maxItems: 20 }),
      frameworks: decisionList(content.frameworks, domainMeta, { maxItems: 12 }),
      stories: decisionList(content.stories || content.postExamples, domainMeta, { maxItems: 12 }),
      opinions: decisionList(content.opinions, domainMeta, { maxItems: 12 }),
      recurringSeries: decisionList(content.recurringSeries, domainMeta, { maxItems: 12 }),
      formats: decisionList([content.linkedInStyle, content.twitterStyle, content.emailDigestStyle], domainMeta, { maxItems: 8 }),
    },
    opportunity: {
      icpSegments: decisionList(audience.primary, domainMeta, { maxItems: 12 }),
      verticals: decisionList([identity.category, dashboardState.leadgen?.vertical, ...categoryTerms], domainMeta, { maxItems: 12 }),
      geographies: decisionList([identity.location, dashboardState.leadgen?.city], domainMeta, { maxItems: 8 }),
      partnershipTargets: decisionList(handles, domainMeta, { maxItems: 20 }),
      outreachAngles: decisionList([positioning.oneLiner, ...cleanList(content.pillars, { maxItems: 8 })], domainMeta, { maxItems: 12 }),
      qualificationSignals: decisionList(audience.motivations || offers.services, domainMeta, { maxItems: 12 }),
      disqualifiers: decisionList(audience.objections || doNotSay, domainMeta, { maxItems: 12 }),
    },
  };
}

function buildDecisionDriversFromDomains(domains = {}, meta = {}) {
  const ownTerms = cleanList(domains.identity?.categoryToOwn?.value || domains.market?.keywords?.value, { maxItems: 8 });
  const primary = ownTerms[0] || domains.identity?.who?.value || 'Client positioning';
  const searchTerms = cleanList([
    ...cleanList(domains.market?.keywords?.value, { maxItems: 16 }),
    ...cleanList(domains.discovery?.keywords?.value, { maxItems: 16 }),
    ...cleanList(domains.content?.topicsToOwn?.value, { maxItems: 12 }),
    ...cleanList(domains.discovery?.watchLists?.value, { maxItems: 12 }),
  ], { maxItems: 24 });
  const competitors = cleanList([
    ...cleanList(domains.market?.directCompetitors?.value, { maxItems: 12 }),
    ...cleanList(domains.market?.adjacentCompetitors?.value, { maxItems: 12 }),
  ], { maxItems: 20 });
  const kols = cleanList([
    ...cleanList(domains.market?.thoughtLeaders?.value, { maxItems: 20 }),
    ...cleanList(domains.discovery?.watchLists?.value, { maxItems: 20 }),
  ], { maxItems: 30 });
  const communities = cleanList([
    ...cleanList(domains.market?.communities?.value, { maxItems: 20 }),
    ...cleanList(domains.discovery?.communities?.value, { maxItems: 20 }),
    ...cleanList(domains.discovery?.socialEcosystems?.value, { maxItems: 20 }),
  ], { maxItems: 30 });
  const contentSeries = cleanList([
    ...cleanList(domains.content?.recurringSeries?.value, { maxItems: 12 }),
    ...cleanList(domains.content?.recurringThemes?.value, { maxItems: 12 }),
  ], { maxItems: 20 });
  const leadGen = cleanList([
    ...cleanList(domains.opportunity?.icpSegments?.value, { maxItems: 12 }),
    ...cleanList(domains.opportunity?.verticals?.value, { maxItems: 12 }),
  ], { maxItems: 20 });

  const driver = {
    id: slugify(primary),
    label: `Own ${primary}`,
    status: meta.status || DEFAULT_DECISION_STATUS,
    confidence: meta.confidence || 'medium',
    sourceIds: Array.isArray(meta.sourceIds) ? meta.sourceIds : [],
    own: ownTerms,
    avoid: cleanList([
      ...cleanList(domains.identity?.categoryToAvoid?.value, { maxItems: 12 }),
      ...cleanList(domains.content?.topicsToAvoid?.value, { maxItems: 12 }),
    ], { maxItems: 20 }),
    search: searchTerms,
    competitors,
    kols,
    publications: cleanList([
      ...cleanList(domains.market?.publications?.value, { maxItems: 20 }),
      ...cleanList(domains.discovery?.publications?.value, { maxItems: 20 }),
      ...cleanList(domains.discovery?.podcasts?.value, { maxItems: 20 }),
      ...cleanList(domains.discovery?.events?.value, { maxItems: 20 }),
    ], { maxItems: 30 }),
    communities,
    contentSeries,
    campaigns: contentSeries.map((series) => `${series} campaign`).slice(0, 8),
    leadGen,
  };

  const hasUsefulOutput = [
    driver.own,
    driver.search,
    driver.competitors,
    driver.kols,
    driver.communities,
    driver.contentSeries,
    driver.leadGen,
  ].some((list) => Array.isArray(list) && list.length);

  return hasUsefulOutput ? [driver] : [];
}

function buildCardDefaultsForCard(decisions = {}, cardId = MARKETING_BRIEF_CARD_ID) {
  const now = nowIso();
  const commonMeta = { status: 'suggested', confidence: 'medium', updatedBy: 'system', updatedAt: now };
  if (![MARKETING_BRIEF_CARD_ID, MARKET_INSIGHTS_CARD_ID, 'watchlist', 'brand-keywords', 'scout-focus'].includes(cardId)) {
    return { fields: {}, lastBuiltAt: now };
  }

  const fields = {
    brandName: decisionScalar(valueOfDecision(decisions?.identity?.name, ''), { ...commonMeta, appliedToCards: [cardId] }),
    brandKeywords: decisionList(valueOfDecision(decisions?.search?.keywords, []), { ...commonMeta, appliedToCards: [cardId] }, { maxItems: 12 }),
    categoryTerms: decisionList(valueOfDecision(decisions?.search?.topicsToMonitor, []), { ...commonMeta, appliedToCards: [cardId] }, { maxItems: 12 }),
    kols: decisionList(valueOfDecision(decisions?.social?.handlesToFollow, []), { ...commonMeta, appliedToCards: [cardId] }, { maxItems: 20 }),
    competitors: decisionList(valueOfDecision(decisions?.search?.competitorTerms, []), { ...commonMeta, appliedToCards: [cardId] }, { maxItems: 20 }),
    sourcePlatforms: decisionList(valueOfDecision(decisions?.social?.platforms, DEFAULT_MARKETING_SOURCE_PLATFORMS), { ...commonMeta, appliedToCards: [cardId] }, { maxItems: 10 }),
    searches: decisionValue(buildSearchRowsFromDecisions(decisions), { ...commonMeta, appliedToCards: [cardId] }),
    sourceFocus: decisionScalar([
      valueOfDecision(decisions?.positioning?.oneLiner, ''),
      cleanList(valueOfDecision(decisions?.audience?.primary, []), { maxItems: 4 }).length
        ? `Audience: ${cleanList(valueOfDecision(decisions?.audience?.primary, []), { maxItems: 4 }).join(', ')}.`
        : '',
    ].filter(Boolean).join('\n'), { ...commonMeta, appliedToCards: [cardId], max: 1000 }),
  };
  return { fields, lastBuiltAt: now };
}

function buildDecisionPack(brain = {}, bundle = {}) {
  const clientConfig = bundle.clientConfig || {};
  const dashboardState = bundle.dashboardState || {};
  const marketingBriefConfig = clientConfig.marketingBriefConfig || {};
  const scoutConfig = clientConfig.scoutConfig || {};
  const identity = brain.identity || {};
  const positioning = brain.positioning || {};
  const voice = brain.voice || {};
  const audience = brain.audience || {};
  const offers = brain.offers || {};
  const proof = brain.proof || {};
  const content = brain.content || {};

  const sourceIds = (Array.isArray(brain.sourceRefs) ? brain.sourceRefs : [])
    .filter((src) => src.enabled !== false)
    .map((src) => src.id);
  const generatedAt = nowIso();
  const meta = { status: brain.status === 'approved' ? 'approved' : 'suggested', confidence: brain.confidence || 'medium', sourceIds, updatedBy: 'system', updatedAt: generatedAt };
  const intelligence = buildIntelligenceDomains({
    identity,
    positioning,
    voice,
    audience,
    offers,
    proof,
    content,
    marketingBriefConfig,
    scoutConfig,
    dashboardState,
    sourceIds,
    meta,
  });
  const decisionDrivers = buildDecisionDriversFromDomains(intelligence, meta);
  const categoryTerms = [
    ...cleanList(marketingBriefConfig.categoryTerms, { maxItems: 12 }),
    ...cleanList(scoutConfig.categoryTerms, { maxItems: 12 }),
    identity.category,
    dashboardState.marketCategory?.value,
    ...cleanList(content.pillars, { maxItems: 8 }),
  ];
  const brandKeywords = [
    ...cleanList(marketingBriefConfig.brandKeywords, { maxItems: 12 }),
    ...cleanList(scoutConfig.brandKeywords, { maxItems: 12 }),
    identity.name,
    identity.primaryUrl ? (() => { try { return new URL(identity.primaryUrl).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '',
  ];
  const handles = [
    ...cleanList(marketingBriefConfig.kols, { maxItems: 20 }),
    ...cleanList(scoutConfig.kols, { maxItems: 20 }),
  ];
  const competitors = [
    ...cleanList(marketingBriefConfig.competitors, { maxItems: 20 }),
    ...cleanList(scoutConfig.competitors, { maxItems: 20 }),
  ];
  const platforms = cleanList(marketingBriefConfig.sourcePlatforms?.length ? marketingBriefConfig.sourcePlatforms : DEFAULT_MARKETING_SOURCE_PLATFORMS, { maxItems: 10 });
  const doNotSay = [
    ...cleanList(voice.bannedWords, { maxItems: 20 }),
    ...cleanList(voice.avoidPatterns, { maxItems: 20 }),
    ...(Array.isArray(brain.sourceRefs) ? brain.sourceRefs.map((src) => src.doNotUseNotes).filter(Boolean) : []),
  ];

  return {
    intelligence,
    decisionDrivers,
    identity: {
      name: decisionScalar(identity.name, meta),
      category: decisionScalar(identity.category || dashboardState.marketCategory?.value, meta),
      primaryUrl: decisionScalar(identity.primaryUrl, meta),
    },
    positioning: {
      oneLiner: decisionScalar(positioning.oneLiner || positioning.authorityPosition || identity.description, meta),
      differentiation: decisionList(positioning.differentiation || positioning.valueProps, meta, { maxItems: 12 }),
    },
    audience: {
      primary: decisionList(audience.primary, meta, { maxItems: 12 }),
      motivations: decisionList(audience.motivations, meta, { maxItems: 12 }),
      objections: decisionList(audience.objections, meta, { maxItems: 12 }),
    },
    voice: {
      toneSummary: decisionScalar(voice.toneSummary || cleanList(voice.writingRules, { maxItems: 4 }).join(' '), meta),
      preferredWords: decisionList(voice.preferredWords, meta, { maxItems: 20 }),
      doNotSay: decisionList(doNotSay, meta, { maxItems: 30 }),
    },
    offers: {
      services: decisionList(offers.services || offers.products, meta, { maxItems: 12 }),
      callsToAction: decisionList(offers.callsToAction, meta, { maxItems: 8 }),
    },
    proof: {
      points: decisionList(proof.projects || proof.workHistory, meta, { maxItems: 12 }),
      metrics: decisionList(proof.metrics, meta, { maxItems: 12 }),
    },
    search: {
      keywords: decisionList(brandKeywords, meta, { maxItems: 12 }),
      excludedTerms: decisionList(doNotSay, meta, { maxItems: 20 }),
      topicsToMonitor: decisionList(categoryTerms, meta, { maxItems: 12 }),
      competitorTerms: decisionList(competitors, meta, { maxItems: 20 }),
      customSearches: decisionValue(cleanSearchRows(marketingBriefConfig.searches, 8), meta),
    },
    social: {
      handlesToFollow: decisionList([
        ...handles,
        ...cleanList(intelligence.discovery?.watchLists?.value, { maxItems: 20 }),
      ], meta, { maxItems: 30 }),
      handlesToAvoid: decisionList([], meta, { maxItems: 20 }),
      platforms: decisionList(platforms, meta, { maxItems: 10 }),
      postAngles: decisionList(content.pillars, meta, { maxItems: 12 }),
    },
    market: {
      categories: decisionList([dashboardState.marketCategory?.value, identity.category, ...categoryTerms], meta, { maxItems: 12 }),
      verticals: decisionList([identity.category, dashboardState.leadgen?.vertical], meta, { maxItems: 8 }),
      locations: decisionList([identity.location, dashboardState.leadgen?.city], meta, { maxItems: 8 }),
      signalsToWatch: decisionList(marketingBriefConfig.localSignals, meta, { maxItems: 12 }),
    },
    content: {
      pillars: decisionList(content.pillars, meta, { maxItems: 12 }),
      recurringSeries: decisionList(content.recurringSeries, meta, { maxItems: 12 }),
      defaultCtas: decisionList(offers.callsToAction, meta, { maxItems: 8 }),
      doNotSay: decisionList(doNotSay, meta, { maxItems: 30 }),
    },
    generatedAt,
  };
}

const COMPLETION_DOMAINS = Object.freeze({
  identity: [
    ['decisions.identity.name', 'Client name'],
    ['decisions.positioning.oneLiner', 'Approved positioning'],
    ['decisions.audience.primary', 'Primary audience'],
    ['decisions.offers.services', 'Offers/services'],
  ],
  authority: [
    ['decisions.proof.points', 'Proof points'],
    ['decisions.intelligence.authority.trustReasons', 'Trust reasons'],
    ['decisions.intelligence.authority.allowedClaims', 'Allowed claims'],
  ],
  market: [
    ['decisions.search.keywords', 'Search keywords'],
    ['decisions.search.topicsToMonitor', 'Topics to monitor'],
    ['decisions.search.competitorTerms', 'Competitors'],
  ],
  discovery: [
    ['decisions.intelligence.discovery.keywords', 'Discovery keywords'],
    ['decisions.intelligence.discovery.primaryPlatforms', 'Primary platforms'],
    ['decisions.intelligence.discovery.communities', 'Communities'],
    ['decisions.intelligence.discovery.publications', 'Publications'],
    ['decisions.intelligence.discovery.watchLists', 'Watchlists'],
  ],
  content: [
    ['decisions.content.pillars', 'Content pillars'],
    ['decisions.content.recurringSeries', 'Recurring series'],
    ['decisions.voice.toneSummary', 'Voice/tone'],
    ['decisions.content.defaultCtas', 'Default CTAs'],
  ],
  opportunity: [
    ['decisions.intelligence.opportunity.icpSegments', 'ICP segments'],
    ['decisions.intelligence.opportunity.verticals', 'Verticals'],
    ['decisions.intelligence.opportunity.qualificationSignals', 'Qualification signals'],
    ['decisions.intelligence.opportunity.outreachAngles', 'Outreach angles'],
  ],
});

function getByPath(root, path) {
  return String(path || '').split('.').reduce((acc, key) => (acc && acc[key] != null ? acc[key] : undefined), root);
}

function decisionHasValue(decision) {
  const value = valueOfDecision(decision, decision);
  if (Array.isArray(value)) return value.filter(Boolean).length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(String(value || '').trim());
}

function buildClientBrainCompletion(decisions = {}, { sourceRefs = [], missingData = [], contradictions = [] } = {}) {
  const enabled = sourceRefs.filter((src) => src.enabled !== false);
  const sourceScore = sourceRefs.length ? Math.round((enabled.length / sourceRefs.length) * 100) : 50;
  const trustScore = enabled.length
    ? Math.round(enabled.reduce((sum, src) => sum + (src.trustLevel === 'high' ? 100 : src.trustLevel === 'medium' ? 70 : 40), 0) / enabled.length)
    : 50;
  const freshnessScore = enabled.length
    ? Math.round(enabled.reduce((sum, src) => sum + (src.freshness === 'current' ? 100 : src.freshness === 'recent' ? 75 : src.freshness === 'stale' ? 30 : 55), 0) / enabled.length)
    : 50;
  const conflictPenalty = contradictions.length ? Math.min(25, contradictions.length * 8) : 0;
  const highGapPenalty = missingData.filter((item) => item.priority === 'high').length * 6;

  const byDomain = {};
  for (const [domain, fields] of Object.entries(COMPLETION_DOMAINS)) {
    const completeFields = [];
    const missingFields = [];
    let approvedCount = 0;
    for (const [path, label] of fields) {
      const decision = getByPath({ decisions }, path);
      if (decisionHasValue(decision)) {
        completeFields.push({ path, label });
        if (decision?.status === 'approved' || decision?.acquisition?.validationStatus === 'approved') approvedCount += 1;
      } else {
        missingFields.push({ path, label });
      }
    }
    const coverage = Math.round((completeFields.length / fields.length) * 70);
    const approval = Math.round((approvedCount / fields.length) * 15);
    const sourceQuality = Math.round(((sourceScore + trustScore + freshnessScore) / 3) * 0.15);
    const score = Math.max(0, Math.min(100, coverage + approval + sourceQuality - conflictPenalty - highGapPenalty));
    byDomain[domain] = {
      score,
      completeFields,
      missingFields,
      approvedCount,
      requiredCount: fields.length,
      sourceScore,
      trustScore,
      freshnessScore,
      conflictPenalty,
    };
  }

  const domainScores = Object.values(byDomain).map((domain) => domain.score);
  return {
    score: domainScores.length ? Math.round(domainScores.reduce((sum, score) => sum + score, 0) / domainScores.length) : 0,
    domains: byDomain,
    generatedAt: nowIso(),
    informationalOnly: true,
  };
}

function buildMissingDecisionQueue(completion = {}) {
  const rows = [];
  for (const [domain, state] of Object.entries(completion.domains || {})) {
    for (const missing of state.missingFields || []) {
      rows.push({
        priority: state.score < 45 ? 'high' : state.score < 75 ? 'medium' : 'low',
        domain,
        field: missing.path,
        label: missing.label,
        action: `Define ${missing.label.toLowerCase()} for ${domain} intelligence.`,
      });
    }
  }
  const priorityRank = { high: 0, medium: 1, low: 2 };
  return rows.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.domain.localeCompare(b.domain));
}

function collectDecisionAcquisition(decisions = {}, completion = {}, queue = []) {
  const methods = {};
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.acquisition?.method) {
      methods[value.acquisition.method] = (methods[value.acquisition.method] || 0) + 1;
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') visit(child);
    }
  }
  visit(decisions);
  return {
    methods,
    completionScore: completion.score || 0,
    domainScores: Object.fromEntries(Object.entries(completion.domains || {}).map(([domain, state]) => [domain, state.score])),
    missingDecisionCount: queue.length,
    generatedAt: nowIso(),
  };
}

function buildDecisionEngine(brain = {}, bundle = {}) {
  const decisions = brain.decisions && typeof brain.decisions === 'object'
    ? brain.decisions
    : buildDecisionPack(brain, bundle);
  const existingDefaults = brain.cardDefaults && typeof brain.cardDefaults === 'object' ? brain.cardDefaults : {};
  const marketingDefaults = buildCardDefaultsForCard(decisions, MARKETING_BRIEF_CARD_ID);
  const completion = buildClientBrainCompletion(decisions, {
    sourceRefs: brain.sourceRefs || [],
    missingData: brain.missingData || [],
    contradictions: brain.contradictions || [],
  });
  const missingDecisionQueue = buildMissingDecisionQueue(completion);
  const decisionAcquisition = collectDecisionAcquisition(decisions, completion, missingDecisionQueue);
  return {
    decisions,
    decisionAcquisition,
    completion,
    missingDecisionQueue,
    cardDefaults: {
      ...existingDefaults,
      [MARKETING_BRIEF_CARD_ID]: {
        ...marketingDefaults,
        ...(existingDefaults[MARKETING_BRIEF_CARD_ID] || {}),
        fields: {
          ...marketingDefaults.fields,
          ...(existingDefaults[MARKETING_BRIEF_CARD_ID]?.fields || {}),
        },
      },
      [MARKET_INSIGHTS_CARD_ID]: {
        ...marketingDefaults,
        ...(existingDefaults[MARKET_INSIGHTS_CARD_ID] || {}),
        fields: {
          ...marketingDefaults.fields,
          ...(existingDefaults[MARKET_INSIGHTS_CARD_ID]?.fields || {}),
        },
      },
    },
    cardSettingsSnapshot: brain.cardSettingsSnapshot && typeof brain.cardSettingsSnapshot === 'object'
      ? brain.cardSettingsSnapshot
      : {},
  };
}

async function getClientBrain(clientId) {
  const [bundle, snap] = await Promise.all([loadClientBundle(clientId), clientBrainRef(clientId).get()]);
  const existing = snap.exists ? (snap.data() || {}) : null;
  const autoRefs = buildAutoSourceRefs(bundle);
  const sourceRefs = mergeSourceRefs(autoRefs, existing?.sourceRefs || []);
  return {
    brain: publicBrain(existing, sourceRefs),
    bundle,
  };
}

async function saveClientBrain(clientId, brainPatch) {
  const current = await getClientBrain(clientId);
  const prev = current.brain || {};
  const sourceRefs = mergeSourceRefs(prev.sourceRefs || [], brainPatch.sourceRefs || prev.sourceRefs || []);
  const payload = {
    ...prev,
    ...brainPatch,
    clientId,
    version: Number(brainPatch.version || prev.version || CLIENT_BRAIN_VERSION),
    status: brainPatch.status || prev.status || 'draft',
    sourceRefs,
    createdAt: prev.createdAt || fb.FieldValue.serverTimestamp(),
    updatedAt: fb.FieldValue.serverTimestamp(),
    updatedAtIso: nowIso(),
  };
  await clientBrainRef(clientId).set(payload, { merge: true });
  await dashboardStateRef(clientId).set(
    { clientBrain: buildDashboardMirror(payload), updatedAt: fb.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return payload;
}

async function saveSourceRefs(clientId, sourceRefs) {
  return saveClientBrain(clientId, {
    sourceRefs: Array.isArray(sourceRefs) ? sourceRefs.map(normalizeSourceRef) : [],
    status: 'draft',
  });
}

// Compact, source-grounded evidence bundle for the model path. Skips disabled
// sources and anything flagged doNotUse.
function sourceEvidenceText(sourceRefs, max = 6000) {
  const enabled = sourceRefs.filter((s) => s.enabled !== false && !s.doNotUseNotes);
  return enabled.map((s) => {
    const fields = Object.entries(s.extractedFields || {})
      .map(([k, v]) => `${k}: ${compact(typeof v === 'string' ? v : JSON.stringify(v), 200)}`)
      .filter(Boolean).slice(0, 8).join('\n');
    return `### ${s.label || s.id} (${s.sourceType}, trust:${s.trustLevel})\n${s.summary || ''}${fields ? `\n${fields}` : ''}`;
  }).join('\n\n').slice(0, max);
}

const CLIENT_BRAIN_TOOL = {
  name: 'write_client_brain',
  description: 'Return refined, source-grounded Client Brain fields.',
  input_schema: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'One-paragraph identity/what-they-do, grounded in evidence.' },
      oneLiner: { type: 'string', description: 'Positioning one-liner.' },
      toneSummary: { type: 'string', description: 'How this client should sound.' },
      differentiation: { type: 'array', items: { type: 'string' } },
      audiencePrimary: { type: 'array', items: { type: 'string' } },
      contentPillars: { type: 'array', items: { type: 'string' } },
    },
    required: ['description', 'oneLiner', 'toneSummary'],
  },
};

// Optional model pass over a deterministic draft. Refines the free-text fields
// strictly from source evidence, then rebuilds shortContext to match. Returns
// the draft unchanged when there is no evidence; throws are handled by caller.
async function refineDraftWithModel(draft, sourceRefs) {
  const evidence = sourceEvidenceText(sourceRefs);
  if (!evidence.trim()) return draft;
  const { callAnthropic } = require('../scout-intake/_anthropic-client.js');
  const model = process.env.CLIENT_BRAIN_MODEL || 'claude-sonnet-4-6';
  const system = 'You refine a brand context profile (Client Brain) used to steer marketing copy. '
    + 'Ground EVERY field strictly in the supplied source evidence — never invent facts, metrics, or claims. '
    + 'Be concise, concrete, specific to this client. Avoid generic agency language and hype.';
  const user = [
    'Current draft (deterministic, may be thin):',
    `- description: ${draft.identity?.description || '(none)'}`,
    `- oneLiner: ${draft.positioning?.oneLiner || '(none)'}`,
    `- toneSummary: ${draft.voice?.toneSummary || '(none)'}`,
    '',
    'SOURCE EVIDENCE:',
    evidence,
    '',
    'Refine the fields. Return ONLY via the write_client_brain tool.',
  ].join('\n');
  const res = await callAnthropic({
    model, max_tokens: 1200, system,
    tools: [CLIENT_BRAIN_TOOL],
    tool_choice: { type: 'tool', name: 'write_client_brain' },
    messages: [{ role: 'user', content: user }],
  });
  const out = (res?.content || []).find((b) => b.type === 'tool_use')?.input;
  if (!out) return draft;

  const merged = {
    ...draft,
    identity: { ...draft.identity, description: compact(out.description, 600) || draft.identity.description },
    positioning: {
      ...draft.positioning,
      oneLiner: compact(out.oneLiner, 300) || draft.positioning.oneLiner,
      differentiation: out.differentiation?.length ? asArray(out.differentiation, 8) : draft.positioning.differentiation,
    },
    voice: { ...draft.voice, toneSummary: compact(out.toneSummary, 400) || draft.voice.toneSummary },
    audience: { ...draft.audience, primary: out.audiencePrimary?.length ? asArray(out.audiencePrimary, 8) : draft.audience.primary },
    content: { ...draft.content, pillars: out.contentPillars?.length ? asArray(out.contentPillars, 8) : draft.content.pillars },
    generatedBy: 'model',
  };
  const shortContext = [
    `${merged.identity.name}${merged.identity.category ? ` is in ${merged.identity.category}` : ''}${merged.identity.primaryUrl ? ` (${merged.identity.primaryUrl})` : ''}.`,
    merged.identity.description,
    merged.voice.toneSummary ? `Voice: ${merged.voice.toneSummary}` : '',
    merged.offers.services?.length ? `Offers: ${merged.offers.services.join('; ')}.` : '',
    merged.content.pillars?.length ? `Content pillars: ${merged.content.pillars.slice(0, 5).join('; ')}.` : '',
  ].filter(Boolean).join(' ');
  merged.aiContextPack = { ...merged.aiContextPack, shortContext: compact(shortContext, 1800) };
  return merged;
}

// Preserve operator-owned voice across regeneration. Any non-empty field on the
// previous voice (VOICE-tab edits: toneSummary/scribeInstructions/avoidPatterns;
// seeded superset: pillars/examples/formatting) overlays the fresh draft, so a
// rebuild only fills fields that were empty. AI refine runs after this and can
// still override toneSummary on top.
function isEmptyValue(v) {
  if (v == null) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return !v.length;
  if (typeof v === 'object') return !Object.keys(v).length;
  return false;
}

function mergeVoice(prevVoice = {}, draftVoice = {}) {
  const merged = { ...draftVoice };
  for (const [key, value] of Object.entries(prevVoice || {})) {
    if (!isEmptyValue(value)) merged[key] = value;
  }
  return merged;
}

async function generateAndSaveClientBrain(clientId, { mode = 'deterministic' } = {}) {
  const { brain, bundle } = await getClientBrain(clientId);
  const sourceRefs = mergeSourceRefs(buildAutoSourceRefs(bundle), brain.sourceRefs || []);
  const fresh = buildClientBrainDraft({ clientId, bundle, sourceRefs });
  // Keep manual/seeded voice; the rebuild only fills previously-empty voice fields.
  // Operator-authored post examples (content.postExamples, from CLIENT_BRAIN.md ->
  // few_shot_examples) have no bundle producer, so a rebuild would zero them —
  // preserve them the same way mergeVoice preserves voice fields.
  const content = isEmptyValue(fresh.content?.postExamples) && !isEmptyValue(brain.content?.postExamples)
    ? { ...fresh.content, postExamples: brain.content.postExamples }
    : fresh.content;
  let draft = { ...fresh, voice: mergeVoice(brain.voice, fresh.voice), content };
  if (mode === 'llm') {
    try {
      draft = await refineDraftWithModel(draft, sourceRefs);
    } catch (err) {
      // Non-fatal — keep the deterministic draft, record the failure for the UI.
      draft = { ...draft, regenerationError: compact(err.message, 200) };
    }
  }
  const engine = buildDecisionEngine(draft, bundle);
  draft = {
    ...draft,
    decisions: engine.decisions,
    decisionAcquisition: engine.decisionAcquisition,
    completion: engine.completion,
    missingDecisionQueue: engine.missingDecisionQueue,
    cardDefaults: engine.cardDefaults,
    cardSettingsSnapshot: engine.cardSettingsSnapshot,
  };
  return saveClientBrain(clientId, draft);
}

async function compileAndSaveClientBrainMarkdown(clientId, markdownSource) {
  const { bundle } = await getClientBrain(clientId);
  const compiled = compileClientBrainMarkdown(markdownSource, { clientId });
  const engine = buildDecisionEngine(compiled, bundle);
  return saveClientBrain(clientId, {
    ...compiled,
    decisions: engine.decisions,
    decisionAcquisition: engine.decisionAcquisition,
    completion: engine.completion,
    missingDecisionQueue: engine.missingDecisionQueue,
    cardDefaults: engine.cardDefaults,
    cardSettingsSnapshot: engine.cardSettingsSnapshot,
    updatedAtIso: nowIso(),
  });
}

async function markClientBrainStatus(clientId, status) {
  const allowed = new Set(['draft', 'generated', 'approved', 'stale']);
  if (!allowed.has(status)) throw new Error(`Unsupported Client Brain status: ${status}`);
  const patch = { status };
  if (status === 'approved') patch.approvedAt = nowIso();
  return saveClientBrain(clientId, patch);
}

// Safe for every downstream caller. Returns '' (never throws) when the brain
// is absent, unapproved, or filtered out by useFor — callers treat '' as "no
// context" and behave exactly as before.
//   useFor:         purpose string or array (e.g. 'socialPosts'). When set, the
//                   returned block is scoped to that purpose AND gated by the
//                   per-source useFor toggles. When omitted, falls back to the
//                   precomputed aiContextPack.shortContext.
//   maxChars:       length cap (default 2500).
//   requireApproved: default true — only approved brains feed downstream copy
//                   (approval precedence). Pass false to consume drafts.
async function loadClientBrainContext(clientId, { useFor = null, maxChars = 2500, requireApproved = true } = {}) {
  if (!clientId) return '';
  const snap = await clientBrainRef(clientId).get();
  if (!snap.exists) return '';
  const data = snap.data() || {};
  if (requireApproved && data.status !== 'approved') return '';
  if (useFor) {
    const scoped = buildUseForContext(data, useFor);
    return scoped ? capText(scoped, maxChars) : '';
  }
  return compact(data.aiContextPack?.shortContext || data.aiContextPack?.longContext || '', maxChars);
}

async function loadClientBrainDecisions(clientId, { cardId = null, requireApproved = true } = {}) {
  if (!clientId) return { decisions: {}, cardDefaults: {}, fields: {} };
  const { brain, bundle } = await getClientBrain(clientId);
  if (!brain || (requireApproved && brain.status !== 'approved')) {
    return { decisions: {}, cardDefaults: {}, fields: {} };
  }
  const engine = buildDecisionEngine(brain, bundle);
  const cardDefaults = cardId ? (engine.cardDefaults?.[cardId] || {}) : engine.cardDefaults;
  return {
    decisions: engine.decisions || {},
    cardDefaults,
    fields: cardId ? (cardDefaults.fields || {}) : {},
  };
}

async function loadClientBrainCardDefaults(clientId, { cardId, requireApproved = true } = {}) {
  const out = await loadClientBrainDecisions(clientId, { cardId, requireApproved });
  return out.cardDefaults || { fields: {} };
}

function buildMarketingBriefDecisionPatch(config = {}) {
  const now = nowIso();
  const meta = {
    status: 'approved',
    confidence: 'high',
    updatedBy: 'operator',
    updatedAt: now,
    method: 'feedback',
    confidenceReason: 'Operator promoted durable card settings back into Client Brain.',
    appliedToCards: [MARKETING_BRIEF_CARD_ID, MARKET_INSIGHTS_CARD_ID],
  };
  const fields = {
    brandName: decisionScalar(config.brandName, meta),
    brandKeywords: decisionList(config.brandKeywords, meta, { maxItems: 12 }),
    categoryTerms: decisionList(config.categoryTerms, meta, { maxItems: 12 }),
    kols: decisionList(config.kols, meta, { maxItems: 20 }),
    competitors: decisionList(config.competitors, meta, { maxItems: 20 }),
    sourcePlatforms: decisionList(config.sourcePlatforms, meta, { maxItems: 10 }),
    searches: decisionValue(cleanSearchRows(config.searches, 8), meta),
    sourceFocus: decisionScalar(config.sourceFocus, { ...meta, max: 1000 }),
  };
  return {
    decisions: {
      identity: { name: fields.brandName },
      search: {
        keywords: fields.brandKeywords,
        topicsToMonitor: fields.categoryTerms,
        competitorTerms: fields.competitors,
        customSearches: fields.searches,
      },
      social: {
        handlesToFollow: fields.kols,
        platforms: fields.sourcePlatforms,
      },
      market: {
        categories: fields.categoryTerms,
      },
    },
    defaults: { fields, lastAppliedAt: now, lastAppliedBy: 'operator' },
  };
}

function mergeDeepObject(base = {}, patch = {}) {
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value.value !== undefined && value.status)) {
      out[key] = mergeDeepObject(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function saveClientBrainCardSettingsSnapshot(clientId, { cardId, config, source = 'card', promote = false } = {}) {
  if (!clientId || !cardId || !config || typeof config !== 'object') return null;
  const { brain } = await getClientBrain(clientId);
  const now = nowIso();
  const patch = {
    cardSettingsSnapshot: {
      ...(brain.cardSettingsSnapshot || {}),
      [cardId]: {
        config,
        source,
        updatedAt: now,
      },
    },
  };

  if (promote && [MARKETING_BRIEF_CARD_ID, MARKET_INSIGHTS_CARD_ID].includes(cardId)) {
    const promoted = buildMarketingBriefDecisionPatch(config);
    patch.decisions = mergeDeepObject(brain.decisions || {}, promoted.decisions);
    const completion = buildClientBrainCompletion(patch.decisions, {
      sourceRefs: brain.sourceRefs || [],
      missingData: brain.missingData || [],
      contradictions: brain.contradictions || [],
    });
    const missingDecisionQueue = buildMissingDecisionQueue(completion);
    patch.completion = completion;
    patch.missingDecisionQueue = missingDecisionQueue;
    patch.decisionAcquisition = collectDecisionAcquisition(patch.decisions, completion, missingDecisionQueue);
    patch.cardDefaults = {
      ...(brain.cardDefaults || {}),
      [MARKETING_BRIEF_CARD_ID]: {
        ...((brain.cardDefaults || {})[MARKETING_BRIEF_CARD_ID] || {}),
        ...promoted.defaults,
      },
      [MARKET_INSIGHTS_CARD_ID]: {
        ...((brain.cardDefaults || {})[MARKET_INSIGHTS_CARD_ID] || {}),
        ...promoted.defaults,
      },
    };
  }

  return saveClientBrain(clientId, patch);
}

module.exports = {
  CLIENT_BRAIN_VERSION,
  DEFAULT_USE_FOR,
  buildAutoSourceRefs,
  buildClientBrainDraft,
  buildCardDefaultsForCard,
  buildClientBrainCompletion,
  compileAndSaveClientBrainMarkdown,
  buildDecisionEngine,
  buildDecisionPack,
  buildDashboardMirror,
  buildMissingDecisionQueue,
  buildUseForContext,
  collectDecisionAcquisition,
  computeBrainConfidence,
  confidenceFromSources,
  detectContradictions,
  generateAndSaveClientBrain,
  getClientBrain,
  loadClientBrainCardDefaults,
  loadClientBrainContext,
  loadClientBrainDecisions,
  markClientBrainStatus,
  mergeVoice,
  normalizeSourceRef,
  readClientBrainDoc,
  saveClientBrainCardSettingsSnapshot,
  saveClientBrain,
  saveSourceRefs,
  createClientBrainMarkdownTemplate,
};
