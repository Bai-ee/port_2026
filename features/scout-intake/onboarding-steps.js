// Per-client onboarding steps — the units of work a signup run performs
// (app/api/worker/run-brief/route.js, trigger 'signup'). An admin creating a
// client with a website can turn steps off; the choice is stored on
// client_configs.onboardingSteps. Absent config = every step on, so
// self-serve signups behave exactly as before.
//
// The UI mirrors this list in components/AdminEmailModals.jsx (client code
// cannot import this CJS dir); a test keeps the two in sync.

const ONBOARDING_STEPS = [
  { key: 'deviceMockups', label: 'Device mockups', moduleId: 'multi-device-view' },
  { key: 'socialPreview', label: 'Social preview check', moduleId: 'social-preview' },
  { key: 'siteSources', label: 'Brand & site sources' },
  { key: 'motionVideo', label: 'Motion mockup video' },
  { key: 'briefSummary', label: 'Creative Brief summary' },
  { key: 'brainDraft', label: 'Client Brain draft' },
];

const STEP_KEYS = ONBOARDING_STEPS.map((s) => s.key);

// Every known key → boolean (missing = on). Unknown keys are dropped.
function normalizeOnboardingSteps(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of STEP_KEYS) out[key] = src[key] !== false;
  return out;
}

function isOnboardingStepEnabled(config, key) {
  if (!config || typeof config !== 'object') return true;
  return config[key] !== false;
}

// Module ids the signup run should execute for this config.
function signupModuleIds(config) {
  return ONBOARDING_STEPS
    .filter((s) => s.moduleId && isOnboardingStepEnabled(config, s.key))
    .map((s) => s.moduleId);
}

module.exports = {
  ONBOARDING_STEPS,
  STEP_KEYS,
  normalizeOnboardingSteps,
  isOnboardingStepEnabled,
  signupModuleIds,
};
