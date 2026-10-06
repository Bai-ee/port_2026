'use client';

import React, { useContext, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { FACET_FIELDS, VIBE, effectiveFacets } from '../../../features/x-content-inventory/facets.js';
import { storyMissing, thumbUrl, isVideoItem, useSignedMedia, isRenderedVideo, rightsBadge } from './ItemGrid.jsx';
import { NasContext, isNasItem } from './nas-context.js';
import { getThumbState } from './thumb-capture.js';

// ItemDrawer — facets (extracted vs your edit), story, bucket move, manual
// folder add, usage. Presentational: `onSave`/`onMove`/`onAddToFolder` go
// back to the parent. No post/schedule actions live here.

const EDITABLE = Object.keys(FACET_FIELDS).filter((f) => !['vibe', 'ocrText', 'storySuggestion'].includes(f));

const show = (v) => (Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v));

function parseField(field, text) {
  const t = text.trim();
  if (!t) return undefined;
  if (FACET_FIELDS[field] === 'array') return t.split(',').map((s) => s.trim()).filter(Boolean);
  if (FACET_FIELDS[field] === 'number') return Number.isFinite(Number(t)) ? Number(t) : undefined;
  return t;
}

const IMG_EXT = /\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i;

// One human-readable provenance line: Discogs link, render job id, or NAS path.
export function sourceLine(item) {
  const src = item?.source || {};
  const refs = (item?.assetRefs || []).filter((r) => typeof r === 'string');
  if (src.kind === 'discogs') {
    const url = src.url || (src.externalId ? `https://www.discogs.com/release/${src.externalId}` : '');
    return { label: 'Discogs', text: url || 'release', href: /^https?:\/\//.test(url) ? url : null };
  }
  const job = src.jobId || item?.renderJobId || item?.jobId || (refs.find((r) => r.startsWith('ev:')) || '').slice(3);
  if (job) return { label: 'Render job', text: String(job) };
  const nas = src.path || refs.find((r) => r.startsWith('/') || /^nas:/i.test(r));
  if (nas) return { label: 'NAS path', text: nas };
  if (src.url && /^https?:\/\//.test(src.url)) return { label: 'Source', text: src.url, href: src.url };
  return null;
}

function MediaPreview({ item, call }) {
  const rendered = isRenderedVideo(item);
  const signed = useSignedMedia(call, item, !rendered);
  const [vurl, setVurl] = useState(null);
  const [vloading, setVloading] = useState(false);
  useEffect(() => {
    setVurl(null);
    if (!rendered || !call) return undefined;
    let live = true;
    setVloading(true);
    call('media-urls', { ids: [item.id], kinds: ['video'] })
      .then((r) => { if (live) setVurl(r?.urls?.[item.id]?.videoUrl || null); })
      .catch(() => {})
      .finally(() => { if (live) setVloading(false); });
    return () => { live = false; };
  }, [item.id, rendered, call]);
  const cached = getThumbState(item.id)?.url;
  const media = rendered ? (vurl ? { videoUrl: vurl, posterUrl: cached || null } : cached ? { posterUrl: cached } : null) : signed.media;
  const loading = rendered ? vloading : signed.loading;
  const video = isVideoItem(item);
  const poster = media?.posterUrl || thumbUrl(item) || undefined;
  const directImg = (item?.assetRefs || []).find((r) => typeof r === 'string' && /^(https?:\/\/|\/)/.test(r) && IMG_EXT.test(r));
  let body = null;
  if (video && media?.videoUrl) body = <video controls preload="none" playsInline poster={poster} src={media.videoUrl} />;
  else if (!video && (poster || directImg)) body = <img src={poster || directImg} alt="" />;
  else if (loading) body = <span className="xce-field-hint">Loading media…</span>;
  else if (video && poster) body = <img src={poster} alt="" />;
  else return null;
  return <div id="x-content-item-media-preview" className="xce-bk-media-preview" data-kind={video ? 'video' : 'image'}>{body}</div>;
}

// NAS preview: full media from the laptop only while it is online; else the summary.
function NasPreview({ item }) {
  const { online, base } = useContext(NasContext);
  const [failed, setFailed] = useState(false);
  const sha = item?.nas?.sha256;
  useEffect(() => { setFailed(false); }, [sha, online]);
  const video = item?.mediaType === 'video';
  const src = online && base && sha && !failed ? `${base}/media/${sha}` : null;
  return (
    <div id="x-content-nas-preview" className="xce-bk-media-preview" data-kind={video ? 'video' : 'image'}>
      {src ? (video ? <video controls preload="none" playsInline src={src} onError={() => setFailed(true)} /> : <img src={src} alt="" onError={() => setFailed(true)} />)
        : <p className="xce-field-hint">{item?.summary || 'Preview needs the laptop online.'}</p>}
    </div>
  );
}

function NasDetails({ item, call, onReload }) {
  const [st, setSt] = useState({ busy: false, error: '', staged: !!item?.staged?.storagePath });
  useEffect(() => { setSt({ busy: false, error: '', staged: !!item?.staged?.storagePath }); }, [item?.id, item?.staged?.storagePath]);
  const stage = async () => {
    if (typeof window !== 'undefined' && !window.confirm('Uploads this file to Firebase so it can be scheduled')) return;
    setSt((s) => ({ ...s, busy: true, error: '' }));
    try {
      const r = await call('nas-stage', { id: item.id });
      if (!r || r.ok === false) throw new Error(r?.error || 'Could not stage.');
      setSt({ busy: false, error: '', staged: true });
      if (onReload) onReload();
    } catch (err) { setSt((s) => ({ ...s, busy: false, error: err.message || 'Could not stage.' })); }
  };
  const nas = item.nas || {};
  return (
    <div id="x-content-nas-details" className="xce-bk-facets">
      <p className="xce-kicker">NAS file</p>
      {item.summary ? <p id="x-content-nas-summary" className="xce-field-hint">{item.summary}</p> : null}
      {item.activity ? <p className="xce-field-hint">Activity: {item.activity}</p> : null}
      {item.peopleCount != null ? <p className="xce-field-hint">People: {item.peopleCount}</p> : null}
      {nas.relativePath ? <p id="x-content-nas-path" className="xce-bk-source"><span className="xce-kicker">Path</span> <span>{nas.relativePath}</span></p> : null}
      <div id="x-content-nas-stage-row" className="xce-bk-action-row">
        {st.staged ? (
          <span id="x-content-nas-staged" className="xce-chip xce-chip-ok">{item?.staged?.storagePath ? 'Ready to schedule' : 'Staged'}</span>
        ) : (
          <button type="button" id="x-content-nas-stage" className="xce-btn-ghost" disabled={st.busy} onClick={stage}>{st.busy ? 'Uploading…' : 'Use for posting'}</button>
        )}
      </div>
      {st.error ? <p className="xce-error" id="x-content-nas-stage-error">{st.error}</p> : null}
    </div>
  );
}

export default function ItemDrawer({ call, item, buckets, manualFolders, busy, error, onClose, onSave, onMove, onAddToFolder, onReload }) {
  const [draft, setDraft] = useState({});
  const [act, setAct] = useState({ busy: false, error: '', postId: null, cleared: false });
  const [vibe, setVibe] = useState({});
  const [story, setStory] = useState('');

  useEffect(() => {
    const eff = { ...(item?.facets || {}), ...(item?.humanEdits || {}) };
    setDraft(Object.fromEntries(EDITABLE.map((f) => [f, show(eff[f])])));
    setVibe({ ...(eff.vibe || {}) });
    setStory(storyMissing(item) ? '' : String(item?.story ?? ''));
    setAct({ busy: false, error: '', postId: null, cleared: false });
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const extracted = item?.facets || {};
  const edits = item?.humanEdits || {};
  const eff = useMemo(() => effectiveFacets(item || {}), [item]);

  if (!item) return null;

  const save = () => {
    const humanEdits = { ...edits };
    for (const f of EDITABLE) {
      const next = parseField(f, draft[f] ?? '');
      const base = show(extracted[f]);
      if (next === undefined) { if (!base) delete humanEdits[f]; else if (f in edits) delete humanEdits[f]; continue; }
      if (show(next) !== base || f in edits) humanEdits[f] = next;
    }
    const cleanVibe = Object.fromEntries(Object.entries(vibe).filter(([, v]) => v));
    if (Object.keys(cleanVibe).length) humanEdits.vibe = cleanVibe; else delete humanEdits.vibe;
    onSave(item.id, humanEdits, story);
  };

  const rights = rightsBadge(item);
  const thirdParty = isRenderedVideo(item) && item.rights !== 'owned' && item.rights !== 'cleared' && !act.cleared;
  const neverPublic = item.rights === 'never-public';
  const runAct = async (fn) => {
    setAct((a) => ({ ...a, busy: true, error: '' }));
    try { await fn(); } catch (err) { setAct((a) => ({ ...a, error: err.message || 'Action failed.' })); } finally { setAct((a) => ({ ...a, busy: false })); }
  };
  const createDraft = () => runAct(async () => {
    const r = await call('create-draft-from-item', { id: item.id });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not create a draft.');
    setAct((a) => ({ ...a, postId: r.postId || 'ok' }));
  });
  const clearForPosting = () => runAct(async () => {
    const r = await call('set-rights', { id: item.id, rights: 'cleared' });
    if (!r || r.ok === false) throw new Error(r?.error || 'Could not update rights.');
    setAct((a) => ({ ...a, cleared: true }));
    if (onReload) await onReload();
  });

  const storyChanged = story !== (storyMissing(item) ? '' : String(item.story ?? ''));

  return (
    <div id="x-content-item-drawer-backdrop" className="xce-bk-drawer-backdrop">
      <section id="x-content-item-drawer" className="xce-bk-drawer" role="dialog" aria-label="Item details">
        <header id="x-content-item-drawer-header" className="xce-bk-drawer-head">
          <div>
            <p className="xce-inv-title">{item.title || item.id}</p>
            <p className="xce-inv-meta">{item.id}</p>
          </div>
          <button type="button" className="xce-bk-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        {error ? <p className="xce-error">{error}</p> : null}

        {isNasItem(item) ? <NasPreview item={item} /> : <MediaPreview item={item} call={call} />}
        {isNasItem(item) ? <NasDetails item={item} call={call} onReload={onReload} /> : null}
        {(() => {
          const src = sourceLine(item);
          return src ? (
            <p id="x-content-item-source-line" className="xce-bk-source">
              <span className="xce-kicker">{src.label}</span>{' '}
              {src.href ? <a href={src.href} target="_blank" rel="noopener noreferrer">{src.text}</a> : <span>{src.text}</span>}
            </p>
          ) : null;
        })()}
        {(() => {
          const chips = [...(eff.people || []), ...(eff.gear || []), ...(eff.genres || []), ...(eff.venues || []), ...(eff.labels || []), ...(eff.eraYear ? [String(eff.eraYear)] : [])];
          return chips.length ? (
            <div id="x-content-item-facet-chips" className="xce-bk-chips">
              {chips.slice(0, 16).map((c, i) => <span key={`${c}-${i}`} className="xce-chip xce-chip-status">{c}</span>)}
            </div>
          ) : null;
        })()}

        <div id="x-content-item-drawer-usage" className="xce-bk-usage">
          Used {item.postCount ?? 0} time{(item.postCount ?? 0) === 1 ? '' : 's'}
          {item.lastPostedAt ? ` · last posted ${String(item.lastPostedAt).slice(0, 10)}` : ' · never posted'}
        </div>

        <div id="x-content-item-drawer-story" className="xce-field">
          <label htmlFor="x-content-item-story">Story {storyMissing(item) ? <span className="xce-chip xce-chip-warn">missing</span> : null}</label>
          <textarea id="x-content-item-story" className="xce-textarea" value={story} onChange={(e) => setStory(e.target.value)}
            placeholder="The story is the post. Write what only you can say." />
          {item.facets?.storySuggestion ? <p className="xce-field-hint">Suggested: {item.facets.storySuggestion}</p> : null}
        </div>

        <div id="x-content-item-drawer-facets" className="xce-bk-facets">
          <p className="xce-kicker">Facets</p>
          {EDITABLE.map((f) => {
            const edited = f in edits;
            return (
              <div key={f} className="xce-field">
                <label htmlFor={`x-content-facet-${f}`}>{f}{edited ? ' · your edit' : show(extracted[f]) ? ' · extracted' : ''}</label>
                <input id={`x-content-facet-${f}`} className="xce-input" value={draft[f] ?? ''}
                  placeholder={FACET_FIELDS[f] === 'array' ? 'comma, separated' : ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} />
                {edited && show(extracted[f]) ? <p className="xce-field-hint">Extracted: {show(extracted[f])}</p> : null}
              </div>
            );
          })}
          <div id="x-content-item-drawer-vibe-row" className="xce-bk-share-row">
            {Object.keys(VIBE).map((k) => (
              <div key={k} className="xce-field"><label htmlFor={`x-content-facet-vibe-${k}`}>vibe {k}</label>
                <select id={`x-content-facet-vibe-${k}`} className="xce-select" value={vibe[k] || ''} onChange={(e) => setVibe((v) => ({ ...v, [k]: e.target.value }))}>
                  <option value="">—</option>{VIBE[k].map((o) => <option key={o}>{o}</option>)}
                </select></div>
            ))}
          </div>
          {(eff.people || []).length ? null : <p className="xce-field-hint">No people recorded yet.</p>}
        </div>

        <div id="x-content-item-drawer-draft-panel" className="xce-bk-facets">
          <p className="xce-kicker">Post this {rights ? <span className={`xce-chip ${act.cleared ? 'xce-chip-ok' : rights.cls}`}>{act.cleared ? 'Cleared' : rights.label}</span> : null}</p>
          <div id="x-content-item-drawer-draft-actions" className="xce-bk-action-row">
            <button type="button" id="x-content-item-create-draft" className="xce-btn-primary" disabled={act.busy || busy || neverPublic || thirdParty} onClick={createDraft}>
              {act.busy ? 'Working…' : 'Create draft'}
            </button>
            {isRenderedVideo(item) && thirdParty && !neverPublic ? (
              <button type="button" id="x-content-item-clear-rights" className="xce-btn-ghost" disabled={act.busy || busy} onClick={clearForPosting}>Clear for posting</button>
            ) : null}
          </div>
          {neverPublic ? <p className="xce-field-hint">Marked never-public. It cannot become a draft.</p> : null}
          {!neverPublic && thirdParty ? <p className="xce-field-hint">Third-party set. Clear it for posting before drafting.</p> : null}
          {act.postId ? <p id="x-content-item-draft-created" className="xce-field-hint">Draft created. Open it in Calendar or Copywriter.</p> : null}
          {act.error ? <p className="xce-error" id="x-content-item-draft-error">{act.error}</p> : null}
        </div>

        <div id="x-content-item-drawer-actions" className="xce-actions">
          <button type="button" className="xce-btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : storyChanged ? 'Save facets + story' : 'Save facets'}</button>
        </div>

        <div id="x-content-item-drawer-organize" className="xce-bk-facets">
          <div className="xce-field"><label htmlFor="x-content-item-move">Move to bucket</label>
            <select id="x-content-item-move" className="xce-select" value={item._bucketId || ''} disabled={busy} onChange={(e) => onMove(item.id, e.target.value)}>
              {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select></div>
          <div className="xce-field"><label htmlFor="x-content-item-folder">Add to manual folder</label>
            <select id="x-content-item-folder" className="xce-select" value="" disabled={busy || !manualFolders.length} onChange={(e) => e.target.value && onAddToFolder(e.target.value, item.id)}>
              <option value="">{manualFolders.length ? 'Choose folder…' : 'No manual folders yet'}</option>
              {manualFolders.map((f) => <option key={f.id} value={f.id}>{f.name}{(f.itemIds || []).includes(item.id) ? ' ✓' : ''}</option>)}
            </select></div>
        </div>
      </section>
    </div>
  );
}
