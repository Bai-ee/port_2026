import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');

export const maxDuration = 60;

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function deploymentOrigin() {
  const host =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    '';
  if (!host) return 'http://localhost:3000';
  return /^https?:\/\//i.test(host) ? host.replace(/\/+$/, '') : `https://${host}`;
}

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return { decoded, context };
}

export async function POST(request) {
  let context, decoded;
  try {
    ({ context, decoded } = await resolveContext(request));
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const plan = body?.plan;
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
    return json({ error: 'plan.items is required and must be non-empty.' }, 400);
  }

  // Authorization header to pass downstream
  const authHeader = request.headers.get('authorization') || '';

  // Base URL for internal API calls
  const base = deploymentOrigin();

  const scheduled = [];
  const failed = [];

  // Compose final tweet text: keep the strategist copy and append its own
  // hashtags (brand-aligned) within the 280-char budget. We intentionally do
  // NOT run the generic posting agents — they inject off-brand tags.
  function composeContent(item) {
    const baseRaw = String(item.content || '').trim();
    const base = baseRaw.slice(0, 280);
    const tags = (Array.isArray(item.hashtags) ? item.hashtags : []).filter(Boolean);
    const missing = tags.filter(
      (t) => !base.toLowerCase().includes(String(t).toLowerCase())
    );
    if (!missing.length) return base;
    const suffix = ' ' + missing.join(' ');
    return base.length + suffix.length <= 280 ? base + suffix : base;
  }

  function agentsFor(item) {
    return {
      contentCreator: {
        status: 'complete',
        note: `Strategy ${plan.campaignId} · ${item.kind || 'baseline'}`,
      },
      hashtagSpecialist: {
        status: 'complete',
        hashtags: Array.isArray(item.hashtags) ? item.hashtags : [],
      },
      engagementOptimizer: {
        status: 'complete',
        note: item.rationale ? String(item.rationale).slice(0, 160) : '',
      },
      mediaGenerator: item.mediaUrl
        ? {
            status: 'complete',
            note: `Attached ${item.mediaType || 'media'} from Mockup Studio.`,
            mediaUrl: item.mediaUrl,
            jobId: item.mediaJobId || null,
          }
        : {
            status: item.mediaHint ? 'queued' : 'skipped',
            note: item.mediaHint ? String(item.mediaHint).slice(0, 160) : '',
          },
    };
  }

  // Push each post to the social-posting API
  for (const item of plan.items) {
    try {
      const res = await fetch(`${base}/api/social-posting`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'schedule',
          content: composeContent(item),
          scheduledAt: item.scheduledAt,
          source: `strategy-builder:${plan.campaignId}`,
          agents: agentsFor(item),
          // Pass any paired Studio asset through to the queued post (null = text-only).
          mediaUrl: item.mediaUrl || null,
          mediaType: item.mediaType || null,
          mediaStoragePath: item.mediaStoragePath || null,
          mediaContentType: item.mediaContentType || null,
          mediaJobId: item.mediaJobId || null,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        failed.push({ id: item.id, reason: data?.error || data?.hint || `HTTP ${res.status}` });
      } else {
        scheduled.push(item.id);
      }
    } catch (err) {
      failed.push({ id: item.id, reason: err.message || 'Network error' });
    }
  }

  // Append plan summary to history (capped at 10)
  try {
    const planSummary = {
      campaignId: plan.campaignId,
      generatedAt: plan.generatedAt,
      itemCount: plan.items.length,
      scheduledCount: scheduled.length,
      pushedAt: new Date().toISOString(),
    };

    const dsRef = fb.adminDb.collection('dashboard_state').doc(context.clientId);
    const dsSnap = await dsRef.get();
    const currentHistory = dsSnap.exists
      ? (dsSnap.data()?.strategyBuilder?.history || [])
      : [];

    const newHistory = [planSummary, ...currentHistory].slice(0, 10);

    await dsRef.set(
      { strategyBuilder: { history: newHistory } },
      { merge: true }
    );
  } catch (err) {
    // Non-fatal
    console.error('[strategy-builder/push] history save error:', err.message);
  }

  return json({
    ok: true,
    scheduled: scheduled.length,
    failed,
  });
}
