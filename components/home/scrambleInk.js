// Scramble glyph ink: instead of one flat mask colour, a gradient across the row's cells from `from` to `to`, just
// evident. Theme tokens as the ends keep dark mode in step. Ported from the hitloop-video CTA loops.
export const scrambleInkAt = (cell, cellCount, from, to) => {
  const pct = cellCount > 1 ? Math.round((cell / (cellCount - 1)) * 100) : 0;
  return `color-mix(in srgb, ${to} ${pct}%, ${from})`;
};
