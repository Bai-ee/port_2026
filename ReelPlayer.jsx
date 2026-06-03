'use client';
import { useRef, useState, useCallback, useEffect } from 'react';

const GRADIENT_BG =
  'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), ' +
  'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)';

export default function ReelPlayer() {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const progressRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  const scheduleHide = useCallback(() => {
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowControls(false), 2800);
  }, []);

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (playing) scheduleHide();
  }, [playing, scheduleHide]);

  useEffect(() => {
    if (playing) scheduleHide();
    else { clearTimeout(hideTimerRef.current); setShowControls(true); }
    return () => clearTimeout(hideTimerRef.current);
  }, [playing, scheduleHide]);

  // Scroll lock + nav disable while playing
  useEffect(() => {
    document.body.classList.toggle('reel-playing', playing);
    document.body.style.overflow = playing ? 'hidden' : '';
    return () => {
      document.body.classList.remove('reel-playing');
      document.body.style.overflow = '';
    };
  }, [playing]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }, []);

  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress(v.currentTime / v.duration);
  }, []);

  const onLoadedMetadata = useCallback(() => {
    setDuration(videoRef.current?.duration || 0);
  }, []);

  const onEnded = useCallback(() => {
    setPlaying(false);
    setProgress(0);
  }, []);

  const seek = useCallback((e) => {
    e.stopPropagation();
    const bar = progressRef.current;
    if (!bar || !videoRef.current) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    videoRef.current.currentTime = ratio * (videoRef.current.duration || 0);
    setProgress(ratio);
  }, []);

  const toggleFullscreen = useCallback((e) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen().then(() => setFullscreen(true)).catch(() => {});
    else document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const fmt = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  const currentTime = duration ? progress * duration : 0;

  return (
    <>
      {/* theater dimmer — click outside the player stops playback */}
      <div
        id="reel-theater-dimmer"
        onClick={() => { if (playing) togglePlay(); }}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.62)',
          zIndex: 99,
          opacity: playing ? 1 : 0,
          pointerEvents: playing ? 'auto' : 'none',
          cursor: 'pointer',
          transition: 'opacity 0.6s ease',
        }}
      />

      <div
        ref={containerRef}
        id="reel-player-shell"
        onMouseMove={revealControls}
        onMouseEnter={revealControls}
        onTouchStart={revealControls}
        style={{
          position: 'relative',
          width: 'min(calc(100vw - 2rem), 640px)',
          margin: '0 auto',
          borderRadius: 'clamp(10px, 2vw, 20px)',
          overflow: 'hidden',
          background: fullscreen ? '#000000' : '#ffffff',
          border: '2px solid rgba(42,36,32,0.1)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.05)',
          cursor: playing && !showControls ? 'none' : 'pointer',
          aspectRatio: '16 / 9',
          zIndex: playing ? 100 : 'auto',
        }}
        onClick={togglePlay}
      >
        <video
          ref={videoRef}
          src="/vid/reel.optimized.mp4"
          poster="/vid/reel.poster.jpg"
          muted
          playsInline
          preload="metadata"
          onTimeUpdate={onTimeUpdate}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          style={{ width: '100%', height: '100%', objectFit: fullscreen ? 'contain' : 'cover', display: 'block' }}
        />

        {/* centered gradient play button — visible when paused */}
        <div
          id="reel-play-overlay"
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: playing ? 0 : 1,
            transition: 'opacity 0.3s ease',
            pointerEvents: playing ? 'none' : 'auto',
          }}
        >
          <button
            id="reel-big-play-btn"
            className="cta-pill-btn"
            aria-label="Play reel"
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            style={{
              width: 'clamp(60px, 8vw, 84px)',
              height: 'clamp(60px, 8vw, 84px)',
              borderRadius: '50%',
              background: GRADIENT_BG,
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.28)',
              flexShrink: 0,
              padding: 0,
            }}
          >
            <svg
              width="34%" height="34%"
              viewBox="0 0 24 24"
              fill="#ffffff"
              style={{ marginLeft: '8%', display: 'block' }}
            >
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </button>
        </div>

        {/* controls bar */}
        <div
          id="reel-controls-bar"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: 'clamp(10px, 2vw, 20px) clamp(12px, 2.5vw, 24px) clamp(10px, 1.5vw, 16px)',
            background: 'linear-gradient(to top, rgba(255,255,255,0.92) 0%, transparent 100%)',
            display: 'flex', flexDirection: 'column', gap: 'clamp(6px, 1vw, 10px)',
            opacity: showControls && playing ? 1 : 0,
            transition: 'opacity 0.35s ease',
            pointerEvents: showControls && playing ? 'auto' : 'none',
          }}
        >
          {/* progress */}
          <div
            ref={progressRef}
            id="reel-progress-bar"
            onClick={seek}
            style={{
              width: '100%', height: '3px',
              background: 'rgba(42,36,32,0.15)',
              borderRadius: '2px', cursor: 'pointer', position: 'relative',
            }}
          >
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${progress * 100}%`,
              background: GRADIENT_BG,
              borderRadius: '2px',
              transition: 'width 0.1s linear',
            }} />
            <div style={{
              position: 'absolute', top: '50%', left: `${progress * 100}%`,
              transform: 'translate(-50%, -50%)',
              width: '10px', height: '10px', borderRadius: '50%',
              background: 'hsl(262,100%,55%)',
              boxShadow: '0 0 4px rgba(0,0,0,0.2)',
            }} />
          </div>

          {/* buttons row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(8px, 1.5vw, 14px)' }}>
            {/* pause */}
            <button
              id="reel-pause-btn"
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              aria-label="Pause"
              style={{ ...darkBtnStyle }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#2a2420">
                <rect x="5" y="3" width="4" height="18" rx="1" />
                <rect x="15" y="3" width="4" height="18" rx="1" />
              </svg>
            </button>

            {/* time */}
            <span style={{
              fontFamily: "'Space Mono', monospace",
              fontSize: 'clamp(9px, 1vw, 11px)',
              color: 'rgba(42,36,32,0.55)',
              letterSpacing: '0.04em',
              flex: 1,
            }}>
              {fmt(currentTime)} / {fmt(duration)}
            </span>

            {/* fullscreen */}
            <button
              id="reel-fullscreen-btn"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{ ...darkBtnStyle }}
            >
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a2420" strokeWidth="1.8" strokeLinecap="round">
                  <polyline points="8,3 3,3 3,8" /><polyline points="21,8 21,3 16,3" />
                  <polyline points="3,16 3,21 8,21" /><polyline points="16,21 21,21 21,16" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a2420" strokeWidth="1.8" strokeLinecap="round">
                  <polyline points="15,3 21,3 21,9" /><polyline points="9,21 3,21 3,15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const darkBtnStyle = {
  background: 'none',
  border: 'none',
  padding: '4px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  opacity: 0.75,
  flexShrink: 0,
};
