import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ENGINE_CONFIG, mergeEngineConfig, allocateEngines, enginesForSlotType } from '../engine-quota.js';
import { matchDay, scoreMatch } from '../match.js';

const NOW = Date.parse('2026-10-06T06:00:00Z');
const DATE = '2026-10-06';
const DAY = 86_400_000;

const slot = (n, timeCT, type) => ({ slot: String.fromCharCode(64 + n), timeCT, type, lane: 'music', hoursFromNow: 48 });
const FOUR = [
  slot(1, '09:00', 'original-showcase'),
  slot(2, '11:00', 'original-text'),
  slot(3, '13:00', 'original-showcase'),
  slot(4, '15:00', 'quote-react'),
];
const alloc = (over = {}) => allocateEngines({ slots: FOUR, now: NOW, date: DATE, ...over });

test('default config is the owner-approved starting config', () => {
  assert.equal(DEFAULT_ENGINE_CONFIG.authored.targetPerDay, 4);
  assert.equal(DEFAULT_ENGINE_CONFIG.authored.capPerDay, 6);
  assert.equal(DEFAULT_ENGINE_CONFIG.authored.minSpacingMin, 120);
  assert.deepEqual(
    [DEFAULT_ENGINE_CONFIG.engines.identity.minPerDay, DEFAULT_ENGINE_CONFIG.engines.identity.maxPerDay], [1, 2]);
  assert.equal(DEFAULT_ENGINE_CONFIG.engines.record.maxSharePct, 40);
  assert.equal(DEFAULT_ENGINE_CONFIG.engines.record.entityCooldownDays, 30);
  assert.equal(DEFAULT_ENGINE_CONFIG.engines.ue.weeklyMin, 3);
  assert.equal(DEFAULT_ENGINE_CONFIG.engines.ue.maxPerDay, 1);
});

test('mergeEngineConfig deep-merges, ignores unknown engines/keys and invalid values', () => {
  const cfg = mergeEngineConfig({
    authored: { capPerDay: 8, minSpacingMin: -5 },
    engines: { record: { maxSharePct: 30, bogus: 1, maxPerDay: 'x' }, ghost: { maxPerDay: 9 }, ue: { weeklyMin: 5, weeklyMax: 2 } },
  });
  assert.equal(cfg.authored.capPerDay, 8);
  assert.equal(cfg.authored.minSpacingMin, 120, 'negative spacing rejected');
  assert.equal(cfg.engines.record.maxSharePct, 30);
  assert.equal(cfg.engines.record.maxPerDay, 2, 'non-number rejected');
  assert.equal(cfg.engines.ghost, undefined);
  assert.equal(cfg.engines.ue.weeklyMin, 3, 'min>max override rejected whole');
  assert.equal(DEFAULT_ENGINE_CONFIG.authored.capPerDay, 6, 'defaults never mutated');
  assert.deepEqual(mergeEngineConfig(null), DEFAULT_ENGINE_CONFIG);
});

test('allocation is deterministic', () => {
  assert.deepEqual(alloc(), alloc());
});

test('dynamic slots are identity, and the identity floor is kept', () => {
  const r = alloc();
  assert.equal(r.slots[3].engine, 'identity');
  assert.ok(r.counts.identity >= 1);
  // No dynamic slot at all: the floor still claims a compatible text slot.
  const r2 = allocateEngines({ slots: [slot(1, '09:00', 'original-showcase'), slot(2, '11:00', 'original-text')], now: NOW, date: DATE });
  assert.equal(r2.slots[1].engine, 'identity');
  assert.match(r2.slots[1].engineReason, /floor/);
});

test('identity floor unmet is warned about, not hidden', () => {
  const r = allocateEngines({ slots: [slot(1, '09:00', 'original-showcase')], now: NOW, date: DATE });
  assert.ok(r.warnings.some((w) => /identity floor/.test(w)));
});

test('records never exceed 40% of authored posts', () => {
  const slots = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00'].map((t, i) => slot(i + 1, t, 'original-text'));
  const r = allocateEngines({ slots, now: NOW, date: DATE });
  const n = r.slots.filter((s) => s.engine).length;
  assert.ok(r.counts.record / n <= 0.4, `record share ${r.counts.record}/${n}`);
});

test('maxPerDay is honored (ue at most 1/day) including posts already made today', () => {
  const slots = ['09:00', '11:00', '13:00'].map((t, i) => slot(i + 1, t, 'original-showcase'));
  const r = allocateEngines({ slots, now: NOW, date: DATE });
  assert.ok(r.counts.ue <= 1);
  assert.ok(r.counts.client <= 1);
  const posted = [{ engine: 'ue', postedAt: `${DATE}T00:30:00Z` }];
  const r2 = allocateEngines({ slots, now: NOW, date: DATE, recentPosts: posted });
  assert.equal(r2.slots.filter((s) => s.engine === 'ue').length, 0, 'ue already hit its daily max');
});

test('weekly max stops an engine; weekly min pulls a behind engine forward', () => {
  const week = (engine, n) => Array.from({ length: n }, (_, i) => ({ engine, postedAt: NOW - (i + 1) * DAY }));
  const slots = [slot(1, '09:00', 'original-showcase')];
  const capped = allocateEngines({ slots, now: NOW, date: DATE, recentPosts: week('ue', 4) });
  assert.notEqual(capped.slots[0].engine, 'ue', 'ue weekly max 4 reached');
  const behind = allocateEngines({ slots, now: NOW, date: DATE, recentPosts: week('client', 3).concat(week('record', 0)) });
  assert.equal(behind.slots[0].engine, 'ue', 'ue is behind its weekly min, client is satisfied');
});

test('spacing: slots 30min apart are pushed to 120min; overflow is skipped, cap enforced', () => {
  const tight = [slot(1, '20:00', 'original-text'), slot(2, '20:30', 'original-text'), slot(3, '21:00', 'original-text'), slot(4, '21:30', 'original-text')];
  const r = allocateEngines({ slots: tight, now: NOW, date: DATE });
  assert.equal(r.slots[0].timeCT, '20:00');
  assert.equal(r.slots[1].timeCT, '22:00');
  assert.equal(r.slots[1].calendarTimeCT, '20:30');
  assert.equal(r.slots[2].engineSkipped, true, '24:00 is out of the day');
  assert.match(r.slots[2].engineReason, /spacing/);

  const many = Array.from({ length: 8 }, (_, i) => slot(i + 1, `0${i}:00`, 'original-text'));
  const capped = allocateEngines({ slots: many, now: NOW, date: DATE });
  assert.ok(capped.slots.filter((s) => s.engine).length <= 6);
});

test('spacing honors a post already made today', () => {
  const r = allocateEngines({
    slots: [slot(1, '09:00', 'original-text')], now: NOW, date: DATE,
    recentPosts: [{ engine: 'record', postedAt: `${DATE}T08:00:00Z` }],
  });
  assert.equal(r.slots[0].timeCT, '10:00');
});

test('enginesForSlotType is derived from series data', () => {
  assert.deepEqual(enginesForSlotType('original-showcase').sort(), ['client', 'record', 'ue']);
  assert.ok(enginesForSlotType('quote-react').includes('identity'));
});

// --- match.js ---------------------------------------------------------------

const pkg = (over = {}) => ({
  id: 'p', series: 'C1', pillar: 'found-this', title: 't', story: 'x'.repeat(150),
  assetRefs: ['sha-p'], mediaState: 'video', effort: 'ready', rights: 'owned', status: 'idea', cta: 'a', ...over,
});
const eslot = (engine, type = 'original-showcase') => ({ slot: 'A', type, lane: 'music', hoursFromNow: 48, engine });

test('an engine slot accepts only that engine; legacy packages resolve via series default', () => {
  const legacyRecord = pkg({ id: 'r' }); // no engine field, C1 => record
  const ue = pkg({ id: 'u', series: 'C4', pillar: 'made-this' });
  assert.ok(scoreMatch(legacyRecord, eslot('record'), { today: NOW }));
  assert.equal(scoreMatch(legacyRecord, eslot('ue'), { today: NOW }), null);
  assert.ok(scoreMatch(ue, eslot('ue'), { today: NOW }));
  assert.ok(scoreMatch(legacyRecord, { ...eslot('record'), engine: undefined }, { today: NOW }), 'no engine = unconstrained');
  const override = pkg({ id: 'o', engine: 'ue' });
  assert.ok(scoreMatch(override, eslot('ue'), { today: NOW }));
});

test('client packages need approval; approved or never-needed pass', () => {
  const base = { series: 'C6', pillar: 'made-this', engine: 'client' };
  assert.equal(scoreMatch(pkg({ ...base, approval: { state: 'needed' } }), eslot('client'), { today: NOW }), null);
  assert.equal(scoreMatch(pkg({ ...base, approval: { state: 'rejected' } }), eslot('client'), { today: NOW }), null);
  assert.ok(scoreMatch(pkg({ ...base, approval: { state: 'approved' } }), eslot('client'), { today: NOW }));
});

test('entity cooldown excludes a recently-posted label for the record engine', () => {
  const a = pkg({ id: 'a', entities: ['Warp Records'] });
  const b = pkg({ id: 'b', entities: ['Other Label'], assetRefs: ['sha-b'] });
  const recentPosts = [{ engine: 'record', postedAt: NOW - 10 * DAY, entities: ['warp records'] }];
  const r = matchDay({ slots: [eslot('record')], packages: [a, b], today: NOW, recentPosts });
  assert.equal(r.slots[0].packageId, 'b');
  const later = matchDay({ slots: [eslot('record')], packages: [a], today: NOW, recentPosts: [{ ...recentPosts[0], postedAt: NOW - 40 * DAY }] });
  assert.equal(later.slots[0].packageId, 'a', 'cooldown over after 30d');
});

test('diversity: a second slot prefers a different series/entity over a slightly better repeat', () => {
  const a = pkg({ id: 'a', series: 'C1', entities: ['X'], assetRefs: ['s1'] });
  const a2 = pkg({ id: 'a2', series: 'C1', entities: ['X'], assetRefs: ['s2'], eventDate: '2015-10-06' }); // anniversary => higher raw score
  const c = pkg({ id: 'c', series: 'C2', pillar: 'found-this', entities: ['Y'], assetRefs: ['s3'] });
  const slots = [{ ...eslot('record'), slot: 'A' }, { ...eslot('record'), slot: 'B' }];
  const r = matchDay({ slots, packages: [a, a2, c], today: NOW });
  assert.equal(r.slots[0].packageId, 'a2');
  assert.equal(r.slots[1].packageId, 'c');
});

test('evergreen record recycles after its window; non-evergreen stays retired', () => {
  const posted = (days, over = {}) => pkg({ status: 'posted', lastPostedAt: new Date(NOW - days * DAY).toISOString(), assetRefs: ['z'], ...over });
  assert.equal(scoreMatch(posted(100), eslot('record'), { today: NOW }), null, 'inside 180d window');
  const m = scoreMatch(posted(200), eslot('record'), { today: NOW });
  assert.ok(m);
  assert.ok(m.reasons.some((r) => /recycled/.test(r)));
  assert.equal(scoreMatch(posted(200, { priority: 'timely' }), eslot('record'), { today: NOW }), null);
  assert.equal(scoreMatch(posted(200, { status: 'retired' }), eslot('record'), { today: NOW }), null);
  const ue = posted(100, { series: 'C4', pillar: 'made-this' }); // no priority, not record => not evergreen
  assert.equal(scoreMatch(ue, eslot('ue'), { today: NOW }), null);
  assert.ok(scoreMatch({ ...ue, priority: 'evergreen' }, eslot('ue'), { today: NOW }), 'evergreen ue recycles after 90d');
});

test('skipped engine slots are reported as quota skips, not inventory gaps', () => {
  const r = matchDay({ slots: [{ ...eslot('record'), engine: null, engineSkipped: true, engineReason: 'over the daily cap' }], packages: [pkg()], today: NOW });
  assert.equal(r.gaps.length, 0);
  assert.equal(r.slots[0].packageId, undefined);
});

test('a named gap carries the engine that needed filling', () => {
  const r = matchDay({ slots: [eslot('client')], packages: [], today: NOW });
  assert.equal(r.gaps[0].engine, 'client');
  assert.match(r.gaps[0].need, /client/);
});

test('placeholder stories never fill a slot', async () => {
  const { scoreMatch, hasPlaceholderStory } = await import('../match.js');
  const base = { id: 'p', series: 'C1', pillar: 'found-this', title: 'A - B', mediaState: 'video', effort: 'ready', rights: 'owned', status: 'idea' };
  assert.equal(hasPlaceholderStory({ story: 'TODO — the label, why it mattered' }), true);
  assert.equal(hasPlaceholderStory({ story: 'Deep Touch\nLabel · 12\n[add your memory]' }), true);
  assert.equal(hasPlaceholderStory({ story: 'Bought this in 1996 at Gramaphone the week it came out.' }), false);
  assert.equal(scoreMatch({ ...base, story: 'TODO — fill me in, this is long enough to pass the length check easily' }, { type: 'original-showcase' }), null);
});
