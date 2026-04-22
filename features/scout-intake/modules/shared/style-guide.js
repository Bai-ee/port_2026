'use strict';

const { extractDesignSystem } = require('../../design-system-extractor');
const { synthesizeStyleGuide } = require('../../normalize');

// runStyleGuide
// Extracts design tokens from CSS evidence. If a visualPalette (sampled from
// the homepage screenshot) is provided, it is passed into the extractor as
// ground truth so CSS-declared colors that are not actually prominent on the
// rendered page get demoted rather than promoted into primary/secondary.
async function runStyleGuide({ evidence, visualPalette = null }) {
  try {
    const dsResult = await extractDesignSystem(evidence, {
      onProgress: () => {},
      visualPalette,
    });
    if (!dsResult?.ok || !dsResult.designSystem) {
      return {
        ok: false,
        styleGuide: null,
        runCostData: dsResult?.runCostData || null,
        error: dsResult?.error || null,
      };
    }
    const styleGuide = await synthesizeStyleGuide(dsResult.designSystem);
    if (styleGuide && visualPalette) {
      // Attach provenance so the dashboard can show "sampled from homepage"
      // swatches alongside the extracted palette.
      styleGuide.visualPalette = visualPalette;
    }
    return { ok: true, styleGuide, runCostData: dsResult.runCostData };
  } catch (err) {
    return { ok: false, styleGuide: null, runCostData: null, error: err.message };
  }
}

module.exports = { runStyleGuide };
