import { XCE_COLORS, XCE_RADII } from '../xce-tokens';

// options: [{ value, label, icon? }]. Controlled via value/onChange.
export default function SegmentedControl({ id, options, value, onChange, ariaLabel, style }) {
  return (
    <div
      id={id}
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 4,
        padding: 3,
        border: `1px solid ${XCE_COLORS.border}`,
        borderRadius: XCE_RADII.md,
        background: XCE_COLORS.surface,
        ...style,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange && onChange(o.value)}
            style={{
              flex: 1,
              minHeight: 38,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              border: 0,
              borderRadius: XCE_RADII.sm,
              background: on ? XCE_COLORS.ink : 'transparent',
              color: on ? XCE_COLORS.onInk : XCE_COLORS.ink,
              fontSize: 13,
              fontWeight: on ? 700 : 500,
              cursor: 'pointer',
            }}
          >
            {o.icon || null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
