// studio-screen-stills.test.js — Slice F2. Pure DI tests against the
// in-memory fakes: byte-level MIME/dimension parsing, content-addressed
// idempotent pinning, clientId-scoped existence/download, and the
// hash-reverification that makes a substituted object fail loudly.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const stills = require('../studio-screen-stills.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;
beforeEach(() => { fakeCtx = makeFakeContext(); stills.__setTestContext(fakeCtx); });
afterEach(() => { stills.__setTestContext(null); });

// Minimal REAL image fixtures, built by header layout (the parser reads
// headers only — pixel data is irrelevant to what these tests assert).
function pngFixture(width = 64, height = 32) {
  const buf = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}
function jpegFixture(width = 100, height = 50) {
  // FF D8, then one APP0 segment, then SOF0 with dims.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(12);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(32)]);
}

test('parseImageBytes: PNG/JPEG dims from real headers; junk and undersized buffers are 400s', () => {
  assert.deepEqual(stills.parseImageBytes(pngFixture(640, 480)), { ext: 'png', width: 640, height: 480 });
  assert.deepEqual(stills.parseImageBytes(jpegFixture(1920, 4000)), { ext: 'jpg', width: 1920, height: 4000 });
  assert.throws(() => stills.parseImageBytes(Buffer.from('not an image, definitely long enough to pass the length gate')), (e) => e.status === 400);
  assert.throws(() => stills.parseImageBytes(Buffer.alloc(4)), (e) => e.status === 400);
});

test('pinDeviceScreenStill: content-addressed, idempotent, bytes-sniffed (claimed type never trusted)', async () => {
  const png = pngFixture(320, 200);
  const ref = await stills.pinDeviceScreenStill({ clientId: 'client-a', buffer: png });
  assert.equal(ref.ext, 'png');
  assert.equal(ref.width, 320);
  assert.equal(ref.height, 200);
  assert.equal(ref.bytes, png.length);
  assert.equal(ref.sha256, createHash('sha256').update(png).digest('hex'));

  const stored = fakeCtx.adminStorage.bucket()._raw(`studio-screen-stills/client-a/${ref.sha256}.png`);
  assert.ok(stored, 'the object must land at the content-addressed clientId-scoped path');
  assert.equal(stored.contentType, 'image/png');

  const again = await stills.pinDeviceScreenStill({ clientId: 'client-a', buffer: png });
  assert.deepEqual(again, ref, 'same bytes → same reference, every time');
});

test('pinDeviceScreenStill: a mislabeled dataUrl is judged by its BYTES; oversized and out-of-range dims reject', async () => {
  // jpeg bytes wrapped in a "png" dataUrl — the sniffer decides, not the label.
  const jpeg = jpegFixture(64, 64);
  const ref = await stills.pinDeviceScreenStill({ clientId: 'c1', dataUrl: `data:image/png;base64,${jpeg.toString('base64')}` });
  assert.equal(ref.ext, 'jpg');

  await assert.rejects(() => stills.pinDeviceScreenStill({ clientId: 'c1', buffer: Buffer.alloc(stills.MAX_STILL_BYTES + 1) }), (e) => e.status === 400);
  await assert.rejects(() => stills.pinDeviceScreenStill({ clientId: 'c1', buffer: pngFixture(4, 4) }), (e) => e.status === 400 && /dimensions/.test(e.message));
  await assert.rejects(() => stills.pinDeviceScreenStill({ clientId: 'c1', buffer: pngFixture(9000, 100) }), (e) => e.status === 400 && /dimensions/.test(e.message));
  await assert.rejects(() => stills.pinDeviceScreenStill({ clientId: 'c1', dataUrl: 'https://example.com/x.png' }), (e) => e.status === 400, 'a URL is never fetched — only data: URLs carry bytes');
});

test('deviceScreenStillExists is clientId-scoped: another tenant can never resolve a foreign still, even with the exact hash', async () => {
  const png = pngFixture();
  const ref = await stills.pinDeviceScreenStill({ clientId: 'owner', buffer: png });
  assert.equal(await stills.deviceScreenStillExists({ clientId: 'owner', still: ref }), true);
  assert.equal(await stills.deviceScreenStillExists({ clientId: 'intruder', still: ref }), false);
  assert.equal(await stills.deviceScreenStillExists({ clientId: 'owner', still: { ...ref, sha256: 'f'.repeat(64) } }), false);
  assert.equal(await stills.deviceScreenStillExists({ clientId: 'owner', still: { ...ref, sha256: '__proto__' } }), false, 'a malformed reference never even reaches Storage');
});

test('downloadDeviceScreenStill writes the exact bytes locally and re-verifies the content hash — a substituted object fails loudly', async () => {
  const png = pngFixture(48, 48);
  const ref = await stills.pinDeviceScreenStill({ clientId: 'c1', buffer: png });
  const dir = mkdtempSync(path.join(os.tmpdir(), 'stills-test-'));
  try {
    const dest = path.join(dir, 'screen-still.png');
    await stills.downloadDeviceScreenStill({ clientId: 'c1', still: ref, destPath: dest });
    assert.deepEqual(readFileSync(dest), png);

    // Substitute the stored object under the same path — the re-hash must catch it.
    await fakeCtx.adminStorage.bucket().file(`studio-screen-stills/c1/${ref.sha256}.png`).save(pngFixture(50, 50), { contentType: 'image/png' });
    await assert.rejects(
      () => stills.downloadDeviceScreenStill({ clientId: 'c1', still: ref, destPath: dest }),
      (e) => /hash mismatch/.test(e.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sanitizeScreenStillRef: strict shape — bad hash/ext/dims/bytes all null; __proto__-class values never survive', () => {
  const good = { sha256: 'a'.repeat(64), ext: 'png', width: 100, height: 200, bytes: 1000 };
  assert.deepEqual(stills.sanitizeScreenStillRef(good), good);
  assert.equal(stills.sanitizeScreenStillRef({ ...good, sha256: 'A'.repeat(64) }), null, 'uppercase hex rejected — one canonical form only');
  assert.equal(stills.sanitizeScreenStillRef({ ...good, ext: 'svg' }), null);
  assert.equal(stills.sanitizeScreenStillRef({ ...good, width: 4 }), null);
  assert.equal(stills.sanitizeScreenStillRef({ ...good, bytes: stills.MAX_STILL_BYTES + 1 }), null);
  assert.equal(stills.sanitizeScreenStillRef({ ...good, ext: '__proto__' }), null);
  assert.equal(stills.sanitizeScreenStillRef('nope'), null);
});

// ── Direct-upload transport (Codex F2 correction — Vercel's 4.5MB body cap
// makes JSON data-URLs impossible for real captures) ───────────────────────

test('start → PUT → finalize: the staged bytes become the canonical content-addressed still, and the temp object is deleted', async () => {
  const grant = await stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: 1000 });
  assert.match(grant.tempId, /^[a-f0-9-]{36}$/);
  assert.ok(grant.uploadUrl.includes('action=write'), 'must be a WRITE grant');

  const png = pngFixture(800, 2400);
  const tempPath = `studio-screen-stills-tmp/c1/${grant.tempId}`;
  await fakeCtx.adminStorage.bucket().file(tempPath).save(png, { contentType: 'image/png' }); // simulates the browser PUT

  const ref = await stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: grant.tempId });
  assert.equal(ref.width, 800);
  assert.equal(ref.height, 2400);
  assert.equal(ref.sha256, createHash('sha256').update(png).digest('hex'));
  assert.ok(fakeCtx.adminStorage.bucket()._raw(`studio-screen-stills/c1/${ref.sha256}.png`), 'canonical object written');
  assert.equal(fakeCtx.adminStorage.bucket()._raw(tempPath), undefined, 'temp object deleted after finalize');
});

test('finalize validates the REAL staged bytes: junk uploads reject AND still clean up the temp object; missing upload is a 400', async () => {
  const grant = await stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: 100 });
  const tempPath = `studio-screen-stills-tmp/c1/${grant.tempId}`;
  await fakeCtx.adminStorage.bucket().file(tempPath).save(Buffer.from('this is absolutely not an image but long enough'), {});
  await assert.rejects(() => stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: grant.tempId }), (e) => e.status === 400);
  assert.equal(fakeCtx.adminStorage.bucket()._raw(tempPath), undefined, 'temp junk deleted even on failure');

  const grant2 = await stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: 100 });
  await assert.rejects(() => stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: grant2.tempId }), (e) => e.status === 400 && /No uploaded object/.test(e.message));
});

test('start rejects bad contentType/bytes; finalize rejects malformed tempIds before touching Storage', async () => {
  await assert.rejects(() => stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/svg+xml', bytes: 100 }), (e) => e.status === 400);
  await assert.rejects(() => stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: stills.MAX_STILL_BYTES + 1 }), (e) => e.status === 400);
  await assert.rejects(() => stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: '../escape' }), (e) => e.status === 400);
  await assert.rejects(() => stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: '__proto__' }), (e) => e.status === 400);
});

test('decoded-pixel budget: dimensions individually in range but jointly over MAX_TOTAL_PIXELS reject', async () => {
  // 8000×8000 = 64MP — each side within the 8192 bound, product over 32MP.
  await assert.rejects(
    () => stills.pinDeviceScreenStill({ clientId: 'c1', buffer: pngFixture(8000, 8000) }),
    (e) => e.status === 400 && /pixel budget/.test(e.message),
  );
});

test('quotas: the daily pin-rate cap trips at PER_CLIENT_DAILY_PINS; duplicate pins never consume stored-bytes quota', async () => {
  const png = pngFixture(100, 100);
  const stage = async () => {
    const g = await stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: png.length });
    await fakeCtx.adminStorage.bucket().file(`studio-screen-stills-tmp/c1/${g.tempId}`).save(png, {});
    return g.tempId;
  };
  const first = await stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: await stage() });
  await stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: await stage() }); // duplicate content
  const quota = fakeCtx.adminDb._raw('studio_screen_still_quota', 'c1');
  assert.equal(quota.pins, 2, 'every pin counts against the rate limit');
  assert.equal(quota.bytesTotal, first.bytes, 'identical content is stored once — bytes counted once');

  // Exhaust the daily rate.
  fakeCtx.adminDb._patch('studio_screen_still_quota', 'c1', { pins: stills.PER_CLIENT_DAILY_PINS });
  const rateLimitedTempId = await stage();
  await assert.rejects(() => stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: rateLimitedTempId }), (e) => e.status === 429 && /Daily/.test(e.message));

  // Storage quota.
  fakeCtx.adminDb._patch('studio_screen_still_quota', 'c1', { pins: 0, bytesTotal: stills.PER_CLIENT_MAX_STORED_BYTES });
  const distinct = pngFixture(101, 101);
  const g2 = await stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: distinct.length });
  await fakeCtx.adminStorage.bucket().file(`studio-screen-stills-tmp/c1/${g2.tempId}`).save(distinct, {});
  await assert.rejects(() => stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: g2.tempId }), (e) => e.status === 429 && /storage quota/.test(e.message));

  // A NEW day resets the pin rate.
  fakeCtx.adminDb._patch('studio_screen_still_quota', 'c1', { day: '2000-01-01', pins: stills.PER_CLIENT_DAILY_PINS, bytesTotal: 0 });
  const ok = await stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: await stage() });
  assert.ok(ok.sha256);
});

// ── Concurrency (Codex F2b P1): two simultaneous finalizations of IDENTICAL
// content must charge stored-bytes exactly once — the per-(tenant, hash)
// asset ledger inside the quota transaction is what serializes the
// "is this new" decision (the old outside-the-transaction Storage exists()
// check let both see not-stored and double-charge). ────────────────────────

test('BARRIER: two concurrent finalizations of identical content → one canonical object, two pins, bytes charged exactly once', async () => {
  const png = pngFixture(300, 300);
  const stage = async () => {
    const g = await stills.startDeviceScreenStillUpload({ clientId: 'c1', contentType: 'image/png', bytes: png.length });
    await fakeCtx.adminStorage.bucket().file(`studio-screen-stills-tmp/c1/${g.tempId}`).save(png, {});
    return g.tempId;
  };
  const [tempA, tempB] = await Promise.all([stage(), stage()]);

  // The barrier: both finalizations launched in the same tick, racing the
  // full download → transaction → object-write pipeline.
  const [refA, refB] = await Promise.all([
    stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: tempA }),
    stills.finalizeDeviceScreenStillUpload({ clientId: 'c1', tempId: tempB }),
  ]);
  assert.deepEqual(refA, refB, 'identical bytes → identical reference from both racers');

  const quota = fakeCtx.adminDb._raw('studio_screen_still_quota', 'c1');
  assert.equal(quota.pins, 2, 'both pins count against the rate limit');
  assert.equal(quota.bytesTotal, png.length, `bytes must be charged EXACTLY once (got ${quota.bytesTotal} for a ${png.length}-byte asset)`);

  const [files] = await fakeCtx.adminStorage.bucket().getFiles({ prefix: 'studio-screen-stills/c1/' });
  assert.equal(files.length, 1, 'exactly one canonical object');

  const ledger = fakeCtx.adminDb._raw('studio_screen_still_assets', `c1__${refA.sha256}`);
  assert.ok(ledger, 'the asset ledger entry exists');
  assert.equal(ledger.bytes, png.length);
});

test('decoded-pixel budget applies in sanitizeScreenStillRef too — a reference with in-range sides but over-budget product is invalid everywhere it is consumed', async () => {
  const over = { sha256: 'a'.repeat(64), ext: 'png', width: 8000, height: 8000, bytes: 1000 };
  assert.equal(stills.sanitizeScreenStillRef(over), null);
  assert.equal(await stills.deviceScreenStillExists({ clientId: 'c1', still: over }), false, 'an over-budget reference can never resolve to a stored asset');
  await assert.rejects(() => stills.downloadDeviceScreenStill({ clientId: 'c1', still: over, destPath: '/tmp/never-written' }), (e) => e.status === 400);
});
