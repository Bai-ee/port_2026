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
    <div id="market-category-panel" className="mu-tab-pane" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* RUN */}
      <div id="market-category-run" className="mu-section">
        <div className="mu-section-head">
          <div className="mu-index">01</div>
          <h3>Auto-classify</h3>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 10px' }}>
          Runs an agent over your pipeline data — Social Preview / Open Graph,
          Brand Snapshot, Scout Brief, site meta — to determine the market
          category. If there isn't enough data yet, set it manually below.
        </p>
        <button
          type="button"
          id="market-category-run-btn"
          onClick={runAnalysis}
          disabled={running}
          className="mu-cta-primary"
          style={{ alignSelf: 'flex-start', minHeight: 42, padding: '0 20px', fontSize: 13 }}
        >
          {running ? 'Analyzing…' : 'Run analysis'}
        </button>

        {agentInfo && (agentInfo.rationale || (agentInfo.evidence || []).length) ? (
          <div style={{ marginTop: 10 }}>
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

      {/* Status */}
      <div id="market-category-detected" className="mu-section">
        <div className="mu-section-head">
          <div className="mu-index">02</div>
          <h3>Category</h3>
        </div>
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
        <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '8px 0 0' }}>
          Detected from your pipeline. A user-set value overrides it and drives
          competitor benchmarking and the Strategy Builder.
        </p>
      </div>

      {/* Editor */}
      <div id="market-category-editor" className="mu-section">
        <div className="mu-section-head">
          <div className="mu-index">03</div>
          <h3>Set / change category</h3>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => setMode('list')}
            className={`mu-btn-outline${mode === 'list' ? ' mu-btn-outline--active' : ''}`}
            style={{ minHeight: 36, padding: '0 14px', fontSize: 12 }}
          >
            From list
          </button>
          <button
            type="button"
            onClick={() => setMode('custom')}
            className={`mu-btn-outline${mode === 'custom' ? ' mu-btn-outline--active' : ''}`}
            style={{ minHeight: 36, padding: '0 14px', fontSize: 12 }}
          >
            Custom
          </button>
        </div>

        {mode === 'list' ? (
          <div className="mu-field">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mu-select"
            >
              <option value="">— select category —</option>
              {CANONICAL_VERTICALS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="mu-field">
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="e.g. gambling, e-games, boutique-winery"
              maxLength={100}
              className="mu-input"
            />
          </div>
        )}

        {notice && (
          <p className={`mu-notice${notice.kind === 'error' ? ' mu-notice--danger' : ' mu-notice--success'}`}>
            {notice.text}
          </p>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, margin: '4px 0 0' }}>
          This category pre-fills the Strategy Builder vertical (where it can be
          overridden per strategy).
        </p>
      </div>

      <div className="mu-footer">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="mu-cta-primary"
        >
          {busy ? 'Saving…' : 'Save category'}
        </button>
      </div>
    </div>
  );
}
