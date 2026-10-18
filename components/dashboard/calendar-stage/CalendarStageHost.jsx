'use client';

// Host that fills the Calendar Stage's three levels from the existing calendar panel. ONE MonthCalendarPanel instance is
// returned by renderMonth / renderDay / renderPost (same element type, same position), so React keeps it mounted across
// levels: the loaded month, filters and optimistic marks survive Month > Day > Post and back.
//
// Mount as a SIBLING of the faded dashboard root (DashboardPage.jsx). No overlay, backdrop or blur is added here.

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import CalendarStage from './CalendarStage';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import { useMarketingContentCall, makeNavigate } from '../marketing/useMarketingContentCall';
import StageTodayExtras from './StageTodayExtras';

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
  onOpenCard,
}) {
  const { call, callSocial } = useMarketingContentCall(getIdToken);
  // Post identity: the client's CONNECTED X account (name, @handle, profile image stored at connect — a free Firestore
  // read), falling back to the client name / configured brand handle / initial. Re-read when the window regains focus so
  // a connect or disconnect done elsewhere shows up without reopening the stage.
  const [xAccount, setXAccount] = useState(null);
  useEffect(() => {
    if (!getIdToken || !clientId) return undefined;
    let live = true;
    const load = async () => {
      try {
        const token = await getIdToken();
        const res = await fetch('/api/social-posting/x-oauth', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: 'accounts-list', clientId }),
        });
        const data = await res.json().catch(() => ({}));
        const accounts = data?.accounts;
        const x = Array.isArray(accounts) ? accounts.find((a) => a?.platform === 'x' || a?.platform === 'twitter') : (accounts?.x || accounts?.twitter || null);
        if (live) setXAccount(x?.connected ? x : null);
      } catch { /* keep the last known identity */ }
    };
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', onVisible); };
  }, [getIdToken, clientId]);
  const handle = xAccount?.username || clientHandle;
  const postName = xAccount?.name || clientName;
  const postAvatar = xAccount?.profileImageUrl || avatarUrl;

  const renderLevel = (nav) => (
    // Month and Day styles are `.xce-scope`-scoped; the Post level (PostEditor) is self-styled, so it skips the scope. Only the
    // className changes, so the panel instance (and its loaded month) is kept across levels.
    <div id="calendar-stage-content-scope" className={nav.state.level === 'post' ? undefined : 'xce-scope'}>
      <ContentUiStyles />
      <MonthCalendarPanel
        clientId={clientId}
        call={call}
        hideRefresh
        stage={{ nav, getIdToken, clientId, clientName: postName, clientHandle: handle, avatarUrl: postAvatar, timeZone: nav.timeZone }}
        // Plan | Recommendations on today's Day view. Jumping to another card leaves the stage first.
        renderTodayExtras={() => (
          <StageTodayExtras
            clientId={clientId}
            call={call}
            callSocial={callSocial}
            onNavigate={makeNavigate((cardId) => { nav.close(); if (typeof onOpenCard === 'function') onOpenCard(cardId); }, 'strategy-queue-calendar')}
          />
        )}
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
