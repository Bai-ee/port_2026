'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeIntakeResult } = require('../normalize');
const { getBrowserlessConfig, SCREENSHOT_VARIANTS } = require('../../../api/_lib/browserless.cjs');

const ORIGINAL_ENV = {
  BROWSERLESS_TOKEN: process.env.BROWSERLESS_TOKEN,
  BROWSERLESS_BASE_URL: process.env.BROWSERLESS_BASE_URL,
};

afterEach(() => {
  if (ORIGINAL_ENV.BROWSERLESS_TOKEN === undefined) delete process.env.BROWSERLESS_TOKEN;
  else process.env.BROWSERLESS_TOKEN = ORIGINAL_ENV.BROWSERLESS_TOKEN;

  if (ORIGINAL_ENV.BROWSERLESS_BASE_URL === undefined) delete process.env.BROWSERLESS_BASE_URL;
  else process.env.BROWSERLESS_BASE_URL = ORIGINAL_ENV.BROWSERLESS_BASE_URL;
});

test('normalizeIntakeResult preserves artifactRefs and warnings', () => {
  const artifactRef = {
    type: 'website_homepage_screenshot',
    storagePath: 'clients/demo/brief-runs/run-1/artifacts/homepage-screenshot.png',
  };
  const warning = {
    type: 'warning',
    code: 'browserless_not_configured',
    message: 'Screenshot skipped.',
  };

  const result = normalizeIntakeResult(
    {
      snapshot: {},
      signals: {},
      strategy: {},
      outputsPreview: {},
      systemPreview: {},
    },
    {
      clientId: 'demo',
      websiteUrl: 'https://example.com',
      runCostData: null,
      pipelineRunId: 'pipeline-1',
      artifactRefs: [artifactRef],
      warnings: [warning],
    }
  );

  assert.deepStrictEqual(result.artifactRefs, [artifactRef]);
  assert.deepStrictEqual(result.warnings, [warning]);
});

test('getBrowserlessConfig is disabled when token is absent', () => {
  delete process.env.BROWSERLESS_TOKEN;
  delete process.env.BROWSERLESS_BASE_URL;

  const config = getBrowserlessConfig();
  assert.equal(config.enabled, false);
  assert.match(config.reason, /not configured/i);
});

test('getBrowserlessConfig uses env token and trims base URL slash', () => {
  process.env.BROWSERLESS_TOKEN = 'token-123';
  process.env.BROWSERLESS_BASE_URL = 'https://browserless.example.com///';

  const config = getBrowserlessConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.token, 'token-123');
  assert.equal(config.baseUrl, 'https://browserless.example.com');
});

test('screenshot variants default to desktop, mobile, and ipad', () => {
  assert.deepStrictEqual(
    SCREENSHOT_VARIANTS.map((variant) => variant.id),
    ['desktop', 'mobile', 'ipad']
  );
  assert.equal(SCREENSHOT_VARIANTS[0].primary, true);
});
