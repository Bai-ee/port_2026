// Read-only export of everything stored under the Hitloop client (bryan-balli-WUoltG84).
const path = require('path');
const fs = require('fs');
const ROOT = '/Users/bballi/Documents/Repos/Bballi_Portfolio-content-center';
require('dotenv').config({ path: path.join(ROOT, '.env.local'), quiet: true });
const fb = require(path.join(ROOT, 'api/_lib/firebase-admin.cjs'));
const db = fb.adminDb;
const ID = 'bryan-balli-WUoltG84';
const OUT = path.join(ROOT, 'docs/company-brain/clients/hitloop');

const SECRET = /token|secret|password|apikey|api_key|privatekey|private_key|refresh|credential|auth/i;
function redact(v, k = '') {
  if (SECRET.test(k) && v && typeof v !== 'object') return '[redacted]';
  if (Array.isArray(v)) return v.map((x) => redact(x));
  if (v && typeof v === 'object') {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    const o = {};
    for (const [kk, vv] of Object.entries(v)) o[kk] = redact(vv, kk);
    return o;
  }
  return v;
}
async function doc(coll, id) { const s = await db.collection(coll).doc(id).get(); return s.exists ? redact(s.data()) : null; }
async function sub(coll, id, subc, limit = 50) {
  const s = await db.collection(coll).doc(id).collection(subc).limit(limit).get();
  return s.docs.map((d) => ({ id: d.id, ...redact(d.data()) }));
}
async function byClient(coll, field = 'clientId', limit = 200) {
  try { const s = await db.collection(coll).where(field, '==', ID).limit(limit).get(); return s.docs.map((d) => ({ id: d.id, ...redact(d.data()) })); }
  catch (e) { return { error: e.message }; }
}

(async () => {
  const out = { exportedAt: new Date().toISOString(), clientId: ID, readOnly: true };
  out.client = await doc('clients', ID);
  out.client_configs = await doc('client_configs', ID);
  out.digest_config = await doc('digest_config', ID);
  out.dashboard_state = await doc('dashboard_state', ID);
  out.client_brain_current = await doc(`clients/${ID}/client_brain`, 'current');
  out.client_subcollections = {};
  for (const sc of ['client_brain', 'sources', 'knowledge', 'social_accounts', 'calendar']) {
    try { out.client_subcollections[sc] = await sub('clients', ID, sc); } catch (e) { out.client_subcollections[sc] = { error: e.message }; }
  }
  out.x_strategy_plans = await doc('x_strategy_plans', ID);
  out.x_strategy_docs = await doc('x_strategy_docs', ID);
  out.social_accounts = await byClient('social_accounts');
  out.social_posts_sample = await byClient('social_posts', 'clientId', 50);
  out.x_monitor = await doc('x_monitor', ID);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'live-export-2026-10-13.json'), JSON.stringify(out, null, 2));

  // Readable summary of the reference-worthy fields.
  const mb = out.client_configs?.marketingBriefConfig || {};
  const L = (a) => (Array.isArray(a) && a.length ? a.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n') : '- (none)');
  const md = `# Hitloop (bryan-balli-WUoltG84) — live data export, ${out.exportedAt.slice(0, 10)}

Read-only snapshot taken before the Client Brain source-of-truth rollout. Full raw dump (secrets redacted): \`live-export-2026-10-13.json\`.

## Client
- Name: ${out.client?.name} · Site: ${out.client?.websiteUrl || out.client?.website} · Status: ${out.client?.status}
- Owner uid: ${out.client?.ownerUid}

## Market Signals (client_configs.marketingBriefConfig)
- Brand name: ${mb.brandName} · Brand X handle: ${mb.brandXHandle || '(unset)'}
- Source platforms: ${JSON.stringify(mb.sourcePlatforms || null)}
- Source focus: ${mb.sourceFocus || '(unset)'}

### Brand keywords
${L(mb.brandKeywords)}

### Category terms
${L(mb.categoryTerms)}

### Competitors
${L(mb.competitors)}

### Listening watchlist (kols)
${L(mb.kols)}

### Instagram handles
${L(mb.instagramHandles)}

### Searches
${L(mb.searches)}

### Opportunity Signals queries
${L(mb.opportunitySignals?.queries)}

### X growth (ownHandle / benchmarks)
- Own handle: ${mb.xGrowth?.ownHandle || '(unset)'}
${L(mb.xGrowth?.benchmarkHandles)}

### Scribe / Guardian
- scoutInstructions: ${mb.scoutInstructions || '(unset)'}
- scribeTone: ${mb.scribeTone || '(unset)'}
- scribeHardConstraints: ${JSON.stringify(mb.scribeHardConstraints || null)}
- guardianReviewerContext: ${mb.guardianReviewerContext || '(unset)'}
- guardianRestrictedPatterns: ${JSON.stringify(mb.guardianRestrictedPatterns || null)}
- analysisRecipes: ${JSON.stringify(mb.analysisRecipes || null)}

## Scout config mirror (client_configs.scoutConfig)
\`\`\`json
${JSON.stringify(out.client_configs?.scoutConfig || null, null, 2)}
\`\`\`

## Email digest (digest_config)
- tone: ${out.digest_config?.tone || '(unset)'} · contactUrl: ${out.digest_config?.contactUrl || '(unset)'} · recipientEmail: ${out.digest_config?.recipientEmail || '(unset)'}
- extraInstructions: ${out.digest_config?.extraInstructions || '(unset)'}
- schedule: ${JSON.stringify(out.digest_config?.schedule || null)}

## Brand overview (dashboard_state.snapshot.brandOverview)
\`\`\`json
${JSON.stringify(out.dashboard_state?.snapshot?.brandOverview || null, null, 2)}
\`\`\`

## Strategy Builder config (dashboard_state.strategyBuilder.config)
\`\`\`json
${JSON.stringify(out.dashboard_state?.strategyBuilder?.config || null, null, 2)}
\`\`\`

## X strategy plan (x_strategy_plans) — tracks, benchmarks, engines
\`\`\`json
${JSON.stringify(out.x_strategy_plans?.plan || out.x_strategy_plans || null, null, 2)}
\`\`\`

## Strategy document (x_strategy_docs)
\`\`\`json
${JSON.stringify(out.x_strategy_docs || null, null, 2)}
\`\`\`

## Social accounts (tokens redacted)
\`\`\`json
${JSON.stringify(out.social_accounts, null, 2)}
\`\`\`

## Current Client Brain doc
- status: ${out.client_brain_current?.status} · settingsAdoptedAt: ${out.client_brain_current?.settingsAdoptedAt || '(none)'}
- Markdown first line: ${(out.client_brain_current?.markdownSource || '').split('\n').find((l) => l.startsWith('#')) || '(no markdown)'}

### Markdown (as stored today — Claire Calls, to be replaced)
\`\`\`markdown
${out.client_brain_current?.markdownSource || '(none)'}
\`\`\`
`;
  fs.writeFileSync(path.join(OUT, 'live-export-2026-10-13.md'), md);
  console.log('wrote', OUT);
  console.log('keywords', (mb.brandKeywords || []).length, 'competitors', (mb.competitors || []).length, 'kols', (mb.kols || []).length, 'ig', (mb.instagramHandles || []).length, 'oppQueries', (mb.opportunitySignals?.queries || []).length, 'benchmarks', (mb.xGrowth?.benchmarkHandles || []).length);
  console.log('plan tracks', Object.keys(out.x_strategy_plans?.plan?.contentTracks || {}).length, 'strategy doc', !!out.x_strategy_docs, 'social accounts', Array.isArray(out.social_accounts) ? out.social_accounts.length : out.social_accounts);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
