'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CalendarDays, Check, Compass, FolderOpen } from 'lucide-react';
import { REFRESH_GROUPS, readLastRefreshed, groupFreshness } from './marketing/refresh-groups.js';
import { useMarketingContentCall } from './marketing/useMarketingContentCall';
import LoadingRing from './content-ui/ui/LoadingRing';

// STAND UP bucket (admin; file/ids keep the original onboarding-flow name): the three-step daily flow — Content → Strategy → Calendar — shown all at once.
// Each step opens the existing card modals through onOpenCard. Status lines read what the last brief/refresh saved:
// marketingBrief (already in the bootstrap) plus two free read-only calls (strategy-freshness, month-calendar).
// Nothing here runs a refresh or spends. "Done" ticks are a per-browser daily checklist (reset each day).

const STEPS = [
  {
    id: 'content',
    title: 'Content',
    Icon: FolderOpen,
    lede: 'Stage what you have, sort it into buckets and check the timeline.',
    primary: { cardId: 'x-content', label: 'Open Content Center' },
    related: [
      { cardId: 'media-library', label: 'Media Library' },
      { cardId: 'client-brain', label: 'Client Brain' },
    ],
  },
  {
    id: 'strategy',
    title: 'Strategy',
    Icon: Compass,
    lede: 'Decide what this week is about: tracks, signals and what is working.',
    primary: { cardId: 'strategy-document', label: 'Open Strategy' },
    related: [
      { cardId: 'signals', label: 'Market Signals' },
      { cardId: 'strategy-results', label: 'Results' },
    ],
  },
  {
    id: 'calendar',
    title: 'Today’s Agenda',
    Icon: CalendarDays,
    lede: 'Everything on the calendar today, by category. Review the drafts, then schedule them.',
    // Opens Queue & Calendar with today's day view on top (closing it shows the month).
    primary: { cardId: 'strategy-queue-calendar', label: 'Open Today', openToday: true },
    related: [
      { cardId: 'strategy-queue-calendar', label: 'Queue & Calendar' },
      { cardId: 'copywriter', label: 'Copywriter' },
      { cardId: 'strategy-publishing-settings', label: 'Publishing settings' },
    ],
  },
];

const DONE_KEY = 'onboarding-flow-done-v1';
const pad2 = (n) => String(n).padStart(2, '0');
const todayKey = () => new Date().toISOString().slice(0, 10);

function ago(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins < 1 ? '<1' : mins}M AGO`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}H AGO` : `${Math.round(hrs / 24)}D AGO`;
}

// The brief's summary paragraph (scoutBrief.humanBrief) — rewritten by every refresh, unlike marketingBrief.headline,
// which Scout-only refreshes leave over from the last full run. Its required last line is "PRIORITY ACTION: …"
// (xscout.js HUMAN BRIEF template): that is the "do now". Without it, fall back to its first one or two real sentences.
const META_LINE_RE = /^(first run|no previous baseline|no live signal|background context only)/i;
function marketLine(brief) {
  const raw = String(brief?.scoutBrief?.humanBrief || '').replace(/\*\*|__|`/g, '');
  if (!raw.trim()) return null;
  const action = raw.match(/PRIORITY ACTION:\s*(.+)/i)?.[1]?.trim();
  if (action) return { kind: 'action', text: action };
  const body = raw.split('\n').map((l) => l.trim()).filter((l) => l && !META_LINE_RE.test(l)).join(' ').replace(/\s+/g, ' ');
  const sentences = (body.match(/[^.!?]+[.!?]+/g) || [body]).map((x) => x.trim()).filter((x) => x && !META_LINE_RE.test(x));
  let out = '';
  for (const sentence of sentences.slice(0, 2)) {
    if ((`${out} ${sentence}`).length > 260 && out) break;
    out = out ? `${out} ${sentence}` : sentence;
  }
  if (!out) return null;
  return { kind: 'summary', text: out.length > 280 ? `${out.slice(0, 277).trim()}…` : out };
}

const monthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const DRAFT_STATES = new Set(['pending', 'awaiting', 'held']);
const SCHEDULED_STATES = new Set(['approved', 'scheduled', 'manual']);

// Today's calendar rows grouped by category: quote retweets, suggestions, then each Content Center bucket.
function todaysAgenda(calendar) {
  const day = (calendar?.weeks || []).flat().find((d) => d?.isToday);
  if (!day) return null;
  const names = new Map((calendar.legend || []).map((b) => [b.id, b.name]));
  const groups = new Map();
  const add = (key, label, color, r) => {
    if (!groups.has(key)) groups.set(key, { key, label, color, total: 0, drafts: 0, scheduled: 0, posted: 0, suggested: 0 });
    const g = groups.get(key);
    g.total += 1;
    if (DRAFT_STATES.has(r.state)) g.drafts += 1;
    else if (SCHEDULED_STATES.has(r.state)) g.scheduled += 1;
    else if (r.state === 'posted') g.posted += 1;
    else if (r.state === 'suggested') g.suggested += 1;
  };
  for (const r of day.posts || []) {
    if (r.kind === 'requote') add('requote', 'Quote retweets', null, r);
    else if (r.kind === 'suggestion') add('suggestion', 'Suggested posts', null, r);
    else add(`bucket:${r.bucketId || 'none'}`, names.get(r.bucketId) || (r.bucketId ? r.bucketId : 'No bucket'), r.bucketColor || null, r);
  }
  const openTasks = (day.tasks || []).filter((t) => t.status === 'open').length;
  const rows = [...groups.values()].sort((a, b) => (a.key === 'requote' ? -1 : b.key === 'requote' ? 1 : b.total - a.total));
  const sum = (k) => rows.reduce((n, g) => n + g[k], 0);
  // Requotes on today's calendar at any time (open quote opportunities + quote posts), from the 'requote' group.
  const requotes = groups.get('requote')?.total || 0;
  return { date: day.date, rows, openTasks, total: sum('total'), drafts: sum('drafts'), scheduled: sum('scheduled'), posted: sum('posted'), requotes };
}

function readDone() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DONE_KEY) || '{}');
    return parsed?.date === todayKey() && Array.isArray(parsed.ids) ? parsed.ids : [];
  } catch { return []; }
}

export default function OnboardingFlowPanel({ onOpenCard, onOpenTodayDay, availableCardIds, marketingBrief, getIdToken, clientId }) {
  const [done, setDone] = useState([]);
  const [serverFreshness, setServerFreshness] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [calendarFailed, setCalendarFailed] = useState(false); // a failed read shows "—" stats instead of a ring forever
  const { call } = useMarketingContentCall(getIdToken);

  useEffect(() => { setDone(readDone()); }, []);

  // Free, read-only reads; a failure (e.g. not the pilot owner) just leaves the value as "—".
  useEffect(() => {
    if (!getIdToken || !clientId) return undefined;
    let live = true;
    call('strategy-freshness', { clientId }).then((r) => { if (live) setServerFreshness(r?.groups || null); }).catch(() => {});
    call('month-calendar', { month: monthKey() })
      .then((r) => { if (!live) return; if (r?.calendar) setCalendar(r.calendar); else setCalendarFailed(true); })
      .catch(() => { if (live) setCalendarFailed(true); });
    return () => { live = false; };
  }, [getIdToken, clientId, call]);

  const lastRefresh = useMemo(() => {
    const local = readLastRefreshed();
    let best = null;
    REFRESH_GROUPS.forEach((g) => {
      const f = groupFreshness(g.id, { lastRefreshed: local, serverAsOf: serverFreshness?.serverAsOf });
      if (f.asOf && (!best || f.asOf > best)) best = f.asOf;
    });
    return best;
  }, [serverFreshness]);

  const briefAt = marketingBrief?.scoutBrief?.timestamp || marketingBrief?.generatedAtIso || null;
  const insight = marketLine(marketingBrief);
  const agenda = useMemo(() => todaysAgenda(calendar), [calendar]);
  const num = (n) => (typeof n === 'number' && Number.isFinite(n) ? pad2(n) : '—');

  // Per-step status block (stats + optional quote line), from the saved brief/refresh only.
  const statusFor = (id) => {
    if (id === 'strategy') {
      return {
        stats: [],
        quote: insight ? { text: insight.text, label: `${insight.kind === 'action' ? 'DO NOW' : 'RIGHT NOW'}${briefAt ? ` · UPDATED ${ago(briefAt)}` : ''}` } : null,
      };
    }
    if (id === 'calendar') {
      return {
        stats: [
          { label: 'ON TODAY', value: num(agenda?.total) },
          { label: 'DRAFTS', value: num(agenda?.drafts) },
          { label: 'SCHEDULED', value: num(agenda?.scheduled) },
          { label: 'POSTED', value: num(agenda?.posted) },
          { label: 'REQUOTES', value: num(agenda?.requotes) },
        ],
        agenda: true,
      };
    }
    return null;
  };

  const toggleDone = (id) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try { window.localStorage.setItem(DONE_KEY, JSON.stringify({ date: todayKey(), ids: next })); } catch { /* storage unavailable */ }
  };

  const has = useMemo(() => (id) => !availableCardIds || availableCardIds.has(id), [availableCardIds]);

  return (
    <div id="onboarding-flow-shell" className="tile-detail-bento-cell">
      <div id="onboarding-flow-header-row">
        <span id="onboarding-flow-last-refresh" className="of-caps">LAST REFRESH <strong>{ago(lastRefresh) || '—'}</strong></span>
        <span id="onboarding-flow-progress" className="of-caps">{pad2(done.length)} / {pad2(STEPS.length)} DONE TODAY</span>
      </div>
      <ol id="onboarding-flow-step-list" aria-label="Daily flow">
        {/* Shown last-step-first (03 → 01); each step keeps its own number. */}
        {STEPS.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => {
          const isDone = done.includes(s.id);
          return (
            <li key={s.id} id={`onboarding-flow-step-${s.id}`} className="of-step" data-done={isDone ? 'true' : 'false'}>
              <span className="of-step-num" aria-hidden="true">{pad2(i + 1)}</span>
              <div className="of-step-main">
                <div className="of-step-title-row">
                  <h2 className="of-step-title">
                    <s.Icon size={20} strokeWidth={2} aria-hidden="true" />
                    {s.title}
                  </h2>
                  <button type="button" id={`onboarding-flow-done-btn-${s.id}`} className="of-done-btn" aria-pressed={isDone} onClick={() => toggleDone(s.id)}>
                    <Check size={13} strokeWidth={2} aria-hidden="true" />
                    {isDone ? 'Done today' : 'Mark done'}
                  </button>
                </div>
                <p className="of-step-lede">{s.lede}</p>
                {(() => {
                  const st = statusFor(s.id);
                  if (!st) return null;
                  return (
                    <div id={`onboarding-flow-status-${s.id}`} className="of-status">
                      {st.quote ? (
                        <blockquote id={`onboarding-flow-insight-${s.id}`} className="of-insight">
                          <span className="of-caps">{st.quote.label}</span>
                          <span className="of-insight-text">{st.quote.text}</span>
                        </blockquote>
                      ) : null}
                      {/* Today's Agenda waits on the calendar: the standard loading ring, then stats + rows fade up in sequence. */}
                      {st.agenda && !calendar && !calendarFailed ? <LoadingRing id="onboarding-flow-agenda-loading" label="Loading today's agenda" size={28} minHeight={96} /> : null}
                      {st.stats.length && !(st.agenda && !calendar && !calendarFailed) ? <div className={`of-stat-row${st.agenda ? ' of-reveal' : ''}`}>
                        {st.stats.map((x, i) => (
                          <div key={x.label} className="of-stat" style={st.agenda ? { '--of-i': i } : undefined}>
                            <span className="of-stat-value">{x.value}</span>
                            <span className="of-caps">{x.label}{x.hint ? ` · ${x.hint}` : ''}</span>
                          </div>
                        ))}
                      </div> : null}
                      {st.agenda && calendar ? (
                        <ul id="onboarding-flow-agenda-list" className="of-agenda of-reveal" aria-label="Today by category">
                          {!agenda?.rows.length ? <li className="of-agenda-empty of-caps" style={{ '--of-i': 5 }}>[NOTHING ON THE CALENDAR TODAY]</li> : null}
                          {(agenda?.rows || []).map((g, i) => (
                            <li key={g.key} id={`onboarding-flow-agenda-${g.key.replace(/[^a-z0-9-]/gi, '-')}`} className="of-agenda-row" style={{ '--of-i': 5 + i }}>
                              <span className="of-agenda-dot" aria-hidden="true" style={g.color ? { background: g.color } : undefined} />
                              <span className="of-agenda-label">{g.label}</span>
                              <span className="of-agenda-meta of-caps">
                                {[g.drafts && `${g.drafts} DRAFT`, g.scheduled && `${g.scheduled} SCHEDULED`, g.posted && `${g.posted} POSTED`, g.suggested && `${g.suggested} TO REVIEW`].filter(Boolean).join(' · ')}
                              </span>
                              <span className="of-agenda-count">{pad2(g.total)}</span>
                            </li>
                          ))}
                          {agenda?.openTasks ? (
                            <li id="onboarding-flow-agenda-tasks" className="of-agenda-row" style={{ '--of-i': 5 + (agenda?.rows?.length || 0) }}>
                              <span className="of-agenda-dot" aria-hidden="true" />
                              <span className="of-agenda-label">Media tasks</span>
                              <span className="of-agenda-meta of-caps">OPEN</span>
                              <span className="of-agenda-count">{pad2(agenda.openTasks)}</span>
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                    </div>
                  );
                })()}
                <div className="of-step-actions">
                  {has(s.primary.cardId) ? (
                    <button type="button" id={`onboarding-flow-primary-btn-${s.id}`} className="of-primary-btn" onClick={() => (s.primary.openToday && onOpenTodayDay ? onOpenTodayDay() : onOpenCard?.(s.primary.cardId))}>
                      {s.primary.label}
                      <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                  {s.related.filter((r) => has(r.cardId)).map((r) => (
                    <button key={r.cardId} type="button" id={`onboarding-flow-related-${r.cardId}`} className="of-related-btn" onClick={() => onOpenCard?.(r.cardId)}>
                      {r.label}
                      <ArrowUpRight size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <style jsx global>{`
        #onboarding-flow-shell { --of-mono: var(--font-mono, "Space Mono", monospace); --of-ui: var(--font-ui, "Space Grotesk", system-ui, sans-serif); padding: clamp(16px, 3vw, 28px); color: var(--t-text); font-family: var(--of-ui); box-sizing: border-box; }
        #onboarding-flow-shell .of-caps { font-family: var(--of-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-text-secondary); }
        #onboarding-flow-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--t-border-faint); }
        #onboarding-flow-step-list { margin: 0; padding: 0; list-style: none; }
        #onboarding-flow-shell .of-step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: clamp(16px, 3vw, 32px); padding: clamp(20px, 3vw, 28px) 0; border-bottom: 1px solid var(--t-border-faint); }
        #onboarding-flow-shell .of-step:last-child { border-bottom: none; padding-bottom: 4px; }
        #onboarding-flow-shell .of-step-num { font-family: "Doto", var(--of-mono); font-weight: 700; font-size: clamp(48px, 6vw, 72px); line-height: 0.8; letter-spacing: -0.03em; color: var(--t-text-strong); min-width: 1.6em; }
        #onboarding-flow-shell .of-step[data-done="true"] .of-step-num { color: var(--t-text-disabled); }
        #onboarding-flow-shell .of-step-main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
        #onboarding-flow-shell .of-step-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        #onboarding-flow-shell .of-step-title { display: flex; align-items: center; gap: 10px; margin: 0; font-size: clamp(22px, 2.6vw, 28px); font-weight: 700; line-height: 1.05; letter-spacing: -0.03em; color: var(--t-text-strong); }
        #onboarding-flow-shell .of-step-lede { margin: 0; max-width: 52ch; font-size: 15px; line-height: 1.45; color: var(--t-text-secondary); }
        #onboarding-flow-shell .of-step-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px; }
        /* Main step button: the active-bucket look (.capability-nav-btn--active) — surface fill + static 1px gradient border.
           The mask only reads alpha, so a token stands in for the usual #fff. */
        #onboarding-flow-shell .of-primary-btn { position: relative; isolation: isolate; display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 18px; border: none; border-radius: 999px; background: var(--t-surface); color: var(--t-text-strong); font-family: var(--of-ui); font-size: 14px; font-weight: 700; cursor: pointer; transition: transform 150ms ease-out; }
        #onboarding-flow-shell .of-primary-btn::before { content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit; padding: 1px; background: linear-gradient(180deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%); -webkit-mask: linear-gradient(var(--t-text) 0 0) content-box, linear-gradient(var(--t-text) 0 0); -webkit-mask-composite: xor; mask: linear-gradient(var(--t-text) 0 0) content-box, linear-gradient(var(--t-text) 0 0); mask-composite: exclude; pointer-events: none; }
        #onboarding-flow-shell .of-primary-btn:hover { transform: translateY(-1px); }
        #onboarding-flow-shell .of-related-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 14px; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-secondary); font-family: var(--of-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; transition: color 150ms ease-out, border-color 150ms ease-out; }
        #onboarding-flow-shell .of-related-btn:hover { color: var(--t-text-strong); border-color: var(--t-control-border-strong); }
        #onboarding-flow-shell .of-done-btn { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; min-height: 32px; padding: 0 12px; border: 1px solid var(--t-border-faint); border-radius: 999px; background: transparent; color: var(--t-text-secondary); font-family: var(--of-mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
        #onboarding-flow-shell .of-done-btn[aria-pressed="true"] { color: var(--t-success); border-color: var(--t-success-border); }
        #onboarding-flow-last-refresh strong { font-weight: 400; color: var(--t-text-strong); }
        #onboarding-flow-shell .of-status { display: flex; flex-direction: column; gap: 14px; margin-top: 4px; }
        #onboarding-flow-shell .of-insight { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0 0 0 14px; border-left: 2px solid var(--t-text-strong); }
        #onboarding-flow-shell .of-insight-text { max-width: 62ch; font-size: 16px; line-height: 1.45; color: var(--t-text-strong); }
        #onboarding-flow-shell .of-stat-row { display: flex; flex-wrap: wrap; gap: 12px 32px; }
        #onboarding-flow-shell .of-stat { display: flex; flex-direction: column; gap: 4px; }
        #onboarding-flow-shell .of-stat-value { font-family: var(--of-mono); font-size: 22px; line-height: 1; color: var(--t-text-strong); }
        #onboarding-flow-shell .of-agenda { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--t-border-faint); }
        #onboarding-flow-shell .of-agenda-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto 32px; align-items: center; gap: 12px; min-height: 40px; border-bottom: 1px solid var(--t-border-faint); }
        #onboarding-flow-shell .of-agenda-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--t-text-secondary); }
        #onboarding-flow-shell .of-agenda-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; color: var(--t-text-strong); }
        #onboarding-flow-shell .of-agenda-meta { text-align: right; }
        #onboarding-flow-shell .of-agenda-count { font-family: var(--of-mono); font-size: 15px; text-align: right; color: var(--t-text-strong); }
        #onboarding-flow-shell .of-agenda-empty { padding: 12px 0; }
        /* Same feel as the dashboard reveal (opacity, power2.out ~0.45 s), staggered per item via --of-i. */
        #onboarding-flow-shell .of-reveal > * { animation: of-reveal-in 450ms cubic-bezier(0.33, 1, 0.68, 1) both; animation-delay: calc(var(--of-i, 0) * 60ms); }
        @keyframes of-reveal-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { #onboarding-flow-shell .of-reveal > * { animation: none; } }
        #onboarding-flow-shell button:focus-visible { outline: 2px solid var(--t-focus); outline-offset: 2px; }

        @media (max-width: 620px) {
          #onboarding-flow-shell .of-step { grid-template-columns: 1fr; gap: 10px; }
          #onboarding-flow-shell .of-step-num { font-size: 40px; }
          #onboarding-flow-shell .of-step-title { font-size: 22px; }
          #onboarding-flow-shell .of-primary-btn { flex: 1 1 100%; justify-content: center; }
          #onboarding-flow-shell .of-agenda-row { grid-template-columns: 10px minmax(0, 1fr) 32px; row-gap: 2px; padding: 8px 0; }
          #onboarding-flow-shell .of-agenda-meta { grid-column: 2; grid-row: 2; text-align: left; }
          #onboarding-flow-shell .of-agenda-count { grid-column: 3; grid-row: 1 / span 2; }
        }
        @media (max-width: 480px) {
          #onboarding-flow-shell { padding: 12px var(--mobile-gutter, 8px); }
        }
      `}</style>
    </div>
  );
}
