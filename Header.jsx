import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from './AuthContext';
import UpRightArrow from './components/UpRightArrow';
import { scrambleTextTo } from './components/home/scrambleText';
import { getPrefStore } from './lib/theme-runtime/pref-store.js';

// Trailing space is the gap cell between the word and the arrow cell.
const CTA_LABEL = 'LOGIN ';
// Homepage logo light/dark switch: <html> carries this attribute for the length of the colour ease.
const THEME_FADE_ATTR = 'data-theme-fading';
const THEME_FADE_MS = 600;

// The palette ease animates the theme tokens themselves rather than every element (per-element transitions lag on
// inherited colour and then snap). Each --t-* token whose value is a colour is registered once as a <color>
// custom property, so a transition on <html> interpolates it and every var() user follows in step.
let themeColorTokens = null;
function registerThemeColorTokens(root) {
  if (themeColorTokens) return themeColorTokens;
  themeColorTokens = [];
  if (typeof CSS === 'undefined' || typeof CSS.registerProperty !== 'function') return themeColorTokens;
  const style = getComputedStyle(root);
  for (let i = 0; i < style.length; i += 1) {
    const name = style[i];
    if (!name.startsWith('--t-')) continue;
    const value = style.getPropertyValue(name).trim();
    if (!value || !CSS.supports('color', value)) continue;
    try {
      CSS.registerProperty({ name, syntax: '<color>', inherits: true, initialValue: 'transparent' });
      themeColorTokens.push(name);
    } catch { /* already registered elsewhere: leave it out of the ease */ }
  }
  return themeColorTokens;
}
// Resting label (server-rendered, so it matches on hydration). Seven cells: one per
// LOGIN letter, one for the gap and one for the arrow slot, so "CLIENTS" is exactly
// as wide as the revealed "LOGIN ↗" — the same rest → CTA swap as the hero line.
const CTA_REST_LABEL = 'CLIENTS';
const CTA_ARROW_CELL = CTA_REST_LABEL.length - 1;
const CTA_SCRAMBLE_MS = 420;
// Pink while scrambled, text colour on any letter (resting CLIENTS or locked LOGIN); theme tokens, so dark mode follows.
const CTA_MASK_COLOR = 'var(--t-accent)';
const CTA_REVEAL_COLOR = 'var(--t-text)';
// The shared scramble set is mostly '_', which reads as an underline on a
// single short word — this label churns through symbols only.
const CTA_SCRAMBLE_POOL = '!<>-\\/[]{}=+*^?#';
// The pool holds no letters, so a letter (or the empty arrow cell) means the cell has settled.
const isSettledGlyph = (ch) => !ch || /[A-Za-z\s]/.test(ch);
// Doto (the HELLO marquee face, loaded in app/layout.jsx) at its heaviest
// weight — monospaced, so the scramble glyphs share the letters' width.
// 900 is Doto's heaviest cut; the text stroke (currentColor, so it follows the
// pink → text colour swap) fattens the dots to match the arrow's 2.75 stroke.
// Paint-only: it never changes the cells' widths.
const ctaLabelStyle = { fontFamily: "'Doto', 'Space Mono', monospace", fontWeight: 900, WebkitTextStroke: '0.5px currentColor', paintOrder: 'stroke fill' };
// One centred inline-block cell per character; Header pins each cell's width.
const ctaLabelCells = CTA_REST_LABEL.split('').map((char, i) => (
  <span key={i} aria-hidden="true" style={{ display: 'inline-block', textAlign: 'center', whiteSpace: 'pre', color: CTA_REVEAL_COLOR }}>{char}</span>
));

// `actions` is an optional right-side slot: pass a node to replace the default
// "LOGIN" CTA for a page that needs its own nav action (e.g. /looper's info
// button). Omitted everywhere else, so the homepage/FAQ/inner-page nav is
// unchanged.
// `logoCyclesTheme` (homepage only): the logo flips the saved light/dark preference (the same store the Theme
// Studio uses) in place, easing every colour to the new palette (see THEME_FADE_ATTR), instead of linking home.
// Every other page keeps the plain home link.
const Header = ({ logoRef, onOpenPage, logoSrc = '/img/sig.png', actions = null, logoCyclesTheme = false }) => {
  const isSignatureLogo = logoSrc === '/img/sig.png';
  const { user } = useAuth();
  const [isMobile, setIsMobile] = useState(false);
  const ctaLabelRefs = useRef([]);
  const ctaArrowRef = useRef(null);
  const ctaCancelRef = useRef([]);
  const themeFadeTimerRef = useRef(0);

  useEffect(() => {
    const handleResize = () => {
      const nextIsMobile = window.innerWidth < 768;
      setIsMobile(nextIsMobile);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleLogoThemeCycle = (event) => {
    event.preventDefault();
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) {
      const tokens = registerThemeColorTokens(root);
      if (tokens.length) {
        // Inline !important out-ranks the store's :root[data-theme-switching] { transition: none !important }.
        root.style.setProperty('transition', tokens.map((t) => `${t} ${THEME_FADE_MS}ms ease-in-out`).join(', '), 'important');
      }
      // The hero scene eases its background instead of snapping while this is set (lib/theme-scene/scene-driver.js).
      root.setAttribute(THEME_FADE_ATTR, '');
      clearTimeout(themeFadeTimerRef.current);
      themeFadeTimerRef.current = setTimeout(() => {
        root.removeAttribute(THEME_FADE_ATTR);
        root.style.removeProperty('transition');
      }, THEME_FADE_MS + 100);
    }
    getPrefStore().setPreference(next);
  };

  const handleDashboardCta = () => {
    window.location.href = user ? '/dashboard' : '/login';
  };

  // Rest: CLIENTS. Hover: the scramble sweeps left to right (pink while scrambled)
  // and each cell locks into its LOGIN letter in the text colour, the last cell
  // clears and the arrow appears in it. Leaving sweeps back to CLIENTS right
  // to left. Text is written to the DOM directly (never React state) so the
  // scramble's textContent writes can't desync React's text nodes.
  // Every cell has a pinned width, so glyphs swap in place instead of changing
  // the word's width and jiggling the right-aligned label.
  const cellsOf = (node) => Array.from(node.children);

  // Letter cells pin to their glyph width (Doto is monospaced); the arrow cell
  // pins to the arrow's width plus its gap. Re-run on resize because the label's
  // font size changes at the mobile breakpoint; the hidden (display:none) label
  // measures 0 and is left alone until it is the visible one.
  const pinCtaCells = () => {
    const arrow = ctaArrowRef.current;
    const arrowWidth = arrow ? arrow.getBoundingClientRect().width : 0;
    ctaLabelRefs.current.forEach((node) => {
      if (!node || node.getBoundingClientRect().width === 0) return;
      const cells = cellsOf(node);
      cells[0].style.width = '';
      const glyphWidth = cells[0].getBoundingClientRect().width;
      if (!glyphWidth) return;
      cells.forEach((cell, c) => {
        cell.style.width = `${c === CTA_ARROW_CELL ? Math.max(arrowWidth, glyphWidth) : glyphWidth}px`;
        // The arrow cell is wider than a glyph; left-align its resting letter (CLIENTS' S) so it hugs the word.
        if (c === CTA_ARROW_CELL) cell.style.textAlign = 'left';
      });
    });
  };

  useLayoutEffect(() => {
    pinCtaCells();
    let cancelled = false;
    document.fonts?.ready.then(() => { if (!cancelled) pinCtaCells(); });
    window.addEventListener('resize', pinCtaCells);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', pinCtaCells);
    };
  }, []);

  // Scrambles every label from whatever it shows now to `target`; cancels any
  // sweep in flight, so a quick hover-out mid-reveal reverses from where it is.
  // scrambleTextTo always locks left to right, so `rightToLeft` hands it the
  // cells (and the target) in reverse order.
  const scrambleCtaTo = (target, { rightToLeft = false, onDone } = {}) => {
    ctaCancelRef.current.forEach((cancel) => cancel());
    ctaCancelRef.current = [];
    ctaLabelRefs.current.filter(Boolean).forEach((node, i) => {
      const labelCells = cellsOf(node);
      const cells = rightToLeft ? [...labelCells].reverse() : labelCells;
      // scrambleTextTo only reads/writes textContent, so this stand-in spreads
      // each frame's string across the cells, one character per cell (an empty
      // arrow cell reads as a space so indexes stay aligned).
      const cellText = {
        get textContent() { return cells.map((cell) => cell.textContent || ' ').join(''); },
        set textContent(value) {
          cells.forEach((cell, c) => {
            const ch = value[c] ?? '';
            cell.textContent = ch;
            cell.style.color = isSettledGlyph(ch) ? CTA_REVEAL_COLOR : CTA_MASK_COLOR;
          });
        },
      };
      // No churnBeforeLock: cells ahead of the wave hold their current glyph, so
      // the sweep reads as a wave in its direction.
      ctaCancelRef.current.push(scrambleTextTo(cellText, rightToLeft ? [...target].reverse().join('') : target, {
        durationMs: CTA_SCRAMBLE_MS,
        charPool: CTA_SCRAMBLE_POOL,
        onComplete: i === 0 ? onDone : undefined,
      }));
    });
  };

  const playCta = () => {
    pinCtaCells();
    scrambleCtaTo(CTA_LABEL, {
      onDone: () => {
        if (ctaArrowRef.current) ctaArrowRef.current.style.opacity = '1';
      },
    });
  };

  const reverseCta = () => {
    if (ctaArrowRef.current) ctaArrowRef.current.style.opacity = '0';
    scrambleCtaTo(CTA_REST_LABEL, { rightToLeft: true });
  };

  useEffect(() => () => ctaCancelRef.current.forEach((cancel) => cancel()), []);

  // Register the palette tokens while the browser is idle, so the first logo click starts easing at once
  // (registering ~a hundred properties costs a style pass).
  useEffect(() => {
    if (!logoCyclesTheme) return undefined;
    const run = () => registerThemeColorTokens(document.documentElement);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, [logoCyclesTheme]);

  return (
    <>
      <header
        id="founders-top-strip"
        style={{
          background: 'var(--t-chrome)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          boxShadow: 'inset 0 0 0 1px var(--t-glass-highlight), inset 0 -1px 0 var(--t-border-faint)',
        }}
      >
        <div id="founders-top-strip-inner">
          {/* Hidden anchor for GSAP intro animation */}
          <div ref={logoRef} aria-hidden="true" style={{ width: 0, height: 0, pointerEvents: 'none', position: 'absolute' }} />

          <a
            href="/"
            id="founders-brand"
            aria-label={logoCyclesTheme ? 'Switch light or dark mode' : 'Back to homepage'}
            onClick={logoCyclesTheme ? handleLogoThemeCycle : undefined}
          >
            <Image src={logoSrc} alt={isSignatureLogo ? 'Bryan Balli signature' : 'Bryan Balli logo'} width={isSignatureLogo ? 276 : 663} height={isSignatureLogo ? 208 : 552} priority id="founders-brand-logo-image" style={{ mixBlendMode: 'var(--t-logo-blend)', filter: isSignatureLogo ? 'var(--t-logo-filter)' : undefined }} />
          </a>

          <div id="founders-top-actions">
            {actions || (
              <button
                type="button"
                id="founders-chat-cta"
                aria-label="Client login"
                className="founders-chat-cta--light"
                onClick={handleDashboardCta}
                onMouseEnter={playCta}
                onMouseLeave={reverseCta}
                onFocus={playCta}
                onBlur={reverseCta}
                style={{ position: 'relative' }}
              >
                <span ref={(node) => { ctaLabelRefs.current[0] = node; }} id="founders-chat-label-full-cells" className="founders-chat-label-full" style={ctaLabelStyle}>{ctaLabelCells}</span>
                <span ref={(node) => { ctaLabelRefs.current[1] = node; }} id="founders-chat-label-short-cells" className="founders-chat-label-short" style={ctaLabelStyle}>{ctaLabelCells}</span>
                {/* Absolutely placed over the label's last (arrow) cell, so revealing it never shifts the label. */}
                <span
                  ref={ctaArrowRef}
                  id="founders-chat-cta-arrow-slot"
                  aria-hidden="true"
                  style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', lineHeight: 0, opacity: 0, transition: 'opacity 160ms ease-out', pointerEvents: 'none' }}
                >
                  <UpRightArrow id="founders-chat-cta-icon" />
                </span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Floating scroll-to-top bubble, bottom-right. Same show/hide trigger as
          before (StackedSlidesSection's hero-pin logic toggles #nav-scroll-top-arrow's
          display) — only the position/shape moved out of the nav. */}
      <button
        id="nav-scroll-top"
        type="button"
        aria-label="Scroll to top"
        onClick={() => {
          const arrow = document.getElementById('nav-scroll-top-arrow');
          if (arrow && arrow.style.display !== 'none') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }}
      >
        <span id="nav-scroll-top-arrow" style={{ display: 'none', lineHeight: 0 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="13" x2="8" y2="3" />
            <polyline points="4,7 8,3 12,7" />
          </svg>
        </span>
      </button>
    </>
  );
};

export default Header;
