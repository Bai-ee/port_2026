'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const USE_FOR_KEYS = [
  ['tone', 'Tone'],
  ['strategy', 'Strategy'],
  ['copy', 'Copy'],
  ['audience', 'Audience'],
  ['proof', 'Proof'],
  ['positioning', 'Positioning'],
  ['offers', 'Offers'],
  ['emailDigest', 'Email'],
  ['socialPosts', 'Social'],
  ['marketingInsights', 'Insights'],
];

// Downstream consumers and their actual wiring status. Keep in sync with
// docs/company-brain/IMPLEMENTATION_PLAN.md (the consumer table).
const DOWNSTREAM = [
  { label: 'Strategy Builder', status: 'wired', note: 'Day-of post + 30-day plan read CLIENT_CONTEXT (useFor: socialPosts).' },
  { label: 'Post Me', status: 'wired', note: 'Brief draft via Strategy Builder; social-posting generate-copy reads CLIENT_CONTEXT.' },
  { label: 'Email Digest', status: 'wired', note: 'Executive summary matches voice (useFor: emailDigest).' },
  { label: 'Executive / Market Brief', status: 'wired', note: 'Scribe + Guardian read the voice profile via resolveVoiceProfile.' },
  { label: 'Creative Brief', status: 'wired', note: 'Cover paragraph uses CLIENT_CONTEXT (useFor: copy).' },
  { label: 'Marketing Insights', status: 'planned', note: 'Planned optional context consumer.' },
  { label: 'Social Preview', status: 'planned', note: 'Planned optional context consumer.' },
  { label: 'Knowledge Base', status: 'planned', note: 'Planned optional context consumer.' },
  { label: 'Future Lead Gen', status: 'planned', note: 'Planned optional context consumer.' },
];

// Which card owns the editable input behind each source type / generated section,
// so the brain can link out to where that data is actually customized.
const SOURCE_CARD = {
  manual_note: { cardId: 'create-client', label: 'Client record' },
  website: { cardId: 'create-client', label: 'Client record' },
  onboarding: { cardId: 'brand-system', label: 'Brand system' },
  brand_guide: { cardId: 'style-guide', label: 'Style guide' },
  marketing_insight: { cardId: 'marketing-brief', label: 'Marketing brief' },
  knowledge_base: { cardId: 'knowledge-base', label: 'Knowledge base' },
};

const SECTION_CARD = {
  identity: { cardId: 'create-client', label: 'Client record' },
  positioning: { cardId: 'brand-system', label: 'Brand system' },
  audience: { cardId: 'marketing-brief', label: 'Marketing brief' },
  offers: { cardId: 'create-client', label: 'Client record' },
  proof: { cardId: 'knowledge-base', label: 'Knowledge base' },
  content: { cardId: 'marketing-brief', label: 'Marketing brief' },
};

function EditLink({ cardId, label, onOpenCard, children }) {
  if (!cardId || !onOpenCard) return null;
  return (
    <button type="button" className="cb-edit-link" onClick={() => onOpenCard(cardId)}>
      {children || `Edit in ${label}`} ↗
    </button>
  );
}

const cbInputStyle = {
  width: '100%',
  marginTop: 6,
  background: 'rgba(0, 0, 0, 0.25)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  borderRadius: 8,
  color: 'inherit',
  padding: '8px 10px',
  font: 'inherit',
  lineHeight: 1.4,
  resize: 'vertical',
};

function arr(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value, fallback = 'Not set') {
  const out = String(value || '').trim();
  return out || fallback;
}

function FieldList({ title, values, edit, onOpenCard }) {
  const list = arr(values);
  return (
    <div className="cb-field-block">
      <span className="mu-label">{title}</span>
      {list.length ? (
        <ul className="cb-mini-list">
          {list.slice(0, 8).map((item, index) => <li key={`${title}-${index}`}>{String(item)}</li>)}
        </ul>
      ) : (
        <p className="cb-muted">Not set</p>
      )}
      {edit ? <EditLink cardId={edit.cardId} label={edit.label} onOpenCard={onOpenCard} /> : null}
    </div>
  );
}

function SourceRow({ source, onToggle, onUseForToggle, onOpenCard }) {
  const enabled = source.enabled !== false;
  const editTarget = SOURCE_CARD[source.sourceType];
  return (
    <article className={`cb-source-row${enabled ? '' : ' cb-source-row--off'}`}>
      <div className="cb-source-main">
        <button
          type="button"
          className={`sg-btn ${enabled ? 'sg-btn-on' : 'sg-btn-off'}`}
          onClick={() => onToggle(source.id)}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
        <div>
          <h4>{source.label || source.id}</h4>
          <p>{source.summary || 'No summary captured yet.'}</p>
          <div className="cb-chip-row">
            <span className="sg-chip">{source.sourceType || 'source'}</span>
            <span className="sg-chip">Trust: {source.trustLevel || 'medium'}</span>
            <span className="sg-chip">Fresh: {source.freshness || 'unknown'}</span>
            <span className="sg-chip">Relevance: {source.relevance || 'medium'}</span>
          </div>
        </div>
      </div>
      {source.doNotUseNotes ? <p className="cb-warning">Do not use: {source.doNotUseNotes}</p> : null}
      {editTarget && onOpenCard ? (
        <div className="cb-source-edit">
          <EditLink cardId={editTarget.cardId} label={editTarget.label} onOpenCard={onOpenCard}>Edit in {editTarget.label}</EditLink>
        </div>
      ) : null}
      <div className="cb-use-grid" aria-label={`Use controls for ${source.label || source.id}`}>
        {USE_FOR_KEYS.map(([key, label]) => (
          <label key={key} className="cb-check">
            <input
              type="checkbox"
              checked={source.useFor?.[key] !== false}
              onChange={() => onUseForToggle(source.id, key)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </article>
  );
}

export default function ClientBrainCard({ getIdToken, onSaved, onOpenCard }) {
  const [tab, setTab] = useState('sources');
  const [brain, setBrain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [voiceDraft, setVoiceDraft] = useState({ toneSummary: '', scribeInstructions: '', avoidText: '' });
  const [voiceDirty, setVoiceDirty] = useState(false);

  const loadBrain = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/client-brain', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setBrain(data.brain || null);
    } catch (err) {
      setError(err.message || 'Could not load Client Brain.');
    } finally {
      setLoading(false);
    }
  }, [getIdToken]);

  useEffect(() => {
    loadBrain();
  }, [loadBrain]);

  // Sync the editable voice draft whenever the brain (re)loads or saves.
  useEffect(() => {
    if (!brain) return;
    const v = brain.voice || {};
    setVoiceDraft({
      toneSummary: v.toneSummary || '',
      scribeInstructions: v.scribeInstructions || '',
      avoidText: arr(v.avoidPatterns).join('\n'),
    });
    setVoiceDirty(false);
  }, [brain]);

  const sourceRefs = useMemo(() => arr(brain?.sourceRefs), [brain]);
  const enabledCount = sourceRefs.filter((src) => src.enabled !== false).length;
  const highMissing = arr(brain?.missingData).filter((item) => item.priority === 'high').length;
  const contradictions = useMemo(() => arr(brain?.contradictions), [brain]);
  // Prefer the server-computed brain confidence (factors gaps + contradictions);
  // fall back to a local source-only estimate for older brains without it.
  const localConfidence = useMemo(() => {
    if (!sourceRefs.length) return 'low';
    const score = sourceRefs.filter((src) => src.enabled !== false).reduce((sum, src) => {
      const t = src.trustLevel === 'high' ? 3 : src.trustLevel === 'medium' ? 2 : 1;
      const f = src.freshness === 'current' ? 3 : src.freshness === 'recent' ? 2 : src.freshness === 'stale' ? 0 : 1;
      const r = src.relevance === 'high' ? 3 : src.relevance === 'medium' ? 2 : 1;
      return sum + t + f + r;
    }, 0) / Math.max(1, enabledCount);
    return score >= 7 ? 'high' : score >= 4.7 ? 'medium' : 'low';
  }, [enabledCount, sourceRefs]);
  const confidence = brain?.confidence || localConfidence;

  function updateSource(id, updater) {
    setBrain((prev) => ({
      ...(prev || {}),
      sourceRefs: sourceRefs.map((src) => (src.id === id ? updater(src) : src)),
    }));
  }

  function toggleSource(id) {
    updateSource(id, (src) => ({ ...src, enabled: src.enabled === false }));
  }

  function toggleUseFor(id, key) {
    updateSource(id, (src) => ({
      ...src,
      useFor: { ...(src.useFor || {}), [key]: src.useFor?.[key] === false },
    }));
  }

  async function saveSources() {
    setBusy('save');
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/client-brain/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceRefs }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setBrain(data.brain || brain);
      onSaved?.(data.brain);
    } catch (err) {
      setError(err.message || 'Could not save source toggles.');
    } finally {
      setBusy('');
    }
  }

  async function runAction(action, body = {}, busyKey = action) {
    setBusy(busyKey);
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/dashboard/client-brain/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.brain) {
        setBrain(data.brain);
        onSaved?.(data.brain);
      }
      if (data.CLIENT_CONTEXT) {
        await navigator.clipboard?.writeText(data.CLIENT_CONTEXT);
        setCopied('Copied CLIENT_CONTEXT.');
      }
      if (action === 'generate') setTab('generated');
    } catch (err) {
      setError(err.message || `Client Brain ${action} failed.`);
    } finally {
      setBusy('');
    }
  }

  // Save the edited voice as the single source of tone for Scribe + Guardian.
  // Sends the full voice object (prev voice spread + edits) so seeded pillars,
  // examples, formatting, etc. carry through untouched. Status is preserved —
  // an already-approved brain applies the change immediately.
  async function saveVoice() {
    setBusy('voice');
    setError('');
    try {
      const token = await getIdToken();
      const nextVoice = {
        ...(brain?.voice || {}),
        toneSummary: voiceDraft.toneSummary.trim(),
        scribeInstructions: voiceDraft.scribeInstructions.trim(),
        avoidPatterns: voiceDraft.avoidText.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch('/api/dashboard/client-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brain: { voice: nextVoice } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setBrain(data.brain || brain);
      onSaved?.(data.brain);
      setCopied('Saved voice.');
      setTimeout(() => setCopied(''), 1800);
    } catch (err) {
      setError(err.message || 'Could not save voice.');
    } finally {
      setBusy('');
    }
  }

  async function copyContext(long = false) {
    const value = long ? brain?.aiContextPack?.longContext : brain?.aiContextPack?.shortContext;
    if (!value) return;
    await navigator.clipboard?.writeText(value);
    setCopied(long ? 'Copied long context.' : 'Copied short context.');
    setTimeout(() => setCopied(''), 1800);
  }

  if (loading) {
    return <div className="client-brain-card"><div className="brief-loader-spinner" aria-hidden="true" /></div>;
  }

  return (
    <div id="client-brain-card" className="client-brain-card signals-sg">
      <div className="cb-topbar">
        <div>
          <span className="mu-label">Client Brain</span>
          <h3>{text(brain?.identity?.name, 'Client profile')}</h3>
        </div>
        <div className="cb-actions">
          <button type="button" className="sg-btn" disabled={Boolean(busy)} onClick={saveSources}>
            {busy === 'save' ? 'Saving...' : 'Save sources'}
          </button>
          <button type="button" className="sg-btn sg-cta" disabled={Boolean(busy)} onClick={() => runAction('generate')}>
            {busy === 'generate' ? 'Generating...' : 'Regenerate'}
          </button>
          <button type="button" className="sg-btn" disabled={Boolean(busy)} onClick={() => runAction('generate', { mode: 'llm' }, 'generate-ai')} title="Refine free-text fields with the model, grounded in enabled sources.">
            {busy === 'generate-ai' ? 'Refining...' : 'Regenerate (AI)'}
          </button>
          <button type="button" className="sg-btn sg-btn-on" disabled={Boolean(busy)} onClick={() => runAction('approve', { status: 'approved' })}>
            Approve
          </button>
          <button type="button" className="sg-btn" disabled={Boolean(busy)} onClick={() => runAction('approve', { status: 'stale' })}>
            Mark stale
          </button>
        </div>
      </div>

      {error ? <p className="sg-notice sg-notice-danger">{error}</p> : null}
      {copied ? <p className="sg-notice">{copied}</p> : null}
      {brain?.regenerationError ? <p className="sg-notice sg-notice-danger">AI refine fell back to deterministic: {brain.regenerationError}</p> : null}

      <section className="sg-section">
        <div className="sg-head">
          <span className="sg-index">01</span>
          <div>
            <h3>Brain Health</h3>
            <p>Source coverage, generation status, confidence, gaps, and conflicts.{brain?.generatedBy ? ` Built: ${brain.generatedBy === 'model' ? 'AI-refined' : 'deterministic'}.` : ''}</p>
          </div>
        </div>
        <div className="sg-metrics">
          <div className="sg-metric"><span className="sg-metric-value">{brain?.status || 'draft'}</span><span className="sg-metric-label">Status</span></div>
          <div className="sg-metric"><span className="sg-metric-value">{enabledCount}/{sourceRefs.length}</span><span className="sg-metric-label">Sources on</span></div>
          <div className="sg-metric"><span className="sg-metric-value">{confidence}</span><span className="sg-metric-label">Confidence</span></div>
          <div className="sg-metric"><span className="sg-metric-value">{highMissing}</span><span className="sg-metric-label">High gaps</span></div>
          <div className="sg-metric"><span className="sg-metric-value">{contradictions.length}</span><span className="sg-metric-label">Conflicts</span></div>
        </div>
      </section>

      <div className="tile-detail-tabs cb-tabs">
        {[
          ['sources', 'SOURCES'],
          ['generated', 'GENERATED'],
          ['voice', 'VOICE'],
          ['context', 'CONTEXT'],
          ['usage', 'USAGE'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={`tile-detail-tab${tab === id ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sources' && (
        <section className="cb-panel">
          {sourceRefs.length ? sourceRefs.map((source) => (
            <SourceRow key={source.id} source={source} onToggle={toggleSource} onUseForToggle={toggleUseFor} onOpenCard={onOpenCard} />
          )) : <div className="sg-empty">No sources discovered yet.</div>}
        </section>
      )}

      {tab === 'generated' && (
        <section className="cb-panel cb-generated-grid">
          <div className="cb-field-block">
            <span className="mu-label">Identity</span>
            <p>{text(brain?.identity?.description)}</p>
            <p className="cb-muted">{[brain?.identity?.category, brain?.identity?.primaryUrl].filter(Boolean).join(' · ') || 'No category or URL set'}</p>
            <EditLink cardId={SECTION_CARD.identity.cardId} label={SECTION_CARD.identity.label} onOpenCard={onOpenCard} />
          </div>
          <div className="cb-field-block">
            <span className="mu-label">Positioning</span>
            <p>{text(brain?.positioning?.oneLiner)}</p>
            <EditLink cardId={SECTION_CARD.positioning.cardId} label={SECTION_CARD.positioning.label} onOpenCard={onOpenCard} />
          </div>
          <div className="cb-field-block">
            <span className="mu-label">Voice</span>
            <p>{text(brain?.voice?.toneSummary)}</p>
            <button type="button" className="cb-edit-link" onClick={() => setTab('voice')}>Edit voice ↗</button>
          </div>
          <FieldList title="Audience" values={brain?.audience?.primary} edit={SECTION_CARD.audience} onOpenCard={onOpenCard} />
          <FieldList title="Offers" values={brain?.offers?.services} edit={SECTION_CARD.offers} onOpenCard={onOpenCard} />
          <FieldList title="Proof" values={brain?.proof?.projects} edit={SECTION_CARD.proof} onOpenCard={onOpenCard} />
          <FieldList title="Content Pillars" values={brain?.content?.pillars} edit={SECTION_CARD.content} onOpenCard={onOpenCard} />
          <FieldList title="Missing Data" values={arr(brain?.missingData).map((item) => `${item.priority}: ${item.field} — ${item.reason}`)} />
          {contradictions.length ? (
            <div className="cb-field-block cb-contradictions">
              <span className="mu-label">Contradictions ({contradictions.length})</span>
              <ul className="cb-mini-list">
                {contradictions.map((c, i) => (
                  <li key={`contradiction-${i}`}>
                    <strong>{c.field}:</strong>{' '}
                    {arr(c.values).map((v) => `"${v.value}" (${arr(v.sources).join(', ')})`).join(' vs ')}
                  </li>
                ))}
              </ul>
              <p className="cb-muted">Resolve at the source card, then regenerate.</p>
            </div>
          ) : null}
        </section>
      )}

      {tab === 'voice' && (
        <section id="client-brain-voice-editor" className="cb-panel cb-voice-editor">
          <p className="cb-muted">
            {brain?.status === 'approved'
              ? 'This brain is approved — saved voice applies to Scribe + Guardian immediately.'
              : 'Edit, Save voice, then Approve to make this the live voice for Scribe + Guardian.'}
          </p>
          <label className="cb-field-block">
            <span className="mu-label">Tone summary</span>
            <textarea
              rows={3}
              value={voiceDraft.toneSummary}
              onChange={(e) => { setVoiceDraft((d) => ({ ...d, toneSummary: e.target.value })); setVoiceDirty(true); }}
              style={cbInputStyle}
            />
          </label>
          <label className="cb-field-block">
            <span className="mu-label">Scribe instructions</span>
            <textarea
              rows={4}
              value={voiceDraft.scribeInstructions}
              onChange={(e) => { setVoiceDraft((d) => ({ ...d, scribeInstructions: e.target.value })); setVoiceDirty(true); }}
              style={cbInputStyle}
            />
          </label>
          <label className="cb-field-block">
            <span className="mu-label">Avoid — one per line</span>
            <textarea
              rows={4}
              value={voiceDraft.avoidText}
              onChange={(e) => { setVoiceDraft((d) => ({ ...d, avoidText: e.target.value })); setVoiceDirty(true); }}
              style={cbInputStyle}
            />
          </label>
          <div className="cb-actions">
            <button type="button" className="sg-btn sg-cta" disabled={Boolean(busy) || !voiceDirty} onClick={saveVoice}>
              {busy === 'voice' ? 'Saving...' : 'Save voice'}
            </button>
          </div>
          <p className="cb-muted">Regenerate preserves your saved voice — it only fills voice fields left empty. Pillars, examples, and formatting carry through untouched.</p>
        </section>
      )}

      {tab === 'context' && (
        <section className="cb-panel">
          <div className="cb-copy-head">
            <span className="mu-label">Output Context Pack</span>
            <div className="cb-actions">
              <button type="button" className="sg-btn" onClick={() => copyContext(false)}>Copy short</button>
              <button type="button" className="sg-btn" onClick={() => copyContext(true)}>Copy long</button>
              <button type="button" className="sg-btn" disabled={Boolean(busy)} onClick={() => runAction('export')}>Export</button>
            </div>
          </div>
          <pre className="cb-context-box">{brain?.aiContextPack?.shortContext || 'Generate the Client Brain to create CLIENT_CONTEXT.'}</pre>
          <FieldList title="Prompt Rules" values={brain?.aiContextPack?.promptRules} />
        </section>
      )}

      {tab === 'usage' && (
        <section className="cb-panel">
          <div className="cb-usage-grid">
            {DOWNSTREAM.map((item) => (
              <div key={item.label} className="sg-result">
                <div className="sg-result-title">
                  {item.label}{' '}
                  <span className={`sg-chip ${item.status === 'wired' ? 'sg-btn-on' : ''}`}>{item.status === 'wired' ? 'WIRED' : 'PLANNED'}</span>
                </div>
                <p className="sg-result-body">{item.note}</p>
              </div>
            ))}
          </div>
          <p className="cb-muted">Only approved brains feed downstream copy. Absent or unapproved ⇒ each consumer behaves exactly as before.</p>
        </section>
      )}
    </div>
  );
}
