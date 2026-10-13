'use client';

import React, { useEffect, useRef, useState } from 'react';

// Popover — an icon/button that opens a small floating panel. The panel is
// absolutely positioned so opening it never shifts the layout around it.
// Closes on outside click and Escape. CSS: xce-pop-* in XContentEngineCard.
export default function Popover({ id, label, title, icon, align = 'right', className = '', children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <span ref={ref} className={`xce-pop${className ? ` ${className}` : ''}`} id={id}>
      <button type="button" className={`xce-bk-icon xce-pop-trigger${open ? ' is-open' : ''}${label ? ' has-label' : ''}`}
        aria-label={title} title={title} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {icon}{label ? <span>{label}</span> : null}
      </button>
      {open ? (
        <div className={`xce-pop-panel align-${align}`} role="dialog" aria-label={title}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </span>
  );
}
