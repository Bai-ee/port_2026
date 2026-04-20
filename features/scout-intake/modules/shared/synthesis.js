'use strict';

const { synthesizeSiteEvidence } = require('../../intake-synthesizer');

async function runSynthesis({ evidence, intelligenceBriefing = null }) {
  try {
    const result = await synthesizeSiteEvidence(evidence, { intelligenceBriefing });
    return { ok: result.ok, intake: result.intake, runCostData: result.runCostData, error: result.error };
  } catch (err) {
    return { ok: false, intake: null, runCostData: null, error: err.message };
  }
}

module.exports = { runSynthesis };
