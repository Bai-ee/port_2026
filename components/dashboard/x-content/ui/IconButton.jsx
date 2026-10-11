import { XCE_COLORS, XCE_RADII } from '../xce-tokens';

// Square icon-only button. `label` is required (aria-label). variant: 'ghost' | 'solid'.
export default function IconButton({ id, label, icon, onClick, disabled, variant = 'ghost', size = 40, style, ...rest }) {
  const solid = variant === 'solid';
  return (
    <button
      id={id}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: XCE_RADII.md,
        border: `1px solid ${solid ? XCE_COLORS.ink : XCE_COLORS.border}`,
        background: solid ? XCE_COLORS.ink : XCE_COLORS.surface,
        color: solid ? XCE_COLORS.onInk : XCE_COLORS.ink,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.48 : 1,
        padding: 0,
        ...style,
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}
