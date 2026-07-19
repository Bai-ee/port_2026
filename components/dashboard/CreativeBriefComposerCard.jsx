'use client';

// CreativeBriefComposerView — the admin "Brief Composer" card.
//
// Organizes the new-signup Creative Brief: every element (cover blocks, body
// pages, and each page's inner blocks) toggles on/off and reorders with ↑/↓,
// mirroring the Email Digest card's toggle-card grid (.vrk-scope UI kit).
//
// SETTINGS  — grouped toggle cards, explicit Save (writes
//             system_flags/creative_brief_config via /api/admin/creative-brief-config).
// PREVIEW   — the live onboarding Creative Brief honoring the SAVED config
//             (public HITLOOP sample route, cache-busted per refresh; switching
//             to the tab saves first so preview == saved == what signups get).
//
// Section registry lives server-side in features/scout-intake/
// creative-brief-config.cjs (CJS — never import it here) and arrives via GET.

import React, { useCallback, useEffect, useRef, useState } from 'react';

const emptyWrap = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '32px 16px', textAlign: 'center' };
const emptyLabel = { fontFamily: 'var(--vrk-mono, monospace)', fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--vrk-ink, #2a2420)' };
const emptyBody = { fontSize: 13, color: 'var(--vrk-ink-soft, #5a5346)', maxWidth: 420 };

// A group whose key IS an item id inside the layout's page-list group
// ('pages' / 'sb-pages') holds that page's child elements — they only render
// while the parent page is on. Surfaced in the UI so a child toggle never
// reads as broken while its page is off.
const PAGE_LIST_KEYS = new Set(['pages', 'sb-pages']);

export function CreativeBriefComposerView({ user }) {
  const [tab, setTab] = useState('settings'); // 'settings' | 'preview'
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [groups, setGroups] = useState([]);
  const [simpleGroups, setSimpleGroups] = useState([]);
  const [form, setForm] = useState(null); // { layout, include, order }
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // { kind: 'pending'|'ok'|'error', msg }
  const [previewNonce, setPreviewNonce] = useState(0);
  // Measured height of the brief inside the preview iframe — sizing the iframe
  // to its content kills the nested inner-scroll (the modal/page scrolls the
  // whole brief instead, which is what you want on mobile).
  const [previewHeight, setPreviewHeight] = useState(0);
  const cancelledRef = useRef(false);

  const measurePreview = useCallback((el) => {
    try {
      const doc = el?.contentDocument;
      const h = Math.max(doc?.documentElement?.scrollHeight || 0, doc?.body?.scrollHeight || 0);
      // Sanity ceiling — a runaway measurement (vh feedback) must never wedge
      // the modal; ?fit=1 on the preview URL keeps it convergent in practice.
      if (h > 0 && h < 60000 && !cancelledRef.current) setPreviewHeight(h);
    } catch { /* cross-origin safety — same-origin in practice */ }
  }, []);

  const handlePreviewLoad = useCallback((e) => {
    const el = e.currentTarget;
    measurePreview(el);
    // Fonts/images/videos land after load and grow the brief — re-measure.
    [600, 1500, 3500].forEach((ms) => setTimeout(() => measurePreview(el), ms));
  }, [measurePreview]);

  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/creative-brief-config', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Could not load composer config.');
        if (cancelledRef.current) return;
        setGroups(Array.isArray(data.groups) ? data.groups : []);
        setSimpleGroups(Array.isArray(data.simpleGroups) ? data.simpleGroups : []);
        setForm(data.config || null);
      } catch (err) {
        if (!cancelledRef.current) setLoadError(err instanceof Error ? err.message : 'Load failed.');
      } finally {
        if (!cancelledRef.current) setLoading(false);
      }
    })();
    return () => { cancelledRef.current = true; };
  }, [user]);

  const save = useCallback(async (nextForm) => {
    const body = nextForm || form;
    if (!body) return false;
    setSaveStatus({ kind: 'pending', msg: 'Saving…' });
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/creative-brief-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Save failed.');
      if (!cancelledRef.current) {
        if (data.config) setForm(data.config);
        setDirty(false);
        setSaveStatus({ kind: 'ok', msg: 'Saved' });
        setTimeout(() => { if (!cancelledRef.current) setSaveStatus(null); }, 2500);
      }
      return true;
    } catch (err) {
      if (!cancelledRef.current) setSaveStatus({ kind: 'error', msg: err instanceof Error ? err.message : 'Save failed.' });
      return false;
    }
  }, [form, user]);

  const toggle = (id) => {
    setForm((f) => (f ? { ...f, include: { ...(f.include || {}), [id]: f.include?.[id] === false } } : f));
    setDirty(true);
  };

  const move = (groupKey, id, dir) => {
    setForm((f) => {
      if (!f) return f;
      const base = Array.isArray(f.order?.[groupKey]) ? [...f.order[groupKey]] : [];
      const i = base.indexOf(id);
      const j = i + dir;
      if (i === -1 || j < 0 || j >= base.length) return f;
      [base[i], base[j]] = [base[j], base[i]];
      return { ...f, order: { ...f.order, [groupKey]: base } };
    });
    setDirty(true);
  };

  // Preview always reflects the SAVED config — save any dirty edits before
  // (re)loading the iframe so preview == what a new signup gets. Timestamp
  // nonce: the sample route is CDN-cached (s-maxage + a day of SWR), so the
  // bust key must be globally unique per refresh, never session-relative.
  const openPreview = async () => {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setPreviewHeight(0);
    setPreviewNonce(Date.now());
    setTab('preview');
  };

  return (
    <div className="tile-detail-tab-content" id="creative-brief-composer-root">
      <div className="tile-detail-tabs" role="tablist">
        <button type="button" className={`tile-detail-tab${tab === 'settings' ? ' tile-detail-tab--active' : ''}`} onClick={() => setTab('settings')}>SETTINGS</button>
        <button type="button" className={`tile-detail-tab${tab === 'preview' ? ' tile-detail-tab--active' : ''}`} onClick={openPreview}>BRIEF PREVIEW</button>
      </div>

      {tab === 'settings' ? (
        loading ? (
          <div style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Loading composer…</span></div>
        ) : loadError ? (
          <div style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>Composer failed</span><span style={emptyBody}>{loadError}</span></div>
        ) : !form ? (
          <div style={{ ...emptyWrap, minHeight: 320 }}><span style={emptyLabel}>No config</span></div>
        ) : (
          <div className="vrk-scope" id="creative-brief-composer-shell" style={{ display: 'grid', gap: 16, padding: 16, alignContent: 'start', overflowY: 'auto' }}>
            <section className="section">
              <div className="section-head">
                <span className="index">01</span>
                <div>
                  <h3>Creative Brief content</h3>
                  <p>What the new-signup Creative Brief renders, and in what order. Toggle any element off; ↑/↓ set its position within its group; the H chip toggles a section&apos;s heading. Applies to every render of the brief (dashboard, PDF, published pages).</p>
                </div>
                <span className="label">{dirty ? 'Unsaved' : 'Saved'}</span>
              </div>

              <div className="field" style={{ display: 'grid', gap: 6 }}>
                <span className="label">Layout (A/B)</span>
                <div className="segmented" role="group" aria-label="Brief layout">
                  <button type="button" className={(form.layout || 'classic') === 'classic' ? 'is-active' : ''} onClick={() => { setForm((f) => ({ ...f, layout: 'classic' })); setDirty(true); }}>Classic</button>
                  <button type="button" className={form.layout === 'simple' ? 'is-active' : ''} onClick={() => { setForm((f) => ({ ...f, layout: 'simple' })); setDirty(true); }}>Simple</button>
                </div>
                <span className="hint">Classic = the as-built brief. Simple = the streamlined structure (own toggles below — everything starts ON, spec-removed extras start OFF). Save applies the layout to every client&apos;s Creative Brief.</span>
              </div>

              {(form.layout === 'simple' ? simpleGroups : groups).map((group) => {
                const ord = Array.isArray(form.order?.[group.key]) ? form.order[group.key] : [];
                const oi = (id) => { const i = ord.indexOf(id); return i === -1 ? 999 : i; };
                const ordered = [...(group.items || [])].sort((a, b) => oi(a.id) - oi(b.id));
                // Child elements of a toggled-off page still save, but render
                // nothing until the page is back on — say so instead of
                // looking like a broken toggle.
                const activeGroups = form.layout === 'simple' ? simpleGroups : groups;
                const pageList = activeGroups.find((g) => PAGE_LIST_KEYS.has(g.key));
                const parentItem = group.key !== pageList?.key
                  ? (pageList?.items || []).find((i) => i.id === group.key)
                  : null;
                const parentOff = Boolean(parentItem) && form.include?.[group.key] === false;
                const parentLabel = parentOff ? (parentItem?.label || group.key) : null;
                return (
                  <div key={group.key} style={{ display: 'grid', gap: 8 }}>
                    <span className="label" style={{ marginTop: 4 }}>
                      {group.label}
                      {parentOff ? <span style={{ color: 'var(--danger, #9f1f17)', textTransform: 'none', letterSpacing: 0 }}> · hidden — its page “{parentLabel}” is OFF in Brief pages</span> : null}
                    </span>
                    <div className="toggle-grid" role="group" aria-label={`${group.label} elements`}>
                      {ordered.map((item, idx) => {
                        const on = form.include?.[item.id] !== false;
                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            className={`toggle-card${on ? ' is-on' : ''}`}
                            style={{ position: 'relative', cursor: 'pointer', opacity: parentOff ? 0.55 : 1 }}
                            onClick={() => toggle(item.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(item.id); } }}
                          >
                            <span className="check">{on ? '✓' : ''}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="toggle-title">{item.label}</span>
                              <span className="toggle-desc">{parentOff ? `Saved, but hidden until the “${parentLabel}” page is turned back on.` : item.desc}</span>
                              {item.hasHeading ? (
                                <button
                                  type="button"
                                  aria-pressed={form.include?.[`${item.id}:heading`] !== false}
                                  title="Toggle this section's heading"
                                  onClick={(e) => { e.stopPropagation(); toggle(`${item.id}:heading`); }}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, padding: '3px 8px', border: '1px solid rgba(42,36,32,0.18)', borderRadius: 999, background: form.include?.[`${item.id}:heading`] !== false ? 'rgba(42,36,32,0.08)' : 'rgba(255,255,255,0.7)', cursor: 'pointer', font: '700 10px/1 var(--vrk-mono, monospace)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--vrk-ink, #2a2420)', opacity: form.include?.[`${item.id}:heading`] !== false ? 1 : 0.55 }}
                                >
                                  H · Heading {form.include?.[`${item.id}:heading`] !== false ? 'on' : 'off'}
                                </button>
                              ) : null}
                            </span>
                            <span style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                              <button type="button" aria-label={`Move ${item.label} up`} disabled={idx === 0} onClick={(e) => { e.stopPropagation(); move(group.key, item.id, -1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1, fontSize: 11 }}>↑</button>
                              <button type="button" aria-label={`Move ${item.label} down`} disabled={idx === ordered.length - 1} onClick={(e) => { e.stopPropagation(); move(group.key, item.id, 1); }} style={{ width: 22, height: 22, lineHeight: '20px', textAlign: 'center', padding: 0, border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, background: 'rgba(255,255,255,0.7)', cursor: idx === ordered.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === ordered.length - 1 ? 0.4 : 1, fontSize: 11 }}>↓</button>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
                <button type="button" className="btn" style={{ background: '#2a2420', color: '#fff', borderColor: '#2a2420' }} onClick={() => save()} disabled={saveStatus?.kind === 'pending' || !dirty}>
                  {saveStatus?.kind === 'pending' ? 'Saving…' : 'Save Settings'}
                </button>
                {saveStatus && saveStatus.kind !== 'pending' ? (
                  <span className="label" style={saveStatus.kind === 'error' ? { color: 'var(--danger, #9f1f17)' } : { color: 'var(--vrk-success, #285f3b)' }}>{saveStatus.msg}</span>
                ) : null}
              </div>
            </section>
          </div>
        )
      ) : (
        <div className="vrk-scope" id="creative-brief-composer-preview-shell" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, flex: '1 0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="label">
              Previewing: <span style={{ color: 'var(--vrk-success, #285f3b)' }}>{form?.layout === 'simple' ? 'SIMPLE' : 'CLASSIC'} layout</span> · saved config · HITLOOP sample data (same template every signup gets)
            </span>
            <button type="button" className="btn btn-outline" onClick={openPreview} disabled={saveStatus?.kind === 'pending'}>↻ Refresh</button>
          </div>
          <iframe
            id="creative-brief-composer-preview"
            key={previewNonce}
            title="Creative Brief preview"
            src={`/api/public/hitloop-creative-brief?v=${previewNonce}&layout=${form?.layout === 'simple' ? 'simple' : 'classic'}&fit=1`}
            onLoad={handlePreviewLoad}
            scrolling={previewHeight ? 'no' : 'auto'}
            style={{
              width: '100%',
              border: '1px solid rgba(42,36,32,0.08)',
              borderRadius: 8,
              background: '#fff',
              // Content-sized: the surrounding page scrolls the whole brief —
              // no nested iframe scroll. Falls back to a viewport-ish box
              // until the first measurement lands.
              ...(previewHeight
                ? { height: previewHeight, flex: '0 0 auto', overflow: 'hidden' }
                : { flex: 1, minHeight: 560 }),
            }}
          />
        </div>
      )}
    </div>
  );
}
