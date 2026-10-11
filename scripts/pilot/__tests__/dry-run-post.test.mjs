import assert from 'node:assert/strict';
import test from 'node:test';
import { runDryRun, formatTranscript } from '../dry-run-post.mjs';

test('owner lifecycle dry run: every step PASSes, no network, mock publisher only', async () => {
  const result = await runDryRun();
  const failed = result.steps.filter((s) => !s.pass);
  assert.deepEqual(failed, [], `failed steps:\n${formatTranscript(result)}`);
  assert.equal(result.ok, true);
  assert.ok(result.steps.length >= 15);
  assert.equal(result.fetchCalls, 0);
  assert.equal(result.tweets, 2, 'one successful + one ambiguous mock publish, nothing else');
  assert.match(formatTranscript(result), /LOCAL FIXTURE DRY RUN/);
});

test('env and fetch are restored after the run', async () => {
  const before = { fetch: globalThis.fetch, ids: process.env.PILOT_CLIENT_IDS, uids: process.env.PILOT_OWNER_UIDS };
  await runDryRun();
  assert.equal(globalThis.fetch, before.fetch);
  assert.equal(process.env.PILOT_CLIENT_IDS, before.ids);
  assert.equal(process.env.PILOT_OWNER_UIDS, before.uids);
});
