'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const modulePath = require.resolve('../calendar-oauth.cjs');

function withEnv(patch, fn) {
  const before = {
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    GMAIL_CLIENT_ID: process.env.GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL,
    APP_URL: process.env.APP_URL,
  };
  for (const key of Object.keys(before)) delete process.env[key];
  Object.assign(process.env, patch);
  delete require.cache[modulePath];
  try {
    return fn(require('../calendar-oauth.cjs'));
  } finally {
    delete require.cache[modulePath];
    for (const key of Object.keys(before)) {
      if (before[key] == null) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test('calendar OAuth accepts the existing Gmail OAuth client env names', () => {
  withEnv({
    GMAIL_CLIENT_ID: 'gmail-client-id',
    GMAIL_CLIENT_SECRET: 'gmail-client-secret',
    NEXT_PUBLIC_SITE_URL: 'https://hitloop.agency',
  }, (cal) => {
    assert.equal(cal.isConfigured(), true);
  });
});

test('calendar OAuth is unavailable when no OAuth client credentials exist', () => {
  withEnv({
    NEXT_PUBLIC_SITE_URL: 'https://hitloop.agency',
  }, (cal) => {
    assert.equal(cal.isConfigured(), false);
  });
});
