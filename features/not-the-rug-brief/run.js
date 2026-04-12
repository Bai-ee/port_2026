// run.js — Full Scout → Scribe pipeline runner
// Runs Scout then Scribe in sequence, printing all outputs to console.
// Used for manual full-chain runs and cron-triggered daily cycles.

require('./load-env');
const fs = require('fs').promises;
const path = require('path');
const { runXScout, DEFAULT_CONFIG } = require('./xscout');
const { runScribe } = require('./scribe');
const { generateReport } = require('./reporter');
const { requireClientConfig } = require('./clients');
const { getIntelligenceConfig } = require('./intelligence');
const { getContentSchema } = require('./content-schema');

async function runFullPipeline(config = DEFAULT_CONFIG, { fresh = false } = {}) {
  const intelligence = getIntelligenceConfig(config);
  // --fresh: delete latest.json before running so Scout treats this as a first run.
  // Use after config changes to avoid delta comparisons against a stale brief.
  if (fresh) {
    const latestPath = path.join(__dirname, 'data', 'briefs', config.clientId, 'latest.json');
    try {
      await fs.unlink(latestPath);
      console.log(`[${new Date().toISOString()}] PIPELINE: --fresh flag set, deleted previous latest.json`);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; // ENOENT is fine — nothing to delete
    }
  }
  const pipelineStart = new Date();
  console.log(`[${pipelineStart.toISOString()}] PIPELINE: starting full cycle for ${config.clientId}`);
  console.log('─'.repeat(60));

  // --- Step 1: Scout ---
  const brief = await runXScout(config);

  if (brief.status === 'error') {
    console.error(`[${new Date().toISOString()}] PIPELINE: Scout failed — ${brief.error}`);
    console.error('PIPELINE: aborting, cannot run Scribe without a valid brief');
    process.exit(1);
  }

  console.log('\n═══ SCOUT BRIEF ═══');
  console.log(brief.humanBrief);

  const escalations = brief.agentData?.escalations || [];
  if (escalations.length > 0) {
    console.log('\n─ Escalations ─');
    escalations.forEach((e) => console.log(`  [${e.level}] ${e.status}: ${e.summary}`));
  }

  // Brief pause so logs stay readable — not polling, just visual separation
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // --- Step 2: Scribe ---
  console.log('\n' + '─'.repeat(60));
  console.log(`[${new Date().toISOString()}] PIPELINE: handing off to Scribe...`);

  const scribeOutput = await runScribe(config.clientId, config);

  if (scribeOutput.status === 'error') {
    console.error(`[${new Date().toISOString()}] PIPELINE: Scribe failed — ${scribeOutput.error}`);
    process.exit(1);
  }

  const { content, scoutPriorityAction } = scribeOutput;
  const contentSchema = getContentSchema(config);

  console.log('\n═══ SCRIBE OUTPUT ═══');
  console.log(`Based on Scout finding: "${scoutPriorityAction}"\n`);

  contentSchema.forEach((field, index) => {
    console.log(`${index === 0 ? '' : '\n'}─ ${field.displayLabel.toUpperCase()} ─`);
    console.log(content[field.key]);
  });

  console.log(`\n─ ${(intelligence.contentOpportunitiesLabel || 'Content Opportunities').toUpperCase()} ─`);
  console.log(JSON.stringify(scribeOutput.contentOpportunities || scribeOutput.viralOpportunities || [], null, 2));

  // Guardian runs inside runScribe() — verdict is already attached to scribeOutput
  const guardianVerdict = scribeOutput.guardianFlags || {};

  console.log('\n═══ GUARDIAN VERDICT ═══');
  console.log(`readyToPublish : ${guardianVerdict.readyToPublish}`);
  console.log(`overallScore   : ${guardianVerdict.overallScore}`);
  console.log(`factualScore   : ${guardianVerdict.factualScore}`);
  console.log(`voiceScore     : ${guardianVerdict.voiceScore}`);
  console.log(`hardBlock      : ${guardianVerdict.hardBlock}`);
  console.log(`reviewRequired : ${guardianVerdict.reviewRequired}`);

  if ((guardianVerdict.concerns || []).length > 0) {
    console.log('\n─ Concerns ─');
    guardianVerdict.concerns.forEach((c) => console.log(`  • ${c}`));
  }
  if ((guardianVerdict.flags || []).length > 0) {
    console.log('\n─ Flags ─');
    guardianVerdict.flags.forEach((f) =>
      console.log(`  [${f.severity.toUpperCase()}][${f.type}] ${f.field}: ${f.issue}`)
    );
  }

  // --- Step 4: Reporter ---
  // Non-blocking — if report generation fails, pipeline still succeeds
  const reportPaths = await generateReport(scribeOutput, config.clientId);

  // --- Summary ---
  const totalDuration = ((Date.now() - pipelineStart.getTime()) / 1000).toFixed(1);
  console.log('\n' + '═'.repeat(60));
  console.log(`PIPELINE: completed in ${totalDuration}s`);
  if (config.weather?.provider) console.log(`Weather data:     data/weather/${config.clientId}/latest-weather.json`);
  console.log(`Scout brief:     data/briefs/${config.clientId}/latest.json`);
  console.log(`Scribe content:  data/content/${config.clientId}/latest-content.json`);
  if (reportPaths?.markdownPath) console.log(`Daily brief:     data/briefs/${config.clientId}/latest-brief.md`);
  if (reportPaths?.htmlPath) console.log(`HTML brief:      data/briefs/${config.clientId}/latest-brief.html`);
}

// Standalone execution
if (require.main === module) {
  const fresh = process.argv.includes('--fresh');
  const clientArgIndex = process.argv.indexOf('--client');
  const clientId = clientArgIndex >= 0 ? process.argv[clientArgIndex + 1] : DEFAULT_CONFIG.clientId;
  const config = requireClientConfig(clientId);

  runFullPipeline(config, { fresh })
    .catch((err) => {
      console.error(`[${new Date().toISOString()}] PIPELINE FATAL:`, err);
      process.exit(1);
    });
}

module.exports = { runFullPipeline };
