import { XCE_COLORS, XCE_RADII, XCE_SHADOWS, XCE_SPACE } from '../xce-tokens';

// White bordered surface. `tone` 'amber' gives the warning variant.
export default function Card({ id, children, padding = XCE_SPACE.lg, tone, style, ...rest }) {
  const warn = tone === 'amber';
  return (
    <div
      id={id}
      style={{
        background: warn ? XCE_COLORS.amberBg : XCE_COLORS.surface,
        border: `1px solid ${warn ? XCE_COLORS.amberBorder : XCE_COLORS.border}`,
        borderRadius: XCE_RADII.lg,
        boxShadow: XCE_SHADOWS.card,
        padding,
        minWidth: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
