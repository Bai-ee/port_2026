'use client';

import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

// CalendarPanel — the week grid over social_posts.
//
// PURE PRESENTATION. `calendar` is the output of features/x-content-inventory/
// week-calendar.js; this file re-derives nothing. Approve and schedule hand the
// work back to the card, which calls the existing social-posting actions.
// There is deliberately NO post-now control here.
//
// STYLING: classNames only (`xce-`); the parent card owns the single
// `<style jsx global>` block, prefixed `#x-content-card`.

const ENGINE_LABEL = { record: 'Record', ue: 'UE', client: 'Client', identity: 'Identity', untagged: 'Untagged' };
const ENGINE_ORDER = ['identity', 'record', 'ue', 'client'];

function dayLabel(date) {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function limitText(e) {
  const bits = [];
  if (e.weeklyMin != null) bits.push(`min ${e.weeklyMin}/wk`);
  if (e.weeklyMax != null) bits.push(`max ${e.weeklyMax}/wk`);
  if (e.maxPerDay != null) bits.push(`max ${e.maxPerDay}/day`);
  return bits.join(' · ') || 'no limit set';
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

  return (
    <div id="x-content-week-calendar-panel" className="xce-panel">
      <div id="x-content-week-calendar-header" className="xce-head">
        <span className="xce-head-date">{calendar ? `${calendar.start} → ${calendar.end}` : '—'}</span>
        <span className="xce-head-count">{calendar?.weekTotal ?? 0} posts · CT</span>
        <div id="x-content-week-calendar-nav-row" className="xce-tier-selector" role="group" aria-label="Week">
          <button type="button" id="x-content-week-prev-button" className="xce-tier-option" disabled={loading} onClick={() => onShift && onShift(-7)}>
            <ChevronLeft size={13} /> Prev
          </button>
          <button type="button" id="x-content-week-next-button" className="xce-tier-option" disabled={loading} onClick={() => onShift && onShift(7)}>
            Next <ChevronRight size={13} />
          </button>
        </div>
        {onRefresh ? (
          <button type="button" id="x-content-week-refresh-button" className="xce-refresh" onClick={onRefresh} disabled={!!loading}>
            <RefreshCw size={13} /> Refresh
          </button>
        ) : null}
      </div>

      {error ? (
        <p id="x-content-week-error" className="xce-error">
          <AlertTriangle size={13} /> {typeof error === 'string' ? error : 'Could not load the calendar.'}
        </p>
      ) : null}
      {loading ? <div id="x-content-week-loading" className="xce-loading">Loading the week…</div> : null}

      {!loading && calendar ? (
        <>
          <div id="x-content-week-engine-counts-row" className="xce-engine-counts">
            {ENGINE_ORDER.map((id) => {
              const e = calendar.engines?.[id];
              if (!e) return null;
              return (
                <div
                  key={id}
                  id={`x-content-week-engine-count-${id}`}
                  className={`xce-engine-count xce-engine-${id}${e.belowWeeklyMin ? ' xce-engine-short' : ''}`}
                >
                  <span className="xce-engine-name">{ENGINE_LABEL[id]}</span>
                  <span className="xce-engine-num">{e.week}</span>
                  <span className="xce-engine-limit">{limitText(e)}</span>
                </div>
              );
            })}
          </div>

          {flags.length ? (
            <ul id="x-content-week-flags-list" className="xce-flag-list">
              {flags.map((f, i) => (
                <li key={`${f.kind}-${f.date}-${f.engine || ''}-${i}`} className="xce-shortfall">
                  <strong>{f.kind}</strong>{f.date ? ` ${f.date}` : ''} — {f.message}
                </li>
              ))}
            </ul>
          ) : (
            <p id="x-content-week-flags-clear" className="xce-audit">No spacing, cap or weekly-minimum flags.</p>
          )}

          <ol id="x-content-week-grid" className="xce-week-grid">
            {days.map((day) => (
              <li key={day.date} id={`x-content-week-day-${day.date}`} className="xce-week-day">
                <p className="xce-week-day-head">
                  {dayLabel(day.date)} <span className="xce-head-count">{day.total}</span>
                  {day.flags?.length ? <span className="xce-chip xce-chip-warn">{day.flags.length} flag{day.flags.length > 1 ? 's' : ''}</span> : null}
                </p>
                {day.slots.length ? (
                  <ul className="xce-week-slots">
                    {day.slots.map((s) => {
                      const busy = busyId === s.id;
                      return (
                        <li key={s.id || `${day.date}-${s.time}`} id={`x-content-week-slot-${s.id}`} className={`xce-week-slot xce-engine-${s.engine || 'untagged'}`}>
                          <div className="xce-slot-head">
                            <span className="xce-slot-time">{s.time}</span>
                            <span className={`xce-chip xce-engine-chip xce-engine-${s.engine || 'untagged'}`}>{ENGINE_LABEL[s.engine || 'untagged']}</span>
                            <span className="xce-chip xce-chip-status">{s.status}</span>
                          </div>
                          <p className="xce-post-text">{s.title || '(no text)'}</p>
                          {s.packageId ? <p className="xce-asset">{s.packageId}</p> : null}
                          {s.status === 'draft' && onApprove ? (
                            <div className="xce-slot-actions">
                              <button type="button" id={`x-content-week-approve-button-${s.id}`} className="xce-draft-button" disabled={busy} onClick={() => onApprove(s)}>
                                <Check size={14} /> Approve
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="xce-empty-note">Nothing scheduled.</p>
                )}
              </li>
            ))}
          </ol>

          {unscheduled.length ? (
            <div id="x-content-week-unscheduled-section" className="xce-inv-section">
              <p className="xce-inv-kicker">Unscheduled ({unscheduled.length})</p>
              <ul className="xce-week-slots">
                {unscheduled.map((s) => {
                  const busy = busyId === s.id;
                  const value = times[s.id] || '';
                  return (
                    <li key={s.id} id={`x-content-week-unscheduled-${s.id}`} className={`xce-week-slot xce-engine-${s.engine || 'untagged'}`}>
                      <div className="xce-slot-head">
                        <span className={`xce-chip xce-engine-chip xce-engine-${s.engine || 'untagged'}`}>{ENGINE_LABEL[s.engine || 'untagged']}</span>
                        <span className="xce-chip xce-chip-status">{s.status}</span>
                      </div>
                      <p className="xce-post-text">{s.title || '(no text)'}</p>
                      <div className="xce-slot-actions">
                        {s.status === 'draft' && onApprove ? (
                          <button type="button" id={`x-content-week-unscheduled-approve-${s.id}`} className="xce-draft-button" disabled={busy} onClick={() => onApprove(s)}>
                            <Check size={14} /> Approve
                          </button>
                        ) : null}
                        {s.status === 'approved' && onSchedule ? (
                          <>
                            <input
                              type="datetime-local"
                              id={`x-content-week-schedule-time-${s.id}`}
                              className="xce-input"
                              value={value}
                              onChange={(e) => setTimes((t) => ({ ...t, [s.id]: e.target.value }))}
                            />
                            <button type="button" id={`x-content-week-schedule-button-${s.id}`} className="xce-draft-button" disabled={busy || !value} onClick={() => onSchedule(s, value)}>
                              Schedule
                            </button>
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
