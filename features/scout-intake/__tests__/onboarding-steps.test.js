'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  STEP_KEYS,
  normalizeOnboardingSteps,
  isOnboardingStepEnabled,
  signupModuleIds,
} = require('../onboarding-steps');

test('absent config = every step on, both signup modules run (self-serve signup unchanged)', () => {
  for (const key of STEP_KEYS) assert.equal(isOnboardingStepEnabled(undefined, key), true);
  assert.deepEqual(signupModuleIds(undefined), ['multi-device-view', 'social-preview']);
});

test('normalize keeps known keys only, missing = on', () => {
  const out = normalizeOnboardingSteps({ motionVideo: false, nope: false });
  assert.deepEqual(Object.keys(out), STEP_KEYS);
  assert.equal(out.motionVideo, false);
  assert.equal(out.deviceMockups, true);
});

test('module steps off drop their module from the signup run', () => {
  assert.deepEqual(signupModuleIds({ deviceMockups: false }), ['social-preview']);
  assert.deepEqual(signupModuleIds({ deviceMockups: false, socialPreview: false }), []);
});

test('Create Client card mirrors the step keys + labels (drift guard)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ONBOARDING_STEPS } = require('../onboarding-steps');
  const src = fs.readFileSync(path.resolve(__dirname, '../../../components/AdminEmailModals.jsx'), 'utf8');
  const block = src.slice(src.indexOf('CREATE_CLIENT_ONBOARDING_STEPS = ['), src.indexOf('];', src.indexOf('CREATE_CLIENT_ONBOARDING_STEPS = [')));
  const ui = [...block.matchAll(/key: '([^']+)', label: '([^']+)'/g)].map((m) => ({ key: m[1], label: m[2] }));
  assert.deepEqual(ui, ONBOARDING_STEPS.map(({ key, label }) => ({ key, label })));
});
