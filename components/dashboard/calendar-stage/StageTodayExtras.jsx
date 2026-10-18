'use client';

// Today's extras inside the stage's Day view (Plan | Recommendations), moved here from StrategyQueueCalendarCard when the
// calendar became the Calendar Stage. Same panels + toggle as the Today card; ids kept.

import React, { useState } from 'react';
import dynamic from 'next/dynamic';

const PlanPanel = dynamic(() => import('../x-content/PlanPanel'), { ssr: false });
const DailySuggestionsPanel = dynamic(() => import('../x-content/DailySuggestionsPanel'), { ssr: false });

export default function StageTodayExtras({ clientId, call, callSocial, onNavigate }) {
  const [tab, setTab] = useState('plan');
  return (
    <div id="strategy-queue-calendar-day-today-extras">
      {/* Compact caps toggle, styled by the day view (MonthCalendarPanel DayView, .xce-dv-seg). */}
      <div id="strategy-queue-calendar-day-today-segmented" className="xce-dv-seg" role="group" aria-label="Today view">
        {[{ value: 'plan', label: 'Plan' }, { value: 'today', label: 'Recommendations' }].map((o) => (
          <button key={o.value} type="button" id={`strategy-queue-calendar-day-today-tab-${o.value}`} className="xce-dv-seg-btn" aria-pressed={tab === o.value} onClick={() => setTab(o.value)}>{o.label}</button>
        ))}
      </div>
      {tab === 'plan'
        ? <PlanPanel clientId={clientId} call={call} onNavigate={onNavigate} hideRefresh />
        : <DailySuggestionsPanel clientId={clientId} call={call} callSocial={callSocial} onNavigate={onNavigate} hideRefresh />}
    </div>
  );
}
