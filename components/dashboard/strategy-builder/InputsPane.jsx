'use client';

import React, { useEffect, useMemo, useState } from 'react';
import SignalToggles from './SignalToggles.jsx';
import UpRightArrow from '../../UpRightArrow';

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

function prettyJson(value) {
  return JSON.stringify(coerceEditorialStrategy(value), null, 2);
}

function summarizeEditorialStrategy(editorial) {
  const strategy = coerceEditorialStrategy(editorial);
  const campaigns = Array.isArray(strategy.campaigns) ? strategy.campaigns : [];
  const activeCampaigns = campaigns.filter((campaign) => {
    const status = String(campaign?.status || 'active').toLowerCase();
    return !['paused', 'complete', 'completed', 'archived'].includes(status);
  });
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
    assets,
    primaryPlatforms,
    secondaryPlatforms,
    allocationSummary,
  };
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
  const [editorialDraft, setEditorialDraft] = useState(() => prettyJson(editorial));
  const [editorialError, setEditorialError] = useState('');

  useEffect(() => {
    setEditorialDraft(prettyJson(editorial));
    setEditorialError('');
  }, [editorial]);

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
      const parsed = JSON.parse(editorialDraft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Strategy pack must be a JSON object.');
      }
      if (parsed.campaigns != null && !Array.isArray(parsed.campaigns)) {
        throw new Error('campaigns must be an array when provided.');
      }
      if (parsed.schedulePolicy != null && (typeof parsed.schedulePolicy !== 'object' || Array.isArray(parsed.schedulePolicy))) {
        throw new Error('schedulePolicy must be an object when provided.');
      }
      setEditorialError('');
      onConfigChange({ ...config, editorial: parsed });
    } catch (err) {
      setEditorialError(err.message || 'Invalid strategy pack JSON.');
    }
  }

  function formatEditorialDraft() {
    try {
      const parsed = JSON.parse(editorialDraft);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Strategy pack must be a JSON object.');
      }
      setEditorialDraft(JSON.stringify(parsed, null, 2));
      setEditorialError('');
    } catch (err) {
      setEditorialError(err.message || 'Invalid strategy pack JSON.');
    }
  }

  function clearEditorialPack() {
    setEditorialError('');
    setEditorialDraft(prettyJson(EMPTY_EDITORIAL_STRATEGY));
    onConfigChange({ ...config, editorial: EMPTY_EDITORIAL_STRATEGY });
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

      {/* Data sources — toggle which generated card data feeds the strategy */}
      <div id="strategy-builder-data-sources" className="sb-section">
        <span className="sb-label">Data Sources</span>
        <span className="sb-hint">
          Toggle which card data feeds the strategy. Open a card to generate or
          improve its data.
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

      {/* Vertical confirm */}
      <div id="strategy-builder-vertical-confirm" className="sb-section">
        <span className="sb-label">
          Confirmed Vertical
          <span style={{ color: 'var(--accent)', marginLeft: 6 }}>Required</span>
        </span>
        <select
          value={config.vertical || ''}
          onChange={(e) => update({ vertical: e.target.value })}
          className="sb-select"
        >
          <option value="">— select vertical —</option>
          {VERTICALS.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
        <span className="sb-hint">
          Auto-detected from the Market Category card. Changing it there updates
          it everywhere; this is a per-strategy override.
        </span>
      </div>

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

        <div className="sb-field-stack">
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>Strategy pack JSON</span>
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
        </div>

        {editorialError && (
          <div className="sb-notice sb-notice--error" style={{ marginTop: 2 }}>
            {editorialError}
          </div>
        )}
      </div>

      {/* Campaign Setup — operational inputs the model can't infer */}
      <div id="strategy-builder-campaign-setup" className="sb-section">
        <span className="sb-label">Campaign Setup</span>
        <span className="sb-hint">
          Up-to-the-minute operational inputs. These shape post intent, timing
          and compliance — set what applies, leave the rest blank.
        </span>

        <div className="sb-field-stack">
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>Primary objective</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>Primary call-to-action</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>
            Preferred posting time <span style={{ color: 'var(--text-disabled)' }}>(client local)</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>Emoji policy</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>
            Max hashtags / post — <span style={{ color: 'var(--text-primary)' }}>{Number.isFinite(campaign.maxHashtags) ? campaign.maxHashtags : 2}</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>
            Content guardrails <span style={{ color: 'var(--text-disabled)' }}>(hard constraints)</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>Active promotions</span>
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

      {/* Signal toggles */}
      <SignalToggles signals={config.signals} onChange={updateSignals} />

      {/* Local events editor — shown only when the Local Events signal is on */}
      {eventsEnabled && (
        <div id="strategy-builder-events-editor" className="sb-section">
          <span className="sb-label">Local Events</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 6 }}>Campaign Length</span>
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
            Posts / Day — <span style={{ color: 'var(--text-primary)' }}>{config.postsPerDay}</span>
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
          <span className="sb-label" style={{ display: 'block', marginBottom: 4 }}>
            Baseline Mix — <span style={{ color: 'var(--text-primary)' }}>{config.baselineMixPct}%</span>
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
