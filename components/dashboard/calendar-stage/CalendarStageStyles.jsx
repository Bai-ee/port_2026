// Styles for the Calendar Stage. styled-jsx GLOBAL, every selector is scoped under
// #calendar-stage-root (the style tag must receive an inline template literal, not a const).
// Theme tokens only (--t-*): no hex/rgba literals. The stage is transparent on purpose
// and adds NO backdrop blur, so the three.js gradient background shows through.

export default function CalendarStageStyles() {
  return (
    <style jsx global>{`
      #calendar-stage-root {
        position: fixed;
        inset: 0;
        z-index: 900;
        display: flex;
        flex-direction: column;
        background: transparent;
        color: var(--t-dash-text-primary);
        opacity: 1;
        transition: opacity 180ms ease-out;
      }
      #calendar-stage-root[data-closing='true'] {
        opacity: 0;
        pointer-events: none;
      }

      #calendar-stage-root #calendar-stage-top-bar {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        gap: 12px;
        padding: 14px 20px;
        background: transparent;
      }
      #calendar-stage-root #calendar-stage-top-bar-start {
        display: flex;
        justify-content: flex-start;
        min-width: 0;
      }
      #calendar-stage-root #calendar-stage-top-bar-end {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      #calendar-stage-root #calendar-stage-title {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        line-height: 1.2;
        text-align: center;
        color: var(--t-dash-text-display);
        outline: none;
      }
      #calendar-stage-root #calendar-stage-title:focus-visible {
        outline: 2px solid var(--t-focus);
        outline-offset: 4px;
        border-radius: 4px;
      }
      #calendar-stage-root #calendar-stage-client-name {
        font-size: 13px;
        color: var(--t-dash-text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #calendar-stage-root #calendar-stage-back-button,
      #calendar-stage-root #calendar-stage-close-button {
        appearance: none;
        cursor: pointer;
        font: inherit;
        font-size: 14px;
        line-height: 1;
        padding: 9px 14px;
        border-radius: 999px;
        border: 1px solid var(--t-glass-border);
        background: var(--t-glass);
        color: var(--t-dash-text-primary);
        transition: background-color 120ms ease-out;
      }
      #calendar-stage-root #calendar-stage-back-button:hover,
      #calendar-stage-root #calendar-stage-close-button:hover {
        background: var(--t-glass-strong);
      }
      #calendar-stage-root #calendar-stage-back-button:focus-visible,
      #calendar-stage-root #calendar-stage-close-button:focus-visible {
        outline: 2px solid var(--t-focus);
        outline-offset: 2px;
      }

      /* One visible level at a time. out = fading away, pre = mounted but hidden, in = fading in. */
      #calendar-stage-root .calendar-stage-level {
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        padding: 8px 20px 24px;
        opacity: 1;
        transform: scale(1);
        transition: opacity 220ms ease-out, transform 220ms ease-out;
      }
      #calendar-stage-root .calendar-stage-level[data-phase='out'] {
        opacity: 0;
        transition: opacity 180ms ease-out;
        pointer-events: none;
      }
      #calendar-stage-root .calendar-stage-level[data-phase='pre'] {
        opacity: 0;
        transform: scale(0.98);
        transition: none;
        pointer-events: none;
      }

      @media (prefers-reduced-motion: reduce) {
        #calendar-stage-root,
        #calendar-stage-root .calendar-stage-level,
        #calendar-stage-root .calendar-stage-level[data-phase='out'],
        #calendar-stage-root .calendar-stage-level[data-phase='pre'] {
          transition: none;
          transform: none;
        }
      }

      @media (max-width: 480px) {
        #calendar-stage-root #calendar-stage-top-bar {
          padding: 10px var(--mobile-gutter, 8px);
          gap: 8px;
        }
        #calendar-stage-root .calendar-stage-level {
          padding: 4px var(--mobile-gutter, 8px) 16px;
        }
        #calendar-stage-root #calendar-stage-client-name {
          display: none;
        }
      }
    `}</style>
  );
}
