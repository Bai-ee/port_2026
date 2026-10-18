'use client';

// Host that fills the Calendar Stage's three levels from the existing calendar panel. ONE MonthCalendarPanel instance is
// returned by renderMonth / renderDay / renderPost (same element type, same position), so React keeps it mounted across
// levels: the loaded month, filters and optimistic marks survive Month > Day > Post and back.
//
// Mount as a SIBLING of the faded dashboard root (DashboardPage.jsx). No overlay, backdrop or blur is added here.

import React from 'react';
import dynamic from 'next/dynamic';
import CalendarStage from './CalendarStage';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import { useMarketingContentCall } from '../marketing/useMarketingContentCall';

const MonthCalendarPanel = dynamic(() => import('../x-content/MonthCalendarPanel'), { ssr: false });

export default function CalendarStageHost({
  open = true,
  initialState,
  getIdToken,
  clientId,
  clientName,
  clientHandle = '',
  avatarUrl = '',
  timeZone,
  onClose,
}) {
  const { call } = useMarketingContentCall(getIdToken);

  const renderLevel = (nav) => (
    // Month and Day styles are `.xce-scope`-scoped; the Post level (PostEditor) is self-styled, so it skips the scope. Only the
    // className changes, so the panel instance (and its loaded month) is kept across levels.
    <div id="calendar-stage-content-scope" className={nav.state.level === 'post' ? undefined : 'xce-scope'} style={{ marginTop: 0 }}>
      <ContentUiStyles />
      <MonthCalendarPanel
        clientId={clientId}
        call={call}
        hideRefresh
        stage={{ nav, getIdToken, clientId, clientName, clientHandle, avatarUrl, timeZone: nav.timeZone }}
      />
    </div>
  );

  return (
    <CalendarStage
      open={open}
      initialState={initialState}
      clientName={clientName}
      timeZone={timeZone}
      onClose={onClose}
      renderMonth={renderLevel}
      renderDay={renderLevel}
      renderPost={renderLevel}
    />
  );
}
