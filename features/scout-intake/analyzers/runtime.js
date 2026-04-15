'use strict';

// runtime.js — No-op analyzer for UI chrome cards (e.g. Intake Terminal).
//
// Returns status:'skip' so Scribe knows to generate no copy for this card.

async function run() {
  return {
    status: 'skip',
    confidence: null,
    signals: null,
    notes: 'runtime chrome — no copy generated',
    runCostData: null,
  };
}

module.exports = { run };
