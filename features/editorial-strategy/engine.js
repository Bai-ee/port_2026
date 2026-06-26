const CAMPAIGN_STATUSES = new Set(['active', 'paused', 'complete']);
const ASSET_TYPES = new Set(['screenshot', 'video', 'image', 'design-file', 'case-study', 'story', 'thread', 'quote', 'historic-work', 'current-work']);
const INFLUENCE_LEVELS = {
  NO_CHANGE: {
    level: 'no-change',
    label: 'No Change',
    frequencyTarget: '50%',
    instruction: 'Publish the originally scheduled content without strategic changes.',
  },
  ADAPT: {
    level: 'adapt',
    label: 'Adapt',
    frequencyTarget: '30%',
    instruction: 'Keep the scheduled campaign direction, but update the hook, terminology, or example with today\'s signal.',
  },
  SWAP_WITHIN_CAMPAIGN: {
    level: 'swap-within-campaign',
    label: 'Swap Within Campaign',
    frequencyTarget: '15%',
    instruction: 'Replace today\'s scheduled asset with a stronger prepared asset from the same campaign.',
  },
  INTERRUPT_CAMPAIGN: {
    level: 'interrupt-campaign',
    label: 'Interrupt Campaign',
    frequencyTarget: '5%',
    instruction: 'Temporarily interrupt the schedule only because the market event strongly reinforces approved positioning.',
  },
};

function cap(value, max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function slugify(value, fallback = 'item') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function cleanList(input, { maxItems = 20, maxLen = 120 } = {}) {
  const rows = Array.isArray(input) ? input : String(input || '').split(/[\n,]+/);
  return rows
    .map((item) => cap(item, maxLen))
    .filter(Boolean)
    .filter((item, index, arr) => arr.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index)
    .slice(0, maxItems);
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizePercent(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n <= 1 ? n * 100 : n));
}

function cleanRecord(input = {}, { maxKeys = 20, maxItems = 20 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .slice(0, maxKeys)
    .map(([key, value]) => [
      cap(key, 80),
      Array.isArray(value)
        ? cleanList(value, { maxItems })
        : typeof value === 'object' && value
          ? cleanRecord(value, { maxKeys, maxItems })
          : cap(value, 240),
    ])
    .filter(([key, value]) => key && (Array.isArray(value) ? value.length : value && Object.keys(value).length !== 0)));
}

function normalizeSchedulePolicy(raw = {}) {
  const policy = raw && typeof raw === 'object' ? raw : {};
  return {
    platforms: {
      primary: cleanList(policy.platforms?.primary || policy.primaryPlatforms, { maxItems: 8 }).map((item) => item.toLowerCase()),
      secondary: cleanList(policy.platforms?.secondary || policy.secondaryPlatforms, { maxItems: 8 }).map((item) => item.toLowerCase()),
      tertiary: cleanList(policy.platforms?.tertiary || policy.tertiaryPlatforms, { maxItems: 8 }).map((item) => item.toLowerCase()),
    },
    publishingCadence: cleanRecord(policy.publishingCadence || policy.cadence, { maxKeys: 12 }),
    preferredPublishingWindows: cleanRecord(policy.preferredPublishingWindows || policy.publishingWindows, { maxKeys: 12 }),
    campaignAllocation: cleanRecord(policy.campaignAllocation || policy.allocations, { maxKeys: 30 }),
    narrativeRotation: {
      minDaysBetweenSameNarrative: Number(policy.narrativeRotation?.minDaysBetweenSameNarrative || 0) || 0,
      maxProjectUsesPerSevenDays: Number(policy.narrativeRotation?.maxProjectUsesPerSevenDays || 0) || 0,
      rotateBy: cleanList(policy.narrativeRotation?.rotateBy || ['Project', 'Narrative', 'Editorial Format', 'Platform'], { maxItems: 8 }),
    },
    editorialFormatRotation: {
      formats: cleanList(policy.editorialFormatRotation?.formats || policy.editorialFormats, { maxItems: 30 }),
      maxConsecutiveRepeats: Number(policy.editorialFormatRotation?.maxConsecutiveRepeats || 0) || 0,
    },
    assetReusePolicy: {
      reuseAfterDays: Number(policy.assetReusePolicy?.reuseAfterDays || 0) || 0,
      rules: cleanList(policy.assetReusePolicy?.rules || policy.assetReuseRules, { maxItems: 12 }),
    },
    dailyAdaptationLimits: {
      may: cleanList(policy.dailyAdaptationLimits?.may || policy.adaptationMay, { maxItems: 20 }),
      mayNot: cleanList(policy.dailyAdaptationLimits?.mayNot || policy.adaptationMayNot, { maxItems: 20 }),
      movableWindowDays: Number(policy.dailyAdaptationLimits?.movableWindowDays || 0) || 0,
    },
    quietPeriods: cleanList(policy.quietPeriods, { maxItems: 20 }),
    promotionPolicy: {
      maxMonthlyPct: normalizePercent(policy.promotionPolicy?.maxMonthlyPct, 0),
      rules: cleanList(policy.promotionPolicy?.rules || policy.promotionRules, { maxItems: 12 }),
    },
    fallbackRules: cleanList(policy.fallbackRules, { maxItems: 12 }),
    approvalPolicy: cleanList(policy.approvalPolicy, { maxItems: 12 }),
    successEvaluation: cleanList(policy.successEvaluation, { maxItems: 24 }),
  };
}

function normalizeAsset(raw = {}, index = 0, campaignId = '') {
  const title = cap(raw.title || raw.label || raw.name || `Asset ${index + 1}`, 120);
  const type = ASSET_TYPES.has(raw.type) ? raw.type : 'story';
  const id = cap(raw.id || `${campaignId || 'campaign'}-${slugify(title, `asset-${index + 1}`)}`, 100);
  return {
    id,
    title,
    type,
    description: cap(raw.description || raw.summary, 500),
    url: cap(raw.url, 500),
    storagePath: cap(raw.storagePath, 500),
    campaignId,
    narrative: cap(raw.narrative, 120),
    projects: cleanList(raw.projects, { maxItems: 12 }),
    topics: cleanList(raw.topics, { maxItems: 16 }),
    platforms: cleanList(raw.platforms, { maxItems: 8 }).map((item) => item.toLowerCase()),
    keywords: cleanList(raw.keywords, { maxItems: 20 }),
    clientBrainDecisionRefs: cleanList(raw.clientBrainDecisionRefs, { maxItems: 12 }),
    evergreenScore: clamp01(raw.evergreenScore, 0.7),
    freshnessScore: clamp01(raw.freshnessScore, 0.5),
    preparedCopy: cap(raw.preparedCopy, 1200),
    mediaHint: cap(raw.mediaHint, 400),
    status: raw.status === 'retired' ? 'retired' : 'ready',
  };
}

function normalizeCampaign(raw = {}, index = 0) {
  const name = cap(raw.name || raw.label || `Campaign ${index + 1}`, 120);
  const id = cap(raw.id || slugify(name, `campaign-${index + 1}`), 100);
  const assetLibrary = (Array.isArray(raw.assetLibrary) ? raw.assetLibrary : raw.assets || [])
    .slice(0, 80)
    .map((asset, assetIndex) => normalizeAsset(asset, assetIndex, id))
    .filter((asset) => asset.title && asset.status !== 'retired');
  return {
    id,
    name,
    status: CAMPAIGN_STATUSES.has(raw.status) ? raw.status : 'active',
    priority: clamp01(raw.priority, 0.6),
    allocationPct: normalizePercent(raw.allocationPct || raw.allocationPercent || raw.allocation, 0),
    strategicObjective: cap(raw.strategicObjective || raw.objective, 500),
    positioningObjective: cap(raw.positioningObjective, 500),
    targetAudience: cleanList(raw.targetAudience || raw.audience, { maxItems: 12 }),
    supportedClientBrainTopics: cleanList(raw.supportedClientBrainTopics || raw.clientBrainTopics, { maxItems: 20 }),
    supportingProjects: cleanList(raw.supportingProjects || raw.projects, { maxItems: 20 }),
    assetLibrary,
    narrativeBuckets: cleanList(raw.narrativeBuckets || raw.narratives, { maxItems: 20 }),
    keywords: cleanList(raw.keywords, { maxItems: 30 }),
    dailySignalTriggers: cleanList(raw.dailySignalTriggers || raw.signalTriggers, { maxItems: 30 }),
    editorialFormats: cleanList(raw.editorialFormats || raw.formats, { maxItems: 20 }),
    fallback: cap(raw.fallback || raw.fallbackRecommendation || raw.fallbackAsset, 240),
    duration: {
      startDate: cap(raw.duration?.startDate || raw.startDate, 30),
      endDate: cap(raw.duration?.endDate || raw.endDate, 30),
    },
    weeklyFocus: cap(raw.weeklyFocus, 300),
    successMetrics: cleanList(raw.successMetrics || raw.metrics, { maxItems: 20 }),
  };
}

export function normalizeEditorialStrategyConfig(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const schedulePolicy = normalizeSchedulePolicy(raw.schedulePolicy || raw.marketingStrategy?.schedulePolicy);
  const campaigns = (Array.isArray(raw.campaigns) ? raw.campaigns : [])
    .slice(0, 24)
    .map((campaign, index) => normalizeCampaign(campaign, index))
    .filter((campaign) => campaign.name && campaign.status !== 'complete');
  return {
    enabled: raw.enabled !== false,
    frameworkVersion: cap(raw.frameworkVersion || raw.version || '2.0', 40),
    schedulePolicy,
    campaigns,
    operatorPreferences: {
      preferredPlatforms: cleanList(raw.operatorPreferences?.preferredPlatforms, { maxItems: 8 }).map((item) => item.toLowerCase()),
      avoidTopics: cleanList(raw.operatorPreferences?.avoidTopics, { maxItems: 20 }),
      preferredNarratives: cleanList(raw.operatorPreferences?.preferredNarratives, { maxItems: 20 }),
    },
    recentPublishing: (Array.isArray(raw.recentPublishing) ? raw.recentPublishing : [])
      .slice(0, 40)
      .map((item, index) => ({
        id: cap(item?.id || `published-${index + 1}`, 100),
        campaignId: cap(item?.campaignId, 100),
        assetId: cap(item?.assetId, 100),
        narrative: cap(item?.narrative, 120),
        publishedAt: cap(item?.publishedAt || item?.scheduledAt, 40),
      })),
  };
}

function textOfSignal(signal) {
  return [
    signal.label,
    signal.title,
    signal.summary,
    signal.content,
    signal.detail,
    signal.name,
    signal.type,
  ].filter(Boolean).join(' ');
}

function addSignal(out, type, raw, index) {
  if (!raw) return;
  const text = typeof raw === 'string' ? raw : textOfSignal(raw);
  const label = cap(typeof raw === 'string' ? raw : raw.title || raw.name || raw.headline || raw.label || `${type} ${index + 1}`, 140);
  const summary = cap(text, 360);
  if (!summary) return;
  out.push({
    id: `${type}-${index + 1}`,
    type,
    label,
    summary,
    weight: type === 'kol' || type === 'viral' ? 1 : type === 'competitor' ? 0.8 : 0.6,
  });
}

function signalArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.opportunities)) return value.opportunities;
  if (Array.isArray(value?.items)) return value.items;
  return [];
}

export function collectDailyEditorialSignals(ctx = {}) {
  const out = [];
  const intelligence = ctx.intelligence || {};
  signalArray(intelligence.kolActivity).slice(0, 12).forEach((item, index) => addSignal(out, 'kol', item, index));
  signalArray(intelligence.viralOpportunities).slice(0, 12).forEach((item, index) => addSignal(out, 'viral', item, index));
  signalArray(intelligence.categoryTrends).slice(0, 12).forEach((item, index) => addSignal(out, 'trend', item, index));
  signalArray(intelligence.competitorIntel).slice(0, 8).forEach((item, index) => addSignal(out, 'competitor', item, index));
  signalArray(intelligence.brandMentions).slice(0, 8).forEach((item, index) => addSignal(out, 'brand', item, index));
  (ctx.signals?.events?.items || []).slice(0, 8).forEach((item, index) => addSignal(out, 'calendar', item, index));
  (ctx.signals?.holidays?.items || []).slice(0, 8).forEach((item, index) => addSignal(out, 'seasonality', item, index));
  if (ctx.signals?.holidays?.upcoming) addSignal(out, 'seasonality', ctx.signals.holidays.upcoming, out.length);
  return out;
}

function termMatches(text, terms = []) {
  const lower = String(text || '').toLowerCase();
  return cleanList(terms, { maxItems: 100 }).filter((term) => lower.includes(term.toLowerCase()));
}

function labelStrength(score) {
  if (score >= 80) return 'strong';
  if (score >= 55) return 'medium';
  return 'weak';
}

function buildNarrativeStrength(campaign, dailySignals) {
  return campaign.narrativeBuckets
    .map((narrative) => {
      const relatedAssets = campaign.assetLibrary.filter((asset) =>
        asset.narrative === narrative ||
        termMatches(`${asset.title} ${asset.description} ${asset.preparedCopy} ${asset.topics.join(' ')} ${asset.keywords.join(' ')}`, [narrative]).length
      );
      const terms = [
        narrative,
        ...relatedAssets.flatMap((asset) => [
          asset.title,
          asset.description,
          asset.preparedCopy,
          ...asset.projects,
          ...asset.topics,
          ...asset.keywords,
        ]),
      ].filter(Boolean);
      let rawScore = 0;
      const matchedSignals = [];
      for (const signal of dailySignals) {
        const matches = termMatches(`${signal.summary} ${signal.label}`, terms);
        if (!matches.length) continue;
        rawScore += Math.min(1, matches.length / 3) * signal.weight;
        matchedSignals.push({
          type: signal.type,
          label: signal.label,
          matchedTerms: matches.slice(0, 6),
        });
      }
      const score = Math.min(100, Math.round(rawScore * 100));
      return {
        narrative,
        score,
        strength: labelStrength(score),
        matchedSignals: matchedSignals.slice(0, 5),
      };
    })
    .sort((a, b) => b.score - a.score || a.narrative.localeCompare(b.narrative));
}

function resolveInfluenceDecision(best) {
  const score = best?.scoring?.score || 0;
  const signalScore = best?.scoring?.signalScore || 0;
  const signalCount = best?.scoring?.relevantSignals?.length || 0;
  if (!best || score < 45 || signalCount === 0) return INFLUENCE_LEVELS.NO_CHANGE;
  if (score >= 92 && signalScore >= 0.85 && signalCount >= 2) return INFLUENCE_LEVELS.INTERRUPT_CAMPAIGN;
  if (score >= 75 && signalScore >= 0.5) return INFLUENCE_LEVELS.SWAP_WITHIN_CAMPAIGN;
  return INFLUENCE_LEVELS.ADAPT;
}

function summarizeSchedulePolicy(policy = {}) {
  const primary = policy.platforms?.primary || [];
  const secondary = policy.platforms?.secondary || [];
  const cadence = Object.entries(policy.publishingCadence || {}).map(([platform, rule]) => `${platform}: ${Array.isArray(rule) ? rule.join(', ') : rule}`);
  const windows = Object.entries(policy.preferredPublishingWindows || {}).map(([platform, rule]) => `${platform}: ${Array.isArray(rule) ? rule.join(', ') : rule}`);
  const allocation = Object.entries(policy.campaignAllocation || {}).map(([campaign, pct]) => `${campaign}: ${pct}`);
  return {
    primaryPlatforms: primary,
    secondaryPlatforms: secondary,
    publishingCadence: cadence.slice(0, 8),
    preferredPublishingWindows: windows.slice(0, 8),
    campaignAllocation: allocation.slice(0, 12),
    narrativeRotation: policy.narrativeRotation || {},
    editorialFormats: policy.editorialFormatRotation?.formats || [],
    fallbackRules: policy.fallbackRules || [],
  };
}

function scoreAsset({ campaign, asset, dailySignals, recentPublishing, operatorPreferences }) {
  const campaignTerms = [
    campaign.name,
    campaign.strategicObjective,
    campaign.positioningObjective,
    ...campaign.supportedClientBrainTopics,
    ...campaign.supportingProjects,
    ...campaign.narrativeBuckets,
    ...campaign.keywords,
    ...campaign.dailySignalTriggers,
  ];
  const assetTerms = [
    asset.title,
    asset.description,
    asset.narrative,
    asset.preparedCopy,
    ...asset.projects,
    ...asset.topics,
    ...asset.keywords,
  ];
  const allTerms = [...campaignTerms, ...assetTerms].filter(Boolean);
  const signalHits = [];
  let signalScore = 0;
  for (const signal of dailySignals) {
    const matches = termMatches(`${signal.summary} ${signal.label}`, allTerms);
    if (matches.length) {
      const contribution = Math.min(1, matches.length / 4) * signal.weight;
      signalScore += contribution;
      signalHits.push({ ...signal, matchedTerms: matches.slice(0, 6) });
    }
  }
  signalScore = Math.min(1, signalScore);

  const narrativeTerms = [asset.narrative, ...asset.topics, ...campaign.narrativeBuckets].filter(Boolean);
  const narrativeAlignment = narrativeTerms.length && termMatches(narrativeTerms.join(' '), campaign.narrativeBuckets).length
    ? 1
    : asset.narrative ? 0.75 : 0.45;
  const allocationWeight = campaign.allocationPct ? clamp01(campaign.allocationPct / 100, campaign.priority) : campaign.priority;
  const campaignPriority = (campaign.priority * 0.7) + (allocationWeight * 0.3);
  const assetReadiness = (asset.evergreenScore * 0.55) + (asset.freshnessScore * 0.45);
  const platformFit = !operatorPreferences.preferredPlatforms.length
    ? 0.7
    : asset.platforms.some((platform) => operatorPreferences.preferredPlatforms.includes(platform)) ? 1 : 0.45;
  const recentlyUsed = recentPublishing.some((item) =>
    item.assetId === asset.id ||
    item.campaignId === campaign.id ||
    (item.narrative && item.narrative === asset.narrative)
  );
  const recentPenalty = recentlyUsed ? 0.15 : 0;
  const avoidPenalty = termMatches(assetTerms.join(' '), operatorPreferences.avoidTopics).length ? 0.2 : 0;

  const score = Math.max(0, Math.min(100, Math.round(
    campaignPriority * 25 +
    narrativeAlignment * 20 +
    signalScore * 25 +
    assetReadiness * 15 +
    platformFit * 10 +
    (1 - recentPenalty) * 5 -
    avoidPenalty * 100
  )));

  return {
    score,
    signalScore,
    narrativeAlignment,
    campaignPriority,
    allocationPct: campaign.allocationPct,
    assetReadiness,
    platformFit,
    recentPenalty,
    relevantSignals: signalHits.slice(0, 6),
  };
}

export function buildDailyEditorialRecommendation({ editorial, ctx = {}, now = new Date().toISOString() } = {}) {
  const config = normalizeEditorialStrategyConfig(editorial);
  if (!config.enabled || !config.campaigns.length) {
    return {
      mode: 'fallback',
      influenceLevel: INFLUENCE_LEVELS.NO_CHANGE.level,
      influenceDecision: INFLUENCE_LEVELS.NO_CHANGE,
      schedulePolicy: summarizeSchedulePolicy(config.schedulePolicy),
      reason: 'No active editorial campaigns configured.',
      fallbackRecommendation: 'Use the originally scheduled content.',
      generatedAt: now,
    };
  }

  const dailySignals = collectDailyEditorialSignals(ctx);
  const candidates = [];
  for (const campaign of config.campaigns.filter((item) => item.status === 'active')) {
    for (const asset of campaign.assetLibrary) {
      const scoring = scoreAsset({
        campaign,
        asset,
        dailySignals,
        recentPublishing: config.recentPublishing,
        operatorPreferences: config.operatorPreferences,
      });
      candidates.push({ campaign, asset, scoring });
    }
  }

  candidates.sort((a, b) => b.scoring.score - a.scoring.score);
  const best = candidates[0] || null;
  if (!best || best.scoring.score < 45 || !best.scoring.relevantSignals.length) {
    return {
      mode: 'fallback',
      influenceLevel: INFLUENCE_LEVELS.NO_CHANGE.level,
      influenceDecision: INFLUENCE_LEVELS.NO_CHANGE,
      schedulePolicy: summarizeSchedulePolicy(config.schedulePolicy),
      reason: best ? 'No prepared asset had enough signal alignment today.' : 'No ready assets found in active campaigns.',
      fallbackRecommendation: 'Use the originally scheduled content.',
      generatedAt: now,
      topScore: best?.scoring.score || 0,
      dailySignals: dailySignals.slice(0, 8),
    };
  }

  const influenceDecision = resolveInfluenceDecision(best);
  const narrativeStrength = buildNarrativeStrength(best.campaign, dailySignals);
  const strongestNarrative = narrativeStrength[0]?.score > 0 ? narrativeStrength[0].narrative : '';
  const narrative = best.asset.narrative || strongestNarrative || best.campaign.narrativeBuckets[0] || best.campaign.name;
  const confidence = best.scoring.score >= 75 ? 'high' : best.scoring.score >= 60 ? 'medium' : 'low';
  return {
    mode: 'recommendation',
    generatedAt: now,
    influenceLevel: influenceDecision.level,
    influenceDecision,
    schedulePolicy: summarizeSchedulePolicy(config.schedulePolicy),
    campaign: {
      id: best.campaign.id,
      name: best.campaign.name,
      strategicObjective: best.campaign.strategicObjective,
      positioningObjective: best.campaign.positioningObjective,
      weeklyFocus: best.campaign.weeklyFocus,
      allocationPct: best.campaign.allocationPct,
      editorialFormats: best.campaign.editorialFormats,
      fallback: best.campaign.fallback,
    },
    narrative,
    narrativeStrength,
    selectedAsset: {
      id: best.asset.id,
      title: best.asset.title,
      type: best.asset.type,
      description: best.asset.description,
      url: best.asset.url,
      storagePath: best.asset.storagePath,
      mediaHint: best.asset.mediaHint,
      preparedCopy: best.asset.preparedCopy,
    },
    whySelected: [
      `Opportunity score ${best.scoring.score}/100.`,
      `${influenceDecision.label}: ${influenceDecision.instruction}`,
      `Supports ${best.campaign.name}.`,
      best.campaign.allocationPct ? `Campaign allocation target is ${best.campaign.allocationPct}%.` : '',
      best.scoring.relevantSignals.length ? `Matched ${best.scoring.relevantSignals.length} daily signal(s).` : '',
    ].filter(Boolean).join(' '),
    relevantDailySignals: best.scoring.relevantSignals.map((signal) => ({
      type: signal.type,
      label: signal.label,
      summary: signal.summary,
      matchedTerms: signal.matchedTerms,
    })),
    suggestedCopyAdjustments: [
      'Keep the campaign positioning unchanged.',
      influenceDecision.level === 'adapt'
        ? 'Keep the scheduled asset and update the opening hook to reference the strongest current signal.'
        : influenceDecision.level === 'swap-within-campaign'
          ? 'Use the selected prepared asset because it is stronger than the default scheduled option today.'
          : 'Use this as a rare schedule interruption only if the operator agrees it reinforces approved positioning.',
      best.asset.mediaHint ? 'Use the prepared asset as the supporting visual.' : 'Use the prepared story or example as the proof point.',
      'Preserve approved Client Brain language and do not chase unrelated trends.',
    ],
    confidence,
    opportunityScore: best.scoring.score,
    fallbackRecommendation: 'Use the originally scheduled content if the operator rejects this recommendation.',
  };
}

export function formatEditorialRecommendationForPrompt(recommendation = {}) {
  if (!recommendation || recommendation.mode !== 'recommendation') {
    return `Mode: fallback\nReason: ${cap(recommendation.reason, 240) || 'No editorial recommendation.'}\nFallback: ${cap(recommendation.fallbackRecommendation, 240) || 'Use the originally scheduled content.'}`;
  }
  return [
    `Mode: recommendation`,
    `Influence: ${recommendation.influenceDecision?.label || recommendation.influenceLevel || 'Adapt'} (${recommendation.influenceDecision?.frequencyTarget || ''})`,
    `Schedule policy: primary ${(recommendation.schedulePolicy?.primaryPlatforms || []).join(', ') || 'none'}; cadence ${(recommendation.schedulePolicy?.publishingCadence || []).join(' | ') || 'none'}; windows ${(recommendation.schedulePolicy?.preferredPublishingWindows || []).join(' | ') || 'none'}`,
    `Campaign: ${recommendation.campaign?.name || ''}`,
    `Strategic objective: ${recommendation.campaign?.strategicObjective || ''}`,
    `Positioning objective: ${recommendation.campaign?.positioningObjective || ''}`,
    `Campaign allocation: ${recommendation.campaign?.allocationPct || 0}%`,
    `Narrative: ${recommendation.narrative || ''}`,
    `Editorial formats: ${(recommendation.campaign?.editorialFormats || []).join(', ') || 'none'}`,
    `Narrative strength: ${(recommendation.narrativeStrength || []).slice(0, 4).map((item) => `${item.narrative} ${item.score}/100 ${item.strength}`).join(' | ') || 'none'}`,
    `Selected asset: ${recommendation.selectedAsset?.title || ''} (${recommendation.selectedAsset?.type || 'asset'})`,
    `Why: ${recommendation.whySelected || ''}`,
    `Signals: ${(recommendation.relevantDailySignals || []).map((signal) => `${signal.type}: ${signal.label}`).join(' | ') || 'none'}`,
    `Copy adjustments: ${(recommendation.suggestedCopyAdjustments || []).join(' ')}`,
    `Confidence: ${recommendation.confidence || 'low'} (${recommendation.opportunityScore || 0}/100)`,
    `Fallback: ${recommendation.fallbackRecommendation || 'Use the originally scheduled content.'}`,
  ].join('\n');
}
