import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getStep, validateAnswer } = require('../../../../onboarding/questions.config.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

async function resolveClientId(uid) {
  const userSnap = await fb.adminDb.collection('users').doc(uid).get();
  if (!userSnap.exists) return null;
  return userSnap.data()?.clientId || null;
}

function unauthorized(message) {
  return NextResponse.json({ error: message }, { status: 401 });
}

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function notFound(message) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return unauthorized(err instanceof Error ? err.message : 'Unauthorized.');
  }

  const clientId = await resolveClientId(decoded.uid);
  if (!clientId) return notFound('No client record for user.');

  const snap = await fb.adminDb.collection('client_configs').doc(clientId).get();
  if (!snap.exists) return notFound('Client config not found.');

  const data = snap.data() || {};
  const onboardingAnswers = data.onboardingAnswers || null;

  return NextResponse.json({
    clientId,
    onboardingAnswers,
  });
}

export async function POST(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return unauthorized(err instanceof Error ? err.message : 'Unauthorized.');
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body.');
  }

  const action = String(body.action || '').trim();
  if (!action) return badRequest('Missing "action".');

  const clientId = await resolveClientId(decoded.uid);
  if (!clientId) return notFound('No client record for user.');

  const configRef = fb.adminDb.collection('client_configs').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();

  if (action === 'answer') {
    const stepId = String(body.stepId || '').trim();
    if (!stepId) return badRequest('Missing "stepId".');

    const step = getStep(stepId);
    if (!step) return badRequest(`Unknown stepId: ${stepId}`);
    if (step.kind === 'summary') return badRequest('Summary step is not submittable.');

    const result = validateAnswer(stepId, body.value);
    if (!result.ok) return badRequest(result.error);

    await configRef.set(
      {
        onboardingAnswers: {
          answers: {
            [stepId]: {
              value: result.value,
              skipped: false,
              answeredAt: now,
            },
          },
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, clientId, stepId });
  }

  if (action === 'skipStep') {
    const stepId = String(body.stepId || '').trim();
    if (!stepId) return badRequest('Missing "stepId".');

    const step = getStep(stepId);
    if (!step) return badRequest(`Unknown stepId: ${stepId}`);
    if (step.kind === 'summary') return badRequest('Summary step is not skippable at this level.');

    await configRef.set(
      {
        onboardingAnswers: {
          answers: {
            [stepId]: {
              value: null,
              skipped: true,
              answeredAt: now,
            },
          },
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, clientId, stepId, skipped: true });
  }

  if (action === 'skipAll') {
    await configRef.set(
      {
        onboardingAnswers: {
          skippedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, clientId, skippedAll: true });
  }

  if (action === 'complete') {
    await configRef.set(
      {
        onboardingAnswers: {
          completedAt: now,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, clientId, completed: true });
  }

  return badRequest(`Unsupported action: ${action}`);
}
