// index.js — Feature entry point
//
// Exports the generic client pipeline entrypoint.
// The compat shim below preserves the old runNotTheRugBrief export for any
// existing callers; it routes through the generic runtime with 'not-the-rug'
// as the clientId. Mark any new call sites to use runClientPipeline directly.

require('./load-env');

const { runClientPipeline } = require('./runtime');
const { getLatestBrief, getLatestContent, DATA_DIR } = require('./store');
const path = require('path');

// ─── Generic entrypoint ───────────────────────────────────────────────────────

// ─── Compat shim: not-the-rug ─────────────────────────────────────────────────
// TEMPORARY — keeps existing call sites working during Phase 2→3 transition.
// New code must call runClientPipeline({ clientId }) directly.

const NOT_THE_RUG_CLIENT_ID = 'not-the-rug';

async function runNotTheRugBrief(options = {}) {
  const result = await runClientPipeline({
    clientId: NOT_THE_RUG_CLIENT_ID,
    clientConfig: null,      // uses static registry
    fresh: options.fresh || false,
  });

  if (result.status === 'failed') {
    return {
      status: 'error',
      stage: result.failedStage,
      error: result.error,
      pipelineStartedAt: result.startedAt,
      artifacts: buildArtifactPaths(NOT_THE_RUG_CLIENT_ID),
    };
  }

  return {
    status: 'success',
    clientId: NOT_THE_RUG_CLIENT_ID,
    pipelineStartedAt: result.startedAt,
    latestBrief: result.brief,
    latestContent: { content: result.content },
    reportPaths: null,
    artifacts: buildArtifactPaths(NOT_THE_RUG_CLIENT_ID),
    guardianFlags: result.guardianFlags,
    scoutPriorityAction: result.scoutPriorityAction,
    runCostData: result.runCostData,
  };
}

function buildArtifactPaths(clientId) {
  return {
    latestBriefJsonPath: path.join(DATA_DIR, 'briefs', clientId, 'latest.json'),
    latestContentJsonPath: path.join(DATA_DIR, 'content', clientId, 'latest-content.json'),
    latestMarkdownPath: path.join(DATA_DIR, 'briefs', clientId, 'latest-brief.md'),
    latestHtmlPath: path.join(DATA_DIR, 'briefs', clientId, 'latest-brief.html'),
  };
}

async function getLatestNotTheRugArtifacts() {
  return {
    clientId: NOT_THE_RUG_CLIENT_ID,
    latestBrief: await getLatestBrief(NOT_THE_RUG_CLIENT_ID),
    latestContent: await getLatestContent(NOT_THE_RUG_CLIENT_ID),
    artifacts: buildArtifactPaths(NOT_THE_RUG_CLIENT_ID),
  };
}

module.exports = {
  runClientPipeline,
  // compat shims — remove after Phase 3 worker is the execution path
  CLIENT_ID: NOT_THE_RUG_CLIENT_ID,
  runNotTheRugBrief,
  getLatestNotTheRugArtifacts,
};
