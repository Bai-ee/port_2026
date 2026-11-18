import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickClipWindow, joinsFromKeep, slugify, makeReviewId, storagePathsFor, buildTokenUrl, clipFilter, parseEnvText,
  preflightEnv, buildReviewRecord, validateRestoreJson, EXPECTED_BUCKET, EXPECTED_PROJECT_ID,
} from '../review-clip.js';

const SHA = 'ab12cd34ef56'.padEnd(64, '0');
const overlapsJoin = (w, j) => w.startS < j + 30 && w.startS + w.lengthS > j - 30;

test('joinsFromKeep: cumulative output-time boundaries, no final end', () => {
  assert.deepEqual(joinsFromKeep([{ startS: 10, endS: 110 }, { startS: 200, endS: 500 }, { startS: 600, endS: 700 }]), [100, 400]);
  assert.deepEqual(joinsFromKeep([{ startS: 0, endS: 50 }]), []);
});

test('pickClipWindow: deterministic, in range, avoids joins', () => {
  const args = { durationS: 3000, joinsS: [600, 1500, 2200], seedHex: SHA };
  const a = pickClipWindow(args);
  assert.deepEqual(a, pickClipWindow(args));
  assert.equal(a.lengthS, 60);
  assert.ok(a.startS >= 120 && a.startS <= 3000 - 180);
  for (const j of args.joinsS) assert.ok(!overlapsJoin(a, j));
  assert.equal(a.joinFree, true);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const w = pickClipWindow({ ...args, seedHex: (i * 7919 + 12345).toString(16).padStart(8, '0') });
    seen.add(w.startS);
    for (const j of args.joinsS) assert.ok(!overlapsJoin(w, j));
  }
  assert.ok(seen.size > 20);
});

test('pickClipWindow: short tape is centred, nudged away from a join', () => {
  const c = pickClipWindow({ durationS: 300, joinsS: [], seedHex: SHA });
  assert.equal(c.startS, 120);
  const n = pickClipWindow({ durationS: 300, joinsS: [150], seedHex: SHA });
  assert.ok(!overlapsJoin(n, 150));
  assert.ok(n.startS + n.lengthS <= 300 - 5);
  const none = pickClipWindow({ durationS: 100, joinsS: [50], seedHex: SHA });
  assert.equal(none.joinFree, false);
});

test('pickClipWindow: tape shorter than a clip', () => {
  const w = pickClipWindow({ durationS: 40, joinsS: [], seedHex: SHA });
  assert.equal(w.lengthS, 40);
  assert.equal(w.startS, 0);
});

test('slug and reviewId', () => {
  assert.equal(slugify('REC020 (Mix) #1!'), 'rec020-mix-1');
  assert.equal(slugify('!!!'), 'tape');
  assert.equal(makeReviewId('REC 020', SHA), 'rec-020-ab12cd34');
  assert.throws(() => makeReviewId('x', 'nothex'));
});

test('storage paths and token url', () => {
  const p = storagePathsFor('rec020-ab12cd34', 'abcdef012345');
  assert.equal(p.original, 'mixtape-reviews/rec020-ab12cd34/abcdef012345/original.m4a');
  assert.throws(() => storagePathsFor('x', 'short'));
  const u = buildTokenUrl('b.app', p.restored, 'tok');
  assert.ok(u.startsWith('https://firebasestorage.googleapis.com/v0/b/b.app/o/mixtape-reviews%2F'));
  assert.ok(u.endsWith('?alt=media&token=tok'));
});

test('clipFilter', () => {
  assert.equal(clipFilter(0), 'afade=t=in:d=1,afade=t=out:st=59:d=1');
  assert.equal(clipFilter(-1.23456), 'volume=-1.235dB,afade=t=in:d=1,afade=t=out:st=59:d=1');
});

test('parseEnvText', () => {
  const e = parseEnvText('# c\nA=1\nexport B="two words"\nC=\'x\'\nD=val # trailing\nbad line\n');
  assert.deepEqual(e, { A: '1', B: 'two words', C: 'x', D: 'val' });
});

const goodEnv = () => ({
  FIREBASE_ADMIN_PROJECT_ID: EXPECTED_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL: 'svc@example.com',
  FIREBASE_ADMIN_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nSECRET-KEY-VALUE\\n-----END PRIVATE KEY-----\\n', FIREBASE_ADMIN_STORAGE_BUCKET: EXPECTED_BUCKET,
});

test('preflightEnv: ok returns only project + bucket', () => {
  assert.deepEqual(preflightEnv(goodEnv()), { projectId: EXPECTED_PROJECT_ID, bucket: EXPECTED_BUCKET });
  const e = goodEnv(); delete e.FIREBASE_ADMIN_STORAGE_BUCKET; e.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = EXPECTED_BUCKET;
  assert.equal(preflightEnv(e).bucket, EXPECTED_BUCKET);
});

test('preflightEnv: fails closed and never leaks values', () => {
  const cases = [
    (e) => { delete e.FIREBASE_ADMIN_PRIVATE_KEY; },
    (e) => { e.FIREBASE_ADMIN_PROJECT_ID = 'other-project-zzz'; },
    (e) => { e.FIREBASE_ADMIN_STORAGE_BUCKET = 'other-bucket-zzz.app'; },
    (e) => { delete e.FIREBASE_ADMIN_STORAGE_BUCKET; },
  ];
  for (const mut of cases) {
    const e = goodEnv(); mut(e);
    assert.throws(() => preflightEnv(e), (err) => {
      for (const v of ['SECRET-KEY-VALUE', 'svc@example.com', 'other-project-zzz', 'other-bucket-zzz.app']) assert.ok(!err.message.includes(v));
      return true;
    });
  }
  assert.throws(() => preflightEnv(null));
});

test('preflightEnv: private key must look like a PEM key, error names variable only', () => {
  const e = goodEnv(); e.FIREBASE_ADMIN_PRIVATE_KEY = 'SECRET-KEY-VALUE';
  assert.throws(() => preflightEnv(e), (err) => err.message.includes('FIREBASE_ADMIN_PRIVATE_KEY') && !err.message.includes('SECRET-KEY-VALUE'));
  const e2 = goodEnv(); e2.FIREBASE_ADMIN_PRIVATE_KEY = '-----BEGIN PUBLIC KEY-----';
  assert.throws(() => preflightEnv(e2), /FIREBASE_ADMIN_PRIVATE_KEY/);
});

const restore = {
  restoreVersion: 1, chainHash: 'abcdef012345', chain: 'highpass=f=22', steps: { air: true },
  diagSummary: { integratedLufs: -15.9, balanceDb: -2.4, humHz: [60], rolloffHz: 14000, secretExtra: 1 },
  source: { trimmedName: 'REC020.trimmed.wav', trimmedSha256: SHA, trimJsonName: 'REC020.trim.json', originalName: '/Volumes/x/REC020.wav' },
  output: { name: 'REC020.restored.wav', sha256: SHA, durationS: 2000.5 },
};
const trim = { detectorVersion: 2, renderVersion: 1, source: { durationS: 2100 }, cuts: [{ kind: 'gap', startS: 1, endS: 51 }, { kind: 'head', startS: 0, endS: 1 }, { kind: 'gap', startS: 5, endS: 10 }] };

test('buildReviewRecord: whitelist, summaries, prefix guard', () => {
  const id = makeReviewId('REC020', SHA);
  const paths = storagePathsFor(id, restore.chainHash);
  const rec = buildReviewRecord({ reviewId: id, title: '', restore, trim, clip: { startS: 300, lengthS: 60 }, gainsDb: { original: -0.5, restored: 0.25 },
    urls: { original: 'u1', restored: 'u2' }, storagePaths: paths, now: '2026-11-18T00:00:00.000Z' });
  assert.equal(rec.title, 'REC020');
  assert.deepEqual(rec.cuts, { count: 3, kinds: ['gap', 'head'], removedS: 56 });
  assert.equal(rec.chainLabel, 'Clean-up + gentle hiss + air');
  assert.deepEqual(rec.diag, { balanceDb: -2.4, humHz: [60], rolloffHz: 14000, lufs: -15.9 });
  assert.deepEqual(rec.versions, { detector: 2, render: 1, restore: 1, publish: 1 });
  assert.deepEqual(Object.keys(rec).sort(), ['chain', 'chainHash', 'chainLabel', 'clip', 'createdAt', 'cuts', 'diag', 'durations', 'publishedAt', 'status', 'storagePaths', 'tapeStem', 'title', 'urls', 'versions']);
  assert.ok(!JSON.stringify(rec).includes('/Volumes'));
  assert.ok(rec.storagePaths.every((p) => p.startsWith(`mixtape-reviews/${id}/`)));
  assert.throws(() => buildReviewRecord({ reviewId: id, restore, trim, clip: { startS: 0, lengthS: 60 }, gainsDb: {}, urls: {}, now: 'x',
    storagePaths: { original: 'other/a.m4a', restored: paths.restored } }), /outside/);
  const noAir = buildReviewRecord({ reviewId: id, title: 'T', restore: { ...restore, steps: { air: false } }, trim, clip: { startS: 0, lengthS: 60 }, gainsDb: {}, urls: {}, storagePaths: paths, now: 'x' });
  assert.equal(noAir.chainLabel, 'Clean-up + gentle hiss');
  assert.equal(noAir.title, 'T');
});

test('validateRestoreJson', () => {
  assert.deepEqual(validateRestoreJson(restore), []);
  assert.ok(validateRestoreJson({}).length > 0);
  assert.ok(validateRestoreJson(null).length > 0);
  const bad = ['../x.wav', 'a/b.wav', 'a\\b.wav', '.', '..', '.hidden.wav', '', '/abs.wav'];
  for (const b of bad) {
    assert.ok(validateRestoreJson({ ...restore, source: { ...restore.source, trimmedName: b } }).length > 0, `trimmedName ${b}`);
    assert.ok(validateRestoreJson({ ...restore, source: { ...restore.source, trimJsonName: b } }).length > 0, `trimJsonName ${b}`);
    assert.ok(validateRestoreJson({ ...restore, output: { ...restore.output, name: b } }).length > 0, `output.name ${b}`);
  }
});
