import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useAuth } from './AuthContext';
import ScrambleCta from './components/home/ScrambleCta';
import { getPrefStore } from './lib/theme-runtime/pref-store.js';

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
        data-nav-variant={logoCyclesTheme ? 'home' : undefined}
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
              <ScrambleCta
                restLabel="CLIENTS"
                revealLabel={user ? 'ENTER ' : 'LOGIN '}
                ariaLabel={user ? 'Open your dashboard' : 'Client login'}
                onClick={handleDashboardCta}
              />
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
