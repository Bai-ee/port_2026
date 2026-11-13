'use client';

import { useEffect, useRef, useState } from 'react';
import '@/features/playroom/styles/game.css';

export default function PlayroomClient() {
  const mountRef = useRef(null);
  const gameRef = useRef(null);
  const [pct, setPct] = useState(0);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.documentElement.classList.add('playroom-active');
    return () => document.documentElement.classList.remove('playroom-active');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Browser-only import keeps Pixi out of SSR and other pages' bundles.
        const { Game } = await import('@/features/playroom/Game');
        const game = await Game.create(mountRef.current, (p) => {
          if (!cancelled) setPct(Math.round(p * 100));
        });
        if (cancelled) {
          game.destroy();
          return;
        }
        gameRef.current = game;
        setPct(100);
        setMuted(game.muted);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, []);

  const play = () => {
    gameRef.current?.start();
    setStarted(true);
  };

  return (
    <div id="playroom-root" style={{ position: 'fixed', inset: 0, zIndex: 2147483000 }}>
      <div id="playroom-game" ref={mountRef} />
      <div id="playroom-hud" hidden={!started}>
        <button id="playroom-reset-btn" className="hud-btn" type="button" aria-label="Reset room" onClick={() => gameRef.current?.reset()}>↻</button>
        <button id="playroom-mute-btn" className="hud-btn" type="button" aria-label="Toggle sound" onClick={() => gameRef.current && setMuted(gameRef.current.toggleMute())}>{muted ? '🔇' : '🔊'}</button>
      </div>
      <div id="playroom-loading" hidden={started} className={error ? 'error' : undefined}>
        <h1>Playroom</h1>
        <div id="playroom-progress"><div id="playroom-progress-bar" style={{ width: pct + '%' }} /></div>
        <p id="playroom-loading-text" hidden={ready && !error}>{error ? 'Could not start: ' + error : 'Loading...'}</p>
        <button id="playroom-play-btn" type="button" hidden={!ready || !!error} onClick={play}>Play</button>
      </div>
      <div id="playroom-rotate"><div className="rotate-icon">↻</div><p>Please rotate your device<br />to landscape</p></div>
    </div>
  );
}
