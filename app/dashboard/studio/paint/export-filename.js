// Paint Studio — pure helpers factored out of PaintStudio.jsx so they can be
// unit-tested under plain `node --test` without a JSX/DOM transform (the
// component itself is a .jsx file and is not imported by any test).

// buildExportFilename(recipe, extension) -> a descriptive, stable filename
// for an exported asset (PNG or its paired provenance JSON), e.g.
// "paint-watercolour-bloom-12345-desktop.png". Never throws — falls back to
// safe placeholders on a malformed/partial recipe.
export function buildExportFilename(recipe, extension) {
  const templateId = recipe && typeof recipe.templateId === 'string' && recipe.templateId
    ? recipe.templateId
    : 'template';
  const seed = recipe && Number.isFinite(recipe.seed) ? recipe.seed : 0;
  const formatId = recipe && recipe.output && typeof recipe.output.formatId === 'string' && recipe.output.formatId
    ? recipe.output.formatId
    : 'format';
  return `paint-${templateId}-${seed}-${formatId}.${extension}`;
}

// mobileAreaHeightFor(format) -> the narrow-viewport (<820px) artboard area
// height, mirroring the Video Studio UX kit's per-orientation caps: portrait
// 64vh, square 54vh, landscape 44vh (docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md
// "Shell Layout"). Accepts any { w, h } shape (a PAINT_OUTPUT_FORMATS entry
// or a recipe's `output`); defaults safely to the landscape cap.
export function mobileAreaHeightFor(format) {
  if (!format || typeof format.w !== 'number' || typeof format.h !== 'number') return '44vh';
  if (format.h > format.w) return '64vh';
  if (format.h === format.w) return '54vh';
  return '44vh';
}
