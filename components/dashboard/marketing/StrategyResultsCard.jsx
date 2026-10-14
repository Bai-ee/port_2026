'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import { useMarketingContentCall, makeNavigate } from './useMarketingContentCall';
import SegmentedControl from '../content-ui/ui/SegmentedControl';
import XMonitorCard from '../XMonitorCard';

// PerformancePanel renders ResultsPostList (Posted / Waiting / Needs attention) itself.
const PerformancePanel = dynamic(() => import('../x-content/PerformancePanel'), { ssr: false });

export default function StrategyResultsCard({ getIdToken, activeClientId, onOpenCard, initialTab = 'results' }) {
  const { call } = useMarketingContentCall(getIdToken);
  const [view, setView] = useState(initialTab === 'x-monitor' ? 'x-monitor' : 'results');
  const onNavigate = makeNavigate(onOpenCard, 'strategy-results');
  return (
    <div id="strategy-results-root" className="xce-scope">
      <div id="strategy-results-view-segmented-shell" className="xce-today-segment">
        <SegmentedControl
          id="strategy-results-view-segmented"
          ariaLabel="Results view"
          value={view}
          onChange={setView}
          options={[{ value: 'results', label: 'Results' }, { value: 'x-monitor', label: 'X Monitor' }]}
        />
      </div>
      {view === 'results' ? (
        <div id="strategy-results-performance-section">
          <PerformancePanel clientId={activeClientId} call={call} onNavigate={onNavigate} hideRefresh />
        </div>
      ) : (
        <div id="strategy-results-x-monitor-view">
          <XMonitorCard getIdToken={getIdToken} clientId={activeClientId} hideRefresh />
        </div>
      )}
      <ContentUiStyles />
    </div>
  );
}
