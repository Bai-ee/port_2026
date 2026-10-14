'use client';

import React, { useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import {
  setTrackShare, validateTrackBenchmark, addTrackBenchmark, removeTrackBenchmark, validatePromotionUrl, setPromotionUrl,
  trackBenchmarkRow, trackProfileSummary,
} from '../../../features/x-strategy/ui-model.js';
import { MAX_BENCHMARKS_PER_TRACK } from '../../../features/x-strategy/content-tracks.js';
import { XCE_COLORS } from '../content-ui/xce-tokens';
import Badge from '../content-ui/ui/Badge';
import Card from '../content-ui/ui/Card';
import ClientBrainOwnedTag from '../ClientBrainOwnedTag';
import SectionLabel from '../content-ui/ui/SectionLabel';

// ContentTracksPanel - X Strategy > Plan tab. Thin view over the pure helpers in features/x-strategy/ui-model.js.
// Draft state lives in StrategyPanel (so reload/discard stay in one place); this file only renders and forwards edits.
// Saving goes through the existing plan save (strategy-plan-apply with changes.contentTracks); benchmark refresh goes
// through the existing strategy-refresh request (onRefreshHandle -> startRefresh([handle])). The refresh status
// (queued time, Re-check, rate-limit Retry) is rendered by StrategyPanel and passed in as refreshFollowUp.

const S = {
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, minWidth: 0 },
  note: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.45, color: XCE_COLORS.inkSoft },
  err: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.4, color: XCE_COLORS.red },
  label: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: XCE_COLORS.inkMuted },
  trackBox: { border: `1px solid ${XCE_COLORS.border}`, borderRadius: 12, padding: 12, display: 'grid', gap: 10, minWidth: 0 },
};

function BenchmarkRow({ track, handle, rowsMeta, request, refreshing, saved, onRemove, onRefresh, hideRefresh = false }) {
  const r = trackBenchmarkRow(handle, rowsMeta, request);
  const base = `x-strategy-track-${track.id}-benchmark-${r.handle}`;
  return (
    <div id={`${base}-row`} style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <div style={{ ...S.row, flexWrap: 'nowrap' }}>
        <span id={`${base}-handle`} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 14 }}>@{r.handle}</span>
        <Badge id={`${base}-status`} tone={r.needsRefresh ? 'amber' : 'green'}>{r.rows} posts · {r.freshness}</Badge>
        {!hideRefresh ? (
          <button type="button" id={`${base}-refresh-button`} className="xce-btn xce-btn-ghost" style={{ minHeight: 36 }} disabled={refreshing || !saved || !onRefresh}
            title={saved ? 'Pull this benchmark again' : 'Save tracks first'} onClick={() => onRefresh(r.handle)}><RefreshCw size={14} /></button>
        ) : null}
        <button type="button" id={`${base}-remove-button`} className="xce-btn xce-btn-ghost" style={{ minHeight: 36 }} aria-label={`Remove @${r.handle}`} onClick={() => onRemove(r.handle)}><X size={14} /></button>
      </div>
      {r.note ? <span id={`${base}-note`} style={S.note}>{r.note}</span> : null}
      {!saved ? <span style={S.note}>Not saved yet. Save tracks, then refresh to pull its posts.</span> : null}
    </div>
  );
}

function TrackRow({ track, draft, setDraft, savedHandles, rowsMeta, request, refreshing, profile, onRefreshHandle, hideRefresh = false }) {
  const [handleInput, setHandleInput] = useState('');
  const [handleErr, setHandleErr] = useState('');
  const id = `x-strategy-track-${track.id}`;
  const summary = trackProfileSummary(track, profile);
  const add = () => {
    const problem = validateTrackBenchmark(draft, track.id, handleInput);
    if (problem) { setHandleErr(problem); return; }
    setDraft(addTrackBenchmark(draft, track.id, handleInput));
    setHandleInput('');
    setHandleErr('');
  };
  return (
    <div id={`${id}-row`} data-section="content-track" style={S.trackBox}>
      <div id={`${id}-header`} style={{ ...S.row, justifyContent: 'space-between' }}>
        <strong id={`${id}-label`} style={{ fontSize: 15 }}>{track.label}</strong>
        <Badge id={`${id}-share-badge`} tone="grey">{track.share}%</Badge>
      </div>

      <div id={`${id}-engines-row`} style={S.row}>
        <span style={S.label}>Engines</span>
        {track.engines.map((e) => <span key={e} id={`${id}-engine-${e}`} className="xce-chip">{e}</span>)}
      </div>

      <div id={`${id}-share-field`} style={{ display: 'grid', gap: 4 }}>
        <label htmlFor={`${id}-share-slider`} style={S.label}>Share of authored posts</label>
        <div style={{ ...S.row, flexWrap: 'nowrap' }}>
          <input id={`${id}-share-slider`} type="range" min={0} max={100} step={1} value={track.share} style={{ flex: 1, minWidth: 0 }}
            onChange={(e) => setDraft(setTrackShare(draft, track.id, e.target.value))} />
          <input id={`${id}-share-input`} aria-label={`${track.label} share percent`} type="number" min={0} max={100} className="xce-input" style={{ width: 64 }} value={track.share}
            onChange={(e) => setDraft(setTrackShare(draft, track.id, e.target.value))} />
        </div>
      </div>

      <div id={`${id}-benchmarks-panel`} style={{ display: 'grid', gap: 8 }}>
        <span style={S.label}>{`Benchmarks · ${track.benchmarks.length}/${MAX_BENCHMARKS_PER_TRACK}`}</span>
        {track.benchmarks.length === 0 ? <span id={`${id}-benchmarks-empty`} style={S.note}>No benchmark yet. Add one below.</span> : null}
        {track.benchmarks.map((h) => (
          <BenchmarkRow key={h} track={track} handle={h} rowsMeta={rowsMeta} request={request} refreshing={refreshing} saved={savedHandles.includes(h)}
            onRemove={(x) => setDraft(removeTrackBenchmark(draft, track.id, x))} onRefresh={onRefreshHandle} hideRefresh={hideRefresh} />
        ))}
        <div id={`${id}-benchmark-add-row`} style={{ ...S.row, flexWrap: 'nowrap' }}>
          <input id={`${id}-benchmark-input`} aria-label={`Add benchmark to ${track.label}`} className="xce-input" style={{ flex: 1, minWidth: 0 }} value={handleInput} placeholder="handle" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => { setHandleInput(e.target.value); setHandleErr(''); }} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <button type="button" id={`${id}-benchmark-add-button`} className="xce-btn xce-btn-ghost" style={{ minHeight: 40 }} disabled={track.benchmarks.length >= MAX_BENCHMARKS_PER_TRACK} onClick={add}><Plus size={14} /> Add</button>
        </div>
        {handleErr ? <span id={`${id}-benchmark-error`} role="alert" style={S.err}>{handleErr}</span> : null}
      </div>

      <div id={`${id}-promotions-panel`} style={{ display: 'grid', gap: 8 }}>
        <span style={S.label}>Promotion links (go in the self-reply)</span>
        {track.promotions.map((p) => {
          const problem = validatePromotionUrl(p.url);
          return (
            <div key={p.id} id={`${id}-promotion-${p.id}-field`} className="xce-field" style={{ minWidth: 0 }}>
              <label htmlFor={`${id}-promotion-${p.id}-input`}>{p.label}</label>
              <input id={`${id}-promotion-${p.id}-input`} className="xce-input" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://… (blank = no link)" value={p.url}
                aria-invalid={problem ? 'true' : undefined} onChange={(e) => setDraft(setPromotionUrl(draft, track.id, p.id, e.target.value))} />
              {problem ? <span id={`${id}-promotion-${p.id}-error`} role="alert" style={S.err}>{problem}</span> : null}
            </div>
          );
        })}
      </div>

      <div id={`${id}-profile-summary`} data-state={summary.state} style={{ display: 'grid', gap: 2 }}>
        <span style={S.label}>Benchmark profile</span>
        <span style={{ fontSize: 13 }}>{summary.headline}</span>
        {summary.lines.map((l) => <span key={l} style={S.note}>{l}</span>)}
      </div>
    </div>
  );
}

export default function ContentTracksPanel({ draft, setDraft, savedHandles = [], rowsMeta = {}, request = null, refreshView = null, refreshFollowUp = null, refreshing = false, profiles = [], check, busy, message, onSave, onDiscard, onRefreshHandle, hideRefresh = false }) {
  const total = draft.reduce((a, t) => a + t.share, 0);
  return (
    <Card id="x-strategy-content-tracks-panel" data-section="content-tracks" padding={14}>
      <div id="x-strategy-content-tracks-header" style={{ ...S.row, justifyContent: 'space-between', marginBottom: 6 }}>
        <SectionLabel id="x-strategy-content-tracks-title">Content tracks<ClientBrainOwnedTag /></SectionLabel>
        {check.dirty ? <Badge id="x-strategy-content-tracks-saved-badge" tone="amber">Unsaved</Badge> : <Badge id="x-strategy-content-tracks-saved-badge" tone="green">Saved</Badge>}
      </div>
      <p id="x-strategy-content-tracks-intro" style={{ ...S.note, margin: '0 0 8px' }}>Each track has its own benchmarks and share of your authored posts. Pace still follows the primary benchmark. Shares always total {total}%.</p>
      <div id="x-strategy-content-tracks-list" style={S.stack}>
        {draft.length === 0 ? <p id="x-strategy-content-tracks-empty" style={S.note}>No content tracks set for this client. Without tracks there are no per-track targets.</p> : null}
        {draft.map((t) => (
          <TrackRow key={t.id} track={t} draft={draft} setDraft={setDraft} savedHandles={savedHandles} rowsMeta={rowsMeta} request={request} refreshing={refreshing}
            profile={(profiles || []).find((p) => p?.trackId === t.id) || null} onRefreshHandle={onRefreshHandle} hideRefresh={hideRefresh} />
        ))}
      </div>
      {check.dirty && check.errors.length ? <div id="x-strategy-content-tracks-errors" role="alert" style={S.err}>{check.errors.join(' ')}</div> : null}
      <div id="x-strategy-content-tracks-actions-row" style={{ ...S.row, marginTop: 10 }}>
        <button type="button" id="x-strategy-content-tracks-save-button" className="xce-btn" style={{ flex: '1 1 160px', minHeight: 44 }} disabled={busy || !check.dirty || check.errors.length > 0} onClick={onSave}>{busy ? 'Saving…' : 'Save tracks'}</button>
        <button type="button" id="x-strategy-content-tracks-discard-button" className="xce-btn xce-btn-ghost" style={{ minHeight: 44 }} disabled={busy || !check.dirty} onClick={onDiscard}>Discard edits</button>
      </div>
      {message?.text ? <div id="x-strategy-content-tracks-message" role={message.kind === 'err' ? 'alert' : 'status'} style={message.kind === 'err' ? S.err : { ...S.note, color: XCE_COLORS.green }}>{message.text}</div> : null}
      {refreshView ? (
        <div id="x-strategy-content-tracks-refresh-status" role="status" style={{ ...S.note, marginTop: 8 }}>
          <div id="x-strategy-content-tracks-refresh-headline">{refreshView.headline}</div>
          {refreshFollowUp}
        </div>
      ) : null}
    </Card>
  );
}
