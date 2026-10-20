import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDailySlots, baselineSlotsOf } from '../daily-slots.js';

const FORMATS = [
  'Quote-react is the reach format; showcase video converts.',
  '- Daily slot baseline (Chicago time; 2h apart; after 2026-11-02 the same clock times sit one UTC hour later):',
  '  - 07:00 Graphic Design: quote-react (after the 06:30 quote scan). [model: @seb__design peak 11-12 UTC]',
  '  - 09:00 Design & Dev: showcase video 10-20s, hitloop.agency in the self-reply. [model: seb peak 14 UTC]',
  '  - 11:00 Graphic Design: quote-react. [model]',
  '  - 16:00 Dj Mix Videos: UE mix clip, undergroundexistence.info in the self-reply. [model: @slimeysmine peak 21-23 UTC]',
  '  - 18:00 Record Collection Videos: Discogs record video, collection link in the self-reply; on anniversary days a Throwback post takes this slot. [model: slimey best hour 23 UTC]',
  '  - All day: 5+ replies in the two lanes (design mornings, music evenings); not counted in the 5 posts.',
  '  - Strongest design asset on Sunday; strongest music asset on Tuesday or Saturday.',
  '- Threads: one per week.',
].join('\n');

const TRACKS = [{ id: 'design', label: 'graphic design' }, { id: 'music', label: 'Dj Mix Videos' }];

test('parses the baseline block: slots, replies, notes; [model] tags stripped; block ends at the next sibling', () => {
  const r = parseDailySlots(FORMATS);
  assert.deepEqual(r.slots.map((s) => [s.time, s.minutes, s.track]), [
    ['07:00', 420, 'Graphic Design'], ['09:00', 540, 'Design & Dev'], ['11:00', 660, 'Graphic Design'],
    ['16:00', 960, 'Dj Mix Videos'], ['18:00', 1080, 'Record Collection Videos'],
  ]);
  assert.equal(r.slots[0].note, 'quote-react (after the 06:30 quote scan).');
  assert.equal(r.slots[2].note, 'quote-react.');
  assert.ok(r.slots.every((s) => !/\[model/i.test(s.note) && s.trackId === null));
  assert.deepEqual(r.replies, { min: 5, note: '5+ replies in the two lanes (design mornings, music evenings); not counted in the 5 posts.' });
  assert.deepEqual(r.notes, ['Strongest design asset on Sunday; strongest music asset on Tuesday or Saturday.']);
});

test('track labels map to plan track ids case-insensitively; unknown labels stay null', () => {
  const r = parseDailySlots(FORMATS, { tracks: TRACKS });
  assert.deepEqual(r.slots.map((s) => s.trackId), ['design', null, 'design', 'music', null]);
});

test('absent block -> empty result', () => {
  assert.deepEqual(parseDailySlots('- Threads: one per week.'), { slots: [], replies: null, notes: [] });
  assert.deepEqual(parseDailySlots(''), { slots: [], replies: null, notes: [] });
  assert.deepEqual(parseDailySlots(undefined), { slots: [], replies: null, notes: [] });
});

test('malformed time lines are ignored (not slots, not notes); slots come back sorted', () => {
  const r = parseDailySlots([
    '- Daily slot baseline:',
    '  - 25:00 Graphic Design: too late',
    '  - 7:5 Graphic Design: bad minutes',
    '  - 09:00 no track separator',
    '  - 16:00 Dj Mix Videos: mix',
    '  - 7:00 Graphic Design: one-digit hour is fine',
  ].join('\n'));
  assert.deepEqual(r.slots.map((s) => s.time), ['07:00', '16:00']);
  assert.deepEqual(r.notes, []);
  assert.equal(r.replies, null);
});

test('baselineSlotsOf: only a confirmed doc yields slots', () => {
  const doc = { confirmed: true, version: 3, sections: { formats: FORMATS } };
  assert.equal(baselineSlotsOf(doc, { tracks: TRACKS }).slots.length, 5);
  assert.equal(baselineSlotsOf({ ...doc, confirmed: false }).slots.length, 0);
  assert.equal(baselineSlotsOf(null).slots.length, 0);
  assert.equal(baselineSlotsOf({ confirmed: true, sections: {} }).slots.length, 0);
});
