import Stripe from 'stripe';

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

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    return json({ error: 'Subscriptions are not configured.' }, 500);
  }

  try {
    const stripe = getStripe();

    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer = existing.data[0] || (await stripe.customers.create({ email }));

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
      metadata: { source: 'portfolio-subscribe-modal' },
    });

    const clientSecret = subscription?.latest_invoice?.payment_intent?.client_secret;
    if (!clientSecret) {
      return json({ error: 'Could not start payment. Try again.' }, 500);
    }

    return json({ subscriptionId: subscription.id, clientSecret });
  } catch (err) {
    console.error('[payments/create-subscription]', err?.message || err);
    return json({ error: 'Payment setup failed. Try again later.' }, 500);
  }
}
