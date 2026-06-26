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
  { label: 'Source Library', status: 'planned', note: 'Planned optional evidence consumer.' },
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
  knowledge_base: { cardId: 'knowledge-base', label: 'Source Library' },
};

const SECTION_CARD = {
  identity: { cardId: 'create-client', label: 'Client record' },
  positioning: { cardId: 'brand-system', label: 'Brand system' },
  audience: { cardId: 'marketing-brief', label: 'Marketing brief' },
  offers: { cardId: 'create-client', label: 'Client record' },
  proof: { cardId: 'knowledge-base', label: 'Source Library' },
  content: { cardId: 'marketing-brief', label: 'Marketing brief' },
};

const DOMAIN_LABELS = {
  identity: 'Identity',
  authority: 'Authority',
  market: 'Market',
  discovery: 'Discovery',
  content: 'Content',
  opportunity: 'Opportunity',
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

function decisionItems(decision) {
  const value = decision?.value ?? decision;
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function decisionText(decision, fallback = 'Not set') {
  const value = decision?.value ?? decision;
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || fallback;
  return text(value, fallback);
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
  const [tab, setTab] = useState('source');
  const [brain, setBrain] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [markdownSource, setMarkdownSource] = useState('');
  const [markdownBaseline, setMarkdownBaseline] = useState('');
  const [sourceFileName, setSourceFileName] = useState('');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState({ toneSummary: '', scribeInstructions: '', avoidText: '' });
  const [voiceDirty, setVoiceDirty] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
      const source = data.markdownSource || data.brain?.markdownSource || '';
      setMarkdownSource(source);
      setMarkdownBaseline(source);
      setSourceDirty(false);
      setSourceFileName('');
    } catch (err) {
      setError(err.message || 'Could not load Company Brain.');
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
  const completion = brain?.completion || {};
  const completionDomains = completion.domains || {};
  const missingDecisionQueue = arr(brain?.missingDecisionQueue);
  const acquisitionMethods = brain?.decisionAcquisition?.methods || {};
  const discoveryDecisions = brain?.decisions?.intelligence?.discovery || {};

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
      if (action === 'generate') setTab('approved');
    } catch (err) {
      setError(err.message || `Company Brain ${action} failed.`);
    } finally {
      setBusy('');
    }
  }

  function updateMarkdownSource(value) {
    setMarkdownSource(value);
    setSourceDirty(value !== markdownBaseline);
  }

  async function importMarkdownFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const source = await file.text();
      setMarkdownSource(source);
      setSourceDirty(source !== markdownBaseline);
      setSourceFileName(file.name);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not read CLIENT_BRAIN.md.');
    } finally {
      event.target.value = '';
    }
  }

  async function injectMarkdownSource() {
    const source = String(markdownSource || '').trim();
    if (!source) {
      setError('CLIENT_BRAIN.md source is required.');
      return;
    }
    setBusy('source');
    setError('');
    try {
      const token = await getIdToken();
      const res = await fetch('/api/dashboard/client-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ markdownSource: source }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      const savedSource = data.brain?.markdownSource || source;
      setBrain(data.brain || brain);
      setMarkdownSource(savedSource);
      setMarkdownBaseline(savedSource);
      setSourceDirty(false);
      setSourceFileName('');
      onSaved?.(data.brain);
      setCopied('Injected CLIENT_BRAIN.md.');
      setTab('approved');
      setTimeout(() => setCopied(''), 1800);
    } catch (err) {
      setError(err.message || 'Could not inject CLIENT_BRAIN.md.');
    } finally {
      setBusy('');
    }
  }

  function resetMarkdownDraft() {
    setMarkdownSource(markdownBaseline);
    setSourceDirty(false);
    setSourceFileName('');
    setError('');
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
    <div id="client-brain-card" className="client-brain-card signals-sg" data-tooltip-disabled="true">
      <div className="cb-topbar">
        <div>
          <h3>{text(brain?.identity?.name, 'Company Brain')}</h3>
        </div>
      </div>

      {error ? <p className="sg-notice sg-notice-danger">{error}</p> : null}
      {copied ? <p className="sg-notice">{copied}</p> : null}
      {brain?.regenerationError ? <p className="sg-notice sg-notice-danger">AI refine fell back to deterministic: {brain.regenerationError}</p> : null}

      <section className="cb-health" aria-label="Brain health">
        <span className="mu-label cb-health-label">Brain Health</span>
        <div className="cb-health-stats">
          <span className="cb-health-stat"><strong>{brain?.status || 'draft'}</strong> status</span>
          <span className="cb-health-stat"><strong>{enabledCount}/{sourceRefs.length}</strong> sources</span>
          <span className="cb-health-stat"><strong>{confidence}</strong> confidence</span>
          <span className="cb-health-stat"><strong>{highMissing}</strong> gaps</span>
          <span className="cb-health-stat"><strong>{contradictions.length}</strong> conflicts</span>
        </div>
      </section>

      <div id="client-brain-tab-bar" className="tile-detail-tabs">
        {[
          ['source', 'BRAIN SOURCE'],
          ['approved', 'APPROVED BRAIN'],
          ['sourcesGaps', 'SOURCES & GAPS'],
          ['consumers', 'CONSUMERS'],
        ].map(([id, label]) => (
          <button key={id} type="button" className={`tile-detail-tab${tab === id ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'source' && (
        <section id="client-brain-source-editor" className="cb-panel">
          <label className="cb-field-block cb-source-field">
            <textarea
              rows={14}
              value={markdownSource}
              onChange={(e) => updateMarkdownSource(e.target.value)}
              spellCheck={false}
              placeholder="Paste CLIENT_BRAIN.md here, or use Upload .md…"
              style={{ ...cbInputStyle, marginTop: 0, fontFamily: 'var(--font-mono)', fontSize: 12, minHeight: 300 }}
            />
          </label>

          <div className="cb-actions">
            {/* Primary flow sits beneath the editor: Upload a CLIENT_BRAIN.md, Inject
                to compile + persist the runtime Brain. Everything else is in More. */}
            <input
              id="client-brain-md-file"
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={importMarkdownFile}
              style={{ display: 'none' }}
            />
            <label htmlFor="client-brain-md-file" className="sg-btn sg-cta cb-upload-cta">
              <span>⬆ Upload .md</span>
            </label>
            <button type="button" className="sg-btn" disabled={Boolean(busy) || !String(markdownSource || '').trim()} onClick={injectMarkdownSource}>
              {busy === 'source' ? 'Injecting...' : 'Inject Brain'}
            </button>
            <div className="cb-menu">
              <button type="button" className="sg-btn" aria-haspopup="true" aria-expanded={menuOpen} disabled={Boolean(busy)} onClick={() => setMenuOpen((o) => !o)}>
                More ⋯
              </button>
              {menuOpen ? (
                <>
                  <button type="button" className="cb-menu-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setMenuOpen(false)} />
                  <div className="cb-menu-panel" role="menu">
                    <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy)} onClick={() => { setMenuOpen(false); runAction('generate'); }}>
                      {busy === 'generate' ? 'Regenerating...' : 'Regenerate Context'}
                    </button>
                    {brain?.status !== 'approved' ? (
                      <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy)} onClick={() => { setMenuOpen(false); runAction('approve', { status: 'approved' }); }}>
                        Approve
                      </button>
                    ) : null}
                    <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy)} onClick={() => { setMenuOpen(false); saveSources(); }}>
                      {busy === 'save' ? 'Saving...' : 'Save source toggles'}
                    </button>
                    <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy)} onClick={() => { setMenuOpen(false); runAction('generate', { mode: 'llm' }, 'generate-ai'); }}>
                      {busy === 'generate-ai' ? 'Refining...' : 'Regenerate with AI'}
                    </button>
                    <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy)} onClick={() => { setMenuOpen(false); runAction('approve', { status: 'stale' }); }}>
                      Mark stale
                    </button>
                    <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy)} onClick={() => { setMenuOpen(false); runAction('export'); }}>
                      Export
                    </button>
                    <button type="button" role="menuitem" className="cb-menu-item" disabled={Boolean(busy) || !sourceDirty} onClick={() => { setMenuOpen(false); resetMarkdownDraft(); }}>
                      Reset draft
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="cb-source-meta-row">
            <span className="mu-label">{sourceFileName ? `Loaded ${sourceFileName} — review, then Inject` : 'CLIENT_BRAIN.md — upload or paste, then Inject'}</span>
            <span className="cb-source-meta">{brain?.generatedBy === 'markdown' ? 'markdown' : 'template'} · {brain?.markdownMeta?.schemaVersion || 'v1'} · {brain?.markdownMeta?.status || brain?.status || 'draft'} · {sourceDirty ? 'unsaved' : 'saved'}</span>
          </div>
        </section>
      )}

      {tab === 'sourcesGaps' && (
        <section className="cb-panel">
          <div className="cb-field-block">
            <span className="mu-label">Source Toggles</span>
            <p className="cb-muted">Supporting documents and generated sources can inform Brain generation, but they do not replace the approved CLIENT_BRAIN.md runtime source.</p>
          </div>
          {sourceRefs.length ? sourceRefs.map((source) => (
            <SourceRow key={source.id} source={source} onToggle={toggleSource} onUseForToggle={toggleUseFor} onOpenCard={onOpenCard} />
          )) : <div className="sg-empty">No sources discovered yet.</div>}
        </section>
      )}

      {tab === 'approved' && (
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
            <span className="mu-label">Content / Voice</span>
            <p>{text(brain?.voice?.toneSummary)}</p>
            <p className="cb-muted">Approved tone belongs in CLIENT_BRAIN.md under Content Intelligence &gt; Voice. Supporting examples stay in Content Library or Conversation Intelligence.</p>
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

      {tab === 'sourcesGaps' && (
        <section className="cb-panel">
          <div className="cb-field-block">
            <span className="mu-label">Completion</span>
            <div className="sg-metrics">
              <div className="sg-metric"><span className="sg-metric-value">{completion.score ?? 0}%</span><span className="sg-metric-label">Overall</span></div>
              {Object.entries(DOMAIN_LABELS).map(([key, label]) => (
                <div key={key} className="sg-metric">
                  <span className="sg-metric-value">{completionDomains[key]?.score ?? 0}%</span>
                  <span className="sg-metric-label">{label}</span>
                </div>
              ))}
            </div>
            <p className="cb-muted">Completion is informational only. Cards can still run while the operator improves missing decisions.</p>
          </div>

          <div className="cb-field-block">
            <span className="mu-label">Decision Acquisition</span>
            {Object.keys(acquisitionMethods).length ? (
              <div className="cb-chip-row">
                {Object.entries(acquisitionMethods).map(([method, count]) => (
                  <span key={method} className="sg-chip">{method}: {count}</span>
                ))}
              </div>
            ) : (
              <p className="cb-muted">No acquisition metadata yet.</p>
            )}
          </div>

          <div className="cb-field-block">
            <span className="mu-label">Research Queue</span>
            {missingDecisionQueue.length ? (
              <ul className="cb-mini-list">
                {missingDecisionQueue.slice(0, 12).map((item, index) => (
                  <li key={`${item.field}-${index}`}>
                    <strong>{String(item.priority || 'medium').toUpperCase()}</strong> · {item.action || item.label}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="cb-muted">No missing decisions detected.</p>
            )}
          </div>

          <div className="cb-field-block">
            <span className="mu-label">Discovery Intelligence</span>
            <div className="cb-generated-grid">
              <FieldList title="Keywords" values={decisionItems(discoveryDecisions.keywords)} />
              <FieldList title="Platforms" values={decisionItems(discoveryDecisions.primaryPlatforms)} />
              <FieldList title="Communities" values={decisionItems(discoveryDecisions.communities)} />
              <FieldList title="Publications" values={decisionItems(discoveryDecisions.publications)} />
              <FieldList title="Podcasts" values={decisionItems(discoveryDecisions.podcasts)} />
              <FieldList title="Events" values={decisionItems(discoveryDecisions.events)} />
              <FieldList title="Directories" values={decisionItems(discoveryDecisions.directories)} />
              <FieldList title="Awards" values={decisionItems(discoveryDecisions.awards)} />
              <FieldList title="Social Ecosystems" values={decisionItems(discoveryDecisions.socialEcosystems)} />
              <FieldList title="Hashtags" values={decisionItems(discoveryDecisions.hashtags)} />
              <FieldList title="Watch Lists" values={decisionItems(discoveryDecisions.watchLists)} />
            </div>
            <p className="cb-muted">Feeds search defaults, Market Insights, watchlists, Strategy Builder, and Lead Gen discovery paths.</p>
          </div>

          <div className="cb-field-block">
            <span className="mu-label">Discovery Summary</span>
            <p>{decisionText(discoveryDecisions.keywords)}</p>
          </div>
        </section>
      )}

      {tab === 'approved' && (
        <section id="client-brain-voice-editor" className="cb-panel cb-voice-editor">
          <div className="cb-field-block">
            <span className="mu-label">Voice Editor</span>
            <p className="cb-muted">This transitional editor updates the compiled voice profile. The durable source of truth should also be reflected in CLIENT_BRAIN.md &gt; Content Intelligence &gt; Voice.</p>
          </div>
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

      {tab === 'consumers' && (
        <section className="cb-panel">
          <div className="cb-copy-head">
            <span className="mu-label">Output Context Pack</span>
            <div className="cb-actions">
              <button type="button" className="sg-btn" onClick={() => copyContext(false)}>Copy short</button>
              <button type="button" className="sg-btn" onClick={() => copyContext(true)}>Copy long</button>
              <button type="button" className="sg-btn" disabled={Boolean(busy)} onClick={() => runAction('export')}>Export</button>
            </div>
          </div>
          <pre className="cb-context-box">{brain?.aiContextPack?.shortContext || 'Generate the Company Brain to create CLIENT_CONTEXT.'}</pre>
          <FieldList title="Prompt Rules" values={brain?.aiContextPack?.promptRules} />
        </section>
      )}

      {tab === 'consumers' && (
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
