// The agent knows today's date: prompt TODAY line + get_calendar today/timezone.
import { test } from 'node:test';
import assert from 'node:assert/strict';


test('agent knows today: the prompt carries TODAY and get_calendar returns today/timezone', async () => {
  const { buildSystemPrompt } = await import('../agent/prompt.js');
  const { runReadTool } = await import('../agent/tools.js');
  const p = buildSystemPrompt({ planSummary: 'x', today: { date: '2026-10-17', timezone: 'America/Chicago' } });
  assert.match(p, /TODAY: 2026-10-17 \(America\/Chicago\)/);
  assert.doesNotMatch(buildSystemPrompt({ planSummary: 'x' }), /TODAY:/);
  const out = await runReadTool('get_calendar', {}, { readCalendar: async () => ({ days: [] }), getToday: async () => ({ date: '2026-10-17', timezone: 'America/Chicago' }) });
  assert.equal(out.today, '2026-10-17');
  assert.equal(out.timezone, 'America/Chicago');
});
