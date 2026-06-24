import Stripe from 'stripe';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');
const { resolveSubscriptionPriceId } = require('../../../../api/_lib/subscription-prices.cjs');

export const runtime = 'nodejs';

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let stripeClient = null;
function getStripe() {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error('Missing required server environment variable: STRIPE_SECRET_KEY');
    }
    stripeClient = new Stripe(key, { apiVersion: '2024-06-20' });
  }
  return stripeClient;
}

export async function POST(request) {
  // Rate limit: 10 attempts per IP per hour
  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `anon:${ip}:create-subscription`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return json({ error: 'Too many requests. Try again later.' }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const email = String(body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'Valid email required.' }, 400);
  }

  let resolvedPrice;
  try {
    resolvedPrice = resolveSubscriptionPriceId(body?.tier || 'weekly');
  } catch (err) {
    return json({ error: err.message || 'Subscription tier is not available.' }, err.status || 500);
  }
  const { tier, priceId } = resolvedPrice;

  try {
    const stripe = getStripe();

    // Reuse existing customer to avoid unbounded customer creation
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || (await stripe.customers.create(
      { email },
      { idempotencyKey: `customer-create:${email}:${Math.floor(Date.now() / 3_600_000)}` }
    ));

    // Dedupe: find any existing incomplete subscription for this customer
    const existingSubs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'incomplete',
      limit: 5,
    });
    const dupeSub = existingSubs.data.find(
      s => s.items?.data?.[0]?.price?.id === priceId
    );
    if (dupeSub) {
      const clientSecret = dupeSub?.latest_invoice?.payment_intent?.client_secret;
      if (clientSecret) {
        return json({ subscriptionId: dupeSub.id, clientSecret, tier });
      }
      // Incomplete sub without client_secret — retrieve expanded
      const expanded = await stripe.subscriptions.retrieve(dupeSub.id, {
        expand: ['latest_invoice.payment_intent'],
      });
      const cs = expanded?.latest_invoice?.payment_intent?.client_secret;
      if (cs) return json({ subscriptionId: expanded.id, clientSecret: cs, tier });
    }

    const subscription = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: { source: 'portfolio-subscribe-modal', tier },
      },
      {
        idempotencyKey: `sub-create:${email}:${priceId}:${Math.floor(Date.now() / 3_600_000)}`,
      }
    );

    const clientSecret = subscription?.latest_invoice?.payment_intent?.client_secret;
    if (!clientSecret) {
      return json({ error: 'Could not start payment. Try again.' }, 500);
    }

    return json({ subscriptionId: subscription.id, clientSecret, tier });
  } catch (err) {
    console.error('[payments/create-subscription]', err?.message || err);
    return json({ error: 'Payment setup failed. Try again later.' }, 500);
  }
}
