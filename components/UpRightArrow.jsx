// Canonical "up and out" arrow used by every CTA across the site.
//
// Single inline SVG so the glyph renders pixel-identical on every OS/font
// (the old Unicode `↗` and the lucide <ArrowUpRight> both varied by platform).
// Inherits text color via `currentColor` and scales with font-size via the
// em-based default `size`, so it sits correctly inside any button/link.
//
// Reference look = the primary "Meet with a Human" button arrow.
export default function UpRightArrow({
  size = '1em',
  strokeWidth = 2.75,
  style,
  className,
  ...rest
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle', ...style }}
      {...rest}
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="8 7 17 7 17 16" />
    </svg>
  );
}
