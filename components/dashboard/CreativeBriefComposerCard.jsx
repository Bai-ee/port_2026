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

export function CreativeBriefComposerView({ user }) {
  const [tab, setTab] = useState('settings'); // 'settings' | 'preview'
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [groups, setGroups] = useState([]);
  const [form, setForm] = useState(null); // { include, order }
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // { kind: 'pending'|'ok'|'error', msg }
  const [previewNonce, setPreviewNonce] = useState(0);
  const cancelledRef = useRef(false);

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
  // (re)loading the iframe so preview == what a new signup gets.
  const openPreview = async () => {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setPreviewNonce((n) => n + 1);
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
                  <p>What the new-signup Creative Brief renders, and in what order. Toggle any element off; ↑/↓ set its position within its group. Applies to every render of the brief (dashboard, PDF, published pages).</p>
                </div>
                <span className="label">{dirty ? 'Unsaved' : 'Saved'}</span>
              </div>

              {groups.map((group) => {
                const ord = Array.isArray(form.order?.[group.key]) ? form.order[group.key] : [];
                const oi = (id) => { const i = ord.indexOf(id); return i === -1 ? 999 : i; };
                const ordered = [...(group.items || [])].sort((a, b) => oi(a.id) - oi(b.id));
                return (
                  <div key={group.key} style={{ display: 'grid', gap: 8 }}>
                    <span className="label" style={{ marginTop: 4 }}>{group.label}</span>
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
                            style={{ position: 'relative', cursor: 'pointer' }}
                            onClick={() => toggle(item.id)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(item.id); } }}
                          >
                            <span className="check">{on ? '✓' : ''}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="toggle-title">{item.label}</span>
                              <span className="toggle-desc">{item.desc}</span>
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
        <div className="vrk-scope" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="label">Rendered with the saved config · HITLOOP sample data (same template every signup gets)</span>
            <button type="button" className="btn btn-outline" onClick={openPreview} disabled={saveStatus?.kind === 'pending'}>↻ Refresh</button>
          </div>
          <iframe
            id="creative-brief-composer-preview"
            key={previewNonce}
            title="Creative Brief preview"
            src={`/api/public/hitloop-creative-brief?v=${previewNonce}-${form ? Object.values(form.include || {}).filter(Boolean).length : 0}`}
            style={{ width: '100%', flex: 1, minHeight: 560, border: '1px solid rgba(42,36,32,0.08)', borderRadius: 8, background: '#fff' }}
          />
        </div>
      )}
    </div>
  );
}
