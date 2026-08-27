'use client';

// Paint Studio — the PAINT mode of the Studio workspace (?tool=paint). A
// first-party procedural-wallpaper authoring surface: pick a p5.js template
// (Watercolour Bloom / Botanical Weave / Pigment Burst), tune palette,
// composition, texture, and seed, save a versioned recipe locally, and
// export an exact-size lossless PNG plus a provenance JSON. No AI image
// generation, no arbitrary code execution, no diffusion model — see
// docs/plans/PAINT_STUDIO_PLAN.md.
//
// Self-contained like ClothStudio (?tool=cloth): owns its own board + rail
// markup entirely, only reading `isNarrow`/`railW` from the shared page
// shell for responsive layout parity. Reuses the shared rail tokens
// (GLASS/ui/RailCard/Slider) from ./components/rail-ui — do not redefine
// those here.
//
// V1 is intentionally local-only: saved recipes live in localStorage
// (./storage.js) and export is a client-side render + browser download.
// `authedFetch` is accepted for prop-shape parity with ClothStudio but
// unused — authenticated/shared storage and a client-safe capability model
// are Phase 3 of the plan, explicitly out of scope here.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutTemplate, Palette as PaletteIcon, Grid2x2, Droplets, Dices, Download,
  Bookmark, Shuffle, RotateCcw, Copy, Check, Save, Trash2, Files,
  Monitor, Smartphone, Square as SquareIcon, Type, CaseSensitive,
} from 'lucide-react';
import { GLASS, ui, RailCard, Slider } from '../components/rail-ui';
import { createRecipe, normalizeRecipe, migrateRecipe, buildProvenance } from './recipe';
import {
  listSavedRecipes, saveRecipe, updateRecipe as updateSavedRecipe, loadRecipe, duplicateRecipe, deleteRecipe,
} from './storage';
import { PAINT_OUTPUT_FORMATS } from './output-formats';
import { mountPaintPreview, renderRecipeToCanvas, PAINT_RENDERER_REVISION } from './renderer';
import { TEMPLATES, getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from './templates/index.js';
import { buildExportFilename, mobileAreaHeightFor } from './export-filename';
import { createRandomStart } from './variation';
import { isBookFormat } from './book-typography';

// Global params every template exposes (density/scale/composition render in
// the Composition card, texture in the Material/Texture card). Anything else
// in a template's schema.params is template-specific and renders in the
// Template card's own small "TEMPLATE CONTROLS" section instead.
const COMMON_PARAM_KEYS = ['density', 'scale', 'composition', 'texture'];

const TOAST_DURATIONS = { success: 6000, error: 8000 };

function humanizeParamKey(key) {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

// Triggers a real browser download of a Blob via a temporary anchor click —
// the same pattern used elsewhere in this app for client-side file saves.
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — some browsers need the click to actually start
  // the download before the object URL disappears.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PaintStudio({ isNarrow = false, railW = 336, authedFetch = null }) {
  void authedFetch; // Accepted for prop-shape parity with ClothStudio; V1 is local-only (see module header).

  // Paint opens as a title page, not a blank wallpaper: this makes the
  // primary book-illustration use case immediately visible and editable.
  const [recipe, setRecipe] = useState(() => createRecipe(DEFAULT_TEMPLATE_ID, {
    output: { formatId: 'chapter-page' }, text: { enabled: true, layout: 'chapter' },
  }));
  const template = useMemo(() => getTemplate(recipe.templateId), [recipe.templateId]);
  const templates = useMemo(() => listTemplates(), []);
  const schemaParams = (template && template.schema && template.schema.params) || {};
  const templateSpecificKeys = useMemo(
    () => Object.keys(schemaParams).filter((key) => !COMMON_PARAM_KEYS.includes(key) && !(template?.id === 'print-plates' && ['motif', 'layout', 'rhythm'].includes(key))),
    [schemaParams, template?.id]
  );

  const previewContainerRef = useRef(null);
  const previewControllerRef = useRef(null);

  const [savedRecipes, setSavedRecipes] = useState(() => listSavedRecipes());
  const [saveName, setSaveName] = useState('');
  const [activeSavedId, setActiveSavedId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState(null); // { kind: 'success'|'error', text }
  const [seedCopied, setSeedCopied] = useState(false);
  const [openCards, setOpenCards] = useState({
    template: false, palette: false, composition: false, texture: false,
    variation: false, printPlate: false, typography: false, legibility: false, exportCard: false, saved: false,
  });
  const toggleCard = useCallback((key) => {
    setOpenCards((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toastTimerRef = useRef(null);
  const showToast = useCallback((kind, text) => {
    setToast({ kind, text });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATIONS[kind] || 6000);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  // Mount the p5 preview once; every later recipe/template change just pushes
  // an update (cheap redraw — renderer.js remounts internally only if the
  // output pixel dimensions changed).
  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container || !template) return;
    if (!previewControllerRef.current) {
      previewControllerRef.current = mountPaintPreview(container, { template, recipe });
    } else {
      previewControllerRef.current.update(template, recipe);
    }
  }, [template, recipe]);

  useEffect(() => () => {
    if (previewControllerRef.current) {
      previewControllerRef.current.destroy();
      previewControllerRef.current = null;
    }
  }, []);

  const applyPatch = useCallback((patch) => {
    setRecipe((prev) => normalizeRecipe({ ...prev, ...patch }));
    setActiveSavedId(null);
  }, []);

  const updateParam = useCallback((key, value) => {
    setRecipe((prev) => normalizeRecipe({ ...prev, params: { ...prev.params, [key]: value } }));
    setActiveSavedId(null);
  }, []);

  const updateText = useCallback((patch) => {
    setRecipe((prev) => normalizeRecipe({ ...prev, text: { ...prev.text, ...patch } }));
    setActiveSavedId(null);
  }, []);

  const selectFormat = useCallback((formatId) => {
    setRecipe((prev) => normalizeRecipe({
      ...prev,
      output: { formatId },
      text: isBookFormat(formatId)
        ? { ...prev.text, enabled: true, layout: formatId === 'book-cover' ? 'cover' : 'chapter' }
        : prev.text,
    }));
    setActiveSavedId(null);
  }, []);

  const handleSelectTemplate = useCallback((nextTemplateId) => {
    if (nextTemplateId === recipe.templateId) return;
    setRecipe((prev) => createRecipe(nextTemplateId, { output: { formatId: prev.output.formatId }, text: prev.text }));
    setActiveSavedId(null);
  }, [recipe.templateId]);

  const handleRemix = useCallback(() => {
    // A new start is intentionally authoring-time random. It includes a
    // different launch direction plus safely bounded parameter levels; the
    // resulting saved recipe remains exactly reproducible from its seed.
    setRecipe((prev) => ({ ...createRandomStart(prev, TEMPLATES), text: prev.text }));
    setActiveSavedId(null);
  }, []);

  const handleArtShuffle = useCallback(() => {
    const directions = template && Array.isArray(template.directions) ? template.directions : [];
    if (!directions.length) { handleRemix(); return; }
    const current = Math.round(recipe.params.artDirection || 0);
    const offset = 1 + Math.floor(Math.random() * Math.max(1, directions.length - 1));
    const next = (current + offset) % directions.length;
    const newSeed = Math.floor(Math.random() * 0xffffffff);
    setRecipe((prev) => normalizeRecipe({ ...prev, seed: newSeed, params: { ...prev.params, artDirection: next } }));
    setActiveSavedId(null);
  }, [template, recipe.params.artDirection, handleRemix]);

  const handleReset = useCallback(() => {
    setRecipe((prev) => createRecipe(prev.templateId));
    setActiveSavedId(null);
  }, []);

  const handleSeedInputChange = useCallback((e) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) return;
    applyPatch({ seed: value });
  }, [applyPatch]);

  const handleCopySeed = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(String(recipe.seed));
      setSeedCopied(true);
      setTimeout(() => setSeedCopied(false), 1500);
    } catch {
      showToast('error', 'Could not copy the seed — try selecting it manually.');
    }
  }, [recipe.seed, showToast]);

  const handleSaveRecipe = useCallback(() => {
    const name = saveName.trim() || `${(template && template.label) || 'Untitled'} recipe`;
    if (activeSavedId) {
      const updated = updateSavedRecipe(activeSavedId, { name, recipe });
      if (updated) {
        setSavedRecipes(listSavedRecipes());
        showToast('success', `Updated "${name}".`);
        return;
      }
    }
    const entry = saveRecipe({ name, recipe });
    setSavedRecipes(listSavedRecipes());
    setActiveSavedId((entry && entry.id) || null);
    showToast('success', `Saved "${name}".`);
  }, [saveName, activeSavedId, recipe, template, showToast]);

  // Quick-save from the under-canvas row — always creates a NEW saved entry
  // (never silently overwrites a loaded one), named via a native prompt, the
  // same interaction idiom Mockup Video already uses for "Save as Template".
  const handleQuickSave = useCallback(() => {
    if (typeof window === 'undefined') return;
    const defaultName = `${(template && template.label) || 'Untitled'} — seed ${recipe.seed}`;
    const name = window.prompt('Save recipe as:', defaultName);
    if (!name) return;
    const entry = saveRecipe({ name, recipe });
    setSavedRecipes(listSavedRecipes());
    setActiveSavedId((entry && entry.id) || null);
    showToast('success', `Saved "${name}".`);
  }, [template, recipe, showToast]);

  const handleLoadRecipe = useCallback((id) => {
    const entry = loadRecipe(id);
    if (!entry) return;
    setRecipe(migrateRecipe(entry.recipe));
    setActiveSavedId(id);
    setSaveName(entry.name || '');
    showToast('success', `Loaded "${entry.name}".`);
  }, [showToast]);

  const handleDuplicateRecipe = useCallback((id) => {
    const clone = duplicateRecipe(id);
    if (clone) {
      setSavedRecipes(listSavedRecipes());
      showToast('success', `Duplicated as "${clone.name}".`);
    }
  }, [showToast]);

  const handleDeleteRecipe = useCallback((id) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    const removed = deleteRecipe(id);
    setConfirmDeleteId(null);
    if (removed) {
      setSavedRecipes(listSavedRecipes());
      setActiveSavedId((prev) => (prev === id ? null : prev));
      showToast('success', 'Deleted recipe.');
    }
  }, [confirmDeleteId, showToast]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    let canvas = null;
    try {
      const exportTemplate = getTemplate(recipe.templateId);
      canvas = await renderRecipeToCanvas(recipe, exportTemplate);
      const pngName = buildExportFilename(recipe, 'png');
      await new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('PNG encode failed')); return; }
          triggerDownload(blob, pngName);
          resolve();
        }, 'image/png');
      });
      const provenance = buildProvenance(recipe, {
        rendererRevision: PAINT_RENDERER_REVISION,
        createdAt: new Date().toISOString(),
      });
      const jsonBlob = new Blob([JSON.stringify(provenance, null, 2)], { type: 'application/json' });
      triggerDownload(jsonBlob, buildExportFilename(recipe, 'json'));
      showToast('success', `Exported ${recipe.output.width}×${recipe.output.height} PNG.`);
    } catch (err) {
      showToast('error', `Export failed: ${(err && err.message) || 'unknown error'}`);
    } finally {
      if (canvas && typeof canvas._paintCleanup === 'function') canvas._paintCleanup();
      setExporting(false);
    }
  }, [recipe, showToast]);

  const mobileAreaH = mobileAreaHeightFor(recipe.output);
  const artPadF = isNarrow ? 88 : 86;
  const oW = recipe.output.width;
  const oH = recipe.output.height;

  return (
    <>
      {/* ── Board — the p5 canvas fills the area left of the rail; the
          artboard IS the export frame (WYSIWYG). ── */}
      <div
        id="paint-studio-board"
        style={{
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 'none' }
            : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW }),
        }}
      >
        {/* containerType:'size' lets the artboard contain-fit via cqw/cqh —
            same technique as #studio-artboard-area in page.jsx. */}
        <div
          id="paint-studio-artboard-area"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            containerType: 'size', overflow: 'visible', paddingTop: 74, boxSizing: 'border-box',
            ...(isNarrow ? { height: mobileAreaH, flex: 'none' } : { flex: 1, minHeight: 0 }),
          }}
        >
          {/* Largest box of ratio oW:oH that fits artPadF% of the area,
              sized purely in CSS (no JS measurement). */}
          <div
            id="paint-studio-artboard"
            style={{
              width: `min(${artPadF}cqw, calc(${artPadF}cqh * ${oW} / ${oH}))`,
              aspectRatio: `${oW} / ${oH}`,
              position: 'relative',
              borderRadius: 16, overflow: 'hidden', background: '#ffffff',
              border: '1px solid rgba(255,255,255,0.6)',
              boxShadow: '0 18px 60px rgba(20,20,30,0.18), 0 2px 10px rgba(0,0,0,0.08)',
            }}
          >
            <div id="paint-preview-canvas-shell" ref={previewContainerRef} style={{ position: 'absolute', inset: 0 }} />
            {/* Output size chip — overlaid on the artwork corner, desktop only. */}
            <div style={{
              position: 'absolute', top: 10, left: 10, zIndex: 6, pointerEvents: 'none',
              ...ui.label, color: '#fff', background: 'rgba(0,0,0,0.5)',
              padding: '4px 10px', borderRadius: 999, backdropFilter: 'blur(6px)',
              display: isNarrow ? 'none' : 'block',
            }}>Output · {oW}×{oH}</div>
          </div>
        </div>

        {/* Under-canvas controls: format icons (left) · Remix + Save recipe
            (center) · primary Export PNG (right) — per the Video Studio UX
            kit's under-canvas control-row shape. */}
        <div
          id="paint-studio-undercanvas-row"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', flexShrink: 0,
            padding: isNarrow ? '10px 12px 16px' : '14px 24px 22px',
          }}
        >
          <div id="paint-undercanvas-format-group" style={{
            display: 'flex', gap: 6,
            ...(isNarrow ? { width: '100%', justifyContent: 'space-between', paddingBottom: 2 } : {}),
          }}>
            {PAINT_OUTPUT_FORMATS.map((format) => {
              const Icon = format.id === 'desktop' ? Monitor : format.id === 'mobile' ? Smartphone : SquareIcon;
              const active = recipe.output.formatId === format.id;
              return (
                <button
                  key={format.id}
                  title={`${format.label} · ${format.w}×${format.h}`}
                  onClick={() => selectFormat(format.id)}
                  style={{ ...ui.btn(active), width: 46, height: 46, borderRadius: 10, padding: 0, flexShrink: 0 }}
                >
                  <Icon size={17} strokeWidth={2} />
                </button>
              );
            })}
          </div>
          <div style={{
            display: 'flex', gap: 8, flex: 1, justifyContent: 'center', minWidth: 0,
            ...(isNarrow ? { width: '100%', flexBasis: '100%' } : {}),
          }}>
            <button onClick={handleRemix} style={{
              ...ui.btn(false), gap: 6,
              ...(isNarrow ? {
                flex: 1, minWidth: 0, fontWeight: 700, border: '1px solid #1a1a1a',
                background: 'rgba(255,255,255,0.9)', color: '#1a1a1a', boxShadow: 'none',
              } : {}),
            }}>
              <Shuffle size={14} strokeWidth={2.5} />Randomize all
            </button>
            {template && template.directions ? <button onClick={handleArtShuffle} title="Art shuffle" aria-label="Art shuffle" style={{ ...ui.btn(false), gap: 6, ...(isNarrow ? { width: 46, padding: 0, flexShrink: 0 } : {}) }}>
              <Dices size={14} strokeWidth={2.5} />{!isNarrow && 'Art shuffle'}
            </button> : null}
            <button onClick={handleQuickSave} title="Save recipe" aria-label="Save recipe" style={{ ...ui.btn(false), gap: 6, ...(isNarrow ? { width: 46, padding: 0, flexShrink: 0 } : {}) }}>
              <Save size={14} strokeWidth={2.5} />{!isNarrow && 'Save recipe'}
            </button>
          </div>
          <button
            id="paint-export-png-btn"
            className="cta-pill-btn"
            onClick={handleExport}
            disabled={exporting}
            style={{
              ...ui.cta, gap: 8, opacity: exporting ? 0.6 : 1, cursor: exporting ? 'default' : 'pointer',
              ...(isNarrow ? { width: '100%', flexBasis: '100%' } : {}),
            }}
          >
            <Download size={14} strokeWidth={2.5} />
            {exporting ? 'Exporting…' : 'Export PNG'}
          </button>
        </div>
      </div>

      {/* ── Right rail — Paint control cards. ── */}
      <div
        id="paint-studio-rail"
        data-tooltip-disabled="true"
        style={{
          boxSizing: 'border-box', maxWidth: '100%',
          display: 'flex', flexDirection: 'column', overflow: 'visible', background: 'transparent',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 1, minHeight: 0, padding: 12, overflowY: 'auto' }
            : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: 14, zIndex: 10, overflowY: 'auto' }),
        }}
      >
        {/* Rail-card states — page.jsx renders its copy only in mockup mode
            and ClothStudio brings its own, so Paint carries its own too. */}
        <style id="paint-rail-card-styles">{`
          #paint-studio-rail, #paint-studio-rail * { box-sizing: border-box; }
          .studio-rail-card {
            position: relative; border-radius: 1rem; overflow: hidden;
            background: rgba(255, 255, 255, 0.35);
            backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
            box-shadow: 0px 0px 0px rgba(0,0,0,0), inset 0 1px 0 rgba(255,255,255,0.22);
            transition: background 0.32s cubic-bezier(0.16,1,0.3,1), box-shadow 0.32s cubic-bezier(0.16,1,0.3,1);
          }
          @media (prefers-reduced-motion: reduce) { .studio-rail-card { transition: none; } }
          .studio-rail-card::before {
            content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px;
            background: rgba(176,176,182,0.6);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor; mask-composite: exclude;
            pointer-events: none; opacity: 0.85; transition: opacity 0.45s ease; z-index: 0;
          }
          .studio-rail-card-content { position: relative; z-index: 1; }
          .studio-rail-card-btn { position: relative; z-index: 1; }
          /* p5 sets an inline pixel style.width/height matching the exact
             output dimensions (e.g. 2560px) — override so the preview scales
             down to fit the artboard box; the export path renders a
             separate, full-resolution offscreen canvas untouched by this. */
          #paint-preview-canvas-shell canvas {
            width: 100% !important; height: 100% !important; display: block !important;
          }
        `}</style>

        <div id="paint-studio-rail-inner" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>

          <RailCard
            id="paint-template-card" icon={<LayoutTemplate size={18} strokeWidth={2} />} title="Template"
            subtitle={template && template.label} color="#f59e0b"
            open={openCards.template} onToggle={() => toggleCard('template')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t.id)}
                  style={{ ...ui.btn(t.id === recipe.templateId), width: '100%', justifyContent: 'flex-start', padding: '0 14px' }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {templateSpecificKeys.length ? (
              <>
                <span style={{ ...ui.label, marginTop: 6 }}>TEMPLATE CONTROLS</span>
                {templateSpecificKeys.map((key) => {
                  const bounds = schemaParams[key];
                  if (key === 'artDirection' && Array.isArray(template.directions)) {
                    return <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={ui.label}>ART DIRECTION · {template.directions[Math.round(recipe.params.artDirection || 0)]?.label}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {template.directions.map((direction, index) => <button key={direction.id} onClick={() => updateParam('artDirection', index)} style={{ ...ui.btn(Math.round(recipe.params.artDirection || 0) === index), height: 28, padding: '0 8px', fontSize: 9 }}>{direction.label}</button>)}
                      </div>
                    </div>;
                  }
                  return (
                    <Slider
                      key={key}
                      label={humanizeParamKey(key)}
                      min={bounds.min} max={bounds.max} step={bounds.step}
                      value={recipe.params[key]}
                      onChange={(v) => updateParam(key, v)}
                    />
                  );
                })}
              </>
            ) : null}
          </RailCard>

          {template?.id === 'print-plates' ? (
            <RailCard
              id="paint-print-plate-card" icon={<Grid2x2 size={18} strokeWidth={2} />} title="Print plate controls"
              subtitle={`${['Flower', 'Watermelon', 'Cloud', 'Lattice', 'Paisley', 'Tulip', 'Sunburst', 'Blocks'][Math.max(0, Math.round(recipe.params.motif ?? recipe.params.artDirection ?? 0))]} · ${['Grid', 'Half-drop', 'Diamond', 'Ring', 'Fan', 'Spiral', 'Scatter'][Math.max(0, Math.round(recipe.params.layout ?? 0))]}`}
              color="#d6a81f" open={openCards.printPlate} onToggle={() => toggleCard('printPlate')}
            >
              <span style={ui.label}>ORNAMENT</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {['Flower', 'Watermelon', 'Cloud', 'Lattice', 'Paisley', 'Tulip', 'Sunburst', 'Blocks'].map((label, index) => (
                  <button key={label} onClick={() => updateParam('motif', index)} style={{ ...ui.btn(Math.round(recipe.params.motif) === index), height: 30, padding: '0 9px', fontSize: 10 }}>{label}</button>
                ))}
              </div>
              <span style={{ ...ui.label, marginTop: 6 }}>LAYOUT</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {['Grid', 'Half-drop', 'Diamond', 'Ring', 'Fan', 'Spiral', 'Scatter'].map((label, index) => (
                  <button key={label} onClick={() => updateParam('layout', index)} style={{ ...ui.btn(Math.round(recipe.params.layout) === index), height: 30, padding: '0 9px', fontSize: 10 }}>{label}</button>
                ))}
              </div>
              <span style={{ ...ui.label, marginTop: 6 }}>RHYTHM</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {['Straight', 'Flipped', 'Mirrored'].map((label, index) => (
                  <button key={label} onClick={() => updateParam('rhythm', index)} style={{ ...ui.btn(Math.round(recipe.params.rhythm || 0) === index), height: 30, padding: '0 9px', fontSize: 10 }}>{label}</button>
                ))}
              </div>
            </RailCard>
          ) : null}

          <RailCard
            id="paint-palette-card" icon={<PaletteIcon size={18} strokeWidth={2} />} title="Palette"
            subtitle={template && template.palettes && template.palettes.find((p) => p.id === recipe.paletteId)?.label}
            color="#ec4899"
            open={openCards.palette} onToggle={() => toggleCard('palette')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(template && template.palettes ? template.palettes : []).map((palette) => (
                <button
                  key={palette.id}
                  onClick={() => applyPatch({ paletteId: palette.id })}
                  style={{
                    ...ui.btn(palette.id === recipe.paletteId),
                    width: '100%', justifyContent: 'flex-start', gap: 8, padding: '0 10px',
                  }}
                >
                  <span style={{ display: 'flex', flexShrink: 0 }}>
                    {palette.colors.slice(0, 5).map((hex, i) => (
                      <span key={i} style={{
                        width: 14, height: 14, borderRadius: '50%', background: hex,
                        marginLeft: i === 0 ? 0 : -4, border: '1px solid rgba(255,255,255,0.8)',
                      }} />
                    ))}
                  </span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{palette.label}</span>
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>
                BACKGROUND<span style={{ color: GLASS.ink }}>{recipe.background.color}</span>
              </span>
              <input
                type="color"
                value={recipe.background.color}
                onChange={(e) => applyPatch({ background: { color: e.target.value } })}
                style={{ width: '100%', height: 32, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'none' }}
              />
            </label>
          </RailCard>

          <RailCard
            id="paint-composition-card" icon={<Grid2x2 size={18} strokeWidth={2} />} title="Composition"
            subtitle={`Density ${(recipe.params.density ?? 0).toFixed(2)}`}
            color="#8b5cf6"
            open={openCards.composition} onToggle={() => toggleCard('composition')}
          >
            {['density', 'composition', 'scale'].filter((k) => schemaParams[k]).map((key) => (
              <Slider
                key={key}
                label={humanizeParamKey(key)}
                min={schemaParams[key].min} max={schemaParams[key].max} step={schemaParams[key].step}
                value={recipe.params[key]}
                onChange={(v) => updateParam(key, v)}
              />
            ))}
          </RailCard>

          <RailCard
            id="paint-material-texture-card" icon={<Droplets size={18} strokeWidth={2} />} title="Material / Texture"
            subtitle={`Texture ${(recipe.params.texture ?? 0).toFixed(2)}`}
            color="#38bdf8"
            open={openCards.texture} onToggle={() => toggleCard('texture')}
          >
            {schemaParams.texture ? (
              <Slider
                label="Texture"
                min={schemaParams.texture.min} max={schemaParams.texture.max} step={schemaParams.texture.step}
                value={recipe.params.texture}
                onChange={(v) => updateParam('texture', v)}
              />
            ) : null}
          </RailCard>

          <RailCard
            id="paint-variation-card" icon={<Dices size={18} strokeWidth={2} />} title="Variation"
            subtitle={`Seed ${recipe.seed}`}
            color="#eab308"
            open={openCards.variation} onToggle={() => toggleCard('variation')}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>SEED</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="number" min={0} max={4294967295} step={1} value={recipe.seed}
                  onChange={handleSeedInputChange}
                  style={{ flex: 1, height: 32, borderRadius: 8, border: '1px solid ' + GLASS.hair, padding: '0 8px', fontFamily: GLASS.mono, fontSize: 12 }}
                />
                <button onClick={handleCopySeed} title="Copy seed" style={{ ...ui.btn(false), width: 36, padding: 0 }}>
                  {seedCopied ? <Check size={14} strokeWidth={2.5} /> : <Copy size={14} strokeWidth={2.5} />}
                </button>
              </div>
            </label>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button onClick={handleRemix} style={{ ...ui.btn(false), flex: 1, gap: 6 }}>
                <Shuffle size={14} strokeWidth={2.5} /> Randomize all
              </button>
              <button onClick={handleReset} style={{ ...ui.btn(false), flex: 1, gap: 6 }}>
                <RotateCcw size={14} strokeWidth={2.5} /> Reset
              </button>
            </div>
            {template && template.directions ? <button onClick={handleArtShuffle} style={{ ...ui.cta, width: '100%', gap: 6, marginTop: 6 }}>
              <Dices size={14} strokeWidth={2.5} /> True random art direction
            </button> : null}
          </RailCard>

          <RailCard
            id="paint-typography-card" icon={<Type size={18} strokeWidth={2} />} title="Book typography"
            subtitle={recipe.text?.enabled ? (recipe.text.layout === 'cover' ? 'Cover treatment' : 'Chapter treatment') : 'Add title'}
            color="#a855f7"
            open={openCards.typography} onToggle={() => toggleCard('typography')}
          >
            <button
              onClick={() => updateText({ enabled: !recipe.text?.enabled })}
              style={{ ...ui.btn(Boolean(recipe.text?.enabled)), width: '100%', justifyContent: 'center', gap: 6 }}
            >
              <CaseSensitive size={14} strokeWidth={2.5} /> {recipe.text?.enabled ? 'Typography on' : 'Add headline'}
            </button>
            {recipe.text?.enabled ? <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
                <span style={ui.label}>HEADLINE</span>
                <textarea
                  value={recipe.text.headline} maxLength={90} rows={2}
                  onChange={(e) => updateText({ headline: e.target.value })}
                  placeholder="CHAPTER ONE"
                  style={{ width: '100%', resize: 'vertical', minHeight: 50, borderRadius: 8, border: '1px solid ' + GLASS.hair, padding: '7px 8px', fontFamily: GLASS.sans, fontWeight: 700, fontSize: 13, lineHeight: 1.25 }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7 }}>
                <span style={ui.label}>SUBHEAD</span>
                <textarea
                  value={recipe.text.subhead} maxLength={140} rows={2}
                  onChange={(e) => updateText({ subhead: e.target.value })}
                  placeholder="A short description"
                  style={{ width: '100%', resize: 'vertical', minHeight: 46, borderRadius: 8, border: '1px solid ' + GLASS.hair, padding: '7px 8px', fontFamily: GLASS.sans, fontSize: 12, lineHeight: 1.35 }}
                />
              </label>
              <Slider label="Headline size" min={0.65} max={1.45} step={0.01} value={recipe.text.headlineScale} onChange={(headlineScale) => updateText({ headlineScale })} />
              <Slider label="Subhead size" min={0.65} max={1.65} step={0.01} value={recipe.text.subheadScale} onChange={(subheadScale) => updateText({ subheadScale })} />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 7 }}>
                <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>TEXT COLOR <span style={{ color: GLASS.ink }}>{recipe.text.color}</span></span>
                <input
                  type="color" value={recipe.text.color}
                  onChange={(e) => updateText({ color: e.target.value })}
                  style={{ width: '100%', height: 32, border: 'none', borderRadius: 8, cursor: 'pointer', background: 'none' }}
                />
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                <span style={ui.label}>PAGE TREATMENT</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[['chapter', 'Chapter'], ['cover', 'Cover']].map(([value, label]) => <button key={value} onClick={() => updateText({ layout: value })} style={{ ...ui.btn(recipe.text.layout === value), flex: 1, height: 30, fontSize: 10 }}>{label}</button>)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 }}>
                <span style={ui.label}>DECORATIVE SPACER</span>
                <div style={{ display: 'flex', gap: 5 }}>
                  {[['ornament', 'Ornament'], ['rules', 'Rules'], ['none', 'None']].map(([value, label]) => <button key={value} onClick={() => updateText({ spacer: value })} style={{ ...ui.btn(recipe.text.spacer === value), flex: 1, height: 30, padding: '0 5px', fontSize: 9 }}>{label}</button>)}
                </div>
              </div>
              <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute, lineHeight: 1.35 }}>Type is unboxed. On dark artwork the selected color automatically inverts for contrast.</span>
            </> : <span style={{ ...ui.label, display: 'block', marginTop: 8, textTransform: 'none', letterSpacing: 0, lineHeight: 1.4 }}>Add a title, subhead, and classic divider. Select a book format for a ready-made portrait page.</span>}
          </RailCard>

          <RailCard
            id="paint-legibility-card" icon={<Droplets size={18} strokeWidth={2} />} title="Text legibility"
            subtitle={recipe.text?.backdrop?.enabled ? 'Blur vignette on' : 'Blur vignette off'}
            color="#38bdf8" open={openCards.legibility} onToggle={() => toggleCard('legibility')}
          >
            <button onClick={() => updateText({ backdrop: { ...recipe.text.backdrop, enabled: !recipe.text.backdrop?.enabled } })} style={{ ...ui.btn(Boolean(recipe.text.backdrop?.enabled)), width: '100%', justifyContent: 'center', gap: 6 }}>
              <Droplets size={14} strokeWidth={2.5} /> {recipe.text.backdrop?.enabled ? 'Blur vignette on' : 'Blur vignette off'}
            </button>
            <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, lineHeight: 1.35 }}>Clears a feathered reading field in this artwork&apos;s own background color. It updates with every randomized recipe.</span>
            {recipe.text.backdrop?.enabled ? <>
              <Slider label="Blur strength" min={0} max={1} step={0.01} value={recipe.text.backdrop.intensity} onChange={(intensity) => updateText({ backdrop: { ...recipe.text.backdrop, intensity } })} />
              <Slider label="Blend softness" min={0} max={1} step={0.01} value={recipe.text.backdrop.blur} onChange={(blur) => updateText({ backdrop: { ...recipe.text.backdrop, blur } })} />
              <Slider label="Vignette size" min={0.4} max={1.4} step={0.01} value={recipe.text.backdrop.size} onChange={(size) => updateText({ backdrop: { ...recipe.text.backdrop, size } })} />
              <Slider label="Edge falloff" min={0.15} max={1} step={0.01} value={recipe.text.backdrop.falloff} onChange={(falloff) => updateText({ backdrop: { ...recipe.text.backdrop, falloff } })} />
            </> : null}
          </RailCard>

          <RailCard
            id="paint-export-card" icon={<Download size={18} strokeWidth={2} />} title="Export"
            subtitle={`${recipe.output.width}×${recipe.output.height}`}
            color="#22c55e"
            open={openCards.exportCard} onToggle={() => toggleCard('exportCard')}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PAINT_OUTPUT_FORMATS.map((format) => (
                <button
                  key={format.id}
                  onClick={() => selectFormat(format.id)}
                  style={{ ...ui.btn(recipe.output.formatId === format.id), width: '100%', justifyContent: 'space-between', padding: '0 14px' }}
                >
                  <span>{format.label}</span>
                  <span style={{ ...ui.label, color: recipe.output.formatId === format.id ? '#fff' : GLASS.inkMute }}>{format.w}×{format.h}</span>
                </button>
              ))}
            </div>
            <button
              onClick={handleExport} disabled={exporting}
              style={{ ...ui.cta, width: '100%', gap: 8, marginTop: 6, opacity: exporting ? 0.6 : 1 }}
            >
              <Download size={14} strokeWidth={2.5} /> {exporting ? 'Exporting…' : 'Export PNG'}
            </button>
          </RailCard>

          <RailCard
            id="paint-saved-recipes-card" icon={<Bookmark size={18} strokeWidth={2} />} title="Saved recipes"
            subtitle={`${savedRecipes.length} saved`}
            color="#64748b"
            open={openCards.saved} onToggle={() => toggleCard('saved')}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={ui.label}>NAME</span>
              <input
                type="text" value={saveName} placeholder={`${(template && template.label) || 'Untitled'} recipe`}
                onChange={(e) => setSaveName(e.target.value)}
                style={{ height: 32, borderRadius: 8, border: '1px solid ' + GLASS.hair, padding: '0 8px', fontFamily: GLASS.sans, fontSize: 12 }}
              />
            </label>
            <button onClick={handleSaveRecipe} style={{ ...ui.btn(false), width: '100%', gap: 6 }}>
              <Save size={14} strokeWidth={2.5} /> {activeSavedId ? 'Update saved recipe' : 'Save recipe'}
            </button>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {savedRecipes.length === 0 ? (
                <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0 }}>No saved recipes yet.</span>
              ) : savedRecipes.map((entry) => {
                const entryTemplate = getTemplate(entry.recipe && entry.recipe.templateId);
                return (
                  <div key={entry.id} style={{
                    display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px',
                    borderRadius: 10, border: '1px solid ' + GLASS.hair,
                    background: activeSavedId === entry.id ? 'rgba(255,255,255,0.6)' : 'transparent',
                  }}>
                    <span style={{ fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600, color: GLASS.ink }}>{entry.name}</span>
                    <span style={{ ...ui.label, textTransform: 'none', letterSpacing: 0, color: GLASS.inkMute }}>
                      {(entryTemplate && entryTemplate.label) || (entry.recipe && entry.recipe.templateId)} · {entry.recipe && entry.recipe.output && entry.recipe.output.width}×{entry.recipe && entry.recipe.output && entry.recipe.output.height} · seed {entry.recipe && entry.recipe.seed}
                    </span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleLoadRecipe(entry.id)} style={{ ...ui.btn(false), flex: 1, height: 30, fontSize: 10 }}>Load</button>
                      <button onClick={() => handleDuplicateRecipe(entry.id)} title="Duplicate" style={{ ...ui.btn(false), width: 30, height: 30, padding: 0 }}>
                        <Files size={13} strokeWidth={2.5} />
                      </button>
                      <button
                        onClick={() => handleDeleteRecipe(entry.id)}
                        title={confirmDeleteId === entry.id ? 'Click again to confirm delete' : 'Delete'}
                        style={{
                          ...ui.btn(confirmDeleteId === entry.id), width: confirmDeleteId === entry.id ? 'auto' : 30,
                          height: 30, padding: confirmDeleteId === entry.id ? '0 10px' : 0, fontSize: 10, gap: 4,
                          background: confirmDeleteId === entry.id ? '#dc2626' : undefined,
                          border: confirmDeleteId === entry.id ? '1px solid #dc2626' : undefined,
                          color: confirmDeleteId === entry.id ? '#fff' : undefined,
                        }}
                      >
                        <Trash2 size={13} strokeWidth={2.5} />
                        {confirmDeleteId === entry.id ? 'Confirm' : null}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </RailCard>

        </div>
      </div>

      {toast ? (
        <div
          id="paint-studio-toast"
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          style={{
            position: 'fixed', top: 18, right: 18, zIndex: 60, maxWidth: '24rem',
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 10,
            background: toast.kind === 'error' ? 'rgba(254,226,226,0.92)' : 'rgba(220,252,231,0.92)',
            border: '1px solid ' + (toast.kind === 'error' ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.4)'),
            boxShadow: '0 10px 30px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)',
            backdropFilter: 'blur(14px)',
            fontFamily: GLASS.mono, fontSize: 11.5, color: GLASS.ink, lineHeight: 1.4,
          }}
        >
          <span aria-hidden="true" style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: toast.kind === 'error' ? '#ef4444' : '#22c55e',
          }} />
          <span style={{ flex: 1 }}>{toast.text}</span>
          <button
            onClick={() => setToast(null)} aria-label="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, fontSize: 14, lineHeight: 1 }}
          >×</button>
        </div>
      ) : null}
    </>
  );
}
