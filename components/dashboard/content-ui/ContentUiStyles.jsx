'use client';

// Shared Content Center styles. Every selector is prefixed `.xce-scope` (the root
// element of any surface using these panels; Content Center's root also keeps
// id="x-content-card"). Global on purpose: scoped styled-jsx does not tag markup
// rendered by child panels. Keep the template literal inline (a variable fails
// the styled-jsx compile).

export default function ContentUiStyles() {
  return (
      <style jsx global>{`
        /* Mobile first: every rule below is the phone layout. Widening happens
           only in the one min-width block at the bottom. */
        .xce-scope { margin-top: 18px; display: grid; gap: 12px; }

        .xce-scope .xce-tabs { position: relative; display: flex; gap: 6px; padding-bottom: 12px; }
        .xce-scope .xce-tabs::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #22c7e8 0%, #8a5cf0 55%, #e23fb8 100%); }
        .xce-scope .xce-tab { flex: 1; min-height: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.62); cursor: pointer; }
        .xce-scope .xce-tab-active { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        .xce-scope .xce-client { margin: 0; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(31,29,27,0.5); }

        .xce-scope .xce-panel { border: 1px solid rgba(31,29,27,0.12); background: #fff; border-radius: 16px; padding: 14px; box-shadow: 0 1px 2px rgba(31,29,27,0.04); }
        .xce-scope .xce-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .xce-scope .xce-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.62); }
        .xce-scope .xce-sub { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-empty { border: 1px dashed rgba(31,29,27,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 18px 14px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-error { margin: 0 0 10px; font-size: 12px; line-height: 1.4; color: #9f1f17; }

        /* Buttons */
        .xce-scope .xce-btn { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 12px; border: 1px solid #1f1d1b; background: #1f1d1b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
        .xce-scope .xce-btn:disabled { opacity: 0.5; cursor: default; }
        .xce-scope .xce-ghost { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 12px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.16); background: #fff; color: #1f1d1b; font-size: 11px; font-weight: 700; cursor: pointer; }
        .xce-scope .xce-danger { border-color: rgba(159,31,23,0.3); color: #9f1f17; background: rgba(159,31,23,0.05); }

        /* Tier selector */
        .xce-scope .xce-tier { display: inline-flex; gap: 4px; }
        .xce-scope .xce-tier button { min-height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(31,29,27,0.14); background: #fff; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); cursor: pointer; }
        .xce-scope .xce-tier button[aria-pressed="true"] { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }

        /* Header bits */
        .xce-scope .xce-head-date { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-head-count { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-tier-selector { display: inline-flex; flex: 1 1 100%; border: 1px solid rgba(31,29,27,0.12); border-radius: 999px; padding: 2px; background: #fff; }
        .xce-scope .xce-tier-option { flex: 1 1 0; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; font-size: 11.5px; font-weight: 700; color: rgba(31,29,27,0.6); cursor: pointer; }
        .xce-scope .xce-tier-option-active { background: #1f1d1b; color: #fff; }
        .xce-scope .xce-plan-readout { display: flex; flex: 1 1 100%; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border: 1px solid rgba(31,29,27,0.12); border-radius: 12px; padding: 6px 10px; background: #fff; font-size: 11.5px; font-weight: 700; color: rgba(31,29,27,0.75); }
        .xce-scope .xce-plan-readout button { min-height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid #1f1d1b; background: #1f1d1b; color: #fff; font-size: 11.5px; font-weight: 700; cursor: pointer; }
        .xce-scope .xce-tier-option:disabled { opacity: 0.48; cursor: not-allowed; }
        .xce-scope .xce-refresh { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(31,29,27,0.12); border-radius: 999px; background: #fff; font-size: 11px; font-weight: 700; color: #1f1d1b; cursor: pointer; }
        .xce-scope .xce-refresh:disabled { opacity: 0.48; cursor: not-allowed; }

        /* States */
        .xce-scope .xce-loading { padding: 14px; text-align: center; font-size: 12.5px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-empty-note { font-size: 11.5px; color: rgba(31,29,27,0.45); }
        /* An unfilled slot is an inventory shortfall, not a failure — amber, not red. */
        .xce-scope .xce-shortfall { margin: 0; padding: 8px 10px; border-radius: 10px; background: rgba(183,121,31,0.08); border: 1px solid rgba(183,121,31,0.24); font-size: 12px; line-height: 1.45; color: #8a5a15; }
        .xce-scope .xce-audit { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.45); }

        /* Slot rows — stacked on a phone, never a horizontal scroll */
        .xce-scope .xce-slot-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-slot { display: grid; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: #fff; }
        .xce-scope .xce-slot-scan { background: rgba(255,255,255,0.45); }
        .xce-scope .xce-slot-ledger { border-color: rgba(47,158,107,0.24); }
        .xce-scope .xce-gap { border-style: dashed; border-color: rgba(183,121,31,0.4); background: rgba(183,121,31,0.05); }
        .xce-scope .xce-slot-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; min-width: 0; }
        .xce-scope .xce-slot-time { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-slot-type { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); }
        .xce-scope .xce-slot-lane { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.45); }
        .xce-scope .xce-slot-score { font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(31,29,27,0.07); color: #1f1d1b; }
        .xce-scope .xce-slot-body { display: flex; gap: 10px; align-items: flex-start; min-width: 0; }
        .xce-scope .xce-slot-detail { min-width: 0; max-width: 100%; display: grid; gap: 4px; }
        .xce-scope .xce-slot-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .xce-scope .xce-draft-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 0 14px; border-radius: 999px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-size: 12px; font-weight: 700; color: #1f1d1b; cursor: pointer; }
        .xce-scope .xce-draft-button:disabled { opacity: 0.48; cursor: not-allowed; }

        /* Row content */
        .xce-scope .xce-muted { margin: 0; font-size: 12px; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-post-text { margin: 0; font-size: 12.5px; line-height: 1.5; color: #1f1d1b; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        /* Package ids and post URLs are long and unbroken; without this they
           widen the row and reintroduce horizontal scrolling on a phone. */
        .xce-scope .xce-asset { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); overflow-wrap: anywhere; }
        .xce-scope .xce-asset a { color: inherit; text-decoration: none; }
        .xce-scope .xce-asset a:hover { text-decoration: underline; }
        .xce-scope .xce-reason { margin: 0; font-size: 11px; line-height: 1.45; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-pkg-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0; min-width: 0; }
        .xce-scope .xce-pkg-id { font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-story { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(31,29,27,0.78); }
        .xce-scope .xce-self-reply { margin: 0; font-size: 11.5px; line-height: 1.45; color: rgba(31,29,27,0.6); }
        .xce-scope .xce-self-reply-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.45); }
        .xce-scope .xce-gap-label { margin: 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a5a15; }
        .xce-scope .xce-gap-need { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(31,29,27,0.7); }

        /* Placeholder artwork — CSS only. The archive is not populated yet, so
           nothing here loads an image or reaches the network. */
        .xce-scope .xce-thumb { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(31,29,27,0.12); background: linear-gradient(135deg, rgba(31,29,27,0.10), rgba(31,29,27,0.04)); color: rgba(31,29,27,0.6); }
        .xce-scope .xce-thumb-code { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #1f1d1b; }
        .xce-scope .xce-thumb-gap { background: transparent; border-style: dashed; border-color: rgba(183,121,31,0.4); color: rgba(183,121,31,0.7); }

        /* Chips */
        .xce-scope .xce-chip { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid rgba(31,29,27,0.1); background: rgba(31,29,27,0.05); font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase; color: #3a332e; }
        .xce-scope .xce-chip-adopted { border-color: rgba(47,158,107,0.3); background: rgba(47,158,107,0.1); color: #23684a; }
        .xce-scope .xce-chip-blue { border-color: rgba(40,105,200,0.28); background: rgba(40,105,200,0.1); color: #1f55a6; }
        .xce-scope .xce-chip-warn { border-color: rgba(183,121,31,0.3); background: rgba(183,121,31,0.08); color: #8a5a15; }

        /* Draft preview */
        .xce-scope .xce-draft { margin-top: 8px; padding: 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: rgba(255,255,255,0.85); }
        .xce-scope .xce-draft-text { margin: 0 0 6px; font-size: 13px; line-height: 1.5; color: #1f1d1b; }
        .xce-scope .xce-draft-meta { margin: 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-draft-bad { color: #9f1f17; }

        /* ── Inventory ────────────────────────────────────────────────── */
        .xce-scope .xce-inv { display: grid; gap: 12px; }
        .xce-scope .xce-inv-section { display: grid; gap: 8px; }
        .xce-scope .xce-inv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-inv-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.62); }
        .xce-scope .xce-inv-count { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-inv-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-inv-row-item { min-width: 0; }
        .xce-scope .xce-inv-row { display: grid; grid-template-columns: 44px 1fr; align-items: start; gap: 10px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: #fff; text-align: left; cursor: pointer; width: 100%; font: inherit; }
        .xce-scope .xce-inv-row-active { border-color: #1f1d1b; }
        .xce-scope .xce-inv-row-main { min-width: 0; display: grid; gap: 4px; }
        .xce-scope .xce-inv-row-title { margin: 0; font-size: 13px; font-weight: 700; line-height: 1.35; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-inv-row-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; }
        .xce-scope .xce-inv-meta-item { font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-inv-row-flags { display: flex; flex-wrap: wrap; gap: 6px; }
        .xce-scope .xce-inv-thumb { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid rgba(31,29,27,0.12); background: linear-gradient(135deg, rgba(31,29,27,0.10), rgba(31,29,27,0.04)); font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-inv-title { margin: 0; font-size: 13px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-inv-meta { margin: 2px 0 0; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }

        /* Editor form */
        .xce-scope .xce-editor { display: grid; gap: 10px; padding-top: 4px; border-top: 1px solid rgba(31,29,27,0.1); }
        .xce-scope .xce-form { display: grid; gap: 10px; }
        .xce-scope .xce-form-grid { display: grid; gap: 10px; }
        .xce-scope .xce-field { display: grid; gap: 4px; min-width: 0; }
        .xce-scope .xce-field-label,
        .xce-scope .xce-field label { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-field-hint,
        .xce-scope .xce-field-note { margin: 0; font-size: 11px; line-height: 1.4; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-hint-strong { font-weight: 700; color: rgba(31,29,27,0.72); }
        /* 16px inputs: anything smaller makes iOS zoom the whole modal on focus. */
        .xce-scope .xce-input,
        .xce-scope .xce-select,
        .xce-scope .xce-textarea,
        .xce-scope .xce-field input,
        .xce-scope .xce-field select,
        .xce-scope .xce-field textarea { width: 100%; min-height: 38px; border: 1px solid rgba(31,29,27,0.14); border-radius: 12px; padding: 8px 12px; background: rgba(255,255,255,0.98); color: #1f1d1b; font-family: inherit; font-size: 16px; line-height: 1.45; outline: none; }
        .xce-scope .xce-textarea,
        .xce-scope .xce-field textarea { min-height: 120px; resize: vertical; }
        .xce-scope .xce-input:focus,
        .xce-scope .xce-select:focus,
        .xce-scope .xce-textarea:focus,
        .xce-scope .xce-field input:focus,
        .xce-scope .xce-field select:focus,
        .xce-scope .xce-field textarea:focus { border-color: rgba(31,29,27,0.36); box-shadow: 0 0 0 3px rgba(31,29,27,0.08); }
        .xce-scope .xce-toggle-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .xce-scope .xce-toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(31,29,27,0.14); background: #fff; font-size: 12px; color: rgba(31,29,27,0.75); cursor: pointer; }
        .xce-scope .xce-toggle input { width: auto; min-height: 0; margin: 0; }

        /* Actions */
        .xce-scope .xce-actions,
        .xce-scope .xce-form-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
        .xce-scope .xce-btn-primary { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 12px; border: 1px solid #1f1d1b; background: #1f1d1b; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
        .xce-scope .xce-btn-ghost { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.16); background: #fff; color: #1f1d1b; font-size: 12px; font-weight: 700; cursor: pointer; }
        .xce-scope .xce-btn-danger { min-height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.3); background: rgba(159,31,23,0.05); color: #9f1f17; font-size: 12px; font-weight: 700; cursor: pointer; }
        .xce-scope .xce-btn-primary:disabled,
        .xce-scope .xce-btn-ghost:disabled,
        .xce-scope .xce-btn-danger:disabled { opacity: 0.48; cursor: not-allowed; }

        /* Validation feedback. Errors block the save; warnings are advice and
           must never look like failures, or nobody reads either. */
        .xce-scope .xce-feedback { border-radius: 10px; padding: 8px 10px; border: 1px solid transparent; }
        .xce-scope .xce-feedback-head { margin: 0; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        .xce-scope .xce-feedback-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; }
        .xce-scope .xce-feedback-error { border-color: rgba(159,31,23,0.24); background: rgba(159,31,23,0.05); color: #9f1f17; }
        .xce-scope .xce-feedback-warn { border-color: rgba(183,121,31,0.24); background: rgba(183,121,31,0.06); color: #8a5a15; }
        .xce-scope .xce-warn-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; color: #8a5a15; }
        .xce-scope .xce-err-list { margin: 6px 0 0; padding-left: 16px; display: grid; gap: 4px; font-size: 11.5px; line-height: 1.45; color: #9f1f17; }
        .xce-scope .xce-notice { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(31,29,27,0.6); }
        .xce-scope .xce-notice-error { color: #9f1f17; }
        .xce-scope .xce-chip-series { font-family: var(--font-mono); letter-spacing: 0.04em; }
        .xce-scope .xce-chip-status { background: #fff; border-color: rgba(31,29,27,0.14); color: rgba(31,29,27,0.55); }
        .xce-scope .xce-chip-error { border-color: rgba(159,31,23,0.28); background: rgba(159,31,23,0.07); color: #9f1f17; }
        .xce-scope .xce-checks { display: flex; flex-wrap: wrap; gap: 8px; }
        .xce-scope .xce-check { display: inline-flex; align-items: center; gap: 6px; min-height: 34px; font-size: 12px; color: rgba(31,29,27,0.75); }
        .xce-scope .xce-check input { width: auto; min-height: 0; }

        /* State modifiers the panels emit alongside their base classes. */
        .xce-scope .xce-inv-row.is-active { border-color: rgba(31,29,27,0.4); background: rgba(255,255,255,0.95); }
        .xce-scope .xce-inv-row.is-busy { opacity: 0.6; pointer-events: none; }
        .xce-scope .xce-toggle.is-on { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        .xce-scope .xce-input.is-locked { background: rgba(31,29,27,0.04); color: rgba(31,29,27,0.6); cursor: default; }
        /* A long series label ("C1 · Record of the Day") is the one chip that
           can push a row wider than the phone and bring back horizontal scroll. */
        .xce-scope .xce-chip-series { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xce-scope .xce-inv-row-flags { grid-column: 1 / -1; }

        /* MOBILE WIDTH STANDARD — at ≤480px the padding chain collapses to the
           single shared gutter so content spans the viewport.
           See docs/dashboard-ui/MOBILE-WIDTH-STANDARD.md. */
        @media (max-width: 480px) {
          .xce-scope .xce-panel,
          .xce-scope .xce-inv-section { padding: 12px var(--mobile-gutter, 8px); border-radius: 12px; }
          .xce-scope .xce-actions .xce-btn,
          .xce-scope .xce-actions .xce-btn-primary,
          .xce-scope .xce-actions .xce-btn-ghost,
          .xce-scope .xce-actions .xce-btn-danger { flex: 1 1 auto; }
        }

        /* The only widening rule. Below this everything is one column. */
        @media (min-width: 640px) {
          .xce-scope .xce-inv-row { grid-template-columns: 44px minmax(0,1fr) auto; }
          .xce-scope .xce-inv-row-flags { grid-column: auto; justify-content: flex-end; }
          .xce-scope .xce-tier-selector { flex: 0 0 auto; margin-left: auto; }
          .xce-scope .xce-slot-score { margin-left: auto; }
          .xce-scope .xce-thumb { width: 56px; height: 56px; }
          .xce-scope .xce-panel { padding: 16px; }
          .xce-scope .xce-slot { grid-template-columns: 44px 1fr; }
          .xce-scope .xce-form-grid { grid-template-columns: 1fr 1fr; }
          .xce-scope .xce-field-wide { grid-column: 1 / -1; }
        }
        /* ── Calendar + Clients ───────────────────────────────────────── */
        .xce-scope .xce-tabs { flex-wrap: wrap; }
        .xce-scope .xce-tab { flex: 1 1 auto; min-width: 0; }
        .xce-scope .xce-engine-counts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .xce-scope .xce-engine-count { display: grid; gap: 2px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); background: #fff; border-left-width: 4px; min-width: 0; }
        .xce-scope .xce-engine-short { background: rgba(183,121,31,0.06); }
        .xce-scope .xce-engine-name { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.6); }
        .xce-scope .xce-engine-num { font-family: var(--font-mono); font-size: 16px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-engine-limit { font-size: 10.5px; color: rgba(31,29,27,0.5); overflow-wrap: anywhere; }
        .xce-scope .xce-engine-record { border-left-color: #b7791f; }
        .xce-scope .xce-engine-ue { border-left-color: #3b6fd4; }
        .xce-scope .xce-engine-client { border-left-color: #2f9e6b; }
        .xce-scope .xce-engine-identity { border-left-color: #7a4bd0; }
        .xce-scope .xce-engine-untagged { border-left-color: rgba(31,29,27,0.3); }
        .xce-scope .xce-engine-chip { border-left-width: 1px; background: rgba(31,29,27,0.05); }
        .xce-scope .xce-flag-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        .xce-scope .xce-week-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-week-day { display: grid; gap: 6px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: rgba(255,255,255,0.5); min-width: 0; }
        .xce-scope .xce-week-day-head { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-week-slots { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        .xce-scope .xce-week-slot { display: grid; gap: 6px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); border-left-width: 4px; background: #fff; min-width: 0; }
        .xce-scope .xce-skipped-label { color: rgba(31,29,27,0.55); }
        .xce-scope .xce-textarea-short { min-height: 64px; }
        .xce-scope .xce-week-slot .xce-input { max-width: 100%; }

        /* ── Month calendar (MonthCalendarPanel + PostSheet) ─────────────
           Status is weight, never a colour strip: scheduled = solid outline +
           filled dot, pending = grey dashed + hollow dot, posted = muted +
           check, failed = the only red. Grid lines are neutral structure. */
        .xce-scope .xce-mc { display: grid; gap: 14px; }
        .xce-scope .xce-mc-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
        .xce-scope .xce-mc-title-block { display: grid; gap: 6px; min-width: 0; }
        .xce-scope .xce-mc-title { margin: 0; font-size: 28px; line-height: 1; font-weight: 500; letter-spacing: -0.02em; color: #2a2420; }
        .xce-scope .xce-mc-summary { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-summary strong { color: #2a2420; font-weight: 700; }
        .xce-scope .xce-mc-summary-failed,
        .xce-scope .xce-mc-summary-failed strong { color: #9f1f17; }
        .xce-scope .xce-mc-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-mc-nav { display: inline-flex; align-items: center; gap: 2px; }
        .xce-scope .xce-mc-icon-btn { width: 34px; height: 34px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #2a2420; cursor: pointer; transition: background 120ms ease-out, border-color 120ms ease-out; }
        .xce-scope .xce-mc-icon-btn:hover:not(:disabled) { border-color: rgba(42,36,32,0.16); background: rgba(255,255,255,0.85); }
        .xce-scope .xce-mc-icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
        .xce-scope .xce-mc-text-btn,
        .xce-scope .xce-mc-seg { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
        .xce-scope .xce-mc-text-btn { min-height: 34px; padding: 0 12px; border: 1px solid rgba(42,36,32,0.16); border-radius: 999px; background: rgba(255,255,255,0.7); color: #2a2420; }
        .xce-scope .xce-mc-text-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .xce-scope .xce-mc-filter-on { background: #2a2420; border-color: #2a2420; color: #fff; }
        .xce-scope .xce-mc-segmented { display: inline-flex; padding: 2px; border: 1px solid rgba(42,36,32,0.14); border-radius: 999px; background: rgba(255,255,255,0.6); }
        .xce-scope .xce-mc-seg { min-height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-seg-active { background: #2a2420; color: #fff; }
        .xce-scope .xce-mc-review { min-height: 34px; border-radius: 999px; }
        .xce-scope .xce-mc button:focus-visible,
        .xce-scope .xce-mc-sheet button:focus-visible { outline: 2px solid rgba(42,36,32,0.55); outline-offset: 2px; }

        .xce-scope .xce-mc-grid { display: grid; border-top: 1px solid rgba(42,36,32,0.12); border-bottom: 1px solid rgba(42,36,32,0.08); transition: opacity 120ms ease-out; }
        .xce-scope .xce-mc-grid-loading { opacity: 0.5; }
        .xce-scope .xce-mc-weekdays,
        .xce-scope .xce-mc-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
        .xce-scope .xce-mc-weekday { padding: 8px 6px 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.45); }
        .xce-scope .xce-mc-weekday-short { display: none; }
        .xce-scope .xce-mc-week { border-top: 1px solid rgba(42,36,32,0.08); }
        .xce-scope .xce-mc-day { position: relative; min-width: 0; min-height: 112px; padding: 6px 4px; border-left: 1px solid rgba(42,36,32,0.08); display: flex; flex-direction: column; gap: 4px; cursor: pointer; outline: none; transition: background 120ms ease-out; }
        .xce-scope .xce-mc-week > .xce-mc-day:first-child { border-left: 0; }
        .xce-scope .xce-mc-day:hover { background: rgba(42,36,32,0.025); }
        .xce-scope .xce-mc-day:focus-visible { box-shadow: inset 0 0 0 2px rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-day-selected { background: rgba(42,36,32,0.045); }
        .xce-scope .xce-mc-date { align-self: flex-start; min-width: 24px; height: 24px; padding: 0 6px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #2a2420; }
        .xce-scope .xce-mc-day-past .xce-mc-date { color: rgba(42,36,32,0.42); }
        .xce-scope .xce-mc-day-out .xce-mc-date { color: rgba(42,36,32,0.22); }
        .xce-scope .xce-mc-day-today .xce-mc-date { background: #2a2420; color: #fff; }
        .xce-scope .xce-mc-flag { position: absolute; top: 9px; right: 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: #8a5a15; }
        .xce-scope .xce-mc-chips { display: grid; gap: 3px; min-width: 0; }
        .xce-scope .xce-mc-chip { display: flex; align-items: center; gap: 5px; width: 100%; min-width: 0; min-height: 22px; padding: 0 6px; border: 1px solid rgba(42,36,32,0.5); border-radius: 6px; background: #fff; color: #2a2420; font-size: 11px; text-align: left; cursor: pointer; transition: border-color 120ms ease-out; }
        .xce-scope .xce-mc-chip:hover { border-color: #2a2420; }
        .xce-scope .xce-mc-chip-time { flex: 0 0 auto; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; }
        .xce-scope .xce-mc-chip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xce-scope .xce-mc-chip.xce-mc-state-pending { border-style: dashed; border-color: rgba(42,36,32,0.3); background: transparent; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-chip.xce-mc-state-awaiting { border-style: dashed; border-color: rgba(42,36,32,0.3); background: transparent; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-chip.xce-mc-state-held { border-style: dashed; border-color: rgba(42,36,32,0.3); background: transparent; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-chip.xce-mc-state-pending:hover { border-color: rgba(42,36,32,0.6); }
        .xce-scope .xce-mc-chip.xce-mc-state-awaiting:hover { border-color: rgba(42,36,32,0.6); }
        .xce-scope .xce-mc-chip.xce-mc-state-held:hover { border-color: rgba(42,36,32,0.6); }
        .xce-scope .xce-mc-chip.xce-mc-state-posted { border-color: transparent; background: rgba(42,36,32,0.05); color: rgba(42,36,32,0.6); }
        .xce-scope .xce-mc-chip.xce-mc-state-failed { border-color: rgba(159,31,23,0.5); color: #9f1f17; }
        .xce-scope .xce-mc-more { padding: 0 6px; font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-dots { display: none; }
        .xce-scope .xce-mc-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; background: #2a2420; color: #2a2420; }
        .xce-scope .xce-mc-dot-pending { background: transparent; box-shadow: inset 0 0 0 1.5px rgba(42,36,32,0.4); }
        .xce-scope .xce-mc-dot-awaiting { background: transparent; box-shadow: inset 0 0 0 1.5px rgba(42,36,32,0.4); }
        .xce-scope .xce-mc-dot-manual { background: transparent; box-shadow: inset 0 0 0 1.5px #2a2420; }
        .xce-scope .xce-mc-dot-held { background: transparent; box-shadow: inset 0 0 0 1.5px rgba(42,36,32,0.4); }
        .xce-scope .xce-mc-dot-posted { width: 10px; height: 10px; background: rgba(42,36,32,0.14); }
        .xce-scope .xce-mc-dot-failed { background: #9f1f17; }

        .xce-scope .xce-mc-dayview,
        .xce-scope .xce-mc-agenda-day { display: grid; gap: 6px; }
        .xce-scope .xce-mc-agenda { display: grid; gap: 20px; }
        .xce-scope .xce-mc-kicker { margin: 0; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-agenda-today > .xce-mc-kicker { color: #2a2420; }
        .xce-scope .xce-mc-rows { list-style: none; margin: 0; padding: 0; display: grid; }
        .xce-scope .xce-mc-row { display: flex; align-items: center; gap: 4px; min-width: 0; border-top: 1px solid rgba(42,36,32,0.08); }
        .xce-scope .xce-mc-row:first-child { border-top: 0; }
        .xce-scope .xce-mc-row-main { flex: 1 1 auto; min-width: 0; display: grid; grid-template-columns: 46px 10px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 52px; padding: 8px 4px; border: 0; border-radius: 8px; background: transparent; color: #2a2420; text-align: left; cursor: pointer; transition: background 120ms ease-out; }
        .xce-scope .xce-mc-row-main:hover { background: rgba(42,36,32,0.035); }
        .xce-scope .xce-mc-row-time { font-family: var(--font-mono); font-size: 12px; font-weight: 700; }
        .xce-scope .xce-mc-row-body { display: grid; gap: 2px; min-width: 0; }
        .xce-scope .xce-mc-row-title { font-size: 13px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
        .xce-scope .xce-mc-row-meta { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-row.xce-mc-state-pending .xce-mc-row-time,
        .xce-scope .xce-mc-row.xce-mc-state-pending .xce-mc-row-title { color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-row.xce-mc-state-awaiting .xce-mc-row-title { color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-row.xce-mc-state-held .xce-mc-row-title { color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-row.xce-mc-state-posted .xce-mc-row-title { color: rgba(42,36,32,0.6); }
        .xce-scope .xce-mc-row.xce-mc-state-failed .xce-mc-row-meta { color: #9f1f17; }
        .xce-scope .xce-mc-row-actions { display: inline-flex; gap: 2px; flex: 0 0 auto; }
        .xce-scope .xce-mc-empty { margin: 0; padding: 14px 0; font-size: 12.5px; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-mc-flags { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 11.5px; color: #8a5a15; }
        .xce-scope .xce-mc-unplaced { padding-top: 10px; border-top: 1px solid rgba(42,36,32,0.1); }
        .xce-scope .xce-mc-unplaced > summary { cursor: pointer; list-style: none; min-height: 28px; display: flex; align-items: center; }
        .xce-scope .xce-mc-unplaced > summary::-webkit-details-marker { display: none; }

        /* Phone: dots in the grid, the selected day's list carries the content. */
        @media (max-width: 639px) {
          .xce-scope .xce-mc-title { font-size: 22px; }
          .xce-scope .xce-mc-controls { width: 100%; }
          .xce-scope .xce-mc-review { margin-left: auto; }
          .xce-scope .xce-mc-weekday { padding: 6px 0; text-align: center; }
          .xce-scope .xce-mc-weekday-long { display: none; }
          .xce-scope .xce-mc-weekday-short { display: inline; }
          .xce-scope .xce-mc-day { min-height: 54px; padding: 4px 0; align-items: center; gap: 4px; border-left: 0; }
          .xce-scope .xce-mc-date { align-self: center; min-width: 28px; height: 28px; }
          .xce-scope .xce-mc-day-selected { background: transparent; }
          .xce-scope .xce-mc-day-selected .xce-mc-date { box-shadow: inset 0 0 0 1.5px #2a2420; }
          .xce-scope .xce-mc-day-today.xce-mc-day-selected .xce-mc-date { box-shadow: none; }
          .xce-scope .xce-mc-flag { top: 2px; right: 2px; }
          .xce-scope .xce-mc-chips { display: none; }
          .xce-scope .xce-mc-dots { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 3px; min-height: 10px; }
          .xce-scope .xce-mc-dots-more { font-family: var(--font-mono); font-size: 9px; line-height: 1; color: rgba(42,36,32,0.5); }
          .xce-scope .xce-mc-row-main { min-height: 56px; }
          .xce-scope .xce-mc-icon-btn { width: 44px; height: 44px; }
          .xce-scope .xce-mc-text-btn { min-height: 40px; }
        }
        /* Tablet: time-only chips so a 7-column row still reads. */
        @media (min-width: 640px) and (max-width: 1023px) {
          .xce-scope .xce-mc-day { min-height: 92px; }
          .xce-scope .xce-mc-chip-text { display: none; }
        }
        @media (min-width: 1024px) {
          .xce-scope .xce-mc-day { min-height: 124px; padding: 6px; }
        }

        /* PostSheet: full-screen on phones, right sheet from 481px. */
        .xce-scope .xce-mc-sheet-backdrop { position: fixed; inset: 0; z-index: 70; display: flex; justify-content: flex-end; background: rgba(42,36,32,0.32); animation: xce-mc-fade 140ms ease-out; }
        .xce-scope .xce-mc-sheet { width: 100%; height: 100%; display: flex; flex-direction: column; background: #fbfaf8; outline: none; animation: xce-mc-rise 180ms cubic-bezier(0.2, 0, 0, 1); }
        .xce-scope .xce-mc-sheet-head { display: flex; align-items: center; gap: 6px; padding: 8px var(--mobile-gutter, 8px); border-bottom: 1px solid rgba(42,36,32,0.1); }
        .xce-scope .xce-mc-sheet-state { margin-right: auto; display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #2a2420; }
        .xce-scope .xce-mc-sheet-state.xce-mc-state-pending { color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-sheet-state.xce-mc-state-awaiting { color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-sheet-state.xce-mc-state-held { color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-sheet-state.xce-mc-state-failed { color: #9f1f17; }
        .xce-scope .xce-mc-sheet-queue { display: inline-flex; align-items: center; }
        .xce-scope .xce-mc-sheet-queue-pos { min-width: 44px; text-align: center; font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-sheet-body { flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain; padding: 18px var(--mobile-gutter, 8px) 24px; display: grid; gap: 18px; align-content: start; }
        .xce-scope .xce-mc-sheet-when { margin: 0; font-size: 22px; line-height: 1.15; font-weight: 500; letter-spacing: -0.01em; color: #2a2420; }
        .xce-scope .xce-mc-sheet-media { border-radius: 10px; overflow: hidden; background: #141210; }
        .xce-scope .xce-mc-sheet-media video,
        .xce-scope .xce-mc-sheet-media img { display: block; width: 100%; max-height: 360px; object-fit: contain; }
        .xce-scope .xce-mc-field { display: grid; gap: 6px; min-width: 0; }
        .xce-scope .xce-mc-sheet-body > * { min-width: 0; }
        .xce-scope .xce-mc-sheet textarea,
        .xce-scope .xce-mc-sheet input { box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0; }
        .xce-scope .xce-mc-sheet-text { min-height: 168px; font-size: 15px; line-height: 1.5; }
        .xce-scope .xce-mc-sheet-meta-line { margin: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.55); }
        .xce-scope .xce-mc-over { margin: 0; font-size: 12px; font-weight: 700; color: #9f1f17; }
        .xce-scope .xce-mc-sheet-meta-line .xce-mc-over { font-size: inherit; }
        .xce-scope .xce-mc-when-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 8px; }
        .xce-scope .xce-mc-notice { margin: 0; font-size: 12.5px; line-height: 1.5; color: #8a5a15; }
        .xce-scope .xce-mc-facts { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; }
        .xce-scope .xce-mc-facts dt { padding-top: 1px; font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.45); }
        .xce-scope .xce-mc-facts dd { margin: 0; font-family: var(--font-mono); font-size: 11.5px; color: #2a2420; overflow-wrap: anywhere; }
        .xce-scope .xce-mc-facts a { color: inherit; }
        .xce-scope .xce-mc-sheet-foot { display: grid; gap: 8px; padding: 12px var(--mobile-gutter, 8px) calc(12px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid rgba(42,36,32,0.1); background: #fbfaf8; }
        .xce-scope .xce-mc-sheet-consequence { margin: 0; font-size: 12px; line-height: 1.4; color: rgba(42,36,32,0.65); }
        .xce-scope .xce-mc-sheet-buttons { display: flex; flex-wrap: wrap; gap: 8px; }
        .xce-scope .xce-mc-sheet-buttons .xce-btn-primary { margin-left: auto; }
        .xce-scope .xce-mc-sheet-keys { display: none; margin: 0; font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.4); }
        @media (max-width: 480px) {
          .xce-scope .xce-mc-sheet-buttons > button { flex: 1 1 0; min-height: 44px; }
          .xce-scope .xce-mc-sheet-buttons .xce-btn-primary { order: -1; flex-basis: 100%; margin-left: 0; }
        }
        @media (min-width: 481px) {
          .xce-scope .xce-mc-sheet { max-width: 480px; border-left: 1px solid rgba(42,36,32,0.14); animation-name: xce-mc-slide; }
          .xce-scope .xce-mc-sheet-head { padding: 10px 16px; }
          .xce-scope .xce-mc-sheet-body { padding: 22px 20px 28px; }
          .xce-scope .xce-mc-sheet-foot { padding: 14px 20px; }
        }
        @media (min-width: 1024px) and (pointer: fine) {
          .xce-scope .xce-mc-sheet-keys { display: block; }
        }
        @keyframes xce-mc-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes xce-mc-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes xce-mc-slide { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .xce-scope .xce-mc-sheet,
          .xce-scope .xce-mc-sheet-backdrop { animation: none; }
        }

        /* ---- Pilot calendar states: awaiting / held, row notes, conflict + override + reconcile (PostSheet / MonthCalendarPanel) ---- */
        .xce-scope .xce-mc-summary-held { color: #7a4e08; font-weight: 700; }
        .xce-scope .xce-mc-chip.xce-mc-state-held, .xce-scope .xce-mc-sheet-state.xce-mc-state-held { border-color: rgba(196,128,20,0.6); color: #7a4e08; }
        .xce-scope .xce-mc-dot-held { box-shadow: inset 0 0 0 1.5px rgba(196,128,20,0.9); }
        .xce-scope .xce-mc-row-note { display: block; margin-top: 2px; font-size: 11.5px; line-height: 1.4; color: rgba(42,36,32,0.6); overflow-wrap: anywhere; }
        .xce-scope .xce-mc-row-note-failed { color: #9f1f17; }
        .xce-scope .xce-mc-held { margin: 0; padding: 8px 10px; border-left: 3px solid rgba(196,128,20,0.8); background: rgba(196,128,20,0.07); }
        .xce-scope .xce-mc-held-reason { margin: 0; font-weight: 700; font-size: 12.5px; }
        .xce-scope .xce-mc-held-next { margin: 2px 0 0; font-size: 12px; color: rgba(42,36,32,0.7); }
        .xce-scope .xce-mc-held-detail { margin: 4px 0 0; font-family: var(--font-mono); font-size: 11px; color: rgba(42,36,32,0.55); overflow-wrap: anywhere; }
        .xce-scope .xce-mc-failed { padding: 8px 10px; border-left: 3px solid #9f1f17; font-size: 12.5px; overflow-wrap: anywhere; }
        .xce-scope .xce-mc-conflict { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid rgba(196,128,20,0.5); border-radius: 8px; background: rgba(196,128,20,0.07); }
        .xce-scope .xce-mc-conflict-text { flex: 1 1 200px; font-size: 12.5px; min-width: 0; }
        .xce-scope .xce-mc-override { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid rgba(31,29,27,0.12); }
        .xce-scope .xce-mc-override-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; min-height: 32px; }
        .xce-scope .xce-mc-override-note { font-size: 11.5px; color: rgba(42,36,32,0.6); }
        .xce-scope .xce-mc-discard { padding: 8px 10px; background: rgba(196,128,20,0.12); font-size: 12.5px; font-weight: 700; border-radius: 8px; }
        .xce-scope .xce-mc-reconcile { display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; }

        /* ── Results (performance) ────────────────────────────────────── */
        .xce-scope .xce-perf-list { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-perf-row { display: grid; gap: 6px; padding: 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); border-left-width: 4px; background: #fff; min-width: 0; }
        .xce-scope .xce-perf-name { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .xce-scope .xce-perf-flag { font-family: var(--font-mono); font-size: 10px; font-weight: 700; color: #b7791f; }
        .xce-scope .xce-perf-rank { font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-perf-grid { margin: 0; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
        .xce-scope .xce-perf-grid dt { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-perf-grid dd { margin: 0; font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-perf-meaning { margin: 0; font-size: 12px; line-height: 1.45; color: rgba(31,29,27,0.7); overflow-wrap: anywhere; }
        @media (max-width: 480px) {
          .xce-scope .xce-perf-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
        }

        /* ── Buckets ──────────────────────────────────────────────────── */
        .xce-scope .xce-bk { display: grid; gap: 10px; }
        .xce-scope .xce-bk-search { display: grid; gap: 4px; }
        .xce-scope .xce-bk-search > svg { display: none; }
        .xce-scope .xce-bk-layout { display: grid; gap: 10px; min-width: 0; }
        .xce-scope .xce-bk-main { display: grid; gap: 10px; min-width: 0; align-content: start; }
        /* Rail: fixed-height rows that never stretch with the grid beside them
           (the grid grows as content populates; the rail must not). Buttons
           follow the card's established button spec: 38px, 10px radius. */
        .xce-scope .xce-bk-rail { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-self: start; }
        .xce-scope .xce-bk-rail > * { flex: 0 0 auto; }
        .xce-scope .xce-bk-list { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; overflow-x: auto; max-width: 100%; align-items: flex-start; }
        .xce-scope .xce-bk-item { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; min-width: 0; }
        .xce-scope .xce-bk-item.is-inactive { opacity: 0.55; }
        .xce-scope .xce-bk-chip { display: inline-flex; align-items: center; gap: 8px; height: 38px; min-height: 38px; padding: 0 12px; box-sizing: border-box; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-size: 12px; font-weight: 700; color: #1f1d1b; cursor: pointer; white-space: nowrap; text-align: left; }
        .xce-scope .xce-bk-chip.is-active { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        .xce-scope .xce-bk-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
        .xce-scope .xce-bk-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
        .xce-scope .xce-bk-count { flex: 0 0 auto; font-family: var(--font-mono); font-size: 10.5px; opacity: 0.65; }
        .xce-scope .xce-bk-share { display: none; padding-left: 12px; font-family: var(--font-mono); font-size: 10px; line-height: 1.2; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-bk-tools { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; }
        .xce-scope .xce-bk-rename { display: grid; grid-template-columns: minmax(0,1fr) 38px 38px; gap: 6px; align-items: center; }
        .xce-scope .xce-bk-icon { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-width: 38px; height: 38px; box-sizing: border-box; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; color: #1f1d1b; cursor: pointer; }
        .xce-scope #x-content-bucket-add { width: 100%; }
        /* Rail row = bucket button + fixed 38px "⋯" menu on EVERY row (no row ever grows or shifts). */
        .xce-scope .xce-bk-row { display: grid; grid-template-columns: minmax(0,1fr) 38px; gap: 6px; align-items: center; width: 100%; }
        .xce-scope .xce-bk-more-spacer { width: 38px; height: 38px; }
        .xce-scope .xce-bk-more .xce-pop-trigger { border-color: transparent; background: transparent; color: rgba(31,29,27,0.45); }
        .xce-scope .xce-bk-more .xce-pop-trigger:hover, .xce-scope .xce-bk-more .xce-pop-trigger.is-open { border-color: rgba(31,29,27,0.12); background: #fff; color: #1f1d1b; }
        /* Toolbar: one fixed-height row, identical for every bucket. */
        .xce-scope .xce-bk-toolbar { display: flex; align-items: center; gap: 8px; height: 38px; min-width: 0; }
        .xce-scope .xce-bk-view { height: 38px; min-height: 38px; flex: 0 1 260px; min-width: 0; border-radius: 10px; font-size: 12px; font-weight: 700; }
        .xce-scope .xce-bk-toolbar-count { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-bk-toolbar-icons { display: inline-flex; gap: 6px; flex: 0 0 auto; }
        .xce-scope .xce-bk-toolbar-icons .xce-bk-icon { width: 38px; }
        .xce-scope .xce-spin { animation: xce-spin 0.9s linear infinite; }
        @keyframes xce-spin { to { transform: rotate(360deg); } }
        /* Popovers float over content — opening one never moves the layout. */
        .xce-scope .xce-pop { position: relative; display: inline-flex; }
        .xce-scope .xce-pop-panel { position: absolute; top: calc(100% + 6px); z-index: 40; min-width: 220px; max-width: min(320px, 86vw); max-height: 60vh; overflow-y: auto; padding: 6px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fbfaf8; box-shadow: 0 10px 28px rgba(0,0,0,0.12); box-sizing: border-box; }
        .xce-scope .xce-pop-panel.align-right { right: 0; }
        .xce-scope .xce-pop-panel.align-left { left: 0; }
        .xce-scope .xce-pop-panel .xce-bk-form { border: 0; background: transparent; padding: 4px; }
        .xce-scope .xce-pop-panel .xce-bk-legend { display: grid; gap: 8px; padding: 6px; }
        .xce-scope .xce-pop-list { display: grid; gap: 2px; }
        .xce-scope .xce-pop-item { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; font: inherit; font-size: 12px; font-weight: 600; color: #1f1d1b; text-align: left; cursor: pointer; }
        .xce-scope .xce-pop-item:hover:not(:disabled) { background: rgba(31,29,27,0.06); }
        .xce-scope .xce-pop-item:disabled { opacity: 0.4; cursor: default; }
        .xce-scope .xce-pop-item.is-danger { color: #9f1f17; }
        .xce-scope .xce-pop-item .xce-bk-count { margin-left: auto; }
        .xce-scope .xce-bk-results { display: grid; gap: 16px; }
        .xce-scope .xce-bk-result-group { display: grid; gap: 8px; }
        .xce-scope .xce-bk-result-head { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 12px; font-weight: 700; color: #1f1d1b; }
        .xce-scope .xce-bk-result-head .xce-bk-count { margin-left: 2px; }
        .xce-scope .xce-pop-label { margin: 4px 10px; font-family: var(--font-mono); font-size: 10px; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-bk-icon:disabled { opacity: 0.4; cursor: default; }
        .xce-scope .xce-bk-link { border: 0; background: none; padding: 0; font: inherit; color: #9f1f17; cursor: pointer; text-decoration: underline; }
        .xce-scope .xce-bk-form { display: grid; gap: 8px; padding: 10px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.1); background: rgba(255,255,255,0.5); }
        .xce-scope .xce-bk-share-row { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 8px; }
        .xce-scope .xce-bk-folder-section { display: grid; gap: 6px; }
        .xce-scope .xce-bk-folders { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
        .xce-scope .xce-bk-folder { display: inline-flex; align-items: center; gap: 6px; height: 38px; min-height: 38px; box-sizing: border-box; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; font-size: 11.5px; font-weight: 700; color: #1f1d1b; cursor: pointer; max-width: 100%; }
        .xce-scope .xce-bk-folder.is-active { background: #1f1d1b; border-color: #1f1d1b; color: #fff; }
        .xce-scope .xce-bk-folder-add, .xce-scope .xce-bk-suggest { border-style: dashed; }
        .xce-scope .xce-bk-rule { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xce-scope .xce-bk-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px; }
        .xce-scope .xce-bk-card-li { min-width: 0; }
        .xce-scope .xce-bk-card { display: grid; gap: 6px; width: 100%; padding: 6px 6px 8px; text-align: left; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); background: #fff; font: inherit; cursor: pointer; align-content: start; }
        .xce-scope .xce-bk-card.is-active { border-color: #1f1d1b; }
        .xce-scope .xce-bk-thumb { display: block; aspect-ratio: 1 / 1; border-radius: 8px; overflow: hidden; background: linear-gradient(135deg, rgba(31,29,27,0.10), rgba(31,29,27,0.04)); }
        .xce-scope .xce-bk-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .xce-scope .xce-bk-thumb-ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; width: 100%; height: 100%; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-bk-card-title { padding: 0 2px; font-size: 12px; font-weight: 600; line-height: 1.35; color: #1f1d1b; overflow-wrap: break-word; hyphens: auto; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: calc(1.35em * 2); }
        .xce-scope .xce-bk-card-meta { display: flex; flex-wrap: wrap; gap: 4px; }
        /* Status as dots, not text pills: bucket · status · story · rights · daily-auto. Meaning on hover + in the legend. */
        .xce-scope .xce-bk-card-dots { display: flex; align-items: center; gap: 5px; padding: 0 2px; min-height: 10px; }
        .xce-scope .xce-bk-dotmark { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid transparent; box-sizing: border-box; flex: 0 0 auto; }
        .xce-scope .xce-bk-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-size: 10px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-bk-legend-item { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
        .xce-scope .xce-bk-drawer-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(31,29,27,0.35); display: flex; justify-content: flex-end; }
        .xce-scope .xce-bk-drawer { width: 100%; max-width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; background: #fbfaf8; padding: 14px var(--mobile-gutter, 8px) 24px; display: grid; gap: 12px; align-content: start; box-sizing: border-box; }
        .xce-scope .xce-bk-drawer-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        .xce-scope .xce-bk-facets { display: grid; gap: 8px; }
        .xce-scope .xce-bk-media-preview { width: 100%; border-radius: 12px; overflow: hidden; background: #1f1b18; display: flex; justify-content: center; }
        .xce-scope .xce-bk-media-preview video, .xce-scope .xce-bk-media-preview img { display: block; width: 100%; max-width: 100%; max-height: 52vh; object-fit: contain; }
        .xce-scope .xce-bk-source { margin: 0; font-size: 12px; line-height: 1.4; color: rgba(31,29,27,0.7); overflow-wrap: anywhere; min-width: 0; }
        .xce-scope .xce-bk-chips { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
        .xce-scope .xce-chip-ok { border-color: rgba(31,122,76,0.3); background: rgba(31,122,76,0.08); color: #1f6b44; }
        .xce-scope .xce-bk-sync-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
        .xce-scope .xce-bk-sync-row .xce-sub { margin: 0; overflow-wrap: anywhere; min-width: 0; }
        .xce-scope .xce-bk-sync-row .xce-error { flex: 1 0 100%; margin: 0; }
        .xce-scope .xce-bk-thumb { position: relative; }
        .xce-scope .xce-bk-thumb-flag { position: absolute; right: 6px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: #d97706; box-shadow: 0 0 0 2px rgba(255,255,255,0.9); }
        .xce-scope .xce-bk-action-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .xce-scope .xce-bk-action-row > button { min-height: 38px; border-radius: 10px; box-sizing: border-box; }
        .xce-scope .xce-bk-thumb-summary { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; padding: 8px; box-sizing: border-box; text-align: center; font-size: 11px; line-height: 1.3; font-weight: 600; }
        .xce-scope #x-content-nas-preview .xce-field-hint { color: rgba(255,255,255,0.8); padding: 12px; margin: 0; }
        .xce-scope .xce-nas-panel { display: grid; gap: 12px; min-width: 0; }
        .xce-scope .xce-nas-status { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 12px; font-weight: 600; color: #1f1d1b; }
        .xce-scope .xce-nas-status .xce-bk-dotmark { flex: 0 0 auto; margin-top: 3px; }
        .xce-scope .xce-nas-browser { display: grid; gap: 6px; min-width: 0; }
        .xce-scope .xce-nas-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; font-size: 11px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-nas-crumb { border: 0; background: transparent; padding: 4px 6px; border-radius: 6px; font: inherit; font-weight: 700; color: #1f1d1b; cursor: pointer; }
        .xce-scope .xce-nas-crumb:hover { background: rgba(31,29,27,0.06); }
        .xce-scope .xce-nas-list { list-style: none; margin: 0; padding: 4px; height: 240px; overflow-y: auto; overflow-x: hidden; border: 1px solid rgba(31,29,27,0.12); border-radius: 10px; background: #fff; box-sizing: border-box; }
        .xce-scope .xce-nas-row { display: flex; align-items: center; gap: 8px; min-height: 36px; min-width: 0; }
        .xce-scope .xce-nas-name { display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0; height: 36px; border: 0; background: transparent; padding: 0 6px; border-radius: 8px; font: inherit; font-size: 12px; font-weight: 600; color: #1f1d1b; text-align: left; cursor: pointer; }
        .xce-scope .xce-nas-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .xce-scope .xce-nas-name.is-file { cursor: default; font-weight: 500; color: rgba(31,29,27,0.75); }
        .xce-scope button.xce-nas-name:hover { background: rgba(31,29,27,0.06); }
        .xce-scope .xce-nas-empty { padding: 12px; font-size: 12px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-nas-empty.is-error { color: #9f1f17; }
        .xce-scope .xce-nas-controls { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; }
        .xce-scope .xce-nas-cap { flex: 1 1 120px; min-width: 0; }
        .xce-scope .xce-nas-estimate { margin: 0; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.7); overflow-wrap: anywhere; }
        .xce-scope .xce-nas-connect-row { display: grid; gap: 8px; min-width: 0; }
        .xce-scope .xce-nas-cmd { display: block; padding: 8px 10px; border-radius: 8px; background: rgba(31,29,27,0.06); font-family: var(--font-mono); font-size: 11px; user-select: all; overflow-wrap: anywhere; }
        .xce-scope .xce-nas-selall { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .xce-scope .xce-nas-meta { margin-left: auto; padding-left: 8px; flex: 0 0 auto; font-style: normal; font-size: 10px; font-weight: 500; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-nas-selected { margin: 0; font-size: 11px; color: rgba(31,29,27,0.7); }
        .xce-scope .xce-nas-clear { border: 0; background: transparent; padding: 0; font: inherit; font-weight: 700; color: #1f1d1b; text-decoration: underline; cursor: pointer; }
        .xce-scope .xce-nas-crumb:disabled { opacity: 0.35; cursor: default; }
        .xce-scope .xce-nas-start { width: 100%; }
        .xce-scope .xce-nas-jobs { display: grid; gap: 8px; }
        .xce-scope .xce-nas-job { display: grid; gap: 4px; padding: 8px; border: 1px solid rgba(31,29,27,0.12); border-radius: 10px; background: #fff; }
        .xce-scope .xce-nas-job-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .xce-scope .xce-nas-job-state { font-size: 11px; font-weight: 700; text-transform: capitalize; }
        .xce-scope .xce-nas-job-head .xce-bk-count { margin-left: auto; }
        .xce-scope .xce-nas-cancel { width: 38px; min-width: 38px; flex: 0 0 auto; }
        .xce-scope .xce-nas-bar { height: 6px; border-radius: 3px; background: rgba(31,29,27,0.1); overflow: hidden; }
        .xce-scope .xce-nas-bar > span { display: block; height: 100%; background: #1f1d1b; transition: width 0.3s; }
        .xce-scope .xce-bk-usage { font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); }
        @media (min-width: 481px) {
          .xce-scope .xce-bk-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
          .xce-scope .xce-bk-drawer { max-width: 440px; padding: 16px; box-shadow: -8px 0 24px rgba(0,0,0,0.12); }
        }
        @media (min-width: 640px) {
          .xce-scope .xce-bk-layout { grid-template-columns: 220px minmax(0,1fr); align-items: start; }
          .xce-scope .xce-bk-rail { position: sticky; top: 12px; }
          .xce-scope .xce-bk-list { flex-direction: column; align-items: stretch; overflow: visible; }
          .xce-scope .xce-bk-item { flex: 0 0 auto; }
          .xce-scope .xce-bk-chip { width: 100%; }
          .xce-scope .xce-bk-share { display: block; }
          .xce-scope .xce-bk-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
        }

        @media (max-width: 480px) {
          .xce-scope .xce-tab { padding: 0 6px; font-size: 10px; }
        }

        /* ── Layout pass: full width, fluid grids, collapsed details ──── */
        .xce-scope { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
        .xce-scope .xce-panel { width: 100%; box-sizing: border-box; min-width: 0; }
        /* Counts and week days fill whatever width the modal gives them, so
           there is no breakpoint to get wrong. */
        .xce-scope .xce-engine-counts { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
        .xce-scope .xce-week-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr)); align-items: start; }
        .xce-scope .xce-slot-list,
        .xce-scope .xce-inv-list { grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); align-items: start; }
        /* Phone width pass (≤480px): same structure, less side chrome. The
           modal already contributes overlay + content-cell gutters, so the card
           pulls 6px into them, the panel drops its side border/padding, and
           nested row cards tighten to 6px so text gets the full line. */
        @media (max-width: 480px) {
          .xce-scope { margin-left: -6px; margin-right: -6px; width: calc(100% + 12px); max-width: calc(100% + 12px); gap: 8px; }
          .xce-scope .xce-panel,
          .xce-scope .xce-inv-section { padding: 8px 0; border-left: 0; border-right: 0; border-radius: 0; background: transparent; backdrop-filter: none; box-shadow: none; }
          .xce-scope .xce-slot,
          .xce-scope .xce-week-day,
          .xce-scope .xce-perf-row,
          .xce-scope .xce-inv-row,
          .xce-scope .xce-bk-form,
          .xce-scope .xce-nas-job { padding: 8px 6px; }
          .xce-scope .xce-week-slot { padding: 6px; }
          .xce-scope .xce-engine-count { padding: 6px 8px; }
          .xce-scope .xce-slot-list,
          .xce-scope .xce-inv-list,
          .xce-scope .xce-week-grid,
          .xce-scope .xce-week-slots,
          .xce-scope .xce-engine-counts,
          .xce-scope .xce-bk-layout,
          .xce-scope .xce-bk-main { gap: 6px; }
          .xce-scope .xce-head { margin-bottom: 6px; gap: 6px; }
          .xce-scope .xce-bk-card { padding: 4px 4px 6px; }
          .xce-scope .xce-bk-grid { gap: 6px; }
          .xce-scope .xce-bk-drawer { padding-left: 6px; padding-right: 6px; }
        }
        /* Tabs: one scrollable row on a phone instead of wrapping to two. */
        @media (max-width: 480px) {
          .xce-scope .xce-tabs { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
          .xce-scope .xce-tab { flex: 0 0 auto; }
        }
        /* Item drawer: full card width; thumbnail left (sticky), every field right. */
        @media (min-width: 481px) {
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) { max-width: 100%; width: 100%; box-shadow: none; padding-left: 16px; padding-right: 16px; }
        }
        @media (min-width: 900px) {
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) { grid-template-columns: minmax(300px, 38%) minmax(0, 1fr); column-gap: 20px; }
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) > * { grid-column: 2; }
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) > .xce-bk-drawer-head { grid-column: 1 / -1; }
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) > .xce-bk-media-preview { grid-column: 1; grid-row: 2 / span 40; position: sticky; top: 0; align-self: start; }
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) .xce-bk-media-preview video,
          .xce-scope .xce-bk-drawer:has(.xce-bk-media-preview) .xce-bk-media-preview img { max-height: calc(100vh - 160px); }
        }
        /* NAS plain-language status */
        .xce-scope .xce-nas-plan { display: grid; gap: 4px; padding: 10px 12px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.12); background: #fff; }
        .xce-scope .xce-nas-plan-main { margin: 0; font-size: 13px; line-height: 1.5; color: #1f1d1b; font-weight: 600; }
        .xce-scope .xce-nas-plan-cap { margin: 0; font-size: 12.5px; line-height: 1.5; color: #8a5a15; font-weight: 600; }
        .xce-scope .xce-nas-now { margin: 0; padding: 8px 10px; border-radius: 10px; font-size: 12.5px; font-weight: 600; background: rgba(31,29,27,0.05); color: rgba(31,29,27,0.7); }
        .xce-scope .xce-nas-now.is-busy { background: rgba(31,107,68,0.1); color: #1f6b44; }
        .xce-scope .xce-nas-job { border-left-width: 4px; }
        .xce-scope .xce-nas-job-complete { border-left-color: #1f7a4c; }
        .xce-scope .xce-nas-job-cancelled, .xce-scope .xce-nas-job-estimate { border-left-color: rgba(31,29,27,0.3); }
        .xce-scope .xce-nas-job-failed, .xce-scope .xce-nas-job-estimate-failed { border-left-color: #9f1f17; }
        .xce-scope .xce-nas-job-running, .xce-scope .xce-nas-job-queued, .xce-scope .xce-nas-job-estimate-running { border-left-color: #b7791f; }
        /* Tap targets: 44px minimum on touch screens. */
        @media (pointer: coarse) {
          .xce-scope .xce-btn,
          .xce-scope .xce-btn-primary,
          .xce-scope .xce-btn-ghost,
          .xce-scope .xce-btn-danger,
          .xce-scope .xce-ghost,
          .xce-scope .xce-draft-button,
          .xce-scope .xce-refresh,
          .xce-scope .xce-tab,
          .xce-scope .xce-tier button,
          .xce-scope .xce-tier-option,
          .xce-scope .xce-toggle,
          .xce-scope .xce-check,
          .xce-scope .xce-bk-icon,
          .xce-scope .xce-bk-chip,
          .xce-scope .xce-bk-folder,
          .xce-scope .xce-pop-item { min-height: 44px; }
          .xce-scope .xce-bk-icon { min-width: 44px; }
          .xce-scope .xce-more-summary { min-height: 40px; }
        }
        /* Two-step destructive confirm */
        .xce-scope .xce-confirm { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.3); background: rgba(159,31,23,0.05); }
        .xce-scope .xce-confirm-prompt { font-size: 12px; font-weight: 700; color: #9f1f17; }
        /* Loading skeletons: hold the layout so nothing jumps on arrival. */
        .xce-scope .xce-skeleton { display: grid; gap: 8px; }
        .xce-scope .xce-skeleton-item { display: block; height: 64px; border-radius: 12px; background: linear-gradient(90deg, rgba(31,29,27,0.05) 25%, rgba(31,29,27,0.10) 50%, rgba(31,29,27,0.05) 75%); background-size: 200% 100%; animation: xce-shimmer 1.2s ease-in-out infinite; }
        .xce-scope .xce-skeleton-card { grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr)); }
        .xce-scope .xce-skeleton-card .xce-skeleton-item { height: auto; aspect-ratio: 1 / 1.2; }
        .xce-scope .xce-skeleton-tile .xce-skeleton-item { height: 52px; }
        @keyframes xce-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { .xce-scope .xce-skeleton-item { animation: none; } .xce-scope .xce-spin { animation: none; } }
        /* Error + Retry */
        .xce-scope .xce-retry { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(159,31,23,0.24); background: rgba(159,31,23,0.05); }
        .xce-scope .xce-retry-text { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; line-height: 1.4; color: #9f1f17; overflow-wrap: anywhere; }
        /* Toast: floats at the bottom so it never moves the layout. */
        .xce-scope .xce-toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 80; max-width: min(92vw, 420px); padding: 10px 14px; border-radius: 12px; font-size: 12.5px; font-weight: 700; line-height: 1.4; color: #fff; box-shadow: 0 10px 28px rgba(0,0,0,0.2); pointer-events: none; }
        .xce-scope .xce-toast-ok { background: #1f6b44; }
        .xce-scope .xce-toast-error { background: #9f1f17; }
        /* NAS setup checklist */
        .xce-scope .xce-checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
        .xce-scope .xce-checklist-item { display: flex; align-items: flex-start; gap: 8px; font-size: 12px; line-height: 1.4; color: rgba(31,29,27,0.75); }
        .xce-scope .xce-checklist-item.is-ok { color: #1f6b44; }
        .xce-scope .xce-checklist-item.is-todo { color: #8a5a15; }
        /* Collapsed detail disclosure shared by every tab. */
        .xce-scope .xce-more { border-radius: 10px; }
        .xce-scope .xce-more-summary { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 2px; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.5); cursor: pointer; list-style: none; }
        .xce-scope .xce-more-summary::-webkit-details-marker { display: none; }
        .xce-scope .xce-more-summary::before { content: '+'; display: inline-block; width: 10px; text-align: center; }
        .xce-scope .xce-more[open] > .xce-more-summary::before { content: '−'; }
        .xce-scope .xce-more-summary:hover { color: #1f1d1b; }
        .xce-scope .xce-more-body { display: grid; gap: 6px; padding: 4px 0 2px; min-width: 0; }
        .xce-scope .xce-week-hint { margin: 0; font-size: 11px; color: rgba(31,29,27,0.5); }
        /* ---- NAS copy/move panel (NasCopyMovePanel.jsx) ---- */
        .xce-scope .xce-nasops-panel { display: grid; gap: 8px; min-width: 0; padding: 8px 0; }
        /* Layout fixes: the Copy/Move bar must stay visible while you browse and tick items. */
        .xce-scope .xce-nasops-panel { position: sticky; bottom: 0; z-index: 6; background: #fbfaf8; border-top: 1px solid rgba(31,29,27,0.12); padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -8px 16px -12px rgba(0,0,0,0.18); }
        .xce-scope .xce-bk-drawer-head .xce-bk-icon { width: 38px; min-width: 38px; flex: 0 0 auto; }
        .xce-scope .xce-nas-list { height: auto; min-height: 220px; max-height: min(52vh, 520px); }
        @media (min-width: 481px) {
          /* NAS source drawer: full width of the card, covering the bucket rail. */
          .xce-scope .xce-bk-drawer:has(.xce-nas-panel) { max-width: 100%; width: 100%; box-shadow: none; padding-left: 16px; padding-right: 16px; }
        }
        .xce-scope .xce-nasops-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-nasops-count { font-size: 12px; font-weight: 600; color: #1f1d1b; margin-right: auto; }
        .xce-scope .xce-nasops-picker,
        .xce-scope .xce-nasops-preview,
        .xce-scope .xce-nasops-job { display: grid; gap: 8px; min-width: 0; padding: 10px; border: 1px solid rgba(31,29,27,0.12); border-radius: 8px; }
        .xce-scope .xce-nasops-line { margin: 0; font-size: 12px; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-nasops-buttons { display: flex; flex-direction: column; gap: 8px; }
        .xce-scope .xce-nasops-dest-list { max-height: 200px; overflow-y: auto; }
        @media (min-width: 481px) {
          .xce-scope .xce-nasops-buttons { flex-direction: row; flex-wrap: wrap; align-items: center; }
        }

        /* ---- Daily suggestions (DailySuggestionsPanel.jsx) ---- */
        .xce-scope .xce-tabs { flex-wrap: wrap; }
        .xce-scope .xce-dl-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-dl-model { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; color: rgba(31,29,27,0.6); }
        .xce-scope .xce-sub code, .xce-scope .xce-dl-gaps code { font-size: 10.5px; overflow-wrap: anywhere; }
        .xce-scope .xce-dl-inputs { display: grid; gap: 4px; margin: 10px 0; }
        .xce-scope .xce-dl-input { display: grid; grid-template-columns: 1fr; gap: 2px; padding: 6px 8px; border-radius: 8px; border: 1px solid rgba(31,29,27,0.08); font-family: var(--font-mono); font-size: 11px; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-dl-input > span:first-child { font-weight: 700; }
        .xce-scope .xce-dl-input-missing, .xce-scope .xce-dl-input-excluded, .xce-scope .xce-dl-input-draft { background: rgba(196,128,20,0.08); border-color: rgba(196,128,20,0.3); }
        .xce-scope .xce-dl-list { display: grid; gap: 12px; }
        .xce-scope .xce-dl-card { display: grid; gap: 10px; min-width: 0; padding: 12px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: rgba(255,255,255,0.8); }
        .xce-scope .xce-dl-blocked { border-color: rgba(159,31,23,0.35); }
        .xce-scope .xce-dl-card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-dl-type { padding: 2px 8px; border-radius: 999px; background: #1f1d1b; color: #fff; font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
        .xce-scope .xce-dl-tier { padding: 2px 8px; border-radius: 999px; background: rgba(196,128,20,0.12); color: #7a4e08; font-size: 10.5px; font-weight: 700; }
        .xce-scope .xce-dl-slot { margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.5); }
        .xce-scope .xce-dl-convo { display: grid; gap: 6px; }
        .xce-scope .xce-dl-post { display: grid; gap: 2px; padding: 8px; border-radius: 8px; background: rgba(31,29,27,0.04); color: #1f1d1b; text-decoration: none; min-width: 0; }
        .xce-scope .xce-dl-post-meta { display: inline-flex; align-items: center; gap: 4px; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-dl-post-text { font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }
        .xce-scope .xce-dl-why { display: grid; grid-template-columns: 1fr; gap: 2px 10px; margin: 0; font-size: 12px; line-height: 1.4; }
        .xce-scope .xce-dl-why dt { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.5); margin-top: 4px; }
        .xce-scope .xce-dl-why dd { margin: 0; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-dl-content { font-size: 12px; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-dl-content ul { margin: 4px 0 0; padding-left: 16px; }
        .xce-scope .xce-dl-content em { color: rgba(31,29,27,0.5); font-style: normal; }
        .xce-scope .xce-dl-draft-label { font-family: var(--font-mono); font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(31,29,27,0.55); }
        .xce-scope .xce-dl-draft-label span { font-weight: 400; text-transform: none; letter-spacing: 0; }
        .xce-scope .xce-dl-textarea { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(31,29,27,0.18); font-size: 14px; line-height: 1.4; resize: vertical; }
        .xce-scope .xce-dl-checks { display: flex; flex-wrap: wrap; gap: 4px 12px; font-family: var(--font-mono); font-size: 10.5px; color: rgba(31,29,27,0.6); }
        .xce-scope .xce-dl-ok { color: #1f6b3a; font-weight: 700; }
        .xce-scope .xce-dl-bad { color: #9f1f17; font-weight: 700; }
        .xce-scope .xce-dl-muted { color: rgba(31,29,27,0.5); font-size: 12px; }
        .xce-scope .xce-dl-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .xce-scope .xce-dl-actions .xce-btn-primary, .xce-scope .xce-dl-actions .xce-btn-ghost { flex: 1 1 auto; }
        .xce-scope .xce-dl-gaps { margin-top: 12px; display: grid; gap: 6px; }
        .xce-scope .xce-dl-gaps ul { margin: 0; padding-left: 16px; font-size: 12px; line-height: 1.45; color: #1f1d1b; overflow-wrap: anywhere; }
        @media (min-width: 481px) {
          .xce-scope .xce-dl-input { grid-template-columns: 170px 150px 1fr; }
          .xce-scope .xce-dl-why { grid-template-columns: 110px 1fr; }
          .xce-scope .xce-dl-why dt { margin-top: 0; }
          .xce-scope .xce-dl-actions .xce-btn-primary, .xce-scope .xce-dl-actions .xce-btn-ghost { flex: 0 0 auto; }
        }

        /* ---- Input status strip (InputStatusStrip.jsx) + saved-post flow (DailySuggestionsPanel.jsx) ---- */
        .xce-scope .xce-is { border: 1px solid rgba(31,29,27,0.12); border-radius: 12px; background: #fff; padding: 8px 12px; min-width: 0; }
        .xce-scope .xce-is-summary { display: flex; align-items: center; gap: 8px; cursor: pointer; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; min-height: 32px; }
        .xce-scope .xce-is-title { font-weight: 700; text-transform: uppercase; }
        .xce-scope .xce-is-refresh { margin-left: auto; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
        .xce-scope .xce-is-list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-is-item { display: grid; gap: 4px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(31,29,27,0.1); min-width: 0; }
        .xce-scope .xce-is-item-warn { background: rgba(196,128,20,0.07); border-color: rgba(196,128,20,0.3); }
        .xce-scope .xce-is-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; font-size: 12px; }
        .xce-scope .xce-is-caveat, .xce-scope .xce-is-fix { margin: 0; font-size: 12px; line-height: 1.4; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-is-ok { color: #1f6b3a; font-weight: 700; }
        .xce-scope .xce-is-warn { color: #7a4e08; font-weight: 700; }
        .xce-scope .xce-is-bad { color: #9f1f17; font-weight: 700; }
        .xce-scope .xce-is-muted { color: rgba(31,29,27,0.5); font-size: 11px; overflow-wrap: anywhere; }
        .xce-scope .xce-dl-saved-flow { display: grid; gap: 8px; width: 100%; min-width: 0; }
        .xce-scope .xce-dl-status { font-family: var(--font-mono); font-size: 11.5px; color: #1f1d1b; overflow-wrap: anywhere; }
        .xce-scope .xce-today-segment { display: block; }

        /* ---- Results posts section (PerformancePanel.jsx / ResultsPostList.jsx) ---- */
        .xce-scope .xce-results-posts { display: grid; gap: 14px; min-width: 0; }
        .xce-scope .xce-results-section-title { margin: 0; font-size: 16px; font-weight: 700; }
        .xce-scope .xce-results-counts { font-family: var(--font-mono); font-size: 12px; opacity: 0.6; }
        .xce-scope .xce-results-group { display: grid; gap: 8px; min-width: 0; }
        .xce-scope .xce-results-group-title { margin: 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .xce-scope .xce-results-group-count { font-family: var(--font-mono); opacity: 0.5; font-weight: 400; }
        .xce-scope .xce-results-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-results-row { display: grid; gap: 6px; padding: 10px 12px; min-width: 0; border: 1px solid rgba(31,29,27,0.12); border-radius: 10px; background: rgba(31,29,27,0.02); }
        .xce-scope .xce-results-row-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-results-time, .xce-scope .xce-results-engine { font-family: var(--font-mono); font-size: 11.5px; opacity: 0.6; }
        .xce-scope .xce-results-excerpt { margin: 0; font-size: 13.5px; line-height: 1.45; overflow-wrap: anywhere; }
        .xce-scope .xce-results-origin, .xce-scope .xce-results-note { margin: 0; font-family: var(--font-mono); font-size: 11.5px; opacity: 0.6; overflow-wrap: anywhere; }
        .xce-scope .xce-results-metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; }
        .xce-scope .xce-results-metrics dt { font-size: 10.5px; opacity: 0.5; text-transform: uppercase; }
        .xce-scope .xce-results-metrics dd { margin: 0; font-size: 13px; font-weight: 600; }
        .xce-scope .xce-results-failure { margin: 0; font-size: 12.5px; color: #9f1f17; overflow-wrap: anywhere; }
        .xce-scope .xce-results-caveats { margin: 0; padding-left: 18px; font-size: 12px; line-height: 1.5; opacity: 0.7; overflow-wrap: anywhere; }

        /* ── Shell (U2): header, tab row + More, phone bottom nav ─────── */
        .xce-scope .xce-header { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .xce-scope .xce-mobile-only,
        .xce-scope .xce-bottom-shell { display: none; }
        .xce-scope .xce-more-shell { position: relative; flex: 0 0 auto; display: inline-flex; }
        .xce-scope .xce-more-trigger { flex: 0 0 auto; }
        .xce-scope .xce-more-menu { display: none; position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 160px; padding: 6px; gap: 2px; flex-direction: column; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fff; box-shadow: 0 8px 24px rgba(31,29,27,0.12); }
        .xce-scope .xce-more-menu.is-open { display: flex; }
        .xce-scope .xce-more-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(31,29,27,0.7); cursor: pointer; text-align: left; }
        .xce-scope .xce-more-item:hover { background: rgba(31,29,27,0.05); }
        .xce-scope .xce-more-item-active { background: #1f1d1b; color: #fff; }
        .xce-scope .xce-more-item-active:hover { background: #1f1d1b; }
        @media (max-width: 480px) {
          .xce-scope .xce-tabs { display: none; }
          .xce-scope .xce-header { padding-bottom: 8px; }
          .xce-scope .xce-header::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; border-radius: 2px; background: linear-gradient(90deg, #22c7e8 0%, #8a5cf0 55%, #e23fb8 100%); }
          .xce-scope .xce-client { font-size: 12px; font-weight: 700; color: #1f1d1b; }
          .xce-scope .xce-mobile-only { display: block; }
          .xce-scope .xce-bottom-shell { display: block; position: sticky; bottom: 0; z-index: 10; margin: 0 calc(-1 * var(--mobile-gutter, 8px)); background: #fff; border-top: 1px solid rgba(31,29,27,0.1); }
          /* Sticky needs the modal's scrollport to be the nearest scroll container: neutralise the two intermediate overflow clips (clip still clips, but is not a scroll container). */
          #x-content-modal-panel:has(.xce-scope) { overflow: clip; }
          .tile-detail-tab-content:has(.xce-scope) { overflow: visible; }
          .xce-scope .xce-more-sheet { display: none; position: absolute; left: 8px; right: 8px; bottom: calc(100% + 8px); flex-direction: column; gap: 2px; padding: 6px; border-radius: 12px; border: 1px solid rgba(31,29,27,0.12); background: #fff; box-shadow: 0 8px 24px rgba(31,29,27,0.14); }
          .xce-scope .xce-more-sheet.is-open { display: flex; }
        }
        @media (min-width: 481px) {
          .xce-scope .xce-more-sheet { display: none !important; }
        }
        /* ---- Timeline tab (TimelinePanel.jsx) + ItemDrawer posted copy ---- */
        .xce-scope .xce-timeline-search { display: grid; grid-template-columns: 1fr; gap: 8px; min-width: 0; }
        .xce-scope .xce-timeline-section { display: grid; gap: 8px; min-width: 0; margin-top: 10px; }
        .xce-scope .xce-timeline-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-timeline-window { font-family: var(--font-mono); font-size: 10.5px; color: rgba(42,36,32,0.5); }
        .xce-scope .xce-timeline-days,
        .xce-scope .xce-timeline-entries,
        .xce-scope .xce-timeline-archives { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; min-width: 0; }
        .xce-scope .xce-timeline-day-button { display: grid; gap: 4px; width: 100%; min-width: 0; padding: 10px; text-align: left; border: 1px solid rgba(42,36,32,0.12); border-radius: 10px; background: rgba(255,255,255,0.6); color: #2a2420; cursor: pointer; }
        .xce-scope .xce-timeline-day-button:hover { border-color: rgba(42,36,32,0.35); }
        .xce-scope .xce-timeline-day-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-timeline-day-date { font-family: var(--font-mono); font-size: 12px; font-weight: 700; }
        .xce-scope .xce-timeline-day-total { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #2a2420; color: #fff; }
        .xce-scope .xce-timeline-day-platforms { display: inline-flex; gap: 8px; margin-left: auto; }
        .xce-scope .xce-timeline-day-kinds { font-size: 11px; color: rgba(42,36,32,0.55); }
        .xce-scope .xce-timeline-snippet { font-size: 12px; line-height: 1.35; color: rgba(42,36,32,0.8); overflow-wrap: anywhere; }
        .xce-scope .xce-timeline-pdot { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; }
        .xce-scope .xce-timeline-pdot-mark { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .xce-scope .xce-timeline-day-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .xce-scope .xce-timeline-entry { display: grid; gap: 4px; min-width: 0; padding: 8px 10px; border: 1px solid rgba(42,36,32,0.12); border-radius: 10px; background: #fff; }
        .xce-scope .xce-timeline-entry-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 11px; color: rgba(42,36,32,0.6); }
        .xce-scope .xce-timeline-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 18px; padding: 0 5px; border-radius: 5px; font-size: 10px; font-weight: 700; color: #fff; }
        .xce-scope .xce-timeline-kind { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
        .xce-scope .xce-timeline-text { margin: 0; font-size: 12.5px; line-height: 1.4; color: #2a2420; overflow-wrap: anywhere; }
        .xce-scope .xce-timeline-thumbs { display: flex; gap: 6px; }
        .xce-scope .xce-timeline-thumb { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; background: rgba(42,36,32,0.06); }
        .xce-scope .xce-timeline-archive { display: grid; gap: 2px; font-size: 12px; }
        .xce-scope .xce-timeline-archive-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
        .xce-scope .xce-timeline-archive-line { color: rgba(42,36,32,0.6); }
        .xce-scope .xce-timeline-posted-copy { display: grid; gap: 6px; min-width: 0; padding: 10px; border: 1px solid rgba(42,36,32,0.12); border-radius: 10px; background: rgba(255,255,255,0.6); }
        .xce-scope .xce-timeline-posted-text { margin: 0; font-size: 13px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
        @media (min-width: 481px) {
          .xce-scope .xce-timeline-search { grid-template-columns: 150px 1fr 150px auto; align-items: center; }
        }
        /* ---- Discogs panel (x-content/DiscogsPanel.jsx) ---- */
        .xce-scope .xce-discogs-panel { gap: 14px; }
        .xce-scope .xce-discogs-folder { display: grid; gap: 8px; min-width: 0; }
        .xce-scope .xce-discogs-folder-line { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; font-weight: 600; color: #2a2420; overflow-wrap: anywhere; }
        .xce-scope .xce-discogs-folder-line svg { flex: 0 0 auto; }
        .xce-scope .xce-discogs-folder .xce-btn-ghost { justify-self: start; }
        .xce-scope .xce-discogs-job-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        .xce-scope .xce-discogs-results { display: grid; gap: 8px; min-width: 0; }
        .xce-scope .xce-discogs-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .xce-scope .xce-discogs-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 10px; border-radius: 999px; border: 1px solid rgba(42,36,32,0.14); background: rgba(255,255,255,0.7); font: inherit; font-size: 12px; font-weight: 600; color: rgba(42,36,32,0.75); cursor: pointer; }
        .xce-scope .xce-discogs-chip.is-on { background: #2a2420; border-color: #2a2420; color: #fff; }
        .xce-scope .xce-discogs-chip-count { font-family: var(--font-mono); font-size: 10.5px; opacity: 0.75; }
        .xce-scope .xce-discogs-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .xce-scope .xce-discogs-row { display: grid; gap: 8px; min-width: 0; padding: 10px; border: 1px solid rgba(42,36,32,0.12); border-left-width: 4px; border-radius: 10px; background: rgba(255,255,255,0.6); }
        .xce-scope .xce-discogs-row.is-ready { border-left-color: #1f7a4c; }
        .xce-scope .xce-discogs-row.is-review { border-left-color: #b7791f; }
        .xce-scope .xce-discogs-row.is-added, .xce-scope .xce-discogs-row.is-adding { border-left-color: #1f6b44; }
        .xce-scope .xce-discogs-row.is-unreadable { border-left-color: #9f1f17; }
        .xce-scope .xce-discogs-row.is-owned, .xce-scope .xce-discogs-row.is-skipped { border-left-color: rgba(42,36,32,0.3); }
        .xce-scope .xce-discogs-row-main { display: flex; align-items: flex-start; gap: 10px; min-width: 0; flex-wrap: wrap; }
        .xce-scope .xce-discogs-row-main > input[type="checkbox"] { flex: 0 0 auto; margin-top: 3px; width: 18px; height: 18px; }
        .xce-scope .xce-discogs-row-text { flex: 1 1 180px; min-width: 0; display: grid; gap: 2px; }
        .xce-scope .xce-discogs-row-title { margin: 0; font-size: 13px; font-weight: 700; color: #2a2420; overflow-wrap: anywhere; }
        .xce-scope .xce-discogs-row-text a, .xce-scope .xce-discogs-cand-text a { color: #2a2420; font-weight: 600; text-decoration: underline; overflow-wrap: anywhere; }
        .xce-scope .xce-discogs-row-actions { display: flex; flex-wrap: wrap; gap: 6px; }
        .xce-scope .xce-discogs-cands { display: grid; gap: 8px; min-width: 0; padding-top: 8px; border-top: 1px dashed rgba(42,36,32,0.14); }
        .xce-scope .xce-discogs-cand { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; min-width: 0; }
        .xce-scope .xce-discogs-cand-text { display: grid; gap: 2px; flex: 1 1 180px; min-width: 0; font-size: 12px; }
        .xce-scope .xce-discogs-manual { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .xce-scope .xce-discogs-manual .xce-input { flex: 1 1 160px; width: auto; }
        .xce-scope .xce-discogs-apply { position: sticky; bottom: 0; z-index: 6; display: grid; gap: 8px; padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px)); background: #fbfaf8; border-top: 1px solid rgba(42,36,32,0.12); box-shadow: 0 -8px 16px -12px rgba(0,0,0,0.18); }
        .xce-scope .xce-discogs-apply .xce-toggle { justify-self: start; }
        .xce-scope .xce-discogs-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
        .xce-scope .xce-discogs-confirm-text { flex: 1 0 100%; margin: 0; font-size: 12.5px; font-weight: 600; color: #2a2420; }
      `}</style>
  );
}
