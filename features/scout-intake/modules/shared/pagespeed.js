'use strict';

const pagespeedModule = require('../../../intelligence/pagespeed');

async function runPagespeed({ websiteUrl }) {
  if (!process.env.PAGESPEED_API_KEY) {
    return {
      ok: false,
      skipped: true,
      warning: { type: 'warning', code: 'pagespeed_skipped_missing_api_key', message: 'PageSpeed audit skipped: PAGESPEED_API_KEY not configured.', stage: 'psi' },
    };
  }
  if (process.env.PAGESPEED_ENABLED === '0') {
    return {
      ok: false,
      skipped: true,
      warning: { type: 'warning', code: 'pagespeed_skipped_disabled', message: 'PageSpeed audit skipped: PAGESPEED_ENABLED=0.', stage: 'psi' },
    };
  }
  try {
    const pagespeed = await pagespeedModule.fetch({ websiteUrl });
    const ok = pagespeed?.status !== 'error';
    return { ok, pagespeed };
  } catch (err) {
    return {
      ok: false,
      warning: { type: 'warning', code: 'pagespeed_failed', message: `PageSpeed audit failed: ${err.message}`, stage: 'psi' },
    };
  }
}

module.exports = { runPagespeed };
