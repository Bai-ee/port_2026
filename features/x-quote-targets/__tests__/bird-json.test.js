import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBirdJson, tweetsFromBird } from '../bird-json.js';

test('parseBirdJson: a "[" inside a bio / text does not break the parse (the old indexOf bug)', () => {
  const payload = JSON.stringify([{ id: '1', text: 'x', author: { username: 'a', name: 'Dee [DJ] Jay' } }], null, 2);
  assert.equal(tweetsFromBird(parseBirdJson(payload))[0].author.name, 'Dee [DJ] Jay');
  // a warning line that itself contains "[" or "{" before the payload
  const noisy = `⚠️ cookie [safari] failed {EPERM}\n${payload}`;
  assert.equal(tweetsFromBird(parseBirdJson(noisy)).length, 1);
});

test('parseBirdJson: objects, compact single line, and no JSON', () => {
  assert.deepEqual(tweetsFromBird(parseBirdJson('{"tweets":[{"id":"2"}]}')), [{ id: '2' }]);
  assert.deepEqual(parseBirdJson('[]'), []);
  assert.throws(() => parseBirdJson('nothing here'), /no JSON/);
  assert.deepEqual(tweetsFromBird({ users: [] }), []);
});
