'use client';

// Document-level glass tooltip. Listens for hover/focus on interactive elements
// and surfaces a single styled bubble. Originally inlined in DashboardPage; shared
// so other surfaces (e.g. the Mockup Studio) reuse the exact same UI/behaviour.
//
// Rules baked in:
//   • Opt out a subtree with data-tooltip-disabled="true".
//   • Controls that already show their own visible text get NO tooltip (a bubble
//     that repeats the label is noise) — only icon-only / titled controls do.
//   • Hidden on coarse pointers / narrow screens (see CSS below).

import { useCallback, useEffect, useRef, useState } from 'react';

const GLASS_TOOLTIP_SELECTOR = [
  '[data-tooltip]',
  '[title]',
  '[aria-label]',
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="group"]',
  'iframe',
].join(',');

function cleanTooltipText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getElementTooltipText(el) {
  if (!el || el.getAttribute('aria-hidden') === 'true') return '';

  // Embedded previews render in iframes whose content is self-evident; never
  // surface their title attribute as a hover tooltip.
  if (el.tagName?.toLowerCase() === 'iframe') return '';

  const direct = cleanTooltipText(el.getAttribute('data-tooltip') || el.getAttribute('data-tooltip-content'));
  if (direct) return direct;

  const title = cleanTooltipText(el.getAttribute('title') || el.dataset?.glassTooltipNativeTitle);
  if (title) return title;

  const aria = cleanTooltipText(el.getAttribute('aria-label'));
  if (aria) return aria;

  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const placeholder = cleanTooltipText(el.getAttribute('placeholder'));
    if (placeholder) return `Enter ${placeholder}`;
    const labelText = cleanTooltipText(el.closest('label')?.innerText);
    return labelText ? `Edit ${labelText}` : 'Edit this field';
  }
  if (tag === 'select') {
    const labelText = cleanTooltipText(el.closest('label')?.innerText);
    return labelText ? `Choose ${labelText}` : 'Choose an option';
  }

  // If the control already shows its own visible label, a tooltip that repeats
  // it is noise. Only surface tooltips when an explicit source above adds info.
  const text = cleanTooltipText(el.innerText || el.textContent);
  if (text) return '';

  // Icon-only / empty controls have no visible label, so a minimal hint helps.
  if (tag === 'a') return 'Open link';
  if (tag === 'button' || el.getAttribute('role') === 'button') return 'Use this control';
  if (el.getAttribute('role') === 'tab') return 'Switch view';
  return '';
}

export default function GlassTooltipLayer() {
  const activeElementRef = useRef(null);
  const hideTimerRef = useRef(null);
  const [tooltip, setTooltip] = useState({ visible: false, text: '', left: 0, top: 0, placement: 'top' });

  const restoreNativeTitle = useCallback((el) => {
    if (!el?.dataset?.glassTooltipNativeTitle) return;
    el.setAttribute('title', el.dataset.glassTooltipNativeTitle);
    delete el.dataset.glassTooltipNativeTitle;
  }, []);

  const hideTooltip = useCallback(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    const active = activeElementRef.current;
    activeElementRef.current = null;
    restoreNativeTitle(active);
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, [restoreNativeTitle]);

  const showTooltipFor = useCallback((el) => {
    if (!el || el.closest('[data-tooltip-disabled="true"]')) return;
    const text = getElementTooltipText(el);
    if (!text) return;

    if (activeElementRef.current && activeElementRef.current !== el) {
      restoreNativeTitle(activeElementRef.current);
    }
    activeElementRef.current = el;

    const nativeTitle = el.getAttribute('title');
    if (nativeTitle) {
      el.dataset.glassTooltipNativeTitle = nativeTitle;
      el.removeAttribute('title');
    }

    const rect = el.getBoundingClientRect();
    const placement = rect.top < 72 ? 'bottom' : 'top';
    const centerX = rect.left + rect.width / 2;
    const rawTop = placement === 'top' ? rect.top - 12 : rect.bottom + 12;
    const left = Math.min(Math.max(centerX, 24), window.innerWidth - 24);
    const top = placement === 'top' ? Math.max(rawTop, 12) : Math.min(rawTop, window.innerHeight - 12);
    setTooltip({ visible: true, text, left, top, placement });
  }, [restoreNativeTitle]);

  useEffect(() => {
    const findTooltipTarget = (target) => {
      const el = target instanceof Element ? target.closest(GLASS_TOOLTIP_SELECTOR) : null;
      if (!el || el.closest('[aria-hidden="true"]')) return null;
      return el;
    };

    const handlePointerOver = (event) => {
      const el = findTooltipTarget(event.target);
      if (!el) return;
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      showTooltipFor(el);
    };

    const handlePointerOut = (event) => {
      const active = activeElementRef.current;
      if (!active) return;
      const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (next && active.contains(next)) return;
      hideTimerRef.current = window.setTimeout(hideTooltip, 80);
    };

    const handleFocusIn = (event) => {
      const el = findTooltipTarget(event.target);
      if (el) showTooltipFor(el);
    };

    const handleFocusOut = () => hideTooltip();
    const handleScroll = () => hideTooltip();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') hideTooltip();
    };

    document.addEventListener('pointerover', handlePointerOver, true);
    document.addEventListener('pointerout', handlePointerOut, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('focusout', handleFocusOut, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerover', handlePointerOver, true);
      document.removeEventListener('pointerout', handlePointerOut, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('focusout', handleFocusOut, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
      document.removeEventListener('keydown', handleKeyDown);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      restoreNativeTitle(activeElementRef.current);
    };
  }, [hideTooltip, restoreNativeTitle, showTooltipFor]);

  return (
    <>
      <style>{`
        #glass-tooltip {
          position: fixed;
          z-index: 10050;
          max-width: min(20rem, calc(100vw - 2rem));
          padding: 0.62rem 0.78rem;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.84);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.52);
          box-shadow: 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.12);
          color: rgba(42, 36, 32, 0.76);
          font-family: "Space Mono", monospace;
          font-size: 0.68rem;
          line-height: 1.38;
          letter-spacing: 0.02em;
          text-align: center;
          pointer-events: none;
          opacity: 0;
          visibility: hidden;
          transform: translate(-50%, -4px);
          transition: opacity 0.14s ease, transform 0.14s ease, visibility 0.14s ease;
        }
        #glass-tooltip[data-visible="true"] { opacity: 1; visibility: visible; }
        #glass-tooltip[data-placement="top"] { transform: translate(-50%, -100%); }
        #glass-tooltip[data-placement="bottom"] { transform: translate(-50%, 0); }
        #glass-tooltip::after {
          content: '';
          position: absolute;
          left: 50%;
          width: 8px;
          height: 8px;
          background: rgba(255, 255, 255, 0.84);
          border: 1px solid rgba(255, 255, 255, 0.52);
          transform: translateX(-50%) rotate(45deg);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        #glass-tooltip[data-placement="top"]::after { bottom: -5px; border-left: 0; border-top: 0; }
        #glass-tooltip[data-placement="bottom"]::after { top: -5px; border-right: 0; border-bottom: 0; }
        @media (max-width: 640px), (pointer: coarse) { #glass-tooltip { display: none; } }
        @media (prefers-reduced-motion: reduce) { #glass-tooltip { transition: none; } }
      `}</style>
      <div
        id="glass-tooltip"
        role="tooltip"
        data-visible={tooltip.visible ? 'true' : 'false'}
        data-placement={tooltip.placement}
        style={{ left: tooltip.left, top: tooltip.top }}
      >
        {tooltip.text}
      </div>
    </>
  );
}
