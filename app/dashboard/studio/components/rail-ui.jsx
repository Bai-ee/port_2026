'use client';

// Shared rail UI tokens/components for the Holo Paper Studio surface —
// extracted from ClothStudio.jsx so its sibling components (StudioElementsCard,
// StudioElementInspector, and future element-pack cards) can reuse the exact
// same visual language without a circular import back into ClothStudio.jsx.
// Values are copied verbatim from the original inline definitions — no visual
// change.

import React from 'react';
import { ChevronRight } from 'lucide-react';

export const GLASS = {
  bg: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
  accent: 'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  ink: '#1a1a1a',
  inkSoft: '#444',
  inkMute: '#8a8a8a',
  hair: '#E4E4E4',
  sans: '"Space Grotesk", system-ui, -apple-system, sans-serif',
  // The Studio's LABEL face (small, uppercase, tracked). The key name is
  // historical — this is deliberately no longer a monospace or a webfont.
  // Space Mono read as generated-template chrome; a plain Arial swap after
  // that read too heavy/chunky at 9-11px with inconsistent line-height. The
  // native system UI stack is what it's engineered for — small text with
  // predictable, comfortable metrics, and zero webfont load. Mirrors the
  // same token in ../StudioPage.jsx: change both together.
  mono: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif',
};

export const ui = {
  btn: (active = false) => ({
    height: 42,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: active ? GLASS.ink : 'rgba(255,255,255,0.6)',
    color: active ? '#fff' : GLASS.ink,
    border: '1px solid ' + (active ? GLASS.ink : GLASS.hair),
    boxShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
    borderRadius: 999, padding: '0 18px',
    fontSize: 12, fontFamily: GLASS.sans, fontWeight: 600, letterSpacing: '0.01em',
    cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease',
  }),
  cta: {
    height: 42,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: GLASS.accent, color: '#fff', border: 'none', borderRadius: 999,
    padding: '0 20px', fontSize: 12, fontFamily: GLASS.sans, fontWeight: 700,
    letterSpacing: '0.01em', cursor: 'pointer', whiteSpace: 'nowrap',
    boxShadow: '0 2px 8px rgba(140,70,255,0.25), inset 0 1px 0 rgba(255,255,255,0.3)',
  },
  label: {
    fontSize: 9, fontFamily: GLASS.mono, letterSpacing: '0.1em',
    textTransform: 'uppercase', color: GLASS.inkMute, fontWeight: 600, lineHeight: 1.45,
  },
};

// Rail card — same states as the mockup rail (ported from DashboardPage
// .capability-nav-btn via page.jsx); class names match so the CSS below applies.
//
// `leading` (optional, added for the Invoice Studio section-card rework —
// docs/plans/INVOICE-STUDIO-TOOL-HANDOFF.md P4 follow-up) renders BEFORE the
// title, as a sibling of the expand `<button>` rather than inside it, so a
// click on whatever `leading` contains (e.g. an eye visibility toggle, ↑/↓
// reorder buttons) never bubbles into `onToggle`. Purely additive: every
// other RailCard caller (ClothStudio, PaintStudio, LoopStudio) omits it, so
// `{leading}` renders nothing and the button's flex sizing is unchanged.
//
// `inertWhenClosed` (optional, added for Invoice Studio Q1 — docs/plans/
// INVOICE-STUDIO-DESIGN-LAYER-HANDOFF.md, L17): the collapsed body below was
// always mounted (`maxHeight: open ? maxH : 0, overflow:'hidden'`), which
// keeps its inputs reachable by keyboard Tab even while visually clipped to
// zero height — a real handoff-quality bug for anyone tabbing through a
// closed card's fields. The native `inert` boolean attribute (React 19 passes
// it straight through as a DOM prop) is the one-line fix: when true and the
// card is closed, it drops the whole collapsed subtree out of focus/pointer/
// assistive-tech reach without walking every descendant by hand; opening the
// card removes the attribute and restores normal focusability. 100% opt-in —
// every existing caller (ClothStudio, PaintStudio, LoopStudio, PublishCard,
// SavedInvoicesCard) omits the prop, so `inertWhenClosed` defaults to false,
// `inert` evaluates to `undefined`, and the attribute never renders — those
// callers stay byte/behavior-identical.
export function RailCard({ id, icon, title, subtitle, color, open, onToggle, badge, children, maxH = 2400, leading, inertWhenClosed = false }) {
  return (
    <div id={id} className={'studio-rail-card' + (open ? ' studio-rail-card--active' : '')}>
      <div className="studio-rail-card-header-row" style={{ display: 'flex', alignItems: 'center' }}>
        {leading}
        <button
          className="studio-rail-card-btn"
          aria-expanded={open}
          onClick={onToggle}
          style={{
            flex: '1 1 auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span className="studio-rail-card-content" style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: GLASS.sans, fontSize: 15, fontWeight: 500, color: GLASS.ink, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{title}</span>
            {subtitle ? <span style={{ ...ui.label, fontSize: 10, letterSpacing: '0.06em', color: GLASS.inkMute }}>{subtitle}</span> : null}
          </span>
          {badge}
          {icon ? <span className="studio-rail-card-icon" style={{ flexShrink: 0, color, display: 'flex', alignItems: 'center' }}>{icon}</span> : null}
          <span aria-hidden="true" style={{
            flexShrink: 0, color: GLASS.inkMute, display: 'flex', alignItems: 'center',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease',
          }}>
            <ChevronRight size={16} strokeWidth={2.5} />
          </span>
        </button>
      </div>
      <div
        inert={inertWhenClosed ? !open : undefined}
        style={{ maxHeight: open ? maxH : 0, overflow: 'hidden', transition: 'max-height 0.35s cubic-bezier(0.4,0,0.2,1)' }}
      >
        <div style={{ padding: '4px 16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// Labelled range slider — the studio rail's standard control row.
export function Slider({ label, min, max, step, value, onChange, fmt = (v) => v.toFixed(2), disabled = false }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ ...ui.label, display: 'flex', justifyContent: 'space-between' }}>
        {label}<span style={{ color: GLASS.ink }}>{fmt(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: GLASS.ink }}
      />
    </label>
  );
}
