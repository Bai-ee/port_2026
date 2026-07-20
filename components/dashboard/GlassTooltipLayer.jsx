'use client';

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
// Close / dismiss ("X") controls are self-evident; a "Close" tooltip on every
// modal X is noise. Suppress them regardless of aria-label or glyph.
function isCloseControl(el) {
  const aria = String(el.getAttribute('aria-label') || '').trim();
  if (/^(close|dismiss)$/i.test(aria)) return true;
  const glyph = String(el.innerText || el.textContent || '').trim();
  return /^(✕|×|✖|⨯|X|x)$/.test(glyph);
}
function getElementTooltipText(el) {
  if (!el || el.getAttribute('aria-hidden') === 'true') return '';
  if (isCloseControl(el)) return '';

  // The brief and other embedded previews render in iframes whose content is
  // self-evident; a hover tooltip echoing "… preview" adds nothing. Keep the
  // iframe's title attribute for accessibility but never surface it as a tooltip.
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
  // that label is noise (e.g. a "Login" button with a "Login" tooltip). Only
  // surface tooltips when an explicit source above adds information the label
  // does not already convey.
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
    <div
      id="glass-tooltip"
      role="tooltip"
      data-visible={tooltip.visible ? 'true' : 'false'}
      data-placement={tooltip.placement}
      style={{
        left: tooltip.left,
        top: tooltip.top,
      }}
    >
      {tooltip.text}
    </div>
  );
}
