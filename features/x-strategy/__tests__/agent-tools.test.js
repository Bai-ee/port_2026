import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt, summarizePlan } from '../agent/prompt.js';
import { TOOL_SCHEMAS, PROPOSE_TOOL_BY_KIND, READ_TOOL_NAMES } from '../agent/tools.js';
import { PROPOSAL_KINDS } from '../contracts.js';
import { defaultPlanDoc } from '../plan-state.js';

test('prompt carries the likes-only rule and the no-invention rule', () => {
  const p = buildSystemPrompt({ planSummary: summarizePlan(defaultPlanDoc()) });
  assert.match(p, /LIKES-ONLY/);
  assert.match(p, /likes, not views/);
  assert.match(p, /NO INVENTION/);
  assert.match(p, /never invent facts, experiences/i);
  assert.match(p, /only propose/i);
  assert.match(p, /X API spend/);
  assert.match(p, /"no data"/);
  assert.match(p, /at most 2/);
  assert.match(p, /sourceQuote/);
});

test('prompt stays compact and embeds only a capped plan summary, not the evaluation', () => {
  const p = buildSystemPrompt({ planSummary: 'x'.repeat(10000), evaluationSummary: 'y'.repeat(5000) });
  assert.ok(p.length < 9000);
  assert.ok(!/"byType"|"gaps"/.test(p));
  const s = summarizePlan({ version: 2, plan: { authoredPerDay: 4, tier: 1, typeFloors: { 'quote-react': 1 }, typeCaps: {}, benchmarkPrimary: 'seb__design', notes: '' } });
  assert.match(s, /version 2/);
  assert.match(s, /quote-react=1/);
  assert.match(summarizePlan(null), /No saved plan/);
});

test('one propose tool per proposal kind, plus the six read tools, all with object schemas', () => {
  assert.deepEqual(Object.keys(PROPOSE_TOOL_BY_KIND).sort(), [...PROPOSAL_KINDS].sort());
  assert.deepEqual(READ_TOOL_NAMES, ['get_evaluation', 'get_plan', 'get_context', 'get_today_run', 'search_inventory', 'top_posts']);
  assert.equal(TOOL_SCHEMAS.length, 14);
  for (const t of TOOL_SCHEMAS) {
    assert.equal(t.input_schema.type, 'object');
    assert.ok(t.description);
  }
  const story = TOOL_SCHEMAS.find((t) => t.name === 'propose_item_story');
  assert.ok(story.input_schema.required.includes('sourceQuote'));
  const plan = TOOL_SCHEMAS.find((t) => t.name === 'propose_plan_change');
  assert.ok(!('tier' in plan.input_schema.properties.changes.properties));
});
