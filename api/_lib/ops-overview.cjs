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

// Stage cost entries come from two writers with different field names:
// scout-brief stages (optimizer.js computeStageCost) write `estimatedUsd`,
// intake/skill stages (_llm-client extractUsage) write `estimatedCostUsd`.
function stageCostUsd(stage) {
  if (typeof stage?.estimatedCostUsd === 'number') return stage.estimatedCostUsd;
  if (typeof stage?.estimatedUsd === 'number') return stage.estimatedUsd;
  return 0;
}

function extractCost(run) {
  const usage = run?.providerUsage;
  if (!usage) return null;
  if (typeof usage.estimatedCostUsd === 'number') return usage.estimatedCostUsd;
  if (Array.isArray(usage.stageCosts)) {
    return usage.stageCosts.reduce((sum, stage) => sum + stageCostUsd(stage), 0);
  }
  return null;
}

// Brief naming mirrors features/scout-intake/brief-sections.cjs so the ops
// surface labels runs the same way the dashboard nav does.
const { BRIEF_COMPOSITIONS, BRIEF_PRODUCERS } = require('../../features/scout-intake/brief-sections.cjs');

function sameIdSet(a, b) {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

function briefLabelForRun(run) {
  if (!run) return null;
  const scope = run.scope || null;
  if (scope && BRIEF_COMPOSITIONS[scope]) return BRIEF_COMPOSITIONS[scope].label;
  if (run.pipelineType === 'module-run') {
    const ids = Array.isArray(run.moduleIds) ? run.moduleIds : [];
    for (const [briefKey, producer] of Object.entries(BRIEF_PRODUCERS)) {
      if (sameIdSet(ids, producer.modules || [])) {
        return BRIEF_COMPOSITIONS[briefKey]?.label || briefKey;
      }
    }
    return `Module Run${ids.length ? ` — ${ids.join(', ')}` : ''}`;
  }
  if (run.pipelineType === 'free-tier-intake') return 'Website Intake Audit';
  if (run.pipelineType === 'scout-brief') return BRIEF_COMPOSITIONS['executive-daily']?.label || 'Executive Daily Brief';
  return 'Brief Run';
}

// Normalized per-stage cost rows for UI display, tolerant of both writer shapes.
function normalizedStageCosts(run) {
  const stages = run?.providerUsage?.stageCosts;
  if (!Array.isArray(stages)) return [];
  return stages.map((stage) => ({
    stage: stage?.stage || 'unknown',
    model: stage?.model || null,
    provider: stage?.provider || null,
    inputTokens: Number(stage?.inputTokens) || 0,
    outputTokens: Number(stage?.outputTokens) || 0,
    costUsd: stageCostUsd(stage),
  }));
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

async function readUsageEvents() {
  // Cap reads at 2000 most-recent events. Bigger horizons can move to a
  // pre-aggregated doc if/when this grows expensive.
  try {
    const snap = await fb.adminDb.collection('usage_events')
      .orderBy('createdAt', 'desc')
      .limit(2000)
      .get();
    return snap.docs.map(serializeDoc);
  } catch (err) {
    // First run before the collection exists, or missing index — degrade gracefully.
    console.warn('[ops-overview] usage_events read failed:', err?.message || err);
    return [];
  }
}

function aggregateUsageEvents(events) {
  const totalCostUsd = events.reduce((sum, e) => sum + (Number(e.estimatedCostUsd) || 0), 0);

  const byModuleMap   = new Map();
  const byProviderMap = new Map();

  for (const e of events) {
    const mod  = e.module   || 'unknown';
    const prov = e.provider || 'unknown';
    const cost = Number(e.estimatedCostUsd) || 0;

    const m = byModuleMap.get(mod) || { module: mod, eventCount: 0, costUsd: 0 };
    m.eventCount += 1;
    m.costUsd    += cost;
    byModuleMap.set(mod, m);

    const p = byProviderMap.get(prov) || { provider: prov, eventCount: 0, costUsd: 0 };
    p.eventCount += 1;
    p.costUsd    += cost;
    byProviderMap.set(prov, p);
  }

  const round4 = (n) => Math.round(n * 10000) / 10000;
  const finalize = (rows) => rows
    .map((r) => ({ ...r, costUsd: round4(r.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalCostUsd: round4(totalCostUsd),
    eventCount:   events.length,
    byModule:     finalize(Array.from(byModuleMap.values())),
    byProvider:   finalize(Array.from(byProviderMap.values())),
    // Already ordered desc by createdAt from the query — slice off the first 20.
    recentEvents: events.slice(0, 20),
  };
}

async function buildOpsOverview() {
  const [clientsSnap, runsSnap, clientConfigsSnap, dashboardStatesSnap, browserlessRequestsSnap, usageEvents] = await Promise.all([
    fb.adminDb.collection('clients').get(),
    fb.adminDb.collection('brief_runs').get(),
    fb.adminDb.collection('client_configs').get(),
    fb.adminDb.collection('dashboard_state').get(),
    // Read a large window so aggregates (count, succeeded/failed, bytes, avg duration)
    // reflect lifetime activity, not just the last 50. The display table still slices 50.
    fb.adminDb.collection('browserless_requests').orderBy('createdAt', 'desc').limit(2000).get(),
    readUsageEvents(),
  ]);

  const clients = clientsSnap.docs.map(serializeDoc);
  const runs = runsSnap.docs.map(serializeDoc);
  const clientConfigs = clientConfigsSnap.docs.map(serializeDoc);
  const dashboardStates = dashboardStatesSnap.docs.map(serializeDoc);
  const browserlessRequestsAll = browserlessRequestsSnap.docs.map(serializeDoc);
  const browserlessRequests    = browserlessRequestsAll.slice(0, 50); // table-display window
  const moduleUsage = aggregateUsageEvents(usageEvents);

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

  const sortedRuns = [...runs]
    .sort(
      (a, b) => toIsoSortValue(b.createdAt || b.startedAt || b.updatedAt) - toIsoSortValue(a.createdAt || a.startedAt || a.updatedAt)
    )
    .map((run) => ({ ...run, briefLabel: briefLabelForRun(run) }));
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

  // Per-client spend combines both cost sources: brief_runs providerUsage
  // (pipeline stages) + usage_events (module/provider calls logged outside a
  // run, e.g. brand-system, leadgen). Together they are the client's true
  // cost to date — what onboarding + every rerun actually spent.
  const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
  const moduleCostByClientId = {};
  usageEvents.forEach((event) => {
    if (!event.clientId) return;
    moduleCostByClientId[event.clientId] =
      (moduleCostByClientId[event.clientId] || 0) + (Number(event.estimatedCostUsd) || 0);
  });
  const runsCostByClientId = {};
  pricedRuns.forEach((entry) => {
    const key = entry.clientId || 'unknown';
    runsCostByClientId[key] = (runsCostByClientId[key] || 0) + entry.cost;
  });
  const costClientIds = Array.from(
    new Set([...Object.keys(runsCostByClientId), ...Object.keys(moduleCostByClientId)])
  );
  const costByClient = costClientIds
    .map((id) => {
      const runsCostUsd = round4(runsCostByClientId[id] || 0);
      const moduleCostUsd = round4(moduleCostByClientId[id] || 0);
      return {
        clientId: id,
        name: clientNameById[id] || id || 'Unknown',
        runsCostUsd,
        moduleCostUsd,
        totalCostUsd: round4(runsCostUsd + moduleCostUsd),
      };
    })
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
  // Aggregates use the full read window (browserlessRequestsAll), not the
  // 50-row display slice. Display table continues to use `browserlessRequests`.
  const hasBrowserlessRequests = browserlessRequestsAll.length > 0;
  const succeededBrowserlessRequests = browserlessRequestsAll.filter((request) => request.status === 'succeeded');
  const failedBrowserlessRequests = browserlessRequestsAll.filter((request) => request.status === 'failed');
  const browserlessBytesReturned = succeededBrowserlessRequests.reduce(
    (sum, request) => sum + (request.bytesReturned || 0),
    0
  );
  const browserlessDurationSamples = browserlessRequestsAll
    .map((request) => request.durationMs)
    .filter((duration) => typeof duration === 'number');
  const averageBrowserlessDurationMs = browserlessDurationSamples.length
    ? browserlessDurationSamples.reduce((sum, duration) => sum + duration, 0) / browserlessDurationSamples.length
    : 0;
  const latestBrowserlessRequest = browserlessRequestsAll[0] || null;

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
      // Module-level spend (leadgen, brand-system, etc.) tracked via usage_events.
      // `combinedCostUsd` is the sum of brief_runs (scout-intake) + module spend.
      moduleCostUsd:   moduleUsage.totalCostUsd,
      moduleEventCount: moduleUsage.eventCount,
      combinedCostUsd: Math.round((totalCostUsd + moduleUsage.totalCostUsd) * 10000) / 10000,
      configsTracked: clientConfigs.length,
      dashboardStatesTracked: dashboardStates.length,
      seoAuditsTracked: dashboardStates.filter((state) => state?.seoAudit).length,
      browserlessRequests: browserlessRequestsAll.length,
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
      browserlessRequests: browserlessRequestsAll.length,
    },
    costByClient,
    moduleUsage,
    // Hero payload for the "last brief run" section — the latest run with its
    // resolved brief name and a normalized per-stage cost breakdown.
    lastBriefRun: latestRun
      ? (() => {
          const runCost = extractCost(latestRun);
          // Onboarding chain: a chained scout-brief carries parentRunId
          // pointing at the intake run that preceded it. Chain cost = both
          // runs together — the real "what did onboarding cost" number.
          const parentRun = latestRun.parentRunId
            ? sortedRuns.find((run) => run.id === latestRun.parentRunId) || null
            : null;
          const parentRunCostUsd = parentRun ? extractCost(parentRun) : null;
          const chainCostUsd =
            parentRun && (typeof runCost === 'number' || typeof parentRunCostUsd === 'number')
              ? round4((runCost || 0) + (parentRunCostUsd || 0))
              : null;
          const clientRunsCostUsd = round4(runsCostByClientId[latestRun.clientId] || 0);
          const clientModuleCostUsd = round4(moduleCostByClientId[latestRun.clientId] || 0);
          return {
            runId: latestRun.id,
            clientId: latestRun.clientId || null,
            clientName: clientNameById[latestRun.clientId] || latestRun.clientId || null,
            briefLabel: briefLabelForRun(latestRun),
            status: latestRun.status || 'unknown',
            trigger: latestRun.trigger || null,
            scope: latestRun.scope || null,
            pipelineType: latestRun.pipelineType || null,
            startedAt: latestRun.startedAt || latestRun.createdAt || null,
            completedAt: latestRun.completedAt || null,
            totalCostUsd: runCost,
            stageCosts: normalizedStageCosts(latestRun),
            parentRunId: latestRun.parentRunId || null,
            parentRunCostUsd,
            chainCostUsd,
            clientRunsCostUsd,
            clientModuleCostUsd,
            clientTotalCostUsd: round4(clientRunsCostUsd + clientModuleCostUsd),
          };
        })()
      : null,
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
