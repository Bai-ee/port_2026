import { AlertTriangle, ArrowUpRight } from 'lucide-react';
import { XCE_COLORS, XCE_RADII, XCE_SPACE } from '../xce-tokens';

// Amber warning row with icon. Optional action link: actionLabel + onAction.
export default function WarnRow({ id, children, actionLabel, onAction }) {
  return (
    <div
      id={id}
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: XCE_SPACE.md - 2,
        padding: '10px 14px',
        border: `1px solid ${XCE_COLORS.amberBorder}`,
        borderRadius: XCE_RADII.lg,
        background: XCE_COLORS.amberBg,
        color: XCE_COLORS.amber,
        fontSize: 13,
        minWidth: 0,
      }}
    >
      <AlertTriangle size={18} style={{ flex: '0 0 auto' }} />
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            border: 0,
            background: 'transparent',
            color: 'inherit',
            fontSize: 13,
            textDecoration: 'underline',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {actionLabel}
          <ArrowUpRight size={14} />
        </button>
      ) : null}
    </div>
  );
}
