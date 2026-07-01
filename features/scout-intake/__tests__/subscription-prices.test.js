'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { configuredSubscriptionTiers, resolveSubscriptionPriceId } = require('../../../api/_lib/subscription-prices.cjs');

describe('subscription price resolver', () => {
  test('uses weekly-specific price before legacy fallback', () => {
    const resolved = resolveSubscriptionPriceId('weekly', {
      STRIPE_PRICE_ID: 'price_legacy',
      STRIPE_PRICE_ID_WEEKLY: 'price_weekly',
    });

    assert.deepEqual(resolved, { tier: 'weekly', priceId: 'price_weekly' });
  });

  test('keeps legacy STRIPE_PRICE_ID fallback for weekly tier only', () => {
    assert.equal(
      resolveSubscriptionPriceId('weekly', { STRIPE_PRICE_ID: 'price_legacy' }).priceId,
      'price_legacy'
    );

    assert.throws(
      () => resolveSubscriptionPriceId('daily', { STRIPE_PRICE_ID: 'price_legacy' }),
      /not configured/
    );
  });

  test('rejects unknown tiers', () => {
    assert.throws(
      () => resolveSubscriptionPriceId('enterprise', { STRIPE_PRICE_ID_STUDIO: 'price_studio' }),
      /Unknown subscription tier/
    );
  });

  test('maps every public tier to its own env var', () => {
    const env = {
      STRIPE_PRICE_ID_WEEKLY: 'price_weekly',
      STRIPE_PRICE_ID_WEEKLY_PLUS: 'price_weekly_plus',
      STRIPE_PRICE_ID_DAILY: 'price_daily',
      STRIPE_PRICE_ID_CONTINUOUS: 'price_continuous',
      STRIPE_PRICE_ID_STUDIO: 'price_studio',
    };

    assert.equal(resolveSubscriptionPriceId('weekly', env).priceId, 'price_weekly');
    assert.equal(resolveSubscriptionPriceId('weekly-plus', env).priceId, 'price_weekly_plus');
    assert.equal(resolveSubscriptionPriceId('daily', env).priceId, 'price_daily');
    assert.equal(resolveSubscriptionPriceId('continuous', env).priceId, 'price_continuous');
    assert.equal(resolveSubscriptionPriceId('studio', env).priceId, 'price_studio');
  });

  test('lists only tiers configured in the server environment', () => {
    assert.deepEqual(
      configuredSubscriptionTiers({
        STRIPE_PRICE_ID: 'price_legacy',
        STRIPE_PRICE_ID_DAILY: 'price_daily',
      }),
      ['weekly', 'daily']
    );
  });
});
