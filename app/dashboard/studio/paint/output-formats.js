// Paint Studio — fixed, exact-size wallpaper output formats. Export must
// always match one of these dimensions exactly (see PAINT_STUDIO_PLAN.md
// acceptance criterion 5); nothing in Paint should invent an ad-hoc size.
export const PAINT_OUTPUT_FORMATS = [
  { id: 'desktop', label: 'DESKTOP', w: 2560, h: 1440 },
  { id: 'mobile', label: 'MOBILE', w: 1170, h: 2532 },
  { id: 'square', label: 'SQUARE', w: 2048, h: 2048 },
  { id: 'book-cover', label: 'BOOK COVER', w: 1600, h: 2560 },
  { id: 'chapter-page', label: 'CHAPTER PAGE', w: 1800, h: 2700 },
];

export const DEFAULT_PAINT_FORMAT_ID = 'desktop';

// getPaintFormat(formatId) -> the matching PAINT_OUTPUT_FORMATS entry, or the
// default format when formatId is missing/unknown. Never returns undefined.
export function getPaintFormat(formatId) {
  const match = PAINT_OUTPUT_FORMATS.find((format) => format.id === formatId);
  if (match) return match;
  return PAINT_OUTPUT_FORMATS.find((format) => format.id === DEFAULT_PAINT_FORMAT_ID) || PAINT_OUTPUT_FORMATS[0];
}
