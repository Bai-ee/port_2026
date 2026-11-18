'use client';

// Brief Studio rail - Theme card. Same built-in themes and the same swatch
// picker as Invoice Studio's Cover card (theme-schema.js).

import React from 'react';
import { Palette } from 'lucide-react';
import { RailCard, GLASS, ui } from '../../components/rail-ui';
import { RailField, RailEmptyHint } from '../../invoice/rail/rail-field-controls';
import { BUILTIN_THEME_PRESETS } from '../../invoice/themes/theme-schema.js';

const THEME_CHOICES = [
  { id: null, label: 'Default', swatch: ['#ffffff', '#000000', 'transparent'], why: "Today's plain white/black look." },
  ...BUILTIN_THEME_PRESETS.map((t) => ({
    id: t.id, label: t.label, swatch: [t.colors.paper, t.colors.ink, t.colors.accent], why: t.why,
  })),
];

export default function ThemeCard({ draft, open, onToggle }) {
  const current = THEME_CHOICES.find((c) => c.id === draft.themeId) || THEME_CHOICES[0];
  return (
    <RailCard
      id="brief-rail-theme-card" icon={<Palette size={18} strokeWidth={2} />} title="Theme"
      subtitle={current.label} color="#8b5cf6" open={open} onToggle={onToggle}
    >
      <RailField label="Design">
        <div id="brief-rail-theme-swatch-row" role="radiogroup" aria-label="Design theme" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {THEME_CHOICES.map((choice) => {
            const active = (draft.themeId || null) === choice.id;
            return (
              <button
                key={choice.id || 'default'}
                type="button"
                role="radio"
                aria-checked={active}
                title={choice.why}
                onClick={() => draft.setTheme(choice.id)}
                style={{ ...ui.btn(active), height: 'auto', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '8px 10px', minWidth: 84, borderRadius: 12 }}
              >
                <span
                  aria-hidden="true"
                  style={{ display: 'flex', width: '100%', height: 16, borderRadius: 5, overflow: 'hidden', border: '1px solid ' + (active ? 'rgba(255,255,255,0.35)' : GLASS.hair) }}
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
        Swaps fonts and colors, never the layout. The PDF is always A4 (the server prints A4 for every theme); Studio Dark prints as dark ink on white.
      </RailEmptyHint>
    </RailCard>
  );
}
