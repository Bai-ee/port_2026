#!/usr/bin/env node
// Extracts the scene blob out of a real TORAIZ SP-16 `.scn` export and writes
// it to `public/sp16/scene-template.bin` — the template Loop Studio's `.scn`
// writer fills at export time.
//
// The `.scn` is a plain ZIP; its scene member is named `# <scene>.prj` and its
// bytes are `"vltrgzip"` + a zlib stream. We ship ONLY that member (a few KB)
// rather than the whole `.scn` (megabytes, because a scene bundles its
// samples) — the writer never reads the template's samples, patterns or
// manifest, it only patches the scene blob's TLV fields.
//
//   node scripts/sp16-extract-scene-template.mjs <scene.scn> [out.bin]
//   node scripts/sp16-extract-scene-template.mjs <scene.scn> --blank
//
// ── `--blank`: drop the source scene's recorded patterns ─────────────────
// Whatever scene you extract becomes what EVERY export carries, patterns
// included — a template with recorded patterns means every user's scene plays
// a sequence they never wrote. The clean answer is to extract a scene that was
// blank on the unit (fresh project → empty scene → save → Scene Manager →
// export); then this flag isn't needed.
//
// `--blank` is for when you only have a scene that has patterns. It removes
// the `PatternData` containers and decrements the scene's container count.
// That shape is not a guess: Pioneer's own factory projects
// (`Demo 01 House Techno EDM.prj`, scenes 3-15) hold blank scenes with
// **19 containers and zero `PatternData`** — 16 `TrackData` + `SendFx` +
// `MasterFx` + `RoutingData` — which is precisely what this produces. Those
// factory projects can't serve as the template themselves: they're the 2016
// format (18 `ProjectData` leaves, 8-leaf tracks, no `instrument` /
// `padSequenceStart` / `minorVersionNo`), while a scene exported by the
// current firmware carries all of them.
//
// Every removal is verified before anything is written: the result must
// re-parse whole, hold one scene, 16 tracks and no patterns, and be
// byte-identical to the source everywhere outside the removed range.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseTlv, readSceneShape } from '../app/dashboard/studio/loop/sp16-scn-writer.js';

const args = process.argv.slice(2);
const blank = args.includes('--blank');
const rest = args.filter((a) => !a.startsWith('--'));
const [input, outArg] = rest;
if (!input) {
  console.error('usage: node scripts/sp16-extract-scene-template.mjs <scene.scn> [out.bin] [--blank]');
  process.exit(1);
}
const out = outArg || path.join(process.cwd(), 'public', 'sp16', 'scene-template.bin');
const zip = fs.readFileSync(input);

const EOCD_SIG = 0x06054b50;
let eocd = -1;
for (let i = zip.length - 22; i >= 0; i -= 1) {
  if (zip.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
}
if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');

const count = zip.readUInt16LE(eocd + 10);
let p = zip.readUInt32LE(eocd + 16);
let scene = null;
for (let i = 0; i < count; i += 1) {
  const method = zip.readUInt16LE(p + 10);
  const compressedSize = zip.readUInt32LE(p + 20);
  const nameLen = zip.readUInt16LE(p + 28);
  const extraLen = zip.readUInt16LE(p + 30);
  const commentLen = zip.readUInt16LE(p + 32);
  const localOffset = zip.readUInt32LE(p + 42);
  const name = zip.subarray(p + 46, p + 46 + nameLen).toString('latin1');
  if (name.startsWith('# ') && name.endsWith('.prj')) {
    const ln = zip.readUInt16LE(localOffset + 26);
    const le = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + ln + le;
    const raw = zip.subarray(start, start + compressedSize);
    scene = { name, bytes: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) };
    break;
  }
  p += 46 + nameLen + extraLen + commentLen;
}
if (!scene) throw new Error('no "# <name>.prj" scene member found in the archive');
if (scene.bytes.subarray(0, 8).toString('ascii') !== 'vltrgzip') {
  throw new Error('scene member is not a vltrgzip blob');
}

let inflated = zlib.inflateSync(scene.bytes.subarray(8));
let blob = scene.bytes;
const before = readSceneShape(parseTlv(inflated));

if (blank && before.patternCount > 0) {
  const root = parseTlv(inflated);
  const sceneNode = readSceneShape(root).scene;
  const pats = sceneNode.containers.filter((c) => /^PatternData\d+$/.test(c.key));

  // Only a single contiguous run can be cut with one splice. The unit writes
  // them consecutively between TrackData15 and SendFx; refuse rather than
  // guess if a future firmware interleaves them.
  const first = sceneNode.containers.indexOf(pats[0]);
  pats.forEach((pat, i) => {
    if (sceneNode.containers[first + i] !== pat) throw new Error('PatternData blocks are not contiguous — refusing to cut');
  });
  if (sceneNode.contCountAt === null) throw new Error('scene has no container-count byte to adjust');

  const cutStart = pats[0].keyStart;
  const cutEnd = pats[pats.length - 1].end;
  const trimmed = Buffer.concat([inflated.subarray(0, cutStart), inflated.subarray(cutEnd)]);
  const newCount = sceneNode.containers.length - pats.length;
  if (!Number.isInteger(newCount) || newCount < 0 || newCount > 0xff) {
    throw new Error(`refusing to write a container count of ${newCount}`);
  }
  trimmed[sceneNode.contCountAt] = newCount;

  // Verify before writing: the result must be a whole, well-formed scene AND
  // byte-identical to the source outside the cut (plus that one count byte).
  const after = readSceneShape(parseTlv(trimmed));
  if (after.patternCount !== 0) throw new Error('patterns survived the cut');
  if (after.tracks.length !== 16) throw new Error(`expected 16 tracks after the cut, found ${after.tracks.length}`);
  if (after.scene.containers.length !== newCount) {
    throw new Error(`container count is ${after.scene.containers.length}, expected ${newCount}`);
  }
  const head = Buffer.from(inflated.subarray(0, cutStart));
  head[sceneNode.contCountAt] = trimmed[sceneNode.contCountAt];
  if (!head.equals(trimmed.subarray(0, cutStart))) throw new Error('bytes before the cut changed');
  if (!inflated.subarray(cutEnd).equals(trimmed.subarray(cutStart))) throw new Error('bytes after the cut changed');

  console.log(`blanked   removed ${pats.length} PatternData block(s), ${cutEnd - cutStart} bytes`);
  console.log(`          scene containers ${before.scene.containers.length} -> ${after.scene.containers.length} (Pioneer's own blank scene: 19)`);
  inflated = trimmed;
  blob = Buffer.concat([Buffer.from('vltrgzip', 'ascii'), zlib.deflateSync(trimmed, { level: 9 })]);
}

const final = readSceneShape(parseTlv(inflated));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, blob);
console.log(`member    ${scene.name}`);
console.log(`scene     ${final.scene.key} · ${final.tracks.length} tracks · ${final.scene.containers.length} containers`);
console.log(`wrote     ${out} (${blob.length} bytes, ${inflated.length} inflated)`);
console.log(`patterns  ${final.patternCount} PatternData block(s) in this template`);
