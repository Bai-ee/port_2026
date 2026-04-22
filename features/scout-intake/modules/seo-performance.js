'use strict';

const { runSiteFetch } = require('./shared/site-fetch');
const { runPagespeed } = require('./shared/pagespeed');
const { runAiSeo } = require('./shared/ai-seo');
const { extractSiteMeta } = require('../site-fetcher');
const { runSkill, buildSourcePayloads } = require('../skills/_runner');
const { aggregateCardSkills } = require('../skills/_aggregator');
const { renderSkillDoc } = require('../skills/_doc-renderer');
const { CARD_CONTRACT } = require('../card-contract');
const fb = require('../../../api/_lib/firebase-admin.cjs');

const CARD_ID = 'seo-performance';
const SKILL_ID = 'seo-depth-audit';

function findCard(cardId) {
  return CARD_CONTRACT.find((c) => c.id === cardId) || null;
}

async function runSeoPerformance({ clientId = null, websiteUrl, onProgress = null }) {
  const warningCodes = [];
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, { moduleId: CARD_ID, ...extra }); } catch {}
  };

  // Step 1: site fetch (evidence used for context AND skill input)
  await emit('fetch', 'Connect to website…');
  const fetchResult = await runSiteFetch({ websiteUrl });
  if (!fetchResult.ok && fetchResult.warning) {
    warningCodes.push(fetchResult.warning.code);
  }
  const evidence = fetchResult?.evidence || null;
  // extractSiteMeta expects raw HTML + baseUrl. The homepage is pages[0] and its
  // raw HTML lives on the _rawHtml field (populated by site-fetcher, stripped
  // later by normalize before Firestore write). Fall back to the page's
  // already-extracted `metaTags` fields when _rawHtml is absent.
  const homepage = evidence?.pages?.[0] || null;
  const homepageHtml = homepage?._rawHtml || null;
  const siteMeta = homepageHtml ? extractSiteMeta(homepageHtml, websiteUrl) : (homepage?.siteMeta || null);

  // Step 2: pagespeed + ai-seo in parallel — both only need websiteUrl
  await emit('analyze', 'Run PageSpeed and AI SEO checks…');
  const [pagespeedResult, aiSeoResult] = await Promise.all([
    runPagespeed({ websiteUrl }),
    runAiSeo({ websiteUrl }),
  ]);

  if (pagespeedResult.warning) warningCodes.push(pagespeedResult.warning.code);
  if (aiSeoResult.warning) warningCodes.push(aiSeoResult.warning.code);

  const pagespeedOk = pagespeedResult.ok && !pagespeedResult.skipped;
  const aiSeoOk = aiSeoResult.ok && !aiSeoResult.skipped;

  // Both skipped or both failed — hard failure (skip skill, no point)
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

  // Step 3: run the seo-depth-audit skill — feed it real PSI + evidence so
  // findings reference live numbers. Non-fatal: if the skill fails, the
  // module still succeeds with PSI + AI SEO data.
  let skillOutput = null;
  let skillDoc    = null;
  let aggregate   = null;
  try {
    await emit('skill', `Running ${SKILL_ID}…`);
    // Strip _rawHtml from evidence pages before feeding the skill — same
    // trim the intake pipeline does to stay under the 200K token cap.
    const evidenceForSkill = evidence && Array.isArray(evidence.pages)
      ? { ...evidence, pages: evidence.pages.map((p) => { const { _rawHtml, ...rest } = p || {}; return rest; }) }
      : evidence;

    // Prefer fresh PSI. If this run's PSI failed or returned an error
    // SourceRecord, fall back to the PSI data already stored in
    // dashboard_state.seoAudit (the dashboard shape — flat scores/CWV/opps).
    // This lets the skill cite real numbers even when the new fetch timed out.
    let skillPagespeed = null;
    const freshOk = pagespeedResult?.ok
      && pagespeedResult?.pagespeed?.facts
      && pagespeedResult.pagespeed.facts.auditStatus !== 'error';
    if (freshOk) {
      skillPagespeed = pagespeedResult.pagespeed;
    } else if (clientId) {
      try {
        const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
        const stored = snap.exists ? (snap.data()?.seoAudit || null) : null;
        // Only use stored PSI if it was actually OK — don't rehydrate an error shape.
        if (stored && stored.status === 'ok' && stored.scores) {
          skillPagespeed = stored;
        }
      } catch { /* non-fatal — skill runs with null PSI */ }
    }

    const sourcePayloads = buildSourcePayloads({
      evidence: evidenceForSkill,
      siteMeta,
      pagespeed: skillPagespeed,
      // intake/styleGuide/scoutConfig/userContext intentionally omitted —
      // this skill doesn't declare them as inputs.
    });

    const card   = findCard(CARD_ID);
    const result = await runSkill(SKILL_ID, { card, sourcePayloads });
    if (result.ok) {
      skillOutput = result.output;
      aggregate   = aggregateCardSkills({ [SKILL_ID]: result.output });
      skillDoc    = renderSkillDoc(result.output, { siteUrl: websiteUrl, cardId: CARD_ID });
      await emit('skill', `${SKILL_ID} complete`, { ok: true });
    } else {
      warningCodes.push('seo_skill_failed');
      await emit('skill', `${SKILL_ID} failed: ${result.error || 'unknown'}`, { ok: false });
    }
  } catch (err) {
    warningCodes.push('seo_skill_threw');
    await emit('skill', `${SKILL_ID} threw: ${err.message}`, { ok: false });
  }

  await emit('normalize', 'Write SEO module…');
  return {
    ok: true,
    cardId: CARD_ID,
    status: 'succeeded',
    warningCodes,
    artifacts: [],
    result: {
      // Always pass the SourceRecord through when present, even if the PSI
      // fetch reported an error. The dashboard projection translator will
      // convert an error SourceRecord into a { status: 'error', … } shape so
      // the card can render the failure state instead of a blank shell.
      pagespeed:    pagespeedResult.pagespeed || null,
      aiSeoAudit:   aiSeoOk ? aiSeoResult.aiSeoAudit : null,
      // Skill output + rendered downloadable doc — picked up by run-lifecycle.
      skillOutput,
      skillAggregate: aggregate,
      skillDoc,
      skillId: SKILL_ID,
    },
  };
}

module.exports = { runSeoPerformance };
