'use client';

// Demo harness for the Calendar Stage, placeholder levels only. Not mounted anywhere.
// Host usage (gate it yourself): render <CalendarStageDemo /> when isCalendarStageDemoRequested().
// Mount it as a sibling of the real dashboard root; the demo fades its own fake "dashboard" block.

import React, { useEffect, useRef, useState } from 'react';
import CalendarStage, { useDashboardFade } from './CalendarStage';
import { parseStageParams, todayInZone } from './calendar-stage-model';

export function isCalendarStageDemoRequested(search) {
  const s = typeof search === 'string' ? search : typeof window !== 'undefined' ? window.location.search : '';
  return new URLSearchParams(s).get('calendar-stage-demo') === '1';
}

const card = {
  padding: 16,
  borderRadius: 12,
  border: '1px solid var(--t-glass-border)',
  background: 'var(--t-glass)',
  color: 'var(--t-dash-text-primary)',
};
const btn = {
  font: 'inherit',
  cursor: 'pointer',
  padding: '8px 14px',
  borderRadius: 999,
  border: '1px solid var(--t-glass-border)',
  background: 'var(--t-glass)',
  color: 'var(--t-dash-text-primary)',
};

function monthDays(today) {
  const [y, m] = today.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
}

function PlaceholderPost({ nav }) {
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const dirtyRef = useRef(false);
  const resolveRef = useRef(null);
  dirtyRef.current = dirty;

  useEffect(
    () =>
      nav.setLeaveGuard(() => {
        if (!dirtyRef.current) return true;
        setAsking(true);
        return new Promise((resolve) => {
          resolveRef.current = resolve;
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const answer = (leave) => {
    setAsking(false);
    if (resolveRef.current) resolveRef.current(leave);
    resolveRef.current = null;
  };

  return (
    <div id="calendar-stage-demo-post-panel" style={card}>
      <p style={{ marginTop: 0 }}>Placeholder post editor ({nav.state.postId}).</p>
      <label>
        <input id="calendar-stage-demo-dirty-toggle" type="checkbox" checked={dirty} onChange={(e) => setDirty(e.target.checked)} />{' '}
        Pretend I have unsaved edits
      </label>
      {asking ? (
        <div id="calendar-stage-demo-leave-prompt" role="alert" style={{ marginTop: 12 }}>
          Unsaved edits. Leave anyway?{' '}
          <button type="button" style={btn} onClick={() => answer(true)}>Leave</button>{' '}
          <button type="button" style={btn} onClick={() => answer(false)}>Keep editing</button>
        </div>
      ) : null}
    </div>
  );
}

export default function CalendarStageDemo() {
  const [open, setOpen] = useState(false);
  const dashRef = useRef(null);
  useDashboardFade(dashRef, open);

  useEffect(() => {
    if (parseStageParams(window.location.search)) setOpen(true);
  }, []);

  return (
    <>
      <div id="calendar-stage-demo-dashboard" ref={dashRef} style={{ padding: 24 }}>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>Fake Stand Up</h2>
          <button id="calendar-stage-demo-open-today" type="button" style={btn} onClick={() => setOpen('day')}>
            Open Today
          </button>{' '}
          <button id="calendar-stage-demo-open-month" type="button" style={btn} onClick={() => setOpen('month')}>
            Open calendar
          </button>
        </div>
      </div>
      <CalendarStage
        open={!!open}
        initialState={open === 'day' ? { level: 'day', date: todayInZone('America/Chicago') } : { level: 'month' }}
        clientName="Demo client"
        timeZone="America/Chicago"
        onClose={() => setOpen(false)}
        renderMonth={(nav) => (
          <div id="calendar-stage-demo-month-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 8 }}>
            {monthDays(nav.today).map((d) => (
              <button key={d} type="button" style={btn} onClick={() => nav.openDay(d)}>
                {Number(d.slice(8))}
              </button>
            ))}
          </div>
        )}
        renderDay={(nav) => (
          <div id="calendar-stage-demo-day-list" style={card}>
            <p style={{ marginTop: 0 }}>Placeholder day {nav.state.date}.</p>
            <button type="button" style={btn} onClick={() => nav.openPost('demo-post-1')}>
              Open post demo-post-1
            </button>
          </div>
        )}
        renderPost={(nav) => <PlaceholderPost nav={nav} />}
      />
    </>
  );
}
