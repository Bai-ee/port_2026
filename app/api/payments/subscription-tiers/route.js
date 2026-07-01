import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { configuredSubscriptionTiers } = require('../../../../api/_lib/subscription-prices.cjs');

export const runtime = 'nodejs';

export async function GET() {
  return Response.json(
    { tiers: configuredSubscriptionTiers() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
