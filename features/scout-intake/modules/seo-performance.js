'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runPagespeed } = require('./shared/pagespeed');
const { runAiSeo } = require('./shared/ai-seo');

const CARD_ID = 'seo-performance';

async function runSeoPerformance({ websiteUrl }) {
  const warningCodes = [];

  // Step 1: site fetch (evidence used for context; pagespeed/ai-seo run independently)
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
  }

  // Step 2: pagespeed + ai-seo in parallel — both only need websiteUrl
  const [pagespeedResult, aiSeoResult] = await Promise.all([
    runPagespeed({ websiteUrl }),
    runAiSeo({ websiteUrl }),
  ]);

  if (pagespeedResult.warning) warningCodes.push(pagespeedResult.warning.code);
  if (aiSeoResult.warning) warningCodes.push(aiSeoResult.warning.code);

  const pagespeedOk = pagespeedResult.ok && !pagespeedResult.skipped;
  const aiSeoOk = aiSeoResult.ok && !aiSeoResult.skipped;

  // Both skipped or both failed — hard failure
  if (!pagespeedOk && !aiSeoOk) {
    const code = warningCodes[0] || 'seo_performance_no_data';
    return {
      ok: false,
      cardId: CARD_ID,
      status: 'failed',
      errorCode: code,
      errorMessage: 'Neither PageSpeed nor AI visibility audit produced data.',
      warningCodes,
      artifacts: [],
    };
  }

  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    artifacts: [],
    result: {
      pagespeed:    pagespeedOk  ? pagespeedResult.pagespeed   : null,
      aiSeoAudit:   aiSeoOk     ? aiSeoResult.aiSeoAudit      : null,
    },
  };
}

module.exports = { runSeoPerformance };
