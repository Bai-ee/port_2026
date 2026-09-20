import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDay, scoreMatch, anniversaryYears, isPublishable, FATIGUE_DAYS } from '../match.js';

const TODAY = Date.parse('2026-09-20T12:00:00Z');

const pkg = (over = {}) => ({
  id: 'p1',
  series: 'C3',
  pillar: 'was-there',
  title: 't',
  story: 'x'.repeat(150),
  assetRefs: ['sha-1'],
  mediaState: 'still',
  effort: 'ready',
  rights: 'owned',
  status: 'idea',
  cta: 'archive',
  ...over,
});

const showcaseSlot = { slot: 'B', type: 'original-showcase', lane: 'music', hoursFromNow: 24 };
const textSlot = { slot: 'D', type: 'original-text', lane: 'music', hoursFromNow: 24 };

test('rights is a gate, not a score', () => {
  assert.equal(isPublishable(pkg({ rights: 'client-approval-needed' })), false);
  assert.equal(isPublishable(pkg({ rights: 'never-public' })), false);
  assert.equal(scoreMatch(pkg({ rights: 'never-public' }), textSlot, { today: TODAY }), null);
});

test('a still is refused for a video series rather than filling the slot badly', () => {
  // C1 fills showcase slots and declares media:'video'. A still there measures
  // worse than a plain text post, so this must refuse, not downrank.
  const still = pkg({ series: 'C1', pillar: 'found-this', mediaState: 'still' });
  assert.equal(scoreMatch(still, showcaseSlot, { today: TODAY }), null);
  const video = pkg({ series: 'C1', pillar: 'found-this', mediaState: 'video' });
  assert.ok(scoreMatch(video, showcaseSlot, { today: TODAY }));
});

test('effort horizon refuses to promise a shoot to a slot two hours out', () => {
  const soon = { ...textSlot, hoursFromNow: 2 };
  assert.equal(scoreMatch(pkg({ effort: 'needs-shoot' }), soon, { today: TODAY }), null);
  assert.ok(scoreMatch(pkg({ effort: 'ready' }), soon, { today: TODAY }));
});

test('anniversary fires on the day regardless of year', () => {
  assert.equal(anniversaryYears(pkg({ eventDate: '2015-09-20' }), TODAY), 11);
  assert.equal(anniversaryYears(pkg({ eventDate: '2015-03-02' }), TODAY), null);
  assert.equal(anniversaryYears(pkg({ eventDate: '2026-09-20' }), TODAY), null, 'same year is not an anniversary');
});

test('an anniversary outranks an otherwise identical package', () => {
  const plain = scoreMatch(pkg({ id: 'a' }), textSlot, { today: TODAY });
  const anni = scoreMatch(pkg({ id: 'b', eventDate: '2015-09-21' }), textSlot, { today: TODAY });
  assert.ok(anni.score > plain.score);
});

test('fatigue blocks an artifact posted inside the window, allows it after', () => {
  const recent = { 'sha-1': { lastPostedAt: new Date(TODAY - 10 * 86_400_000).toISOString() } };
  assert.equal(scoreMatch(pkg(), textSlot, { today: TODAY, ledger: recent }), null);
  const old = { 'sha-1': { lastPostedAt: new Date(TODAY - (FATIGUE_DAYS + 5) * 86_400_000).toISOString() } };
  assert.ok(scoreMatch(pkg(), textSlot, { today: TODAY, ledger: old }));
});

test('matchDay leaves quote slots to the scan and names the gaps it cannot fill', () => {
  const slots = [
    { slot: 'A', type: 'quote-react', lane: 'music', hoursFromNow: 4 },
    { slot: 'B', type: 'original-showcase', lane: 'music', hoursFromNow: 24 },
    { slot: 'C', type: 'original-text', lane: 'music', hoursFromNow: 24 },
  ];
  const res = matchDay({ slots, packages: [pkg()], today: TODAY });

  assert.equal(res.slots[0].source, 'scan');
  assert.equal(res.slots[0].packageId, undefined);
  assert.equal(res.filled, 1);
  assert.equal(res.unfilled, 1);
  assert.equal(res.gaps[0].type, 'original-showcase');
  assert.match(res.gaps[0].need, /VIDEO package/);
});

test('one package is never used twice in a day', () => {
  const slots = [
    { slot: 'A', type: 'original-text', lane: 'music', hoursFromNow: 24 },
    { slot: 'B', type: 'original-text', lane: 'music', hoursFromNow: 24 },
  ];
  const res = matchDay({ slots, packages: [pkg()], today: TODAY });
  assert.equal(res.filled, 1);
  assert.equal(res.unfilled, 1);
});

test('a thin story is penalised', () => {
  const thin = scoreMatch(pkg({ id: 'thin', story: 'short' }), textSlot, { today: TODAY });
  const full = scoreMatch(pkg({ id: 'full' }), textSlot, { today: TODAY });
  assert.ok(thin.score < full.score);
  assert.ok(thin.reasons.includes('thin story'));
});
