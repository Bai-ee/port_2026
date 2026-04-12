const fb = require('./firebase-admin.cjs');

function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Website URL is required.');
  }

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);

  return {
    websiteUrl: url.toString(),
    hostname: url.hostname.toLowerCase(),
    origin: url.origin,
  };
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function deriveCompanyName({ companyName, hostname }) {
  if (companyName && String(companyName).trim()) {
    return String(companyName).trim();
  }

  const root = hostname.replace(/^www\./, '').split('.')[0] || 'Client';
  return root
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildDashboardTitle(companyName) {
  return `${companyName} Dashboard`;
}

async function queueInitialBriefRun({ clientId, uid, websiteUrl }) {
  const runRef = fb.adminDb.collection('brief_runs').doc();
  const now = fb.FieldValue.serverTimestamp();

  const payload = {
    runId: runRef.id,
    id: runRef.id,
    clientId,
    requestedByUid: uid,
    trigger: 'signup',
    source: 'system',
    status: 'queued',
    pipelineType: 'scout-brief',
    attempts: 0,
    workerLease: null,
    startedAt: null,
    completedAt: null,
    error: null,
    summary: null,
    artifactRefs: [],
    providerUsage: null,
    moduleSnapshot: null,
    sourceUrl: websiteUrl,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    runRef.set(payload),
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runRef.id).set(payload),
  ]);

  return payload;
}

async function provisionClientForUser({ uid, email, displayName, companyName, websiteUrl, ideaDescription }) {
  const normalized = normalizeUrl(websiteUrl);
  const userRef = fb.adminDb.collection('users').doc(uid);
  const existingUser = await userRef.get();
  const existingClientId = existingUser.exists ? existingUser.data()?.clientId : null;

  if (existingClientId) {
    const existingClientRef = fb.adminDb.collection('clients').doc(existingClientId);
    const existingClient = await existingClientRef.get();
    return {
      clientId: existingClientId,
      client: existingClient.exists ? existingClient.data() : null,
      alreadyProvisioned: true,
    };
  }

  const resolvedCompanyName = deriveCompanyName({
    companyName,
    hostname: normalized.hostname,
  });
  const clientId = `${slugify(resolvedCompanyName || normalized.hostname)}-${uid.slice(0, 8)}`;
  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const memberRef = clientRef.collection('members').doc(uid);
  const onboardingRef = clientRef.collection('system').doc('onboarding');
  const clientConfigRef = fb.adminDb.collection('client_configs').doc(clientId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();

  const clientPayload = {
    clientId,
    ownerUid: uid,
    ownerEmail: email || '',
    ownerDisplayName: displayName || '',
    companyName: resolvedCompanyName,
    dashboardTitle: buildDashboardTitle(resolvedCompanyName),
    dashboardDescription: `Initial discovery and dashboard setup for ${normalized.hostname} is in progress.`,
    websiteUrl: normalized.websiteUrl,
    normalizedOrigin: normalized.origin,
    normalizedHost: normalized.hostname,
    status: 'provisioning',
    onboardingStatus: 'brief_queued',
    pipelineType: 'scout-brief',
    activeModules: [],
    activeAddOns: [],
    pricingTier: 'starter',
    providerStrategy: 'anthropic',
    active: true,
    latestRunId: null,
    latestRunStatus: null,
    createdAt: now,
    updatedAt: now,
  };

  const memberPayload = {
    uid,
    email: email || '',
    displayName: displayName || '',
    role: 'owner',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const onboardingPayload = {
    state: 'brief_queued',
    sourceUrl: normalized.websiteUrl,
    queuedAt: now,
    updatedAt: now,
  };

  const clientConfigPayload = {
    clientId,
    sourceInputs: {
      websiteUrl: normalized.websiteUrl,
      ideaDescription: String(ideaDescription || '').trim(),
      uploadedImageRefs: [],
    },
    ingestionConfig: null,
    briefConfig: null,
    dashboardConfig: null,
    providerConfig: {
      defaultProvider: 'anthropic',
    },
    moduleFlags: {},
    createdAt: now,
    updatedAt: now,
  };

  const dashboardStatePayload = {
    clientId,
    status: 'provisioning',
    headline: null,
    summaryCards: [],
    latestInsights: [],
    latestRunId: null,
    latestRunStatus: null,
    updatedAt: now,
    provisioningState: {
      startedAt: now,
      message: 'Initial brief run is queued and will be processed shortly.',
    },
    errorState: null,
  };

  await Promise.all([
    clientRef.set(clientPayload),
    memberRef.set(memberPayload),
    onboardingRef.set(onboardingPayload),
    clientConfigRef.set(clientConfigPayload),
    dashboardStateRef.set(dashboardStatePayload),
    userRef.set(
      {
        uid,
        email: email || '',
        displayName: displayName || '',
        clientId,
        role: 'owner',
        dashboardTitle: clientPayload.dashboardTitle,
        dashboardDescription: clientPayload.dashboardDescription,
        onboardingStatus: 'brief_queued',
        websiteUrl: normalized.websiteUrl,
        updatedAt: now,
        createdAt: existingUser.exists ? existingUser.data()?.createdAt || now : now,
        lastLoginAt: now,
      },
      { merge: true }
    ),
  ]);

  const run = await queueInitialBriefRun({
    clientId,
    uid,
    websiteUrl: normalized.websiteUrl,
  });

  await Promise.all([
    clientRef.set(
      {
        latestRunId: run.runId,
        latestRunStatus: run.status,
        updatedAt: now,
      },
      { merge: true }
    ),
    dashboardStateRef.set(
      {
        latestRunId: run.runId,
        latestRunStatus: run.status,
        updatedAt: now,
      },
      { merge: true }
    ),
  ]);

  return {
    clientId,
    client: {
      ...clientPayload,
      latestRunId: run.runId,
      latestRunStatus: run.status,
    },
    initialRun: run,
    alreadyProvisioned: false,
  };
}

async function getDashboardBootstrap(uid) {
  const userSnapshot = await fb.adminDb.collection('users').doc(uid).get();
  if (!userSnapshot.exists) {
    return {
      userProfile: null,
      client: null,
      dashboardState: null,
      recentRuns: [],
    };
  }

  const userProfile = userSnapshot.data();
  const clientId = userProfile.clientId;

  if (!clientId) {
    return {
      userProfile,
      client: null,
      dashboardState: null,
      recentRuns: [],
    };
  }

  const [clientSnapshot, runsSnapshot, dashboardStateSnapshot] = await Promise.all([
    fb.adminDb.collection('clients').doc(clientId).get(),
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').orderBy('createdAt', 'desc').limit(8).get(),
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
  ]);

  return {
    userProfile,
    client: clientSnapshot.exists ? clientSnapshot.data() : null,
    dashboardState: dashboardStateSnapshot.exists ? dashboardStateSnapshot.data() : null,
    recentRuns: runsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
}

module.exports = {
  getDashboardBootstrap,
  provisionClientForUser,
};
