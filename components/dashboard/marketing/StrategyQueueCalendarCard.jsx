'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import ContentUiStyles from '../content-ui/ContentUiStyles';
import { useMarketingContentCall, makeNavigate } from './useMarketingContentCall';
import SegmentedControl from '../content-ui/ui/SegmentedControl';
import SocialPostingPanel from '../SocialPostingPanel';
import XCalendarCard from '../XCalendarCard';

const MonthCalendarPanel = dynamic(() => import('../x-content/MonthCalendarPanel'), { ssr: false });
const InputStatusStrip = dynamic(() => import('../x-content/InputStatusStrip'), { ssr: false });
const PlanPanel = dynamic(() => import('../x-content/PlanPanel'), { ssr: false });
const DailySuggestionsPanel = dynamic(() => import('../x-content/DailySuggestionsPanel'), { ssr: false });

// Today's extras inside the calendar's day view (same panels + toggle as the Today card).
function TodayExtras({ clientId, call, callSocial, onNavigate }) {
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

const VIEWS = [
  { value: 'calendar', label: 'Calendar' },
  { value: 'compose', label: 'Compose' },
  { value: 'quote-targets', label: 'Quote targets' },
];

export default function StrategyQueueCalendarCard({ getIdToken, activeClientId, clientName, onOpenCard, socialPanelProps, initialView = 'calendar', openTodayOnLoad = false, onTodayOpened }) {
  const { call, callSocial } = useMarketingContentCall(getIdToken);
  // X preview identity: client name + the client's connected X @handle (free Firestore read; no avatar without the paid X API).
  const [xHandle, setXHandle] = useState(null);
  useEffect(() => {
    if (!getIdToken || !activeClientId) return undefined;
    let live = true;
    (async () => {
      try {
        const token = await getIdToken();
        const res = await fetch('/api/social-posting/x-oauth', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ action: 'accounts-list', clientId: activeClientId }),
        });
        const data = await res.json().catch(() => ({}));
        const accounts = data?.accounts;
        const x = Array.isArray(accounts) ? accounts.find((a) => a?.platform === 'x' || a?.platform === 'twitter') : (accounts?.x || accounts?.twitter || null);
        if (live) setXHandle(x?.username || null);
      } catch { /* preview falls back to a placeholder handle */ }
    })();
    return () => { live = false; };
  }, [getIdToken, activeClientId]);
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
            <MonthCalendarPanel
              clientId={activeClientId}
              call={call}
              onNavigate={noop}
              hideRefresh
              openTodayOnLoad={openTodayOnLoad}
              identity={{ name: clientName || null, handle: xHandle }}
              onTodayOpened={onTodayOpened}
              renderTodayExtras={() => <TodayExtras clientId={activeClientId} call={call} callSocial={callSocial} onNavigate={noop} />}
            />
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
