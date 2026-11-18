'use client';

// Tape Deck (?tool=tapes) — public before/after listening for restored DJ
// mixtapes. Two cassette decks (A = original, B = enhanced) share one
// transport. Both <audio> elements play the same 60 s window in parallel; the
// inactive one is muted, so pressing a deck swaps what you hear at the same
// moment. Read-only: one GET to /api/public/tape-deck, no auth, no writes.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { GLASS, ui } from '../components/rail-ui';
import { useRailReveal } from '../components/useRailReveal';
import Cassette from './Cassette';
import {
  DRIFT_RESYNC_S, clampTime, deckForKey, deepLinkHash, diagChips, formatClock, formatPublished, minutesRemoved, planSwitch, readDeepLink,
} from './tape-deck-sync';

const READY_TIMEOUT_MS = 12000;
const PLAY_ERROR = 'This clip could not be played in your browser.';

/** Resolves when the element can play (or after a timeout / error, so playback is never stuck). */
function whenPlayable(el, resumeAt, { startLoad = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeEventListener('canplay', finish);
      el.removeEventListener('error', finish);
      if (resumeAt > 0) { try { el.currentTime = resumeAt; } catch { /* metadata not ready */ } }
      resolve();
    };
    if (el.readyState >= 3) { finish(); return; }
    el.addEventListener('canplay', finish);
    el.addEventListener('error', finish);
    timer = setTimeout(finish, READY_TIMEOUT_MS);
    el.preload = 'auto';
    // load() would abort a play() already issued inside the user gesture, so the lead skips it.
    if (startLoad && el.readyState === 0) el.load();
  });
}

/** Rail card shell: same look as the other Studio rails, without the expand chevron. */
function RailPanel({ id, title, subtitle, children }) {
  return (
    <div id={id} className="studio-rail-card">
      <div className="studio-rail-card-content" style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontFamily: GLASS.sans, fontSize: 15, fontWeight: 500, color: GLASS.ink, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{title}</span>
          {subtitle ? <span style={{ ...ui.label, fontSize: 10, letterSpacing: '0.06em' }}>{subtitle}</span> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export default function TapeDeckStudio({ isNarrow = false, railW = 336 }) {
  const railInnerRef = useRailReveal();
  const [status, setStatus] = useState('loading'); // loading | ready | unavailable
  const [reviews, setReviews] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [active, setActive] = useState('A');
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [lengthS, setLengthS] = useState(60);
  const [audioError, setAudioError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);

  const audioRefs = useRef({ A: null, B: null });
  const activeRef = useRef('A');
  const playingRef = useRef(false);
  const timeRef = useRef(0);
  const lengthRef = useRef(60);
  const parallelRef = useRef(true);
  const rafRef = useRef(0);

  const selected = useMemo(() => reviews.find((r) => r.id === selectedId) || null, [reviews, selectedId]);

  // ── Data: public endpoint ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const choose = (list) => {
      setReviews(list);
      const linked = readDeepLink(window.location.hash);
      setSelectedId((list.find((r) => r.id === linked) || list[0] || {}).id || '');
      setStatus('ready');
    };
    setStatus('loading');
    fetch('/api/public/tape-deck')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('bad status'))))
      .then((data) => {
        if (cancelled) return;
        if (data?.error) { setStatus('unavailable'); return; }
        choose(Array.isArray(data?.reviews) ? data.reviews : []);
      })
      .catch(() => { if (!cancelled) setStatus('unavailable'); });
    return () => { cancelled = true; };
  }, [reloadTick]);

  // ── Transport ─────────────────────────────────────────────────────────────
  const stopLoop = useCallback(() => { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }, []);

  const pauseAll = useCallback(() => {
    const { A, B } = audioRefs.current;
    A?.pause(); B?.pause();
    playingRef.current = false;
    setPlaying(false);
    setBusy(false);
    stopLoop();
  }, [stopLoop]);

  const startLoop = useCallback(() => {
    stopLoop();
    const tick = () => {
      const el = audioRefs.current[activeRef.current];
      if (el) {
        const t = el.currentTime;
        timeRef.current = t;
        setTime(t);
        if (el.ended || t >= lengthRef.current - 0.05) {
          pauseAll();
          const { A, B } = audioRefs.current;
          [A, B].forEach((a) => { if (a) a.currentTime = 0; });
          timeRef.current = 0;
          setTime(0);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [pauseAll, stopLoop]);

  const play = useCallback(async () => {
    const { A, B } = audioRefs.current;
    if (!A || !B || playingRef.current) return;
    setAudioError('');
    setBusy(true);
    const from = timeRef.current;
    const lead = audioRefs.current[activeRef.current];
    const other = audioRefs.current[activeRef.current === 'A' ? 'B' : 'A'];
    lead.muted = false;
    other.muted = true;
    // Start the audible element synchronously inside the user gesture (iOS Safari
    // blocks play() once we have awaited); it buffers and begins on its own.
    if (from > 0) { try { lead.currentTime = from; } catch { /* metadata not ready */ } }
    const leadPlay = lead.play();
    await Promise.all([whenPlayable(lead, 0, { startLoad: false }), whenPlayable(other, from)]);
    other.currentTime = lead.currentTime;
    const [leadRes, otherRes] = await Promise.allSettled([leadPlay, other.play()]);
    if (leadRes.status === 'rejected') {
      lead.pause(); other.pause();
      setBusy(false);
      setAudioError(PLAY_ERROR);
      return;
    }
    // Some browsers (iOS) refuse two simultaneous elements: fall back to swapping on switch.
    parallelRef.current = otherRes.status === 'fulfilled';
    if (!parallelRef.current) other.pause();
    playingRef.current = true;
    setPlaying(true);
    setBusy(false);
    startLoop();
  }, [startLoop]);

  const togglePlay = useCallback(() => {
    if (playingRef.current) pauseAll(); else play();
  }, [pauseAll, play]);

  const seekTo = useCallback((t) => {
    const next = clampTime(t, lengthRef.current);
    timeRef.current = next;
    setTime(next);
    const { A, B } = audioRefs.current;
    [A, B].forEach((el) => { if (el) { try { el.currentTime = next; } catch { /* not loaded yet: applied on play */ } } });
  }, []);

  const switchDeck = useCallback((to) => {
    const from = activeRef.current;
    const src = audioRefs.current[from];
    const tgt = audioRefs.current[to];
    if (!src || !tgt) return;
    const plan = planSwitch({
      from, to, fromTime: src.currentTime, toTime: tgt.currentTime, playing: playingRef.current, parallel: parallelRef.current,
    });
    if (plan.noop) return;
    if (plan.seek !== null) { try { tgt.currentTime = plan.seek; } catch { /* not loaded yet */ } }
    tgt.muted = false;
    if (plan.muteSource) src.muted = true;
    if (plan.pauseSource) src.pause();
    if (plan.playTarget) tgt.play().catch(() => setAudioError(PLAY_ERROR));
    activeRef.current = to;
    setActive(to);
  }, []);

  // Keys: 1/2 or A/B pick a deck, Space plays/pauses.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      const deck = deckForKey(e.key);
      if (deck) { e.preventDefault(); switchDeck(deck); return; }
      if (e.key === ' ' && tag !== 'button') { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchDeck, togglePlay]);

  useEffect(() => () => { stopLoop(); const { A, B } = audioRefs.current; A?.pause(); B?.pause(); }, [stopLoop]);

  const selectReview = useCallback((id) => {
    if (id === selectedId) return;
    pauseAll();
    timeRef.current = 0;
    parallelRef.current = true;
    setTime(0);
    setAudioError('');
    setSelectedId(id);
    try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${deepLinkHash(id)}`); } catch { /* ignore */ }
  }, [pauseAll, selectedId]);

  // A new pair mounts fresh <audio> elements: keep the chosen deck audible.
  useEffect(() => {
    const { A, B } = audioRefs.current;
    if (A) A.muted = activeRef.current !== 'A';
    if (B) B.muted = activeRef.current !== 'B';
    const len = selected?.clip?.lengthS || 60;
    lengthRef.current = len;
    setLengthS(len);
  }, [selected]);

  const isActiveEl = (e) => e.currentTarget === audioRefs.current[activeRef.current];
  const onDuration = (e) => {
    const d = e.currentTarget.duration;
    if (isActiveEl(e) && Number.isFinite(d) && d > 0) { lengthRef.current = d; setLengthS(d); }
  };
  const onWaiting = (e) => { if (playingRef.current && isActiveEl(e)) setBusy(true); };
  const onPlayingEvt = (e) => { if (isActiveEl(e)) setBusy(false); };
  const onAudioError = (e) => { if (isActiveEl(e)) { pauseAll(); setAudioError('This clip could not be loaded.'); } };

  const progress = lengthS > 0 ? Math.min(1, time / lengthS) : 0;
  const cutMin = selected ? minutesRemoved(selected) : null;

  const stateMessage = status === 'loading'
    ? { id: 'tape-deck-loading-state', title: 'Loading the tape rack', body: '' }
    : status === 'unavailable'
      ? { id: 'tape-deck-unavailable-state', title: 'The tape deck is unavailable right now', body: 'Nothing is wrong on your side. Try again in a moment.' }
      : { id: 'tape-deck-empty-state', title: 'No tapes processed yet', body: 'Restored mixtapes appear here with the original on deck A and the cleaned-up version on deck B.' };

  const board = status === 'ready' && selected ? (
    <>
      <div id="tape-deck-heading-row" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <span style={{ ...ui.label, letterSpacing: '0.14em' }}>Tape deck · same moment, two tapes</span>
        <h2 id="tape-deck-now-playing-title" style={{ margin: 0, fontFamily: GLASS.sans, fontWeight: 500, fontSize: isNarrow ? 20 : 26, letterSpacing: '-0.015em', color: GLASS.ink, lineHeight: 1.15, overflowWrap: 'anywhere' }}>{selected.title}</h2>
      </div>

      <div id="tape-deck-decks-row" style={{ display: 'grid', gridTemplateColumns: isNarrow ? '1fr' : '1fr 1fr', gap: isNarrow ? 14 : 28, width: '100%', maxWidth: 780 }}>
        <Cassette id="tape-deck-a" side="A" variant="original" title={selected.title} active={active === 'A'} spinning={playing && active === 'A'} progress={progress} onPress={() => switchDeck('A')} />
        <Cassette id="tape-deck-b" side="B" variant="enhanced" title={selected.title} active={active === 'B'} spinning={playing && active === 'B'} progress={progress} onPress={() => switchDeck('B')} />
      </div>

      <div id="tape-deck-transport" className="tape-deck-transport" style={isNarrow ? { gap: 10, padding: '10px 12px' } : undefined}>
        <button
          id="tape-deck-play-button" type="button" onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{ ...ui.cta, width: 46, height: 46, padding: 0, flexShrink: 0, opacity: busy && !playing ? 0.7 : 1 }}
        >
          {playing ? <Pause size={18} strokeWidth={2.5} /> : <Play size={18} strokeWidth={2.5} style={{ marginLeft: 2 }} />}
        </button>
        <input
          id="tape-deck-scrub" type="range" min={0} max={lengthS} step={0.1} value={Math.min(time, lengthS)}
          aria-label="Position in the clip" onChange={(e) => seekTo(Number(e.target.value))}
          style={{ flex: 1, minWidth: 0, accentColor: GLASS.ink }}
        />
        <span id="tape-deck-clock" className="tape-deck-clock">
          {busy ? 'loading…' : `${formatClock(time)} / ${formatClock(lengthS)}`}
        </span>
      </div>
      <div id="tape-deck-hint-row" aria-live="polite" style={{ ...ui.label, textAlign: 'center', letterSpacing: '0.06em', maxWidth: 520 }}>
        {audioError ? <span style={{ color: '#9f1f17' }}>{audioError}</span> : 'Press a deck, or keys 1 / 2, to swap tapes mid-song. Both clips are level-matched.'}
      </div>

      {[0, 1].map((i) => (
        <audio
          key={`${selected.id}-${i}`} ref={(el) => { audioRefs.current[i === 0 ? 'A' : 'B'] = el; }}
          src={i === 0 ? selected.urls.original : selected.urls.restored}
          preload="none" playsInline
          onDurationChange={onDuration} onWaiting={onWaiting} onPlaying={onPlayingEvt} onError={onAudioError}
        />
      ))}
    </>
  ) : (
    <div id={stateMessage.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', maxWidth: 420 }}>
      <div aria-hidden="true" style={{ width: 240, opacity: 0.55, filter: 'grayscale(0.4)', pointerEvents: 'none' }}>
        <Cassette id="tape-deck-ghost" side="A" variant="original" title="" active={false} spinning={false} progress={0.5} onPress={() => {}} />
      </div>
      <h2 style={{ margin: 0, fontFamily: GLASS.sans, fontWeight: 500, fontSize: 22, color: GLASS.ink }}>{stateMessage.title}</h2>
      {stateMessage.body ? <p style={{ margin: 0, fontFamily: GLASS.sans, fontSize: 13, lineHeight: 1.55, color: GLASS.inkSoft }}>{stateMessage.body}</p> : null}
      {status === 'unavailable' ? <button id="tape-deck-retry-button" type="button" style={ui.btn(false)} onClick={() => setReloadTick((n) => n + 1)}>Try again</button> : null}
    </div>
  );

  return (
    <>
      <style id="tape-deck-styles">{DECK_CSS}</style>
      <div
        id="tape-deck-shell"
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: isNarrow ? 'flex-start' : 'center', gap: isNarrow ? 14 : 22,
          boxSizing: 'border-box', padding: isNarrow ? '74px 12px 18px' : '74px 24px 24px',
          ...(isNarrow ? { position: 'relative', width: '100%', flex: 'none' } : { position: 'absolute', left: 0, top: 0, bottom: 0, right: railW, overflowY: 'auto' }),
        }}
      >
        {board}
      </div>

      <div
        id="tape-deck-rail"
        data-tooltip-disabled="true"
        style={{
          boxSizing: 'border-box', maxWidth: '100%', display: 'flex', flexDirection: 'column', background: 'transparent',
          ...(isNarrow
            ? { position: 'relative', width: '100%', flex: 'none', padding: 12 }
            : { position: 'absolute', top: 0, right: 0, bottom: 0, width: railW, padding: 14, zIndex: 10, overflowY: 'auto' }),
        }}
      >
        <div id="tape-deck-rail-inner" ref={railInnerRef} style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <RailPanel
            id="tape-deck-details-panel" title="This tape"
            subtitle={selected ? [formatPublished(selected.publishedAt), cutMin !== null ? `${cutMin} min cut` : ''].filter(Boolean).join(' · ') : 'Nothing selected'}
          >
            {selected ? (
              <>
                <span id="tape-deck-chain-label" style={{ fontFamily: GLASS.sans, fontSize: 13, color: GLASS.ink, lineHeight: 1.4 }}>{selected.chainLabel || 'Clean-up'}</span>
                <div id="tape-deck-diag-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {diagChips(selected.diag).map((chip) => <span key={chip} className="tape-deck-chip">{chip}</span>)}
                </div>
                <span style={{ ...ui.label, letterSpacing: '0.04em' }}>
                  Clip from {formatClock(selected.clip.startS)} into the trimmed mix · {Math.round(selected.clip.lengthS)} s
                </span>
              </>
            ) : <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute }}>Processed tapes show their clean-up here.</span>}
          </RailPanel>

          <RailPanel id="tape-deck-history-panel" title="History" subtitle={`${reviews.length} ${reviews.length === 1 ? 'tape' : 'tapes'}`}>
            {reviews.length === 0 ? (
              <span style={{ fontFamily: GLASS.sans, fontSize: 12, color: GLASS.inkMute, lineHeight: 1.5 }}>
                {status === 'loading' ? 'Loading…' : status === 'unavailable' ? 'Unavailable.' : 'Every tape that gets processed lands here.'}
              </span>
            ) : (
              <ul id="tape-deck-history-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {reviews.map((r) => {
                  const mins = minutesRemoved(r);
                  return (
                    <li key={r.id}>
                      <button
                        type="button" className={'tape-deck-history-item' + (r.id === selectedId ? ' tape-deck-history-item--on' : '')}
                        aria-current={r.id === selectedId ? 'true' : undefined} onClick={() => selectReview(r.id)}
                      >
                        <span className="tape-deck-history-title">{r.title}</span>
                        <span className="tape-deck-history-meta">{[formatPublished(r.publishedAt), mins !== null ? `${mins} min cut` : '', r.chainLabel].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </RailPanel>
        </div>
      </div>
    </>
  );
}

const DECK_CSS = `
  #tape-deck-rail, #tape-deck-rail * { box-sizing: border-box; }
  .studio-rail-card {
    position: relative; border-radius: 1rem; overflow: hidden; background: rgba(255,255,255,0.35);
    backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);
  }
  .studio-rail-card::before {
    content: ''; position: absolute; inset: 0; border-radius: 1rem; padding: 1px; background: rgba(176,176,182,0.6);
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude;
    pointer-events: none; opacity: 0.85;
  }
  .studio-rail-card-content { position: relative; z-index: 1; }
  .tape-deck-transport {
    display: flex; align-items: center; gap: 14px; width: 100%; max-width: 560px; box-sizing: border-box; padding: 10px 16px; border-radius: 999px;
    background: rgba(255,255,255,0.55); border: 1px solid ${GLASS.hair}; box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  }
  .tape-deck-clock { font-family: ${GLASS.mono}; font-size: 12px; font-weight: 600; color: ${GLASS.ink}; min-width: 82px; text-align: right; font-variant-numeric: tabular-nums; }
  .tape-deck-cassette {
    display: flex; flex-direction: column; gap: 8px; padding: 10px 10px 12px; border-radius: 20px; cursor: pointer; text-align: left;
    background: rgba(255,255,255,0.4); border: 1px solid ${GLASS.hair}; color: ${GLASS.ink}; min-width: 0;
    opacity: 0.78; transform: translateY(3px) scale(0.985);
    transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16,1,0.3,1), box-shadow 0.2s ease, border-color 0.2s ease;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  }
  .tape-deck-cassette:focus-visible { outline: 2px solid ${GLASS.ink}; outline-offset: 2px; }
  .tape-deck-cassette--active { opacity: 1; transform: none; border-color: ${GLASS.ink}; box-shadow: 0 10px 28px rgba(0,0,0,0.16); }
  @media (hover: hover) { .tape-deck-cassette:not(.tape-deck-cassette--active):hover { opacity: 0.95; } }
  .tape-deck-cassette-foot { display: flex; align-items: center; gap: 8px; padding: 0 4px; font-size: 11px; }
  .tape-deck-cassette-name { font-weight: 700; letter-spacing: 0.08em; }
  .tape-deck-cassette-caption { margin-left: auto; color: ${GLASS.inkMute}; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; }
  .tape-deck-led { width: 8px; height: 8px; border-radius: 50%; background: #c9c5bb; flex-shrink: 0; }
  .tape-deck-led--on { background: #e0463a; box-shadow: 0 0 8px rgba(224,70,58,0.7); }
  .tape-deck-reel--spinning { animation: tape-deck-reel-spin 1.5s linear infinite; }
  @keyframes tape-deck-reel-spin { to { transform: rotate(360deg); } }
  .tape-deck-chip { font-family: ${GLASS.mono}; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; color: ${GLASS.inkSoft}; background: rgba(255,255,255,0.7); border: 1px solid ${GLASS.hair}; border-radius: 999px; padding: 3px 9px; }
  .tape-deck-history-item {
    width: 100%; display: flex; flex-direction: column; gap: 3px; text-align: left; cursor: pointer; padding: 10px 12px; border-radius: 12px;
    background: rgba(255,255,255,0.5); border: 1px solid ${GLASS.hair}; font-family: ${GLASS.sans}; min-width: 0;
    transition: background 0.18s ease, border-color 0.18s ease; -webkit-tap-highlight-color: transparent;
  }
  .tape-deck-history-item--on { background: #fff; border-color: ${GLASS.ink}; }
  .tape-deck-history-item:focus-visible { outline: 2px solid ${GLASS.ink}; outline-offset: 2px; }
  .tape-deck-history-title { font-size: 13px; font-weight: 600; color: ${GLASS.ink}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tape-deck-history-meta { font-family: ${GLASS.mono}; font-size: 10px; letter-spacing: 0.03em; color: ${GLASS.inkMute}; line-height: 1.4; }
  @media (prefers-reduced-motion: reduce) {
    .tape-deck-reel--spinning { animation: none; }
    .tape-deck-cassette, .tape-deck-history-item { transition: none; }
  }
`;
