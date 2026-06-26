import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildClientBrainDraft,
  buildClientBrainCompletion,
  buildCardDefaultsForCard,
  buildDecisionPack,
  buildDecisionEngine,
  buildUseForContext,
  computeBrainConfidence,
  confidenceFromSources,
  detectContradictions,
  mergeVoice,
  normalizeSourceRef,
} from '../store.cjs';

test('normalizeSourceRef fills defaults and preserves use-for overrides', () => {
  const ref = normalizeSourceRef({
    id: 'bad id!',
    sourceType: 'website',
    label: 'Website',
    useFor: { tone: false, strategy: true },
  });

  assert.equal(ref.id, 'bad-id');
  assert.equal(ref.sourceType, 'website');
  assert.equal(ref.enabled, true);
  assert.equal(ref.useFor.tone, false);
  assert.equal(ref.useFor.strategy, true);
  assert.equal(ref.useFor.copy, true);
});

test('confidenceFromSources scores enabled source quality', () => {
  assert.equal(confidenceFromSources([]), 'low');
  assert.equal(confidenceFromSources([
    { enabled: true, trustLevel: 'high', freshness: 'current', relevance: 'high' },
    { enabled: false, trustLevel: 'low', freshness: 'stale', relevance: 'low' },
  ]), 'high');
});

test('buildClientBrainDraft creates compact context from enabled source refs', () => {
  const sourceRefs = [
    normalizeSourceRef({
      id: 'client-record',
      sourceType: 'manual_note',
      label: 'Client record',
      extractedFields: { name: 'Acme Studio', primaryUrl: 'https://acme.test' },
    }),
    normalizeSourceRef({
      id: 'brand-overview',
      sourceType: 'onboarding',
      label: 'Brand overview',
      extractedFields: {
        industry: 'creative systems',
        summary: 'Builds production-ready design and automation systems.',
        targetAudience: ['founders', 'operators'],
        valueProps: ['fast shipping', 'systems-first strategy'],
      },
    }),
    normalizeSourceRef({
      id: 'brand-snapshot',
      sourceType: 'brand_guide',
      label: 'Brand snapshot',
      extractedFields: {
        voice: 'direct, tactical, low fluff',
        preferredWords: ['systems', 'operator'],
      },
    }),
  ];

  const draft = buildClientBrainDraft({
    clientId: 'acme',
    sourceRefs,
    bundle: {
      client: {},
      clientConfig: {},
      dashboardState: {},
    },
  });

  assert.equal(draft.identity.name, 'Acme Studio');
  assert.equal(draft.identity.category, 'creative systems');
  assert.match(draft.aiContextPack.shortContext, /Acme Studio/);
  assert.match(draft.voice.toneSummary, /direct/);
  assert.ok(Array.isArray(draft.missingData));
});

test('buildUseForContext scopes sections to the requested purpose', () => {
  const brain = {
    identity: { name: 'Acme', category: 'creative systems', primaryUrl: 'https://acme.test', description: 'Builds systems.' },
    positioning: { oneLiner: 'Systems-first studio', differentiation: ['fast'] },
    voice: { toneSummary: 'direct, low fluff', preferredWords: ['systems'], bannedWords: ['synergy'], formattingRules: ['be concise'] },
    audience: { primary: ['operators'] },
    offers: { services: ['design systems'] },
    content: { pillars: ['shipping cadence'] },
    sourceRefs: [normalizeSourceRef({ id: 'a', enabled: true })],
  };

  const social = buildUseForContext(brain, 'socialPosts');
  assert.match(social, /CLIENT CONTEXT/);
  assert.match(social, /Voice: direct/);     // voice section included
  assert.match(social, /Offers: design systems/);
  assert.doesNotMatch(social, /Audience:/);  // audience not in socialPosts scope
});

test('buildUseForContext returns empty when no enabled source allows the purpose', () => {
  const brain = {
    identity: { name: 'Acme' },
    voice: { toneSummary: 'direct' },
    sourceRefs: [normalizeSourceRef({ id: 'a', enabled: true, useFor: { tone: false, copy: false } })],
  };
  assert.equal(buildUseForContext(brain, ['tone', 'copy']), '');
});

test('detectContradictions flags disagreeing enabled sources', () => {
  const refs = [
    normalizeSourceRef({ id: 'a', enabled: true, extractedFields: { industry: 'coffee shop' } }),
    normalizeSourceRef({ id: 'b', enabled: true, extractedFields: { industry: 'software' } }),
    normalizeSourceRef({ id: 'c', enabled: false, extractedFields: { industry: 'bakery' } }),
  ];
  const out = detectContradictions(refs);
  const cat = out.find((c) => c.field === 'identity.category');
  assert.ok(cat, 'category contradiction detected');
  assert.equal(cat.values.length, 2);            // disabled source excluded
});

test('detectContradictions ignores agreement (incl. url normalization)', () => {
  const refs = [
    normalizeSourceRef({ id: 'a', enabled: true, extractedFields: { primaryUrl: 'https://acme.test/' } }),
    normalizeSourceRef({ id: 'b', enabled: true, extractedFields: { websiteUrl: 'http://acme.test' } }),
  ];
  assert.deepEqual(detectContradictions(refs), []);
});

test('computeBrainConfidence demotes for gaps and contradictions', () => {
  const strong = [{ enabled: true, trustLevel: 'high', freshness: 'current', relevance: 'high' }];
  assert.equal(computeBrainConfidence({ sourceRefs: strong }), 'high');
  assert.equal(computeBrainConfidence({ sourceRefs: strong, missingData: [{ priority: 'high' }] }), 'medium');
  assert.equal(computeBrainConfidence({ sourceRefs: strong, missingData: [{ priority: 'high' }], contradictions: [{}] }), 'low');
});

test('mergeVoice preserves non-empty prior voice over a fresh draft', () => {
  const prev = {
    toneSummary: 'direct, low fluff',          // manual edit — keep
    scribeInstructions: 'lead with the action', // manual edit — keep
    pillars: ['systems', 'shipping'],           // seeded — keep
    bannedWords: [],                            // empty — let draft fill
  };
  const draft = {
    toneSummary: 'auto-derived tone',
    scribeInstructions: '',
    pillars: [],
    bannedWords: ['synergy'],
    writingRules: ['concise'],                  // new field — carries through
  };
  const out = mergeVoice(prev, draft);
  assert.equal(out.toneSummary, 'direct, low fluff');
  assert.equal(out.scribeInstructions, 'lead with the action');
  assert.deepEqual(out.pillars, ['systems', 'shipping']);
  assert.deepEqual(out.bannedWords, ['synergy']);   // prev empty -> draft fills
  assert.deepEqual(out.writingRules, ['concise']);
});

test('mergeVoice on empty prev returns the draft voice unchanged', () => {
  const draft = { toneSummary: 'auto', pillars: [] };
  assert.deepEqual(mergeVoice({}, draft), draft);
});

test('buildDecisionPack maps approved understanding and card config into structured decisions', () => {
  const brain = {
    status: 'approved',
    confidence: 'high',
    identity: { name: 'Acme Studio', category: 'creative ops', primaryUrl: 'https://acme.test' },
    positioning: { oneLiner: 'Creative operations systems for founders.' },
    audience: { primary: ['startup founders'] },
    voice: { toneSummary: 'direct', bannedWords: ['synergy'] },
    offers: { services: ['automation sprint'] },
    content: { pillars: ['workflow automation'] },
    sourceRefs: [{ id: 'website', enabled: true }],
  };
  const decisions = buildDecisionPack(brain, {
    clientConfig: {
      marketingBriefConfig: {
        brandKeywords: ['Acme'],
        categoryTerms: ['creative automation'],
        kols: ['@opsleader'],
        competitors: ['Other Studio'],
        sourcePlatforms: ['web', 'x'],
      },
    },
    dashboardState: { marketCategory: { value: 'AI consulting' } },
  });

  assert.equal(decisions.identity.name.value, 'Acme Studio');
  assert.equal(decisions.identity.name.status, 'approved');
  assert.ok(decisions.intelligence, 'intelligence domains are present');
  assert.ok(decisions.intelligence.identity.categoryToOwn.value.includes('creative automation'));
  assert.ok(decisions.intelligence.market.thoughtLeaders.value.includes('@opsleader'));
  assert.ok(decisions.intelligence.discovery.keywords.value.includes('creative automation'));
  assert.ok(decisions.intelligence.discovery.watchLists.value.includes('@opsleader'));
  assert.ok(decisions.intelligence.authority.prohibitedClaims.value.includes('synergy'));
  assert.ok(Array.isArray(decisions.decisionDrivers));
  assert.equal(decisions.decisionDrivers[0].status, 'approved');
  assert.equal(decisions.identity.name.acquisition.method, 'automatic');
  assert.equal(decisions.identity.name.acquisition.validationStatus, 'approved');
  assert.ok(decisions.decisionDrivers[0].search.includes('creative automation'));
  assert.ok(decisions.decisionDrivers[0].leadGen.includes('startup founders'));
  assert.deepEqual(decisions.search.keywords.value.slice(0, 2), ['Acme', 'Acme Studio']);
  assert.ok(decisions.search.topicsToMonitor.value.includes('creative automation'));
  assert.ok(decisions.social.handlesToFollow.value.includes('@opsleader'));
  assert.ok(decisions.search.excludedTerms.value.includes('synergy'));
});

test('buildCardDefaultsForCard creates Marketing Brief defaults from decisions', () => {
  const decisions = {
    identity: { name: { value: 'Acme Studio' } },
    positioning: { oneLiner: { value: 'Creative operations systems.' } },
    audience: { primary: { value: ['startup founders'] } },
    search: {
      keywords: { value: ['Acme Studio'] },
      topicsToMonitor: { value: ['creative automation'] },
      competitorTerms: { value: ['Other Studio'] },
    },
    social: {
      handlesToFollow: { value: ['@opsleader'] },
      platforms: { value: ['web', 'x'] },
    },
  };
  const defaults = buildCardDefaultsForCard(decisions, 'marketing-brief');

  assert.equal(defaults.fields.brandName.value, 'Acme Studio');
  assert.deepEqual(defaults.fields.brandKeywords.value, ['Acme Studio']);
  assert.deepEqual(defaults.fields.kols.value, ['@opsleader']);
  assert.equal(defaults.fields.searches.value[0].label, 'BRAND');
  assert.match(defaults.fields.sourceFocus.value, /Creative operations/);
});

test('buildDecisionEngine adds informational acquisition, completion, and missing decision queue', () => {
  const brain = {
    status: 'approved',
    confidence: 'high',
    identity: { name: 'Acme Studio', category: 'creative ops' },
    positioning: { oneLiner: 'Creative operations systems.' },
    audience: { primary: ['startup founders'] },
    offers: { services: ['automation sprint'] },
    sourceRefs: [{ id: 'website', enabled: true, trustLevel: 'high', freshness: 'current' }],
  };
  const engine = buildDecisionEngine(brain, { clientConfig: {}, dashboardState: {} });

  assert.equal(engine.completion.informationalOnly, true);
  assert.ok(engine.completion.score >= 0);
  assert.ok(engine.completion.domains.discovery);
  assert.ok(Array.isArray(engine.missingDecisionQueue));
  assert.ok(engine.decisionAcquisition.completionScore >= 0);
});

test('buildClientBrainCompletion scores missing fields deterministically', () => {
  const completion = buildClientBrainCompletion({
    identity: { name: { value: 'Acme', status: 'approved' } },
    positioning: { oneLiner: { value: '', status: 'suggested' } },
  }, { sourceRefs: [] });

  assert.ok(completion.domains.identity.missingFields.some((field) => field.path === 'decisions.positioning.oneLiner'));
  assert.ok(completion.domains.discovery.missingFields.length > 0);
});
