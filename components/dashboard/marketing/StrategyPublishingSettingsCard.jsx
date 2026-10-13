'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import ContentUiStyles from '../content-ui/ContentUiStyles';

import { makeNavigate } from './useMarketingContentCall';

const TelegramPanel = dynamic(() => import('../x-content/TelegramPanel'), { ssr: false });

export default function StrategyPublishingSettingsCard({ getIdToken, activeClientId, onOpenCard }) {
  return (
    <div id="strategy-publishing-settings-root" className="xce-scope">
      <div id="strategy-publishing-settings-telegram-section">
        <TelegramPanel getIdToken={getIdToken} activeClientId={activeClientId} onNavigate={makeNavigate(onOpenCard, 'strategy-publishing-settings')} />
      </div>
      <p id="strategy-publishing-settings-accounts-note" style={{ fontSize: 12, opacity: 0.7, margin: '12px 0 0' }}>
        X and Instagram account connections are managed in the Social Accounts card.
      </p>
      <ContentUiStyles />
    </div>
  );
}
