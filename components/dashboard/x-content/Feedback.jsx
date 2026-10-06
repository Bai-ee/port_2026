'use client';

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Feedback — small shared UX pieces for the Content Engine tabs.
// PRESENTATION ONLY. Styling lives in the card's single `<style jsx global>`
// block (`#x-content-card .xce-confirm*`, `.xce-skeleton*`, `.xce-retry*`).

const DISARM_MS = 5000;

// Two-step destructive button. First click arms it ("Delete?" + Yes / No);
// it disarms itself after 5s. onConfirm only fires from the explicit Yes.
export function ConfirmButton({ id, label, confirmLabel = 'Yes', cancelLabel = 'No', prompt, onConfirm, disabled, className = 'xce-btn-danger', icon = null }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const arm = () => {
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), DISARM_MS);
  };
  const disarm = () => { clearTimeout(timer.current); setArmed(false); };

  if (!armed) {
    return (
      <button type="button" id={id} className={className} disabled={disabled} onClick={arm}>
        {icon}{label}
      </button>
    );
  }
  return (
    <span id={`${id}-confirm`} className="xce-confirm" role="group" aria-label={prompt || `${label}?`}>
      <span className="xce-confirm-prompt">{prompt || `${label}?`}</span>
      <button type="button" id={`${id}-confirm-yes`} className="xce-btn-danger" disabled={disabled} onClick={() => { disarm(); onConfirm && onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" id={`${id}-confirm-no`} className="xce-btn-ghost" onClick={disarm}>
        {cancelLabel}
      </button>
    </span>
  );
}

// Placeholder rows that hold the layout steady while data loads.
export function Skeleton({ id, rows = 3, variant = 'row' }) {
  return (
    <div id={id} className={`xce-skeleton xce-skeleton-${variant}`} role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="xce-skeleton-item" aria-hidden="true" />
      ))}
    </div>
  );
}

// Error line with a visible Retry. `onRetry` is the panel's existing reload.
export function RetryError({ id, message, onRetry, busy = false }) {
  if (!message) return null;
  return (
    <div id={id} className="xce-retry" role="alert">
      <span className="xce-retry-text"><AlertTriangle size={13} /> {typeof message === 'string' ? message : 'Something went wrong.'}</span>
      {onRetry ? (
        <button type="button" id={`${id}-button`} className="xce-btn-ghost" disabled={busy} onClick={onRetry}>
          <RefreshCw size={13} /> Retry
        </button>
      ) : null}
    </div>
  );
}

// Transient confirmation. Rendered once by the card; `toast` = {kind, text}.
export function Toast({ id = 'x-content-toast', toast }) {
  if (!toast || !toast.text) return null;
  return (
    <div id={id} className={`xce-toast xce-toast-${toast.kind === 'error' ? 'error' : 'ok'}`} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}
