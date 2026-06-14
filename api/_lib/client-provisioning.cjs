const fb = require('./firebase-admin.cjs');
const crypto = require('crypto');
const { getMaster, listSources }        = require('../../features/intelligence/_store');
const { buildIntelligencePayload }      = require('./intelligence-bootstrap-utils.cjs');
const { getDefaultModuleConfig, getDefaultModuleState } = require('../../features/scout-intake/module-registry');
const { logWarn } = require('./observability.cjs');

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

function normalizeAdminEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getRequestedClientIdFromRequest(request) {
  try {
    const url = new URL(request.url);
    return String(url.searchParams.get('as') || '').trim() || null;
  } catch {
    return null;
  }
}

function prospectClientId(placeId) {
  const digest = crypto.createHash('sha256').update(String(placeId || '')).digest('hex').slice(0, 16);
  return `prospect-${digest}`;
}

async function loadAdminAccess(email) {
  const adminEmail = normalizeAdminEmail(email);
  if (!adminEmail) return { isAdmin: false, adminEmail: null, dashboardIds: [] };

  const snap = await fb.adminDb.collection('admins').doc(adminEmail).get();
  if (!snap.exists) return { isAdmin: false, adminEmail, dashboardIds: [] };

  const data = snap.data() || {};
  return {
    isAdmin: true,
    adminEmail,
    dashboardIds: Array.isArray(data.adminDashboards)
      ? data.adminDashboards.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
      : [],
  };
}

async function listAdminDashboards(email) {
  const access = await loadAdminAccess(email);
  if (!access.isAdmin) return [];

  const clientSnaps = await fb.adminDb.collection('clients').get();
  const allClientIds = clientSnaps.docs.map((doc) => doc.id).filter(Boolean);
  const uniqueIds = Array.from(new Set([...access.dashboardIds, ...allClientIds]));

  const docs = await Promise.all(uniqueIds.map(async (clientId) => {
    const [clientSnap, dashSnap] = await Promise.all([
      fb.adminDb.collection('clients').doc(clientId).get(),
      fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    ]);
    const client = clientSnap.exists ? clientSnap.data() : null;
    const dash = dashSnap.exists ? dashSnap.data() : null;
    return {
      clientId,
      name: client?.companyName || client?.dashboardTitle || dash?.companyName || dash?.clientName || clientId,
      websiteUrl: client?.websiteUrl || dash?.websiteUrl || null,
      source: client?.source || dash?.source || null,
    };
  }));

  return docs.sort((a, b) => String(a.name || a.clientId).localeCompare(String(b.name || b.clientId)));
}

async function canAdminAccessClient(email, clientId) {
  const access = await loadAdminAccess(email);
  if (!access.isAdmin) return false;
  if (access.dashboardIds.includes(clientId)) return true;

  const clientSnap = await fb.adminDb.collection('clients').doc(clientId).get();
  return clientSnap.exists;
}

async function getEffectiveClientContext({ uid, email, request, requestedClientId }) {
  const userSnapshot = await fb.adminDb.collection('users').doc(uid).get();
  const userProfile = userSnapshot.exists ? userSnapshot.data() : null;
  const ownClientId = userProfile?.clientId || null;
  const requested = String(requestedClientId || getRequestedClientIdFromRequest(request) || '').trim() || null;

  if (!requested || requested === ownClientId) {
    return {
      uid,
      userProfile,
      ownClientId,
      clientId: ownClientId,
      requestedClientId: requested,
      impersonating: false,
      isAdmin: false,
      adminDashboards: [],
    };
  }

  const adminAccess = await loadAdminAccess(email);
  if (!adminAccess.isAdmin) {
    const err = new Error('Forbidden: admin access required for dashboard impersonation.');
    err.status = 403;
    throw err;
  }

  if (!(await canAdminAccessClient(email, requested))) {
    const err = new Error('Forbidden: dashboard is not provisioned for this admin.');
    err.status = 403;
    throw err;
  }

  return {
    uid,
    userProfile,
    ownClientId,
    clientId: requested,
    requestedClientId: requested,
    impersonating: true,
    isAdmin: true,
    adminDashboards: await listAdminDashboards(email),
  };
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

  // Signup can land on the dashboard before the user->client link is visible
  // everywhere. If a client was already created for this owner, repair the
  // user doc link instead of creating a duplicate workspace.
  const ownedClientSnapshot = await fb.adminDb
    .collection('clients')
    .where('ownerUid', '==', uid)
    .limit(1)
    .get();

  if (!ownedClientSnapshot.empty) {
    const existingClient = ownedClientSnapshot.docs[0];
    const existingClientData = existingClient.data() || null;
    await userRef.set(
      {
        clientId: existingClient.id,
        role: 'owner',
        websiteUrl: existingClientData?.websiteUrl || normalized?.websiteUrl || '',
        updatedAt: fb.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      clientId: existingClient.id,
      client: existingClientData,
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
    entryMode: normalized ? 'website' : 'no_website',
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
    // entryMode drives conversation branching at runtime (see
    // features/scout-intake/conversation-router.js). Mirrors clients.entryMode;
    // kept on the config doc so the pipeline receives it without a second read.
    entryMode: normalized ? 'website' : 'no_website',
    sourceInputs: {
      websiteUrl: normalized?.websiteUrl || '',
      ideaDescription: trimmedIdeaDescription,
      uploadedImageRefs: [],
    },
    onboardingAnswers: null,
    ingestionConfig: null,
    briefConfig: null,
    dashboardConfig: null,
    providerConfig: {
      defaultProvider: 'anthropic',
    },
    moduleFlags: {},
    moduleConfig: getDefaultModuleConfig(),
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
    modules: getDefaultModuleState(Boolean(normalized?.websiteUrl)),
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

  // Non-fatal: register the new clientId in the admin's dashboard list if applicable.
  try {
    const access = await loadAdminAccess(email);
    if (access.isAdmin) {
      await fb.adminDb.collection('admins').doc(access.adminEmail).set(
        {
          adminDashboards: fb.FieldValue.arrayUnion(clientId),
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (adminWriteErr) {
    console.warn('[provisionClientForUser] non-fatal: failed to update adminDashboards', adminWriteErr?.message);
  }

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

/**
 * Admin-created, website-less client. Unlike provisionClientForUser this does
 * NOT link the admin's own user record (so the admin can own many separate
 * workspaces), is always website-less (idea-only), and never queues a brief.
 * The new client is registered in the admin's adminDashboards roster so it is
 * reachable from the dashboard client switcher (impersonation).
 *
 * @param {{ adminUid: string, adminEmail: string, companyName: string, ideaDescription?: string }} input
 * @returns {Promise<{ clientId: string, client: object }>}
 */
async function createWebsitelessClient({ adminUid, adminEmail, companyName, ideaDescription }) {
  const resolvedCompanyName = deriveCompanyName({
    companyName,
    hostname: '',
    displayName: '',
    email: adminEmail,
  });
  const trimmedIdeaDescription = String(ideaDescription || '').trim();
  if (!resolvedCompanyName) {
    const err = new Error('Provide a client name.');
    err.status = 400;
    throw err;
  }

  const clientKey = slugify(resolvedCompanyName || 'client');
  const autoId = fb.adminDb.collection('clients').doc().id;
  const clientId = `${clientKey}-${autoId.slice(0, 8)}`;
  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const memberRef = clientRef.collection('members').doc(adminUid);
  const onboardingRef = clientRef.collection('system').doc('onboarding');
  const clientConfigRef = fb.adminDb.collection('client_configs').doc(clientId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);
  const now = fb.FieldValue.serverTimestamp();

  const clientPayload = {
    clientId,
    ownerUid: adminUid,
    ownerEmail: adminEmail || '',
    ownerDisplayName: '',
    companyName: resolvedCompanyName,
    dashboardTitle: buildDashboardTitle(resolvedCompanyName),
    dashboardDescription: 'Website-less workspace. Feed it via uploads (brain) and a brief run.',
    websiteUrl: '',
    normalizedOrigin: '',
    normalizedHost: '',
    status: 'active',
    onboardingStatus: 'intake_received',
    pipelineType: 'free-tier-intake',
    activeModules: [],
    activeAddOns: [],
    pricingTier: 'starter',
    providerStrategy: 'anthropic',
    active: true,
    adminCreated: true,
    latestRunId: null,
    latestRunStatus: null,
    createdAt: now,
    updatedAt: now,
  };

  await Promise.all([
    clientRef.set(clientPayload),
    memberRef.set({
      uid: adminUid,
      email: adminEmail || '',
      displayName: '',
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }),
    onboardingRef.set({
      state: 'intake_received',
      sourceUrl: '',
      ideaDescription: trimmedIdeaDescription,
      queuedAt: null,
      updatedAt: now,
    }),
    clientConfigRef.set({
      clientId,
      sourceInputs: {
        websiteUrl: '',
        ideaDescription: trimmedIdeaDescription,
        uploadedImageRefs: [],
      },
      onboardingAnswers: null,
      ingestionConfig: null,
      briefConfig: null,
      dashboardConfig: null,
      providerConfig: { defaultProvider: 'anthropic' },
      moduleFlags: {},
      moduleConfig: getDefaultModuleConfig(),
      createdAt: now,
      updatedAt: now,
    }),
    dashboardStateRef.set({
      clientId,
      status: 'active',
      headline: null,
      summaryCards: [],
      latestInsights: [],
      latestRunId: null,
      latestRunStatus: null,
      modules: getDefaultModuleState(false),
      updatedAt: now,
      provisioningState: {
        startedAt: now,
        message: 'Website-less workspace ready. Upload to the brain and run a brief.',
      },
      errorState: null,
    }),
  ]);

  // Register in the admin roster so it appears in the client switcher.
  try {
    const access = await loadAdminAccess(adminEmail);
    if (access.isAdmin) {
      await fb.adminDb.collection('admins').doc(access.adminEmail).set(
        {
          adminDashboards: fb.FieldValue.arrayUnion(clientId),
          updatedAt: fb.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (adminWriteErr) {
    console.warn('[createWebsitelessClient] non-fatal: failed to update adminDashboards', adminWriteErr?.message);
  }

  return { clientId, client: clientPayload };
}

function inferModuleStateFromDashboard(dashboardState) {
  const base = getDefaultModuleState(false);
  if (!dashboardState) return base;

  if (dashboardState.artifacts?.homepageDeviceMockup) {
    base['multi-device-view'] = { status: 'succeeded', enabled: true };
  }

  const seoStatus = dashboardState.seoAudit?.status;
  if (seoStatus === 'ok' || seoStatus === 'partial') {
    base['seo-performance'] = { status: 'succeeded', enabled: true };
  }

  if (dashboardState.siteMeta) {
    base['social-preview'] = { status: 'succeeded', enabled: true };
  }

  return base;
}

async function getDashboardBootstrap(input) {
  const opts = typeof input === 'string' ? { uid: input } : (input || {});
  const context = await getEffectiveClientContext(opts);
  const { uid, userProfile, clientId, ownClientId, impersonating } = context;

  if (!userProfile) {
    return {
      userProfile: null,
      client: null,
      dashboardState: null,
      recentRuns: [],
      effectiveClientId: null,
      ownClientId: null,
      impersonating: false,
      adminDashboards: [],
    };
  }

  if (!clientId) {
    return {
      userProfile,
      client: null,
      dashboardState: null,
      recentRuns: [],
      effectiveClientId: null,
      ownClientId,
      impersonating: false,
      adminDashboards: await listAdminDashboards(opts.email),
    };
  }

  const [clientSnapshot, runsSnapshot, dashboardStateSnapshot, clientConfigSnapshot, earliestRunsSnapshot] = await Promise.all([
    fb.adminDb.collection('clients').doc(clientId).get(),
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').orderBy('createdAt', 'desc').limit(8).get(),
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
    fb.adminDb.collection('client_configs').doc(clientId).get(),
    // Earliest runs (asc) — used to identify the client's FIRST brief, which is
    // labeled the Onboarding Brief everywhere; later briefs are Executive.
    // Scanned in JS (single-field createdAt index) to avoid a composite index.
    fb.adminDb.collection('clients').doc(clientId).collection('brief_runs').orderBy('createdAt', 'asc').limit(50).get(),
  ]);

  const clientData = clientSnapshot.exists ? clientSnapshot.data() : null;

  // The Onboarding Brief is the client's chronologically-first *surfaced* brief
  // — the earliest scout-brief run (the type the brief view + past-briefs list
  // render). Every scout-brief after it is an Executive Brief. Derived at read
  // time so existing clients and new signups label consistently, no migration.
  // (free-tier-intake is signup processing, not a viewable brief, so excluded.)
  const onboardingRunId = (() => {
    const first = earliestRunsSnapshot.docs.find((d) => d.data()?.pipelineType === 'scout-brief');
    return first ? first.id : null;
  })();

  // Read intelligence namespace — non-fatal if absent or fails
  let intelligence = null;
  try {
    const [masterDoc, sourceDocs] = await Promise.all([
      getMaster(clientId),
      listSources(clientId),
    ]);
    if (masterDoc || sourceDocs.length > 0) {
      intelligence = buildIntelligencePayload(
        masterDoc,
        sourceDocs,
        clientData?.websiteUrl || ''
      );
    }
  } catch (err) {
    logWarn('dashboard_bootstrap_intelligence_read_failed', {
      clientId,
      error: err.message,
    });
  }

  const dashboardState = dashboardStateSnapshot.exists ? dashboardStateSnapshot.data() : null;
  const clientConfig  = clientConfigSnapshot.exists ? clientConfigSnapshot.data() : null;

  // Onboarding survey summary — lightweight subset of onboardingAnswers for card status.
  const onboardingAnswers = clientConfig?.onboardingAnswers || null;
  const _rawAnswers = onboardingAnswers?.answers || {};
  const answeredCount = Object.values(_rawAnswers).filter((a) => a && !a.skipped && a.value != null).length;
  const onboardingSummary = {
    total: 10,
    answeredCount,
    completedAt: onboardingAnswers?.completedAt || null,
    skippedAt: onboardingAnswers?.skippedAt || null,
  };

  // Always return registry-derived defaults — stored values win; inferred values fill gaps.
  const storedModuleConfig = clientConfig?.moduleConfig;
  const storedModuleState  = dashboardState?.modules;

  // Always construct a response-local config object so bootstrap can reconcile
  // legacy contradictions without mutating Firestore state.
  const moduleConfig = {
    ...getDefaultModuleConfig(),
    ...(storedModuleConfig || {}),
  };
  const moduleState  = storedModuleState || inferModuleStateFromDashboard(dashboardState);

  // Reconcile response payload: for legacy clients with no stored config, infer
  // enabled=true from succeeded status. When storedModuleConfig has an explicit
  // entry for a card, trust it — the user may have deliberately disabled a
  // card that previously succeeded via the config endpoint.
  for (const [cardId, cardState] of Object.entries(moduleState)) {
    if (cardState?.status === 'succeeded') {
      const hasExplicitConfig = storedModuleConfig != null &&
        Object.prototype.hasOwnProperty.call(storedModuleConfig, cardId);
      if (!hasExplicitConfig) {
        moduleConfig[cardId] = { ...(moduleConfig[cardId] || {}), enabled: true };
      }
    }
  }

  return {
    userProfile: {
      ...userProfile,
      effectiveClientId: clientId,
    },
    client:         clientData,
    dashboardState,
    recentRuns:     runsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    onboardingRunId,
    intelligence,
    moduleConfig,
    moduleState,
    onboardingSummary,
    effectiveClientId: clientId,
    ownClientId,
    impersonating,
    adminDashboards: context.adminDashboards.length
      ? context.adminDashboards
      : await listAdminDashboards(opts.email),
  };
}

async function provisionClientFromProspect({ placeId, adminUid, adminEmail }) {
  const trimmedPlaceId = String(placeId || '').trim();
  if (!trimmedPlaceId) {
    const err = new Error('placeId is required.');
    err.status = 400;
    throw err;
  }

  const adminAccess = await loadAdminAccess(adminEmail);
  if (!adminAccess.isAdmin) {
    const err = new Error('Forbidden: admin access required.');
    err.status = 403;
    throw err;
  }

  const prospectRef = fb.adminDb.collection('leadgen_prospects').doc(trimmedPlaceId);
  const prospectSnap = await prospectRef.get();
  if (!prospectSnap.exists) {
    const err = new Error('Prospect not found.');
    err.status = 404;
    throw err;
  }

  const prospect = prospectSnap.data() || {};
  const normalized = normalizeOptionalUrl(
    prospect.generation?.previewUrl ||
    prospect.website ||
    prospect.websiteUrl ||
    ''
  );
  const clientId = prospect.dashboard?.clientId || prospectClientId(trimmedPlaceId);
  const now = fb.FieldValue.serverTimestamp();
  const name = prospect.name || deriveCompanyName({
    companyName: prospect.companyName,
    hostname: normalized?.hostname || '',
    displayName: '',
    email: '',
  });

  const clientRef = fb.adminDb.collection('clients').doc(clientId);
  const clientSnap = await clientRef.get();
  const alreadyExisted = clientSnap.exists;
  const clientConfigRef = fb.adminDb.collection('client_configs').doc(clientId);
  const dashboardStateRef = fb.adminDb.collection('dashboard_state').doc(clientId);

  const clientPayload = {
    clientId,
    source: 'leadgen-prospect',
    sourcePlaceId: trimmedPlaceId,
    ownerUid: adminUid || '',
    ownerEmail: normalizeAdminEmail(adminEmail),
    companyName: name,
    dashboardTitle: buildDashboardTitle(name),
    dashboardDescription: `Lead Gen dashboard seeded from ${name}.`,
    websiteUrl: normalized?.websiteUrl || prospect.website || '',
    normalizedOrigin: normalized?.origin || '',
    normalizedHost: normalized?.hostname || '',
    status: 'active',
    onboardingStatus: 'leadgen_seeded',
    pipelineType: 'leadgen-prospect',
    activeModules: [],
    activeAddOns: [],
    pricingTier: 'starter',
    providerStrategy: 'anthropic',
    active: true,
    latestRunId: null,
    latestRunStatus: null,
    createdAt: alreadyExisted ? clientSnap.data()?.createdAt || now : now,
    updatedAt: now,
  };

  const clientConfigPayload = {
    clientId,
    sourceInputs: {
      websiteUrl: normalized?.websiteUrl || prospect.website || '',
      ideaDescription: prospect.generation?.designMd || prospect.description || '',
      uploadedImageRefs: [],
    },
    leadgenProspect: {
      placeId: trimmedPlaceId,
      score: prospect.score ?? null,
      tier: prospect.tier || null,
      vertical: prospect.vertical || null,
      previewUrl: prospect.generation?.previewUrl || null,
      mockupUrl: prospect.generation?.mockupUrl || null,
    },
    onboardingAnswers: null,
    ingestionConfig: null,
    briefConfig: null,
    dashboardConfig: null,
    providerConfig: { defaultProvider: 'anthropic' },
    moduleFlags: {},
    moduleConfig: getDefaultModuleConfig(),
    createdAt: alreadyExisted ? undefined : now,
    updatedAt: now,
  };

  const dashboardStatePayload = {
    clientId,
    source: 'leadgen-prospect',
    sourcePlaceId: trimmedPlaceId,
    status: 'active',
    companyName: name,
    clientName: name,
    websiteUrl: normalized?.websiteUrl || prospect.website || '',
    headline: `${name} Dashboard`,
    summaryCards: [],
    latestInsights: [],
    latestRunId: null,
    latestRunStatus: null,
    modules: getDefaultModuleState(Boolean(normalized?.websiteUrl)),
    leadgen: {
      placeId: trimmedPlaceId,
      score: prospect.score ?? null,
      tier: prospect.tier || null,
      vertical: prospect.vertical || null,
      previewUrl: prospect.generation?.previewUrl || null,
      mockupUrl: prospect.generation?.mockupUrl || null,
      outreach: prospect.outreach || null,
    },
    artifacts: {
      homepageDeviceMockup: prospect.generation?.mockupUrl
        ? { downloadUrl: prospect.generation.mockupUrl, source: 'leadgen' }
        : null,
    },
    updatedAt: now,
    provisioningState: null,
    errorState: null,
  };

  const cleanClientConfigPayload = Object.fromEntries(
    Object.entries(clientConfigPayload).filter(([, value]) => value !== undefined)
  );

  const writes = [
    clientRef.set(clientPayload, { merge: true }),
    clientConfigRef.set(cleanClientConfigPayload, { merge: true }),
    dashboardStateRef.set(dashboardStatePayload, { merge: true }),
    prospectRef.set({
      dashboard: {
        clientId,
        name,
        provisionedAt: prospect.dashboard?.provisionedAt || now,
        provisionedByUid: adminUid || null,
        updatedAt: now,
      },
      stage: prospect.stage === 'contacted' ? prospect.stage : 'packaged',
      updatedAt: now,
    }, { merge: true }),
    fb.adminDb.collection('admins').doc(adminAccess.adminEmail).set({
      adminDashboards: fb.FieldValue.arrayUnion(clientId),
      updatedAt: now,
    }, { merge: true }),
  ];

  if (adminUid) {
    writes.push(
      clientRef.collection('members').doc(adminUid).set({
        uid: adminUid,
        email: normalizeAdminEmail(adminEmail),
        role: 'admin',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }, { merge: true })
    );
  }

  await Promise.all(writes);

  return { clientId, name, alreadyExisted };
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

  const existingClientSnap = await fb.adminDb.collection('clients').doc(clientId).get();
  const existingClientData = existingClientSnap.exists ? existingClientSnap.data() : null;
  const hostChanged = existingClientData?.normalizedHost !== normalized.hostname;
  const newCompanyName = hostChanged
    ? deriveCompanyName({ hostname: normalized.hostname, companyName: null, displayName: null, email: null })
    : null;

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
        entryMode: 'website',
        latestRunId: runId,
        latestRunStatus: 'queued',
        status: 'provisioning',
        updatedAt: now,
        ...(hostChanged && newCompanyName ? {
          companyName: newCompanyName,
          dashboardTitle: buildDashboardTitle(newCompanyName),
        } : {}),
      },
      { merge: true }
    ),

    // Update client_configs sourceInputs. Also clear the onboarding survey's
    // resolution flags so the bento survey reappears with the new run and the
    // user can refine answers for this build. Prior answers stay as seed.
    fb.adminDb.collection('client_configs').doc(clientId).set(
      {
        entryMode: 'website',
        sourceInputs: { websiteUrl: normalized.websiteUrl },
        onboardingAnswers: {
          completedAt: null,
          skippedAt: null,
          updatedAt: now,
        },
        updatedAt: now,
      },
      { merge: true }
    ),

    // Reset dashboard_state — clear intake fields, set provisioning.
    // snapshot is intentionally NOT cleared: it holds user-edited brandOverview
    // (source:'user'). The worker's mergeBrandOverview reconciles stale crawl
    // data on the next run — nulling it here destroys user content before the
    // merge can ever see it.
    fb.adminDb.collection('dashboard_state').doc(clientId).set(
      {
        clientId,
        status: 'provisioning',
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
  getEffectiveClientContext,
  getDashboardBootstrap,
  provisionClientFromProspect,
  provisionClientForUser,
  createWebsitelessClient,
  reseedIntakeForClient,
};
