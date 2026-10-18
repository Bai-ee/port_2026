'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import { useMarketingContentCall, makeNavigate } from './useMarketingContentCall';
import SegmentedControl from '../content-ui/ui/SegmentedControl';
import SocialPostingPanel from '../SocialPostingPanel';
import XCalendarCard from '../XCalendarCard';

const InputStatusStrip = dynamic(() => import('../x-content/InputStatusStrip'), { ssr: false });
const VIEWS = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'compose', label: 'Compose' },
  { value: 'quote-targets', label: 'Quote targets' },
];

export default function StrategyQueueCalendarCard({ getIdToken, activeClientId, clientName, onOpenCard, onOpenCalendar, socialPanelProps, initialView = 'calendar' }) {
  const { call } = useMarketingContentCall(getIdToken);
  const [view, setView] = useState(initialView);
  useEffect(() => { setView(initialView); }, [initialView]);
  const noop = makeNavigate(onOpenCard, 'strategy-queue-calendar');
  return (
    <div id="strategy-queue-calendar-root" className="xce-scope">
      <div id="strategy-queue-calendar-view-segmented-shell" className="xce-today-segment">
        <SegmentedControl
          id="strategy-queue-calendar-view-segmented"
          ariaLabel="Queue view"
          value={view}
          onChange={setView}
          options={VIEWS}
        />
      </div>
      {view === 'calendar' ? (
        <>
          <div id="strategy-queue-calendar-input-status-section">
            <InputStatusStrip clientId={activeClientId} call={call} onNavigate={noop} defaultOpen={false} hideRefresh />
          </div>
          <div id="strategy-queue-calendar-view-section">
            {/* The calendar is its own full-page stage (Month > Day > Post), not a panel inside this modal. */}
            <p id="strategy-queue-calendar-open-hint" className="xce-mc-summary">Month, day and post editing open as one full page.</p>
            <button type="button" id="strategy-queue-calendar-open-button" className="xce-btn-primary" style={{ justifySelf: 'start' }} disabled={typeof onOpenCalendar !== 'function'} onClick={() => onOpenCalendar && onOpenCalendar()}>
              Open calendar
            </button>
          </div>
        </>
      ) : null}
      {view === 'compose' ? (
        <div id="strategy-queue-calendar-compose-view">
          <SocialPostingPanel getIdToken={getIdToken} {...(socialPanelProps || {})} />
        </div>
      ) : null}
      {view === 'quote-targets' ? (
        <div id="strategy-queue-calendar-quote-targets-view">
          <XCalendarCard getIdToken={getIdToken} activeClientId={activeClientId} clientName={clientName} hideRefresh />
        </div>
      ) : null}
      <ContentUiStyles />
      {/* No white buttons in Queue & Calendar (incl. its day view): selected/secondary controls get the static gradient
          border (the active-bucket look), the primary action the full gradient fill. Scoped here so other cards that share
          these components keep their look. The mask only reads alpha, so a token stands in for #fff. */}
      <style>{`
        #strategy-queue-calendar-root [role="group"] > button[aria-pressed="true"],
        #strategy-queue-calendar-root .xce-mc-seg-active,
        #strategy-queue-calendar-root .xce-mc-filter-on,
        #strategy-queue-calendar-root .sp-mode-on,
        #strategy-queue-calendar-root .xce-dv-seg-btn[aria-pressed="true"] {
          position: relative; isolation: isolate;
          background: var(--t-surface) !important; color: var(--t-text-strong) !important; border-color: transparent !important; box-shadow: none !important;
        }
        #strategy-queue-calendar-root [role="group"] > button[aria-pressed="true"]::before,
        #strategy-queue-calendar-root .xce-mc-seg-active::before,
        #strategy-queue-calendar-root .xce-mc-filter-on::before,
        #strategy-queue-calendar-root .sp-mode-on::before,
        #strategy-queue-calendar-root .xce-dv-seg-btn[aria-pressed="true"]::before {
          content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; padding: 1px; pointer-events: none;
          background: linear-gradient(180deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%);
          -webkit-mask: linear-gradient(var(--t-text) 0 0) content-box, linear-gradient(var(--t-text) 0 0); -webkit-mask-composite: xor;
          mask: linear-gradient(var(--t-text) 0 0) content-box, linear-gradient(var(--t-text) 0 0); mask-composite: exclude;
        }
        #strategy-queue-calendar-root .sp-primary,
        #strategy-queue-calendar-root .xc-primary,
        #strategy-queue-calendar-root #x-content-month-review-button {
          background: linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%) !important;
          color: var(--t-on-solid) !important; border-color: transparent !important;
        }
      `}</style>
    </div>
  );
}
