'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FieldBlock, { toDomId } from './FieldBlock.jsx';
import { BRAIN_FORM_SECTIONS, ALL_FIELDS, countFilled } from '../../features/client-brain/form-schema.js';
import {
  buildDraft, buildPayload, isOverLimit, progressFrom, sectionProgress, stableStringify,
} from './value-utils.js';

const GUIDANCE_KEY = 'brain-builder:guidance-open';
const FORM_API = '/api/dashboard/client-brain/form';

function readGuidancePrefs() {
  try { return JSON.parse(window.localStorage.getItem(GUIDANCE_KEY) || '{}') || {}; } catch { return {}; }
}
function writeGuidancePrefs(prefs) {
  try { window.localStorage.setItem(GUIDANCE_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
}

function formatSaved(updatedAt, version) {
  if (!updatedAt && !version) return '';
  let when = '';
  if (updatedAt) {
    const d = new Date(typeof updatedAt === 'object' && updatedAt._seconds ? updatedAt._seconds * 1000 : updatedAt);
    if (!Number.isNaN(d.getTime())) when = d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  return [version ? `Version ${version}` : '', when ? `saved ${when}` : ''].filter(Boolean).join(' · ');
}

export default function BrainBuilder({ getIdToken, asClientId = '', dashboardHref = '/dashboard' }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ clientId: '', status: 'draft', updatedAt: null, version: null });
  const [draft, setDraft] = useState(() => buildDraft(ALL_FIELDS, {}));
  const [baseline, setBaseline] = useState(() => stableStringify(buildPayload(ALL_FIELDS, buildDraft(ALL_FIELDS, {}))));
  const [justSaved, setJustSaved] = useState(false);
  const [guidancePrefs, setGuidancePrefs] = useState({});
  const [isDesktop, setIsDesktop] = useState(true);
  const [activeSection, setActiveSection] = useState(BRAIN_FORM_SECTIONS[0]?.id);
  const [leaveWarn, setLeaveWarn] = useState(false);
  const sectionRefs = useRef({});

  const query = asClientId ? `?as=${encodeURIComponent(asClientId)}` : '';

  const applyServer = useCallback((data) => {
    const nextDraft = buildDraft(ALL_FIELDS, data?.fields || {});
    setDraft(nextDraft);
    setBaseline(stableStringify(buildPayload(ALL_FIELDS, nextDraft)));
    setMeta({
      clientId: data?.clientId || '',
      status: data?.status || 'draft',
      updatedAt: data?.updatedAt || null,
      version: data?.version ?? null,
    });
  }, []);

  const load = useCallback(async () => {
    const token = await getIdToken();
    const res = await fetch(`${FORM_API}${query}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `Could not load the Brain (${res.status}).`);
    applyServer(data);
  }, [getIdToken, query, applyServer]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then(() => { if (!cancelled) setLoadError(''); })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load the Brain.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [load]);

  // guidance defaults: open on desktop, collapsed on mobile; saved choices win.
  useEffect(() => {
    setGuidancePrefs(readGuidancePrefs());
    const mq = window.matchMedia('(min-width: 769px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const toggleGuidance = useCallback((key) => {
    setGuidancePrefs((prev) => {
      const current = prev[key] ?? isDesktop;
      const next = { ...prev, [key]: !current };
      writeGuidancePrefs(next);
      return next;
    });
  }, [isDesktop]);

  const payload = useMemo(() => buildPayload(ALL_FIELDS, draft), [draft]);
  const dirty = useMemo(() => stableStringify(payload) !== baseline, [payload, baseline]);
  const progress = useMemo(() => progressFrom(countFilled(payload)), [payload]);
  const overLimit = useMemo(() => ALL_FIELDS.some((f) => isOverLimit(f, draft[f.key])), [draft]);

  useEffect(() => { if (dirty) { setJustSaved(false); setLeaveWarn(false); } }, [dirty]);

  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // highlight the section nearest the top while scrolling
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.dataset.sectionId);
    }, { rootMargin: '-80px 0px -60% 0px', threshold: 0 });
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [loading]);

  const jumpTo = (id) => {
    const el = sectionRefs.current[id];
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    setActiveSection(id);
  };

  const save = useCallback(async () => {
    if (saving || overLimit) return;
    setSaving(true);
    setSaveError('');
    try {
      const token = await getIdToken();
      const res = await fetch(`${FORM_API}${query}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `Save failed (${res.status}).`);
      applyServer(data);
      await load().catch(() => {}); // re-fetch so the page shows exactly what is stored
      setJustSaved(true);
    } catch (err) {
      setSaveError(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [saving, overLimit, getIdToken, query, payload, applyServer, load]);

  const onBackClick = (e) => {
    if (dirty && !leaveWarn) { e.preventDefault(); setLeaveWarn(true); }
  };

  const savedLabel = formatSaved(meta.updatedAt, meta.version);
  const clientLabel = meta.clientId || asClientId || 'Your client';
  const saveDisabled = saving || loading || !!loadError || !dirty || overLimit;
  const saveText = saving ? 'Saving…' : dirty ? 'Save Brain' : 'Saved';
  const statusLine = saveError ? '' : dirty ? 'Unsaved changes' : justSaved ? `Saved. ${savedLabel}` : savedLabel;

  return (
    <div id="brain-builder-page" data-section="brain-builder">
      <div className="bb-shell">
        <header id="brain-builder-header">
          <div className="bb-header-top">
            <div className="bb-title-block">
              <div className="bb-eyebrow">Client Brain Builder</div>
              <h1 id="brain-builder-client-name">{clientLabel}</h1>
            </div>
            <div className="bb-header-actions">
              <span className="bb-pill" data-status={meta.status} id="brain-builder-status-pill">{meta.status || 'draft'}</span>
              <a className="bb-btn" id="brain-builder-back-link" href={`${dashboardHref}${query}`} onClick={onBackClick}>Back to dashboard</a>
              <button type="button" id="brain-builder-save-button" className="bb-btn bb-btn-primary bb-header-save" disabled={saveDisabled} onClick={save}>{saveText}</button>
            </div>
          </div>
          <div id="brain-builder-progress">
            <div className="bb-progress-label">
              <span>{progress.label}</span>
              <span className="bb-mono">{progress.pct}%</span>
            </div>
            <div className="bb-progress-track" role="progressbar" aria-label="Brain completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct}>
              <div className="bb-progress-fill" style={{ width: `${progress.pct}%` }} />
            </div>
            {progress.requiredMissing.length ? (
              <div style={{ fontSize: 12, color: 'rgba(42,36,32,0.6)' }}>{progress.requiredMissing.length} required {progress.requiredMissing.length === 1 ? 'field' : 'fields'} still empty.</div>
            ) : null}
          </div>
          {statusLine ? <div className="bb-header-status" style={{ fontSize: 13, color: 'rgba(42,36,32,0.7)' }} aria-live="polite">{statusLine}</div> : null}
        </header>

        {leaveWarn ? (
          <p className="bb-notice bb-notice-warn" role="alert" id="brain-builder-leave-warning">
            You have unsaved changes. Save first, or click Back to dashboard again to leave without saving.
          </p>
        ) : null}
        {saveError ? <p className="bb-notice bb-notice-error" role="alert" id="brain-builder-save-error">{saveError}</p> : null}
        {loadError ? <p className="bb-notice bb-notice-error" role="alert" id="brain-builder-load-error">{loadError}</p> : null}
        {loading ? <p className="bb-notice" id="brain-builder-loading">Loading your Brain…</p> : null}

        {!loading && !loadError ? (
          <div id="brain-builder-layout">
            <nav id="brain-builder-section-nav" aria-label="Brain sections">
              <ol>
                {BRAIN_FORM_SECTIONS.map((section) => {
                  const sp = sectionProgress(section, draft);
                  return (
                    <li key={section.id}>
                      <button type="button" className="bb-nav-link" aria-current={activeSection === section.id ? 'true' : undefined} onClick={() => jumpTo(section.id)}>
                        <span>{section.title}</span>
                        <span className="bb-nav-count" data-complete={sp.filled === sp.total ? 'true' : undefined}>{sp.filled}/{sp.total}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            <form id="brain-builder-form" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
              {BRAIN_FORM_SECTIONS.map((section) => (
                <section
                  key={section.id}
                  className="bb-section"
                  id={`brain-builder-section-${section.id}`}
                  data-section-id={section.id}
                  data-section="brain-builder-section"
                  aria-labelledby={`brain-builder-section-${section.id}-title`}
                  ref={(el) => { sectionRefs.current[section.id] = el; }}
                >
                  <h2 id={`brain-builder-section-${section.id}-title`}>{section.title}</h2>
                  {section.intro ? <p className="bb-section-intro">{section.intro}</p> : null}
                  <div className="bb-fields">
                    {section.fields.map((field) => (
                      <FieldBlock
                        key={field.key}
                        field={field}
                        value={draft[field.key]}
                        onChange={(next) => setDraft((prev) => ({ ...prev, [field.key]: next }))}
                        guidanceOpen={guidancePrefs[field.key] ?? isDesktop}
                        onToggleGuidance={() => toggleGuidance(field.key)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </form>
          </div>
        ) : null}
      </div>

      <div id="brain-builder-save-bar" role="region" aria-label="Save">
        <span className="bb-save-status" aria-live="polite">{saveError ? 'Save failed' : statusLine || `${progress.filled}/${progress.total} filled`}</span>
        <button type="button" className="bb-btn bb-btn-primary" disabled={saveDisabled} onClick={save}>{saveText}</button>
      </div>
    </div>
  );
}
