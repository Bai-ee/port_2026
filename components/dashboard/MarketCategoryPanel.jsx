'use client';

import React, { useState } from 'react';
import { CANONICAL_VERTICALS } from '../../features/strategy-builder/normalize-vertical.js';

/**
 * Market Category card panel — shows the auto-detected category and lets the
 * user override it. The saved value feeds the Strategy Builder vertical.
 *
 * @param {{ bootstrap: Object, getIdToken: Function, onSaved: Function }} props
 */
export default function MarketCategoryPanel({ bootstrap, getIdToken, onSaved }) {
  const ds = bootstrap?.dashboardState || {};
  const detected = ds?.snapshot?.brandOverview?.industry || '';
  const override = ds?.marketCategory?.value || '';
  const overrideSource = ds?.marketCategory?.source || null;
  const effective = override || detected;

  // Treat the value literally — the agent writes a specific term (e.g. "poker")
  // and we must not collapse it into a broad list bucket here.
  const startsCustom = !!effective && !CANONICAL_VERTICALS.includes(effective);

  const [mode, setMode] = useState(startsCustom ? 'custom' : 'list');
  const [selected, setSelected] = useState(
    startsCustom ? '' : effective || ''
  );
  const [customText, setCustomText] = useState(startsCustom ? effective : '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  // Live overlay so the status table updates after a RUN/save without remount.
  const [liveValue, setLiveValue] = useState('');
  const [liveSource, setLiveSource] = useState('');
  const [running, setRunning] = useState(false);
  const [agentInfo, setAgentInfo] = useState(
    ds?.marketCategory?.source === 'agent'
      ? {
          confidence: ds.marketCategory.confidence,
          rationale: ds.marketCategory.rationale,
          evidence: ds.marketCategory.evidence || [],
          knowledgeBaseSources: ds.marketCategory.knowledgeBaseSources || [],
        }
      : null
  );

  const effectiveDisplay = liveValue || effective;
  const sourceDisplay =
    liveSource ||
    (overrideSource === 'agent' ? 'Agent-classified' : override ? 'User-set' : 'Auto-detected');

  function syncEditorTo(value) {
    if (value && CANONICAL_VERTICALS.includes(value)) {
      setMode('list');
      setSelected(value);
    } else {
      setMode('custom');
      setCustomText(value);
    }
  }

  async function runAnalysis() {
    setRunning(true);
    setNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/market-category/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

      if (!data.enough) {
        setAgentInfo(null);
        setNotice({
          kind: 'error',
          text: data.message || 'Not enough data — select the category manually below.',
        });
        return;
      }

      const mc = data.marketCategory || {};
      setLiveValue(mc.value || '');
      setLiveSource('Agent-classified');
      setAgentInfo({
        confidence: mc.confidence,
        rationale: mc.rationale,
        evidence: mc.evidence || [],
        knowledgeBaseSources: mc.knowledgeBaseSources || [],
      });
      syncEditorTo(mc.value || '');
      setNotice({
        kind: 'ok',
        text: `Classified as "${mc.value}". Confirm or adjust below — this feeds the Strategy Builder.`,
      });
      if (typeof onSaved === 'function') onSaved(mc);
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Analysis failed.' });
    } finally {
      setRunning(false);
    }
  }

  const pendingValue = mode === 'custom' ? customText.trim() : selected.trim();
  const dirty = pendingValue && pendingValue !== effectiveDisplay;

  async function save() {
    if (!pendingValue) return;
    setBusy(true);
    setNotice(null);
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/market-category/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value: pendingValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setLiveValue(pendingValue);
      setLiveSource('User-set');
      setAgentInfo(null);
      setNotice({ kind: 'ok', text: 'Saved. This now feeds the Strategy Builder.' });
      if (typeof onSaved === 'function') onSaved(data.marketCategory || { value: pendingValue });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Save failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="market-category-panel" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* RUN — agent classifies the category from pipeline data */}
      <div id="market-category-run" className="sb-section">
        <span className="sb-label">Auto-classify</span>
        <span className="sb-hint">
          Runs an agent over your pipeline data — Social Preview / Open Graph,
          Brand Snapshot, Scout Brief, site meta — to determine the market
          category. If there isn't enough data yet, set it manually below.
        </span>
        <button
          type="button"
          id="market-category-run-btn"
          onClick={runAnalysis}
          disabled={running}
          className="sb-cta"
          style={{ marginTop: 6 }}
        >
          {running ? (<><span className="sb-spinner" />Analyzing…</>) : 'Run analysis'}
        </button>

        {agentInfo && (agentInfo.rationale || (agentInfo.evidence || []).length) ? (
          <div style={{ marginTop: 4 }}>
            {Number.isFinite(agentInfo.confidence) && (
              <div className="tile-detail-stat-row">
                <span className="tile-detail-stat-label">Confidence</span>
                <span className="tile-detail-stat-value">{Math.round(agentInfo.confidence * 100)}%</span>
              </div>
            )}
            {agentInfo.rationale && (
              <div className="tile-detail-stat-row">
                <span className="tile-detail-stat-label">Why</span>
                <span className="tile-detail-stat-value">{agentInfo.rationale}</span>
              </div>
            )}
            {(agentInfo.evidence || []).length > 0 && (
              <div className="tile-detail-stat-row">
                <span className="tile-detail-stat-label">Evidence</span>
                <span className="tile-detail-stat-value">{agentInfo.evidence.join(' · ')}</span>
              </div>
            )}
            {(agentInfo.knowledgeBaseSources || []).length > 0 && (
              <div className="tile-detail-stat-row">
                <span className="tile-detail-stat-label">Knowledge Base</span>
                <span className="tile-detail-stat-value">
                  {agentInfo.knowledgeBaseSources
                    .slice(0, 3)
                    .map((source) => source?.sectionTitle ? `${source.title || 'Knowledge item'} / ${source.sectionTitle}` : (source?.title || source?.sourceUrl || 'Knowledge item'))
                    .join(' · ')}
                </span>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Status — design-system stat table */}
      <div id="market-category-detected" className="sb-section">
        <span className="sb-label">Category</span>
        <div style={{ marginTop: 4 }}>
          <div className="tile-detail-stat-row">
            <span className="tile-detail-stat-label">Auto-detected</span>
            <span className="tile-detail-stat-value">{detected || 'Not yet classified'}</span>
          </div>
          <div className="tile-detail-stat-row">
            <span className="tile-detail-stat-label">In use</span>
            <span className="tile-detail-stat-value">{effectiveDisplay || '—'}</span>
          </div>
          <div className="tile-detail-stat-row">
            <span className="tile-detail-stat-label">Source</span>
            <span className="tile-detail-stat-value">{sourceDisplay}</span>
          </div>
        </div>
        <span className="sb-hint">
          Detected from your pipeline. A user-set value overrides it and drives
          competitor benchmarking and the Strategy Builder.
        </span>
      </div>

      {/* Editor */}
      <div id="market-category-editor" className="sb-section">
        <span className="sb-label">Set / change category</span>

        <div className="sb-seg" style={{ marginTop: 4 }}>
          <button
            type="button"
            onClick={() => setMode('list')}
            className={`sb-seg-btn${mode === 'list' ? ' is-active' : ''}`}
          >
            From list
          </button>
          <button
            type="button"
            onClick={() => setMode('custom')}
            className={`sb-seg-btn${mode === 'custom' ? ' is-active' : ''}`}
          >
            Custom
          </button>
        </div>

        {mode === 'list' ? (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="sb-select"
          >
            <option value="">— select category —</option>
            {CANONICAL_VERTICALS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="e.g. gambling, e-games, boutique-winery"
            maxLength={100}
            className="sb-input"
          />
        )}

        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="sb-cta"
          style={{ marginTop: 4 }}
        >
          {busy ? (<><span className="sb-spinner" />Saving…</>) : 'Save category'}
        </button>

        {notice && (
          <div className={`sb-notice ${notice.kind === 'error' ? 'sb-notice--error' : 'sb-notice--ok'}`}>
            {notice.text}
          </div>
        )}

        <span className="sb-hint">
          This category pre-fills the Strategy Builder vertical (where it can be
          overridden per strategy).
        </span>
      </div>
    </div>
  );
}
