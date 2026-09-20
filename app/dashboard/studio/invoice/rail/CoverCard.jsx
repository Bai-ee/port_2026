'use client';

// Invoice Studio rail — Cover card. Mirrors render.js's buildCover(), which
// prints no heading of its own (it's the sheet's <header>, not a labelled
// <section> — see hero() in features/invoices/render.js). The invoice #,
// bill-to name, and issue/due dates it also prints stay owned by Invoice
// details / Bill to (unchanged by this lane). What Cover DOES own directly
// (design-layer plan L15, Q2 Lane B): document kind and logo. A later lane
// (Lane T, Q3) adds a theme subsection to this same card — this lane's
// subsection is deliberately self-contained (its own heading/wrapper) so
// that addition doesn't have to fight this one's layout.

import React from 'react';
import { LayoutTemplate, RotateCcw } from 'lucide-react';
import SectionCard from './SectionCard';
import { RailField, RailEmptyHint, RailSegmented } from './rail-field-controls';
import LogoControl from './LogoControl';
import { GLASS, ui } from '../../components/rail-ui';
import { DOC_KINDS, DOC_KIND_LABELS } from '../../../../../features/invoices/model.js';
import { BUILTIN_THEME_PRESETS } from '../themes/theme-schema.js';

const DOC_KIND_OPTIONS = DOC_KINDS.map((kind) => ({ value: kind, label: DOC_KIND_LABELS[kind].title }));

// Design-layer plan §3.2/L15 (Q3, Lane T) — Cover's fourth choice is always
// "Default" (theme:null), the other three are the frozen built-in presets in
// theme-schema.js order. A swatch preview (paper/ink/accent) next to each
// label is worth the extra markup here: unlike the docKind picker above it,
// picking wrong is a visual mistake, not just a wording one.
const THEME_CHOICES = [
  { id: null, label: 'Default', swatch: ['#ffffff', '#000000', 'transparent'], why: "Today's plain white/black look." },
  ...BUILTIN_THEME_PRESETS.map((t) => ({
    id: t.id, label: t.label, swatch: [t.colors.paper, t.colors.ink, t.colors.accent], why: t.why,
  })),
];

export default function CoverCard({
  draft, open, onToggle,
  // HoloPaper presentation state (docs/plans/INVOICE-STUDIO-HOLOPAPER-HANDOFF.md
  // §3/§6 H2). InvoiceRail passes through the FULL return value of
  // useInvoicePresentation() (H0's own wiring) — i.e.
  // `{ presentation: {holoEnabled, sceneInteractive, sceneStatus,
  // resetViewToken}, setHoloEnabled, setSceneInteractive, setSceneStatus,
  // bumpResetView }` — NOT just the inner state object. Every other section
  // card ignores this prop; only Cover renders it, below Design.
  presentation = null,
}) {
  const holoState = (presentation && presentation.presentation) || null;
  const holoEnabled = holoState ? holoState.holoEnabled === true : false;
  const sceneInteractive = holoState ? holoState.sceneInteractive === true : false;
  const setHoloEnabled = presentation && presentation.setHoloEnabled;
  const setSceneInteractive = presentation && presentation.setSceneInteractive;
  const bumpResetView = presentation && presentation.bumpResetView;
  const { invoice } = draft;
  return (
    <SectionCard
      sectionId="cover" id="invoice-rail-cover-card" title="Cover"
      icon={<LayoutTemplate size={18} strokeWidth={2} />} color="#f59e0b"
      open={open} onToggle={onToggle} draft={draft}
    >
      <div id="invoice-rail-cover-note">
        <RailEmptyHint>
          Prints the invoice number, bill-to name, and issue/due dates. Edit those in Invoice details and Bill to.
        </RailEmptyHint>
      </div>

      <div id="invoice-rail-cover-identity-section" style={{ display: 'grid', gap: 10, marginTop: 16 }}>
        <RailSegmented
          path="docKind" label="Document kind" options={DOC_KIND_OPTIONS} value={invoice.docKind}
          onSelect={(kind) => draft.applyFieldEdit('docKind', kind, 'rail')}
        />
        <RailEmptyHint>
          Changes the document&apos;s terminology throughout (an Estimate says &quot;Valid until,&quot; not &quot;Due&quot;).
        </RailEmptyHint>
      </div>

      <div id="invoice-rail-cover-logo-section" style={{ marginTop: 16 }}>
        <LogoControl draft={draft} />
      </div>

      <div id="invoice-rail-cover-theme-section" style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        <RailField label="Design">
          <div
            id="invoice-rail-cover-theme-swatch-row"
            role="radiogroup"
            aria-label="Design theme"
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          >
            {THEME_CHOICES.map((choice) => {
              const active = (draft.theme?.id || null) === choice.id;
              return (
                <button
                  key={choice.id || 'default'}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={choice.why}
                  onClick={() => draft.setTheme(choice.id ? choice : null)}
                  style={{
                    ...ui.btn(active), height: 'auto', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 6, padding: '8px 10px', minWidth: 84, borderRadius: 12,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'flex', width: '100%', height: 16, borderRadius: 5, overflow: 'hidden',
                      border: '1px solid ' + (active ? 'rgba(255,255,255,0.35)' : GLASS.hair),
                    }}
                  >
                    <span style={{ flex: 1, background: choice.swatch[0] }} />
                    <span style={{ flex: 1, background: choice.swatch[1] }} />
                    <span style={{ flex: 1, background: choice.swatch[2] === 'transparent' ? choice.swatch[1] : choice.swatch[2] }} />
                  </span>
                  <span style={{ fontSize: 11 }}>{choice.label}</span>
                </button>
              );
            })}
          </div>
        </RailField>
        <RailEmptyHint>
          Swaps fonts, colors, paper size, and margins — never the layout. Ledger and Editorial print at US Letter; Studio Dark is dark and built for screens.
        </RailEmptyHint>
      </div>

      {/* HoloPaper presentation controls (docs/plans/
          INVOICE-STUDIO-HOLOPAPER-HANDOFF.md §3/§6 H2). Presentation-only —
          never touches invoice data, section order, theme, numbering, or
          publish identity; switching modes here changes nothing the printed
          document or Download .html/Publish paths read (H14). */}
      <div id="invoice-rail-cover-holo-section" style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        <RailSegmented
          label="Holo Paper"
          options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
          value={holoEnabled ? 'on' : 'off'}
          onSelect={(v) => { if (typeof setHoloEnabled === 'function') setHoloEnabled(v === 'on'); }}
        />
        {/* RailSegmented has no per-control disabled prop (a shared primitive
            this lane does not own/edit) — disabled-while-Holo-is-off is
            enforced two ways: visually (dimmed, pointer-events:none) and
            functionally (the onSelect guard below no-ops regardless of how
            the click/keyboard-activation reached it). */}
        <div
          id="invoice-rail-cover-holo-interact-row"
          aria-disabled={!holoEnabled}
          style={{ opacity: holoEnabled ? 1 : 0.45, pointerEvents: holoEnabled ? 'auto' : 'none' }}
        >
          <RailSegmented
            label="Interact with paper"
            options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]}
            value={sceneInteractive ? 'on' : 'off'}
            onSelect={(v) => {
              if (!holoEnabled || typeof setSceneInteractive !== 'function') return;
              setSceneInteractive(v === 'on');
            }}
          />
        </div>
        {holoEnabled && sceneInteractive ? (
          <button
            id="invoice-rail-cover-holo-reset-view-btn"
            type="button"
            onClick={() => { if (typeof bumpResetView === 'function') bumpResetView(); }}
            style={{ ...ui.btn(false), height: 34, padding: '0 14px', fontSize: 11.5, gap: 6, alignSelf: 'flex-start' }}
          >
            <RotateCcw size={13} strokeWidth={2.5} /> Reset view
          </button>
        ) : null}
        <RailEmptyHint>
          Interact mode lets you grab, orbit, and fling the sheet. Turn it off to edit text on the paper.
        </RailEmptyHint>
      </div>
    </SectionCard>
  );
}
