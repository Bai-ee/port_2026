'use strict';

const SUBSCRIPTION_PRICE_ENV_BY_TIER = {
  weekly: ['STRIPE_PRICE_ID_WEEKLY', 'STRIPE_PRICE_ID'],
  'weekly-plus': ['STRIPE_PRICE_ID_WEEKLY_PLUS'],
  daily: ['STRIPE_PRICE_ID_DAILY'],
  continuous: ['STRIPE_PRICE_ID_CONTINUOUS'],
  studio: ['STRIPE_PRICE_ID_STUDIO'],
};

function resolveSubscriptionPriceId(tier, env = process.env) {
  const normalizedTier = String(tier || '').trim().toLowerCase();
  const envNames = SUBSCRIPTION_PRICE_ENV_BY_TIER[normalizedTier];
  if (!envNames) {
    const err = new Error('Unknown subscription tier.');
    err.status = 400;
    throw err;
  }

  const priceId = envNames.map((name) => env[name]).find(Boolean);
  if (!priceId) {
    const err = new Error('Selected subscription tier is not configured.');
    err.status = 500;
    throw err;
  }

  return { tier: normalizedTier, priceId };
}

module.exports = {
  SUBSCRIPTION_PRICE_ENV_BY_TIER,
  resolveSubscriptionPriceId,
};
