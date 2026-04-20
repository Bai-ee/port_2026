'use strict';

const { extractDesignSystem } = require('../../design-system-extractor');
const { synthesizeStyleGuide } = require('../../normalize');

async function runStyleGuide({ evidence }) {
  try {
    const dsResult = await extractDesignSystem(evidence, { onProgress: () => {} });
    if (!dsResult?.ok || !dsResult.designSystem) {
      return { ok: false, styleGuide: null, runCostData: dsResult?.runCostData || null, error: dsResult?.error || null };
    }
    const styleGuide = await synthesizeStyleGuide(dsResult.designSystem);
    return { ok: true, styleGuide, runCostData: dsResult.runCostData };
  } catch (err) {
    return { ok: false, styleGuide: null, runCostData: null, error: err.message };
  }
}

module.exports = { runStyleGuide };
