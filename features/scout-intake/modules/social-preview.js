'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runSiteMeta } = require('./shared/site-meta');

const CARD_ID = 'social-preview';

function normalizeSiteMeta(siteMeta) {
  if (!siteMeta || typeof siteMeta !== 'object') return siteMeta || null;
  const title = siteMeta.title || siteMeta.ogTitle || null;
  const description = siteMeta.description || siteMeta.ogDescription || null;
  return {
    ...siteMeta,
    title,
    description,
    ogTitle: siteMeta.ogTitle || title,
    ogDescription: siteMeta.ogDescription || description,
  };
}

async function runSocialPreview({ websiteUrl, onProgress = null }) {
  const warningCodes = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // Step 1: site fetch
  await emit('fetch', 'Connect to website…');
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
  }
  const evidence = fetchResult.evidence;

  // Step 2: extract site meta
  await emit('analyze', 'Extract social metadata…');
  const metaResult = runSiteMeta({ evidence });
  if (!metaResult.ok || !metaResult.siteMeta) {
    const code = 'site_meta_missing';
    return {
      ok: false,
      cardId: CARD_ID,
      status: 'failed',
      errorCode: code,
      errorMessage: 'No social meta tags found on this page.',
      warningCodes: [...warningCodes, code],
      artifacts: [],
    };
  }

  await emit('normalize', 'Write preview module…');
  const siteMeta = normalizeSiteMeta(metaResult.siteMeta);
  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    artifacts: [],
    result: { siteMeta },
  };
}

module.exports = { runSocialPreview, normalizeSiteMeta };
