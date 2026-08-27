'use client';

import React, { useEffect, useRef } from 'react';

// Schematic measurement lines between the hero loop and the cursor.
//
// Reads two mutable refs and never re-renders: `silhouetteRef` (screen-space
// outline anchors written every frame by ox.jsx's ParticleSwarm) and
// `cursorStageRef` (the churn/reveal clock written by HeroHeadline). The point
// is to make the subheadline's phrase change read as a reading being taken off
// the object rather than a text animation that happens nearby — so the lines
// live while the cursor moves, then retract into the cursor over exactly the
// span of the scramble that resolves the phrase.
//
// Draws on a 2D canvas fixed to the viewport, matching ox.jsx's own fixed
// full-viewport canvas so the anchor pixel coordinates line up at any scroll
// position.

const LINE_COUNT = 6;         // anchors wired to the cursor at once
const MIN_BIN_GAP = 2;        // bins to skip between picks, so the fan spreads
const CURSOR_GAP_PX = 11;     // clear space before the crosshair
const STUB_PX = 7;            // leader past the anchor, away from the object
const TICK_PX = 4;            // cross-tick at the anchor
const CROSS_PX = 9;           // crosshair arm length
const CHURN_ALPHA = 0.3;      // line strength while the cursor is moving
const LOCK_ALPHA = 0.85;      // flash strength the instant the phrase locks
const RING_MS = 240;          // expanding ring at the cursor on lock
const RING_FROM = 6;
const RING_TO = 24;
const FADE_PER_MS = 1 / 180;  // idle fade-out rate

// Matches the subheadline's own reveal ease (easeOutQuart in scrambleText):
// the lines leave the rim hard and coast into the cursor, so the retract and
// the character locking carry the same weight.
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const easeOutQuart = (t) => 1 - (1 - t) ** 4;

// Hex (#rgb or #rrggbb) to "r, g, b" so alpha can be varied per stroke.
const toRgbTriplet = (hex) => {
  const raw = String(hex).replace('#', '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const int = Number.parseInt(full, 16);
  if (!Number.isFinite(int)) return '42, 36, 32';
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
};

const HeroSchematicOverlay = ({
  silhouetteRef,
  cursorStageRef,
  heroProgressRef = null,
  color = '#2a2420',
}) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !silhouetteRef || !cursorStageRef) return undefined;

    // Fine-pointer only: the whole effect is a cursor readout, and the
    // subheadline falls back to its timed cycle on touch anyway.
    const finePointer =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!finePointer || prefersReducedMotion) return undefined;

    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const rgb = toRgbTriplet(color);
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Reused across frames so the draw loop allocates nothing.
    const picked = new Int16Array(LINE_COUNT);
    const order = new Int16Array(64);
    const dist = new Float32Array(64);

    let alpha = 0;
    let lastFrame = performance.now();
    let dirty = false;
    let rafId = 0;

    const clear = () => {
      ctx.clearRect(0, 0, width, height);
      dirty = false;
    };

    const draw = (now) => {
      rafId = requestAnimationFrame(draw);
      const dt = Math.min(now - lastFrame, 64);
      lastFrame = now;

      const stage = cursorStageRef.current;
      const shape = silhouetteRef.current;
      // Hero scrolled away — the object is gone, so is the readout.
      const heroVisible = !heroProgressRef || (heroProgressRef.current ?? 0) < 0.55;

      let targetAlpha = 0;
      let retract = 0;
      let ringT = 1;

      if (stage && stage.seen && shape && shape.valid && heroVisible && !document.hidden) {
        if (stage.phase === 'churn') {
          targetAlpha = CHURN_ALPHA;
        } else if (stage.phase === 'reveal') {
          // One clock with the scramble: the lines pull into the cursor as the
          // characters lock, and land at zero on the same frame the phrase does.
          const span = stage.revealMs || 1;
          const p = Math.min(Math.max((now - stage.revealAt) / span, 0), 1);
          retract = easeOutQuint(p);
          // Alpha holds through the fast part of the retract and drops late,
          // so the lines read as pulled in rather than faded out.
          targetAlpha = LOCK_ALPHA * (1 - easeOutQuart(p) ** 0.6);
          ringT = Math.min((now - stage.revealAt) / RING_MS, 1);
        }
      }

      // Rise instantly (the readout should feel like it snaps to the cursor),
      // fall on a short fade so an idle stage doesn't cut to black.
      alpha = targetAlpha > alpha ? targetAlpha : Math.max(targetAlpha, alpha - dt * FADE_PER_MS);

      if (alpha <= 0.002) {
        if (dirty) clear();
        return;
      }

      ctx.clearRect(0, 0, width, height);
      dirty = true;

      const { points, radii, bins } = shape;
      const cursorX = stage.x;
      const cursorY = stage.y;

      // Rank the live bins by screen distance to the cursor, then take the
      // nearest few while forcing a gap between bin indices — otherwise every
      // line leaves the same spot on the rim and the fan collapses.
      let live = 0;
      for (let b = 0; b < bins && live < order.length; b++) {
        if (radii[b] < 0) continue;
        const dx = points[b * 2] - cursorX;
        const dy = points[b * 2 + 1] - cursorY;
        order[live] = b;
        dist[live] = dx * dx + dy * dy;
        live += 1;
      }
      if (live === 0) return;

      for (let i = 1; i < live; i++) {
        const bin = order[i];
        const d = dist[i];
        let j = i - 1;
        while (j >= 0 && dist[j] > d) {
          order[j + 1] = order[j];
          dist[j + 1] = dist[j];
          j -= 1;
        }
        order[j + 1] = bin;
        dist[j + 1] = d;
      }

      let count = 0;
      for (let i = 0; i < live && count < LINE_COUNT; i++) {
        const bin = order[i];
        let ok = true;
        for (let k = 0; k < count; k++) {
          // Circular distance, so bin 0 and bin 23 count as neighbours.
          const gap = Math.abs(bin - picked[k]);
          if (Math.min(gap, bins - gap) < MIN_BIN_GAP) { ok = false; break; }
        }
        if (ok) { picked[count] = bin; count += 1; }
      }

      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';

      for (let k = 0; k < count; k++) {
        const bin = picked[k];
        let ax = points[bin * 2];
        let ay = points[bin * 2 + 1];

        // Outward normal at the anchor — the direction the leader stub points.
        const ox = ax - shape.cx;
        const oy = ay - shape.cy;
        const olen = Math.hypot(ox, oy) || 1;
        const onx = ox / olen;
        const ony = oy / olen;

        if (retract > 0) {
          ax += (cursorX - ax) * retract;
          ay += (cursorY - ay) * retract;
        }

        const dx = cursorX - ax;
        const dy = cursorY - ay;
        const len = Math.hypot(dx, dy);
        if (len < CURSOR_GAP_PX + 2) continue;
        const ux = dx / len;
        const uy = dy / len;
        const endX = cursorX - ux * CURSOR_GAP_PX;
        const endY = cursorY - uy * CURSOR_GAP_PX;

        ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Anchor furniture reads as a measurement point, not a line ending:
        // a short stub continuing off the object plus a perpendicular tick.
        ctx.strokeStyle = `rgba(${rgb}, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + onx * STUB_PX, ay + ony * STUB_PX);
        ctx.moveTo(ax - ony * TICK_PX, ay + onx * TICK_PX);
        ctx.lineTo(ax + ony * TICK_PX, ay - onx * TICK_PX);
        ctx.stroke();
      }

      // Cursor crosshair — the instrument end of the readout.
      ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(cursorX - CROSS_PX, cursorY);
      ctx.lineTo(cursorX - 3, cursorY);
      ctx.moveTo(cursorX + 3, cursorY);
      ctx.lineTo(cursorX + CROSS_PX, cursorY);
      ctx.moveTo(cursorX, cursorY - CROSS_PX);
      ctx.lineTo(cursorX, cursorY - 3);
      ctx.moveTo(cursorX, cursorY + 3);
      ctx.lineTo(cursorX, cursorY + CROSS_PX);
      ctx.stroke();

      // Lock pulse: one ring leaving the cursor as the phrase resolves.
      if (ringT < 1) {
        const r = RING_FROM + (RING_TO - RING_FROM) * easeOutQuint(ringT);
        ctx.strokeStyle = `rgba(${rgb}, ${(1 - ringT) * 0.45})`;
        ctx.beginPath();
        ctx.arc(cursorX, cursorY, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    };

    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [color, cursorStageRef, heroProgressRef, silhouetteRef]);

  return (
    <canvas
      id="hero-schematic-overlay"
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100dvh',
        // Above ox.jsx's canvas (1) and #hero-gradient-overlay (2), below the
        // hero glass panels (100).
        zIndex: 3,
        pointerEvents: 'none',
      }}
    />
  );
};

export default HeroSchematicOverlay;
