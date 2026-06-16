import Stripe from 'stripe';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const runtime = 'nodejs';

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

async function upsertSubscription(subscription, email) {
  const fb = require('../../../../api/_lib/firebase-admin.cjs');
  const doc = {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
    priceId: subscription.items?.data?.[0]?.price?.id || null,
    currentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null,
    updatedAt: new Date().toISOString(),
  };
  if (email) {
    doc.email = email;
  }
  await fb.adminDb.collection('subscriptions').doc(subscription.id).set(doc, { merge: true });
}

const PROCESSING_STALE_MS = 10 * 60 * 1000;

async function claimEventForProcessing(eventId) {
  const fb = require('../../../../api/_lib/firebase-admin.cjs');
  const ref = fb.adminDb.collection('_stripe_events').doc(eventId);

  return fb.adminDb.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const now = new Date();

    if (doc.exists) {
      const data = doc.data() || {};
      if (data.status === 'processed') {
        return { shouldProcess: false, reason: 'processed' };
      }

      const startedAt = data.processingStartedAt ? Date.parse(data.processingStartedAt) : 0;
      if (data.status === 'processing' && Number.isFinite(startedAt) && now.getTime() - startedAt < PROCESSING_STALE_MS) {
        return { shouldProcess: false, reason: 'in_progress' };
      }
    }

    tx.set(ref, {
      status: 'processing',
      processingStartedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      attempts: fb.FieldValue.increment(1),
    }, { merge: true });
    return { shouldProcess: true, reason: 'claimed' };
  });
}

async function markEventProcessed(eventId) {
  const fb = require('../../../../api/_lib/firebase-admin.cjs');
  await fb.adminDb.collection('_stripe_events').doc(eventId).set({
    status: 'processed',
    processedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastError: null,
  }, { merge: true });
}

async function markEventFailed(eventId, err) {
  const fb = require('../../../../api/_lib/firebase-admin.cjs');
  await fb.adminDb.collection('_stripe_events').doc(eventId).set({
    status: 'failed',
    lastError: String(err?.message || err || 'Handler failed.').slice(0, 1000),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

export async function POST(request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: 'Webhook not configured.' }), { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  const rawBody = await request.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error('[payments/webhook] signature verification failed:', err?.message);
    return new Response(JSON.stringify({ error: 'Invalid signature.' }), { status: 400 });
  }

  const claim = await claimEventForProcessing(event.id);
  if (!claim.shouldProcess) {
    return new Response(JSON.stringify({ received: true, replayed: true, reason: claim.reason }), { status: 200 });
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(event.data.object);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (subscriptionId) {
          const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
          await upsertSubscription(subscription, invoice.customer_email);
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[payments/webhook]', event.type, err?.message || err);
    await markEventFailed(event.id, err);
    return new Response(JSON.stringify({ error: 'Handler failed.' }), { status: 500 });
  }

  await markEventProcessed(event.id);
  return new Response(JSON.stringify({ received: true }), { status: 200 });
}
