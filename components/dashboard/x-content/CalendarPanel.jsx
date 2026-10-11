'use client';

import React, { useState } from 'react';
import { Skeleton, RetryError } from './Feedback.jsx';
import { Check, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import Card from './ui/Card.jsx';
import Badge from './ui/Badge.jsx';
import IconButton from './ui/IconButton.jsx';
import Accordion from './ui/Accordion.jsx';
import SectionLabel from './ui/SectionLabel.jsx';
import { XCE_COLORS, XCE_RADII, XCE_TYPE } from './xce-tokens';

// CalendarPanel — the week grid over social_posts.
//
// PURE PRESENTATION. `calendar` is the output of features/x-content-inventory/
// week-calendar.js; this file re-derives nothing. Approve and schedule hand the
// work back to the card, which calls the existing social-posting actions.
// There is deliberately NO post-now control here.
//
// STYLING: inline styles from the ui/* primitives + xce-tokens; the existing
// `xce-` classes (post text, input) come from the card's `<style jsx global>`.
// Local-only state: which view (week / unscheduled), which day is selected,
// and the datetime inputs.

const ENGINE_LABEL = { record: 'Record', ue: 'UE', client: 'Client', identity: 'Identity', untagged: 'Untagged' };
const ENGINE_ORDER = ['identity', 'record', 'ue', 'client'];
const ENGINE_CODE = { record: 'REC', ue: 'UE', client: 'CLI', identity: 'ID', untagged: '—' };
const READY_PREVIEW = 3;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date) {
  const d = new Date(`${date}T12:00:00Z`);
  return {
    dow: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    dowLong: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    month: MONTHS[d.getUTCMonth()],
    day: d.getUTCDate(),
  };
}

function rangeLabel(start, end) {
  if (!start || !end) return '—';
  const a = parts(start);
  const b = parts(end);
  return a.month === b.month ? `${a.month} ${a.day} – ${b.day}` : `${a.month} ${a.day} – ${b.month} ${b.day}`;
}

function limitText(e) {
  const bits = [];
  if (e.weeklyMin != null) bits.push(`min ${e.weeklyMin}/wk`);
  if (e.weeklyMax != null) bits.push(`max ${e.weeklyMax}/wk`);
  if (e.maxPerDay != null) bits.push(`max ${e.maxPerDay}/day`);
  return bits.join(' · ') || 'no limit set';
}

const statusTone = (s) => (s === 'approved' ? 'green' : s === 'draft' ? 'grey' : s === 'failed' ? 'red' : 'blue');

const pillBtn = (primary) => ({
  minHeight: 38,
  padding: '0 16px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  borderRadius: XCE_RADII.md,
  border: `1px solid ${primary ? XCE_COLORS.ink : XCE_COLORS.border}`,
  background: primary ? XCE_COLORS.ink : XCE_COLORS.surface,
  color: primary ? XCE_COLORS.onInk : XCE_COLORS.ink,
  fontSize: 12.5,
  fontWeight: 700,
  cursor: 'pointer',
});

function CodeTile({ engine }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        width: 40,
        height: 40,
        borderRadius: XCE_RADII.sm,
        border: `1px solid ${XCE_COLORS.border}`,
        background: XCE_COLORS.surfaceMuted,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: XCE_TYPE.mono,
        fontSize: 11,
        fontWeight: 700,
        color: XCE_COLORS.ink,
      }}
    >
      {ENGINE_CODE[engine || 'untagged']}
    </span>
  );
}

export default function CalendarPanel({
  calendar,
  loading,
  error,
  busyId,
  onRefresh,
  onShift,
  onApprove,
  onSchedule,
}) {
  const days = Array.isArray(calendar?.days) ? calendar.days : [];
  const flags = Array.isArray(calendar?.flags) ? calendar.flags : [];
  const unscheduled = Array.isArray(calendar?.unscheduled) ? calendar.unscheduled : [];
  const [times, setTimes] = useState({});
  const [view, setView] = useState('week');
  const [selDate, setSelDate] = useState(null);

  const selected = days.find((d) => d.date === selDate) || days[0] || null;
  const selParts = selected ? parts(selected.date) : null;
  const readyRows = view === 'unscheduled' ? unscheduled : unscheduled.slice(0, READY_PREVIEW);

  const tabStyle = (on) => ({
    minHeight: 40,
    padding: '0 4px',
    marginRight: 18,
    border: 0,
    borderBottom: `2px solid ${on ? XCE_COLORS.ink : 'transparent'}`,
    background: 'transparent',
    color: on ? XCE_COLORS.ink : XCE_COLORS.inkSoft,
    fontSize: 14,
    fontWeight: on ? 700 : 500,
    cursor: 'pointer',
  });

  function renderReadyRow(s) {
    const busy = busyId === s.id;
    const value = times[s.id] || '';
    return (
      <Card key={s.id} id={`x-content-week-unscheduled-${s.id}`} padding={12} style={{ display: 'grid', gap: 10 }}>
        <div id={`x-calendar-ready-row-${s.id}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
          <CodeTile engine={s.engine} />
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
            <p className="xce-post-text" style={{ fontWeight: 600 }}>{s.title || '(no text)'}</p>
            <span style={{ fontFamily: XCE_TYPE.mono, fontSize: 11, color: XCE_COLORS.inkMuted }}>{ENGINE_LABEL[s.engine || 'untagged']}</span>
          </div>
          <Badge tone={statusTone(s.status)}>{String(s.status || '').toUpperCase()}</Badge>
        </div>
        {s.status === 'draft' && onApprove ? (
          <div id={`x-calendar-ready-actions-${s.id}`} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" id={`x-content-week-unscheduled-approve-${s.id}`} style={pillBtn(false)} disabled={busy} onClick={() => onApprove(s)}>
              <Check size={14} /> Approve
            </button>
          </div>
        ) : null}
        {s.status === 'approved' && onSchedule ? (
          <div id={`x-calendar-ready-actions-${s.id}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <input
              type="datetime-local"
              aria-label="Schedule time (your local time)"
              title="Your local time"
              id={`x-content-week-schedule-time-${s.id}`}
              className="xce-input"
              style={{ flex: '1 1 160px', minWidth: 0 }}
              value={value}
              onChange={(e) => setTimes((t) => ({ ...t, [s.id]: e.target.value }))}
            />
            <button type="button" id={`x-content-week-schedule-button-${s.id}`} style={{ ...pillBtn(true), opacity: busy || !value ? 0.48 : 1 }} disabled={busy || !value} onClick={() => onSchedule(s, value)}>
              Schedule
            </button>
            <p id={`x-content-week-schedule-hint-${s.id}`} style={{ margin: 0, flexBasis: '100%', fontSize: 11, color: XCE_COLORS.inkMuted }}>Your local time</p>
          </div>
        ) : null}
      </Card>
    );
  }

  return (
    <div id="x-content-week-calendar-panel" className="xce-panel" style={{ display: 'grid', gap: 14 }}>
      <div id="x-content-week-calendar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h3 id="x-calendar-title" style={{ margin: 0, fontSize: 20, fontWeight: 700, color: XCE_COLORS.ink }}>Calendar</h3>
        <div id="x-content-week-calendar-nav-row" role="group" aria-label="Week" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconButton id="x-content-week-prev-button" label="Previous week" icon={<ChevronLeft size={16} />} size={38} disabled={loading} onClick={() => onShift && onShift(-7)} />
          <span id="x-calendar-range-label" style={{ minWidth: 92, textAlign: 'center', fontFamily: XCE_TYPE.mono, fontSize: 12.5, fontWeight: 600, color: XCE_COLORS.ink }}>
            {calendar ? rangeLabel(calendar.start, calendar.end) : '—'}
          </span>
          <IconButton id="x-content-week-next-button" label="Next week" icon={<ChevronRight size={16} />} size={38} disabled={loading} onClick={() => onShift && onShift(7)} />
          <span id="x-calendar-tz-label" style={{ fontFamily: XCE_TYPE.mono, fontSize: 11, color: XCE_COLORS.inkMuted }}>CT</span>
          {onRefresh ? (
            <IconButton id="x-content-week-refresh-button" label="Refresh calendar" icon={<RefreshCw size={15} />} size={38} disabled={!!loading} onClick={onRefresh} />
          ) : null}
        </div>
      </div>

      <div id="x-calendar-view-tabs" role="tablist" aria-label="Calendar view" style={{ display: 'flex', borderBottom: `1px solid ${XCE_COLORS.border}` }}>
        <button type="button" role="tab" aria-selected={view === 'week'} id="x-calendar-tab-week" style={tabStyle(view === 'week')} onClick={() => setView('week')}>
          Week
        </button>
        <button type="button" role="tab" aria-selected={view === 'unscheduled'} id="x-calendar-tab-unscheduled" style={tabStyle(view === 'unscheduled')} onClick={() => setView('unscheduled')}>
          Unscheduled · {unscheduled.length}
        </button>
      </div>

      {error ? (
        <RetryError id="x-content-week-error" message={typeof error === 'string' ? error : 'Could not load the calendar.'} onRetry={onRefresh} busy={!!loading} />
      ) : null}
      {loading ? <Skeleton id="x-content-week-loading" rows={4} variant="tile" /> : null}

      {!loading && calendar ? (
        <>
          {view === 'week' ? (
            <>
              <ol id="x-content-week-grid" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
                {days.map((day) => {
                  const on = selected && day.date === selected.date;
                  const p = parts(day.date);
                  return (
                    <li key={day.date} style={{ minWidth: 0 }}>
                      <button
                        type="button"
                        id={`x-content-week-day-${day.date}`}
                        aria-pressed={on}
                        aria-label={`${p.dowLong} ${p.month} ${p.day}, ${day.total} posts`}
                        onClick={() => setSelDate(day.date)}
                        style={{
                          width: '100%',
                          minHeight: 56,
                          display: 'grid',
                          justifyItems: 'center',
                          alignContent: 'center',
                          gap: 2,
                          padding: '4px 0',
                          borderRadius: XCE_RADII.sm,
                          border: `1px solid ${on ? XCE_COLORS.ink : XCE_COLORS.border}`,
                          background: on ? XCE_COLORS.ink : XCE_COLORS.surface,
                          color: on ? XCE_COLORS.onInk : XCE_COLORS.ink,
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 10.5 }}>{p.dow}</span>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>{p.day}</span>
                        <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: day.total ? (on ? XCE_COLORS.onInk : XCE_COLORS.green) : 'transparent' }} />
                      </button>
                    </li>
                  );
                })}
              </ol>

              {selected ? (
                <div id="x-calendar-selected-day" style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h4 id="x-calendar-selected-day-title" style={{ margin: 0, fontSize: 15, fontWeight: 700, color: XCE_COLORS.ink }}>
                      {selParts.dowLong}, {selParts.month} {selParts.day}
                    </h4>
                    {selected.flags?.length ? <Badge tone="amber">{selected.flags.length} flag{selected.flags.length > 1 ? 's' : ''}</Badge> : null}
                  </div>
                  {selected.slots.length ? (
                    <ul id={`x-calendar-day-slots-${selected.date}`} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                      {selected.slots.map((s) => {
                        const busy = busyId === s.id;
                        return (
                          <li key={s.id || `${selected.date}-${s.time}`} id={`x-content-week-slot-${s.id}`}>
                            <Card padding={12} style={{ display: 'grid', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: XCE_TYPE.mono, fontSize: 12, fontWeight: 700, color: XCE_COLORS.ink }}>{s.time}</span>
                                <Badge tone="blue">{ENGINE_LABEL[s.engine || 'untagged']}</Badge>
                                <Badge tone={statusTone(s.status)}>{String(s.status || '').toUpperCase()}</Badge>
                              </div>
                              <p className="xce-post-text">{s.title || '(no text)'}</p>
                              {s.packageId ? (
                                <details id={`x-content-week-slot-details-${s.id}`} className="xce-more">
                                  <summary className="xce-more-summary">Details</summary>
                                  <div className="xce-more-body"><p className="xce-asset">{s.packageId}</p></div>
                                </details>
                              ) : null}
                              {s.status === 'draft' && onApprove ? (
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                  <button type="button" id={`x-content-week-approve-button-${s.id}`} style={pillBtn(false)} disabled={busy} onClick={() => onApprove(s)}>
                                    <Check size={14} /> Approve
                                  </button>
                                </div>
                              ) : null}
                            </Card>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div id="x-calendar-day-empty" style={{ display: 'grid', justifyItems: 'center', gap: 10, padding: '6px 0 2px' }}>
                      <p className="xce-empty-note" style={{ margin: 0, fontSize: 13 }}>Nothing scheduled.</p>
                      {unscheduled.length ? (
                        <button type="button" id="x-calendar-view-unscheduled-button" style={pillBtn(false)} onClick={() => setView('unscheduled')}>
                          View unscheduled
                        </button>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}

              <Card id="x-calendar-weekly-targets-card" tone={flags.length ? 'amber' : undefined} padding="2px 14px">
                <Accordion
                  id="x-calendar-weekly-targets"
                  title={<span style={{ fontWeight: 600 }}>Weekly targets</span>}
                  right={<span id="x-calendar-flag-count" style={{ fontFamily: XCE_TYPE.mono, fontSize: 11.5, color: flags.length ? XCE_COLORS.amber : XCE_COLORS.inkMuted }}>{flags.length ? `${flags.length} flag${flags.length > 1 ? 's' : ''}` : 'no flags'}</span>}
                >
                  <div id="x-content-week-engine-counts-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 10 }}>
                    {ENGINE_ORDER.map((id) => {
                      const e = calendar.engines?.[id];
                      if (!e) return null;
                      return (
                        <div
                          key={id}
                          id={`x-content-week-engine-count-${id}`}
                          style={{ display: 'grid', gap: 2, padding: '8px 10px', borderRadius: XCE_RADII.sm, background: XCE_COLORS.surface, border: `1px solid ${e.belowWeeklyMin ? XCE_COLORS.amberBorder : XCE_COLORS.border}` }}
                        >
                          <span style={{ ...XCE_TYPE.label, fontFamily: XCE_TYPE.mono, color: XCE_COLORS.inkSoft }}>{ENGINE_LABEL[id]}</span>
                          <span style={{ fontSize: 18, fontWeight: 700, color: e.belowWeeklyMin ? XCE_COLORS.amber : XCE_COLORS.ink }}>{e.week}</span>
                          <span title={limitText(e)} style={{ fontSize: 10.5, color: XCE_COLORS.inkMuted, overflowWrap: 'anywhere' }}>{limitText(e)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {flags.length ? (
                    <ul id="x-content-week-flags-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                      {flags.map((f, i) => (
                        <li key={`${f.kind}-${f.date}-${f.engine || ''}-${i}`} className="xce-shortfall">
                          <strong>{f.kind}</strong>{f.date ? ` ${f.date}` : ''} — {f.message}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p id="x-content-week-flags-clear" className="xce-audit">No spacing, cap or weekly-minimum flags.</p>
                  )}
                </Accordion>
              </Card>
            </>
          ) : null}

          <div id="x-content-week-unscheduled-section" style={{ display: 'grid', gap: 10 }}>
            <SectionLabel
              id="x-calendar-ready-label"
              right={
                view === 'week' && unscheduled.length > READY_PREVIEW ? (
                  <button type="button" id="x-calendar-ready-view-all" style={{ ...pillBtn(false), minHeight: 30, padding: '0 10px', fontSize: 11.5 }} onClick={() => setView('unscheduled')}>
                    View all {unscheduled.length}
                  </button>
                ) : null
              }
            >
              {view === 'week' ? 'Ready to schedule' : `Unscheduled (${unscheduled.length})`}
            </SectionLabel>
            {readyRows.length ? (
              <div id="x-calendar-ready-list" style={{ display: 'grid', gap: 8 }}>{readyRows.map(renderReadyRow)}</div>
            ) : (
              <p id="x-calendar-ready-empty" className="xce-empty-note" style={{ margin: 0 }}>Nothing waiting to be scheduled.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
