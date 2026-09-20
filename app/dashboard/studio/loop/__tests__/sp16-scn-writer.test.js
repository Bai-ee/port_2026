import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { encodeWavPcm16 } from '../wav-encode.js';
import {
  SCN_ADJUNCT_BYTES, SCN_MAX_PADS,
  encodeIntField, encodeDoubleField, encodeBoolField, encodeStringField,
  parseTlv, findLeaf, applyPatches, readSceneShape,
  buildUidSpid, buildSampleAdjunct, buildScnBytes, buildScnZip,
  wrapVltrgzip, unwrapVltrgzip, fetchScnSceneTemplate,
} from '../sp16-scn-writer.js';

// The shipped template — the same bytes the browser fetches at export time, so
// these tests fail loudly if the template file is swapped for one whose shape
// the writer can't fill (e.g. a scene with a different track count).
const TEMPLATE_PATH = new URL('../../../../../public/sp16/scene-template.bin', import.meta.url);
const TEMPLATE = fs.readFileSync(TEMPLATE_PATH);
// The reference export off the user's own unit. Untracked working-tree fixture:
// the byte-identity tests below only run where it exists.
const SPECIMEN_PATH = new URL('../../../../../docs/plans/fixtures/707-stomp.scn', import.meta.url);
const SPECIMEN = fs.existsSync(SPECIMEN_PATH) ? fs.readFileSync(SPECIMEN_PATH) : null;

const hex = (bytes) => Buffer.from(bytes).toString('hex');

// ── Test-local zip reader ────────────────────────────────────────────────
// Deliberately independent of `buildScnZip` (a shared helper would let one bug
// hide another) and deliberately node's own zlib, so "we wrote a real zlib
// stream" is checked by something other than the CompressionStream that wrote it.
function readZip(bytes) {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'zip has an end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('latin1');
    assert.equal(buf.readUInt32LE(localOffset), 0x04034b50, `${name} has a local header`);
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(data.length, size, `${name} inflates to its recorded size`);
    assert.equal(zlib.crc32 ? zlib.crc32(data) : crc, crc, `${name} crc matches`);
    entries.push({ name, method, size, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function unzipMember(entries, name) {
  const entry = entries.find((e) => e.name === name);
  assert.ok(entry, `zip contains ${name}`);
  return entry;
}

function inflateBlob(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 8)).toString('ascii'), 'vltrgzip');
  return zlib.inflateSync(Buffer.from(bytes.subarray(8)));
}

/** Flattens a parsed tree into `path -> node` so two documents can be compared field by field. */
function flatten(node, prefix = '', out = new Map()) {
  const path = prefix ? `${prefix}.${node.key}` : node.key;
  node.leaves.forEach((leaf) => out.set(`${path}.${leaf.key}`, leaf));
  node.containers.forEach((child) => flatten(child, path, out));
  return out;
}

function fakeWav({ frames, channels = 2, sampleRate = 44100 }) {
  const channelData = Array.from({ length: channels }, () => {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i += 1) ch[i] = Math.sin(i / 12) * 0.5;
    return ch;
  });
  return encodeWavPcm16({ channelData, sampleRate });
}

// ── Field encoders ───────────────────────────────────────────────────────

test('field encoders emit the SP-16 TLV byte patterns', () => {
  assert.equal(hex(encodeIntField(68)), '010501' + '44000000');
  assert.equal(hex(encodeIntField(-1)), '010501' + 'ffffffff');
  assert.equal(hex(encodeDoubleField(0.25)), '010904' + '000000000000d03f');
  assert.equal(hex(encodeBoolField(true)), '010102');
  assert.equal(hex(encodeBoolField(false)), '010103');
  // len = type byte + "MT" + NUL
  assert.equal(hex(encodeStringField('MT')), '0104' + '05' + '4d54' + '00');
  assert.equal(hex(encodeStringField('')), '0102' + '05' + '00');
});

test('encodeStringField refuses a string that overruns the one-byte length', () => {
  assert.throws(() => encodeStringField('x'.repeat(254)), /string too long/);
});

// ── Parser ───────────────────────────────────────────────────────────────

test('parseTlv consumes the shipped scene template exactly', () => {
  const scene = inflateBlob(TEMPLATE);
  const root = parseTlv(scene);
  assert.equal(root.key, 'ProjectData');
  assert.equal(root.end, scene.length);
  assert.equal(typeof findLeaf(root, 'projectBpm').value, 'number');
});

test('parseTlv rejects a truncated document rather than half-parsing it', () => {
  const scene = inflateBlob(TEMPLATE);
  assert.throws(() => parseTlv(scene.subarray(0, scene.length - 40)), /consumed|overruns|unterminated/);
});

// The template is what EVERY export carries. A template with recorded patterns
// ships a sequence the user never wrote, so this is the guard on swapping it:
// the shape asserted here is Pioneer's own blank scene (factory project
// `Demo 01 House Techno EDM.prj`, scenes 3-15) — 16 TrackData + SendFx +
// MasterFx + RoutingData, and nothing else.
test('the shipped template is a BLANK scene — no patterns', () => {
  const shape = readSceneShape(parseTlv(inflateBlob(TEMPLATE)));
  assert.equal(shape.patternCount, 0, 'template carries recorded patterns');
  assert.equal(shape.scene.containers.length, 19);
  assert.deepEqual(
    shape.scene.containers.slice(SCN_MAX_PADS).map((c) => c.key),
    ['SendFx', 'MasterFx', 'RoutingData'],
  );
});

test('the shipped template has one scene and sixteen tracks', () => {
  const shape = readSceneShape(parseTlv(inflateBlob(TEMPLATE)));
  assert.match(shape.scene.key, /^SceneData\d*$/);
  assert.equal(shape.tracks.length, SCN_MAX_PADS);
  shape.tracks.forEach((track, i) => {
    assert.equal(track.key, `TrackData${i}`);
    assert.ok(track.containerByKey.get('PlaybackData'), `TrackData${i} has PlaybackData`);
    assert.ok(track.leafByKey.get('colourIndex'), `TrackData${i} has colourIndex`);
  });
});

// ── Patching ─────────────────────────────────────────────────────────────

test('applyPatches splices in order and leaves every other byte untouched', () => {
  const src = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const out = applyPatches(src, [
    { start: 6, end: 8, bytes: new Uint8Array([0xbb]) },          // shorter
    { start: 2, end: 3, bytes: new Uint8Array([0xaa, 0xaa]) },    // longer
  ]);
  assert.equal(hex(out), '0001' + 'aaaa' + '030405' + 'bb' + '0809');
});

test('applyPatches rejects overlapping edits', () => {
  const src = new Uint8Array(10);
  assert.throws(
    () => applyPatches(src, [{ start: 2, end: 6, bytes: new Uint8Array(1) }, { start: 4, end: 8, bytes: new Uint8Array(1) }]),
    /overlapping/,
  );
});

// ── Generated members ────────────────────────────────────────────────────

test('buildSampleAdjunct is 68 bytes and re-parses to its inputs', () => {
  const bytes = buildSampleAdjunct({ bar: 4, bpm: 128.5, sampleNum: 172_800 });
  assert.equal(bytes.length, SCN_ADJUNCT_BYTES);
  const root = parseTlv(bytes);
  assert.equal(root.key, 'SampleAdjunctData');
  assert.equal(root.leafByKey.get('bar').value, 4);
  assert.equal(root.leafByKey.get('bpm').value, 128.5);
  assert.equal(root.leafByKey.get('sampleNum').value, 172_800);
});

test('buildUidSpid emits sixteen SourceId records in pad order and re-parses', () => {
  const records = new Array(SCN_MAX_PADS).fill(null);
  records[0] = { size: 106_856, adjunctSize: 68, url: '$Int0/%Smp/[Imported]/demo/a.wav' };
  records[3] = { size: 512, adjunctSize: 68, url: '$Int0/%Smp/[Imported]/demo/b.wav' };
  const root = parseTlv(buildUidSpid(records));
  assert.equal(root.key, 'ScenePackId');
  assert.equal(root.containers.length, SCN_MAX_PADS);
  root.containers.forEach((rec, i) => {
    assert.equal(rec.key, `SourceId${i}`);
    const expected = records[i];
    assert.equal(rec.leafByKey.get('size').value, expected ? expected.size : 0);
    assert.equal(rec.leafByKey.get('adjunctSize').value, expected ? 68 : 0);
    assert.equal(rec.leafByKey.get('url').value, expected ? expected.url : '');
  });
});

// ── vltrgzip ─────────────────────────────────────────────────────────────

test('wrapVltrgzip round-trips through unwrapVltrgzip and reads as zlib', async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const wrapped = await wrapVltrgzip(payload);
  assert.equal(Buffer.from(wrapped.subarray(0, 8)).toString('ascii'), 'vltrgzip');
  assert.equal(hex(zlib.inflateSync(Buffer.from(wrapped.subarray(8)))), hex(payload));
  assert.equal(hex(await unwrapVltrgzip(wrapped)), hex(payload));
});

test('unwrapVltrgzip rejects bytes without the header', async () => {
  await assert.rejects(() => unwrapVltrgzip(new Uint8Array(32)), /vltrgzip/);
});

// ── Template fetch ───────────────────────────────────────────────────────

test('fetchScnSceneTemplate surfaces a missing template instead of exporting a broken scene', async () => {
  await assert.rejects(
    () => fetchScnSceneTemplate({ fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /template unavailable \(404\)/,
  );
  await assert.rejects(
    () => fetchScnSceneTemplate({ fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) }),
    /template is empty/,
  );
});

// ── Zip ──────────────────────────────────────────────────────────────────

test('buildScnZip stores and deflates per member', async () => {
  const stored = new Uint8Array([1, 2, 3]);
  const raw = new Uint8Array(2048).fill(7);
  const deflated = new Uint8Array(zlib.deflateRawSync(Buffer.from(raw)));
  const entries = readZip(buildScnZip([
    { name: 'uid.spid', data: stored },
    { name: 'a.wav', data: raw, deflated },
  ]));
  assert.deepEqual(entries.map((e) => e.name), ['uid.spid', 'a.wav']);
  assert.equal(entries[0].method, 0);
  assert.equal(entries[1].method, 8);
  assert.equal(hex(entries[1].data), hex(raw));
});

// ── Integration ──────────────────────────────────────────────────────────

const PADS = [
  { padIndex: 0, filename: 'demo-pad01-loop01.wav', frames: 88_200, bpm: 120, colourIndex: 0 },
  { padIndex: 5, filename: 'demo-pad06-loop02.wav', frames: 44_100, bpm: 120, colourIndex: 5 },
  { padIndex: 15, filename: 'demo-pad16-loop03.wav', frames: 22_050, bpm: 120, colourIndex: 15 },
].map((pad) => ({ ...pad, wavBytes: fakeWav({ frames: pad.frames }) }));

async function buildFixture(overrides = {}) {
  return buildScnBytes({
    templateBytes: new Uint8Array(TEMPLATE),
    sceneName: 'HITLOOP DEMO',
    projectBpm: 120,
    barsPerLoop: 4,
    pads: PADS,
    ...overrides,
  });
}

test('buildScnBytes produces a readable .scn with the specimen member layout', async () => {
  const built = await buildFixture();
  assert.equal(built.filename, 'HITLOOP DEMO.scn');

  const entries = readZip(built.bytes);
  assert.deepEqual(entries.map((e) => e.name), [
    '# HITLOOP DEMO.prj',
    'uid.spid',
    'demo-pad01-loop01.wav', 'demo-pad01-loop01.wav.dat',
    'demo-pad06-loop02.wav', 'demo-pad06-loop02.wav.dat',
    'demo-pad16-loop03.wav', 'demo-pad16-loop03.wav.dat',
  ]);
  // The unit's own export stores the two blobs and deflates the samples.
  assert.equal(unzipMember(entries, '# HITLOOP DEMO.prj').method, 0);
  assert.equal(unzipMember(entries, 'uid.spid').method, 0);
  assert.equal(unzipMember(entries, 'demo-pad01-loop01.wav').method, 8);
  assert.equal(unzipMember(entries, 'demo-pad01-loop01.wav.dat').method, 8);
});

test('every bundled WAV survives the round trip byte for byte', async () => {
  const entries = readZip((await buildFixture()).bytes);
  PADS.forEach((pad) => {
    assert.equal(hex(unzipMember(entries, pad.filename).data), hex(pad.wavBytes));
  });
});

test('the scene blob points at the zip members and carries the pad contract', async () => {
  const entries = readZip((await buildFixture()).bytes);
  const scene = parseTlv(inflateBlob(unzipMember(entries, '# HITLOOP DEMO.prj').data));
  const shape = readSceneShape(scene);
  const memberNames = new Set(entries.map((e) => e.name));

  assert.equal(shape.scene.leafByKey.get('name').value, 'HITLOOP DEMO');
  assert.equal(shape.scene.leafByKey.get('bpm').value, 120);

  const assigned = new Map(PADS.map((p) => [p.padIndex, p]));
  shape.tracks.forEach((track, i) => {
    const playback = track.containerByKey.get('PlaybackData');
    const url = playback.leafByKey.get('audioSourceUrl').value;
    const pad = assigned.get(i);
    assert.equal(track.leafByKey.get('trackMode').value, 'Sample');
    assert.equal(track.leafByKey.get('triggerMode').value, 'OneShot');
    assert.equal(playback.leafByKey.get('pitchCent').value, 0);
    assert.equal(playback.leafByKey.get('bReverse').value, false);
    assert.equal(playback.leafByKey.get('startSample').value, 0);
    if (pad) {
      assert.equal(url, `$Int0/%Tmp/${pad.filename}`);
      assert.ok(memberNames.has(url.split('/').pop()), `pad ${i + 1} url resolves to a zip member`);
      assert.equal(playback.leafByKey.get('lengthSample').value, pad.frames);
      assert.equal(playback.leafByKey.get('bLoop').value, true);
      assert.equal(playback.leafByKey.get('stretchMode').value, 'MT');
      assert.equal(track.leafByKey.get('colourIndex').value, pad.colourIndex);
    } else {
      assert.equal(url, '');
      assert.equal(playback.leafByKey.get('lengthSample').value, 0);
      assert.equal(playback.leafByKey.get('bLoop').value, false);
      assert.equal(playback.leafByKey.get('stretchMode').value, 'Off');
    }
  });
});

test('uid.spid sizes match the bundled members exactly', async () => {
  const entries = readZip((await buildFixture()).bytes);
  const uid = parseTlv(inflateBlob(unzipMember(entries, 'uid.spid').data));
  const assigned = new Map(PADS.map((p) => [p.padIndex, p]));
  assert.equal(uid.containers.length, SCN_MAX_PADS);
  uid.containers.forEach((rec, i) => {
    const pad = assigned.get(i);
    const size = rec.leafByKey.get('size').value;
    const url = rec.leafByKey.get('url').value;
    if (!pad) {
      assert.equal(size, 0);
      assert.equal(rec.leafByKey.get('adjunctSize').value, 0);
      assert.equal(url, '');
      return;
    }
    assert.equal(size, unzipMember(entries, pad.filename).data.length);
    assert.equal(rec.leafByKey.get('adjunctSize').value, SCN_ADJUNCT_BYTES);
    assert.equal(url, `$Int0/%Smp/[Imported]/HITLOOP DEMO/${pad.filename}`);
  });
});

test('each .dat sidecar carries the real bar / bpm / frame count', async () => {
  const entries = readZip((await buildFixture()).bytes);
  PADS.forEach((pad) => {
    const dat = unzipMember(entries, `${pad.filename}.dat`);
    assert.equal(dat.size, SCN_ADJUNCT_BYTES);
    const root = parseTlv(dat.data);
    assert.equal(root.leafByKey.get('bar').value, 4);
    assert.equal(root.leafByKey.get('bpm').value, 120);
    assert.equal(root.leafByKey.get('sampleNum').value, pad.frames);
  });
});

test('only the intended fields differ from the template — structure and every other byte survive', async () => {
  const entries = readZip((await buildFixture()).bytes);
  const before = flatten(parseTlv(inflateBlob(TEMPLATE)));
  const after = flatten(parseTlv(inflateBlob(unzipMember(entries, '# HITLOOP DEMO.prj').data)));

  assert.deepEqual([...after.keys()], [...before.keys()], 'field set and order are unchanged');

  const WRITTEN = new Set([
    'name', 'bpm', 'trackMode', 'triggerMode', 'colourIndex', 'audioSourceUrl',
    'startSample', 'loopStartSample', 'lengthSample', 'bLoop', 'bReverse', 'pitchCent', 'stretchMode',
  ]);
  const changed = [];
  before.forEach((leaf, path) => {
    const other = after.get(path);
    const same = leaf.value === other.value && leaf.end - leaf.fieldStart === other.end - other.fieldStart;
    if (!same) changed.push(path);
  });
  changed.forEach((path) => {
    const key = path.split('.').pop();
    assert.ok(WRITTEN.has(key), `unexpected field changed: ${path}`);
  });
  // The template is a real scene, so at least the scene name must have moved.
  assert.ok(changed.some((p) => p.endsWith('.name')), 'the scene name was written');
});

test('buildScnBytes rejects malformed pad input rather than emitting a broken scene', async () => {
  await assert.rejects(() => buildFixture({ sceneName: '  ' }), /scene name is required/);
  await assert.rejects(() => buildFixture({ projectBpm: 0 }), /scene BPM/);
  await assert.rejects(() => buildFixture({ barsPerLoop: 0 }), /bars-per-loop/);
  await assert.rejects(
    () => buildFixture({ pads: [{ ...PADS[0], padIndex: 16 }] }),
    /pad index out of range/,
  );
  await assert.rejects(
    () => buildFixture({ pads: [PADS[0], { ...PADS[1], padIndex: 0 }] }),
    /assigned twice/,
  );
  await assert.rejects(
    () => buildFixture({ pads: [{ ...PADS[0], frames: 0 }] }),
    /frame count/,
  );
  await assert.rejects(
    () => buildFixture({ pads: [{ ...PADS[0], wavBytes: new Uint8Array(0) }] }),
    /no WAV bytes/,
  );
});

// ── Reference specimen (real export off the unit) ────────────────────────

test('generated uid.spid is byte-identical to the unit\'s own manifest', { skip: SPECIMEN ? false : 'fixture 707-stomp.scn not present' }, () => {
  const specimen = readZip(SPECIMEN);
  const uidBytes = inflateBlob(unzipMember(specimen, 'uid.spid').data);
  const parsed = parseTlv(uidBytes);
  const records = parsed.containers.map((rec) => ({
    size: rec.leafByKey.get('size').value,
    adjunctSize: rec.leafByKey.get('adjunctSize').value,
    url: rec.leafByKey.get('url').value,
  })).map((rec) => (rec.size || rec.url ? rec : null));
  assert.equal(hex(buildUidSpid(records)), hex(uidBytes));
});

test('generated .wav.dat matches the unit\'s own sidecar structure', { skip: SPECIMEN ? false : 'fixture 707-stomp.scn not present' }, () => {
  const specimen = readZip(SPECIMEN);
  const sidecar = specimen.find((e) => e.name.endsWith('.wav.dat'));
  assert.ok(sidecar, 'the specimen bundles a .wav.dat');
  const parsed = parseTlv(sidecar.data);
  const ours = buildSampleAdjunct({
    bar: parsed.leafByKey.get('bar').value,
    bpm: parsed.leafByKey.get('bpm').value,
    sampleNum: parsed.leafByKey.get('sampleNum').value,
  });
  assert.equal(ours.length, sidecar.data.length);
  assert.equal(hex(ours), hex(sidecar.data));
});

test('uid.spid sizes in the specimen match its own bundled members', { skip: SPECIMEN ? false : 'fixture 707-stomp.scn not present' }, () => {
  const specimen = readZip(SPECIMEN);
  const uid = parseTlv(inflateBlob(unzipMember(specimen, 'uid.spid').data));
  uid.containers.forEach((rec) => {
    const url = rec.leafByKey.get('url').value;
    if (!url) return;
    const member = specimen.find((e) => e.name === url.split('/').pop());
    assert.ok(member, `${url} resolves to a bundled member`);
    assert.equal(rec.leafByKey.get('size').value, member.data.length);
  });
});
