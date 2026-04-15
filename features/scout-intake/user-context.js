'use strict';

// user-context.js — Build a compact userContext object from onboarding answers.
//
// Reads clientConfig.onboardingAnswers.answers (written by
// app/api/dashboard/onboarding/route.js) and produces a flat object keyed by
// stepId that analyzers and the Scribe pass can read without re-parsing the
// survey schema.
//
// Only answers for steps flagged influencesAnalysis=true are included. Skipped
// answers are omitted (not stored as null) so the output stays tight when
// concatenated into prompts.
//
// Output shape (all keys optional):
//   {
//     stage:             string,    // 'idea' | 'early' | ...
//     intent:            string[],  // multi-select values
//     services:          string[],
//     priority:          string,
//     currentState:      string,
//     blocker:           string,    // free-text
//     outputExpectation: string,
//     _meta: {
//       answeredCount:   number,    // how many influence-flagged steps were answered
//       skippedAll:      boolean,
//       completed:       boolean,
//     }
//   }
//
// When no usable answers exist the function returns null so consumers can
// branch on presence.

const { ANSWER_DEPENDENT_STEP_IDS, getStep } = require('../../onboarding/questions.config.cjs');

function buildUserContext(clientConfig) {
  const onboarding = clientConfig?.onboardingAnswers;
  if (!onboarding || typeof onboarding !== 'object') return null;

  const answers = onboarding.answers || {};
  const out = {};
  let answeredCount = 0;

  for (const stepId of ANSWER_DEPENDENT_STEP_IDS) {
    const entry = answers[stepId];
    if (!entry || entry.skipped === true) continue;
    if (entry.value === null || entry.value === undefined) continue;

    const step = getStep(stepId);
    if (!step) continue;

    if (step.selectType === 'multi') {
      if (Array.isArray(entry.value) && entry.value.length > 0) {
        out[stepId] = entry.value.slice();
        answeredCount += 1;
      }
    } else if (step.selectType === 'single' || step.selectType === 'text') {
      if (typeof entry.value === 'string' && entry.value.trim()) {
        out[stepId] = entry.value.trim();
        answeredCount += 1;
      }
    }
  }

  if (answeredCount === 0 && !onboarding.skippedAt && !onboarding.completedAt) return null;

  out._meta = {
    answeredCount,
    skippedAll: Boolean(onboarding.skippedAt),
    completed: Boolean(onboarding.completedAt),
  };

  return out;
}

module.exports = { buildUserContext };
