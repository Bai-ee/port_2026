import { XCE_COLORS, XCE_RADII, XCE_TYPE } from '../xce-tokens';

const TONES = {
  green: [XCE_COLORS.greenBg, XCE_COLORS.greenBorder, XCE_COLORS.green],
  amber: [XCE_COLORS.amberBg, XCE_COLORS.amberBorder, XCE_COLORS.amber],
  blue: [XCE_COLORS.blueBg, XCE_COLORS.blueBorder, XCE_COLORS.blue],
  grey: [XCE_COLORS.greyBg, XCE_COLORS.greyBorder, XCE_COLORS.inkSoft],
  red: [XCE_COLORS.redBg, XCE_COLORS.redBorder, XCE_COLORS.red],
};

// Pill badge. tone: 'green' | 'amber' | 'blue' | 'grey' | 'red'.
export default function Badge({ id, tone = 'grey', icon, children, style }) {
  const [bg, border, color] = TONES[tone] || TONES.grey;
  return (
    <span
      id={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minHeight: 22,
        padding: '0 9px',
        borderRadius: XCE_RADII.pill,
        border: `1px solid ${border}`,
        background: bg,
        color,
        fontFamily: XCE_TYPE.mono,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon || null}
      {children}
    </span>
  );
}
