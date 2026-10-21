'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import SegmentedControl from '../content-ui/ui/SegmentedControl';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import NowStrip from './NowStrip';
import BookmarkPicksPanel from './BookmarkPicksPanel';
import { useMarketingContentCall, makeNavigate } from './useMarketingContentCall';

const PlanPanel = dynamic(() => import('../x-content/PlanPanel'), { ssr: false });
const DailySuggestionsPanel = dynamic(() => import('../x-content/DailySuggestionsPanel'), { ssr: false });
const InputStatusStrip = dynamic(() => import('../x-content/InputStatusStrip'), { ssr: false });

export default function StrategyTodayCard({ getIdToken, activeClientId, onOpenCard }) {
  const { call, callSocial } = useMarketingContentCall(getIdToken);
  const [view, setView] = useState('plan');
  const noop = makeNavigate(onOpenCard, 'strategy-today');
  return (
    <div id="strategy-today-root" className="xce-scope">
      <NowStrip call={call} clientId={activeClientId} onNavigate={noop} onOpenCard={onOpenCard} />
      <BookmarkPicksPanel call={call} clientId={activeClientId} onNavigate={noop} />
      {typeof onOpenCard === 'function' ? (
        <div id="strategy-today-review-calendar-shell" className="xce-today-review-calendar">
          <button type="button" id="strategy-today-review-calendar-button" className="xce-btn-primary" onClick={() => noop('queue')}>
            Review everything on the calendar
          </button>
          <span id="strategy-today-review-calendar-hint" className="xce-mc-sheet-meta-line">Saved posts, today&apos;s suggestions and open requotes in one place. Approve from there.</span>
        </div>
      ) : null}
      <div id="strategy-today-view-segmented-shell" className="xce-today-segment">
        <SegmentedControl
          id="strategy-today-view-segmented"
          ariaLabel="Today view"
          value={view}
          onChange={setView}
          options={[{ value: 'plan', label: 'Plan' }, { value: 'today', label: 'Recommendations' }]}
        />
      </div>
      <div id="strategy-today-input-status-section">
        <InputStatusStrip clientId={activeClientId} call={call} onNavigate={noop} hideRefresh />
      </div>
      {view === 'plan' ? (
        <div id="strategy-today-plan-section">
          <PlanPanel clientId={activeClientId} call={call} onNavigate={noop} hideRefresh />
        </div>
      ) : (
        <div id="strategy-today-suggestions-section">
          <DailySuggestionsPanel clientId={activeClientId} call={call} callSocial={callSocial} onNavigate={noop} hideRefresh />
        </div>
      )}
      <style>{`.xce-scope .xce-today-review-calendar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }`}</style>
      <ContentUiStyles />
    </div>
  );
}
