'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import SignalToggles from './SignalToggles.jsx';
import UpRightArrow from '../../UpRightArrow';
import { normalizeVertical } from '../../../features/strategy-builder/normalize-vertical.js';

const VERTICALS = [
  'restaurant', 'bar', 'cafe',
  'dog-walker', 'pet-services',
  'fitness', 'wellness',
  'salon', 'beauty',
  'real-estate',
  'retail', 'e-commerce',
  'healthcare', 'clinic',
  'auto', 'repair',
  'legal', 'accounting',
  'home-services', 'hvac',
  'gambling', 'e-games',
];

// Data-generating cards the strategy can draw from. `card` is the dashboard
// tile id opened by the ↗ link (null = no openable tile, e.g. lead-gen filter).
const DATA_SOURCES = [
  {
    key: 'client-brain',
    label: 'Client Brain',
    card: 'client-brain',
    readiness: (ds) =>
      ds?.clientBrain?.aiContextPack?.shortContext
        ? 'ready'
        : ds?.clientBrain
        ? 'partial'
        : 'empty',
  },
  {
    key: 'marketing-brief',
    label: 'Marketing Brief',
    card: 'marketing-brief',
    readiness: (ds) =>
      ds?.marketingBrief?.scoutBrief?.humanBrief || ds?.marketingBrief?.headline
        ? 'ready'
        : ds?.marketingBrief
        ? 'partial'
        : 'empty',
  },
  {
    key: 'daily-brief',
    label: 'Daily / Scout Brief',
    card: 'brief',
    readiness: (ds) =>
      ds?.snapshot?.scribe?.brief?.positioning || ds?.marketingBrief?.headline
        ? 'ready'
        : 'empty',
  },
  {
    key: 'brand-snapshot',
    label: 'Brand Snapshot',
    card: 'brand-system',
    readiness: (ds) =>
      ds?.snapshot?.visualIdentity?.voice ||
      ds?.snapshot?.visualIdentity?.styleGuide?.summary
        ? 'ready'
        : ds?.snapshot?.visualIdentity
        ? 'partial'
        : 'empty',
  },
  {
    key: 'visual-dna',
    label: 'Visual DNA',
    card: 'visual-dna',
    readiness: (ds) =>
      ds?.visualDna?.masterPromptBlock || ds?.snapshot?.visualDna ? 'ready' : 'empty',
  },
  {
    key: 'seo-performance',
    label: 'SEO Performance',
    card: 'seo-performance',
    readiness: (ds) =>
      ds?.seoAudit?.summary ? 'ready' : ds?.seoAudit ? 'partial' : 'empty',
  },
  {
    key: 'lead-gen',
    label: 'Lead Gen Profile',
    card: null,
    readiness: (ds) =>
      ds?.leadgen?.businessName || ds?.leadgen?.city ? 'ready' : 'empty',
  },
  {
    key: 'knowledge-base',
    label: 'Source Library',
    card: 'knowledge-base',
    readiness: (ds) => {
      const sources = [
        ...(Array.isArray(ds?.knowledgeBase?.sources) ? ds.knowledgeBase.sources : []),
        ...(Array.isArray(ds?.strategyBuilder?.lastPlan?.knowledgeBaseSources) ? ds.strategyBuilder.lastPlan.knowledgeBaseSources : []),
        ...(Array.isArray(ds?.marketingBrief?.knowledgeBaseSources) ? ds.marketingBrief.knowledgeBaseSources : []),
        ...(Array.isArray(ds?.brandSystem?.knowledgeBaseSources) ? ds.brandSystem.knowledgeBaseSources : []),
        ...(Array.isArray(ds?.marketCategory?.knowledgeBaseSources) ? ds.marketCategory.knowledgeBaseSources : []),
      ];
      if (sources.length) return 'ready';
      return ds?.knowledgeBase ? 'partial' : 'empty';
    },
  },
];

const EMPTY_EDITORIAL_STRATEGY = {
  enabled: true,
  frameworkVersion: '2.0',
  schedulePolicy: {},
  campaigns: [],
};

function coerceEditorialStrategy(editorial) {
  return editorial && typeof editorial === 'object' && !Array.isArray(editorial)
    ? editorial
    : EMPTY_EDITORIAL_STRATEGY;
}

function buildStrategyPackJson(config, editorial) {
  return JSON.stringify({
    strategyBuilder: {
      config: {
        vertical: config.vertical || '',
        days: config.days || 30,
        postsPerDay: config.postsPerDay || 1,
        baselineMixPct: config.baselineMixPct || 40,
        rampAggressiveness: config.rampAggressiveness ?? 0.5,
        signals: config.signals || {
          weather: { enabled: false },
          events: { enabled: false },
          holidays: { enabled: true },
        },
        sources: config.sources || {},
        events: Array.isArray(config.events) ? config.events : [],
        campaign: {
          objective: config.campaign?.objective || '',
          ctaText: config.campaign?.ctaText || '',
          ctaUrl: config.campaign?.ctaUrl || '',
          postTime: config.campaign?.postTime || '',
          postTime2: config.campaign?.postTime2 || '',
          guardrails: config.campaign?.guardrails || '',
          emojiPolicy: config.campaign?.emojiPolicy || 'none',
          maxHashtags: Number.isFinite(config.campaign?.maxHashtags) ? config.campaign.maxHashtags : 2,
          promotions: Array.isArray(config.campaign?.promotions) ? config.campaign.promotions : [],
        },
        editorial: coerceEditorialStrategy(editorial),
      },
    },
  }, null, 2);
}

function validateEditorialPack(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Strategy pack must be a JSON object.');
  }
  if (parsed.campaigns != null && !Array.isArray(parsed.campaigns)) {
    throw new Error('campaigns must be an array when provided.');
  }
  if (parsed.schedulePolicy != null && (typeof parsed.schedulePolicy !== 'object' || Array.isArray(parsed.schedulePolicy))) {
    throw new Error('schedulePolicy must be an object when provided.');
  }
  return parsed;
}

function validateStrategyConfigPack(config) {
  const required = [
    'vertical',
    'days',
    'postsPerDay',
    'baselineMixPct',
    'rampAggressiveness',
    'signals',
    'sources',
    'events',
    'campaign',
    'editorial',
  ];
  const missing = required.filter((key) => !(key in config));
  if (missing.length) {
    throw new Error(`Required format: strategyBuilder.config missing ${missing.join(', ')}.`);
  }
  if (!config.campaign || typeof config.campaign !== 'object' || Array.isArray(config.campaign)) {
    throw new Error('Required format: strategyBuilder.config.campaign must be an object.');
  }
  const campaignRequired = [
    'objective',
    'ctaText',
    'ctaUrl',
    'postTime',
    'postTime2',
    'guardrails',
    'emojiPolicy',
    'maxHashtags',
    'promotions',
  ];
  const campaignMissing = campaignRequired.filter((key) => !(key in config.campaign));
  if (campaignMissing.length) {
    throw new Error(`Required format: campaign missing ${campaignMissing.join(', ')}.`);
  }
  if (!Array.isArray(config.events)) {
    throw new Error('Required format: strategyBuilder.config.events must be an array.');
  }
  if (!Array.isArray(config.campaign.promotions)) {
    throw new Error('Required format: strategyBuilder.config.campaign.promotions must be an array.');
  }
  return config;
}

function parseStrategyPackJson(raw) {
  const root = JSON.parse(raw);
  const config = root?.strategyBuilder?.config || root?.config || root?.strategyConfig || null;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Required format: JSON must include strategyBuilder.config.');
  }
  validateStrategyConfigPack(config);
  const parsed = config.editorial;
  if (!parsed) {
    throw new Error('Required format: strategyBuilder.config.editorial is required.');
  }
  return { root, config, editorial: validateEditorialPack(parsed) };
}

function toTimeInput(value) {
  const text = String(value || '');
  const firstTime = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!firstTime) return '';
  const suffixes = Array.from(text.matchAll(/\b(AM|PM)\b/gi));
  const inferredSuffix = firstTime[3] || suffixes.at(-1)?.[1] || '';
  let hour = Number(firstTime[1]);
  const minute = Number(firstTime[2] || 0);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  if (/pm/i.test(inferredSuffix) && hour < 12) hour += 12;
  if (/am/i.test(inferredSuffix) && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function firstWindowForPlatform(policy, platforms) {
  const windows = policy?.preferredPublishingWindows || {};
  for (const platform of platforms) {
    const value = windows[platform];
    const rows = Array.isArray(value) ? value : value ? [value] : [];
    const parsed = rows.map(toTimeInput).filter(Boolean);
    if (parsed.length) return parsed.slice(0, 2);
  }
  return [];
}

function inferObjective(editorial) {
  const campaigns = Array.isArray(editorial?.campaigns) ? editorial.campaigns : [];
  const activeCampaign = campaigns
    .filter((c) => !['paused', 'complete', 'completed', 'archived'].includes(String(c?.status || 'active').toLowerCase()))
    .sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0))[0];
  const text = [
    activeCampaign?.strategicObjective,
    activeCampaign?.positioningObjective,
    activeCampaign?.weeklyFocus,
    ...(activeCampaign?.successMetrics || []),
  ].join(' ').toLowerCase();
  if (/\b(book|booking|reservation|appointment|schedule)\b/.test(text)) return 'bookings';
  if (/\b(foot traffic|visit|in-person|walk-in)\b/.test(text)) return 'foot-traffic';
  if (/\b(lead|signup|inbound|dm|inquiry|call)\b/.test(text)) return 'leads';
  if (/\b(promo|promotion|sale|discount|redemption|offer)\b/.test(text)) return 'promotions';
  if (/\b(community|loyalty|reply|conversation|engagement)\b/.test(text)) return 'community';
  if (text) return 'awareness';
  return '';
}

function inferPostsPerDay(editorial) {
  const policy = editorial?.schedulePolicy || {};
  const primary = policy.platforms?.primary || ['x'];
  const cadence = policy.publishingCadence || {};
  for (const platform of primary) {
    const text = String(cadence[platform] || '');
    const match = text.match(/(\d+)\s+(?:high-quality\s+)?posts?\b/i) || text.match(/^\s*(\d+)\b/);
    if (match) return Math.max(1, Math.min(5, Number(match[1]) || 1));
  }
  return null;
}

function buildGuardrails(editorial) {
  const policy = editorial?.schedulePolicy || {};
  const avoidTopics = editorial?.operatorPreferences?.avoidTopics || [];
  const mayNot = policy.dailyAdaptationLimits?.mayNot || [];
  const approval = policy.approvalPolicy || [];
  const parts = [
    avoidTopics.length ? `Avoid: ${avoidTopics.join(', ')}` : '',
    mayNot.length ? `Do not: ${mayNot.join(' ')}` : '',
    approval.length ? `Approval: ${approval.join(' ')}` : '',
  ].filter(Boolean);
  return parts.join(' · ').slice(0, 500);
}

function inferVerticalFromPack(root, editorial) {
  const raw =
    root?.strategyBuilder?.config?.vertical ||
    root?.config?.vertical ||
    root?.strategyConfig?.vertical ||
    root?.vertical ||
    root?.category ||
    root?.marketCategory ||
    editorial?.vertical ||
    editorial?.category ||
    editorial?.marketCategory ||
    editorial?.marketingStrategy?.vertical ||
    '';
  const normalized = normalizeVertical(raw);
  return normalized || String(raw || '').trim().slice(0, 100);
}

function hydrateConfigFromStrategyPack(currentConfig, pack) {
  const { root, config: packConfig, editorial } = pack;
  const policy = editorial?.schedulePolicy || {};
  const platforms = [
    ...(policy.platforms?.primary || []),
    ...(policy.platforms?.secondary || []),
    'x',
    'twitter',
    'linkedin',
  ].map((p) => String(p || '').toLowerCase());
  const [postTime, postTime2] = firstWindowForPlatform(policy, platforms);
  const postsPerDay = Number(packConfig?.postsPerDay) || inferPostsPerDay(editorial);
  const days = Number(packConfig?.days);
  const baselineMixPct = Number(packConfig?.baselineMixPct);
  const rampAggressiveness = Number(packConfig?.rampAggressiveness);
  const rawCampaign = (packConfig?.campaign && typeof packConfig.campaign === 'object') ? packConfig.campaign : {};
  const objective = rawCampaign.objective || inferObjective(editorial);
  const guardrails = rawCampaign.guardrails || buildGuardrails(editorial);
  const vertical = inferVerticalFromPack(root, editorial);
  const rawMaxHashtags = rawCampaign.maxHashtags ?? editorial?.maxHashtags ?? policy.maxHashtags;
  const maxHashtags = rawMaxHashtags == null
    ? null
    : Math.max(0, Math.min(5, Number(rawMaxHashtags)));
  const rawEmojiPolicy = rawCampaign.emojiPolicy || editorial?.emojiPolicy || policy.emojiPolicy;
  const emojiPolicy = ['none', 'sparing', 'liberal'].includes(rawEmojiPolicy) ? rawEmojiPolicy : null;
  const sources = (packConfig?.sources && typeof packConfig.sources === 'object') ? packConfig.sources : null;
  const signals = (packConfig?.signals && typeof packConfig.signals === 'object') ? packConfig.signals : null;
  const events = Array.isArray(packConfig?.events) ? packConfig.events : null;
  const promotions = Array.isArray(rawCampaign.promotions) ? rawCampaign.promotions : null;

  return {
    ...currentConfig,
    ...(vertical ? { vertical } : {}),
    ...(Number.isFinite(days) ? { days: Math.max(7, Math.min(90, days)) } : {}),
    ...(postsPerDay ? { postsPerDay: Math.max(1, Math.min(5, postsPerDay)) } : {}),
    ...(Number.isFinite(baselineMixPct) ? { baselineMixPct: Math.max(10, Math.min(60, baselineMixPct)) } : {}),
    ...(Number.isFinite(rampAggressiveness) ? { rampAggressiveness: Math.max(0, Math.min(1, rampAggressiveness)) } : {}),
    ...(signals ? {
      signals: {
        weather: { enabled: Boolean(signals.weather?.enabled) },
        events: { enabled: Boolean(signals.events?.enabled) },
        holidays: { enabled: signals.holidays?.enabled !== false },
      },
    } : {}),
    ...(sources ? { sources } : {}),
    ...(events ? { events } : {}),
    campaign: {
      ...(currentConfig.campaign || {}),
      ...(objective ? { objective } : {}),
      ...(rawCampaign.ctaText != null ? { ctaText: String(rawCampaign.ctaText).slice(0, 80) } : {}),
      ...(rawCampaign.ctaUrl != null ? { ctaUrl: String(rawCampaign.ctaUrl).slice(0, 300) } : {}),
      ...(rawCampaign.postTime || postTime ? { postTime: rawCampaign.postTime || postTime } : {}),
      ...(rawCampaign.postTime2 || postTime2 ? { postTime2: rawCampaign.postTime2 || postTime2 } : {}),
      ...(guardrails ? { guardrails } : {}),
      ...(Number.isFinite(maxHashtags) ? { maxHashtags } : {}),
      ...(emojiPolicy ? { emojiPolicy } : {}),
      ...(promotions ? { promotions } : {}),
    },
    editorial,
  };
}

function summarizeEditorialStrategy(editorial) {
  const strategy = coerceEditorialStrategy(editorial);
  const campaigns = Array.isArray(strategy.campaigns) ? strategy.campaigns : [];
  const activeCampaigns = campaigns.filter((campaign) => {
    const status = String(campaign?.status || 'active').toLowerCase();
    return !['paused', 'complete', 'completed', 'archived'].includes(status);
  });
  const primaryCampaign = [...activeCampaigns]
    .sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0))[0] || null;
  const assets = campaigns.reduce(
    (sum, campaign) => sum + (Array.isArray(campaign?.assetLibrary) ? campaign.assetLibrary.length : 0),
    0
  );
  const schedulePolicy = strategy.schedulePolicy || {};
  const platforms = schedulePolicy.platforms || {};
  const primaryPlatforms = Array.isArray(platforms.primary) ? platforms.primary : [];
  const secondaryPlatforms = Array.isArray(platforms.secondary) ? platforms.secondary : [];
  const allocation = schedulePolicy.campaignAllocation || {};
  const allocationSummary = Object.entries(allocation)
    .slice(0, 4)
    .map(([name, pct]) => `${name} ${pct}`);

  return {
    enabled: strategy.enabled !== false,
    frameworkVersion: strategy.frameworkVersion || '2.0',
    campaigns,
    activeCampaigns,
    primaryCampaign,
    assets,
    primaryPlatforms,
    secondaryPlatforms,
    allocationSummary,
  };
}

function compactList(value, maxItems = 4) {
  return Array.isArray(value) && value.length
    ? value.slice(0, maxItems).join(' · ')
    : '';
}

function summarizePackHydration(packOrEditorial) {
  const hasPack = packOrEditorial?.editorial && packOrEditorial?.root;
  const root = hasPack ? packOrEditorial.root : {};
  const config = hasPack ? packOrEditorial.config : null;
  const strategy = coerceEditorialStrategy(hasPack ? packOrEditorial.editorial : packOrEditorial);
  const policy = strategy.schedulePolicy || {};
  const platforms = [
    ...(policy.platforms?.primary || []),
    ...(policy.platforms?.secondary || []),
    'x',
    'twitter',
    'linkedin',
  ].map((p) => String(p || '').toLowerCase());
  const postTimes = firstWindowForPlatform(policy, platforms);
  const campaign = config?.campaign || {};
  return {
    vertical: Boolean(inferVerticalFromPack(root, strategy)),
    objective: Boolean(campaign.objective || inferObjective(strategy)),
    cta: Boolean(campaign.ctaText || campaign.ctaUrl),
    postsPerDay: Boolean(config?.postsPerDay || inferPostsPerDay(strategy)),
    days: Boolean(config?.days),
    baselineMixPct: Boolean(config?.baselineMixPct),
    rampAggressiveness: config?.rampAggressiveness != null,
    postTime: Boolean(campaign.postTime || campaign.postTime2 || postTimes.length > 0),
    emojiPolicy: Boolean(campaign.emojiPolicy || strategy.emojiPolicy || policy.emojiPolicy),
    maxHashtags: campaign.maxHashtags != null || strategy.maxHashtags != null || policy.maxHashtags != null,
    guardrails: Boolean(campaign.guardrails || buildGuardrails(strategy)),
    promotions: Array.isArray(campaign.promotions),
    sources: Boolean(config?.sources && typeof config.sources === 'object'),
    signals: Boolean(config?.signals && typeof config.signals === 'object'),
    events: Array.isArray(config?.events),
    fullConfig: Boolean(config),
  };
}

function SourceChip({ active, text }) {
  return (
    <span
      className="sb-chip"
      style={{
        borderColor: active ? 'rgba(74,222,128,0.55)' : 'rgba(245,158,11,0.45)',
        color: active ? '#86efac' : '#fbbf24',
        background: active ? 'rgba(74,222,128,0.08)' : 'rgba(245,158,11,0.08)',
      }}
    >
      {text || (active ? 'JSON' : 'Manual')}
    </span>
  );
}

/**
 * @param {{
 *   bootstrap: Object,
 *   config: Object,
 *   onConfigChange: Function,
 *   onGenerate: Function,
 *   onOpenCard: Function,
 *   busy: boolean
 * }} props
 */
export default function InputsPane({ bootstrap, config, onConfigChange, onGenerate, onOpenCard, busy }) {
  const ds = bootstrap?.dashboardState || {};
  const editorial = coerceEditorialStrategy(config.editorial);
  const editorialSummary = useMemo(
    () => summarizeEditorialStrategy(editorial),
    [editorial]
  );
  const packHydration = useMemo(
    () => summarizePackHydration({ root: { strategyBuilder: { config } }, config, editorial }),
    [config, editorial]
  );
  const [editorialDraft, setEditorialDraft] = useState(() => buildStrategyPackJson(config, editorial));
  const [editorialError, setEditorialError] = useState('');
  const [lastPackHydration, setLastPackHydration] = useState(null);
  const activeHydration = lastPackHydration || packHydration;
  const editorialFileInputRef = useRef(null);

  useEffect(() => {
    setEditorialDraft(buildStrategyPackJson(config, editorial));
    setEditorialError('');
  }, [editorial]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(patch) {
    onConfigChange({ ...config, ...patch });
  }

  function updateSignals(signals) {
    onConfigChange({ ...config, signals });
  }

  const sources = config.sources || {};
  // A source is included unless explicitly disabled (matches server-side srcOn).
  const isSourceOn = (key) => sources?.[key]?.enabled !== false;
  function toggleSource(key) {
    onConfigChange({
      ...config,
      sources: { ...sources, [key]: { enabled: !isSourceOn(key) } },
    });
  }

  const events = Array.isArray(config.events) ? config.events : [];
  const [newEventName, setNewEventName] = useState('');
  const [newEventDate, setNewEventDate] = useState('');
  const eventsEnabled = Boolean(config.signals?.events?.enabled);

  function addEvent() {
    const name = newEventName.trim();
    if (!name || !newEventDate) return;
    const next = [
      ...events,
      { id: `evt-${Date.now()}`, name: name.slice(0, 80), date: newEventDate },
    ];
    onConfigChange({ ...config, events: next });
    setNewEventName('');
    setNewEventDate('');
  }

  function removeEvent(id) {
    onConfigChange({ ...config, events: events.filter((e) => e.id !== id) });
  }

  const campaign = config.campaign || {};
  function updateCampaign(patch) {
    onConfigChange({ ...config, campaign: { ...campaign, ...patch } });
  }
  const promotions = Array.isArray(campaign.promotions) ? campaign.promotions : [];
  const [newPromoLabel, setNewPromoLabel] = useState('');
  const [newPromoDate, setNewPromoDate] = useState('');
  function addPromotion() {
    const label = newPromoLabel.trim();
    if (!label || !newPromoDate) return;
    updateCampaign({
      promotions: [
        ...promotions,
        { id: `promo-${Date.now()}`, label: label.slice(0, 80), endDate: newPromoDate },
      ],
    });
    setNewPromoLabel('');
    setNewPromoDate('');
  }
  function removePromotion(id) {
    updateCampaign({ promotions: promotions.filter((p) => p.id !== id) });
  }

  function applyEditorialDraft() {
    try {
      const pack = parseStrategyPackJson(editorialDraft);
      const nextConfig = hydrateConfigFromStrategyPack(config, pack);
      setEditorialError('');
      setLastPackHydration(summarizePackHydration(pack));
      setEditorialDraft(buildStrategyPackJson(nextConfig, pack.editorial));
      onConfigChange(nextConfig);
    } catch (err) {
      setEditorialError(err.message || 'Invalid strategy pack JSON.');
    }
  }

  function formatEditorialDraft() {
    try {
      const pack = parseStrategyPackJson(editorialDraft);
      const nextConfig = hydrateConfigFromStrategyPack(config, pack);
      setEditorialDraft(buildStrategyPackJson(nextConfig, pack.editorial));
      setEditorialError('');
    } catch (err) {
      setEditorialError(err.message || 'Invalid strategy pack JSON.');
    }
  }

  function clearEditorialPack() {
    setEditorialError('');
    setLastPackHydration(null);
    const nextConfig = { ...config, editorial: EMPTY_EDITORIAL_STRATEGY };
    setEditorialDraft(buildStrategyPackJson(nextConfig, EMPTY_EDITORIAL_STRATEGY));
    onConfigChange(nextConfig);
  }

  async function importEditorialPackFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) {
        throw new Error('Strategy pack file must be 1 MB or smaller.');
      }
      const raw = await file.text();
      const pack = parseStrategyPackJson(raw);
      const nextConfig = hydrateConfigFromStrategyPack(config, pack);
      const nextDraft = buildStrategyPackJson(nextConfig, pack.editorial);
      setEditorialDraft(nextDraft);
      setEditorialError('');
      setLastPackHydration(summarizePackHydration(pack));
      onConfigChange(nextConfig);
    } catch (err) {
      setEditorialError(err.message || 'Could not import strategy pack JSON.');
    } finally {
      event.target.value = '';
    }
  }

  const OBJECTIVES = [
    ['', '— select objective —'],
    ['awareness', 'Awareness & reach'],
    ['bookings', 'Bookings & reservations'],
    ['foot-traffic', 'Foot traffic / visits'],
    ['leads', 'Leads & signups'],
    ['promotions', 'Promotions & sales'],
    ['community', 'Community & loyalty'],
  ];

  const canGenerate = !busy && !!config.vertical;

  return (
    <div className="sb-pane">

      {/* Marketing Strategy Pack — compiled campaign-first editorial runtime */}
      <div id="strategy-builder-marketing-strategy-pack" className="sb-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span className="sb-label">Marketing Strategy Pack</span>
          <span className={`sb-chip sb-chip--${editorialSummary.enabled ? 'ready' : 'empty'}`}>
            {editorialSummary.enabled ? 'active' : 'off'}
          </span>
        </div>
        <span className="sb-hint">
          Campaigns, schedule policy, asset libraries and daily adaptation rules
          used by Strategy Builder.
        </span>

        <div className="sb-list-stack">
          <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
            <span className="tile-detail-stat-label">Framework</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
              v{editorialSummary.frameworkVersion}
            </span>
          </div>
          <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
            <span className="tile-detail-stat-label">Campaigns</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
              {editorialSummary.activeCampaigns.length} active / {editorialSummary.campaigns.length} total
            </span>
          </div>
          <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
            <span className="tile-detail-stat-label">Assets</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
              {editorialSummary.assets} prepared
            </span>
          </div>
          <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
            <span className="tile-detail-stat-label">Platforms</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
              {[...editorialSummary.primaryPlatforms, ...editorialSummary.secondaryPlatforms].join(', ') || 'not set'}
            </span>
          </div>
        </div>

        {editorialSummary.allocationSummary.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {editorialSummary.allocationSummary.map((item) => (
              <span key={item} className="sb-chip">{item}</span>
            ))}
          </div>
        )}

        {editorialSummary.primaryCampaign && (
          <div id="strategy-builder-pack-impact" className="sb-list-stack">
            <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
              <span className="tile-detail-stat-label">Steers campaign</span>
              <span className="tile-detail-stat-value">
                {editorialSummary.primaryCampaign.name}
              </span>
            </div>
            {editorialSummary.primaryCampaign.strategicObjective && (
              <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                <span className="tile-detail-stat-label">Objective</span>
                <span className="tile-detail-stat-value">
                  {editorialSummary.primaryCampaign.strategicObjective}
                </span>
              </div>
            )}
            {editorialSummary.primaryCampaign.weeklyFocus && (
              <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                <span className="tile-detail-stat-label">Weekly focus</span>
                <span className="tile-detail-stat-value">
                  {editorialSummary.primaryCampaign.weeklyFocus}
                </span>
              </div>
            )}
            {compactList(editorialSummary.primaryCampaign.narrativeBuckets) && (
              <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                <span className="tile-detail-stat-label">Narratives</span>
                <span className="tile-detail-stat-value">
                  {compactList(editorialSummary.primaryCampaign.narrativeBuckets)}
                </span>
              </div>
            )}
            {compactList(editorialSummary.primaryCampaign.editorialFormats) && (
              <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                <span className="tile-detail-stat-label">Formats</span>
                <span className="tile-detail-stat-value">
                  {compactList(editorialSummary.primaryCampaign.editorialFormats)}
                </span>
              </div>
            )}
            {compactList(editorialSummary.primaryCampaign.dailySignalTriggers) && (
              <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                <span className="tile-detail-stat-label">Signal triggers</span>
                <span className="tile-detail-stat-value">
                  {compactList(editorialSummary.primaryCampaign.dailySignalTriggers)}
                </span>
              </div>
            )}
            {editorialSummary.primaryCampaign.fallback && (
              <div className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                <span className="tile-detail-stat-label">Fallback</span>
                <span className="tile-detail-stat-value">
                  {editorialSummary.primaryCampaign.fallback}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="sb-field-stack">
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>Strategy pack JSON</span>
          <input
            ref={editorialFileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={importEditorialPackFile}
            style={{ display: 'none' }}
            aria-label="Import marketing strategy pack JSON file"
          />
          <textarea
            value={editorialDraft}
            onChange={(e) => setEditorialDraft(e.target.value)}
            rows={10}
            spellCheck={false}
            className="sb-input"
            style={{ resize: 'vertical', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            aria-label="Marketing strategy pack JSON"
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={applyEditorialDraft}
            className="tile-foot-rerun-btn sb-small-action"
          >
            Apply Pack
          </button>
          <button
            type="button"
            onClick={formatEditorialDraft}
            className="tile-foot-rerun-btn sb-small-action"
          >
            Format JSON
          </button>
          <button
            type="button"
            onClick={clearEditorialPack}
            className="tile-foot-rerun-btn sb-small-action"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => editorialFileInputRef.current?.click()}
            className="tile-foot-rerun-btn sb-small-action"
          >
            Import JSON
          </button>
        </div>

        {editorialError && (
          <div className="sb-notice sb-notice--error" style={{ marginTop: 2 }}>
            {editorialError}
          </div>
        )}

        <div id="strategy-builder-json-hydrated-controls" className="sb-section" style={{ background: 'rgba(74,222,128,0.045)', borderColor: 'rgba(74,222,128,0.22)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="sb-label">JSON-Hydrated Controls</span>
            <SourceChip active={activeHydration.fullConfig} text={activeHydration.fullConfig ? 'Full config' : 'Incomplete'} />
          </div>
          <span className="sb-hint">
            These fields are saved with the strategy config and sent to generation.
            Green badges mean the current strategy pack can set or steer that field.
          </span>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Confirmed Vertical <span style={{ color: 'var(--accent)' }}>Required</span>
              <SourceChip active={activeHydration.vertical} text={activeHydration.vertical ? 'JSON' : 'Market / Manual'} />
            </span>
            <input
              list="strategy-builder-vertical-options"
              value={config.vertical || ''}
              onChange={(e) => update({ vertical: normalizeVertical(e.target.value) || e.target.value })}
              placeholder="restaurant, poker, med spa, creative services..."
              className="sb-input"
            />
            <datalist id="strategy-builder-vertical-options">
              {VERTICALS.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Primary objective
              <SourceChip active={activeHydration.objective} />
            </span>
            <select
              value={campaign.objective || ''}
              onChange={(e) => updateCampaign({ objective: e.target.value })}
              className="sb-select"
            >
              {OBJECTIVES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Primary call-to-action
              <SourceChip active={activeHydration.cta} />
            </span>
            <input
              type="text"
              value={campaign.ctaText || ''}
              onChange={(e) => updateCampaign({ ctaText: e.target.value })}
              placeholder='e.g. "Book a table", "Order online", "Claim the boost"'
              maxLength={80}
              className="sb-input"
            />
            <input
              type="url"
              value={campaign.ctaUrl || ''}
              onChange={(e) => updateCampaign({ ctaUrl: e.target.value })}
              placeholder="https://link-to-include (optional)"
              maxLength={300}
              className="sb-input"
              style={{ marginTop: 6 }}
            />
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Preferred posting time <span style={{ color: 'var(--text-disabled)' }}>(client local)</span>
              <SourceChip active={activeHydration.postTime} />
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="time"
                value={campaign.postTime || ''}
                onChange={(e) => updateCampaign({ postTime: e.target.value })}
                className="sb-input"
                style={{ flex: 1 }}
                aria-label="Primary posting time"
              />
              <input
                type="time"
                value={campaign.postTime2 || ''}
                onChange={(e) => updateCampaign({ postTime2: e.target.value })}
                className="sb-input"
                style={{ flex: 1 }}
                aria-label="Optional second posting time"
              />
            </div>
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Posts / Day — <span style={{ color: 'var(--text-primary)' }}>{config.postsPerDay}</span>
              <SourceChip active={activeHydration.postsPerDay} />
            </span>
            <input
              type="range" min={1} max={5} step={1}
              value={config.postsPerDay}
              onChange={(e) => update({ postsPerDay: Number(e.target.value) })}
              className="sb-range"
            />
            <div className="sb-range-scale"><span>1</span><span>5</span></div>
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Emoji policy
              <SourceChip active={activeHydration.emojiPolicy} />
            </span>
            <div className="sb-seg">
              {['none', 'sparing', 'liberal'].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => updateCampaign({ emojiPolicy: p })}
                  className={`sb-seg-btn${(campaign.emojiPolicy || 'none') === p ? ' is-active' : ''}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Max hashtags / post — <span style={{ color: 'var(--text-primary)' }}>{Number.isFinite(campaign.maxHashtags) ? campaign.maxHashtags : 2}</span>
              <SourceChip active={activeHydration.maxHashtags} />
            </span>
            <input
              type="range" min={0} max={5} step={1}
              value={Number.isFinite(campaign.maxHashtags) ? campaign.maxHashtags : 2}
              onChange={(e) => updateCampaign({ maxHashtags: Number(e.target.value) })}
              className="sb-range"
            />
            <div className="sb-range-scale"><span>0</span><span>5</span></div>
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Content guardrails <span style={{ color: 'var(--text-disabled)' }}>(hard constraints)</span>
              <SourceChip active={activeHydration.guardrails} />
            </span>
            <textarea
              value={campaign.guardrails || ''}
              onChange={(e) => updateCampaign({ guardrails: e.target.value })}
              placeholder="e.g. 21+ only, include responsible-gaming language, no guaranteed-win claims"
              maxLength={500}
              rows={2}
              className="sb-input"
              style={{ resize: 'vertical' }}
            />
          </div>

          <div className="sb-field-stack">
            <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              Active promotions
              <SourceChip active={activeHydration.promotions} />
            </span>
            {promotions.length > 0 && (
              <div className="sb-list-stack">
                {promotions.map((p) => (
                  <div key={p.id} className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                    <span className="tile-detail-stat-label" style={{ flex: 1 }}>{p.label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                      ends {p.endDate}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${p.label}`}
                      onClick={() => removePromotion(p.id)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="sb-control-row">
              <input
                type="text"
                value={newPromoLabel}
                onChange={(e) => setNewPromoLabel(e.target.value)}
                placeholder="Promotion (e.g. 20% off prix fixe)"
                maxLength={80}
                className="sb-input"
                style={{ flex: 1 }}
              />
              <input
                type="date"
                value={newPromoDate}
                onChange={(e) => setNewPromoDate(e.target.value)}
                className="sb-input"
                style={{ width: 160, flex: '0 0 auto' }}
                aria-label="Promotion end date"
              />
              <button
                type="button"
                onClick={addPromotion}
                disabled={!newPromoLabel.trim() || !newPromoDate}
                className="tile-foot-rerun-btn sb-small-action"
                style={{ flex: '0 0 auto' }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Data sources — toggle which generated card data feeds the strategy */}
      <div id="strategy-builder-data-sources" className="sb-section">
        <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Card Evidence Sources
          <SourceChip active={activeHydration.sources} />
        </span>
        <span className="sb-hint">
          These toggles control which generated dashboard-card data reaches the
          strategy prompt. They are separate from the uploaded marketing JSON.
        </span>
        <div className="sb-list-stack">
          {DATA_SOURCES.map((src) => {
            const on = isSourceOn(src.key);
            const r = src.readiness(ds);
            return (
              <div
                key={src.key}
                id={`strategy-builder-source-row-${src.key}`}
                className={`mb-config-platform-toggle sb-data-source-row${on ? ' is-on' : ''}`}
                style={{ gridTemplateColumns: '22px 1fr auto', alignItems: 'center', minHeight: 0, cursor: 'default' }}
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Include ${src.label}`}
                  onClick={() => toggleSource(src.key)}
                  className="mb-config-platform-check"
                  style={{ cursor: 'pointer', background: on ? undefined : 'transparent' }}
                >
                  {on ? '✓' : ''}
                </button>

                <button
                  type="button"
                  onClick={() => toggleSource(src.key)}
                  className="sb-toggle-row-meta"
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <span className="mb-config-platform-title" style={{ color: on ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                    {src.label}
                  </span>
                  <span className={`sb-chip sb-chip--${r}`}>{r}</span>
                </button>

                {src.card && onOpenCard ? (
                  <button
                    type="button"
                    aria-label={`Open ${src.label} card`}
                    title={`Open ${src.label}`}
                    onClick={() => onOpenCard(src.card)}
                    className="sb-link-btn"
                  >
                    <UpRightArrow />
                  </button>
                ) : (
                  <span style={{ width: 28, flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Signal toggles */}
      <SignalToggles signals={config.signals} onChange={updateSignals} sourceHydrated={activeHydration.signals} />

      {/* Local events editor — shown only when the Local Events signal is on */}
      {eventsEnabled && (
        <div id="strategy-builder-events-editor" className="sb-section">
          <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Local Events
            <SourceChip active={activeHydration.events} />
          </span>
          <span className="sb-hint">
            Add dated events to anchor posts around (grand opening, festival,
            sponsorship).
          </span>

          {events.length > 0 && (
            <div className="sb-list-stack">
              {events.map((e) => (
                <div key={e.id} className="tile-detail-stat-row sb-inline-row" style={{ alignItems: 'center' }}>
                  <span className="tile-detail-stat-label" style={{ flex: 1 }}>{e.name}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                    {e.date}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${e.name}`}
                    onClick={() => removeEvent(e.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="sb-control-row">
            <input
              type="text"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              placeholder="Event name"
              maxLength={80}
              className="sb-input"
              style={{ flex: 1 }}
            />
            <input
              type="date"
              value={newEventDate}
              onChange={(e) => setNewEventDate(e.target.value)}
              className="sb-input"
              style={{ width: 160, flex: '0 0 auto' }}
            />
            <button
              type="button"
              onClick={addEvent}
              disabled={!newEventName.trim() || !newEventDate}
              className="tile-foot-rerun-btn sb-small-action"
              style={{ flex: '0 0 auto' }}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Cadence */}
      <div id="strategy-builder-cadence-sliders" className="sb-section">
        <span className="sb-label">Cadence</span>

        <div className="sb-field-stack">
          <span className="sb-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            Campaign Length
            <SourceChip active={activeHydration.days} />
          </span>
          <div className="sb-seg">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => update({ days: d })}
                className={`sb-seg-btn${config.days === d ? ' is-active' : ''}`}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        <div className="sb-field-stack">
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>
            Baseline Mix — <span style={{ color: 'var(--text-primary)' }}>{config.baselineMixPct}%</span>
            <SourceChip active={activeHydration.baselineMixPct} />
          </span>
          <input
            type="range" min={10} max={60} step={5}
            value={config.baselineMixPct}
            onChange={(e) => update({ baselineMixPct: Number(e.target.value) })}
            className="sb-range"
          />
          <div className="sb-range-scale"><span>10%</span><span>60%</span></div>
        </div>

        <div className="sb-field-stack">
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>
            Ramp Aggressiveness — <span style={{ color: 'var(--text-primary)' }}>{config.rampAggressiveness}</span>
            <SourceChip active={activeHydration.rampAggressiveness} />
          </span>
          <input
            type="range" min={0} max={1} step={0.25}
            value={config.rampAggressiveness}
            onChange={(e) => update({ rampAggressiveness: Number(e.target.value) })}
            className="sb-range"
          />
          <div className="sb-range-scale"><span>gentle</span><span>aggressive</span></div>
        </div>
      </div>

      {/* Generate */}
      <button
        type="button"
        id="strategy-builder-generate-btn"
        onClick={onGenerate}
        disabled={!canGenerate}
        className="sb-cta"
      >
        {busy ? (
          <>
            <span className="sb-spinner" />
            Generating…
          </>
        ) : (
          'Generate Strategy'
        )}
      </button>
      {!config.vertical && (
        <div className="sb-notice sb-notice--error" style={{ marginTop: 6, textAlign: 'center' }}>
          Select a vertical to enable generation.
        </div>
      )}
    </div>
  );
}
