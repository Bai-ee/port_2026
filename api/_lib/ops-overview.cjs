const fb = require('./firebase-admin.cjs');

function serializeValue(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'object' && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000).toISOString();
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, serializeValue(nested)]));
  }
  return value;
}

function serializeDoc(doc) {
  return serializeValue({ id: doc.id, ...doc.data() });
}

function extractCost(run) {
  const usage = run?.providerUsage;
  if (!usage) return null;
  if (typeof usage.estimatedCostUsd === 'number') return usage.estimatedCostUsd;
  if (Array.isArray(usage.stageCosts)) {
    return usage.stageCosts.reduce((sum, stage) => sum + (stage?.estimatedCostUsd || 0), 0);
  }
  return null;
}

function toIsoSortValue(value) {
  return value ? new Date(value).getTime() : 0;
}

const MODULAR_CARD_IDS = ['multi-device-view', 'social-preview', 'seo-performance'];

/**
 * Build a per-client module state summary for ops visibility.
 * Answers "why didn't this render for client A but did for client B?"
 */
function summarizeModuleStates(dashboardStates, clientConfigs) {
  const configById = Object.fromEntries(
    clientConfigs.map((cfg) => [cfg.id, cfg])
  );
  return dashboardStates
    .filter((ds) => ds?.modules)
    .map((ds) => {
      const cfg = configById[ds.id] || null;
      const cards = {};
      for (const cardId of MODULAR_CARD_IDS) {
        const cm = ds.modules[cardId] || null;
        const cc = cfg?.moduleConfig?.[cardId] || null;
        if (!cm && !cc) continue;
        cards[cardId] = {
          status:              cm?.status              ?? null,
          enabled:             cm?.enabled             ?? cc?.enabled ?? null,
          lastErrorCode:       cm?.lastErrorCode       ?? null,
          lastErrorMessage:    cm?.lastErrorMessage     ?? null,
          warningCodes:        cm?.warningCodes         ?? [],
          lastAttemptRunId:    cm?.lastAttemptRunId     ?? null,
          lastSuccessfulRunId: cm?.lastSuccessfulRunId  ?? null,
          lastAttemptAt:       cm?.lastAttemptAt        ?? null,
          lastSuccessAt:       cm?.lastSuccessAt        ?? null,
          artifactsCaptured:   cm?.result
            ? Object.values(cm.result).filter(Boolean).length
            : null,
        };
      }
      return {
        clientId:   ds.id,
        websiteUrl: cfg?.sourceInputs?.websiteUrl ?? ds.clientId ?? null,
        cards,
      };
    })
    .filter((s) => Object.keys(s.cards).length > 0);
}

function summarizeCollectionPresence(clientConfig, dashboardState, latestRun, latestBrowserlessRequest) {
  return [
    {
      label: 'Source Inputs',
      present: Boolean(clientConfig?.sourceInputs),
      keys: Object.keys(clientConfig?.sourceInputs || {}),
      detail: clientConfig?.sourceInputs?.websiteUrl || 'No websiteUrl stored.',
    },
    {
      label: 'Brand Snapshot',
      present: Boolean(dashboardState?.snapshot),
      keys: Object.keys(dashboardState?.snapshot || {}),
      detail: dashboardState?.snapshot?.brandOverview?.headline || 'No snapshot headline stored.',
    },
    {
      label: 'Signals',
      present: Array.isArray(dashboardState?.signals?.core) && dashboardState.signals.core.length > 0,
      keys: Object.keys(dashboardState?.signals || {}),
      detail: `${dashboardState?.signals?.core?.length || 0} core signals`,
    },
    {
      label: 'Strategy',
      present: Boolean(dashboardState?.strategy),
      keys: Object.keys(dashboardState?.strategy || {}),
      detail: dashboardState?.strategy?.postStrategy?.approach || 'No post strategy stored.',
    },
    {
      label: 'Outputs Preview',
      present: Boolean(dashboardState?.outputsPreview),
      keys: Object.keys(dashboardState?.outputsPreview || {}),
      detail: dashboardState?.outputsPreview?.samplePost || 'No preview post stored.',
    },
    {
      label: 'System Preview',
      present: Boolean(dashboardState?.systemPreview),
      keys: Object.keys(dashboardState?.systemPreview || {}),
      detail: dashboardState?.systemPreview?.nextStep || 'No next step stored.',
    },
    {
      label: 'SEO Audit',
      present: Boolean(dashboardState?.seoAudit),
      keys: Object.keys(dashboardState?.seoAudit || {}),
      detail: dashboardState?.seoAudit?.status || 'No PSI audit stored.',
    },
    {
      label: 'Screenshot Artifact',
      present: Boolean(dashboardState?.artifacts?.homepageScreenshot || latestRun?.artifactRefs?.find?.((artifact) => artifact?.type === 'website_homepage_screenshot')),
      keys: Object.keys(dashboardState?.artifacts || {}),
      detail:
        dashboardState?.artifacts?.homepageScreenshot?.storagePath ||
        latestRun?.artifactRefs?.find?.((artifact) => artifact?.type === 'website_homepage_screenshot')?.storagePath ||
        'No homepage screenshot stored.',
    },
    {
      label: 'Browserless Telemetry',
      present: Boolean(latestBrowserlessRequest),
      keys: Object.keys(latestBrowserlessRequest || {}),
      detail: latestBrowserlessRequest
        ? `${latestBrowserlessRequest.endpoint || 'request'} · ${latestBrowserlessRequest.status || 'unknown'}`
        : 'No Browserless requests recorded.',
    },
    {
      label: 'Run Usage',
      present: Boolean(latestRun?.providerUsage),
      keys: Object.keys(latestRun?.providerUsage || {}),
      detail: latestRun?.providerUsage?.model || latestRun?.providerName || 'No provider usage stored.',
    },
    {
      label: 'Module Snapshot',
      present: Boolean(latestRun?.moduleSnapshot),
      keys: Object.keys(latestRun?.moduleSnapshot || {}),
      detail: latestRun?.moduleSnapshot?.scoutPriorityAction || 'No module snapshot stored.',
    },
  ];
}

function buildTechStack(hasSeoAudit, hasBrowserlessRequests) {
  return [
    {
      stage: 'Capture',
      layer: 'Browserless screenshot capture',
      file: 'api/_lib/browserless.cjs',
      detail: 'Captures homepage screenshots, persists them to Firebase Storage, and logs Browserless request telemetry.',
      status: hasBrowserlessRequests ? 'active' : 'available',
    },
    {
      stage: 'Fetch',
      layer: 'Website evidence crawl',
      file: 'features/scout-intake/site-fetcher.js',
      detail: 'Fetches homepage and discovered supporting pages like about, pricing, and contact.',
      status: 'active',
    },
    {
      stage: 'Synthesize',
      layer: 'LLM intake extraction',
      file: 'features/scout-intake/intake-synthesizer.js',
      detail: 'Anthropic structured synthesis creates snapshot, signals, strategy, and preview outputs.',
      status: 'active',
    },
    {
      stage: 'Normalize',
      layer: 'Dashboard contract',
      file: 'features/scout-intake/normalize.js',
      detail: 'Maps synthesis output into the dashboard-safe projection and compatibility fields.',
      status: 'active',
    },
    {
      stage: 'Persist',
      layer: 'Run lifecycle + Firestore',
      file: 'api/_lib/run-lifecycle.cjs',
      detail: 'Writes brief_runs, dashboard_state, and client status updates for each intake run.',
      status: 'active',
    },
    {
      stage: 'Ops Surface',
      layer: 'Read-only telemetry endpoint',
      file: 'app/api/ops/overview/route.js',
      detail: 'Aggregates clients, runs, dashboard states, configs, costs, and payload visibility for this page.',
      status: 'active',
    },
    {
      stage: 'SEO + Performance',
      layer: 'Google PageSpeed Insights',
      file: 'features/intelligence/pagespeed.js',
      detail: 'Pulls mobile performance, CWV, accessibility, best-practices, SEO, and fast-win opportunities.',
      status: hasSeoAudit ? 'active' : 'available',
    },
  ];
}

async function buildOpsOverview() {
  const [clientsSnap, runsSnap, clientConfigsSnap, dashboardStatesSnap, browserlessRequestsSnap] = await Promise.all([
    fb.adminDb.collection('clients').get(),
    fb.adminDb.collection('brief_runs').get(),
    fb.adminDb.collection('client_configs').get(),
    fb.adminDb.collection('dashboard_state').get(),
    fb.adminDb.collection('browserless_requests').orderBy('createdAt', 'desc').limit(50).get(),
  ]);

  const clients = clientsSnap.docs.map(serializeDoc);
  const runs = runsSnap.docs.map(serializeDoc);
  const clientConfigs = clientConfigsSnap.docs.map(serializeDoc);
  const dashboardStates = dashboardStatesSnap.docs.map(serializeDoc);
  const browserlessRequests = browserlessRequestsSnap.docs.map(serializeDoc);

  const configsByClientId = Object.fromEntries(
    clientConfigs.map((config) => [config.clientId || config.id, config])
  );
  const dashboardByClientId = Object.fromEntries(
    dashboardStates.map((state) => [state.clientId || state.id, state])
  );
  const clientNameById = Object.fromEntries(
    clients.map((client) => [
      client.clientId || client.id,
      client.companyName || client.normalizedHost || client.websiteUrl || client.clientId || client.id,
    ])
  );

  const sortedRuns = [...runs].sort(
    (a, b) => toIsoSortValue(b.createdAt || b.startedAt || b.updatedAt) - toIsoSortValue(a.createdAt || a.startedAt || a.updatedAt)
  );
  const sortedClients = [...clients].sort(
    (a, b) => toIsoSortValue(b.createdAt || b.updatedAt) - toIsoSortValue(a.createdAt || a.updatedAt)
  );

  const latestRun = sortedRuns[0] || null;
  const latestClientId = latestRun?.clientId || sortedClients[0]?.clientId || sortedClients[0]?.id || null;
  const latestClient = latestClientId
    ? sortedClients.find((client) => (client.clientId || client.id) === latestClientId) || null
    : null;
  const latestClientConfig = latestClientId ? configsByClientId[latestClientId] || null : null;
  const latestDashboardState = latestClientId ? dashboardByClientId[latestClientId] || null : null;

  const pricedRuns = sortedRuns
    .map((run) => ({ runId: run.id, clientId: run.clientId || null, cost: extractCost(run) }))
    .filter((entry) => typeof entry.cost === 'number');
  const totalCostUsd = pricedRuns.reduce((sum, entry) => sum + entry.cost, 0);
  const lastRunCostUsd = extractCost(latestRun);

  const costByClientMap = {};
  pricedRuns.forEach((entry) => {
    const label = clientNameById[entry.clientId] || entry.clientId || 'Unknown';
    costByClientMap[label] = (costByClientMap[label] || 0) + entry.cost;
  });
  const costByClient = Object.entries(costByClientMap)
    .map(([name, totalCostUsd]) => ({ name, totalCostUsd }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  const statusCounts = sortedRuns.reduce((acc, run) => {
    const key = String(run.status || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const clientStatusCounts = sortedClients.reduce((acc, client) => {
    const key = String(client.status || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const hasSeoAudit = dashboardStates.some((state) => state?.seoAudit);
  const hasBrowserlessRequests = browserlessRequests.length > 0;
  const succeededBrowserlessRequests = browserlessRequests.filter((request) => request.status === 'succeeded');
  const failedBrowserlessRequests = browserlessRequests.filter((request) => request.status === 'failed');
  const browserlessBytesReturned = succeededBrowserlessRequests.reduce(
    (sum, request) => sum + (request.bytesReturned || 0),
    0
  );
  const browserlessDurationSamples = browserlessRequests
    .map((request) => request.durationMs)
    .filter((duration) => typeof duration === 'number');
  const averageBrowserlessDurationMs = browserlessDurationSamples.length
    ? browserlessDurationSamples.reduce((sum, duration) => sum + duration, 0) / browserlessDurationSamples.length
    : 0;
  const latestBrowserlessRequest = browserlessRequests[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      clients: sortedClients.length,
      activeClients: clientStatusCounts.active || 0,
      provisioningClients: clientStatusCounts.provisioning || 0,
      erroredClients: clientStatusCounts.error || 0,
      totalRuns: sortedRuns.length,
      succeededRuns: statusCounts.succeeded || 0,
      failedRuns: statusCounts.failed || 0,
      queuedRuns: statusCounts.queued || 0,
      runningRuns: statusCounts.running || 0,
      cancelledRuns: statusCounts.cancelled || 0,
      totalCostUsd,
      lastRunCostUsd,
      averageRunCostUsd: pricedRuns.length ? totalCostUsd / pricedRuns.length : 0,
      pricedRunCount: pricedRuns.length,
      configsTracked: clientConfigs.length,
      dashboardStatesTracked: dashboardStates.length,
      seoAuditsTracked: dashboardStates.filter((state) => state?.seoAudit).length,
      browserlessRequests: browserlessRequests.length,
      browserlessSucceeded: succeededBrowserlessRequests.length,
      browserlessFailed: failedBrowserlessRequests.length,
      browserlessBytesReturned,
      averageBrowserlessDurationMs,
    },
    collectionCounts: {
      clients: clients.length,
      briefRuns: runs.length,
      clientConfigs: clientConfigs.length,
      dashboardStates: dashboardStates.length,
      browserlessRequests: browserlessRequests.length,
    },
    costByClient,
    techStack: buildTechStack(hasSeoAudit, hasBrowserlessRequests),
    dataInventory: summarizeCollectionPresence(latestClientConfig, latestDashboardState, latestRun, latestBrowserlessRequest),
    latest: {
      clientId: latestClientId,
      clientRecord: latestClient,
      clientConfig: latestClientConfig,
      dashboardState: latestDashboardState,
      latestRun,
      seoAudit: latestDashboardState?.seoAudit || null,
      browserlessRequest: latestBrowserlessRequest,
    },
    clients: sortedClients,
    clientConfigs,
    dashboardStates,
    runs: sortedRuns,
    browserlessRequests,
    modulesSummary: summarizeModuleStates(dashboardStates, clientConfigs),
  };
}

module.exports = {
  buildOpsOverview,
};
