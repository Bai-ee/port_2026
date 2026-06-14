import Stripe from 'stripe';

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

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || (await stripe.customers.create({ email }));

    const paymentIntent = await stripe.paymentIntents.create({
      amount: RUN_PRICE_CENTS,
      currency: 'usd',
      customer: customer.id,
      receipt_email: email,
      automatic_payment_methods: { enabled: true },
      // briefKey/briefName let the fulfillment side (webhook) know which run to
      // unlock once the payment succeeds.
      metadata: {
        source: 'portfolio-subscribe-modal',
        purpose: 'one-time-brief-run',
        briefKey,
        briefName,
      },
    });

    if (!paymentIntent?.client_secret) {
      return json({ error: 'Could not start payment. Try again.' }, 500);
    }

    return json({ paymentIntentId: paymentIntent.id, clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('[payments/create-payment-intent]', err?.message || err);
    return json({ error: 'Payment setup failed. Try again later.' }, 500);
  }
}
