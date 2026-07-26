'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAutoPublish,
  normalizeDailyVideo,
} = require('../_digest-config.js');

test('auto-publish preserves a normalized destination account client', () => {
  const config = normalizeAutoPublish({
    platforms: {
      x: {
        mode: 'approval',
        delayMinutes: 15,
        maxPerDay: 2,
        accountClientId: ' undergroundexistence-0CsKkpaq ',
      },
    },
  });

  assert.deepEqual(config.platforms.x, {
    mode: 'approval',
    delayMinutes: 15,
    maxPerDay: 2,
    accountClientId: 'undergroundexistence-0CsKkpaq',
  });
});

test('daily video preserves an independent latest-render source client', () => {
  assert.deepEqual(
    normalizeDailyVideo({
      sourceFolders: ['skyline', 'skyline'],
      sourceClientId: ' hitloop-master ',
    }),
    {
      sourceFolders: ['skyline'],
      sourceClientId: 'hitloop-master',
    },
  );
});

test('routing fields default blank for backwards compatibility', () => {
  const autoPublish = normalizeAutoPublish({});
  assert.equal(autoPublish.platforms.x.accountClientId, '');
  assert.equal(normalizeDailyVideo({}).sourceClientId, '');
});
