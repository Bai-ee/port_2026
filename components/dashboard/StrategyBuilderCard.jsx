'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import InputsPane from './strategy-builder/InputsPane.jsx';
import CalendarPane from './strategy-builder/CalendarPane.jsx';
import PushPane from './strategy-builder/PushPane.jsx';
import { normalizeVertical } from '../../features/strategy-builder/normalize-vertical.js';

const TABS = [
  { id: 'inputs', label: 'INPUTS' },
  { id: 'calendar', label: 'CALENDAR' },
  { id: 'push', label: 'PUSH' },
];

function makeDefaultConfig(bootstrap) {
  const saved = bootstrap?.dashboardState?.strategyBuilder?.config || {};
  return {
    // Source of truth order: per-strategy saved override → Market Category card
    // (user-set or auto-detected industry) → lead-gen profile vertical.
    vertical: normalizeVertical(
      saved.vertical ||
        bootstrap?.dashboardState?.marketCategory?.value ||
        bootstrap?.dashboardState?.snapshot?.brandOverview?.industry ||
        bootstrap?.dashboardState?.leadgen?.vertical ||
        ''
    ),
    signals: {
      weather: { enabled: Boolean(saved.signals?.weather?.enabled) },
      events: { enabled: Boolean(saved.signals?.events?.enabled) },
      holidays: { enabled: saved.signals?.holidays?.enabled !== false },
    },
    sources: saved.sources && typeof saved.sources === 'object' ? saved.sources : {},
    campaign: {
      objective: saved.campaign?.objective || '',
      ctaText: saved.campaign?.ctaText || '',
      ctaUrl: saved.campaign?.ctaUrl || '',
      postTime: saved.campaign?.postTime || '',
      postTime2: saved.campaign?.postTime2 || '',
      guardrails: saved.campaign?.guardrails || '',
      emojiPolicy: saved.campaign?.emojiPolicy || 'none',
      maxHashtags: Number.isFinite(saved.campaign?.maxHashtags) ? saved.campaign.maxHashtags : 2,
      promotions: Array.isArray(saved.campaign?.promotions) ? saved.campaign.promotions : [],
    },
    editorial: saved.editorial && typeof saved.editorial === 'object' ? saved.editorial : { enabled: true, campaigns: [] },
    events: bootstrap?.dashboardState?.strategyBuilder?.events || [],
    postsPerDay: saved.postsPerDay || 1,
    days: saved.days || 30,
    baselineMixPct: saved.baselineMixPct || 40,
    rampAggressiveness: saved.rampAggressiveness ?? 0.5,
  };
}

/**
 * @param {{ bootstrap: Object, getIdToken: Function, onOpenCard?: Function, onOpenSocialPosting?: Function }} props
 */
export default function StrategyBuilderCard({ bootstrap, getIdToken, onOpenCard, onOpenSocialPosting }) {
  const [config, setConfig] = useState(() => makeDefaultConfig(bootstrap));
  const [plan, setPlan] = useState(() => bootstrap?.dashboardState?.strategyBuilder?.lastPlan || null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [activePane, setActivePane] = useState(
    () => bootstrap?.dashboardState?.strategyBuilder?.lastPlan ? 'calendar' : 'inputs'
  );

  const configSaveTimer = useRef(null);

  // Debounced config save
  useEffect(() => {
    if (configSaveTimer.current) clearTimeout(configSaveTimer.current);
    configSaveTimer.current = setTimeout(async () => {
      try {
        const token = await getIdToken();
        await fetch('/api/dashboard/strategy-builder/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ config }),
        });
      } catch {
        // non-critical — swallow config save errors silently
      }
    }, 300);
    return () => clearTimeout(configSaveTimer.current);
  }, [config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Centralized push — CalendarPane and PushPane both call this with their item set.
  const handlePush = useCallback(async (items) => {
    if (!plan || !items?.length) return { scheduled: 0, failed: [] };
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/strategy-builder/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: { ...plan, items } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return { scheduled: data.scheduled || 0, failed: data.failed || [] };
    } catch (err) {
      return { scheduled: 0, failed: [{ id: 'request', reason: err.message }] };
    }
  }, [plan, getIdToken]);

  const handleGenerate = useCallback(async () => {
    setNotice(null);
    setBusy(true);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/strategy-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setPlan(data.plan);
      setActivePane('calendar');
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Generation failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  }, [config, getIdToken]);

  return (
    <div
      id="strategy-builder-card-shell"
      className="dashboard-modal-pilot"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 400 }}
    >
      {/* Tab bar — design-system tabs */}
      <div id="strategy-builder-tab-bar" className="tile-detail-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tile-detail-tab${activePane === tab.id ? ' tile-detail-tab--active' : ''}`}
            onClick={() => setActivePane(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error banner — established error style */}
      {notice?.kind === 'error' && (
        <div
          id="strategy-builder-error-banner"
          className="brand-snapshot-error"
          style={{ margin: '12px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <span>{notice.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}
          >
            ×
          </button>
        </div>
      )}

      {/* Pane content */}
      <div
        id="strategy-builder-pane-content"
        className="dashboard-modal-pilot-content"
        style={{ flex: 1, overflowY: 'auto', padding: '0 2px', position: 'relative' }}
      >
        {/* Loading overlay */}
        {busy && (
          <div
            id="strategy-builder-loading-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              background: 'color-mix(in srgb, var(--page) 72%, transparent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div className="sb-spinner" style={{ width: 28, height: 28, borderWidth: 3, margin: '0 auto 10px' }} />
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Building today → week strategy…
              </div>
            </div>
          </div>
        )}

        {activePane === 'inputs' && (
          <InputsPane
            bootstrap={bootstrap}
            config={config}
            onConfigChange={setConfig}
            onGenerate={handleGenerate}
            onOpenCard={onOpenCard}
            busy={busy}
          />
        )}

        {activePane === 'calendar' && (
          <CalendarPane
            plan={plan}
            config={config}
            getIdToken={getIdToken}
            onPlanChange={setPlan}
            onRequestGenerate={() => setActivePane('inputs')}
            onPush={handlePush}
            onOpenSocialPosting={onOpenSocialPosting}
          />
        )}

        {activePane === 'push' && (
          <PushPane
            plan={plan}
            getIdToken={getIdToken}
            onPush={handlePush}
            onOpenSocialPosting={onOpenSocialPosting}
          />
        )}
      </div>
    </div>
  );
}
