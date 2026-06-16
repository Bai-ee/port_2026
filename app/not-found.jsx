'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { createSharedParticleGalleryRenderer } from '../sharedParticleGalleryRenderer';

const MARQUEE_TEXT = '404 · 404 · 404 · 404 · 404 · 404 · ';

export default function NotFound() {
  const shellRef = useRef(null);
  const canvasRef = useRef(null);
  const particleWindowRef = useRef(null);

  useEffect(() => {
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    const particleWindow = particleWindowRef.current;
    if (!shell || !canvas || !particleWindow) return undefined;

    const renderer = createSharedParticleGalleryRenderer({
      canvas,
      container: shell,
      getWindows: () => [particleWindow],
      params: {
        particleCount: 1500,
        scale: 31,
        flow: 0.28,
        speedMult: 0.16,
        hueSpeed: 0.045,
        animationSpeed: 1.08,
        saturation: 0.84,
        lightness: 0.68,
      },
    });

    let frameId = 0;
    const renderFrame = (time) => {
      renderer.render(time * 0.001);
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const stop = () => {
      if (!frameId) return;
      window.cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const start = () => {
      if (frameId || document.hidden) return;
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      start();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', handleVisibility);
      renderer.dispose();
    };
  }, []);

  return (
    <main ref={shellRef} className="not-found-page" aria-labelledby="not-found-title">
      <canvas ref={canvasRef} className="not-found-particles" aria-hidden="true" />
      <div ref={particleWindowRef} className="not-found-particle-window" aria-hidden="true" />

      <section className="not-found-marquee" aria-label="404">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className={`not-found-marquee-track ${row === 1 ? 'is-reverse' : ''}`}
            aria-hidden={row > 0 ? 'true' : undefined}
          >
            <span>{MARQUEE_TEXT}</span>
            <span>{MARQUEE_TEXT}</span>
          </div>
        ))}
      </section>

      <div className="not-found-copy">
        <p id="not-found-title">Page not found.</p>
        <nav aria-label="404 recovery links">
          <Link href="/">Home</Link>
          <Link href="/dashboard">Dashboard</Link>
        </nav>
      </div>

      <style jsx>{`
        .not-found-page {
          position: relative;
          min-height: 100svh;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f5f1df;
          color: #2a2420;
          isolation: isolate;
        }

        .not-found-particles {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 1;
          pointer-events: none;
          filter: brightness(1.08) contrast(1.1);
          opacity: 0.88;
        }

        .not-found-particle-window {
          position: absolute;
          inset: max(6vh, 36px) max(4vw, 18px);
          z-index: 0;
          pointer-events: none;
        }

        .not-found-marquee {
          position: relative;
          z-index: 2;
          width: 100%;
          display: grid;
          gap: clamp(0.2rem, 1vw, 0.65rem);
          padding: clamp(3rem, 8vw, 7rem) 0;
          mask-image: linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%);
        }

        .not-found-marquee-track {
          display: flex;
          width: max-content;
          will-change: transform;
          animation: not-found-marquee 15s linear infinite;
        }

        .not-found-marquee-track.is-reverse {
          animation-direction: reverse;
          animation-duration: 18s;
          opacity: 0.78;
        }

        .not-found-marquee-track span {
          flex: 0 0 auto;
          white-space: nowrap;
          font-family: "Doto", "Space Mono", monospace;
          font-size: clamp(7rem, 30vw, 25rem);
          font-weight: 900;
          line-height: 0.72;
          letter-spacing: 0;
          color: #2a2420;
          text-transform: uppercase;
        }

        .not-found-copy {
          position: absolute;
          z-index: 3;
          left: clamp(1rem, 3vw, 2rem);
          right: clamp(1rem, 3vw, 2rem);
          bottom: clamp(1rem, 3vw, 2rem);
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 1rem;
          font-family: "Space Mono", monospace;
          text-transform: uppercase;
          font-size: clamp(0.72rem, 1.5vw, 0.88rem);
        }

        .not-found-copy p {
          margin: 0;
        }

        .not-found-copy nav {
          display: flex;
          gap: clamp(0.75rem, 2vw, 1.25rem);
        }

        .not-found-copy a {
          color: #2a2420;
          text-decoration: none;
          border-bottom: 1px solid currentColor;
          padding-bottom: 0.15rem;
        }

        .not-found-copy a:focus-visible {
          outline: 2px solid #2a2420;
          outline-offset: 0.35rem;
        }

        @keyframes not-found-marquee {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-50%, 0, 0); }
        }

        @media (max-width: 720px) {
          .not-found-marquee {
            gap: 0.45rem;
          }

          .not-found-marquee-track span {
            font-size: clamp(6.2rem, 42vw, 12rem);
          }

          .not-found-copy {
            align-items: flex-start;
            flex-direction: column;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .not-found-marquee-track {
            animation-duration: 45s;
          }
        }
      `}</style>
    </main>
  );
}
