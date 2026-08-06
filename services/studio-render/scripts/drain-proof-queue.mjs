// drain-proof-queue.mjs — Phase 3 (STUDIO-DETERMINISTIC-FINAL-RENDER-SONNET-
// HANDOFF.md): "Retain a bounded manual drain command for recovery." Repeatedly
// calls runOneProofRenderJob() until the queue reports empty, bounded by
// MAX_ITERATIONS so a bug that keeps producing "claimed" results (e.g. a
// requeue loop) can't run this command forever. Manual/ops use only — never
// invoked by proof-server.mjs, a cron, or Cloud Tasks; run by a human (or an
// on-call script) against real credentials when the durable dispatch
// mechanism has stalled and jobs need to be drained by hand.
//
// Run:
//   node scripts/drain-proof-queue.mjs
//   node scripts/drain-proof-queue.mjs --max 20   # override the iteration cap

import { pathToFileURL } from 'node:url';
import { runOneProofRenderJob } from '../proof-render-worker.mjs';

const DEFAULT_MAX_ITERATIONS = 200;

function parseMaxArg(argv) {
  const idx = argv.indexOf('--max');
  if (idx === -1) return DEFAULT_MAX_ITERATIONS;
  const n = Number(argv[idx + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_ITERATIONS;
}

async function drain({ maxIterations = DEFAULT_MAX_ITERATIONS } = {}) {
  const summary = { done: 0, queued: 0, failed: 0, lostClaim: 0, iterations: 0 };
  for (let i = 0; i < maxIterations; i += 1) {
    summary.iterations = i + 1;
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential: a manual drain has no reason to fan out
    const result = await runOneProofRenderJob({ workerId: `drain-cli-${process.pid}` });
    if (!result.claimed) {
      if (result.busy) console.log(`[drain] another worker holds the queue lease after ${i} claim(s) — run again once it finishes.`);
      else if (result.delayed) console.log(`[drain] pending work is backoff-delayed until ${result.retryAt} after ${i} claim(s) — run again at or after that time.`);
      else console.log(`[drain] queue empty after ${i} claim(s).`);
      return summary;
    }
    const label = result.status === 'lost-claim' ? 'lost-claim' : result.status;
    console.log(`[drain] ${result.jobId} -> ${label}${result.error ? ` (${result.error})` : ''}`);
    if (result.status === 'done') summary.done += 1;
    else if (result.status === 'queued') summary.queued += 1;
    else if (result.status === 'failed') summary.failed += 1;
    else if (result.status === 'lost-claim') summary.lostClaim += 1;
  }
  console.warn(`[drain] hit the ${maxIterations}-iteration cap without an empty queue — run again if more work remains.`);
  return summary;
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  const summary = await drain({ maxIterations: parseMaxArg(process.argv.slice(2)) });
  console.log(`[drain] summary: ${JSON.stringify(summary)}`);
}

export { drain, DEFAULT_MAX_ITERATIONS };
