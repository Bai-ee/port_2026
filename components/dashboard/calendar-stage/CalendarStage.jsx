'use client';

// Calendar Stage: one immersive, full-viewport layer with exactly one visible level
// (month | day | post) at a time. Transparent on purpose: the existing three.js gradient
// background shows through, and the stage adds no backdrop blur and no modal-on-modal.
//
// PUBLIC API
//   <CalendarStage
//     open            bool (default true). Mounting/unmounting on `open` resets the stage.
//     initialState    { level, date?, postId? }  used when the URL has no ?cal= param
//                     (e.g. "Open Today" = { level:'day', date: todayInZone(tz) }).
//     clientName      string shown in the top bar.
//     timeZone        IANA zone of the client (Central fallback).
//     onClose()       called after the stage faded out and URL params were cleaned.
//     renderMonth(nav) / renderDay(nav) / renderPost(nav)   render-props, one is mounted at a time.
//     canLeave(action, state) optional host guard: return false | Promise<false> to block leaving
//                     (action: 'back' | 'close' | 'openDay' | 'openPost' | 'history').
//     syncUrl         bool (default true). Shallow history: ?cal=month|day|post&d=YYYY-MM-DD&p=<postId>.
//   />
//
//   nav = { state, timeZone, today, openDay(date), openPost(postId), back(), close(),
//           setLeaveGuard(fn) }
//   setLeaveGuard(fn) is for the post level: fn(action) -> boolean | Promise<boolean>. Return false
//   to stay (the post level shows its own inline "unsaved edits" prompt; no window.confirm).
//   It returns an unregister function, so call it from an effect and return that cleanup.
//   The guard is consulted for Back, Esc, browser Back and Close while on the post level.
//
// DASHBOARD FADE (host contract, used by Agent D):
//   useDashboardFade(targetRef, stageActive)  or  applyDashboardFade(element, active)
//   Fades the element to opacity 0 and sets inert + aria-hidden + pointer-events:none (restored,
//   with a fade back in, when active turns false). The target must NOT contain the stage, so
//   mount <CalendarStage> as a sibling of the dashboard root, never inside it. The background
//   (InternalPageBackground) must stay outside the faded element.
//   Reload restore: if parseStageParams(location.search) is non-null, mount with open=true.
//   Limitation: when the page was loaded already on a ?cal= URL, Close cleans only the current
//   entry (it cannot step behind it).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CalendarStageStyles from './CalendarStageStyles';
import {
  backTarget, levelTitle, normalizeState, parseStageParams, safeTimeZone, sameState,
  serializeStageParams, stateKey, todayInZone, transition,
} from './calendar-stage-model';

export const STAGE_OUT_MS = 180;
export const STAGE_IN_MS = 220;

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const fadeMemory = new WeakMap();

export function applyDashboardFade(el, active, { durationMs = STAGE_OUT_MS } = {}) {
  if (!el || !el.style) return;
  const ms = prefersReducedMotion() ? 0 : durationMs;
  if (active) {
    if (!fadeMemory.has(el)) {
      fadeMemory.set(el, {
        opacity: el.style.opacity,
        transition: el.style.transition,
        pointerEvents: el.style.pointerEvents,
        ariaHidden: el.getAttribute('aria-hidden'),
      });
    }
    el.style.transition = ms ? `opacity ${ms}ms ease-out` : 'none';
    el.getBoundingClientRect(); // commit the transition before changing opacity
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    el.inert = true;
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  const prev = fadeMemory.get(el);
  if (!prev) return;
  fadeMemory.delete(el);
  el.inert = false;
  if (prev.ariaHidden === null) el.removeAttribute('aria-hidden');
  else el.setAttribute('aria-hidden', prev.ariaHidden);
  el.style.transition = ms ? `opacity ${ms}ms ease-out` : 'none';
  el.style.opacity = prev.opacity;
  el.style.pointerEvents = prev.pointerEvents;
  window.setTimeout(() => {
    if (!fadeMemory.has(el)) el.style.transition = prev.transition;
  }, ms);
}

// target: a ref object, an element, or a function returning an element.
export function useDashboardFade(target, active, opts) {
  const durationMs = opts && opts.durationMs;
  useEffect(() => {
    const el = typeof target === 'function' ? target() : target && 'current' in target ? target.current : target;
    if (!el) return undefined;
    applyDashboardFade(el, !!active, { durationMs });
    return () => applyDashboardFade(el, false, { durationMs });
  }, [target, active, durationMs]);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function CalendarStage(props) {
  if (props.open === false) return null;
  return <StageInner {...props} />;
}

function StageInner(props) {
  const { initialState, clientName, timeZone, syncUrl = true } = props;
  const tz = safeTimeZone(timeZone);

  const [view, setView] = useState(() => {
    const fromUrl = syncUrl && typeof window !== 'undefined' ? parseStageParams(window.location.search) : null;
    return fromUrl || normalizeState(initialState);
  });
  const [phase, setPhase] = useState('pre');
  const [closing, setClosing] = useState(false);

  const propsRef = useRef(props);
  propsRef.current = props;
  const viewRef = useRef(view);
  const rootRef = useRef(null);
  const titleRef = useRef(null);
  const guardRef = useRef(null);
  const timersRef = useRef({ t: 0, r1: 0, r2: 0 });
  const closingRef = useRef(false);
  const bypassRef = useRef(false);
  const histRef = useRef({ idx: 0, keys: [], baseHasCal: false });

  const clearTimers = () => {
    const t = timersRef.current;
    window.clearTimeout(t.t);
    window.cancelAnimationFrame(t.r1);
    window.cancelAnimationFrame(t.r2);
  };

  const settleIn = () => {
    const t = timersRef.current;
    t.r1 = window.requestAnimationFrame(() => {
      t.r2 = window.requestAnimationFrame(() => setPhase('in'));
    });
  };

  const swapTo = useCallback((next) => {
    clearTimers();
    viewRef.current = next;
    if (prefersReducedMotion()) {
      setView(next);
      setPhase('in');
      return;
    }
    setPhase('out');
    timersRef.current.t = window.setTimeout(() => {
      setView(next);
      setPhase('pre');
      settleIn();
    }, STAGE_OUT_MS);
  }, []);

  const askLeave = useCallback(async (action) => {
    const cur = viewRef.current;
    try {
      if (cur.level === 'post' && guardRef.current) {
        if ((await guardRef.current(action)) === false) return false;
      }
      const host = propsRef.current.canLeave;
      if (host && (await host(action, cur)) === false) return false;
    } catch {
      return false;
    }
    return true;
  }, []);

  const urlFor = (state) =>
    `${window.location.pathname}${serializeStageParams(window.location.search, state)}${window.location.hash}`;

  const pushEntry = (state) => {
    const h = histRef.current;
    h.idx += 1;
    h.keys.length = h.idx;
    h.keys[h.idx] = stateKey(state);
    window.history.pushState({ calStage: true, idx: h.idx }, '', urlFor(state));
  };

  const commitHistory = (next, mode) => {
    if (propsRef.current.syncUrl === false) return;
    const h = histRef.current;
    if (mode === 'back' && h.idx > 0 && h.keys[h.idx - 1] === stateKey(next)) {
      bypassRef.current = true;
      h.idx -= 1;
      window.history.back();
      return;
    }
    if (mode === 'back') {
      h.keys[h.idx] = stateKey(next);
      window.history.replaceState({ calStage: true, idx: h.idx }, '', urlFor(next));
      return;
    }
    pushEntry(next);
  };

  const finishClose = useCallback((touchHistory) => {
    closingRef.current = true;
    clearTimers();
    setClosing(true);
    const reduced = prefersReducedMotion();
    window.setTimeout(() => {
      const p = propsRef.current;
      if (touchHistory && p.syncUrl !== false) {
        const h = histRef.current;
        if (!h.baseHasCal && h.idx > 0) window.history.go(-h.idx);
        else window.history.replaceState(window.history.state, '', urlFor(null));
      }
      if (p.onClose) p.onClose();
    }, reduced ? 0 : STAGE_OUT_MS);
  }, []);

  const close = useCallback(async () => {
    if (closingRef.current) return;
    if (!(await askLeave('close'))) return;
    finishClose(true);
  }, [askLeave, finishClose]);

  const navigate = useCallback(async (action) => {
    if (closingRef.current) return;
    const { state: next, exit } = transition(viewRef.current, action);
    if (exit) {
      await close();
      return;
    }
    if (sameState(next, viewRef.current)) return;
    if (!(await askLeave(action.type === 'back' ? 'back' : action.type))) return;
    if (closingRef.current || sameState(next, viewRef.current)) return;
    commitHistory(next, action.type === 'back' ? 'back' : 'push');
    swapTo(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askLeave, close, swapTo]);

  const nav = useRef(null);
  if (!nav.current) {
    nav.current = {
      openDay: (date) => navigate({ type: 'openDay', date }),
      openPost: (postId) => navigate({ type: 'openPost', postId }),
      back: () => navigate({ type: 'back' }),
      close: () => close(),
      setLeaveGuard: (fn) => {
        guardRef.current = fn;
        return () => {
          if (guardRef.current === fn) guardRef.current = null;
        };
      },
    };
  }

  // History bootstrap, popstate, Esc and focus trap. Runs once per open.
  useEffect(() => {
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const h = histRef.current;
    const sync = propsRef.current.syncUrl !== false;

    if (sync) {
      const startKey = stateKey(viewRef.current);
      const hasCal = !!parseStageParams(window.location.search);
      h.baseHasCal = hasCal;
      if (hasCal) {
        h.idx = 0;
        h.keys[0] = startKey;
        window.history.replaceState({ calStage: true, idx: 0 }, '', urlFor(viewRef.current));
      } else {
        h.idx = 0;
        pushEntry(viewRef.current);
      }
    }
    settleIn();

    const onPop = async (e) => {
      if (closingRef.current) return;
      const st = e.state;
      if (st && typeof st.idx === 'number') h.idx = st.idx;
      const parsed = parseStageParams(window.location.search);
      if (parsed && sameState(parsed, viewRef.current)) {
        bypassRef.current = false;
        return;
      }
      const allowed = bypassRef.current || (await askLeave('history'));
      bypassRef.current = false;
      if (!allowed) {
        pushEntry(viewRef.current); // put the entry the user tried to leave back
        return;
      }
      if (!parsed) finishClose(false);
      else swapTo(parsed);
    };

    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        navigate({ type: 'back' });
        return;
      }
      if (e.key !== 'Tab' || !rootRef.current) return;
      const nodes = Array.from(rootRef.current.querySelectorAll(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (!nodes.length) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!rootRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      clearTimers();
      document.body.style.overflow = prevOverflow;
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the new level's heading on every switch.
  useEffect(() => {
    if (titleRef.current) titleRef.current.focus({ preventScroll: true });
  }, [view.level, view.date, view.postId]);

  const render =
    view.level === 'month' ? props.renderMonth : view.level === 'day' ? props.renderDay : props.renderPost;
  const api = {
    ...nav.current,
    state: view,
    timeZone: tz,
    today: todayInZone(tz),
  };
  const title = levelTitle(view, { timeZone: tz });
  const canGoBack = !!backTarget(view);

  return (
    <div
      id="calendar-stage-root"
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-stage-title"
      data-section="calendar-stage"
      data-level={view.level}
      data-closing={closing ? 'true' : 'false'}
    >
      <CalendarStageStyles />
      <header id="calendar-stage-top-bar">
        <div id="calendar-stage-top-bar-start">
          {canGoBack ? (
            <button id="calendar-stage-back-button" type="button" onClick={() => nav.current.back()}>
              {'← Back'}
            </button>
          ) : null}
        </div>
        <h1 id="calendar-stage-title" ref={titleRef} tabIndex={-1}>
          {title}
        </h1>
        <div id="calendar-stage-top-bar-end">
          {clientName ? <span id="calendar-stage-client-name">{clientName}</span> : null}
          <button id="calendar-stage-close-button" type="button" aria-label="Close calendar" onClick={() => nav.current.close()}>
            {'✕'}
          </button>
        </div>
      </header>
      <main id={`calendar-stage-level-${view.level}`} className="calendar-stage-level" data-phase={phase}>
        {render ? render(api) : null}
      </main>
    </div>
  );
}
