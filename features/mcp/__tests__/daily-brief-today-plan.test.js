import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyBrief } from '../tools/playbook.js';

const ctxWith = (todayPlan) => ({
  email: 'o@example.com',
  now: () => Date.parse('2026-10-13T12:00:00Z'),
  services: {
    ...(todayPlan ? { todayPlan } : {}),
    strategyHandlers: () => ({ toolDepsFor: () => ({}), handle: async () => ({ ok: false, error: 'x' }) }),
  },
});

test('daily brief includes todayPlan from the shared reader', async () => {
  const plan = { tracks: [{ label: 'design', targetPerDay: 2, scheduledToday: 1 }], next: [], pendingProposals: 0, generatedAt: 'g' };
  const seen = [];
  const brief = await buildDailyBrief({ ctx: ctxWith(async (id, o) => { seen.push([id, o]); return plan; }), clientId: 'c1' });
  assert.deepEqual(brief.todayPlan, plan);
  assert.equal(seen[0][0], 'c1');
});

test('daily brief reports an error object (not a failure) when the plan reader throws', async () => {
  const brief = await buildDailyBrief({ ctx: ctxWith(async () => { throw new Error('boom'); }), clientId: 'c1' });
  assert.deepEqual(brief.todayPlan, { error: 'boom' });
  assert.equal(brief.clientId, 'c1');
});

test('daily brief tolerates a missing todayPlan service', async () => {
  const brief = await buildDailyBrief({ ctx: ctxWith(null), clientId: 'c1' });
  assert.deepEqual(brief.todayPlan, { available: false });
});
