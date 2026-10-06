import assert from 'node:assert/strict';
import test from 'node:test';

import { publish, GRAPH_API_VERSION } from '../adapters/instagram.js';
import { buildInstagramCaption, IG_CAPTION_MAX } from '../instagram-caption.js';

const creds = (fetchImpl, extra = {}) => ({ accessToken: 'tok', igUserId: '123', fetchImpl, sleep: async () => {}, allowNotLive: true, ...extra });
const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// Scripted fake: each call shifts the next handler; records calls.
function fake(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = script.shift();
    if (!next) throw new Error('unexpected extra call');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetchImpl, calls };
}

const reel = { mediaType: 'reel', mediaUrl: 'https://cdn.example/v.mp4', caption: 'hello' };

test('reel happy path: container -> poll -> publish', async () => {
  const { fetchImpl, calls } = fake([
    reply({ id: 'c1' }),
    reply({ status_code: 'IN_PROGRESS' }),
    reply({ status_code: 'FINISHED' }),
    reply({ id: 'm9' }),
  ]);
  const out = await publish(reel, creds(fetchImpl));
  assert.equal(out.instagramMediaId, 'm9');
  assert.equal(out.containerId, 'c1');
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, new RegExp(`/${GRAPH_API_VERSION}/123/media$`));
  assert.match(calls[0].init.body, /media_type=REELS/);
  assert.match(calls[3].url, /123\/media_publish$/);
  assert.match(calls[3].init.body, /creation_id=c1/);
  assert.ok(!calls[0].url.includes('tok'), 'token must not be in the URL');
});

test('carousel creates children then parent', async () => {
  const { fetchImpl, calls } = fake([
    reply({ id: 'k1' }), reply({ status_code: 'FINISHED' }),
    reply({ id: 'k2' }), reply({ status_code: 'FINISHED' }),
    reply({ id: 'p' }), reply({ status_code: 'FINISHED' }),
    reply({ id: 'm' }),
  ]);
  const out = await publish({ mediaType: 'carousel', caption: 'c', children: [{ mediaUrl: 'https://a/1.jpg' }, { mediaUrl: 'https://a/2.jpg' }] }, creds(fetchImpl));
  assert.equal(out.instagramMediaId, 'm');
  assert.match(calls[4].init.body, /media_type=CAROUSEL/);
  assert.match(calls[4].init.body, /children=k1%2Ck2/);
});

test('poll timeout is retryable (nothing published) and never calls media_publish', async () => {
  const { fetchImpl, calls } = fake([reply({ id: 'c1' }), reply({ status_code: 'IN_PROGRESS' }), reply({ status_code: 'IN_PROGRESS' })]);
  await assert.rejects(publish(reel, creds(fetchImpl, { poll: { maxAttempts: 2 } })), (e) => {
    assert.equal(e.code, 'ig-poll-timeout');
    assert.equal(e.retryable, true);
    return true;
  });
  assert.ok(!calls.some((c) => c.url.includes('media_publish')));
});

test('processing ERROR is terminal, not retryable', async () => {
  const { fetchImpl } = fake([reply({ id: 'c1' }), reply({ status_code: 'ERROR' })]);
  await assert.rejects(publish(reel, creds(fetchImpl)), (e) => e.code === 'ig-media-processing-failed' && e.retryable === false);
});

test('container-stage network error and 5xx retry; 4xx rejection and bad token do not', async () => {
  await assert.rejects(publish(reel, creds(fake([new Error('socket hang up')]).fetchImpl)), (e) => e.retryable === true && !e.ambiguous);
  await assert.rejects(publish(reel, creds(fake([reply({ error: { message: 'x' } }, 503)]).fetchImpl)), (e) => e.retryable === true);
  await assert.rejects(publish(reel, creds(fake([reply({ error: { message: 'bad url', code: 9004 } }, 400)]).fetchImpl)), (e) => e.retryable === false && e.code === 'ig-rejected');
  await assert.rejects(publish(reel, creds(fake([reply({ error: { message: 'expired', code: 190 } }, 400)]).fetchImpl)), (e) => e.code === 'ig-reconnect-required' && e.retryable === false);
});

test('media_publish timeout/5xx is ambiguous and NOT retryable', async () => {
  const ok = () => [reply({ id: 'c1' }), reply({ status_code: 'FINISHED' })];
  await assert.rejects(publish(reel, creds(fake([...ok(), new Error('ETIMEDOUT')]).fetchImpl)), (e) => e.ambiguous === true && e.retryable === false && e.stage === 'publish');
  await assert.rejects(publish(reel, creds(fake([...ok(), reply({ error: { message: 'oops' } }, 500)]).fetchImpl)), (e) => e.ambiguous === true && e.retryable === false);
  // definitive 4xx proves rejection: not ambiguous, still not retryable
  await assert.rejects(publish(reel, creds(fake([...ok(), reply({ error: { message: 'no', code: 100 } }, 400)]).fetchImpl)), (e) => e.ambiguous === false && e.retryable === false);
});

test('refuses while platforms.js says live:false unless allowNotLive', async () => {
  const { fetchImpl, calls } = fake([]);
  await assert.rejects(publish(reel, { accessToken: 't', igUserId: '1', fetchImpl }), (e) => e.code === 'ig-not-live' && e.status === 403);
  assert.equal(calls.length, 0);
});

test('validates input before any network call', async () => {
  const { fetchImpl, calls } = fake([]);
  await assert.rejects(publish({ ...reel, mediaUrl: 'http://x/v.mp4' }, creds(fetchImpl)), (e) => e.code === 'ig-media-url-not-public');
  await assert.rejects(publish({ ...reel, caption: 'a'.repeat(2201) }, creds(fetchImpl)), (e) => e.code === 'ig-caption-too-long');
  await assert.rejects(publish({ mediaType: 'carousel', children: [{ mediaUrl: 'https://a/1.jpg' }] }, creds(fetchImpl)), (e) => e.code === 'ig-bad-request');
  assert.equal(calls.length, 0);
});

// ---- caption rules ----
const pkg = (over = {}) => ({ story: 'Found this pressing in a Detroit basement in 2009 and it has not left the shelf since.', tags: ['vinyl', '#Detroit', 'house', 'techno', 'crates', 'extra'], ...over });

test('caption: no emoji, default 3-5 hashtags, within limit', () => {
  const r = buildInstagramCaption(pkg({ story: 'Found this pressing in a basement \u{1F525} and it never left the shelf, truly.' }));
  assert.equal(r.ok, true);
  assert.ok(!/\p{Extended_Pictographic}/u.test(r.caption));
  assert.equal(r.hashtags.length, 5);
  assert.ok(r.caption.length <= IG_CAPTION_MAX);
});

test('caption: hashtag policy parameter; max 0 disables; no invented tags', () => {
  assert.equal(buildInstagramCaption(pkg(), { hashtagPolicy: { max: 0 } }).caption.includes('#'), false);
  assert.equal(buildInstagramCaption(pkg({ tags: [] })).hashtags.length, 0);
  assert.equal(buildInstagramCaption(pkg(), { hashtagPolicy: { min: 1, max: 2 } }).hashtags.length, 2);
});

test('caption: links become link-in-bio text, never a raw URL', () => {
  const r = buildInstagramCaption(pkg({ link: 'https://example.com/x' }));
  assert.match(r.caption, /Link in bio\./);
  assert.ok(!r.caption.includes('https://'));
});

test('caption: prefers variants.instagram and truncates over-long bodies keeping tags', () => {
  const v = buildInstagramCaption(pkg({ variants: { instagram: { caption: 'Variant copy wins here.' } } }));
  assert.match(v.caption, /^Variant copy wins here\./);
  const long = buildInstagramCaption(pkg({ story: 'word '.repeat(700) }));
  assert.equal(long.truncated, true);
  assert.ok(long.caption.length <= IG_CAPTION_MAX);
  assert.match(long.caption, /#vinyl/);
});

test('caption: refuses placeholder stories', () => {
  for (const story of ['TODO', '[add your memory]', '', '   ', 'Story: TBD later']) {
    const r = buildInstagramCaption(pkg({ story }));
    assert.equal(r.ok, false, story);
    assert.equal(r.reason, 'placeholder-story');
  }
});
