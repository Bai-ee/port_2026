import Stripe from 'stripe';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

export const runtime = 'nodejs';

const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One-time on-demand brief run price, in cents. Server-side source of truth —
// the modal only displays "$5". Keep in sync with RUN_PRICE_LABEL in
// components/payments/SubscribeModal.jsx.
const RUN_PRICE_CENTS = 500;

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
    key: `anon:${ip}:create-payment-intent`,
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

  const briefKey = String(body?.briefKey || '').trim().slice(0, 80);
  const briefName = String(body?.briefName || '').trim().slice(0, 160);

  if (!process.env.STRIPE_SECRET_KEY) {
    return json({ error: 'Payments are not configured.' }, 500);
  }

  try {
    const stripe = getStripe();

    // Reuse existing customer to avoid unbounded customer creation per email
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || (await stripe.customers.create(
      { email },
      // Idempotency key: one customer-create attempt per email per hour
      { idempotencyKey: `customer-create:${email}:${Math.floor(Date.now() / 3_600_000)}` }
    ));

    // Dedupe: find any existing incomplete payment intent for this email+briefKey
    if (briefKey) {
      const existingIntents = await stripe.paymentIntents.list({
        customer: customer.id,
        limit: 5,
      });
      const dupe = existingIntents.data.find(
        pi =>
          pi.status === 'requires_payment_method' &&
          pi.metadata?.purpose === 'one-time-brief-run' &&
          pi.metadata?.briefKey === briefKey
      );
      if (dupe?.client_secret) {
        return json({ paymentIntentId: dupe.id, clientSecret: dupe.client_secret });
      }
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: RUN_PRICE_CENTS,
        currency: 'usd',
        customer: customer.id,
        receipt_email: email,
        automatic_payment_methods: { enabled: true },
        metadata: {
          source: 'portfolio-subscribe-modal',
          purpose: 'one-time-brief-run',
          briefKey,
          briefName,
        },
      },
      {
        // Idempotency: one intent per email+briefKey per hour
        idempotencyKey: `pi:${email}:${briefKey}:${Math.floor(Date.now() / 3_600_000)}`,
      }
    );

    if (!paymentIntent?.client_secret) {
      return json({ error: 'Could not start payment. Try again.' }, 500);
    }

    return json({ paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[payments/create-payment-intent]', err?.message || err);
    return json({ error: 'Payment setup failed. Try again later.' }, 500);
  }
}
