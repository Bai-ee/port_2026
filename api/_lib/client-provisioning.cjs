const fb = require('./firebase-admin.cjs');

function normalizeOptionalUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return null;
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

function deriveCompanyName({ companyName, hostname, displayName, email }) {
  if (companyName && String(companyName).trim()) {
    return String(companyName).trim();
  }

  if (!hostname) {
    if (displayName && String(displayName).trim()) {
      return String(displayName).trim();
    }

    const emailRoot = String(email || '').split('@')[0]?.trim();
    if (emailRoot) {
      return emailRoot
        .split(/[.\-_]/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
    }

    return 'Client';
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
    pipelineType: 'free-tier-intake',
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
  const normalized = normalizeOptionalUrl(websiteUrl);
  const trimmedIdeaDescription = String(ideaDescription || '').trim();

  if (!normalized && !trimmedIdeaDescription) {
    throw new Error('Provide a website URL or an idea / project / request.');
  }

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
    hostname: normalized?.hostname || '',
    displayName,
    email,
  });
  const clientKey = slugify(resolvedCompanyName || normalized?.hostname || email || 'client');
  const clientId = `${clientKey}-${uid.slice(0, 8)}`;
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
    dashboardDescription: normalized
      ? `Initial discovery and dashboard setup for ${normalized.hostname} is in progress.`
      : 'Initial intake is recorded and your dashboard setup is pending review.',
    websiteUrl: normalized?.websiteUrl || '',
    normalizedOrigin: normalized?.origin || '',
    normalizedHost: normalized?.hostname || '',
    status: 'provisioning',
    onboardingStatus: normalized ? 'brief_queued' : 'intake_received',
    pipelineType: 'free-tier-intake',
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
    state: normalized ? 'brief_queued' : 'intake_received',
    sourceUrl: normalized?.websiteUrl || '',
    ideaDescription: trimmedIdeaDescription,
    queuedAt: normalized ? now : null,
    updatedAt: now,
  };

  const clientConfigPayload = {
    clientId,
    sourceInputs: {
      websiteUrl: normalized?.websiteUrl || '',
      ideaDescription: trimmedIdeaDescription,
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
      message: normalized
        ? 'Initial brief run is queued and will be processed shortly.'
        : 'Your request has been received and dashboard setup is pending review.',
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
        onboardingStatus: normalized ? 'brief_queued' : 'intake_received',
        websiteUrl: normalized?.websiteUrl || '',
        updatedAt: now,
        createdAt: existingUser.exists ? existingUser.data()?.createdAt || now : now,
        lastLoginAt: now,
      },
      { merge: true }
    ),
  ]);

  let run = null;
  if (normalized?.websiteUrl) {
    run = await queueInitialBriefRun({
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
  }

  return {
    clientId,
    client: {
      ...clientPayload,
      latestRunId: run?.runId || null,
      latestRunStatus: run?.status || null,
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

/**
 * Update a client's source URL and queue a fresh free-tier intake run.
 * Clears existing intake data from dashboard_state so the terminal shows
 * fresh progress on the next poll.
 *
 * @param {object} options
 * @param {string} options.clientId
 * @param {string} options.uid       - requestor uid (stored on run doc)
 * @param {string} options.websiteUrl - raw URL string (will be normalized)
 * @returns {{ clientId, runId, status: 'queued', websiteUrl }}
 */
async function reseedIntakeForClient({ clientId, uid, websiteUrl }) {
  const normalized = normalizeOptionalUrl(websiteUrl);
  if (!normalized) throw new Error('Invalid website URL.');

  const runRef = fb.adminDb.collection('brief_runs').doc();
  const runId = runRef.id;
  const now = fb.FieldValue.serverTimestamp();

  const runPayload = {
    runId,
    id: runId,
    clientId,
    requestedByUid: uid,
    trigger: 'reseed',
    source: 'user',
    status: 'queued',
    pipelineType: 'free-tier-intake',
    attempts: 0,
    workerLease: null,
    startedAt: null,
    completedAt: null,
    error: null,
    summary: null,
    artifactRefs: [],
    providerUsage: null,
    moduleSnapshot: null,
    sourceUrl: normalized.websiteUrl,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    // Update clients doc with new URL + queued state
    fb.adminDb.collection('clients').doc(clientId).set(
      {
        websiteUrl: normalized.websiteUrl,
        normalizedOrigin: normalized.origin,
        normalizedHost: normalized.hostname,
        latestRunId: runId,
        latestRunStatus: 'queued',
        status: 'provisioning',
        updatedAt: now,
      },
      { merge: true }
    ),

    // Update client_configs sourceInputs
    fb.adminDb.collection('client_configs').doc(clientId).set(
      {
        sourceInputs: { websiteUrl: normalized.websiteUrl },
        updatedAt: now,
      },
      { merge: true }
    ),

    // Reset dashboard_state — clear intake fields, set provisioning
    fb.adminDb.collection('dashboard_state').doc(clientId).set(
      {
        clientId,
        status: 'provisioning',
        snapshot: null,
        signals: null,
        strategy: null,
        outputsPreview: null,
        systemPreview: null,
        headline: null,
        summaryCards: [],
        latestInsights: [],
        latestRunId: runId,
        latestRunStatus: 'queued',
        errorState: null,
        provisioningState: {
          startedAt: now,
          message: `Re-running intake for ${normalized.hostname}...`,
        },
        updatedAt: now,
      },
      { merge: true }
    ),

    // Create brief_run + mirror to subcollection
    runRef.set(runPayload),
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').doc(runId).set(runPayload),
  ]);

  return { clientId, runId, status: 'queued', websiteUrl: normalized.websiteUrl };
}

module.exports = {
  getDashboardBootstrap,
  provisionClientForUser,
  reseedIntakeForClient,
};
