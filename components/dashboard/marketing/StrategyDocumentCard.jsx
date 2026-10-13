'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import { useMarketingContentCall, makeNavigate } from './useMarketingContentCall';

const StrategyPanel = dynamic(() => import('../x-content/StrategyPanel'), { ssr: false });

export default function StrategyDocumentCard({ getIdToken, activeClientId, clientName, onOpenCard }) {
  const { call } = useMarketingContentCall(getIdToken);
  const onNavigate = makeNavigate(onOpenCard, 'strategy-document');
  return (
    <div id="strategy-document-root" className="xce-scope">
      <div id="strategy-document-panel-section">
        <StrategyPanel clientId={activeClientId} clientName={clientName} call={call} onNavigate={onNavigate} hideRefresh />
      </div>
      <ContentUiStyles />
    </div>
  );
}
