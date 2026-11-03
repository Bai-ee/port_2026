'use client';

// Top-nav text CTA shared by the homepage (Header.jsx) and the dashboard header: a resting label (HUMAN? / CLIENTS)
// that, on desktop hover/focus, scrambles into what the click does (ENTER / LOGOUT) with an arrow in the last cell,
// and scrambles back on leave. Touch screens get no scramble: the label is static (`touchLabel`) and a tap just acts.
//
// Rest and reveal labels share one row of fixed-width cells (Doto is monospaced), so the swap never changes the
// word's width. Text is written to the DOM directly (never React state) so the scramble's writes can't desync
// React's text nodes.

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import PixelArrow from '../PixelArrow';
import { scrambleInkAt } from './scrambleInk';
import { scrambleTextTo } from './scrambleText';

const CTA_SCRAMBLE_MS = 420;
// Scrambled glyphs run a gradient across the cells (--t-scramble-ink-a -> -b, styles/theme/bridge.css); text colour
// on any letter. Theme tokens, so dark mode follows.
const CTA_SCRAMBLE_INK = ['var(--t-scramble-ink-a)', 'var(--t-scramble-ink-b)'];
const CTA_REVEAL_COLOR = 'var(--t-text)';
// The shared scramble set is mostly '_', which reads as an underline on a single short word — symbols only here.
// No '?': labels may end in one ('HUMAN?').
const CTA_SCRAMBLE_POOL = '!<>-\\/[]{}=+*^#';
// The pool holds no letters or '?', so one of those (or the empty arrow cell) means the cell has settled.
const isSettledGlyph = (ch) => !ch || /[A-Za-z\s?]/.test(ch);
// Doto at its heaviest cut; the stroke (currentColor) fattens the dots to match the arrow. Paint-only.
const CTA_STROKE_PX = 0.5;
const ctaLabelStyle = { fontFamily: "'Doto', 'Space Mono', monospace", fontWeight: 900, WebkitTextStroke: `${CTA_STROKE_PX}px currentColor`, paintOrder: 'stroke fill' };
// The arrow is sized in em; the label is 0.84rem (colors.css #founders-chat-cta), so its stroke in em is this.
const CTA_STROKE_EM = CTA_STROKE_PX / 13.44;
// Desktop pointer only; touch screens never scramble.
const HOVER_MEDIA_QUERY = '(hover: hover) and (pointer: fine)';

/**
 * @param {string} restLabel   resting text, server-rendered (e.g. 'HUMAN?', 'CLIENTS')
 * @param {string} revealLabel what a click does, padded so its last cell is the arrow slot (e.g. 'ENTER ', 'LOGOUT')
 * @param {string} [touchLabel] static label on touch screens (default: restLabel)
 * The row holds the longer of rest/reveal; a shorter rest label is padded on the left, so it stays right-aligned
 * and a longer reveal grows leftward.
 */
export default function ScrambleCta({ restLabel, revealLabel, touchLabel = restLabel, onClick, ariaLabel, id = 'founders-chat-cta' }) {
  const cellCount = Math.max(restLabel.length, revealLabel.length);
  const arrowCell = cellCount - 1;
  const leadPad = ' '.repeat(cellCount - restLabel.length);
  const fitCells = (text) => `${leadPad}${text}`.padEnd(cellCount).slice(0, cellCount);
  const restTarget = fitCells(restLabel);
  const revealTarget = revealLabel.padEnd(cellCount).slice(0, cellCount);
  const labelRefs = useRef([]);
  const arrowRef = useRef(null);
  const cancelRef = useRef([]);
  const hoverRef = useRef(false);

  const cellsOf = (node) => Array.from(node.children);
  const inkAt = (cell) => scrambleInkAt(cell, cellCount, CTA_SCRAMBLE_INK[0], CTA_SCRAMBLE_INK[1]);

  // Every cell pins to the glyph width; the arrow slot takes the last cell's width and centres the arrow in it
  // (the arrow is narrower than a glyph advance). Re-run on resize (the font size changes at the mobile
  // breakpoint); the hidden label measures 0 and is left alone until it is the visible one.
  const pinCells = () => {
    labelRefs.current.forEach((node) => {
      if (!node || node.getBoundingClientRect().width === 0) return;
      const cells = cellsOf(node);
      // Measure a cell holding a glyph; leading pad cells are blank.
      const probe = cells.find((cell) => (cell.textContent || '').trim()) || cells[cells.length - 1];
      probe.style.width = '';
      const glyphWidth = probe.getBoundingClientRect().width;
      if (!glyphWidth) return;
      cells.forEach((cell) => { cell.style.width = `${glyphWidth}px`; });
      if (arrowRef.current) arrowRef.current.style.width = `${glyphWidth}px`;
    });
  };

  const writeCells = (text) => {
    labelRefs.current.filter(Boolean).forEach((node) => {
      cellsOf(node).forEach((cell, c) => { cell.textContent = text[c] ?? ''; cell.style.color = CTA_REVEAL_COLOR; });
    });
  };

  useLayoutEffect(() => {
    const mq = window.matchMedia?.(HOVER_MEDIA_QUERY);
    const sync = () => {
      hoverRef.current = !!mq?.matches;
      cancelRef.current.forEach((cancel) => cancel());
      cancelRef.current = [];
      if (arrowRef.current) arrowRef.current.style.opacity = '0';
      writeCells(hoverRef.current ? restTarget : fitCells(touchLabel));
      pinCells();
    };
    sync();
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) pinCells(); });
    window.addEventListener('resize', pinCells);
    mq?.addEventListener?.('change', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', pinCells);
      mq?.removeEventListener?.('change', sync);
    };
    // Labels are fixed per mount (the page decides them); a change re-renders the cells below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restLabel, touchLabel, cellCount]);

  // Scrambles every label from whatever it shows now to `target`, cancelling any sweep in flight. scrambleTextTo
  // locks left to right, so `rightToLeft` hands it the cells (and the target) reversed.
  const scrambleTo = (target, { rightToLeft = false, onDone } = {}) => {
    cancelRef.current.forEach((cancel) => cancel());
    cancelRef.current = [];
    labelRefs.current.filter(Boolean).forEach((node, i) => {
      const labelCells = cellsOf(node);
      const cells = rightToLeft ? [...labelCells].reverse() : labelCells;
      // scrambleTextTo only reads/writes textContent; this stand-in spreads each frame across the cells.
      const cellText = {
        get textContent() { return cells.map((cell) => cell.textContent || ' ').join(''); },
        set textContent(value) {
          cells.forEach((cell, c) => {
            const ch = value[c] ?? '';
            cell.textContent = ch;
            cell.style.color = isSettledGlyph(ch) ? CTA_REVEAL_COLOR : inkAt(labelCells.indexOf(cell));
          });
        },
      };
      cancelRef.current.push(scrambleTextTo(cellText, rightToLeft ? [...target].reverse().join('') : target, {
        durationMs: CTA_SCRAMBLE_MS,
        charPool: CTA_SCRAMBLE_POOL,
        onComplete: i === 0 ? onDone : undefined,
      }));
    });
  };

  const play = () => {
    if (!hoverRef.current) return;
    pinCells();
    // The arrow sits in the last cell, so that cell resolves to blank.
    scrambleTo(`${revealTarget.slice(0, arrowCell)} `, {
      onDone: () => { if (arrowRef.current) arrowRef.current.style.opacity = '1'; },
    });
  };

  const reverse = () => {
    if (!hoverRef.current) return;
    if (arrowRef.current) arrowRef.current.style.opacity = '0';
    scrambleTo(restTarget, { rightToLeft: true });
  };

  useEffect(() => () => cancelRef.current.forEach((cancel) => cancel()), []);

  const cells = restTarget.split('').map((char, i) => (
    <span key={i} aria-hidden="true" style={{ display: 'inline-block', textAlign: 'center', whiteSpace: 'pre', color: CTA_REVEAL_COLOR }}>{char}</span>
  ));

  return (
    <button
      type="button"
      id={id}
      aria-label={ariaLabel}
      className="founders-chat-cta--light"
      onClick={onClick}
      onMouseEnter={play}
      onMouseLeave={reverse}
      onFocus={play}
      onBlur={reverse}
      style={{ position: 'relative' }}
    >
      <span ref={(node) => { labelRefs.current[0] = node; }} id={`${id}-label-full-cells`} className="founders-chat-label-full" style={ctaLabelStyle}>{cells}</span>
      <span ref={(node) => { labelRefs.current[1] = node; }} id={`${id}-label-short-cells`} className="founders-chat-label-short" style={ctaLabelStyle}>{cells}</span>
      {/* Absolutely placed over the label's last (arrow) cell, so revealing it never shifts the label. */}
      <span
        ref={arrowRef}
        id={`${id}-arrow-slot`}
        aria-hidden="true"
        style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', display: 'flex', justifyContent: 'center', lineHeight: 0, opacity: 0, transition: 'opacity 160ms ease-out', pointerEvents: 'none' }}
      >
        <PixelArrow id={`${id}-icon`} strokeEm={CTA_STROKE_EM} />
      </span>
    </button>
  );
}
