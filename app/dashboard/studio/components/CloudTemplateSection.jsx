'use client';

// CLOUD (Slice 3 — Cloud Template Persistence) — one reusable section,
// parameterized by `kind`, used inside all four existing local-template UI
// spots (Scene Templates card, Element Preset in the Inspector, Look Preset
// in the Effects card, Render Preset in the Render card) rather than four
// near-duplicated blocks. Talks to app/api/dashboard/studio-templates via
// the same `authedFetch` prop ClothStudio.jsx already threads through for
// the GLB asset library — no new auth mechanism. Every authorization
// decision (tenant isolation, admin-only Global) is enforced SERVER-SIDE
// (api/_lib/studio-templates.cjs) — this component's own admin-gating of
// the Promote button is a convenience, not the real boundary.
//
// Local template/preset behavior (elements/templates.js, elements/
// preset-kinds.js, and every existing localStorage save/load path) is
// completely untouched — this is an ADDITIONAL surface, not a replacement.

import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, Globe2, Lock, Users, Undo2 } from 'lucide-react';
import { GLASS, ui } from './rail-ui';

const SCOPE_META = {
  user: { label: 'Mine', icon: Lock },
  client: { label: 'Team', icon: Users },
  global: { label: 'Global', icon: Globe2 },
};

function ScopeBadge({ scope }) {
  const meta = SCOPE_META[scope] || SCOPE_META.client;
  const Icon = meta.icon;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, ...ui.label, color: GLASS.inkMute }}>
      <Icon size={10} strokeWidth={2.5} />{meta.label}
    </span>
  );
}

/**
 * @param {string} kind - 'scene' | 'element' | 'look' | 'render'
 * @param {Function|null} authedFetch - (url, init?) => Promise<Response>; same prop ClothStudio.jsx already passes for the GLB library. Cloud controls are hidden entirely when null (no session to authenticate with).
 * @param {boolean} isAdmin - gates the Promote-to-Global button's VISIBILITY only; the server re-checks independently.
 * @param {() => object} onCaptureRecipe - returns the current live recipe for this kind (e.g. captureSceneRecipe/captureLookPresetRecipe).
 * @param {(recipe: object) => void} onLoadRecipe - applies a fetched cloud recipe (e.g. applySceneRecipe/loadLookPresetById's own apply half) — called with the recipe object only, same "direct, explicit, non-undoable load" precedent local templates already use.
 * @param {number|null} [sourceSeed] - optional seed captured alongside the recipe (sceneSeed/lookSeed/camSeed as applicable).
 * @param {Array<{id:string,name:string,recipe:object}>} [localEntries] - the kind's existing LOCAL (localStorage) list, for the explicit "Copy to Cloud" action. Never uploaded automatically.
 * @param {boolean} [disabled] - e.g. Element Preset's own canSaveElementPreset gate.
 */
export default function CloudTemplateSection({
  kind, authedFetch, isAdmin, onCaptureRecipe, onLoadRecipe, sourceSeed = null, localEntries = [], disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [cloudList, setCloudList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [saveScope, setSaveScope] = useState('client');

  const refresh = useCallback(async () => {
    if (!authedFetch) return;
    setLoading(true);
    try {
      const res = await authedFetch(`/api/dashboard/studio-templates?kind=${encodeURIComponent(kind)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCloudList(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setStatus(err.message || 'Could not load cloud templates.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch, kind]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  const post = useCallback(async (body) => {
    const res = await authedFetch('/api/dashboard/studio-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }, [authedFetch]);

  const saveToCloud = useCallback(async (name, scope, recipeOverride) => {
    if (!authedFetch) return;
    try {
      await post({ action: 'create', kind, scope, name, recipe: recipeOverride || onCaptureRecipe(), sourceSeed });
      setStatus(`Saved "${name}" to cloud (${SCOPE_META[scope]?.label || scope}).`);
      setNameDraft('');
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Save failed.');
    }
  }, [authedFetch, post, kind, onCaptureRecipe, sourceSeed, refresh]);

  const loadFromCloud = useCallback((entry) => {
    onLoadRecipe(entry.recipe);
    setStatus(`Loaded "${entry.name}" from cloud.`);
  }, [onLoadRecipe]);

  const archive = useCallback(async (id) => {
    try {
      await post({ action: 'archive', id });
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Could not archive.');
    }
  }, [post, refresh]);

  const promote = useCallback(async (id) => {
    try {
      await post({ action: 'promote', id });
      setStatus('Promoted to Global.');
      await refresh();
    } catch (err) {
      setStatus(err.message || 'Could not promote.');
    }
  }, [post, refresh]);

  const copyLocalToCloud = useCallback((local) => {
    saveToCloud(local.name, saveScope, local.recipe);
  }, [saveToCloud, saveScope]);

  if (!authedFetch) return null; // no session — cloud controls have nothing to authenticate with

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8, paddingTop: 8, borderTop: '1px solid ' + GLASS.hair }}>
      <span style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 4 }}><Cloud size={11} strokeWidth={2.5} />CLOUD</span>

      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text" placeholder="Name…" value={nameDraft} disabled={disabled}
          onChange={(e) => setNameDraft(e.target.value)}
          style={{ ...ui.btn(), flex: 1, textAlign: 'left', paddingLeft: 10, opacity: disabled ? 0.4 : 1 }}
        />
        <select
          value={saveScope} onChange={(e) => setSaveScope(e.target.value)} disabled={disabled}
          style={{ ...ui.btn(), appearance: 'none', opacity: disabled ? 0.4 : 1 }}
        >
          <option value="user">Mine</option>
          <option value="client">Team</option>
          {isAdmin ? <option value="global">Global</option> : null}
        </select>
        <button
          style={{ ...ui.btn(), padding: '0 12px', opacity: disabled || !nameDraft.trim() ? 0.4 : 1 }}
          disabled={disabled || !nameDraft.trim()}
          onClick={() => saveToCloud(nameDraft.trim(), saveScope)}
        >
          Save
        </button>
      </div>

      <button style={{ ...ui.btn(open), width: '100%', fontSize: 10, height: 26 }} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide cloud list' : loading ? 'Loading…' : `Show cloud list${cloudList.length ? ` (${cloudList.length})` : ''}`}
      </button>

      {open ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {cloudList.length ? cloudList.map((entry) => (
            <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <ScopeBadge scope={entry.scope} />
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
              <button style={{ ...ui.btn(), height: 24, padding: '0 8px', fontSize: 9 }} onClick={() => loadFromCloud(entry)}>Load</button>
              {entry.scope !== 'global' || isAdmin ? (
                // Archiving a Global template is admin-only server-side (403 for
                // everyone else) — don't offer a button that can only ever fail.
                <button style={{ ...ui.btn(), height: 24, padding: '0 8px', fontSize: 9 }} onClick={() => archive(entry.id)}>Remove</button>
              ) : null}
              {isAdmin && entry.scope !== 'global' ? (
                <button style={{ ...ui.btn(), height: 24, padding: '0 8px', fontSize: 9 }} onClick={() => promote(entry.id)}>
                  <Globe2 size={10} strokeWidth={2.5} style={{ marginRight: 3 }} />Promote
                </button>
              ) : null}
            </div>
          )) : (
            <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute }}>No cloud entries yet.</span>
          )}
        </div>
      ) : null}

      {localEntries.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          <span style={ui.label}>COPY LOCAL → CLOUD</span>
          {localEntries.map((local) => (
            <div key={local.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{local.name}</span>
              <button style={{ ...ui.btn(), height: 24, padding: '0 8px', fontSize: 9 }} onClick={() => copyLocalToCloud(local)}>
                <Undo2 size={10} strokeWidth={2.5} style={{ marginRight: 3, transform: 'rotate(180deg)' }} />Copy to Cloud
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {status ? <span style={{ fontFamily: GLASS.sans, fontSize: 10, color: GLASS.inkMute }}>{status}</span> : null}
    </label>
  );
}
