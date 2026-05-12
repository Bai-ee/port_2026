'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Filter, Settings2, Radar, ArrowUpRight, Play, Loader2, ChevronDown, Info, MapPin, Mail, Share2, Monitor, Gauge, Bot, Layers, Paintbrush, RotateCcw, Wand2, ExternalLink, Package, Send, Star, Images, LayoutDashboard } from 'lucide-react';
import { collection, doc, onSnapshot, query as fsQuery, orderBy, limit, updateDoc } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { VERTICAL_MAP, VERTICAL_KEYS, getVerticalLabel } from '../../features/leadgen/vertical-map';
import {
  PIPELINE_STAGES,
  DEFAULT_THRESHOLDS,
  TIER_LABELS,
  tierFromScore,
} from '../../features/leadgen/constants';
import { evaluateSignalInputs } from '../../features/leadgen/scorer';
import CampaignBuilderModal from './leadgen/CampaignBuilderModal';
import SettingsModal from './leadgen/SettingsModal';
import QuickRunModal from './leadgen/QuickRunModal';
import LeadgenModulePanel from './leadgen/LeadgenModulePanel';
import BriefEditorModal         from './leadgen/BriefEditorModal';
import MockupPromptEditorModal  from './leadgen/MockupPromptEditorModal';
import SitePromptEditorModal    from './leadgen/SitePromptEditorModal';
import SendPreviewModal         from './leadgen/SendPreviewModal';
import VisualDnaModal           from './leadgen/VisualDnaModal';
import BrandSystemBuildModal from './BrandSystemBuildModal';

// ─────────────────────────────────────────────────────────────────────────────
// Lead Gen Dashboard — Phase 1 UI shell
//
// Presentation only. No Firestore wiring yet — the schema, prospector,
// scorer, and cron handlers land in subsequent phases (see
// docs/LEAD_GEN_PIPELINE_PLAN.md §1–§5). All counts/rows are placeholders;
// the empty state is the honest default until the backend is in place.
//
// Visual direction: existing portfolio glass shell as the parent surface,
// Nothing-style data layer inside — mono numerics, sharp grid, single
// signal-red dot, strict typographic contrast. No new dependencies.
// ─────────────────────────────────────────────────────────────────────────────

// SerpAPI sometimes returns URLs without a protocol (e.g. "example.com").
// A bare hostname in href makes the browser navigate to the current origin
// + that path instead of the external site. Always force an absolute URL.
function normalizeUrl(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  return `https://${s.replace(/^\/+/, '')}`;
}

// Build the canonical Google Maps URL for a place_id. This route is stable
// and doesn't require an API key — Maps resolves the place lookup server-side.
function gbpUrl(placeId) {
  if (!placeId) return null;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

function displayHost(raw) {
  if (!raw) return '';
  try {
    const u = new URL(normalizeUrl(raw));
    return (u.hostname + u.pathname).replace(/\/$/, '');
  } catch {
    return String(raw).replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}

// Per-signal metadata for the row breakdown + legend. `weight` mirrors
// DEFAULT_SCORING_WEIGHTS in features/leadgen/constants.js. `detected` lists
// what's actually populated today; `planned` documents the gap. Keep these
// honest — operator should know what's measured vs. mocked.
const SIGNAL_META = [
  {
    key: 'websiteQuality',
    label: 'Website Quality',
    weight: 0.40,
    blurb: 'Higher = worse site = bigger opportunity for us.',
    detected: 'HTTP status, load time, HTTPS, responsive viewport, JSON-LD/OG/meta presence, template platform (Wix/Squarespace/etc.), thin content.',
    planned: 'Lighthouse perf score, mobile-specific render audit, SSL grade.',
  },
  {
    key: 'businessSuccess',
    label: 'Business Success (popularity)',
    weight: 0.35,
    blurb: 'Are they a real, healthy business that can pay?',
    detected: 'Review count tier, star rating tier, photo count, hours filled out, price level.',
    planned: 'Years-in-business, sentiment of recent reviews, employee count from BBB/state filings.',
  },
  {
    key: 'growthInvestment',
    label: 'Growth Investment',
    weight: 0.10,
    blurb: 'Are they actively spending to grow? If yes, they understand the value of marketing.',
    detected: 'Blog/news section on site, social media link presence.',
    planned: 'Google Ads detection (separate SerpAPI call), recent GBP posts (last 90d), recent photo uploads, GBP profile completeness.',
  },
  {
    key: 'contactAccess',
    label: 'Contact Access',
    weight: 0.15,
    blurb: 'Can we actually reach the decision-maker?',
    detected: 'Phone (from GBP), email scraped from homepage, contact form on homepage, physical address.',
    planned: 'Owner name from filings, LinkedIn profile match, direct dial vs. front-desk.',
  },
];

const TIER_PALETTE = {
  hot:  { color: '#ff3b30', label: 'Hot',  rule: '≥ 75' },
  warm: { color: '#c2410c', label: 'Warm', rule: '≥ 55' },
  cool: { color: '#1d4ed8', label: 'Cool', rule: '≥ 35' },
  cold: { color: '#9a9a9a', label: 'Cold', rule: '< 35' },
};

const STAGE_LABELS = {
  discovered: 'Discovered',
  scored:     'Scored',
  onboarding: 'Onboarding',
  audited:    'Audited',
  ready:      'Ready',
  packaged:   'Packaged',
  contacted:  'Contacted',
};

// Stages shown in the top stats bar (collapses internal "auditing/generating"
// transitions for a cleaner operator view).
const VISIBLE_STAGES = ['discovered', 'scored', 'audited', 'ready', 'packaged', 'contacted'];

const SORT_OPTIONS = [
  { key: 'score-desc',      label: 'Score ↓' },
  { key: 'score-asc',       label: 'Score ↑' },
  { key: 'starred-first',   label: 'Starred first' },
  { key: 'name-asc',        label: 'Name A→Z' },
  { key: 'name-desc',       label: 'Name Z→A' },
  { key: 'rating-desc',     label: 'Highest rated' },
  { key: 'discovered-desc', label: 'Newest first' },
  { key: 'reviews-desc',    label: 'Most reviewed' },
];

const SCORE_FILTER_OPTIONS = [
  { key: 'all',  label: 'Any score' },
  { key: '35',   label: '≥ 35' },
  { key: '55',   label: '≥ 55' },
  { key: '65',   label: '≥ 65 (auto-audit)' },
  { key: '75',   label: '≥ 75 (auto-generate)' },
];

// Data-driven module registry — add a new entry here to make it available
// as a per-prospect button in every expanded row.
const LEADGEN_MODULE_REGISTRY = [
  {
    id: 'social-preview',
    label: 'Social Preview',
    description: 'OG tags · Twitter cards · meta',
    Icon: Share2,
    type: 'analysis',   // opens streaming terminal panel
    storeKey: 'socialPreview',
  },
  {
    id: 'multi-device-view',
    label: 'Brand Snapshot',
    description: 'Cross-device screenshots · mockup',
    Icon: Monitor,
    type: 'analysis',
    storeKey: 'multiDeviceView',
  },
  {
    id: 'seo-performance',
    label: 'SEO + Performance',
    description: 'PageSpeed scores · depth audit',
    Icon: Gauge,
    type: 'analysis',
    storeKey: 'seoPerformance',
  },
  {
    id: 'agent-readiness',
    label: 'AI Readiness',
    description: 'Agent probes · visibility audit',
    Icon: Bot,
    type: 'analysis',
    storeKey: 'agentReadiness',
  },
  {
    id: 'design-evaluation',
    label: 'Design Evaluation',
    description: 'Colors · type · layout audit',
    Icon: Paintbrush,
    type: 'analysis',
    storeKey: 'designEvaluation',
  },
  {
    id: 'brand-system',
    label: 'Brand System',
    description: 'Full brand DNA chat build',
    Icon: Layers,
    type: 'chat',      // opens BrandSystemBuildModal
    storeKey: null,
  },
  {
    id: 'visual-dna',
    label: 'Visual DNA',
    description: 'Food · products · locations · lifestyle references',
    Icon: Images,
    type: 'experience',
    storeKey: null,
  },
  {
    id: 'design-references',
    label: 'Design References',
    description: 'Lazyweb · vertical-matched design inspiration',
    Icon: Images,
    type: 'analysis',
    storeKey: 'designReferences',
    endpoint: '/api/leadgen/fetch-references',
  },
];

export default function LeadGenDashboard() {
  const [prospects, setProspects] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignBusy, setCampaignBusy] = useState({}); // { [campaignId]: 'running' | 'error' }
  const [campaignNotice, setCampaignNotice] = useState(null); // { kind: 'ok'|'err', text }
  const [showBuilder, setShowBuilder] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickRun, setShowQuickRun] = useState(false);

  const [verticalFilter, setVerticalFilter] = useState('all');
  const [stageFilter, setStageFilter]       = useState('all');
  const [scoreFilter, setScoreFilter]       = useState('55');
  const [sortKey, setSortKey]               = useState('starred-first');
  const [searchQuery, setSearchQuery]       = useState('');
  const [starredFilter, setStarredFilter]   = useState('all');

  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [legendOpen, setLegendOpen]     = useState(false);
  const [onboardBusy, setOnboardBusy]     = useState({});
  const [dashboardBusy, setDashboardBusy] = useState({});
  // { placeId, moduleId, moduleLabel } — null when panel is closed
  const [modulePanel, setModulePanel]   = useState(null);
  // Generation feature toggles — keyed by placeId so each prospect has its own state
  const [genToggles, setGenToggles] = useState({});
  const getToggles = (placeId) => genToggles[placeId] || {
    useMockup: true,
    useLazywebVision: false,
    useBrandSystem: true,
    useDesignEval: true,
    runComparison: true,
  };
  const setToggle = (placeId, key, value) => {
    setGenToggles((prev) => ({
      ...prev,
      [placeId]: { ...(prev[placeId] || {
        useMockup: true,
        useLazywebVision: false,
        useBrandSystem: true,
        useDesignEval: true,
        runComparison: true,
      }), [key]: value },
    }));
  };
  // prospect object for brief editor — null when closed
  const [briefEditorProspect, setBriefEditorProspect] = useState(null);
  const [mockupPromptEditorProspect, setMockupPromptEditorProspect] = useState(null);
  const [sitePromptEditorProspect, setSitePromptEditorProspect]     = useState(null);
  const [sendModal, setSendModal] = useState(null);
  const [brandSystemOpen, setBrandSystemOpen] = useState(false);
  const [visualDnaProspect, setVisualDnaProspect] = useState(null);

  const toggleRow = (placeId) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId); else next.add(placeId);
      return next;
    });
  };

  const [listenerError, setListenerError] = useState(null);

  // ── Firestore listeners ──────────────────────────────────────────────────
  // Prospects: live snapshot, ordered by score desc so the top of the table
  // is always the strongest pipeline. Cap at 200 to avoid runaway reads.
  // On error, surface the message to the user — do NOT attach a fallback
  // listener inside the error callback (doing so trips a Firestore SDK
  // internal assertion when the SDK is mid-reset).
  useEffect(() => {
    if (!db) return undefined;
    const q = fsQuery(
      collection(db, 'leadgen_prospects'),
      orderBy('score', 'desc'),
      limit(200),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        // Exclude synthetic per-client prospects (kind === 'client-self', placeId
        // starts with "client:") — those belong to per-client dashboard cards,
        // not the operator prospect list.
        setProspects(
          snap.docs
            .map((d) => ({ ...d.data(), placeId: d.id }))
            .filter((p) => p.kind !== 'client-self' && !String(p.placeId).startsWith('client:'))
        );
        setListenerError(null);
      },
      (err) => {
        console.warn('[leadgen] prospects listener error:', err?.message || err);
        setListenerError(err?.message || 'Could not load prospects.');
      },
    );
    return () => unsub();
  }, []);

  // Discovery config (campaigns).
  useEffect(() => {
    if (!db) return undefined;
    const ref = doc(db, 'leadgen_configs', 'discovery');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setCampaigns(Array.isArray(data?.campaigns) ? data.campaigns : []);
      },
      (err) => console.warn('[leadgen] campaigns listener error:', err?.message || err),
    );
    return () => unsub();
  }, []);

  const getIdToken = async () => {
    try { return await auth?.currentUser?.getIdToken?.(); } catch { return null; }
  };

  async function handleOnboard(placeId) {
    setOnboardBusy((b) => ({ ...b, [placeId]: true }));
    try {
      const token = await getIdToken();
      const res = await fetch('/api/leadgen/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ placeId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('[leadgen] onboard failed:', data?.error || res.status);
      }
      // Firestore onSnapshot picks up stage + onboard field changes automatically
    } catch (err) {
      console.error('[leadgen] onboard request failed:', err);
    } finally {
      setOnboardBusy((b) => {
        const next = { ...b };
        delete next[placeId];
        return next;
      });
    }
  }

  const handleModuleRun = useCallback((placeId, moduleId, moduleLabel, moduleType) => {
    if (moduleType === 'chat') {
      setBrandSystemOpen(true);
      return;
    }
    if (moduleType === 'experience' && moduleId === 'visual-dna') {
      const prospect = prospects.find((p) => p.placeId === placeId);
      setVisualDnaProspect(prospect || { placeId });
      return;
    }
    const mod = LEADGEN_MODULE_REGISTRY.find(m => m.id === moduleId);
    setModulePanel({ placeId, moduleId, moduleLabel, endpoint: mod?.endpoint });
  }, [prospects]);

  function handlePackage(placeId) {
    setModulePanel({ placeId, moduleId: 'outreach-package', moduleLabel: 'Package Outreach', endpoint: '/api/leadgen/package' });
  }

  function handleSendPreview(prospect) {
    setSendModal(prospect);
  }

  async function handleMakeDashboard(placeId) {
    setDashboardBusy((b) => ({ ...b, [placeId]: true }));
    try {
      const token = await getIdToken();
      const res = await fetch('/api/leadgen/make-dashboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ placeId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[leadgen] make-dashboard failed:', data?.error || res.status);
      }
    } catch (err) {
      console.error('[leadgen] make-dashboard request failed:', err);
    } finally {
      setDashboardBusy((b) => {
        const next = { ...b };
        delete next[placeId];
        return next;
      });
    }
  }

  async function toggleStar(placeId, currentStarred) {
    try {
      await updateDoc(doc(db, 'leadgen_prospects', placeId), { starred: !currentStarred });
    } catch (err) {
      console.error('[leadgen] toggleStar failed:', err);
    }
  }

  async function handleRunCampaign(campaignId) {
    setCampaignBusy((b) => ({ ...b, [campaignId]: 'running' }));
    setCampaignNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/leadgen/discover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ campaignId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCampaignNotice({ kind: 'err', text: data?.error || `Discovery failed (HTTP ${res.status}).` });
      } else {
        setCampaignNotice({
          kind: 'ok',
          text: `Discovered ${data?.discovery?.persisted ?? 0} new prospects (${data?.discovery?.skippedDuplicates ?? 0} duplicates skipped).`,
        });
      }
    } catch (err) {
      setCampaignNotice({ kind: 'err', text: err?.message || 'Discovery request failed.' });
    } finally {
      setCampaignBusy((b) => {
        const next = { ...b };
        delete next[campaignId];
        return next;
      });
    }
  }

const stageCounts = useMemo(() => {
    const counts = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0]));
    for (const p of prospects) {
      if (counts[p.stage] != null) counts[p.stage] += 1;
    }
    return counts;
  }, [prospects]);

  const filtered = useMemo(() => {
    const minScore = scoreFilter === 'all' ? -Infinity : Number(scoreFilter);
    const q = searchQuery.trim().toLowerCase();
    return prospects
      .filter((p) => verticalFilter === 'all' || p.vertical === verticalFilter)
      .filter((p) => stageFilter === 'all' || p.stage === stageFilter)
      .filter((p) => (p.score ?? 0) >= minScore)
      .filter((p) => starredFilter !== 'starred' || p.starred)
      .filter((p) => !q ||
        (p.name    || '').toLowerCase().includes(q) ||
        (p.address || '').toLowerCase().includes(q) ||
        (p.website || '').toLowerCase().includes(q))
      .sort((a, b) => {
        switch (sortKey) {
          case 'starred-first':   return (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || (b.score ?? 0) - (a.score ?? 0);
          case 'name-asc':        return (a.name || '').localeCompare(b.name || '');
          case 'name-desc':       return (b.name || '').localeCompare(a.name || '');
          case 'rating-desc':     return (b.rating ?? 0) - (a.rating ?? 0);
          case 'score-asc':       return (a.score ?? 0) - (b.score ?? 0);
          case 'discovered-desc': return new Date(b.discoveredAt) - new Date(a.discoveredAt);
          case 'reviews-desc':    return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
          case 'score-desc':
          default:                return (b.score ?? 0) - (a.score ?? 0);
        }
      });
  }, [prospects, verticalFilter, stageFilter, scoreFilter, sortKey, starredFilter, searchQuery]);

  const isEmpty = prospects.length === 0;

  return (
    <div id="leadgen-dashboard">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header id="leadgen-header">
        <div id="leadgen-header-title">
          <span id="leadgen-status-dot" aria-hidden="true" />
          <h2 id="leadgen-h">Lead Generation Pipeline</h2>
          <span id="leadgen-header-tag">PHASE 1 · UI SHELL</span>
        </div>
        <div id="leadgen-header-actions">
          <button
            type="button"
            className="leadgen-btn leadgen-btn--ghost"
            id="leadgen-settings-btn"
            onClick={() => setShowSettings(true)}
            title="Tune scoring weights, thresholds, and geo boost"
          >
            <Settings2 size={14} strokeWidth={2} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="leadgen-btn leadgen-btn--ghost"
            id="leadgen-quickrun-btn"
            onClick={() => setShowQuickRun(true)}
            title="Run discovery once with default settings — no campaign saved"
          >
            <Play size={13} strokeWidth={2.4} />
            <span>Quick Run</span>
          </button>
          <button
            type="button"
            className="leadgen-btn leadgen-btn--primary"
            id="leadgen-new-campaign-btn"
            onClick={() => setShowBuilder(true)}
          >
            <Plus size={14} strokeWidth={2.4} />
            <span>New Campaign</span>
          </button>
        </div>
      </header>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <section id="leadgen-stats-bar" aria-label="Pipeline stage counts">
        {VISIBLE_STAGES.map((stage, idx) => (
          <div key={stage} id={`leadgen-stats-cell-${stage}`} className="leadgen-stats-cell">
            <span className="leadgen-stats-cell-idx">{String(idx + 1).padStart(2, '0')}</span>
            <span className="leadgen-stats-cell-num">
              {String(stageCounts[stage] ?? 0).padStart(3, '0')}
            </span>
            <span className="leadgen-stats-cell-label">{STAGE_LABELS[stage]}</span>
          </div>
        ))}
      </section>

      {/* ── Filter row ───────────────────────────────────────────────────── */}
      <section id="leadgen-filters-row" aria-label="Prospect filters">
        <div id="leadgen-filters-left">
          <span id="leadgen-filters-icon"><Filter size={12} strokeWidth={2} /></span>
          <label className="leadgen-filter">
            <input
              id="leadgen-search-input"
              type="search"
              className="leadgen-filter-search"
              placeholder="Search name, address…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
          <label className="leadgen-filter">
            <span className="leadgen-filter-label">Vertical</span>
            <select
              className="leadgen-filter-select"
              value={verticalFilter}
              onChange={(e) => setVerticalFilter(e.target.value)}
            >
              <option value="all">All</option>
              {VERTICAL_KEYS.map((k) => (
                <option key={k} value={k}>{VERTICAL_MAP[k].label}</option>
              ))}
            </select>
          </label>
          <label className="leadgen-filter">
            <span className="leadgen-filter-label">Stage</span>
            <select
              className="leadgen-filter-select"
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
            >
              <option value="all">All</option>
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="leadgen-filter">
            <span className="leadgen-filter-label">Score</span>
            <select
              className="leadgen-filter-select"
              value={scoreFilter}
              onChange={(e) => setScoreFilter(e.target.value)}
            >
              {SCORE_FILTER_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div id="leadgen-filters-right">
          <button
            type="button"
            id="leadgen-starred-toggle"
            className={starredFilter === 'starred' ? 'is-on' : ''}
            onClick={() => setStarredFilter((s) => s === 'starred' ? 'all' : 'starred')}
            title="Show starred prospects only"
          >
            <Star size={11} strokeWidth={2} />
            <span>Starred</span>
          </button>
          <label className="leadgen-filter">
            <span className="leadgen-filter-label">Sort</span>
            <select
              className="leadgen-filter-select"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* ── Threshold strip ──────────────────────────────────────────────── */}
      <section id="leadgen-threshold-strip" aria-label="Active scoring thresholds">
        <span className="leadgen-thresh-item">
          <span className="leadgen-thresh-key">MIN</span>
          <span className="leadgen-thresh-val">{DEFAULT_THRESHOLDS.minimumScore}</span>
        </span>
        <span className="leadgen-thresh-sep" aria-hidden="true" />
        <span className="leadgen-thresh-item">
          <span className="leadgen-thresh-key">AUDIT</span>
          <span className="leadgen-thresh-val">{DEFAULT_THRESHOLDS.autoAudit}</span>
        </span>
        <span className="leadgen-thresh-sep" aria-hidden="true" />
        <span className="leadgen-thresh-item">
          <span className="leadgen-thresh-key">GEN</span>
          <span className="leadgen-thresh-val">{DEFAULT_THRESHOLDS.autoGenerate}</span>
        </span>
        <span className="leadgen-thresh-sep" aria-hidden="true" />
        <span className="leadgen-thresh-item">
          <span className="leadgen-thresh-key">TIERS</span>
          <span className="leadgen-thresh-val leadgen-thresh-val--mono">
            {`H≥${TIER_LABELS.hot.threshold} · W≥${TIER_LABELS.warm.threshold} · C≥${TIER_LABELS.cool.threshold}`}
          </span>
        </span>
      </section>

      {/* ── Tier legend + scoring explainer ──────────────────────────────── */}
      <section id="leadgen-legend" aria-label="Scoring legend">
        <div id="leadgen-legend-row">
          <div id="leadgen-legend-tiers">
            {Object.entries(TIER_PALETTE).map(([key, t]) => (
              <span key={key} className="leadgen-legend-tier">
                <span className="leadgen-legend-tier-dot" style={{ background: t.color }} aria-hidden="true" />
                <span className="leadgen-legend-tier-label">{t.label}</span>
                <span className="leadgen-legend-tier-rule">{t.rule}</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            id="leadgen-legend-toggle"
            className={legendOpen ? 'is-open' : ''}
            onClick={() => setLegendOpen((v) => !v)}
            aria-expanded={legendOpen}
            aria-controls="leadgen-legend-detail"
          >
            <Info size={12} strokeWidth={2} />
            <span>How scoring works</span>
            <ChevronDown size={12} strokeWidth={2.4} className="leadgen-legend-chev" />
          </button>
        </div>

        {legendOpen ? (
          <div id="leadgen-legend-detail">
            <p id="leadgen-legend-formula">
              Composite = Σ(signal × weight). Weights:&nbsp;
              {SIGNAL_META.map((s, i) => (
                <span key={s.key} className="leadgen-legend-formula-bit">
                  <strong>{s.label.split(' ')[0]}</strong>&nbsp;{Math.round(s.weight * 100)}%
                  {i < SIGNAL_META.length - 1 ? ' · ' : ''}
                </span>
              ))}
              . A high <em>website-quality</em> score means the site is bad — that's what makes them a prospect.
            </p>
            <ul id="leadgen-legend-signals">
              {SIGNAL_META.map((s) => (
                <li key={s.key} className="leadgen-legend-signal">
                  <div className="leadgen-legend-signal-head">
                    <span className="leadgen-legend-signal-label">{s.label}</span>
                    <span className="leadgen-legend-signal-weight">{Math.round(s.weight * 100)}%</span>
                  </div>
                  <p className="leadgen-legend-signal-blurb">{s.blurb}</p>
                  <p className="leadgen-legend-signal-line">
                    <span className="leadgen-legend-signal-tag leadgen-legend-signal-tag--ok">DETECTED</span>
                    {s.detected}
                  </p>
                  <p className="leadgen-legend-signal-line">
                    <span className="leadgen-legend-signal-tag leadgen-legend-signal-tag--todo">PLANNED</span>
                    {s.planned}
                  </p>
                </li>
              ))}
            </ul>
            <p id="leadgen-legend-foot">
              <strong>Status of your question:</strong> popularity (reviews + rating) <em>is</em> in the score
              today. Google Ads detection is <em>not</em> wired yet — the <code>hasGoogleAds</code> field exists
              in the scorer but the prospector doesn't populate it. Adding it is one extra SerpAPI call per
              campaign run (~$0.01).
            </p>
          </div>
        ) : null}
      </section>

      {/* ── Prospect table ───────────────────────────────────────────────── */}
      <section id="leadgen-prospect-table" aria-label="Prospect list">
        <div id="leadgen-prospect-table-head" role="row">
          <span className="leadgen-col leadgen-col-name">Business</span>
          <span className="leadgen-col leadgen-col-vertical">Vertical</span>
          <span className="leadgen-col leadgen-col-score">Score · Breakdown</span>
          <span className="leadgen-col leadgen-col-tier">Tier</span>
          <span className="leadgen-col leadgen-col-stage">Stage</span>
          <span className="leadgen-col leadgen-col-loc">Location</span>
          <span className="leadgen-col leadgen-col-action" aria-hidden="true" />
        </div>

        {isEmpty ? (
          <div id="leadgen-prospect-table-empty">
            <Radar size={28} strokeWidth={1.4} />
            <h3>No prospects discovered yet</h3>
            <p>
              Configure a campaign and the discovery cron will start populating the queue.
              Each prospect moves through {PIPELINE_STAGES.length} stages — discovered → scored →
              auditing → audited → generating → ready → contacted.
            </p>
            <button
              type="button"
              className="leadgen-btn leadgen-btn--primary"
              onClick={() => setShowBuilder(true)}
            >
              <Plus size={14} strokeWidth={2.4} />
              <span>Create your first campaign</span>
            </button>
          </div>
        ) : (
          <div id="leadgen-prospect-table-body" role="rowgroup">
            {filtered.map((p) => {
              const tier = tierFromScore(p.score);
              const isOpen = expandedRows.has(p.placeId);
              const breakdown = p.scoreBreakdown || {};
              const audit = p.quickAudit || {};
              return (
                <div key={p.placeId} className={`leadgen-row-wrap${isOpen ? ' is-open' : ''}`}>
                  <div
                    className="leadgen-row"
                    role="row"
                    onClick={() => toggleRow(p.placeId)}
                    aria-expanded={isOpen}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleRow(p.placeId);
                      }
                    }}
                  >
                    <span className="leadgen-col leadgen-col-name">
                      <span className="leadgen-row-name">{p.name}</span>
                      <span className="leadgen-row-links">
                        {p.website ? (
                          <a
                            className="leadgen-row-sub leadgen-row-sub--link"
                            href={normalizeUrl(p.website)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title={normalizeUrl(p.website)}
                          >
                            {displayHost(p.website)}
                          </a>
                        ) : (
                          <span className="leadgen-row-sub">no site</span>
                        )}
                        {p.placeId ? (
                          <a
                            className="leadgen-row-chip leadgen-row-chip--gbp"
                            href={gbpUrl(p.placeId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open Google Business Profile"
                          >
                            <MapPin size={10} strokeWidth={2.4} />
                            <span>GBP</span>
                          </a>
                        ) : null}
                        {(p.email || audit?.emailFound) ? (
                          <a
                            className="leadgen-row-chip leadgen-row-chip--email"
                            href={`mailto:${p.email || audit.emailFound}`}
                            onClick={(e) => e.stopPropagation()}
                            title={`Email ${p.email || audit.emailFound}`}
                          >
                            <Mail size={10} strokeWidth={2.4} />
                            <span>{p.email || audit.emailFound}</span>
                          </a>
                        ) : null}
                      </span>
                    </span>
                    <span className="leadgen-col leadgen-col-vertical">
                      {getVerticalLabel(p.vertical)}
                    </span>
                    <span className="leadgen-col leadgen-col-score">
                      <span className="leadgen-score-num">{p.score ?? '—'}</span>
                      {/* 4-segment sparkline — at-a-glance breakdown */}
                      <span className="leadgen-score-spark" aria-hidden="true">
                        {SIGNAL_META.map((s) => {
                          const v = Math.max(0, Math.min(100, breakdown[s.key] ?? 0));
                          return (
                            <span
                              key={s.key}
                              className="leadgen-score-spark-cell"
                              title={`${s.label}: ${Math.round(v)}/100`}
                            >
                              <span
                                className="leadgen-score-spark-fill"
                                style={{ height: `${v}%` }}
                              />
                            </span>
                          );
                        })}
                      </span>
                    </span>
                    <span className="leadgen-col leadgen-col-tier">
                      {tier ? <span className={`leadgen-tier leadgen-tier--${tier}`}>{tier}</span> : '—'}
                    </span>
                    <span className="leadgen-col leadgen-col-stage">{p.stage}</span>
                    <span className="leadgen-col leadgen-col-loc">{p.address || '—'}</span>
                    <span className="leadgen-col leadgen-col-action">
                      <button
                        type="button"
                        className={`leadgen-row-star${p.starred ? ' leadgen-row-star--on' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleStar(p.placeId, p.starred); }}
                        aria-label={p.starred ? 'Unstar' : 'Star this prospect'}
                        title={p.starred ? 'Remove star' : 'Star this prospect'}
                      >
                        <Star size={12} strokeWidth={2} />
                      </button>
                      {p.website ? (
                        <a
                          href={normalizeUrl(p.website)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="leadgen-row-action-link"
                          aria-label={`Open ${p.name} website in new tab`}
                        >
                          <ArrowUpRight size={14} strokeWidth={2} />
                        </a>
                      ) : (
                        <ArrowUpRight size={14} strokeWidth={2} style={{ opacity: 0.3 }} />
                      )}
                      <ChevronDown
                        size={13}
                        strokeWidth={2}
                        className="leadgen-row-chev"
                        aria-hidden="true"
                      />
                    </span>
                  </div>

                  {isOpen ? (
                    <div className="leadgen-row-details" role="region">
                      <div className="leadgen-row-details-bars">
                        {SIGNAL_META.map((s) => {
                          const raw = breakdown[s.key];
                          const v = typeof raw === 'number' ? Math.max(0, Math.min(100, raw)) : null;
                          const evald = evaluateSignalInputs(s.key, { prospect: p, audit });
                          return (
                            <div key={s.key} className="leadgen-row-bar">
                              <div className="leadgen-row-bar-head">
                                <span className="leadgen-row-bar-label">{s.label}</span>
                                <span className="leadgen-row-bar-weight">w {Math.round(s.weight * 100)}%</span>
                                <span className="leadgen-row-bar-val">{v == null ? '—' : Math.round(v)}</span>
                              </div>
                              <div className="leadgen-row-bar-track" aria-hidden="true">
                                <div className="leadgen-row-bar-fill" style={{ width: `${v ?? 0}%` }} />
                              </div>
                              {evald.items.length ? (
                                <ul className="leadgen-row-bar-inputs">
                                  {evald.items.map((it) => (
                                    <li
                                      key={it.key}
                                      className={`leadgen-row-input leadgen-row-input--${it.status}`}
                                      title={`${it.label} · max +${it.points}`}
                                    >
                                      <span className="leadgen-row-input-mark" aria-hidden="true">
                                        {it.status === 'hit'     ? '✓'
                                         : it.status === 'miss'  ? '·'
                                         : it.status === 'planned' ? '◇'
                                         : '—'}
                                      </span>
                                      <span className="leadgen-row-input-label">{it.label}</span>
                                      {it.detail ? (
                                        <span className="leadgen-row-input-detail">{it.detail}</span>
                                      ) : null}
                                      <span className="leadgen-row-input-pts">
                                        {it.status === 'hit' ? `+${it.points}`
                                         : it.status === 'planned' ? 'planned'
                                         : `(${it.points})`}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="leadgen-row-details-side">
                        {(p.geoBoost ?? 0) > 0 || p.geoLabel ? (
                          <div className="leadgen-row-geo">
                            <span className="leadgen-row-geo-key">GEO PRIORITY</span>
                            <span className="leadgen-row-geo-val">
                              {p.geoLabel || '—'}
                              {p.geoBoost ? <span className="leadgen-row-geo-boost"> +{p.geoBoost}</span> : null}
                            </span>
                            {p.baseScore != null ? (
                              <span className="leadgen-row-geo-math">
                                {p.baseScore} base + {p.geoBoost || 0} geo = {p.score}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {p.scoreRecommendation ? (
                          <div className="leadgen-row-rec">
                            <div className="leadgen-row-rec-label">Recommendation</div>
                            <div className="leadgen-row-rec-text">{p.scoreRecommendation}</div>
                          </div>
                        ) : null}

                        {Array.isArray(audit.deficiencies) && audit.deficiencies.length ? (
                          <div className="leadgen-row-defs">
                            <div className="leadgen-row-defs-label">Site deficiencies ({audit.deficiencies.length})</div>
                            <ul className="leadgen-row-defs-list">
                              {audit.deficiencies.slice(0, 8).map((d, i) => (
                                <li key={i}>{d}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="leadgen-row-meta">
                          <span className="leadgen-row-meta-cell">
                            <span className="leadgen-row-meta-key">PLATFORM</span>
                            <span className="leadgen-row-meta-val">{audit.platform || 'unknown'}</span>
                          </span>
                          <span className="leadgen-row-meta-cell">
                            <span className="leadgen-row-meta-key">LOAD</span>
                            <span className="leadgen-row-meta-val">
                              {audit.loadTimeMs != null ? `${(audit.loadTimeMs / 1000).toFixed(2)}s` : '—'}
                            </span>
                          </span>
                          <span className="leadgen-row-meta-cell">
                            <span className="leadgen-row-meta-key">HTTPS</span>
                            <span className="leadgen-row-meta-val">{audit.isHttps ? 'yes' : 'no'}</span>
                          </span>
                          <span className="leadgen-row-meta-cell">
                            <span className="leadgen-row-meta-key">RESPONSIVE</span>
                            <span className="leadgen-row-meta-val">{audit.isResponsive ? 'yes' : 'no'}</span>
                          </span>
                          <span className="leadgen-row-meta-cell">
                            <span className="leadgen-row-meta-key">JSON-LD</span>
                            <span className="leadgen-row-meta-val">{audit.hasJsonLd ? 'yes' : 'no'}</span>
                          </span>
                          <span className="leadgen-row-meta-cell">
                            <span className="leadgen-row-meta-key">REVIEWS</span>
                            <span className="leadgen-row-meta-val">
                              {p.reviewCount ?? 0} · {p.rating ? `${p.rating}★` : '—'}
                            </span>
                          </span>
                        </div>

                        {/* ── Module launcher table ──────────────────── */}
                        <div id={`leadgen-module-table-${p.placeId}`} className="leadgen-module-table">
                          <div className="leadgen-module-table-head">
                            <span className="leadgen-module-table-title">Modules</span>
                            {p.website ? (
                              <button
                                type="button"
                                className="leadgen-module-run-all-btn"
                                disabled={onboardBusy[p.placeId]}
                                onClick={(e) => { e.stopPropagation(); handleOnboard(p.placeId); }}
                                title="Run all 4 analysis modules at once"
                              >
                                {onboardBusy[p.placeId] ? (
                                  <><Loader2 size={10} strokeWidth={2.4} className="leadgen-spin" /><span>Running…</span></>
                                ) : (
                                  <span>Run All</span>
                                )}
                              </button>
                            ) : null}
                          </div>
                          {LEADGEN_MODULE_REGISTRY.map((mod) => {
                            const stored = mod.id === 'visual-dna' ? p.visualDna : (mod.storeKey ? p.onboard?.[mod.storeKey] : null);
                            const hasData  = Boolean(stored);
                            const status   = stored?.status || null;
                            const runAt    = stored?.runAt || stored?.updatedAt || null;
                            const dotColor = status === 'succeeded' || status === 'ready' ? '#0cce6b' : status === 'failed' ? '#ff4e42' : '#3a3a3a';
                            const hasWebsite = Boolean(p.website);
                            return (
                              <div key={mod.id} className="leadgen-module-row">
                                <span className="leadgen-module-row-dot" style={{ background: dotColor }} />
                                <mod.Icon size={11} strokeWidth={2} className="leadgen-module-row-icon" />
                                <div className="leadgen-module-row-info">
                                  <span className="leadgen-module-row-label">{mod.label}</span>
                                  <span className="leadgen-module-row-desc">
                                    {runAt ? `✓ ${new Date(runAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})}` : mod.description}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className={`leadgen-module-action-btn${hasData ? ' leadgen-module-action-btn--rerun' : ''}`}
                                  disabled={!hasWebsite && mod.type === 'analysis'}
                                  onClick={(e) => { e.stopPropagation(); handleModuleRun(p.placeId, mod.id, mod.label, mod.type); }}
                                  title={!hasWebsite && mod.type === 'analysis' ? 'Prospect has no website' : undefined}
                                >
                                  {hasData && mod.type === 'analysis'
                                    ? <><RotateCcw size={9} strokeWidth={2.5} /><span>Re-run</span></>
                                    : <span>{mod.type === 'chat' || mod.type === 'experience' ? 'Open' : 'Run'}</span>}
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        {/* ── Onboard intelligence results ───────────── */}
                        {p.onboard ? (
                          <div id={`leadgen-onboard-results-${p.placeId}`} className="leadgen-onboard-results">
                            <h4 className="leadgen-onboard-results-title">Onboard Intelligence</h4>

                            <div className="leadgen-onboard-grid">
                              {/* Cross-Device Layouts */}
                              <div className="leadgen-onboard-module">
                                <div className="leadgen-onboard-module-head">
                                  <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.multiDeviceView?.status || 'pending'}`} />
                                  <span className="leadgen-onboard-module-label">Cross-Device Layouts</span>
                                </div>
                                {p.onboard.multiDeviceView?.mockupUrl ? (
                                  <div className="leadgen-onboard-screenshots">
                                    <a href={p.onboard.multiDeviceView.mockupUrl} target="_blank" rel="noopener noreferrer">
                                      <img
                                        src={p.onboard.multiDeviceView.mockupUrl}
                                        alt={`${p.name} device mockup`}
                                        className="leadgen-onboard-mockup-img"
                                        loading="lazy"
                                      />
                                    </a>
                                    <div className="leadgen-onboard-screenshot-thumbs">
                                      {['desktopUrl', 'tabletUrl', 'mobileUrl'].map((key) =>
                                        p.onboard.multiDeviceView[key] ? (
                                          <a key={key} href={p.onboard.multiDeviceView[key]} target="_blank" rel="noopener noreferrer">
                                            <img
                                              src={p.onboard.multiDeviceView[key]}
                                              alt={`${key.replace('Url', '')} screenshot`}
                                              className="leadgen-onboard-thumb"
                                              loading="lazy"
                                            />
                                          </a>
                                        ) : null
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="leadgen-onboard-na">Screenshots unavailable</span>
                                )}
                              </div>

                              {/* SEO + Performance */}
                              <div className="leadgen-onboard-module">
                                <div className="leadgen-onboard-module-head">
                                  <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.seoPerformance?.status || 'pending'}`} />
                                  <span className="leadgen-onboard-module-label">SEO + Performance</span>
                                </div>
                                {p.onboard.seoPerformance?.pagespeed ? (
                                  <div className="leadgen-onboard-psi">
                                    {['performance', 'accessibility', 'seo', 'bestPractices'].map((metric) => {
                                      const val = p.onboard.seoPerformance.pagespeed[metric];
                                      const color = val >= 90 ? '#0cce6b' : val >= 50 ? '#ffa400' : '#ff4e42';
                                      return (
                                        <div key={metric} className="leadgen-onboard-psi-metric">
                                          <span className="leadgen-onboard-psi-val" style={{ color }}>{val ?? '—'}</span>
                                          <span className="leadgen-onboard-psi-label">{metric}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <span className="leadgen-onboard-na">PageSpeed data unavailable</span>
                                )}
                              </div>

                              {/* AI Agent Readiness */}
                              <div className="leadgen-onboard-module">
                                <div className="leadgen-onboard-module-head">
                                  <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.agentReadiness?.status || 'pending'}`} />
                                  <span className="leadgen-onboard-module-label">AI Agent Readiness</span>
                                </div>
                                {p.onboard.agentReadiness?.score != null ? (
                                  <div className="leadgen-onboard-agent">
                                    <div className="leadgen-onboard-agent-score">
                                      <span className="leadgen-onboard-agent-score-val">{p.onboard.agentReadiness.score}</span>
                                      <span className="leadgen-onboard-agent-score-label">/100</span>
                                    </div>
                                    <span className="leadgen-onboard-agent-verdict">{p.onboard.agentReadiness.verdict}</span>
                                    {Array.isArray(p.onboard.agentReadiness.findings) && p.onboard.agentReadiness.findings.length > 0 ? (
                                      <ul className="leadgen-onboard-agent-findings">
                                        {p.onboard.agentReadiness.findings.slice(0, 5).map((f, i) => (
                                          <li key={i}>{typeof f === 'string' ? f : f.message || f.id}</li>
                                        ))}
                                      </ul>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span className="leadgen-onboard-na">Agent readiness data unavailable</span>
                                )}
                              </div>

                              {/* Social Preview */}
                              <div className="leadgen-onboard-module">
                                <div className="leadgen-onboard-module-head">
                                  <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.socialPreview?.status || 'pending'}`} />
                                  <span className="leadgen-onboard-module-label">Social Preview</span>
                                </div>
                                {p.onboard.socialPreview?.siteMeta ? (
                                  <div className="leadgen-onboard-social">
                                    {p.onboard.socialPreview.siteMeta.ogImage ? (
                                      <img
                                        src={p.onboard.socialPreview.siteMeta.ogImage}
                                        alt="OG image preview"
                                        className="leadgen-onboard-og-img"
                                        loading="lazy"
                                      />
                                    ) : (
                                      <span className="leadgen-onboard-social-missing">No OG image</span>
                                    )}
                                    <div className="leadgen-onboard-social-meta">
                                      {[
                                        ['Title',        p.onboard.socialPreview.siteMeta.ogTitle       || '—'],
                                        ['Description',  p.onboard.socialPreview.siteMeta.ogDescription || '—'],
                                        ['Twitter Card', p.onboard.socialPreview.siteMeta.twitterCard   || 'none'],
                                      ].map(([key, val]) => (
                                        <div key={key} className="leadgen-onboard-social-meta-row">
                                          <span className="leadgen-onboard-social-key">{key}</span>
                                          <span className="leadgen-onboard-social-val">{val}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="leadgen-onboard-na">No social meta found</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {/* ── Site Generation ────────────────────────── */}
                        {p.onboard ? (
                          <div id={`leadgen-generation-${p.placeId}`} className="leadgen-generation">
                            <span className="leadgen-generation-label">Site Generation</span>

                            <div className="leadgen-generation-steps">
                              {/* Step 1 — Prepare Brief */}
                              <div className="leadgen-gen-step">
                                <span className={`leadgen-gen-step-dot ${p.generation?.designMd ? 'leadgen-gen-step-dot--done' : ''}`} />
                                <div className="leadgen-gen-step-body">
                                  <span className="leadgen-gen-step-title">1. Prepare Brief</span>
                                  <span className="leadgen-gen-step-desc">
                                    {p.generation?.briefGeneratedAt
                                      ? `Ready · ${p.generation.briefLines ?? '?'} lines`
                                      : 'Scrapes copy, assets, and builds DESIGN.MD'}
                                  </span>
                                  {p.generation?.designMd ? (
                                    <button
                                      type="button"
                                      className="leadgen-brief-view-link"
                                      onClick={(e) => { e.stopPropagation(); setBriefEditorProspect(p); }}
                                    >
                                      View / Edit Brief
                                    </button>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className="leadgen-btn leadgen-btn--generate"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const t = getToggles(p.placeId);
                                    setModulePanel({
                                      placeId: p.placeId,
                                      moduleId: 'prepare-brief',
                                      moduleLabel: 'Prepare Brief',
                                      endpoint: '/api/leadgen/prepare-brief',
                                      extraBody: { useBrandSystem: t.useBrandSystem, useDesignEval: t.useDesignEval },
                                    });
                                  }}
                                >
                                  {p.generation?.designMd
                                    ? <><RotateCcw size={10} strokeWidth={2.4} /><span>Re-prepare</span></>
                                    : <><Wand2 size={10} strokeWidth={2.4} /><span>Prepare</span></>}
                                </button>
                              </div>

                              {/* Step 2 — Generate Mockup */}
                              <div className={`leadgen-gen-step ${!p.generation?.designMd ? 'leadgen-gen-step--locked' : ''}`}>
                                <span className={`leadgen-gen-step-dot ${p.generation?.mockupUrl ? 'leadgen-gen-step-dot--done' : ''}`} />
                                <div className="leadgen-gen-step-body">
                                  <span className="leadgen-gen-step-title">2. Generate Mockup</span>
                                  <span className="leadgen-gen-step-desc">
                                    {p.generation?.mockupUrl
                                      ? `Visual concept ready${p.generation?.mockupPromptEditedAt ? ' · prompt edited' : ''}`
                                      : p.generation?.designMd
                                        ? 'Brief ready — generate visual concept'
                                        : 'Complete step 1 first'}
                                  </span>
                                  {p.generation?.mockupPrompt ? (
                                    <button
                                      type="button"
                                      className="leadgen-brief-view-link"
                                      onClick={(e) => { e.stopPropagation(); setMockupPromptEditorProspect(p); }}
                                    >
                                      View / Edit Prompt
                                    </button>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className="leadgen-btn leadgen-btn--generate"
                                  disabled={!p.generation?.designMd}
                                  onClick={(e) => { e.stopPropagation(); setModulePanel({ placeId: p.placeId, moduleId: 'generate-mockup', moduleLabel: 'Generate Mockup', endpoint: '/api/leadgen/generate-mockup' }); }}
                                >
                                  {p.generation?.mockupUrl
                                    ? <><RotateCcw size={10} strokeWidth={2.4} /><span>Re-generate</span></>
                                    : <><Wand2 size={10} strokeWidth={2.4} /><span>Generate</span></>}
                                </button>
                              </div>

                              {/* Step 3 — Generate Site */}
                              <div className={`leadgen-gen-step ${!p.generation?.designMd ? 'leadgen-gen-step--locked' : ''}`}>
                                <span className={`leadgen-gen-step-dot ${p.generation?.previewUrl ? 'leadgen-gen-step-dot--done' : ''}`} />
                                <div className="leadgen-gen-step-body">
                                  <span className="leadgen-gen-step-title">3. Generate Site</span>
                                  <span className="leadgen-gen-step-desc">
                                    {p.generation?.previewUrl
                                      ? `Preview deployed${p.generation?.sitePromptEditedAt ? ' · prompt edited' : ''}`
                                      : p.generation?.mockupUrl
                                        ? 'Mockup ready — build with Claude'
                                        : p.generation?.designMd
                                          ? 'Run step 2 first for best results'
                                          : 'Complete step 1 first'}
                                  </span>
                                  {p.generation?.sitePrompt ? (
                                    <button
                                      type="button"
                                      className="leadgen-brief-view-link"
                                      onClick={(e) => { e.stopPropagation(); setSitePromptEditorProspect(p); }}
                                    >
                                      View / Edit Prompt
                                    </button>
                                  ) : null}
                                  <div
                                    id={`leadgen-gen-toggles-${p.placeId}`}
                                    className="leadgen-gen-toggles"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <label className="leadgen-gen-toggle" title="Include mockup as vision context">
                                      <input
                                        type="checkbox"
                                        checked={getToggles(p.placeId).useMockup}
                                        onChange={(e) => setToggle(p.placeId, 'useMockup', e.target.checked)}
                                      />
                                      <span>Mockup</span>
                                    </label>
                                    <label className="leadgen-gen-toggle" title="Fetch Lazyweb reference screenshots as vision context">
                                      <input
                                        type="checkbox"
                                        checked={getToggles(p.placeId).useLazywebVision}
                                        onChange={(e) => setToggle(p.placeId, 'useLazywebVision', e.target.checked)}
                                      />
                                      <span>Lazyweb</span>
                                    </label>
                                    <label className="leadgen-gen-toggle" title="Include Brand System in brief priority chain">
                                      <input
                                        type="checkbox"
                                        checked={getToggles(p.placeId).useBrandSystem}
                                        onChange={(e) => setToggle(p.placeId, 'useBrandSystem', e.target.checked)}
                                      />
                                      <span>Brand</span>
                                    </label>
                                    <label className="leadgen-gen-toggle" title="Include Design Eval in brief priority chain">
                                      <input
                                        type="checkbox"
                                        checked={getToggles(p.placeId).useDesignEval}
                                        onChange={(e) => setToggle(p.placeId, 'useDesignEval', e.target.checked)}
                                      />
                                      <span>DesignEval</span>
                                    </label>
                                    <label className="leadgen-gen-toggle" title="Run AI Readiness before/after comparison">
                                      <input
                                        type="checkbox"
                                        checked={getToggles(p.placeId).runComparison}
                                        onChange={(e) => setToggle(p.placeId, 'runComparison', e.target.checked)}
                                      />
                                      <span>Readiness</span>
                                    </label>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="leadgen-btn leadgen-btn--generate"
                                  disabled={!p.generation?.designMd}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModulePanel({
                                      placeId: p.placeId,
                                      moduleId: 'generate-site',
                                      moduleLabel: 'Generate Site',
                                      endpoint: '/api/leadgen/generate-site',
                                      extraBody: getToggles(p.placeId),
                                    });
                                  }}
                                >
                                  {p.generation?.previewUrl
                                    ? <><RotateCcw size={10} strokeWidth={2.4} /><span>Re-generate</span></>
                                    : <><Wand2 size={10} strokeWidth={2.4} /><span>Generate</span></>}
                                </button>
                              </div>

                              {/* Step 4 — Package Outreach */}
                              <div className={`leadgen-gen-step ${!p.generation?.previewUrl ? 'leadgen-gen-step--locked' : ''}`}>
                                <span className={`leadgen-gen-step-dot ${p.outreach?.packagedAt ? 'leadgen-gen-step-dot--done' : ''}`} />
                                <div className="leadgen-gen-step-body">
                                  <span className="leadgen-gen-step-title">4. Package Outreach</span>
                                  <span className="leadgen-gen-step-desc">
                                    {p.outreach?.packagedAt
                                      ? `Email ready · ${p.outreach.emailSubject || 'Postcard packaged'}`
                                      : p.generation?.previewUrl
                                        ? 'Site live — compose postcard email'
                                        : 'Complete step 3 first'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="leadgen-btn leadgen-btn--generate"
                                  disabled={!p.generation?.previewUrl}
                                  onClick={(e) => { e.stopPropagation(); handlePackage(p.placeId); }}
                                >
                                  {p.outreach?.packagedAt
                                    ? <><RotateCcw size={10} strokeWidth={2.4} /><span>Re-package</span></>
                                    : <><Package size={10} strokeWidth={2.4} /><span>Package</span></>}
                                </button>
                              </div>

                              {/* Step 5 — Send */}
                              <div className={`leadgen-gen-step ${!p.outreach?.emailHtml ? 'leadgen-gen-step--locked' : ''}`}>
                                <span className={`leadgen-gen-step-dot ${p.outreach?.sentAt ? 'leadgen-gen-step-dot--done' : ''}`} />
                                <div className="leadgen-gen-step-body">
                                  <span className="leadgen-gen-step-title">5. Send to Owner</span>
                                  <span className="leadgen-gen-step-desc">
                                    {p.outreach?.sentAt
                                      ? `Sent · ${p.outreach.sentTo || ''}`
                                      : p.outreach?.emailHtml
                                        ? 'Review and send postcard email'
                                        : 'Complete step 4 first'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="leadgen-btn leadgen-btn--generate"
                                  disabled={!p.outreach?.emailHtml}
                                  onClick={(e) => { e.stopPropagation(); handleSendPreview(p); }}
                                >
                                  {p.outreach?.sentAt
                                    ? <><RotateCcw size={10} strokeWidth={2.4} /><span>Re-send</span></>
                                    : <><Send size={10} strokeWidth={2.4} /><span>Send</span></>}
                                </button>
                              </div>

                              {/* Step 6 — Make Dashboard */}
                              <div className={`leadgen-gen-step ${!p.generation?.previewUrl ? 'leadgen-gen-step--locked' : ''}`}>
                                <span className={`leadgen-gen-step-dot ${p.dashboard?.clientId ? 'leadgen-gen-step-dot--done' : ''}`} />
                                <div className="leadgen-gen-step-body">
                                  <span className="leadgen-gen-step-title">6. Make Dashboard</span>
                                  <span className="leadgen-gen-step-desc">
                                    {p.dashboard?.clientId
                                      ? `Dashboard live · ${p.dashboard.name || p.name || p.dashboard.clientId}`
                                      : p.generation?.previewUrl
                                        ? 'Provision client workspace from prospect'
                                        : 'Complete step 3 first'}
                                  </span>
                                  {p.dashboard?.clientId ? (
                                    <a
                                      className="leadgen-brief-view-link"
                                      href={`/dashboard?as=${encodeURIComponent(p.dashboard.clientId)}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      View Dashboard
                                    </a>
                                  ) : null}
                                </div>
                                <button
                                  type="button"
                                  className="leadgen-btn leadgen-btn--generate"
                                  disabled={!p.generation?.previewUrl || dashboardBusy[p.placeId]}
                                  onClick={(e) => { e.stopPropagation(); handleMakeDashboard(p.placeId); }}
                                >
                                  {dashboardBusy[p.placeId]
                                    ? <><Loader2 size={10} strokeWidth={2.4} className="leadgen-spin" /><span>Making</span></>
                                    : p.dashboard?.clientId
                                      ? <><LayoutDashboard size={10} strokeWidth={2.4} /><span>Refresh</span></>
                                      : <><LayoutDashboard size={10} strokeWidth={2.4} /><span>Make</span></>}
                                </button>
                              </div>
                            </div>

                            {/* Mockup preview */}
                            {p.generation?.mockupUrl ? (
                              <div className="leadgen-mockup-preview">
                                <span className="leadgen-mockup-label">Visual Concept</span>
                                <a
                                  href={p.generation.mockupUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <img
                                    src={p.generation.mockupUrl}
                                    alt="Site mockup"
                                    className="leadgen-mockup-img"
                                  />
                                </a>
                              </div>
                            ) : null}

                            {/* Preview + comparison */}
                            {p.generation?.previewUrl ? (
                              <div className="leadgen-generation-result">
                                <a
                                  href={p.generation.previewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="leadgen-preview-link"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink size={10} strokeWidth={2.4} />
                                  <span>View Preview</span>
                                </a>

                                {p.generation?.readinessComparison ? (
                                  <div className="leadgen-comparison">
                                    <div className="leadgen-comparison-row">
                                      <span className="leadgen-comparison-col">
                                        <span className="leadgen-comparison-sublabel">BEFORE</span>
                                        <span className="leadgen-comparison-score leadgen-comparison-score--before">
                                          {p.generation.readinessComparison.before?.score ?? '?'}
                                        </span>
                                      </span>
                                      <span className="leadgen-comparison-arrow">→</span>
                                      <span className="leadgen-comparison-col">
                                        <span className="leadgen-comparison-sublabel">AFTER</span>
                                        <span className="leadgen-comparison-score leadgen-comparison-score--after">
                                          {p.generation.readinessComparison.after?.score ?? '?'}
                                        </span>
                                      </span>
                                      {p.generation.readinessComparison.improvement != null ? (
                                        <span className="leadgen-comparison-delta">
                                          +{p.generation.readinessComparison.improvement}
                                        </span>
                                      ) : null}
                                    </div>
                                    <span className="leadgen-comparison-caption">AI Agent Readiness /100</span>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Active campaigns ─────────────────────────────────────────────── */}
      <section id="leadgen-campaigns-panel" aria-label="Active campaigns">
        <header id="leadgen-campaigns-head">
          <h3>Active Campaigns</h3>
          <button
            type="button"
            className="leadgen-btn leadgen-btn--ghost"
            onClick={() => setShowBuilder(true)}
          >
            <Plus size={12} strokeWidth={2.4} />
            <span>Add</span>
          </button>
        </header>

        {campaignNotice ? (
          <div
            id="leadgen-campaign-notice"
            className={`leadgen-campaign-notice--${campaignNotice.kind}`}
            role="status"
          >
            {campaignNotice.text}
          </div>
        ) : null}

        {listenerError ? (
          <div
            id="leadgen-campaign-notice"
            className="leadgen-campaign-notice--err"
            role="status"
          >
            Firestore: {listenerError}. Add the leadgen rules below and redeploy
            (`firebase deploy --only firestore:rules`).
          </div>
        ) : null}

        {campaigns.length === 0 ? (
          <div id="leadgen-campaigns-empty">
            No campaigns configured. Campaigns target a vertical + location and feed
            the discovery cron on its daily schedule.
          </div>
        ) : (
          <ul id="leadgen-campaigns-list">
            {campaigns.map((c) => {
              const busy = campaignBusy[c.id] === 'running';
              const found = prospects.filter((p) => p.campaignId === c.id).length;
              const lastRun = c.lastRunAt
                ? new Date(c.lastRunAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : 'never';
              return (
                <li key={c.id} className="leadgen-campaign-item">
                  <span className={`leadgen-campaign-status leadgen-campaign-status--${c.enabled ? 'on' : 'off'}`} />
                  <span className="leadgen-campaign-id">{c.id}</span>
                  <span className="leadgen-campaign-meta">
                    {c.location?.label || '—'}
                    <span className="leadgen-campaign-meta-sep" aria-hidden="true">·</span>
                    <span className="leadgen-campaign-meta-faint">last run {lastRun}</span>
                  </span>
                  <span className="leadgen-campaign-count">{found} found</span>
                  <button
                    type="button"
                    className="leadgen-btn leadgen-btn--ghost leadgen-campaign-run"
                    onClick={() => handleRunCampaign(c.id)}
                    disabled={busy || c.enabled === false}
                    title={c.enabled === false ? 'Campaign disabled' : 'Run discovery now'}
                  >
                    {busy ? (
                      <Loader2 size={12} strokeWidth={2.4} className="leadgen-spin" />
                    ) : (
                      <Play size={12} strokeWidth={2.4} />
                    )}
                    <span>{busy ? 'Running…' : 'Run'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CampaignBuilderModal
        open={showBuilder}
        onClose={() => setShowBuilder(false)}
        onSaved={() => setCampaignNotice({ kind: 'ok', text: 'Campaign saved.' })}
        getIdToken={getIdToken}
      />

      <SettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        getIdToken={getIdToken}
      />

      <QuickRunModal
        open={showQuickRun}
        onClose={() => setShowQuickRun(false)}
        onResult={(notice) => setCampaignNotice(notice)}
        getIdToken={getIdToken}
      />

      <LeadgenModulePanel
        open={Boolean(modulePanel)}
        placeId={modulePanel?.placeId}
        moduleId={modulePanel?.moduleId}
        moduleLabel={modulePanel?.moduleLabel}
        endpoint={modulePanel?.endpoint}
        extraBody={modulePanel?.extraBody}
        getIdToken={getIdToken}
        onClose={() => setModulePanel(null)}
        onDone={() => {}}
      />

      <BriefEditorModal
        open={Boolean(briefEditorProspect)}
        prospect={briefEditorProspect}
        onClose={() => setBriefEditorProspect(null)}
        onSaved={() => {}}
      />

      <MockupPromptEditorModal
        open={Boolean(mockupPromptEditorProspect)}
        prospect={mockupPromptEditorProspect}
        onClose={() => setMockupPromptEditorProspect(null)}
        onSaved={() => {}}
      />

      <SitePromptEditorModal
        open={Boolean(sitePromptEditorProspect)}
        prospect={sitePromptEditorProspect}
        onClose={() => setSitePromptEditorProspect(null)}
        onSaved={() => {}}
      />

      <SendPreviewModal
        open={Boolean(sendModal)}
        prospect={sendModal}
        onClose={() => setSendModal(null)}
        getIdToken={getIdToken}
      />

      <BrandSystemBuildModal
        open={brandSystemOpen}
        onClose={() => setBrandSystemOpen(false)}
        getIdToken={getIdToken}
        onComplete={() => setBrandSystemOpen(false)}
      />
      <VisualDnaModal
        open={Boolean(visualDnaProspect)}
        prospect={visualDnaProspect}
        onClose={() => setVisualDnaProspect(null)}
        getIdToken={getIdToken}
      />

      <style jsx>{`
        #leadgen-dashboard {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 22px 22px 26px;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          color: #1a1a1a;
          --lg-mono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
          --lg-line: rgba(26, 26, 26, 0.10);
          --lg-line-strong: rgba(26, 26, 26, 0.18);
          --lg-ink: #1a1a1a;
          --lg-muted: #6b6b6b;
          --lg-faint: #9a9a9a;
          --lg-bg: rgba(255, 255, 255, 0.55);
          --lg-bg-strong: rgba(255, 255, 255, 0.85);
          --lg-signal: #ff3b30;
        }

        /* ── Header ──────────────────────────────────────────────────── */
        #leadgen-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding-bottom: 14px;
          border-bottom: 1px dashed var(--lg-line);
        }
        #leadgen-header-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        #leadgen-status-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--lg-signal);
          box-shadow: 0 0 0 4px rgba(255, 59, 48, 0.12);
          animation: leadgen-pulse 2.4s ease-in-out infinite;
        }
        @keyframes leadgen-pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(255, 59, 48, 0.12); }
          50%      { box-shadow: 0 0 0 8px rgba(255, 59, 48, 0.04); }
        }
        #leadgen-h {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        #leadgen-header-tag {
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.16em;
          color: var(--lg-faint);
          padding: 3px 8px;
          border: 1px solid var(--lg-line);
          border-radius: 999px;
        }
        #leadgen-header-actions {
          display: flex; gap: 8px;
        }

        /* ── Buttons ─────────────────────────────────────────────────── */
        :global(.leadgen-btn) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: -0.005em;
          padding: 7px 12px;
          border-radius: 999px;
          cursor: pointer;
          border: 1px solid var(--lg-line);
          transition: background 180ms ease, border-color 180ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
          will-change: transform;
        }
        :global(.leadgen-btn--ghost) {
          background: transparent;
          color: var(--lg-ink);
        }
        :global(.leadgen-btn--ghost:hover) {
          background: var(--lg-bg);
          border-color: var(--lg-line-strong);
          transform: translateY(-1px);
        }
        :global(.leadgen-btn--primary) {
          background: var(--lg-ink);
          color: #fff;
          border-color: var(--lg-ink);
        }
        :global(.leadgen-btn--primary:hover) {
          transform: translateY(-1px);
          background: #000;
        }

        /* ── Stats bar ───────────────────────────────────────────────── */
        #leadgen-stats-bar {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          background:
            linear-gradient(var(--lg-bg), var(--lg-bg)),
            radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0) 0 0/14px 14px;
          border: 1px solid var(--lg-line);
          border-radius: 14px;
          overflow: hidden;
        }
        .leadgen-stats-cell {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 18px 16px 16px;
          border-right: 1px solid var(--lg-line);
          position: relative;
        }
        .leadgen-stats-cell:last-child { border-right: none; }
        .leadgen-stats-cell-idx {
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.18em;
          color: var(--lg-faint);
        }
        .leadgen-stats-cell-num {
          font-family: var(--lg-mono);
          font-size: 30px;
          font-weight: 500;
          letter-spacing: -0.01em;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          color: var(--lg-ink);
        }
        .leadgen-stats-cell-label {
          font-size: 11px;
          letter-spacing: 0.04em;
          color: var(--lg-muted);
          text-transform: uppercase;
        }

        /* ── Filter row ──────────────────────────────────────────────── */
        #leadgen-filters-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          padding: 10px 14px;
          background: var(--lg-bg);
          border: 1px solid var(--lg-line);
          border-radius: 12px;
        }
        #leadgen-filters-left, #leadgen-filters-right {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        #leadgen-filters-icon {
          display: inline-flex;
          color: var(--lg-faint);
          margin-right: 2px;
        }
        :global(.leadgen-filter) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
        }
        :global(.leadgen-filter-label) {
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.16em;
          color: var(--lg-faint);
          text-transform: uppercase;
        }
        :global(.leadgen-filter-select) {
          font-family: inherit;
          font-size: 12px;
          color: var(--lg-ink);
          background: transparent;
          border: none;
          border-bottom: 1px dashed var(--lg-line-strong);
          padding: 2px 4px;
          cursor: pointer;
          outline: none;
          transition: border-color 180ms ease;
        }
        :global(.leadgen-filter-select:hover) { border-bottom-color: var(--lg-ink); }
        :global(.leadgen-filter-select:focus) { border-bottom-color: var(--lg-signal); }

        :global(.leadgen-filter-search) {
          font-family: inherit;
          font-size: 12px;
          color: var(--lg-ink);
          background: transparent;
          border: none;
          border-bottom: 1px dashed var(--lg-line-strong);
          padding: 2px 4px;
          outline: none;
          width: 148px;
          transition: border-color 180ms ease, width 220ms ease;
        }
        :global(.leadgen-filter-search:focus) {
          border-bottom-color: var(--lg-signal);
          width: 200px;
        }
        :global(.leadgen-filter-search::placeholder) { color: var(--lg-faint); }

        #leadgen-starred-toggle {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-family: inherit;
          font-size: 11.5px;
          background: transparent;
          border: 1px dashed var(--lg-line-strong);
          border-radius: 999px;
          padding: 4px 10px;
          cursor: pointer;
          color: var(--lg-muted);
          transition: all 160ms ease;
        }
        #leadgen-starred-toggle:hover {
          color: var(--lg-ink);
          border-color: var(--lg-ink);
          border-style: solid;
        }
        #leadgen-starred-toggle.is-on {
          background: #fef3c7;
          border-color: #f59e0b;
          border-style: solid;
          color: #92400e;
        }

        /* ── Threshold strip ─────────────────────────────────────────── */
        #leadgen-threshold-strip {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 8px 14px;
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-muted);
          letter-spacing: 0.06em;
        }
        .leadgen-thresh-item {
          display: inline-flex;
          align-items: baseline;
          gap: 6px;
        }
        .leadgen-thresh-key { color: var(--lg-faint); }
        .leadgen-thresh-val {
          color: var(--lg-ink);
          font-variant-numeric: tabular-nums;
        }
        .leadgen-thresh-val--mono { letter-spacing: 0.08em; }
        .leadgen-thresh-sep {
          width: 1px; height: 10px;
          background: var(--lg-line);
        }

        /* ── Table ───────────────────────────────────────────────────── */
        #leadgen-prospect-table {
          background: var(--lg-bg-strong);
          border: 1px solid var(--lg-line);
          border-radius: 14px;
          overflow: hidden;
        }
        #leadgen-prospect-table-head {
          display: grid;
          grid-template-columns: 2fr 1fr 0.7fr 0.7fr 1fr 1.4fr 0.65fr;
          padding: 10px 16px;
          border-bottom: 1px solid var(--lg-line);
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--lg-faint);
        }
        .leadgen-row {
          display: grid;
          grid-template-columns: 2fr 1fr 0.7fr 0.7fr 1fr 1.4fr 0.65fr;
          padding: 14px 16px;
          border-bottom: 1px solid var(--lg-line);
          font-size: 12.5px;
          align-items: center;
          transition: background 160ms ease;
        }
        .leadgen-row:last-child { border-bottom: none; }
        .leadgen-row:hover { background: rgba(255, 59, 48, 0.03); }
        .leadgen-col { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .leadgen-row-name { font-weight: 500; color: var(--lg-ink); }
        .leadgen-row-sub {
          font-family: var(--lg-mono);
          font-size: 10.5px;
          color: var(--lg-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .leadgen-row-sub--link {
          color: var(--lg-muted);
          text-decoration: none;
          border-bottom: 1px dashed transparent;
          transition: color 140ms ease, border-color 140ms ease;
          width: fit-content;
          max-width: 100%;
          display: inline-block;
        }
        .leadgen-row-sub--link:hover {
          color: var(--lg-signal);
          border-bottom-color: var(--lg-signal);
        }
        .leadgen-row-links {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 4px 8px;
          align-items: center;
          margin-top: 1px;
        }
        .leadgen-row-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.04em;
          color: var(--lg-muted);
          text-decoration: none;
          padding: 1px 7px 1px 6px;
          border-radius: 999px;
          border: 1px solid var(--lg-line);
          background: rgba(0, 0, 0, 0.02);
          transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .leadgen-row-chip > span {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .leadgen-row-chip:hover {
          color: var(--lg-ink);
          border-color: var(--lg-line-strong);
          background: rgba(0, 0, 0, 0.04);
        }
        .leadgen-row-chip--gbp:hover { color: #1a73e8; border-color: rgba(26, 115, 232, 0.45); }
        .leadgen-row-chip--email:hover { color: var(--lg-signal); border-color: rgba(255, 59, 48, 0.45); }
        .leadgen-col-action {
          flex-direction: row !important;
          align-items: center;
          gap: 6px;
        }
        .leadgen-row-star {
          background: transparent;
          border: none;
          padding: 2px;
          cursor: pointer;
          color: var(--lg-faint);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: color 160ms ease, transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
          border-radius: 4px;
          flex-shrink: 0;
        }
        .leadgen-row-star:hover { color: #f59e0b; transform: scale(1.25); }
        .leadgen-row-star--on { color: #f59e0b; }
        .leadgen-row-star--on:hover { color: #d97706; }

        .leadgen-row-action-link {
          color: var(--lg-faint);
          display: inline-flex;
          transition: color 140ms ease, transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .leadgen-row-action-link:hover {
          color: var(--lg-signal);
          transform: translate(2px, -2px);
        }
        .leadgen-row-action-btn {
          background: transparent;
          border: 1px solid rgba(0,0,0,0.10);
          width: 26px; height: 26px;
          border-radius: 6px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #777;
          transition: all 160ms ease;
          padding: 0;
        }
        .leadgen-row-action-btn--package:hover {
          background: rgba(37, 99, 235, 0.08);
          border-color: rgba(37, 99, 235, 0.3);
          color: #2563eb;
        }
        .leadgen-row-action-btn--send:hover {
          background: rgba(16, 185, 129, 0.08);
          border-color: rgba(16, 185, 129, 0.3);
          color: #10b981;
        }

        /* ── Legend strip ────────────────────────────────────────────── */
        #leadgen-legend {
          background: var(--lg-bg);
          border: 1px solid var(--lg-line);
          border-radius: 12px;
          padding: 10px 14px;
        }
        #leadgen-legend-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        #leadgen-legend-tiers {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }
        .leadgen-legend-tier {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
        }
        .leadgen-legend-tier-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
        }
        .leadgen-legend-tier-label {
          color: var(--lg-ink);
          font-weight: 500;
        }
        .leadgen-legend-tier-rule {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-faint);
        }
        :global(#leadgen-legend-toggle) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: transparent;
          border: 1px solid var(--lg-line);
          border-radius: 999px;
          padding: 5px 11px;
          font-family: inherit;
          font-size: 11px;
          color: var(--lg-muted);
          cursor: pointer;
          transition: background 160ms ease, color 160ms ease, border-color 160ms ease;
        }
        :global(#leadgen-legend-toggle:hover) {
          background: var(--lg-bg-strong);
          color: var(--lg-ink);
          border-color: var(--lg-line-strong);
        }
        :global(#leadgen-legend-toggle.is-open) {
          background: var(--lg-ink);
          color: #fff;
          border-color: var(--lg-ink);
        }
        :global(.leadgen-legend-chev) {
          transition: transform 200ms ease;
        }
        :global(#leadgen-legend-toggle.is-open .leadgen-legend-chev) {
          transform: rotate(180deg);
        }
        #leadgen-legend-detail {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px dashed var(--lg-line);
          animation: leadgen-fade 220ms ease-out;
        }
        @keyframes leadgen-fade {
          from { opacity: 0; transform: translateY(-2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        #leadgen-legend-formula {
          margin: 0 0 12px 0;
          font-size: 12px;
          line-height: 1.55;
          color: var(--lg-muted);
        }
        #leadgen-legend-formula strong { color: var(--lg-ink); }
        .leadgen-legend-formula-bit { white-space: nowrap; }
        #leadgen-legend-signals {
          list-style: none;
          margin: 0 0 12px 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .leadgen-legend-signal {
          padding: 10px 12px;
          background: var(--lg-bg-strong);
          border: 1px solid var(--lg-line);
          border-radius: 10px;
        }
        .leadgen-legend-signal-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 4px;
        }
        .leadgen-legend-signal-label {
          font-size: 12px;
          font-weight: 500;
          color: var(--lg-ink);
        }
        .leadgen-legend-signal-weight {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-faint);
        }
        .leadgen-legend-signal-blurb {
          margin: 0 0 6px 0;
          font-size: 11px;
          color: var(--lg-muted);
          line-height: 1.45;
        }
        .leadgen-legend-signal-line {
          margin: 0;
          padding: 4px 0;
          font-size: 11px;
          color: var(--lg-muted);
          line-height: 1.5;
          border-top: 1px dotted var(--lg-line);
        }
        .leadgen-legend-signal-tag {
          display: inline-block;
          font-family: var(--lg-mono);
          font-size: 8.5px;
          letter-spacing: 0.16em;
          padding: 1px 6px;
          border-radius: 999px;
          margin-right: 6px;
          vertical-align: 1px;
        }
        .leadgen-legend-signal-tag--ok {
          background: rgba(22, 101, 52, 0.10);
          color: #166534;
        }
        .leadgen-legend-signal-tag--todo {
          background: rgba(255, 59, 48, 0.08);
          color: var(--lg-signal);
        }
        #leadgen-legend-foot {
          margin: 0;
          padding: 10px 12px;
          font-size: 11.5px;
          line-height: 1.55;
          color: var(--lg-muted);
          background: rgba(255, 59, 48, 0.04);
          border: 1px solid rgba(255, 59, 48, 0.18);
          border-radius: 10px;
        }
        #leadgen-legend-foot strong { color: var(--lg-ink); }
        #leadgen-legend-foot code {
          font-family: var(--lg-mono);
          font-size: 10.5px;
          background: #fff;
          padding: 1px 5px;
          border-radius: 4px;
          border: 1px solid var(--lg-line);
        }

        /* ── Score sparkline (in row, collapsed) ─────────────────────── */
        .leadgen-col-score {
          flex-direction: row !important;
          align-items: center;
          gap: 10px;
        }
        .leadgen-score-spark {
          display: inline-flex;
          gap: 2px;
          height: 18px;
          align-items: flex-end;
        }
        .leadgen-score-spark-cell {
          width: 6px;
          height: 100%;
          background: rgba(0, 0, 0, 0.06);
          border-radius: 1px;
          position: relative;
          overflow: hidden;
        }
        .leadgen-score-spark-fill {
          position: absolute;
          left: 0; right: 0; bottom: 0;
          background: var(--lg-ink);
          border-radius: 1px;
          transition: height 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .leadgen-row-wrap.is-open .leadgen-score-spark-fill {
          background: var(--lg-signal);
        }

        /* ── Row wrap + details ──────────────────────────────────────── */
        .leadgen-row-wrap { border-bottom: 1px solid var(--lg-line); }
        .leadgen-row-wrap:last-child { border-bottom: none; }
        .leadgen-row-wrap .leadgen-row { border-bottom: none; cursor: pointer; }
        .leadgen-row-wrap.is-open .leadgen-row { background: rgba(255, 59, 48, 0.04); }
        :global(.leadgen-row-chev) {
          color: var(--lg-faint);
          margin-left: 6px;
          transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .leadgen-row-wrap.is-open :global(.leadgen-row-chev) {
          transform: rotate(180deg);
          color: var(--lg-signal);
        }
        .leadgen-row-details {
          padding: 14px 18px 18px;
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 18px;
          background:
            linear-gradient(rgba(255,255,255,0.6), rgba(255,255,255,0.6)),
            radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0) 0 0/12px 12px;
          border-top: 1px dashed var(--lg-line);
          animation: leadgen-fade 240ms ease-out;
        }

        /* ── Signal bars ─────────────────────────────────────────────── */
        .leadgen-row-details-bars { display: flex; flex-direction: column; gap: 12px; }
        .leadgen-row-bar { display: flex; flex-direction: column; gap: 5px; }
        .leadgen-row-bar-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .leadgen-row-bar-label {
          font-size: 12px;
          color: var(--lg-ink);
          font-weight: 500;
          flex: 1;
        }
        .leadgen-row-bar-weight {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-faint);
        }
        .leadgen-row-bar-val {
          font-family: var(--lg-mono);
          font-size: 13px;
          font-variant-numeric: tabular-nums;
          color: var(--lg-ink);
          min-width: 26px;
          text-align: right;
        }
        .leadgen-row-bar-track {
          height: 6px;
          background: rgba(0, 0, 0, 0.06);
          border-radius: 3px;
          overflow: hidden;
        }
        .leadgen-row-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--lg-ink), var(--lg-signal));
          border-radius: 3px;
          transition: width 460ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .leadgen-row-bar-blurb {
          font-size: 10.5px;
          color: var(--lg-muted);
          line-height: 1.45;
        }
        .leadgen-row-bar-inputs {
          list-style: none;
          margin: 6px 0 0;
          padding: 6px 0 2px;
          border-top: 1px dashed var(--lg-line);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .leadgen-row-input {
          display: grid;
          grid-template-columns: 14px 1fr auto auto;
          gap: 8px;
          align-items: baseline;
          font-size: 11px;
          line-height: 1.35;
        }
        .leadgen-row-input-mark {
          font-family: var(--lg-mono);
          font-size: 11px;
          text-align: center;
          font-weight: 600;
        }
        .leadgen-row-input-label { color: var(--lg-ink); }
        .leadgen-row-input-detail {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-muted);
          padding: 1px 6px;
          background: rgba(0, 0, 0, 0.04);
          border-radius: 4px;
          max-width: 180px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          justify-self: end;
        }
        .leadgen-row-input-pts {
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.04em;
          color: var(--lg-faint);
          min-width: 46px;
          text-align: right;
        }
        .leadgen-row-input--hit .leadgen-row-input-mark  { color: #166534; }
        .leadgen-row-input--hit .leadgen-row-input-pts   { color: #166534; }
        .leadgen-row-input--miss .leadgen-row-input-mark { color: var(--lg-faint); }
        .leadgen-row-input--miss .leadgen-row-input-label{ color: var(--lg-muted); }
        .leadgen-row-input--planned .leadgen-row-input-mark  { color: var(--lg-signal); }
        .leadgen-row-input--planned .leadgen-row-input-label { color: var(--lg-muted); }
        .leadgen-row-input--planned .leadgen-row-input-pts   {
          color: var(--lg-signal);
          background: rgba(255, 59, 48, 0.08);
          padding: 1px 6px;
          border-radius: 4px;
          min-width: auto;
        }
        .leadgen-row-input--na .leadgen-row-input-mark  { color: var(--lg-faint); }
        .leadgen-row-input--na .leadgen-row-input-label { color: var(--lg-faint); font-style: italic; }

        /* ── Side panel: recommendation, deficiencies, meta ──────────── */
        .leadgen-row-details-side { display: flex; flex-direction: column; gap: 12px; }
        .leadgen-row-geo {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 7px 10px;
          background: rgba(255, 59, 48, 0.05);
          border: 1px solid rgba(255, 59, 48, 0.18);
          border-radius: 10px;
          flex-wrap: wrap;
        }
        .leadgen-row-geo-key {
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.18em;
          color: var(--lg-signal);
        }
        .leadgen-row-geo-val {
          font-size: 12px;
          color: var(--lg-ink);
          font-weight: 500;
        }
        .leadgen-row-geo-boost {
          font-family: var(--lg-mono);
          color: var(--lg-signal);
        }
        .leadgen-row-geo-math {
          margin-left: auto;
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-muted);
        }
        .leadgen-row-rec {
          padding: 9px 11px;
          background: var(--lg-bg-strong);
          border: 1px solid var(--lg-line);
          border-radius: 10px;
        }
        .leadgen-row-rec-label {
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.18em;
          color: var(--lg-faint);
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .leadgen-row-rec-text {
          font-size: 12px;
          color: var(--lg-ink);
          line-height: 1.5;
        }
        .leadgen-row-defs {
          padding: 9px 11px;
          background: var(--lg-bg-strong);
          border: 1px solid var(--lg-line);
          border-radius: 10px;
        }
        .leadgen-row-defs-label {
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.18em;
          color: var(--lg-faint);
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .leadgen-row-defs-list {
          margin: 0;
          padding-left: 18px;
          font-size: 11.5px;
          color: var(--lg-muted);
          line-height: 1.55;
        }
        .leadgen-row-defs-list li::marker { color: var(--lg-signal); }
        .leadgen-row-meta {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .leadgen-row-meta-cell {
          display: flex;
          flex-direction: column;
          padding: 6px 8px;
          background: var(--lg-bg-strong);
          border: 1px solid var(--lg-line);
          border-radius: 8px;
          gap: 1px;
        }
        .leadgen-row-meta-key {
          font-family: var(--lg-mono);
          font-size: 8.5px;
          letter-spacing: 0.16em;
          color: var(--lg-faint);
        }
        .leadgen-row-meta-val {
          font-family: var(--lg-mono);
          font-size: 11px;
          color: var(--lg-ink);
        }
        .leadgen-score-num {
          font-family: var(--lg-mono);
          font-variant-numeric: tabular-nums;
          font-weight: 500;
          font-size: 14px;
        }
        .leadgen-tier {
          display: inline-block;
          font-family: var(--lg-mono);
          font-size: 9.5px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--lg-line);
        }
        .leadgen-tier--hot  { color: var(--lg-signal); border-color: var(--lg-signal); }
        .leadgen-tier--warm { color: #c2410c; border-color: rgba(194, 65, 12, 0.3); }
        .leadgen-tier--cool { color: #1d4ed8; border-color: rgba(29, 78, 216, 0.3); }
        .leadgen-tier--cold { color: var(--lg-muted); }
        .leadgen-col-action { color: var(--lg-faint); justify-self: end; }

        /* ── Empty state ─────────────────────────────────────────────── */
        #leadgen-prospect-table-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 56px 24px;
          color: var(--lg-muted);
          text-align: center;
          background:
            radial-gradient(circle at 1px 1px, rgba(0,0,0,0.05) 1px, transparent 0) 0 0/12px 12px;
        }
        #leadgen-prospect-table-empty :global(svg) {
          color: var(--lg-faint);
          margin-bottom: 4px;
        }
        #leadgen-prospect-table-empty h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 500;
          color: var(--lg-ink);
          letter-spacing: -0.005em;
        }
        #leadgen-prospect-table-empty p {
          margin: 0;
          max-width: 460px;
          font-size: 12px;
          line-height: 1.55;
        }
        #leadgen-prospect-table-empty :global(.leadgen-btn) { margin-top: 10px; }

        /* ── Campaigns ───────────────────────────────────────────────── */
        #leadgen-campaigns-panel {
          background: var(--lg-bg);
          border: 1px solid var(--lg-line);
          border-radius: 14px;
          padding: 14px 16px 16px;
        }
        #leadgen-campaigns-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        #leadgen-campaigns-head h3 {
          margin: 0;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--lg-muted);
        }
        #leadgen-campaigns-empty {
          font-size: 12px;
          line-height: 1.55;
          color: var(--lg-muted);
          padding: 14px 0 4px;
          border-top: 1px dashed var(--lg-line);
        }
        #leadgen-campaigns-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .leadgen-campaign-item {
          display: grid;
          grid-template-columns: 14px 2fr 2.4fr 0.8fr auto;
          gap: 10px;
          align-items: center;
          padding: 8px 10px;
          font-size: 12px;
          border-radius: 8px;
          background: var(--lg-bg-strong);
        }
        .leadgen-campaign-meta {
          color: var(--lg-muted);
          display: inline-flex;
          gap: 6px;
          align-items: baseline;
        }
        .leadgen-campaign-meta-sep { color: var(--lg-faint); }
        .leadgen-campaign-meta-faint {
          color: var(--lg-faint);
          font-family: var(--lg-mono);
          font-size: 10.5px;
        }
        :global(.leadgen-campaign-run) {
          padding: 5px 10px !important;
          font-size: 11px !important;
        }
        :global(.leadgen-spin) { animation: leadgen-spin 0.9s linear infinite; }
        @keyframes leadgen-spin { to { transform: rotate(360deg); } }

        /* ── Module launcher table ───────────────────────────────────── */
        .leadgen-module-table {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--lg-line);
          border-radius: 10px;
          overflow: hidden;
        }
        .leadgen-module-table-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px 5px;
          border-bottom: 1px solid var(--lg-line);
          background: var(--lg-bg-strong);
        }
        .leadgen-module-table-title {
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--lg-muted);
        }
        .leadgen-module-run-all-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: none;
          border: 1px solid var(--lg-line-strong);
          border-radius: 4px;
          padding: 2px 7px;
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.06em;
          color: var(--lg-ink);
          cursor: pointer;
          transition: background 0.15s;
        }
        .leadgen-module-run-all-btn:hover { background: var(--lg-bg); }
        .leadgen-module-run-all-btn:disabled { opacity: 0.45; cursor: default; }
        .leadgen-module-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-bottom: 1px solid var(--lg-line);
          transition: background 0.12s;
        }
        .leadgen-module-row:last-child { border-bottom: none; }
        .leadgen-module-row:hover { background: var(--lg-bg); }
        .leadgen-module-row-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          transition: background 0.3s;
        }
        :global(.leadgen-module-row-icon) { color: var(--lg-muted); flex-shrink: 0; }
        .leadgen-module-row-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
          flex: 1;
          min-width: 0;
        }
        .leadgen-module-row-label {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-ink);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .leadgen-module-row-desc {
          font-family: var(--lg-mono);
          font-size: 9px;
          color: var(--lg-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .leadgen-module-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
          background: var(--lg-ink);
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 3px 8px;
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s;
          white-space: nowrap;
        }
        .leadgen-module-action-btn:hover { background: #000; }
        .leadgen-module-action-btn:disabled { opacity: 0.35; cursor: default; }
        .leadgen-module-action-btn--rerun {
          background: transparent;
          color: var(--lg-ink);
          border: 1px solid var(--lg-line-strong);
        }
        .leadgen-module-action-btn--rerun:hover { background: var(--lg-bg); }

        /* ── Onboard intelligence ────────────────────────────────────── */
        .leadgen-onboard-btn { width: 100%; justify-content: center; margin-top: 4px; }
        .leadgen-onboard-results {
          display: flex;
          flex-direction: column;
          gap: 0;
          border: 1px solid var(--lg-line);
          border-radius: 10px;
          overflow: hidden;
          margin-top: 4px;
        }
        .leadgen-onboard-results-title {
          font-family: var(--lg-mono);
          font-size: 10px;
          letter-spacing: 0.06em;
          color: var(--lg-muted);
          text-transform: uppercase;
          padding: 8px 12px 6px;
          border-bottom: 1px solid var(--lg-line);
          margin: 0;
        }
        .leadgen-onboard-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
        }
        .leadgen-onboard-module {
          padding: 10px 12px;
          border-bottom: 1px solid var(--lg-line);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .leadgen-onboard-module:nth-child(odd) { border-right: 1px solid var(--lg-line); }
        .leadgen-onboard-module:nth-last-child(-n+2) { border-bottom: none; }
        .leadgen-onboard-module-head {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .leadgen-onboard-status {
          display: inline-block;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
          background: #666;
        }
        .leadgen-onboard-status--succeeded { background: #0cce6b; }
        .leadgen-onboard-status--failed    { background: #ff4e42; }
        .leadgen-onboard-status--pending   { background: #666; }
        .leadgen-onboard-module-label {
          font-family: var(--lg-mono);
          font-size: 10px;
          letter-spacing: 0.04em;
          color: var(--lg-ink);
          text-transform: uppercase;
        }
        .leadgen-onboard-na {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-muted);
        }
        .leadgen-onboard-screenshots { display: flex; flex-direction: column; gap: 6px; }
        .leadgen-onboard-mockup-img {
          width: 100%;
          border-radius: 6px;
          display: block;
          border: 1px solid var(--lg-line);
        }
        .leadgen-onboard-screenshot-thumbs { display: flex; gap: 4px; }
        .leadgen-onboard-thumb {
          width: 33%;
          border-radius: 4px;
          border: 1px solid var(--lg-line);
          display: block;
        }
        .leadgen-onboard-psi {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 6px;
        }
        .leadgen-onboard-psi-metric {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .leadgen-onboard-psi-val {
          font-family: var(--lg-mono);
          font-size: 18px;
          font-weight: 600;
          line-height: 1;
        }
        .leadgen-onboard-psi-label {
          font-family: var(--lg-mono);
          font-size: 9px;
          letter-spacing: 0.04em;
          color: var(--lg-muted);
          text-transform: uppercase;
        }
        .leadgen-onboard-agent { display: flex; flex-direction: column; gap: 4px; }
        .leadgen-onboard-agent-score { display: flex; align-items: baseline; gap: 2px; }
        .leadgen-onboard-agent-score-val {
          font-family: var(--lg-mono);
          font-size: 24px;
          font-weight: 700;
          line-height: 1;
          color: var(--lg-ink);
        }
        .leadgen-onboard-agent-score-label {
          font-family: var(--lg-mono);
          font-size: 11px;
          color: var(--lg-muted);
        }
        .leadgen-onboard-agent-verdict {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .leadgen-onboard-agent-findings {
          margin: 2px 0 0;
          padding: 0 0 0 12px;
          font-size: 10px;
          color: var(--lg-muted);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .leadgen-onboard-agent-findings li { padding: 0; }
        .leadgen-onboard-social { display: flex; flex-direction: column; gap: 6px; }
        .leadgen-onboard-og-img {
          width: 100%;
          border-radius: 6px;
          border: 1px solid var(--lg-line);
          display: block;
        }
        .leadgen-onboard-social-missing {
          font-family: var(--lg-mono);
          font-size: 10px;
          color: var(--lg-muted);
        }
        .leadgen-onboard-social-meta { display: flex; flex-direction: column; gap: 4px; }
        .leadgen-onboard-social-meta-row {
          display: flex;
          gap: 6px;
          font-family: var(--lg-mono);
          font-size: 10px;
          line-height: 1.4;
        }
        .leadgen-onboard-social-key {
          color: var(--lg-muted);
          min-width: 72px;
          flex-shrink: 0;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .leadgen-onboard-social-val {
          color: var(--lg-ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #leadgen-campaign-notice {
          font-size: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          margin-bottom: 8px;
        }
        .leadgen-campaign-notice--ok {
          color: #166534;
          background: rgba(22, 101, 52, 0.06);
          border: 1px solid rgba(22, 101, 52, 0.18);
        }
        .leadgen-campaign-notice--err {
          color: var(--lg-signal);
          background: rgba(255, 59, 48, 0.06);
          border: 1px solid rgba(255, 59, 48, 0.22);
        }
        .leadgen-campaign-status {
          width: 8px; height: 8px;
          border-radius: 50%;
          justify-self: center;
        }
        .leadgen-campaign-status--on  { background: #16a34a; }
        .leadgen-campaign-status--off { background: var(--lg-faint); }
        .leadgen-campaign-id {
          font-family: var(--lg-mono);
          font-size: 11px;
          color: var(--lg-ink);
        }
        .leadgen-campaign-count {
          font-family: var(--lg-mono);
          font-variant-numeric: tabular-nums;
          font-size: 11px;
          color: var(--lg-muted);
          text-align: right;
        }

        /* ── Site Generation ─────────────────────────────────────────── */
        .leadgen-generation {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid var(--lg-line);
        }
        .leadgen-generation-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .leadgen-generation-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--lg-muted);
        }
        .leadgen-generation-steps {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 10px;
        }
        .leadgen-gen-step {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .leadgen-gen-step-dot {
          flex-shrink: 0;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--lg-line);
          border: 1.5px solid var(--lg-muted);
        }
        .leadgen-gen-step-dot--done {
          background: #0cce6b;
          border-color: #0cce6b;
        }
        .leadgen-gen-step-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .leadgen-gen-step-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--lg-text);
        }
        .leadgen-gen-step-desc {
          font-size: 10px;
          color: var(--lg-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .leadgen-brief-view-link {
          display: inline-block;
          margin-top: 3px;
          background: none;
          border: none;
          padding: 0;
          font-size: 10px;
          font-weight: 500;
          color: #7c3aed;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
          text-decoration-color: rgba(124, 58, 237, 0.4);
        }
        .leadgen-brief-view-link:hover { text-decoration-color: #7c3aed; }
        .leadgen-gen-toggles {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 10px;
          margin-top: 6px;
        }
        .leadgen-gen-toggle {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: var(--lg-muted);
          cursor: pointer;
          user-select: none;
          line-height: 1;
        }
        .leadgen-gen-toggle input[type="checkbox"] {
          width: 12px;
          height: 12px;
          margin: 0;
          accent-color: #7c3aed;
          cursor: pointer;
        }
        .leadgen-gen-step--locked {
          opacity: 0.45;
          pointer-events: none;
        }
        .leadgen-gen-step--locked .leadgen-btn--generate {
          cursor: not-allowed;
        }
        .leadgen-btn--generate {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 600;
          color: #fff;
          background: #7c3aed;
          border: none;
          border-radius: 5px;
          cursor: pointer;
          white-space: nowrap;
        }
        .leadgen-btn--generate:hover { background: #6d28d9; }
        .leadgen-generation-busy {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--lg-muted);
        }
        .leadgen-generation-hint {
          font-size: 11px;
          color: var(--lg-muted);
          line-height: 1.5;
          margin: 0;
        }
        .leadgen-mockup-preview {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 12px;
        }
        .leadgen-mockup-label {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--lg-muted);
        }
        .leadgen-mockup-img {
          width: 100%;
          border-radius: 6px;
          border: 1px solid var(--lg-line);
          display: block;
          cursor: zoom-in;
        }
        .leadgen-generation-result {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .leadgen-preview-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 600;
          color: #7c3aed;
          text-decoration: none;
        }
        .leadgen-preview-link:hover { text-decoration: underline; }
        .leadgen-comparison {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .leadgen-comparison-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .leadgen-comparison-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }
        .leadgen-comparison-sublabel {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--lg-muted);
        }
        .leadgen-comparison-score {
          font-family: var(--lg-mono);
          font-size: 20px;
          font-weight: 700;
          line-height: 1;
        }
        .leadgen-comparison-score--before { color: #ff4e42; }
        .leadgen-comparison-score--after  { color: #0cce6b; }
        .leadgen-comparison-arrow {
          font-size: 14px;
          color: var(--lg-muted);
          padding-top: 10px;
        }
        .leadgen-comparison-delta {
          font-family: var(--lg-mono);
          font-size: 13px;
          font-weight: 700;
          color: #0cce6b;
          padding-top: 10px;
        }
        .leadgen-comparison-caption {
          font-size: 10px;
          color: var(--lg-muted);
        }

        /* ── Mobile ──────────────────────────────────────────────────── */
        @media (max-width: 720px) {
          #leadgen-dashboard { padding: 16px 14px 20px; }
          #leadgen-header { flex-direction: column; align-items: flex-start; gap: 10px; }
          #leadgen-stats-bar { grid-template-columns: repeat(2, 1fr); }
          .leadgen-stats-cell { border-right: 1px solid var(--lg-line); border-bottom: 1px solid var(--lg-line); }
          .leadgen-stats-cell:nth-child(2n) { border-right: none; }
          #leadgen-filters-row { flex-direction: column; align-items: flex-start; }
          #leadgen-prospect-table-head { display: none; }
          .leadgen-row {
            grid-template-columns: 1fr 1fr;
            grid-template-areas:
              'name name'
              'vert score'
              'stage tier'
              'loc action';
            row-gap: 6px;
          }
          .leadgen-col-name     { grid-area: name; }
          .leadgen-col-vertical { grid-area: vert; }
          .leadgen-col-score    { grid-area: score; align-items: flex-end; }
          .leadgen-col-tier     { grid-area: tier; align-items: flex-end; }
          .leadgen-col-stage    { grid-area: stage; }
          .leadgen-col-loc      { grid-area: loc; }
          .leadgen-col-action   { grid-area: action; }

          #leadgen-legend-signals { grid-template-columns: 1fr; }
          .leadgen-row-details {
            grid-template-columns: 1fr;
            padding: 12px 14px 14px;
            gap: 14px;
          }
          .leadgen-row-meta { grid-template-columns: repeat(2, 1fr); }
          .leadgen-col-score { flex-direction: row !important; gap: 8px; }
          .leadgen-onboard-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
