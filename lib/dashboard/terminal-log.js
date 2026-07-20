// Run/build terminal log formatters — converts run + progress state into
// the IDE-style terminal lines shown in the build/module/growth-engine
// modals. Extracted from DashboardPage.jsx module scope (Phase 2
// decomposition) — move-only, no behavior change.

export function buildModalSteps(run, dashboardState, latestRunStatus, client) {
  const progress = run?.progress || {};
  const stage = progress?.stage;
  const stageOrder = ['fetch', 'analyze', 'synthesize', 'compose', 'normalize'];
  const idx = stageOrder.indexOf(stage);

  const host = client?.normalizedHost
    || (run?.sourceUrl
      ? (() => { try { return new URL(run.sourceUrl).hostname.replace(/^www\./, ''); } catch { return run.sourceUrl; } })()
      : null)
    || '—';

  const pageCount = progress?.pagesFetched;
  const pages = Array.isArray(progress?.pages) ? progress.pages : [];

  if (latestRunStatus === 'failed') {
    return [
      { state: 'error', text: dashboardState?.errorState?.message || 'Setup encountered an issue.' },
    ];
  }

  if (latestRunStatus === 'queued') {
    return [
      { state: 'waiting', text: `Starting up for ${host}` },
      { state: 'pending', text: 'Fetch pages' },
      { state: 'pending', text: 'Extract site content' },
      { state: 'pending', text: 'Analyze brand & voice' },
      { state: 'pending', text: 'Render device mockup' },
      { state: 'pending', text: 'Build content strategy' },
      { state: 'pending', text: 'Write dashboard modules' },
    ];
  }

  // Running — worker claimed but no stage written yet
  if (idx < 0) {
    return [
      { state: 'waiting', text: 'Starting pipeline...' },
      { state: 'pending', text: 'Fetch pages' },
      { state: 'pending', text: 'Extract site content' },
      { state: 'pending', text: 'Analyze brand & voice' },
      { state: 'pending', text: 'Render device mockup' },
      { state: 'pending', text: 'Write dashboard modules' },
    ];
  }

  const steps = [];

  // fetch (idx 0)
  steps.push({
    state: idx > 0 ? 'done' : 'active',
    text: idx > 0 ? `Connected — ${host}` : `Connecting to ${host}...`,
  });

  // analyze (idx 1) — pages fetched + evidence
  if (idx >= 1) {
    steps.push({
      state: 'done',
      text: pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''} discovered` : 'Pages discovered',
    });
    for (const p of pages.slice(0, 4)) {
      const label = (p.title || p.headline || '').slice(0, 52);
      if (label) steps.push({ state: 'sub', text: `"${label}"`, indent: true });
    }
    if (idx === 1) {
      steps.push({ state: 'active', text: 'Extracting headlines & content...' });
      steps.push({ state: 'pending', text: 'Analyze brand & voice' });
      steps.push({ state: 'pending', text: 'Render device mockup' });
      steps.push({ state: 'pending', text: 'Write dashboard modules' });
    }
  }

  if (idx > 1) {
    steps.push({ state: 'done', text: 'Site content extracted' });
  }

  // synthesize (idx 2)
  if (idx >= 2) {
    if (idx === 2) {
      steps.push({ state: 'active', text: 'Analyzing brand & voice...' });
      steps.push({ state: 'pending-sub', text: 'Mapping tone & positioning', indent: true });
      steps.push({ state: 'pending-sub', text: 'Generating content angles', indent: true });
      steps.push({ state: 'pending-sub', text: 'Identifying brand signals', indent: true });
      steps.push({ state: 'pending', text: 'Render device mockup' });
      steps.push({ state: 'pending', text: 'Write dashboard modules' });
    } else {
      steps.push({ state: 'done', text: 'Brand analysis complete' });
    }
  }

  // compose (idx 3)
  if (idx >= 3) {
    if (idx === 3) {
      steps.push({ state: 'active', text: 'Rendering device mockup...' });
      steps.push({ state: 'pending-sub', text: 'Downloading desktop, tablet, and mobile captures', indent: true });
      steps.push({ state: 'pending-sub', text: 'Compositing into clay template', indent: true });
      steps.push({ state: 'pending', text: 'Write dashboard modules' });
    } else {
      steps.push({ state: 'done', text: 'Device mockup rendered' });
    }
  }

  // normalize (idx 4)
  if (idx >= 4) {
    steps.push({ state: 'active', text: 'Writing dashboard modules...' });
  }

  return steps;
}
// ── Module terminal stages ────────────────────────────────────────────────────
export const MODULE_TERMINAL_STAGES = {
  'multi-device-view': [
    { tag: 'FETCH',   label: 'Connect to website' },
    { tag: 'SCREEN',  label: 'Capture homepage screenshots' },
    { tag: 'SCREEN',  label: 'Generate desktop / tablet / mobile views' },
    { tag: 'MOCK',    label: 'Build device mockup' },
    { tag: 'WRITE',   label: 'Write layout module' },
  ],
  'social-preview': [
    { tag: 'FETCH',   label: 'Fetch homepage' },
    { tag: 'META',    label: 'Check share preview details' },
    { tag: 'WRITE',   label: 'Write preview module' },
  ],
  'seo-performance': [
    { tag: 'PSI',     label: 'Run website speed check' },
    { tag: 'AI',      label: 'Check AI visibility' },
    { tag: 'WRITE',   label: 'Write website review' },
  ],
  'brand-system': [
    { tag: 'SCAN',    label: 'Read dashboard context' },
    { tag: 'CHAT',    label: 'Resolve gap questions' },
    { tag: 'VISION',  label: 'Run Claude vision on uploads' },
    { tag: 'BUILD',   label: 'Assemble brand guide' },
    { tag: 'WRITE',   label: 'Generate output templates' },
  ],
};
export function _detectQueuedModule(dashboardState) {
  const modules = dashboardState?.modules;
  if (!modules) return null;
  for (const [cardId, state] of Object.entries(modules)) {
    if (state?.status === 'queued' || state?.status === 'running') return cardId;
  }
  return null;
}
export function _isModularOnlyRun(dashboardState) {
  // Modular-only runs have no legacy synthesis data
  return Boolean(dashboardState?.modules) && !dashboardState?.snapshot && !dashboardState?.strategy && !dashboardState?.scribe;
}
export function buildModuleTerminalLog(moduleId, dashboardState, latestRunStatus, run, client, countdown) {
  const lines = [];
  const add = (type, prefix, text, cursor = false) => lines.push({ type, prefix, text, cursor });
  const host = _termHost(run, client);
  const runId = run?.id ? `${run.id.slice(0, 8)}…` : '—';
  const stages = MODULE_TERMINAL_STAGES[moduleId] || [];

  add('system', '$', `module/${moduleId || 'init'} — run ${runId}`);
  add('dim', '', '─'.repeat(46));
  add('info', 'site', host);
  add('dim', '', '─'.repeat(46));

  if (latestRunStatus === 'failed') {
    const msg = dashboardState?.errorState?.message || 'Module run encountered an error.';
    add('error', '[ERR]', msg);
    add('error', '✗', 'module run failed');
    add('dim', '', 'retry below to re-run this module');
    return lines;
  }

  if (latestRunStatus === 'queued') {
    add('ok', '✓', 'module run registered');
    add('info', 'queue', `target: ${host}`);
    add('dim', '', '─'.repeat(46));
    add('info', 'sys', 'locating available worker…');
    add('active', '▶', `queuing ${moduleId}…`, true);
    for (const s of stages) {
      add('dim', '·', `[${s.tag}]  ${s.label}`);
    }
    return lines;
  }

  if (latestRunStatus === 'succeeded') {
    const modules = dashboardState?.modules || {};
    add('ok', '✓', 'worker claimed job');
    for (const [cardId, state] of Object.entries(modules)) {
      if (state?.status !== 'succeeded') continue;
      const cardStages = MODULE_TERMINAL_STAGES[cardId] || [];
      for (const s of cardStages) {
        add('ok', '✓', s.label);
      }
      add('ok', '✓', `${cardId} — complete`);
      add('dim', '', '─'.repeat(46));
    }
    add('ok', '✓', 'module complete');
    return lines;
  }

  // Running — show active state
  add('ok', '✓', 'worker claimed job');
  // Post-module step on the signup intake run: modules are done, the worker is
  // generating search terms + scout config before handing off to the brief run.
  if (run?.progress?.stage === 'search-terms') {
    for (const [cardId, state] of Object.entries(dashboardState?.modules || {})) {
      if (state?.status === 'succeeded') add('ok', '✓', `${cardId} — complete`);
    }
    add('active', '[SEARCH]', run?.progress?.progressLabel || 'generating search terms + scout config…', true);
    add('dim', '·', '[CAMPAIGN]  30-day social media campaign');
    add('dim', '·', "[BRIEF]     today's post + executive brief");
    return lines;
  }
  if (stages.length > 0) {
    add('active', `[${stages[0].tag}]`, `${stages[0].label}…`, true);
    for (const s of stages.slice(1)) {
      add('dim', '·', `[${s.tag}]  ${s.label}`);
    }
  } else {
    add('active', '[RUN]', `${moduleId} in progress…`, true);
  }
  return lines;
}

// ── Intake build terminal log ─────────────────────────────────────────────────
// Produces IDE-style terminal log lines for the intake build modal.
// Each line: { type, prefix, text, cursor? }
// Types: system | dim | info | fetch | ok | ai | build | error | active | countdown
export function _termHost(run, client) {
  return client?.normalizedHost
    || (run?.sourceUrl ? (() => { try { return new URL(run.sourceUrl).hostname.replace(/^www\./, ''); } catch { return run.sourceUrl; } })() : null)
    || '—';
}
export function _termPath(url) {
  try { return new URL(url).pathname || '/'; } catch { return url || '/'; }
}

// ── Growth-engine terminal (scout-brief runs) ────────────────────────────────
// Job board for the second onboarding pass (trigger: onboarding-chain) and for
// manual Executive Brief runs. One row per job; statuses driven by
// run.progress.stage emitted from runtime.js (scout → strategy → scribe).
export const GROWTH_TERMINAL_JOBS = [
  { stage: 'scout',    tag: 'SCOUT',    label: 'scan web + X + reddit market signals' },
  { stage: 'strategy', tag: 'CAMPAIGN', label: 'build 30-day social media campaign' },
  { stage: 'scribe',   tag: 'BRIEF',    label: "draft today's post + executive brief" },
];
export function buildGrowthTerminalLog(run, dashboardState, latestRunStatus, client, countdown) {
  const lines = [];
  const add = (type, prefix, text, cursor = false) => lines.push({ type, prefix, text, cursor });
  const host = _termHost(run, client);
  const runId = run?.id ? `${run.id.slice(0, 8)}…` : '—';
  const isChain = run?.trigger === 'onboarding-chain';

  add('system', '$', `founders/growth-engine — run ${runId}`);
  add('dim', '', '─'.repeat(46));
  add('info', 'site', host);
  add('info', 'trigger', isChain ? 'onboarding' : (run?.trigger || 'manual'));
  add('dim', '', '─'.repeat(46));
  if (isChain) {
    add('ok', '✓', 'site intake complete — dashboard modules written');
    add('ok', '✓', '[SEARCH]   search terms + scout config generated');
  }

  if (latestRunStatus === 'failed') {
    add('error', '[ERR]', 'brief generation hit an issue');
    if (isChain) {
      add('dim', '', 'your dashboard is ready — retry from the Executive Brief card');
      add('dim', '', '─'.repeat(46));
      if (countdown > 0) {
        add('countdown', '▶', `launching dashboard in ${countdown}…`);
      } else {
        add('countdown', '▶', 'launching…');
      }
    } else {
      add('dim', '', 'retry from the Executive Brief card');
    }
    return lines;
  }

  if (latestRunStatus === 'queued') {
    add('info', 'sys', 'locating available worker…');
    add('active', '▶', 'queuing growth engine…', true);
    for (const j of GROWTH_TERMINAL_JOBS) {
      add('dim', '·', `[${j.tag}]  ${j.label}`);
    }
    return lines;
  }

  if (latestRunStatus === 'succeeded') {
    add('ok', '✓', 'worker claimed job');
    for (const j of GROWTH_TERMINAL_JOBS) {
      add('ok', '✓', `[${j.tag}]  ${j.label}`);
    }
    add('ok', '✓', 'executive brief ready');
    add('dim', '', '─'.repeat(46));
    const launchVerb = isChain ? 'opening your executive brief' : 'launching dashboard';
    if (countdown > 0) {
      add('countdown', '▶', `${launchVerb} in ${countdown}…`);
    } else {
      add('countdown', '▶', `${launchVerb}…`);
    }
    return lines;
  }

  // Running — mark each job done / active / pending by stage position.
  // No stage yet (just claimed) → first job shows as active.
  const stage = run?.progress?.stage || null;
  const stageIdx = GROWTH_TERMINAL_JOBS.findIndex((j) => j.stage === stage);
  const activeIdx = stageIdx < 0 ? 0 : stageIdx;
  add('ok', '✓', 'worker claimed job');
  GROWTH_TERMINAL_JOBS.forEach((j, i) => {
    if (i < activeIdx) {
      add('ok', '✓', `[${j.tag}]  ${j.label}`);
    } else if (i === activeIdx) {
      add('active', `[${j.tag}]`, run?.progress?.progressLabel || `${j.label}…`, true);
    } else {
      add('dim', '·', `[${j.tag}]  ${j.label}`);
    }
  });
  return lines;
}
export function buildTerminalLog(run, dashboardState, latestRunStatus, client, countdown) {
  // Scout-brief runs (onboarding chain or Executive Brief card) render
  // the growth-engine job board instead of the intake script.
  if (run?.pipelineType === 'scout-brief') {
    return buildGrowthTerminalLog(run, dashboardState, latestRunStatus, client, countdown);
  }
  // Delegate to module-specific terminal for modular-only clients
  if (_isModularOnlyRun(dashboardState)) {
    const moduleId = _detectQueuedModule(dashboardState) ||
      Object.keys(dashboardState?.modules || {}).find((id) => dashboardState.modules[id]?.status === 'succeeded') ||
      null;
    return buildModuleTerminalLog(moduleId, dashboardState, latestRunStatus, run, client, countdown);
  }

  const lines = [];
  const add = (type, prefix, text, cursor = false) => lines.push({ type, prefix, text, cursor });

  const progress = run?.progress || {};
  const stage = progress?.stage;
  const stageOrder = ['fetch', 'analyze', 'synthesize', 'compose', 'normalize'];
  const idx = stageOrder.indexOf(stage);
  const host = _termHost(run, client);
  const runId = run?.id ? `${run.id.slice(0, 8)}…` : '—';
  const trigger = run?.trigger || 'provision';
  const pages = Array.isArray(progress?.pages) ? progress.pages : [];
  const pageCount = progress?.pagesFetched || pages.length || 0;

  // ── Header ──
  add('system', '$', `founders/intake — run ${runId}`);
  add('dim', '', '─'.repeat(46));
  add('info', 'site', host);
  add('info', 'trigger', trigger);
  add('dim', '', '─'.repeat(46));

  // ── Failed ──
  if (latestRunStatus === 'failed') {
    const msg = dashboardState?.errorState?.message || 'unknown pipeline error';
    add('error', '[ERR]', msg);
    add('error', '✗', 'build failed');
    add('dim', '', 'update the website url below to retry');
    return lines;
  }

  // ── Queued ──
  if (latestRunStatus === 'queued') {
    add('ok', '✓', 'intake request received');
    add('ok', '✓', `run ${runId} registered`);
    add('info', 'queue', `target: ${host}`);
    add('dim', '', '─'.repeat(46));
    add('info', 'sys', 'locating available worker…');
    add('active', '▶', 'waiting for worker to start…', true);
    add('dim', '', '');
    add('dim', '·', '[FETCH]  crawl site pages');
    add('dim', '·', '[AI]     analyze content & brand');
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // ── Succeeded ──
  if (latestRunStatus === 'succeeded') {
    add('ok', '✓', 'worker claimed job');
    add('ok', '✓', 'headless chromium initialized');
    add('fetch', '[FETCH]', `connected to ${host}`);
    const pl = pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : 'pages';
    add('ok', '✓', `${pl} crawled successfully`);
    for (const p of pages.slice(0, 6)) {
      const path = _termPath(p.url);
      const title = (p.title || p.headline || '').slice(0, 48);
      add('fetch', '  →', title ? `${path}  "${title}"` : path);
    }
    add('ok', '✓', 'site content extracted');
    add('ok', '✓', 'desktop / tablet / mobile screenshots captured');
    add('ai', '[AI]', 'gpt-4o: reading headlines & copy blocks');
    add('ai', '[AI]', 'gpt-4o: analyzing brand voice & tone');
    add('ai', '[AI]', 'gpt-4o: mapping content strategy');
    add('ai', '[AI]', 'gpt-4o: identifying distribution angles');
    add('ok', '✓', 'brand intelligence synthesized');
    add('mock', '[MOCK]', 'rendered intake device mockup');
    add('build', '[BUILD]', 'writing modules to firestore');
    add('build', '  →', 'creative-pipelines');
    add('build', '  →', 'ai-research');
    add('build', '  →', 'distribution-insight');
    add('build', '  →', 'reddit-community');
    add('ok', '✓', 'all modules written');
    add('ok', '✓', 'dashboard data ready');
    add('dim', '', '─'.repeat(46));
    if (countdown > 0) {
      add('countdown', '▶', `launching dashboard in ${countdown}…`);
    } else {
      add('countdown', '▶', 'launching…');
    }
    return lines;
  }

  // ── Running ──
  add('ok', '✓', 'worker claimed job');
  add('ok', '✓', 'headless chromium initialized');

  if (idx < 0) {
    add('active', '[→]', `connecting to ${host}…`, true);
    add('dim', '·', '[FETCH]  crawl site pages');
    add('dim', '·', '[AI]     analyze content & brand');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // fetch — show pages as they arrive
  add('fetch', '[FETCH]', `connected to ${host}`);
  if (idx === 0) {
    // Show pages already fetched (incremental progress from onPageFetched emits)
    for (const p of pages.slice(0, 6)) {
      const label = (p.title || p.headline || p.type || '').slice(0, 52);
      add('fetch', '  →', label ? `${p.type}  "${label}"` : p.type);
    }
    const stillFetching = pageCount === 0 || pages.length === 0;
    add('active', '[→]', stillFetching ? 'crawling pages — discovering content…' : `${pageCount} page${pageCount !== 1 ? 's' : ''} — scanning for more…`, true);
    add('active', '[SCREEN]', 'capturing desktop / tablet / mobile screens…', true);
    add('dim', '·', '[AI]     analyze content & brand');
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // analyze+
  const pl = pageCount ? `${pageCount} page${pageCount !== 1 ? 's' : ''}` : 'pages';
  add('ok', '✓', `${pl} discovered`);
  for (const p of pages.slice(0, 6)) {
    const path = _termPath(p.url);
    const title = (p.title || p.headline || '').slice(0, 48);
    add('fetch', '  →', title ? `${path}  "${title}"` : path);
  }

  if (idx === 1) {
    add('ai', '[AI]', 'gpt-4o: reading page content…');
    add('active', '[AI]', 'extracting headlines & brand signals…', true);
    add('active', '[SCREEN]', 'capturing desktop / tablet / mobile screens…', true);
    add('dim', '·', '[AI]     analyze brand & voice');
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // synthesize+
  add('ok', '✓', 'site content extracted');
  add('ok', '✓', 'desktop / tablet / mobile screenshots captured');
  add('ai', '[AI]', 'gpt-4o: analyzing brand voice & tone');
  add('ai', '[AI]', 'gpt-4o: mapping content strategy');
  add('ai', '[AI]', 'gpt-4o: identifying distribution angles');

  if (idx === 2) {
    add('active', '[AI]', 'synthesizing brand intelligence…', true);
    add('dim', '·', '[MOCK]   render clay device mockup');
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // compose+
  add('ok', '✓', 'brand analysis complete');
  add('ok', '✓', 'content strategy ready');
  if (idx === 3) {
    add('active', '[MOCK]', 'rendering clay device mockup…', true);
    add('dim', '·', '[BUILD]  write dashboard modules');
    return lines;
  }

  // normalize
  add('ok', '✓', 'device mockup rendered');
  add('build', '[BUILD]', 'writing module: creative-pipelines');
  add('build', '[BUILD]', 'writing module: ai-research');
  add('build', '[BUILD]', 'writing module: distribution-insight');
  add('build', '[BUILD]', 'writing module: reddit-community');
  add('active', '[BUILD]', 'finalizing dashboard data…', true);

  return lines;
}

// ── Terminal line builder ─────────────────────────────────────────────────────
// Converts run state + progress fields into displayable terminal log lines.
export function buildTerminalLines(run, dashboardState, latestRunStatus, client) {
  const siteUrl = run?.sourceUrl
    ? (() => { try { return new URL(run.sourceUrl).hostname.replace(/^www\./, ''); } catch { return run.sourceUrl; } })()
    : client?.normalizedHost || '...';

  const progress = run?.progress || null;

  if (!run) {
    return [
      { tag: 'SYSTEM', text: 'Waiting for intake run to start...', type: 'dim' },
    ];
  }

  if (latestRunStatus === 'queued') {
    return [
      { tag: 'QUEUE', text: `Intake queued for ${siteUrl}`, type: 'label' },
      { tag: 'QUEUE', text: `Run ID: ${String(run.id || '').slice(-10)}`, type: 'dim' },
      { tag: 'QUEUE', text: 'Waiting for worker to claim run...', type: 'dim', active: true },
    ];
  }

  if (latestRunStatus === 'running') {
    const stage = progress?.stage;
    const stageOrder = ['fetch', 'analyze', 'synthesize', 'compose', 'normalize'];
    const currentIdx = stageOrder.indexOf(stage);

    const lines = [
      { tag: 'START', text: `Intake started · ${siteUrl}`, type: 'label' },
    ];

    // fetch: show crawl line — active while fetching, ok once past
    if (currentIdx >= 0) {
      lines.push({
        tag: 'FETCH',
        text: `Crawling ${siteUrl}...`,
        type: currentIdx === 0 ? 'active' : 'ok',
        active: currentIdx === 0,
      });
      if (currentIdx === 0) {
        lines.push({ tag: 'SCREEN', text: 'Capturing desktop, tablet, and mobile screenshots...', type: 'active', active: true });
      }
    }

    // analyze: show page count + compact evidence + active analyze line
    if (currentIdx >= 1) {
      const count = progress.pagesFetched;
      const types = Array.isArray(progress.pagesDiscovered) ? progress.pagesDiscovered.join(' · ') : '';
      lines.push({
        tag: 'FETCH',
        text: `${count} page${count !== 1 ? 's' : ''} fetched${types ? ` · ${types}` : ''}`,
        type: 'ok',
      });

      // Compact page evidence — title + primary heading per page
      if (Array.isArray(progress.pages)) {
        for (const page of progress.pages.slice(0, 4)) {
          const titleText = (page.title || '').slice(0, 70);
          if (titleText) {
            lines.push({ tag: page.type.toUpperCase().slice(0, 7), text: `"${titleText}"`, type: 'dim' });
          }
          const headlineText = (page.headline || '').slice(0, 70);
          if (headlineText) {
            lines.push({ tag: '', text: `→ ${headlineText}`, type: 'dim' });
          }
        }
      }

      // FIX Issue 1: always show an active line during analyze stage
      if (currentIdx === 1) {
        lines.push({ tag: 'ANALYZE', text: 'Extracting site structure...', type: 'active', active: true });
      }

      // Screenshot runs concurrently with fetch+analyze; show as active background task
      if (currentIdx <= 1) {
        lines.push({ tag: 'SCREEN', text: 'Capturing desktop, tablet, and mobile screenshots...', type: 'active', active: true });
      }
    }

    // synthesize
    if (currentIdx >= 2) {
      // Screenshot completes before synthesize — show as done
      lines.push({ tag: 'SCREEN', text: 'Desktop, tablet, and mobile screenshots captured', type: 'ok' });
      lines.push({
        tag: 'SYNTH',
        text: 'Building brand intelligence...',
        type: currentIdx === 2 ? 'active' : 'ok',
        active: currentIdx === 2,
      });
    }

    // compose
    if (currentIdx >= 3) {
      lines.push({
        tag: 'MOCK',
        text: 'Rendering clay device mockup...',
        type: currentIdx === 3 ? 'active' : 'ok',
        active: currentIdx === 3,
      });
    }

    // normalize
    if (currentIdx >= 4) {
      lines.push({ tag: 'WRITE', text: 'Writing dashboard modules...', type: 'active', active: true });
    }

    // Fallback: worker claimed but no stage written yet
    if (currentIdx < 0) {
      lines.push({ tag: 'PROC', text: progress?.progressLabel || 'Processing...', type: 'active', active: true });
    }

    return lines;
  }

  if (latestRunStatus === 'succeeded') {
    const prog = run?.progress || {};
    const cost = run?.providerUsage?.estimatedCostUsd;
    const count = prog.pagesFetched || (dashboardState?.snapshot ? 3 : null);
    const types = Array.isArray(prog.pagesDiscovered) ? prog.pagesDiscovered.join(' · ') : 'homepage';

    const lines = [
      { tag: 'DONE', text: `Intake complete · ${siteUrl}`, type: 'label' },
      { tag: 'FETCH', text: `${count ? `${count} pages · ` : ''}${types}`, type: 'ok' },
    ];

    // Show first page evidence from stored progress
    if (Array.isArray(prog.pages) && prog.pages.length > 0) {
      const hp = prog.pages.find((p) => p.type === 'homepage') || prog.pages[0];
      if (hp?.headline) {
        lines.push({ tag: hp.type.toUpperCase().slice(0, 7), text: `→ "${hp.headline.slice(0, 70)}"`, type: 'dim' });
      }
    }

    lines.push(
      { tag: 'SCREEN', text: 'Desktop, tablet, and mobile screenshots captured', type: 'ok' },
      { tag: 'SYNTH', text: 'Brand intelligence built', type: 'ok' },
      { tag: 'MOCK', text: 'Clay device mockup rendered', type: 'ok' },
      { tag: 'WRITE', text: '5 dashboard modules populated', type: 'ok' },
      { tag: 'OK', text: `Run complete${cost ? ` · $${cost}` : ''}`, type: 'success' },
    );

    return lines;
  }

  if (latestRunStatus === 'cancelled') {
    return [
      { tag: 'CANCEL', text: `Run cancelled · ${siteUrl}`, type: 'label' },
      { tag: 'INFO', text: 'Enter a new website URL below and rerun to restart intake.', type: 'dim' },
    ];
  }

  if (latestRunStatus === 'failed') {
    const errorMsg = dashboardState?.errorState?.message || 'Setup encountered an issue.';
    const lines = [
      { tag: 'ERROR', text: `Intake failed · ${siteUrl}`, type: 'label' },
      { tag: 'ERROR', text: errorMsg, type: 'error' },
    ];
    if (dashboardState?.errorState?.retryPending) {
      lines.push({ tag: 'INFO', text: 'Retry is pending — this will run automatically.', type: 'dim' });
    }
    return lines;
  }

  return [{ tag: 'SYSTEM', text: 'No recent intake runs.', type: 'dim' }];
}

/**
 * Scripted terminal lines for the SEO rerun + narrator flow.
 * Stages advance based on elapsed time from when Re-run was clicked.
 * @param {'start'|'fetch'|'audit'|'narrator'|'write'} stage
 * @param {string} [websiteUrl]
 */

// ── Component ─────────────────────────────────────────────────────────────────
