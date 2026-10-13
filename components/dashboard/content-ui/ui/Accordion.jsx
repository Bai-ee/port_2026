import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { XCE_COLORS } from '../xce-tokens';

// Chevron disclosure row. Uncontrolled unless `open` + `onToggle` are passed.
export default function Accordion({ id, title, children, defaultOpen = false, open, onToggle, right }) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open === undefined ? inner : open;
  const toggle = () => (onToggle ? onToggle(!isOpen) : setInner(!isOpen));
  const panelId = id ? `${id}-content` : undefined;
  return (
    <div id={id} style={{ borderTop: `1px solid ${XCE_COLORS.border}` }}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
        style={{
          width: '100%',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: XCE_COLORS.ink,
          fontSize: 14,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <ChevronRight size={16} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }} />
        <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
        {right || null}
      </button>
      {isOpen ? (
        <div id={panelId} style={{ paddingBottom: 12 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
