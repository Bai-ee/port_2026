// Up-right arrow drawn on Doto's own dot grid (0.1em pitch, 0.09em dots), 5 dots wide like every letter and 5 tall,
// centred on the 7-row cap height: the diagonal is the dot staircase Doto uses for the N, the head a row along the
// top and a column down the right. The font's own rectangles, so weight, width and look match the letters exactly.
// Sized in em, so it follows the label's font-size. `strokeEm` fattens every dot the way the label's text-stroke
// fattens its letters (0 = the plain cut). Ported from hitloop-video clients/hitloop/src/scramble/PixelArrow.tsx.
const ARROW_DOTS = [
  [1, 0], [2, 0], [3, 0], [4, 0], // top bar
  [4, 1], [4, 2], [4, 3], // right bar
  [0, 4], [1, 3], [2, 2], [3, 1], // diagonal
];
const ROW_OFFSET = 1; // rows 1..5 of the 7-row cap grid
const U = 100; // viewBox units per em
const PITCH = 10;
const DOT = 9;

export default function PixelArrow({ strokeEm = 0, id, style }) {
  const s = strokeEm * U;
  const w = 4 * PITCH + DOT + s;
  const h = 6 * PITCH + DOT + s;
  return (
    <svg
      id={id}
      viewBox={`0 0 ${w} ${h}`}
      width={`${w / U}em`}
      height={`${h / U}em`}
      fill="currentColor"
      stroke={s ? 'currentColor' : 'none'}
      strokeWidth={s}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      // The svg's bottom edge sits on the baseline (the letters' bottom dot row); a stroked label hangs half its
      // stroke below it, so the arrow does too.
      style={{ display: 'inline-block', verticalAlign: `${-strokeEm / 2}em`, flexShrink: 0, ...style }}
    >
      {ARROW_DOTS.map(([c, r]) => (
        <rect key={`${c}-${r}`} x={c * PITCH + s / 2} y={(r + ROW_OFFSET) * PITCH + s / 2} width={DOT} height={DOT} />
      ))}
    </svg>
  );
}
