// weather.js — standalone weather fetch runner for client service areas

require('./load-env');
const { requireClientConfig } = require('./clients');
const { saveLatestWeather, logError } = require('./store');
const { fetchOperationalWeather } = require('./services/weather');

async function runWeather(clientId) {
  const config = requireClientConfig(clientId);
  const report = await fetchOperationalWeather(config);

  if (!report) {
    throw new Error(`No weather provider configured for ${clientId}`);
  }

  await saveLatestWeather(clientId, report);
  return report;
}

if (require.main === module) {
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : 'not-the-rug';

  runWeather(clientId)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch(async (err) => {
      console.error(`[${new Date().toISOString()}] WEATHER ERROR: ${err.message}`);
      await logError(err, { module: 'weather', clientId }).catch(() => {});
      process.exit(1);
    });
}

module.exports = { runWeather };
