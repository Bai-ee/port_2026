// reddit.js — standalone Reddit signals runner for clients

require('./load-env');
const { requireClientConfig } = require('./clients');
const { getLatestReddit, saveLatestReddit, logError } = require('./store');
const { fetchRedditSignals } = require('./services/reddit');

async function runReddit(clientId) {
  const config = requireClientConfig(clientId);
  if (!config.reddit?.provider) {
    throw new Error(`No Reddit provider configured for ${clientId}`);
  }

  const previousReport = await getLatestReddit(clientId);
  const report = await fetchRedditSignals(config, previousReport);
  if (!report) {
    console.log(`[REDDIT] ${clientId}: no credentials configured or no report returned`);
    return null;
  }

  await saveLatestReddit(clientId, report);
  console.log(`[REDDIT] ${clientId}: mentions=${report.mentionCount}, opportunities=${report.participationOpportunityCount}`);
  return report;
}

async function main() {
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : 'not-the-rug';

  try {
    await runReddit(clientId);
  } catch (err) {
    console.error(`[REDDIT] failed for ${clientId}: ${err.message}`);
    try {
      await logError(err, { module: 'reddit', clientId });
    } catch {}
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { runReddit };
