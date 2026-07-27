'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAutoPublish,
  normalizeDailyVideo,
  resolveDailyVideoOwnerClientId,
  resolveDailyVideoAssetClientId,
} = require('../_digest-config.js');

test('auto-publish ignores the legacy independent destination account', () => {
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
  });
});

test('daily video preserves the client that owns the video and publishing', () => {
  assert.deepEqual(
    normalizeDailyVideo({
      sourceFolders: ['skyline', 'skyline'],
      sourceClientId: ' hitloop-master ',
      assetSourceClientId: ' central-render-library ',
    }),
    {
      sourceFolders: ['skyline'],
      sourceClientId: 'hitloop-master',
      assetSourceClientId: 'central-render-library',
    },
  );
});

test('video ownership defaults to the digest client', () => {
  const autoPublish = normalizeAutoPublish({});
  assert.equal(Object.hasOwn(autoPublish.platforms.x, 'accountClientId'), false);
  assert.equal(normalizeDailyVideo({}).sourceClientId, '');
  assert.equal(normalizeDailyVideo({}).assetSourceClientId, '');
});

test('render file source can differ from the publishing owner', () => {
  const config = {
    dailyVideo: {
      sourceClientId: 'undergroundexistence-0CsKkpaq',
      assetSourceClientId: 'bryan-balli-WUoltG84',
    },
  };
  assert.equal(resolveDailyVideoOwnerClientId(config, 'email-client'), 'undergroundexistence-0CsKkpaq');
  assert.equal(resolveDailyVideoAssetClientId(config, 'email-client'), 'bryan-balli-WUoltG84');
  assert.equal(
    resolveDailyVideoAssetClientId({ dailyVideo: { sourceClientId: 'undergroundexistence-0CsKkpaq' } }, 'email-client'),
    'undergroundexistence-0CsKkpaq',
  );
});

test('selected video source is the only publish owner even with a legacy account target', () => {
  assert.equal(
    resolveDailyVideoOwnerClientId({
      dailyVideo: { sourceClientId: 'undergroundexistence-0CsKkpaq' },
      autoPublish: { platforms: { x: { accountClientId: 'hitloop-master' } } },
    }, 'hitloop-master'),
    'undergroundexistence-0CsKkpaq',
  );
});
