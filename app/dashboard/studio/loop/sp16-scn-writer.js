// Loop Studio — TORAIZ SP-16 `.scn` SCENE writer.
//
// A `.scn` is one clean scene (16 tracks, pad assignments, bundled samples)
// that imports into ANY project on the unit via Scene Manager. It replaces the
// old `.prj` export, whose artifact was a patched Pioneer demo project (15
// scenes of leftover demo content, 48 demo patterns, inherited track state).
// Format decoded byte-for-byte in `docs/plans/SP16-SCN-FORMAT-NOTES.md`.
//
// ── Module tier ───────────────────────────────────────────────────────────
// Standalone, like wav-encode.js/loop-engine.js: no React, no DOM, no Web
// Audio, no decoding. Everything here is bytes in / bytes out, so the whole
// writer runs under `node:test`. The two things it DOES need are the platform
// compression primitives (`CompressionStream` / `DecompressionStream`, present
// in modern Chromium AND in node) and — for the template — a `fetch`, which is
// injectable. Audio preparation (engine bytes, resampling to 44.1k, WAV
// encoding) belongs to the caller; this module takes finished WAV bytes.
//
// ── Container ─────────────────────────────────────────────────────────────
//   <name>.scn                      ZIP, members at archive ROOT, no folders
//   ├── "# <name>.prj"              scene blob   — "vltrgzip" + zlib, STORED
//   ├── uid.spid                    sample index — "vltrgzip" + zlib, STORED
//   ├── <loop>.wav                  the loops                    — DEFLATED
//   └── <loop>.wav.dat              68-byte SampleAdjunctData    — DEFLATED
// Compression methods mirror a real export from the unit exactly.
//
// ── TLV grammar (verified against a real exported scene, 48,928 bytes) ────
// Every node is `key\0` followed by a LEAF LIST then a CONTAINER LIST:
//
//   list      := 0x00                     (empty)
//              | 0x01 <count>             (count entries follow)
//   leaf      := key\0 0x01 <len8>  <type> <payload>      len8  = 1 + payload
//              | key\0 0x02 <len16le><type> <payload>     len16 = whole field
//   container := key\0 <leafList> <leaves...> <contList> <containers...>
//
//   type 0x01 int32le · 0x02 true · 0x03 false · 0x04 f64le
//        0x05 ascii + NUL · 0x07 inline object · 0x08 compressed blob
//
// So a scene blob is one `ProjectData` (20 leaves + 1 container) holding one
// `SceneData<n>` (3 leaves + 24 containers: TrackData0..15, PatternData0..N,
// SendFx, MasterFx, RoutingData). The index suffix on `SceneData<n>` is the
// slot the scene was exported FROM; import re-slots it.
//
// ── Writing rule: FILL, never synthesize ─────────────────────────────────
// The writer patches leaf values inside a real exported scene and rebuilds the
// two tiny generated members (`uid.spid`, the `.dat` sidecars) from scratch —
// it never adds, removes or reorders a TLV block. Patches are collected as
// byte ranges against the ORIGINAL buffer and spliced in one pass, so a string
// field changing length can never shift a later patch's offsets, and every
// untouched byte survives verbatim.

import { crc32 } from './wav-encode.js';

const VLTRGZIP = 'vltrgzip';
const HEADER_BYTES = VLTRGZIP.length;

/** Public path of the shipped scene template (see scripts/sp16-extract-scene-template.mjs). */
export const SCN_SCENE_TEMPLATE_URL = '/sp16/scene-template.bin';
/** The SP-16 has 16 pads; a scene always carries exactly 16 TrackData blocks. */
export const SCN_MAX_PADS = 16;
/** Every `.wav.dat` sidecar is exactly this long — the unit's `SampleAdjunctData`. */
export const SCN_ADJUNCT_BYTES = 68;
/** Sample-reference namespace inside the scene blob: resolved to a zip member at import. */
export const SCN_TEMP_NAMESPACE = '$Int0/%Tmp';
/** Where the unit installs a scene's bundled samples on import. */
export const SCN_INSTALL_NAMESPACE = '$Int0/%Smp/[Imported]';

const TYPE_INT = 0x01;
const TYPE_TRUE = 0x02;
const TYPE_FALSE = 0x03;
const TYPE_DOUBLE = 0x04;
const TYPE_STRING = 0x05;

// ── Bytes ────────────────────────────────────────────────────────────────

function ascii(str) {
  const s = String(str ?? '');
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code > 0xff) throw new Error(`non-latin1 character in SP-16 field: ${JSON.stringify(s)}`);
    out[i] = code;
  }
  return out;
}

function concat(chunks) {
  let total = 0;
  chunks.forEach((c) => { total += c.length; });
  const out = new Uint8Array(total);
  let at = 0;
  chunks.forEach((c) => { out.set(c, at); at += c.length; });
  return out;
}

function keyBytes(key) {
  return concat([ascii(key), new Uint8Array([0x00])]);
}

// ── Leaf field encoders ──────────────────────────────────────────────────
// Each returns the bytes from the field MARKER through the payload — exactly
// the range `parseTlv` reports as `[fieldStart, end)`, so an encoded field can
// be spliced straight over the one it replaces.

/** `01 05 01 <int32le>` */
export function encodeIntField(value) {
  const out = new Uint8Array(7);
  out[0] = 0x01; out[1] = 0x05; out[2] = TYPE_INT;
  new DataView(out.buffer).setInt32(3, Number.isFinite(value) ? Math.trunc(value) : 0, true);
  return out;
}

/** `01 09 04 <f64le>` */
export function encodeDoubleField(value) {
  const out = new Uint8Array(11);
  out[0] = 0x01; out[1] = 0x09; out[2] = TYPE_DOUBLE;
  new DataView(out.buffer).setFloat64(3, Number.isFinite(value) ? value : 0, true);
  return out;
}

/** `01 01 02|03` — the type byte itself carries the value. */
export function encodeBoolField(enabled) {
  return new Uint8Array([0x01, 0x01, enabled ? TYPE_TRUE : TYPE_FALSE]);
}

/** `01 <len> 05 <ascii> 00`, len = type byte + string + NUL. */
export function encodeStringField(value) {
  const body = ascii(String(value ?? ''));
  const len = body.length + 2; // type byte + trailing NUL
  if (len > 0xff) throw new Error(`string too long for an SP-16 field (${body.length} chars)`);
  return concat([new Uint8Array([0x01, len, TYPE_STRING]), body, new Uint8Array([0x00])]);
}

// ── Parser ───────────────────────────────────────────────────────────────

function readKey(bytes, p) {
  let end = p;
  while (end < bytes.length && bytes[end] !== 0x00) end += 1;
  if (end >= bytes.length) throw new Error(`unterminated key at ${p}`);
  let key = '';
  for (let i = p; i < end; i += 1) key += String.fromCharCode(bytes[i]);
  return { key, next: end + 1 };
}

function readListCount(bytes, p) {
  if (bytes[p] === 0x00) return { count: 0, next: p + 1 };
  if (bytes[p] === 0x01) return { count: bytes[p + 1], next: p + 2 };
  throw new Error(`unexpected list marker 0x${(bytes[p] ?? 0).toString(16)} at ${p}`);
}

function readLeaf(bytes, view, keyStart, key, fieldStart) {
  const marker = bytes[fieldStart];
  let type;
  let valueStart;
  let end;
  if (marker === 0x00) {
    // Null field — the key is present with no value at all (seen on the
    // factory projects' arrangement `topValue`/`bottomValue`). One byte total.
    return { key, kind: 'leaf', keyStart, fieldStart, valueStart: fieldStart + 1, end: fieldStart + 1, marker, type: null, value: null };
  }
  if (marker === 0x01) {
    type = bytes[fieldStart + 2];
    valueStart = fieldStart + 3;
    end = fieldStart + 2 + bytes[fieldStart + 1];
  } else if (marker === 0x02) {
    // Long field (a compressed pattern blob): the length covers the whole field.
    type = bytes[fieldStart + 3];
    valueStart = fieldStart + 4;
    end = fieldStart + view.getUint16(fieldStart + 1, true);
  } else {
    throw new Error(`unexpected field marker 0x${(marker ?? 0).toString(16)} for "${key}" at ${fieldStart}`);
  }
  if (end > bytes.length || end <= fieldStart) throw new Error(`field "${key}" overruns the buffer at ${fieldStart}`);

  let value = null;
  if (type === TYPE_INT) value = view.getInt32(valueStart, true);
  else if (type === TYPE_TRUE) value = true;
  else if (type === TYPE_FALSE) value = false;
  else if (type === TYPE_DOUBLE) value = view.getFloat64(valueStart, true);
  else if (type === TYPE_STRING) {
    let s = '';
    for (let i = valueStart; i < end - 1; i += 1) s += String.fromCharCode(bytes[i]);
    value = s;
  }
  return { key, kind: 'leaf', keyStart, fieldStart, valueStart, end, marker, type, value };
}

function parseContainer(bytes, view, p) {
  const { key, next } = readKey(bytes, p);
  const node = {
    key, kind: 'node', keyStart: p, end: 0, leaves: [], containers: [], leafByKey: new Map(), containerByKey: new Map(),
  };
  let pos = next;
  // Offsets of the two list-count bytes, so tooling that adds or removes a
  // block can fix the count without re-deriving where it sits. `null` when the
  // list is the empty `0x00` form (no count byte exists to patch).
  node.leafCountAt = bytes[pos] === 0x01 ? pos + 1 : null;
  const leafList = readListCount(bytes, pos);
  pos = leafList.next;
  for (let i = 0; i < leafList.count; i += 1) {
    const k = readKey(bytes, pos);
    const leaf = readLeaf(bytes, view, pos, k.key, k.next);
    node.leaves.push(leaf);
    if (!node.leafByKey.has(leaf.key)) node.leafByKey.set(leaf.key, leaf);
    pos = leaf.end;
  }
  node.contCountAt = bytes[pos] === 0x01 ? pos + 1 : null;
  const contList = readListCount(bytes, pos);
  pos = contList.next;
  for (let i = 0; i < contList.count; i += 1) {
    const child = parseContainer(bytes, view, pos);
    node.containers.push(child);
    if (!node.containerByKey.has(child.key)) node.containerByKey.set(child.key, child);
    pos = child.end;
  }
  node.end = pos;
  return node;
}

/**
 * Parses an inflated SP-16 TLV document (a scene blob, a `uid.spid`, a
 * `.wav.dat`) into a tree of containers and leaves, each carrying the byte
 * range it occupies. Throws if the bytes don't consume exactly — a partial
 * parse means the grammar assumption broke, and silently patching a document
 * we only half understand is how you brick a scene.
 */
export function parseTlv(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const root = parseContainer(buf, view, 0);
  if (root.end !== buf.length) {
    throw new Error(`TLV parse consumed ${root.end} of ${buf.length} bytes`);
  }
  return root;
}

/** Depth-first lookup of the first container whose key satisfies `match` (string or predicate). */
export function findContainer(node, match) {
  const test = typeof match === 'function' ? match : (k) => k === match;
  for (const child of node.containers) {
    if (test(child.key)) return child;
    const deep = findContainer(child, test);
    if (deep) return deep;
  }
  return null;
}

/** The leaf named `key` on `node` or on one of its containers, searched depth-first. */
export function findLeaf(node, key) {
  const own = node.leafByKey.get(key);
  if (own) return own;
  for (const child of node.containers) {
    const deep = findLeaf(child, key);
    if (deep) return deep;
  }
  return null;
}

/**
 * Splices `patches` (`{ start, end, bytes }`, offsets into `bytes` as it was
 * parsed) into a new buffer in one pass. Patches may be given in any order but
 * must not overlap — overlapping edits mean two writers disagree about a field.
 */
export function applyPatches(bytes, patches) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const list = [...patches].sort((a, b) => a.start - b.start);
  const chunks = [];
  let cursor = 0;
  for (const patch of list) {
    if (patch.start < cursor) throw new Error(`overlapping SP-16 patch at ${patch.start}`);
    if (patch.end > src.length || patch.start < 0) throw new Error(`SP-16 patch out of range at ${patch.start}`);
    chunks.push(src.subarray(cursor, patch.start), patch.bytes);
    cursor = patch.end;
  }
  chunks.push(src.subarray(cursor));
  return concat(chunks);
}

// ── Generated members ────────────────────────────────────────────────────

/**
 * The `ScenePackId` manifest: 16 `SourceId` records in PAD order, each holding
 * the sample's exact byte `size`, its `adjunctSize` (68 with a `.wav.dat`, else
 * 0) and the INSTALL `url` the unit copies it to. Empty pads carry 0/0/"".
 * Sizes must match the zip members exactly.
 */
export function buildUidSpid(records) {
  const rows = [];
  for (let i = 0; i < SCN_MAX_PADS; i += 1) {
    const rec = records[i] || null;
    rows.push(concat([
      keyBytes(`SourceId${i}`),
      new Uint8Array([0x01, 0x03]), // 3 leaves
      keyBytes('size'), encodeIntField(rec ? rec.size : 0),
      keyBytes('adjunctSize'), encodeIntField(rec ? rec.adjunctSize : 0),
      keyBytes('url'), encodeStringField(rec ? rec.url : ''),
      new Uint8Array([0x00]), // no containers
    ]));
  }
  return concat([
    keyBytes('ScenePackId'),
    new Uint8Array([0x00, 0x01, SCN_MAX_PADS]), // no leaves, 16 containers
    ...rows,
  ]);
}

/**
 * A `SampleAdjunctData` sidecar (always 68 bytes): the per-sample analysis the
 * unit would otherwise have to guess. `bar` = the loop's length in bars, `bpm`
 * = the tempo the grid actually used, `sampleNum` = exact frame count. Writing
 * real values here is what gives MT stretch a source tempo to work from.
 */
export function buildSampleAdjunct({ bar, bpm, sampleNum }) {
  const bytes = concat([
    keyBytes('SampleAdjunctData'),
    new Uint8Array([0x01, 0x03]),
    keyBytes('bar'), encodeDoubleField(bar),
    keyBytes('bpm'), encodeDoubleField(bpm),
    keyBytes('sampleNum'), encodeIntField(sampleNum),
    new Uint8Array([0x00]),
  ]);
  if (bytes.length !== SCN_ADJUNCT_BYTES) {
    throw new Error(`SampleAdjunctData is ${bytes.length} bytes, expected ${SCN_ADJUNCT_BYTES}`);
  }
  return bytes;
}

// ── vltrgzip wrapper ─────────────────────────────────────────────────────

function streamBytes(bytes, transform) {
  const source = new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close(); },
  });
  return new Response(source.pipeThrough(transform)).arrayBuffer().then((ab) => new Uint8Array(ab));
}

/** True when the platform has the compression primitives this writer needs. */
export function isScnWriterSupported() {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

function requireCompression() {
  if (!isScnWriterSupported()) {
    throw new Error('This browser cannot build .scn files (CompressionStream unavailable) — use Chrome, Edge or Opera.');
  }
}

/** zlib-deflates `bytes` (the container `vltrgzip` wraps, and what zip method 8 needs raw). */
export async function deflateZlib(bytes) {
  requireCompression();
  return streamBytes(bytes, new CompressionStream('deflate'));
}

async function deflateRaw(bytes) {
  requireCompression();
  return streamBytes(bytes, new CompressionStream('deflate-raw'));
}

/** Strips the `vltrgzip` header and inflates the zlib stream behind it. */
export async function unwrapVltrgzip(bytes) {
  requireCompression();
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let header = '';
  for (let i = 0; i < HEADER_BYTES && i < buf.length; i += 1) header += String.fromCharCode(buf[i]);
  if (header !== VLTRGZIP) throw new Error('not an SP-16 blob (missing "vltrgzip" header)');
  return streamBytes(buf.subarray(HEADER_BYTES), new DecompressionStream('deflate'));
}

/** `"vltrgzip"` + zlib stream — the envelope both inner blobs use. */
export async function wrapVltrgzip(bytes) {
  return concat([ascii(VLTRGZIP), await deflateZlib(bytes)]);
}

// ── ZIP ──────────────────────────────────────────────────────────────────
// Built here rather than reusing `wav-encode.js`'s `buildStoreZip` because a
// `.scn` mirrors the unit's own compression choices per member: the two blobs
// STORED (they are already zlib streams), the WAV/.dat members DEFLATED.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const DOS_TIME = 0;
const DOS_DATE = 0x21; // Jan 1 1980 — fixed; nothing downstream reads it.

/**
 * Builds the `.scn` archive from `entries: [{ name, data, deflated }]`, where
 * `deflated` (raw deflate bytes, from `deflateRaw`) selects method 8 and its
 * absence stores the member. `data` is always the UNCOMPRESSED bytes — crc and
 * uncompressed size come from it either way.
 */
export function buildScnZip(entries) {
  const prepped = entries.map((e) => {
    const name = ascii(e.name);
    const data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data || []);
    const payload = e.deflated instanceof Uint8Array ? e.deflated : data;
    return { name, data, payload, method: e.deflated ? 8 : 0, crc: crc32(data) };
  });

  const offsets = [];
  let localSize = 0;
  prepped.forEach((p) => {
    offsets.push(localSize);
    localSize += 30 + p.name.length + p.payload.length;
  });
  let centralSize = 0;
  prepped.forEach((p) => { centralSize += 46 + p.name.length; });

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let pos = 0;

  prepped.forEach((p) => {
    view.setUint32(pos, LOCAL_SIG, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2; // version needed
    view.setUint16(pos, 0, true); pos += 2; // flags
    view.setUint16(pos, p.method, true); pos += 2;
    view.setUint16(pos, DOS_TIME, true); pos += 2;
    view.setUint16(pos, DOS_DATE, true); pos += 2;
    view.setUint32(pos, p.crc, true); pos += 4;
    view.setUint32(pos, p.payload.length, true); pos += 4;
    view.setUint32(pos, p.data.length, true); pos += 4;
    view.setUint16(pos, p.name.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2; // extra length
    out.set(p.name, pos); pos += p.name.length;
    out.set(p.payload, pos); pos += p.payload.length;
  });

  prepped.forEach((p, i) => {
    view.setUint32(pos, CENTRAL_SIG, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2; // version made by
    view.setUint16(pos, 20, true); pos += 2; // version needed
    view.setUint16(pos, 0, true); pos += 2; // flags
    view.setUint16(pos, p.method, true); pos += 2;
    view.setUint16(pos, DOS_TIME, true); pos += 2;
    view.setUint16(pos, DOS_DATE, true); pos += 2;
    view.setUint32(pos, p.crc, true); pos += 4;
    view.setUint32(pos, p.payload.length, true); pos += 4;
    view.setUint32(pos, p.data.length, true); pos += 4;
    view.setUint16(pos, p.name.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2; // extra length
    view.setUint16(pos, 0, true); pos += 2; // comment length
    view.setUint16(pos, 0, true); pos += 2; // disk number
    view.setUint16(pos, 0, true); pos += 2; // internal attrs
    view.setUint32(pos, 0, true); pos += 4; // external attrs
    view.setUint32(pos, offsets[i], true); pos += 4;
    out.set(p.name, pos); pos += p.name.length;
  });

  view.setUint32(pos, EOCD_SIG, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, prepped.length, true); pos += 2;
  view.setUint16(pos, prepped.length, true); pos += 2;
  view.setUint32(pos, centralSize, true); pos += 4;
  view.setUint32(pos, localSize, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2;
  return out;
}

// ── Template ─────────────────────────────────────────────────────────────

/**
 * Fetches the shipped scene template (the raw `vltrgzip` scene blob extracted
 * from a real export — see `scripts/sp16-extract-scene-template.mjs`). Rejects
 * rather than returning a partial template: a half-read template would produce
 * a scene the unit rejects, which is worse than no export.
 */
export async function fetchScnSceneTemplate({ url = SCN_SCENE_TEMPLATE_URL, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`SP-16 scene template unavailable (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < HEADER_BYTES) throw new Error('SP-16 scene template is empty');
  return bytes;
}

// ── Scene patching ───────────────────────────────────────────────────────

/**
 * Locates the single `SceneData<n>` inside a parsed scene blob and validates
 * the shape the patcher depends on: exactly one scene, exactly 16 tracks.
 */
export function readSceneShape(root) {
  const scenes = root.containers.filter((c) => /^SceneData\d*$/.test(c.key));
  if (scenes.length !== 1) throw new Error(`expected 1 SceneData block, found ${scenes.length}`);
  const scene = scenes[0];
  const tracks = [];
  for (let i = 0; i < SCN_MAX_PADS; i += 1) {
    const track = scene.containerByKey.get(`TrackData${i}`);
    if (!track) throw new Error(`template is missing TrackData${i}`);
    tracks.push(track);
  }
  const patterns = scene.containers.filter((c) => /^PatternData\d+$/.test(c.key));
  return { scene, tracks, patternCount: patterns.length };
}

// Writes ONE field on ONE block. Deliberately a DIRECT-child lookup, never a
// forward scan: the `.prj` writer searched forward from a block's start with no
// end bound, so a key missing from track i would silently land in track i+1.
function patchLeaf(patches, node, key, bytes) {
  const leaf = node.leafByKey.get(key);
  if (!leaf) throw new Error(`template block "${node.key}" is missing the "${key}" field`);
  patches.push({ start: leaf.fieldStart, end: leaf.end, bytes });
}

/**
 * Fills a template scene blob with `pads` and returns the patched, still
 * INFLATED bytes plus the shape it found. Per assigned pad it writes the
 * sample reference, the loop-playback contract (`Sample` / `OneShot` /
 * `bLoop` / `MT` stretch / exact length) and the pad `colourIndex`, which is
 * what finally carries Loop Studio's pad colors to the hardware. Unassigned
 * pads are cleared to an empty `Sample` track. Volume, pan, choke, envelope,
 * LFO and FX are deliberately NOT written — on a blank template they are
 * already factory defaults, and writing a value we don't mean is how the
 * `.prj` export ended up with uneven pad levels.
 */
export function patchSceneBlob(sceneBytes, { sceneName, projectBpm, pads }) {
  const root = parseTlv(sceneBytes);
  const shape = readSceneShape(root);
  const byPad = new Map();
  pads.forEach((pad) => { byPad.set(Number(pad.padIndex), pad); });

  const patches = [];
  patchLeaf(patches, shape.scene, 'name', encodeStringField(sceneName));
  patchLeaf(patches, shape.scene, 'bpm', encodeDoubleField(projectBpm));

  shape.tracks.forEach((track, i) => {
    const pad = byPad.get(i) || null;
    const playback = track.containerByKey.get('PlaybackData');
    if (!playback) throw new Error(`template TrackData${i} is missing PlaybackData`);

    patchLeaf(patches, track, 'trackMode', encodeStringField('Sample'));
    patchLeaf(patches, track, 'triggerMode', encodeStringField('OneShot'));
    patchLeaf(patches, track, 'colourIndex', encodeIntField(pad && Number.isFinite(pad.colourIndex) ? pad.colourIndex : i));

    patchLeaf(patches, playback, 'audioSourceUrl', encodeStringField(pad ? `${SCN_TEMP_NAMESPACE}/${pad.filename}` : ''));
    patchLeaf(patches, playback, 'startSample', encodeIntField(0));
    patchLeaf(patches, playback, 'loopStartSample', encodeIntField(0));
    patchLeaf(patches, playback, 'lengthSample', encodeIntField(pad ? pad.frames : 0));
    patchLeaf(patches, playback, 'bLoop', encodeBoolField(!!pad));
    patchLeaf(patches, playback, 'bReverse', encodeBoolField(false));
    patchLeaf(patches, playback, 'pitchCent', encodeIntField(0));
    patchLeaf(patches, playback, 'stretchMode', encodeStringField(pad ? 'MT' : 'Off'));
  });

  return { bytes: applyPatches(sceneBytes, patches), shape };
}

// ── The export ───────────────────────────────────────────────────────────

/**
 * Builds a complete `.scn` scene package.
 *
 * `pads`: `[{ padIndex, filename, wavBytes, frames, bpm, colourIndex }]` — one
 * per ASSIGNED pad (0-15, at most 16). `filename` is the zip member basename
 * and must be unique per pad; `wavBytes` are finished, SP-16-ready WAV bytes
 * (the caller owns sample-rate conformance); `frames` is that WAV's exact frame
 * count; `bpm` is the tempo the loop was cut at.
 *
 * Resolves to `{ bytes, filename, members, patternCount }`. `patternCount` is
 * how many `PatternData` blocks the TEMPLATE carries — a blank scene has none,
 * and anything above zero means every export ships that scene's recorded
 * patterns, which the caller should surface.
 */
export async function buildScnBytes({
  templateBytes, sceneName, projectBpm, barsPerLoop, pads = [],
}) {
  requireCompression();
  const name = String(sceneName || '').trim();
  if (!name) throw new Error('a scene name is required');
  if (pads.length > SCN_MAX_PADS) throw new Error(`${pads.length} pads assigned, the SP-16 has ${SCN_MAX_PADS}`);
  if (!Number.isFinite(projectBpm) || projectBpm <= 0) throw new Error('a positive scene BPM is required');
  if (!Number.isFinite(barsPerLoop) || barsPerLoop <= 0) throw new Error('a positive bars-per-loop is required');

  const seen = new Set();
  pads.forEach((pad) => {
    const index = Number(pad.padIndex);
    if (!Number.isInteger(index) || index < 0 || index >= SCN_MAX_PADS) throw new Error(`pad index out of range: ${pad.padIndex}`);
    if (seen.has(index)) throw new Error(`pad ${index + 1} assigned twice`);
    seen.add(index);
    if (!pad.filename || !/\.wav$/i.test(pad.filename)) throw new Error(`pad ${index + 1} needs a .wav filename`);
    if (!(pad.wavBytes instanceof Uint8Array) || !pad.wavBytes.length) throw new Error(`pad ${index + 1} has no WAV bytes`);
    if (!Number.isFinite(pad.frames) || pad.frames <= 0) throw new Error(`pad ${index + 1} has no frame count`);
  });

  const templateScene = await unwrapVltrgzip(templateBytes);
  const { bytes: sceneBytes, shape } = patchSceneBlob(templateScene, {
    sceneName: name, projectBpm, pads,
  });

  const records = new Array(SCN_MAX_PADS).fill(null);
  pads.forEach((pad) => {
    records[Number(pad.padIndex)] = {
      size: pad.wavBytes.length,
      adjunctSize: SCN_ADJUNCT_BYTES,
      url: `${SCN_INSTALL_NAMESPACE}/${name}/${pad.filename}`,
    };
  });

  const [sceneBlob, uidBlob] = await Promise.all([
    wrapVltrgzip(sceneBytes),
    wrapVltrgzip(buildUidSpid(records)),
  ]);

  const ordered = [...pads].sort((a, b) => Number(a.padIndex) - Number(b.padIndex));
  const sampleMembers = await Promise.all(ordered.flatMap((pad) => {
    const adjunct = buildSampleAdjunct({
      bar: barsPerLoop, bpm: Number.isFinite(pad.bpm) ? pad.bpm : 0, sampleNum: pad.frames,
    });
    return [
      deflateRaw(pad.wavBytes).then((deflated) => ({ name: pad.filename, data: pad.wavBytes, deflated })),
      deflateRaw(adjunct).then((deflated) => ({ name: `${pad.filename}.dat`, data: adjunct, deflated })),
    ];
  }));

  const members = [
    { name: `# ${name}.prj`, data: sceneBlob },
    { name: 'uid.spid', data: uidBlob },
    ...sampleMembers,
  ];

  return {
    bytes: buildScnZip(members),
    filename: `${name}.scn`,
    members: members.map((m) => m.name),
    patternCount: shape.patternCount,
  };
}
