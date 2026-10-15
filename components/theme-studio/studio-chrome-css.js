// Studio stylesheet (contract 11.3).
//
// STUDIO_CSS  = the inspector chrome. It may reference ONLY the locked `--ts-*`
//               tokens below, never `--t-*`, so a broken draft palette cannot make
//               the inspector unreadable. The `--ts-*` literals live in
//               lib/theme-studio/chrome-tokens.js (the one place they are defined
//               and contrast-tested); this file only uses var(--ts-*).
// PREVIEW_CSS = the sample UI shown inside the pinned light / dark panes. It uses
//               only real `--t-*` tokens, on purpose: that is what it demonstrates.
//
// All chrome rules are nested under #theme-studio-root (CSS nesting) so they win
// over page-level element selectors, and the root resets inherited page styles.

import { STUDIO_CHROME_TOKENS } from '../../lib/theme-studio/chrome-tokens.js';

const tokenDecls = Object.entries(STUDIO_CHROME_TOKENS)
  .map(([k, v]) => `${k}: ${v};`)
  .join(' ');

export const STUDIO_CSS = `
#theme-studio-root {
  all: initial;
  ${tokenDecls}
  --ts-radius: 8px;
  --ts-radius-sm: 6px;
  --ts-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --ts-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color-scheme: light;
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  pointer-events: none;
  font: 400 13px/1.45 var(--ts-font);
  color: var(--ts-fg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;

  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  .ts-backdrop { position: absolute; inset: 0; pointer-events: auto; background: rgba(0, 0, 0, 0.38); }

  .ts-panel {
    position: absolute; top: 0; right: 0; bottom: 0;
    width: 420px; max-width: 100vw; height: 100vh; height: 100dvh;
    display: flex; flex-direction: column;
    pointer-events: auto;
    background: var(--ts-bg); color: var(--ts-fg);
    border-left: 1px solid var(--ts-line);
    box-shadow: -12px 0 40px -8px var(--ts-shadow);
    animation: ts-in-right 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .ts-panel.ts-sheet {
    top: auto; left: 0; right: 0; bottom: 0; width: 100%;
    height: 85vh; height: 85dvh; max-height: 85dvh;
    border-left: 0; border-top: 1px solid var(--ts-line);
    border-radius: 14px 14px 0 0;
    box-shadow: 0 -16px 48px -8px var(--ts-shadow);
    animation: ts-in-up 260ms cubic-bezier(0.22, 1, 0.36, 1);
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  @keyframes ts-in-right { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes ts-in-up { from { transform: translateY(32px); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    .ts-panel, .ts-panel.ts-sheet { animation: none; }
    * { transition: none !important; }
  }

  .ts-grab { display: none; }
  .ts-sheet .ts-grab { display: block; width: 36px; height: 4px; border-radius: 2px; background: var(--ts-line); margin: 8px auto 0; flex: none; }

  /* ---------- header ---------- */
  .ts-header { flex: none; padding: 14px 16px 10px; border-bottom: 1px solid var(--ts-line-soft); background: var(--ts-bg); }
  .ts-header-top { display: flex; align-items: center; gap: 8px; }
  .ts-title { margin: 0; font-size: 15px; line-height: 1.2; font-weight: 650; letter-spacing: -0.01em; flex: 1; min-width: 0; }
  .ts-title:focus-visible { outline: 2px solid var(--ts-focus); outline-offset: 3px; border-radius: 3px; }
  .ts-subtitle { margin: 2px 0 0; color: var(--ts-muted); font-size: 12px; }

  .ts-modeline { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
  .ts-chip { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 6px 8px; border-radius: var(--ts-radius-sm); border: 1px solid var(--ts-line-soft); background: var(--ts-bg-subtle); }
  .ts-chip svg { flex: none; color: var(--ts-muted); }
  .ts-chip-text { min-width: 0; display: flex; flex-direction: column; }
  .ts-chip-k { font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ts-muted); }
  .ts-chip-v { font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ts-chip--edit { background: var(--ts-accent-soft); border-color: var(--ts-accent); }
  .ts-chip--edit svg, .ts-chip--edit .ts-chip-k { color: var(--ts-accent); }
  .ts-chip--differs { border-style: dashed; }

  .ts-toolbar { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .ts-toolbar-sep { width: 1px; height: 20px; background: var(--ts-line-soft); margin: 0 2px; }
  .ts-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ts-muted); margin-left: auto; min-width: 0; }
  .ts-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ts-line-strong); flex: none; }
  .ts-dot--dirty { background: var(--ts-warn); }
  .ts-dot--saved { background: var(--ts-ok); }
  .ts-status strong { font-weight: 600; color: var(--ts-fg); }

  /* ---------- buttons & fields ---------- */
  .ts-btn {
    appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 32px; padding: 0 12px; border-radius: var(--ts-radius-sm);
    border: 1px solid var(--ts-line-strong); background: var(--ts-bg); color: var(--ts-fg);
    font: 550 12.5px/1 var(--ts-font); cursor: pointer; white-space: nowrap;
    transition: background-color 120ms, border-color 120ms, color 120ms;
  }
  .ts-btn:hover:not(:disabled) { background: var(--ts-bg-subtle); border-color: var(--ts-fg); }
  .ts-btn:active:not(:disabled) { background: var(--ts-bg-sunken); }
  .ts-btn:disabled, .ts-btn[aria-disabled="true"] { color: var(--ts-muted); border-color: var(--ts-line); background: var(--ts-bg-subtle); cursor: not-allowed; }
  .ts-btn--primary { background: var(--ts-accent); border-color: var(--ts-accent); color: var(--ts-on-accent); }
  .ts-btn--primary:hover:not(:disabled) { background: var(--ts-accent); border-color: var(--ts-fg); filter: brightness(0.92); }
  .ts-btn--danger { color: var(--ts-danger); border-color: var(--ts-danger); }
  .ts-btn--danger:hover:not(:disabled) { background: var(--ts-danger-soft); border-color: var(--ts-danger); }
  .ts-btn--danger-solid { background: var(--ts-danger); border-color: var(--ts-danger); color: var(--ts-on-accent); }
  .ts-btn--danger-solid:hover:not(:disabled) { background: var(--ts-danger); filter: brightness(0.92); }
  .ts-btn--ghost { border-color: transparent; background: transparent; }
  .ts-btn--ghost:hover:not(:disabled) { background: var(--ts-bg-sunken); border-color: transparent; }
  .ts-btn--sm { min-height: 28px; padding: 0 9px; font-size: 12px; }
  .ts-btn--icon { width: 32px; padding: 0; }
  .ts-btn--sm.ts-btn--icon { width: 28px; }
  .ts-btn:focus-visible, .ts-input:focus-visible, .ts-num:focus-visible, .ts-seg-btn:focus-visible, .ts-range:focus-visible,
  .ts-section-head:focus-visible, .ts-role-head:focus-visible, .ts-switch input:focus-visible + .ts-switch-track, .ts-check input:focus-visible + .ts-check-box,
  .ts-swatch-btn:focus-visible, .ts-textarea:focus-visible, .ts-file:focus-within {
    outline: 2px solid var(--ts-focus); outline-offset: 2px;
  }
  .ts-btn-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

  .ts-input, .ts-textarea, .ts-num {
    appearance: none; font: 450 13px/1.3 var(--ts-font); color: var(--ts-fg); background: var(--ts-bg);
    border: 1px solid var(--ts-line-strong); border-radius: var(--ts-radius-sm); padding: 0 9px; min-height: 32px; min-width: 0; width: 100%;
  }
  .ts-textarea { padding: 8px 9px; min-height: 96px; resize: vertical; font-family: var(--ts-mono); font-size: 12px; line-height: 1.45; }
  .ts-num { width: 72px; text-align: right; font-variant-numeric: tabular-nums; font-family: var(--ts-mono); font-size: 12.5px; }
  .ts-num--wide { width: 92px; }
  .ts-num[aria-invalid="true"] { border-color: var(--ts-danger); }
  .ts-input::placeholder, .ts-textarea::placeholder { color: var(--ts-muted); }
  .ts-hexfield { font-family: var(--ts-mono); font-size: 12.5px; text-transform: lowercase; width: 96px; }

  /* ---------- body ---------- */
  .ts-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 4px 0 28px; }
  .ts-banner { margin: 10px 16px 0; padding: 9px 11px; border-radius: var(--ts-radius-sm); border: 1px solid var(--ts-line); background: var(--ts-bg-subtle); font-size: 12.5px; display: flex; gap: 9px; align-items: flex-start; }
  .ts-banner svg { flex: none; margin-top: 1px; }
  .ts-banner p { margin: 0; }
  .ts-banner--warn { background: var(--ts-warn-soft); border-color: var(--ts-warn); color: var(--ts-warn); }
  .ts-banner--warn p, .ts-banner--warn strong { color: var(--ts-fg); }
  .ts-banner--danger { background: var(--ts-danger-soft); border-color: var(--ts-danger); }
  .ts-banner--danger svg { color: var(--ts-danger); }
  .ts-banner--ok { background: var(--ts-ok-soft); border-color: var(--ts-ok); }
  .ts-banner--ok svg { color: var(--ts-ok); }
  .ts-banner--info { background: var(--ts-accent-soft); border-color: var(--ts-accent); }
  .ts-banner--info svg { color: var(--ts-accent); }
  .ts-banner-actions { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }

  /* ---------- sections ---------- */
  .ts-section { border-bottom: 1px solid var(--ts-line-soft); }
  .ts-section-head {
    appearance: none; width: 100%; display: flex; align-items: center; gap: 10px; text-align: left;
    background: transparent; border: 0; padding: 13px 16px; min-height: 48px; cursor: pointer; color: var(--ts-fg); font: inherit;
  }
  .ts-section-head:hover { background: var(--ts-bg-subtle); }
  .ts-section-num { font: 600 11px/1 var(--ts-mono); color: var(--ts-muted); width: 18px; flex: none; }
  .ts-section-title { font-size: 13.5px; font-weight: 650; letter-spacing: -0.005em; margin: 0; }
  .ts-section-sum { margin-left: auto; font-size: 12px; color: var(--ts-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 46%; text-align: right; font-variant-numeric: tabular-nums; }
  .ts-chev { flex: none; color: var(--ts-muted); transition: transform 160ms; }
  .ts-section-head[aria-expanded="true"] .ts-chev { transform: rotate(90deg); }
  .ts-section-panel { padding: 2px 16px 18px; display: flex; flex-direction: column; gap: 16px; }
  .ts-sub { margin: 0; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ts-muted); }
  .ts-stack { display: flex; flex-direction: column; gap: 10px; }
  .ts-stack--tight { gap: 6px; }
  .ts-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ts-card { border: 1px solid var(--ts-line-soft); border-radius: var(--ts-radius); padding: 12px; background: var(--ts-bg); display: flex; flex-direction: column; gap: 12px; }
  .ts-card--editing { border-color: var(--ts-accent); background: var(--ts-bg); box-shadow: 0 0 0 1px var(--ts-accent); }
  .ts-card-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .ts-card-title { margin: 0; font-size: 13px; font-weight: 650; }
  .ts-p { margin: 0; color: var(--ts-muted); font-size: 12.5px; }
  .ts-p strong { color: var(--ts-fg); font-weight: 600; }
  .ts-hint { margin: 0; color: var(--ts-muted); font-size: 12px; line-height: 1.4; }
  .ts-list { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; color: var(--ts-fg); font-size: 12.5px; }
  .ts-code { font-family: var(--ts-mono); font-size: 11.5px; background: var(--ts-bg-sunken); padding: 1px 5px; border-radius: 4px; }

  /* ---------- controls ---------- */
  .ts-field { display: flex; flex-direction: column; gap: 6px; }
  .ts-field-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .ts-label { font-size: 12.5px; font-weight: 600; color: var(--ts-fg); }
  .ts-unit { color: var(--ts-muted); font-size: 12px; margin-left: 4px; }
  .ts-numwrap { display: inline-flex; align-items: center; }

  .ts-range { appearance: none; -webkit-appearance: none; width: 100%; height: 28px; margin: 0; background: transparent; cursor: pointer; touch-action: pan-y; }
  .ts-range::-webkit-slider-runnable-track { height: 10px; border-radius: 5px; background: var(--ts-track, var(--ts-line)); border: 1px solid var(--ts-line-strong); }
  .ts-range::-moz-range-track { height: 8px; border-radius: 5px; background: var(--ts-track, var(--ts-line)); border: 1px solid var(--ts-line-strong); }
  .ts-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; margin-top: -7px; border-radius: 50%; background: var(--ts-bg); border: 2px solid var(--ts-fg); box-shadow: 0 1px 4px var(--ts-shadow); }
  .ts-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: var(--ts-bg); border: 2px solid var(--ts-fg); box-shadow: 0 1px 4px var(--ts-shadow); }
  .ts-range:disabled { cursor: not-allowed; opacity: 0.5; }

  .ts-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: var(--ts-radius-sm); background: var(--ts-bg-sunken); border: 1px solid var(--ts-line-soft); max-width: 100%; }
  .ts-seg--block { display: flex; }
  .ts-seg-btn { appearance: none; flex: 1 1 0; min-width: 0; min-height: 30px; padding: 0 10px; border: 0; border-radius: 4px; background: transparent; color: var(--ts-fg); font: 550 12.5px/1 var(--ts-font); cursor: pointer; white-space: nowrap; }
  .ts-seg-btn:hover { background: var(--ts-bg-subtle); }
  .ts-seg-btn[aria-checked="true"] { background: var(--ts-bg); box-shadow: 0 0 0 1px var(--ts-line-strong), 0 1px 2px var(--ts-shadow); font-weight: 650; }
  .ts-seg-btn:disabled { color: var(--ts-muted); cursor: not-allowed; }

  .ts-switch, .ts-check { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
  .ts-switch input, .ts-check input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .ts-switch-track { flex: none; width: 36px; height: 20px; margin-top: 1px; border-radius: 10px; background: var(--ts-line-strong); position: relative; transition: background-color 140ms; }
  .ts-switch-track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--ts-bg); transition: transform 140ms; }
  .ts-switch input:checked + .ts-switch-track { background: var(--ts-accent); }
  .ts-switch input:checked + .ts-switch-track::after { transform: translateX(16px); }
  .ts-switch-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .ts-switch-label { font-size: 12.5px; font-weight: 600; }
  .ts-check-box { flex: none; width: 18px; height: 18px; margin-top: 1px; border-radius: 4px; border: 1.5px solid var(--ts-line-strong); background: var(--ts-bg); display: grid; place-items: center; color: var(--ts-on-accent); }
  .ts-check input:checked + .ts-check-box { background: var(--ts-accent); border-color: var(--ts-accent); }
  .ts-check-box svg { opacity: 0; }
  .ts-check input:checked + .ts-check-box svg { opacity: 1; }

  .ts-badge { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 10px; font-size: 11px; font-weight: 600; white-space: nowrap; border: 1px solid var(--ts-line); background: var(--ts-bg-subtle); color: var(--ts-fg); }
  .ts-badge--linked { background: var(--ts-accent-soft); border-color: var(--ts-accent); color: var(--ts-accent); }
  .ts-badge--custom { background: var(--ts-bg); border-color: var(--ts-fg); color: var(--ts-fg); }
  .ts-badge--locked { background: var(--ts-fg); border-color: var(--ts-fg); color: var(--ts-bg); }
  .ts-badge--mixed { background: var(--ts-bg-sunken); border-color: var(--ts-line-strong); color: var(--ts-fg); }
  .ts-badge--pass { background: var(--ts-ok-soft); border-color: var(--ts-ok); color: var(--ts-ok); }
  .ts-badge--fail { background: var(--ts-danger-soft); border-color: var(--ts-danger); color: var(--ts-danger); }
  .ts-badge--advisory { background: var(--ts-warn-soft); border-color: var(--ts-warn); color: var(--ts-warn); }
  .ts-badge--none { color: var(--ts-muted); }
  .ts-badge--ok { background: var(--ts-ok-soft); border-color: var(--ts-ok); color: var(--ts-ok); }
  .ts-badge--warn { background: var(--ts-warn-soft); border-color: var(--ts-warn); color: var(--ts-warn); }

  .ts-swatch { flex: none; width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--ts-line-strong); position: relative; overflow: hidden; background-image: linear-gradient(45deg, var(--ts-bg-sunken) 25%, transparent 25%, transparent 75%, var(--ts-bg-sunken) 75%), linear-gradient(45deg, var(--ts-bg-sunken) 25%, transparent 25%, transparent 75%, var(--ts-bg-sunken) 75%); background-size: 8px 8px; background-position: 0 0, 4px 4px; }
  .ts-swatch > i { position: absolute; inset: 0; display: block; }
  .ts-swatch--sm { width: 18px; height: 18px; border-radius: 4px; }
  .ts-swatch--lg { width: 100%; height: 36px; border-radius: 6px; }
  .ts-swatch-btn { appearance: none; background: transparent; border: 0; padding: 0; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font: 500 12px/1 var(--ts-mono); color: var(--ts-fg); border-radius: 4px; min-height: 24px; }
  .ts-swatch-btn:hover { text-decoration: underline; }
  /* ---------- palette combos ---------- */
  .ts-combo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ts-combo {
    appearance: none; display: flex; flex-direction: column; gap: 6px; text-align: left; min-width: 0;
    padding: 8px; border-radius: var(--ts-radius); border: 1px solid var(--ts-line-soft);
    background: var(--ts-bg); color: var(--ts-fg); cursor: pointer; font-family: var(--ts-font);
    transition: border-color 120ms, box-shadow 120ms;
  }
  .ts-combo:hover { border-color: var(--ts-fg); }
  .ts-combo--active { border-color: var(--ts-accent); box-shadow: 0 0 0 1px var(--ts-accent); }
  .ts-combo-strip { display: grid; grid-template-columns: repeat(5, 1fr); height: 28px; border-radius: var(--ts-radius-sm); overflow: hidden; border: 1px solid var(--ts-line-soft); }
  .ts-combo-strip i { display: block; }
  .ts-combo-name { font-size: 12.5px; font-weight: 650; }
  .ts-combo-note { font-size: 11px; color: var(--ts-muted); line-height: 1.3; }
  .ts-swatchrow { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .ts-swatchrow figure { margin: 0; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ts-swatchrow figcaption { font-size: 11px; color: var(--ts-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ts-swatchrow code { font: 500 11px/1 var(--ts-mono); color: var(--ts-fg); }

  /* ---------- roles ---------- */
  .ts-role:has(> .ts-role-editor) { box-shadow: inset 3px 0 0 var(--ts-accent); }
  .ts-role-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border: 1px solid var(--ts-line-soft); border-radius: var(--ts-radius); overflow: hidden; }
  .ts-role { border-bottom: 1px solid var(--ts-line-soft); background: var(--ts-bg); }
  .ts-role:last-child { border-bottom: 0; }
  .ts-role-head { appearance: none; width: 100%; display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; padding: 8px 10px; min-height: 52px; text-align: left; border: 0; background: transparent; cursor: pointer; font: inherit; color: var(--ts-fg); }
  .ts-role-head:hover { background: var(--ts-bg-subtle); }
  .ts-role-swatches { display: flex; align-items: center; gap: 3px; }
  .ts-role-name { font: 600 12px/1.2 var(--ts-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts-role-use { font-size: 11.5px; color: var(--ts-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ts-role-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .ts-role-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ts-role-editor { padding: 4px 12px 14px; display: flex; flex-direction: column; gap: 12px; background: var(--ts-bg-subtle); border-top: 1px solid var(--ts-line-soft); }
  .ts-group-head { appearance: none; width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 4px; background: transparent; border: 0; border-bottom: 1px solid var(--ts-line-soft); font: 650 12.5px/1 var(--ts-font); color: var(--ts-fg); cursor: pointer; min-height: 40px; text-align: left; }
  .ts-group-head:hover { background: var(--ts-bg-subtle); }
  .ts-group-head:focus-visible { outline: 2px solid var(--ts-focus); outline-offset: 2px; }
  .ts-group-count { margin-left: auto; font-weight: 500; color: var(--ts-muted); font-size: 12px; }
  .ts-group-head[aria-expanded="true"] .ts-chev { transform: rotate(90deg); }
  .ts-filterbar { display: flex; flex-direction: column; gap: 8px; }
  .ts-filterbar-row { display: flex; gap: 14px; flex-wrap: wrap; }

  .ts-oklch { display: grid; grid-template-columns: 1fr; gap: 8px; }
  .ts-oklch-head { display: flex; align-items: center; gap: 10px; }

  /* ---------- accessibility results ---------- */
  .ts-results { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .ts-result { border: 1px solid var(--ts-line-soft); border-radius: var(--ts-radius); padding: 10px; display: grid; grid-template-columns: auto 1fr; gap: 10px; background: var(--ts-bg); }
  .ts-result--fail { border-color: var(--ts-danger); }
  .ts-result--advisory { border-color: var(--ts-warn); }
  .ts-result-sample { width: 44px; height: 44px; border-radius: 6px; border: 1px solid var(--ts-line-strong); display: grid; place-items: center; font: 650 15px/1 var(--ts-font); }
  .ts-result-body { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .ts-result-title { font-size: 12.5px; font-weight: 600; margin: 0; overflow-wrap: anywhere; }
  .ts-result-line { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .ts-sumchips { display: flex; gap: 6px; flex-wrap: wrap; }

  /* ---------- export / import / guide ---------- */
  .ts-importmsg { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .ts-importmsg li { display: flex; gap: 6px; }
  .ts-importmsg code { font: 500 11px/1.4 var(--ts-mono); background: var(--ts-bg-sunken); padding: 0 4px; border-radius: 3px; flex: none; }
  .ts-file { position: relative; display: inline-flex; border-radius: var(--ts-radius-sm); }
  .ts-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; }
  .ts-table-wrap { overflow: auto; max-height: 360px; border: 1px solid var(--ts-line-soft); border-radius: var(--ts-radius); }
  .ts-table-wrap:focus-visible { outline: 2px solid var(--ts-focus); outline-offset: 2px; }
  .ts-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .ts-table th { position: sticky; top: 0; background: var(--ts-bg-subtle); text-align: left; font-weight: 650; padding: 7px 8px; border-bottom: 1px solid var(--ts-line); white-space: nowrap; z-index: 1; }
  .ts-table td { padding: 6px 8px; border-bottom: 1px solid var(--ts-line-soft); vertical-align: middle; }
  .ts-table td.ts-cell-token { font: 500 11.5px/1.3 var(--ts-mono); }
  .ts-table td.ts-cell-use { color: var(--ts-muted); min-width: 140px; }
  .ts-cell-val { display: inline-flex; align-items: center; gap: 6px; font: 500 11.5px/1 var(--ts-mono); white-space: nowrap; }

  /* ---------- compare panes ---------- */
  .ts-panes { display: grid; grid-template-columns: 1fr; gap: 12px; }
  .ts-pane-label { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }

  .ts-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

  /* ---------- touch ---------- */
  @media (pointer: coarse), (max-width: 640px) {
    .ts-btn, .ts-input, .ts-num, .ts-seg-btn { min-height: 44px; }
    .ts-btn--icon, .ts-btn--sm.ts-btn--icon { width: 44px; }
    .ts-btn--sm { min-height: 44px; }
    .ts-num { width: 84px; }
    .ts-range { height: 44px; }
    .ts-range::-webkit-slider-thumb { width: 28px; height: 28px; margin-top: -10px; }
    .ts-range::-moz-range-thumb { width: 24px; height: 24px; }
    .ts-section-head, .ts-group-head { min-height: 48px; }
    .ts-role-head { min-height: 56px; }
    .ts-switch, .ts-check { min-height: 44px; align-items: center; }
    .ts-swatch-btn { min-height: 44px; }
  }
  @media (max-width: 640px) {
    .ts-header { padding: 6px 14px 10px; }
    .ts-section-head { padding-left: 14px; padding-right: 14px; }
    .ts-section-panel { padding-left: 14px; padding-right: 14px; }
    .ts-banner { margin-left: 14px; margin-right: 14px; }
    .ts-section-sum { max-width: 40%; }
  }
  @media (forced-colors: active) {
    .ts-btn, .ts-input, .ts-num, .ts-seg-btn[aria-checked="true"], .ts-badge, .ts-swatch { border: 1px solid CanvasText; }
    .ts-switch-track { border: 1px solid CanvasText; }
  }
}
`;

// Sample UI for the pinned panes. Real tokens only; this is the thing being judged.
export const PREVIEW_CSS = `
#theme-studio-root .ts-pv {
  background: var(--t-page); color: var(--t-text-default);
  border: 1px solid var(--t-border-subtle); border-radius: 10px; padding: 14px;
  display: flex; flex-direction: column; gap: 14px; font: 400 13px/1.45 var(--ts-font);
  isolation: isolate;
}
#theme-studio-root .ts-pv * { box-sizing: border-box; }
#theme-studio-root .ts-pv-eyebrow { margin: 0; font-size: 11px; font-weight: 650; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-eyebrow); }
#theme-studio-root .ts-pv-h { margin: 0; font-size: 18px; line-height: 1.2; font-weight: 650; color: var(--t-text-strong); letter-spacing: -0.01em; }
#theme-studio-root .ts-pv-body { margin: 0; color: var(--t-text-body); }
#theme-studio-root .ts-pv-sec { margin: 0; color: var(--t-text-secondary); }
#theme-studio-root .ts-pv-muted { margin: 0; color: var(--t-text-muted); font-size: 12px; }
#theme-studio-root .ts-pv-faint { margin: 0; color: var(--t-text-faint); font-size: 12px; }
#theme-studio-root .ts-pv a { color: var(--t-accent-text); text-decoration: underline; text-underline-offset: 2px; }
#theme-studio-root .ts-pv-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#theme-studio-root .ts-pv-btn { appearance: none; font: 600 12.5px/1 var(--ts-font); min-height: 34px; padding: 0 14px; border-radius: 8px; border: 1px solid transparent; cursor: default; }
#theme-studio-root .ts-pv-btn--primary { background: var(--t-accent); color: var(--t-on-accent); }
#theme-studio-root .ts-pv-btn--primary:hover { background: var(--t-accent-hover); }
#theme-studio-root .ts-pv-btn--primary:active { background: var(--t-accent-pressed); }
#theme-studio-root .ts-pv-btn--soft { background: var(--t-accent-soft); color: var(--t-accent-text); border-color: var(--t-accent-soft-border); }
#theme-studio-root .ts-pv-btn--outline { background: var(--t-surface); color: var(--t-text); border-color: var(--t-control-border-strong); }
#theme-studio-root .ts-pv-btn--disabled { background: var(--t-disabled-bg); color: var(--t-text-disabled); }
#theme-studio-root .ts-pv-btn--focus { background: var(--t-surface); color: var(--t-text); border-color: var(--t-control-border-strong); outline: 2px solid var(--t-focus); outline-offset: 2px; }
#theme-studio-root .ts-pv-field { display: flex; flex-direction: column; gap: 4px; }
#theme-studio-root .ts-pv-label { font-size: 12px; font-weight: 600; color: var(--t-text); }
#theme-studio-root .ts-pv-input { appearance: none; min-height: 34px; padding: 0 10px; border-radius: 8px; background: var(--t-surface); border: 1px solid var(--t-control-border); color: var(--t-text); font: 450 13px/1 var(--ts-font); width: 100%; }
#theme-studio-root .ts-pv-input::placeholder { color: var(--t-text-faint); opacity: 1; }
#theme-studio-root .ts-pv-input--strong { border-color: var(--t-control-border-strong); }
#theme-studio-root .ts-pv-input:disabled { background: var(--t-disabled-bg); color: var(--t-text-disabled); }
#theme-studio-root .ts-pv-layers { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
#theme-studio-root .ts-pv-card { border-radius: 10px; padding: 10px; border: 1px solid var(--t-border-subtle); display: flex; flex-direction: column; gap: 3px; min-height: 64px; }
#theme-studio-root .ts-pv-card b { font-size: 12px; color: var(--t-text); }
#theme-studio-root .ts-pv-card span { font-size: 11.5px; color: var(--t-text-secondary); }
#theme-studio-root .ts-pv-card--surface { background: var(--t-surface); box-shadow: 0 1px 2px var(--t-shadow); }
#theme-studio-root .ts-pv-card--raised { background: var(--t-raised); box-shadow: 0 4px 12px var(--t-shadow); }
#theme-studio-root .ts-pv-card--inset { background: var(--t-inset); }
#theme-studio-root .ts-pv-card--glass { background: var(--t-glass-strong); border-color: var(--t-glass-border); box-shadow: inset 0 1px 0 var(--t-glass-highlight); }
#theme-studio-root .ts-pv-status { display: inline-flex; align-items: center; gap: 6px; min-height: 26px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 600; border: 1px solid transparent; }
#theme-studio-root .ts-pv-status svg { flex: none; }
#theme-studio-root .ts-pv-status--success { background: var(--t-success-bg); border-color: var(--t-success-border); color: var(--t-success); }
#theme-studio-root .ts-pv-status--warning { background: var(--t-warning-bg); border-color: var(--t-warning-border); color: var(--t-warning); }
#theme-studio-root .ts-pv-status--danger { background: var(--t-danger-bg); border-color: var(--t-danger-border); color: var(--t-danger); }
#theme-studio-root .ts-pv-status--info { background: var(--t-info-bg); border-color: var(--t-info-border); color: var(--t-info); }
#theme-studio-root .ts-pv-solids { display: flex; gap: 6px; flex-wrap: wrap; }
#theme-studio-root .ts-pv-solid { min-height: 24px; padding: 0 9px; border-radius: 6px; font-size: 11.5px; font-weight: 650; color: var(--t-on-solid); display: inline-flex; align-items: center; }
#theme-studio-root .ts-pv-dialog-stage { position: relative; border-radius: 10px; overflow: hidden; min-height: 150px; background: var(--t-page); border: 1px solid var(--t-border-subtle); }
#theme-studio-root .ts-pv-dialog-stage::before { content: ""; position: absolute; inset: 0; background: var(--t-overlay); }
#theme-studio-root .ts-pv-dialog { position: relative; margin: 20px auto; width: min(88%, 280px); background: var(--t-raised); border: 1px solid var(--t-border-subtle); border-radius: 12px; padding: 12px; box-shadow: 0 14px 30px var(--t-shadow); display: flex; flex-direction: column; gap: 8px; }
#theme-studio-root .ts-pv-dialog h4 { margin: 0; font-size: 13.5px; color: var(--t-text-strong); }
#theme-studio-root .ts-pv-dialog p { margin: 0; font-size: 12px; color: var(--t-text-secondary); }
#theme-studio-root .ts-pv-onoverlay { position: relative; margin: 0; padding: 8px 12px 0; font-size: 12px; font-weight: 650; color: var(--t-on-overlay); }
#theme-studio-root .ts-pv-gradient { height: 10px; border-radius: 5px; background: var(--t-gradient-accent); }
#theme-studio-root .ts-pv-scene { height: 44px; border-radius: 8px; background: var(--t-scene-fallback); border: 1px solid var(--t-border-faint); display: flex; align-items: flex-end; padding: 6px 8px; font-size: 11px; color: var(--t-text-secondary); }
#theme-studio-root .ts-pv-term { border-radius: 8px; padding: 8px 10px; background: var(--t-term-bg); border: 1px solid var(--t-term-border); font: 500 11.5px/1.5 var(--ts-mono); color: var(--t-term-fg); }
#theme-studio-root .ts-pv-term span.p { font-weight: 700; }
#theme-studio-root .ts-pv-term .ok .p { color: var(--t-term-ok-pfx); } #theme-studio-root .ts-pv-term .ok .m { color: var(--t-term-ok-msg); }
#theme-studio-root .ts-pv-term .err .p { color: var(--t-term-error-pfx); } #theme-studio-root .ts-pv-term .err .m { color: var(--t-term-error-msg); }
#theme-studio-root .ts-pv-term .dim { color: var(--t-term-dim); }
#theme-studio-root .ts-pv-selection { background: var(--t-selection-bg); color: var(--t-selection-fg); padding: 0 2px; }
`;
