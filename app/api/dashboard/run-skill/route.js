import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Vercel Hobby caps serverless functions at 60s.
// Typical single-skill run budget:
//   auth + Firestore reads  ~1s
//   site re-fetch            5–10s
//   skill LLM call (Haiku)   3–8s
//   Firestore write          <1s
// Total: usually 10–20s. 60s gives us headroom for slow sites.
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const fb                     = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser }  = require('../../../../api/_lib/auth.cjs');
const { CARD_CONTRACT }      = require('../../../../features/scout-intake/card-contract');
const { fetchSiteEvidence }  = require('../../../../features/scout-intake/site-fetcher');
const { runSkill, buildSourcePayloads } = require('../../../../features/scout-intake/skills/_runner');
const { aggregateCardSkills } = require('../../../../features/scout-intake/skills/_aggregator');
const { renderSkillDoc } = require('../../../../features/scout-intake/skills/_doc-renderer');
const { appendRunEvent } = require('../../../../api/_lib/run-lifecycle.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

// Find the first card that declares this skillId in its analyzerSkills array.
// Returns the card object (or null if no card uses the skill).
function findCardForSkill(skillId) {
  return CARD_CONTRACT.find((c) => {
    const ids = Array.isArray(c.analyzerSkills) ? c.analyzerSkills : [];
    return ids.includes(skillId);
  }) || null;
}

/**
 * POST /api/dashboard/run-skill
 *
 * On-demand analyzer skill trigger. Runs a single skill against the signed-in
 * user's site and merges the result into dashboard_state.analyzerOutputs.
 *
 * Unlike /api/dashboard/modules/run (which drives heavyweight modules like
 * screenshots/mockups), this route runs a lightweight LLM skill from
 * features/scout-intake/skills/*.md and is safe to re-run on demand.
 *
 * Body:   { skillId: string }
 * Status: 200 { ok: true,  cardId, skillId, output }
 *         400 bad request
 *         401 unauthorized
 *         404 no client / no websiteUrl / skill not mapped to any card
 *         500 skill failed
 */
export async function POST(request) {
  try {
    return await handle(request);
  } catch (err) {
    const trace = `[${new Date().toISOString()}] [run-skill] ${err?.message || 'unknown'}\n${err?.stack || ''}\n\n`;
    console.error('[run-skill] uncaught error', err);
    try {
      const fs = require('fs');
      fs.appendFileSync('/tmp/run-skill-errors.log', trace);
    } catch {}
    return json({ error: `Server error: ${err?.message || 'unknown'}`, stack: err?.stack || null }, 500);
  }
}

async function handle(request) {
  // 1. Auth
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  // 2. Parse body
  let skillId;
  try {
    const body = await request.json();
    skillId = typeof body?.skillId === 'string' ? body.skillId.trim() : '';
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  if (!skillId) return json({ error: 'skillId is required.' }, 400);

  // 3. Resolve clientId + card
  const userSnap = await fb.adminDb.collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) return json({ error: 'No user record.' }, 404);
  const clientId = userSnap.data()?.clientId || null;
  if (!clientId) return json({ error: 'No clientId on user record.' }, 404);

  const card = findCardForSkill(skillId);
  if (!card) {
    return json({ error: `Skill '${skillId}' is not mapped to any card.` }, 404);
  }

  // 4. Load rehydration data from Firestore
  const [configSnap, dashSnap] = await Promise.all([
    fb.adminDb.collection('client_configs').doc(clientId).get(),
    fb.adminDb.collection('dashboard_state').doc(clientId).get(),
  ]);
  if (!configSnap.exists) return json({ error: 'No client config.' }, 404);

  const configData   = configSnap.data() || {};
  const dashData     = dashSnap.exists ? (dashSnap.data() || {}) : {};
  const websiteUrl   = configData?.sourceInputs?.websiteUrl || configData?.websiteUrl || null;
  if (!websiteUrl) return json({ error: 'No websiteUrl in client config.' }, 400);

  // Rehydrate intake from dashboard_state projections
  const intake = {
    snapshot: dashData.snapshot || null,
    signals:  dashData.signals  || null,
    strategy: dashData.strategy || null,
  };
  const styleGuide  = dashData.styleGuide  || null;
  const siteMeta    = dashData.siteMeta    || null;
  const scoutConfig = configData.scoutConfig || null;
  const userContext = configData.userContext || null;
  // PSI data is stored as a flattened "dashboard shape" at dashData.seoAudit
  // (auditStatus, scores, coreWebVitals, opportunities, seoRedFlags, …).
  // buildSourcePayloads accepts that shape directly: when there's no .facts
  // wrapper, the value passes through verbatim and the skill reads
  // intel.pagespeed.scores.* etc.
  const pagespeed = dashData.seoAudit || null;

  // 5. Re-fetch site (required for skills that declare site.html / site.meta inputs)
  //    site-fetcher uses plain fetch, so this works in Vercel serverless.
  let evidence;
  try {
    evidence = await fetchSiteEvidence(websiteUrl);
  } catch (err) {
    console.error('[run-skill] site fetch failed', err);
    return json({ error: `Site fetch failed: ${err.message}` }, 500);
  }

  // Strip _rawHtml from evidence pages before handing to skills — it's ephemeral
  // and can push prompts well past the 200K Anthropic token limit. Skills only
  // need the extracted structured fields. Mirrors the intake pipeline (runner.js).
  const evidenceForSkills = evidence && Array.isArray(evidence.pages)
    ? {
        ...evidence,
        pages: evidence.pages.map((p) => {
          const { _rawHtml, ...rest } = p || {};
          return rest;
        }),
      }
    : evidence;

  // 6. Build source payloads
  const sourcePayloads = buildSourcePayloads({
    intake,
    styleGuide,
    siteMeta,
    evidence: evidenceForSkills,
    pagespeed,
    scoutConfig,
    userContext,
  });

  // 7. Run the skill — emit terminal events so the dashboard shows status
  const latestRunId = dashData.latestRunId || null;
  const emitEvent = async (stage, label, extra = {}) => {
    if (!latestRunId) return;
    try { await appendRunEvent(latestRunId, clientId, { stage, progressLabel: label, ...extra }); } catch {}
  };

  await emitEvent(skillId, `Running ${skillId}…`, { cardId: card.id });
  const result = await runSkill(skillId, { card, sourcePayloads });
  if (!result.ok) {
    await emitEvent(skillId, `${skillId} failed: ${result.error || 'unknown'}`, { cardId: card.id, ok: false });
    return json({ error: `Skill failed: ${result.error}`, skillId, cardId: card.id }, 500);
  }
  await emitEvent(skillId, `${skillId} complete`, { cardId: card.id, ok: true });

  // 8. Merge result into dashboard_state.analyzerOutputs[cardId]
  //    Re-aggregate so the card-level aggregate reflects any existing skills
  //    plus the newly-run one.
  const existing      = dashData.analyzerOutputs?.[card.id] || {};
  const existingSkills = existing.skills && typeof existing.skills === 'object' ? existing.skills : {};
  const mergedSkills  = { ...existingSkills, [skillId]: result.output };
  const aggregate     = aggregateCardSkills(mergedSkills);

  // Render a downloadable doc for the DATA tab
  const doc = renderSkillDoc(result.output, { siteUrl: websiteUrl, cardId: card.id });

  const now = fb.FieldValue.serverTimestamp();
  const update = {
    updatedAt: now,
    [`analyzerOutputs.${card.id}.skills.${skillId}`]: result.output,
    [`analyzerOutputs.${card.id}.aggregate`]:          aggregate,
    [`artifacts.skillDocs.${skillId}`]: {
      type:     'skill-doc',
      skillId,
      cardId:   card.id,
      title:    doc.title,
      filename: doc.filename,
      markdown: doc.markdown,
      html:     doc.html,
      runAt:    result.output?.runAt || new Date().toISOString(),
      siteUrl:  websiteUrl,
    },
  };

  await fb.adminDb.collection('dashboard_state').doc(clientId).update(update);

  return json({
    ok:       true,
    cardId:   card.id,
    skillId,
    output:   result.output,
    costData: result.runCostData || null,
    doc: {
      title:    doc.title,
      filename: doc.filename,
    },
  });
}
