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
    </div>
  );
}
