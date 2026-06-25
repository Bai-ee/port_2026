'use strict';

const fb = require('../../api/_lib/firebase-admin.cjs');

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
    lines.push(line('Copy rules', voice.formattingRules));
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
    identity: brain.identity || {},
    aiContextPack: {
      shortContext: brain.aiContextPack?.shortContext || '',
      longContext: brain.aiContextPack?.longContext || '',
    },
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
  let draft = { ...fresh, voice: mergeVoice(brain.voice, fresh.voice) };
  if (mode === 'llm') {
    try {
      draft = await refineDraftWithModel(draft, sourceRefs);
    } catch (err) {
      // Non-fatal — keep the deterministic draft, record the failure for the UI.
      draft = { ...draft, regenerationError: compact(err.message, 200) };
    }
  }
  return saveClientBrain(clientId, draft);
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

module.exports = {
  CLIENT_BRAIN_VERSION,
  DEFAULT_USE_FOR,
  buildAutoSourceRefs,
  buildClientBrainDraft,
  buildDashboardMirror,
  buildUseForContext,
  computeBrainConfidence,
  confidenceFromSources,
  detectContradictions,
  generateAndSaveClientBrain,
  getClientBrain,
  loadClientBrainContext,
  markClientBrainStatus,
  mergeVoice,
  normalizeSourceRef,
  readClientBrainDoc,
  saveClientBrain,
  saveSourceRefs,
};
