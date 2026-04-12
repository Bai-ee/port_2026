// reviews.js — standalone review monitor runner for client listings

require('./load-env');
const { requireClientConfig } = require('./clients');
const { getLatestReviews, saveLatestReviews, logError } = require('./store');
const { fetchReviewStatusViaWebSearch } = require('./services/reviews');

async function runReviews(clientId) {
  const config = requireClientConfig(clientId);
  const previousReport = await getLatestReviews(clientId);
  const report = await fetchReviewStatusViaWebSearch(config, previousReport);

  if (!report) {
    throw new Error(`No review provider configured for ${clientId}`);
  }

  await saveLatestReviews(clientId, report);
  return report;
}

if (require.main === module) {
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : 'not-the-rug';

  runReviews(clientId)
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch(async (err) => {
      console.error(`[${new Date().toISOString()}] REVIEWS ERROR: ${err.message}`);
      await logError(err, { module: 'reviews', clientId }).catch(() => {});
      process.exit(1);
    });
}

module.exports = { runReviews };
