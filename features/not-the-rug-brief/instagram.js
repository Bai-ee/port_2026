// instagram.js — standalone Instagram insights runner for clients

require('./load-env');

const { requireClientConfig } = require('./clients');
const { getLatestInstagram, saveLatestInstagram, logError } = require('./store');
const { fetchInstagramInsights } = require('./services/instagram');

async function runInstagramMonitor(clientId) {
  const config = requireClientConfig(clientId);
  const previousReport = await getLatestInstagram(clientId);
  const report = await fetchInstagramInsights(config, previousReport);

  if (!report) {
    throw new Error(`Instagram insights not configured for ${clientId}`);
  }

  await saveLatestInstagram(clientId, report);
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (require.main === module) {
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : process.env.DEFAULT_CLIENT_ID || 'critters-quest';

  runInstagramMonitor(clientId)
    .catch(async (err) => {
      console.error(err.message || String(err));
      await logError(err, { module: 'instagram', clientId }).catch(() => {});
      process.exit(1);
    });
}

module.exports = { runInstagramMonitor };
