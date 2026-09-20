import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { NextResponse } from 'next/server';

const TEMPLATE_NAME = 'Demo 01 House Techno EDM.prj';
const HEADER = Buffer.from('vltrgzip', 'ascii');
const MAX_PADS = 16;

function cleanName(value, fallback = 'Hitloop') {
  const s = String(value || '').replace(/\.[^.]+$/, '').trim();
  return (s || fallback).replace(/[^\w -]+/g, '').replace(/\s+/g, ' ').slice(0, 48) || fallback;
}

function fieldBounds(buf, key, from = 0) {
  const keyBuf = Buffer.from(key, 'ascii');
  const keyStart = buf.indexOf(keyBuf, from);
  if (keyStart < 0) throw new Error(`field not found: ${key}`);
  const metaStart = keyStart + keyBuf.length + 1;
  if (buf[metaStart] !== 0x01) throw new Error(`unsupported field marker: ${key}`);
  const len = buf[metaStart + 1];
  return {
    keyStart,
    metaStart,
    valueStart: metaStart + 2,
    end: metaStart + 2 + len,
    len,
  };
}

function replaceBytes(buf, start, end, replacement) {
  return Buffer.concat([buf.subarray(0, start), replacement, buf.subarray(end)]);
}

function setIntField(buf, sectionStart, key, value) {
  const b = fieldBounds(buf, key, sectionStart);
  const payload = Buffer.alloc(7);
  payload[0] = 0x01;
  payload[1] = 0x05;
  payload[2] = 0x01;
  payload.writeInt32LE(Number.isFinite(value) ? Math.trunc(value) : 0, 3);
  return replaceBytes(buf, b.metaStart, b.end, payload);
}

function setDoubleField(buf, sectionStart, key, value) {
  const b = fieldBounds(buf, key, sectionStart);
  const payload = Buffer.alloc(11);
  payload[0] = 0x01;
  payload[1] = 0x09;
  payload[2] = 0x04;
  payload.writeDoubleLE(Number.isFinite(value) ? value : 120, 3);
  return replaceBytes(buf, b.metaStart, b.end, payload);
}

function setStringField(buf, sectionStart, key, value) {
  const encoded = Buffer.from(`${String(value || '')}\0`, 'ascii');
  if (encoded.length + 1 > 255) throw new Error(`string too long for ${key}`);
  const b = fieldBounds(buf, key, sectionStart);
  return replaceBytes(buf, b.metaStart, b.end, Buffer.concat([
    Buffer.from([0x01, encoded.length + 1, 0x05]),
    encoded,
  ]));
}

function setBoolField(buf, sectionStart, key, enabled) {
  const b = fieldBounds(buf, key, sectionStart);
  return replaceBytes(buf, b.metaStart, b.end, Buffer.from([0x01, 0x01, enabled ? 0x02 : 0x03]));
}

function trackStart(buf, index) {
  const needle = Buffer.from(`TrackData${index}`, 'ascii');
  const pos = buf.indexOf(needle);
  if (pos < 0) throw new Error(`TrackData${index} not found`);
  return pos;
}

function buildProject(payload) {
  const templatePath = path.join(process.cwd(), TEMPLATE_NAME);
  const source = fs.readFileSync(templatePath);
  if (!source.subarray(0, HEADER.length).equals(HEADER)) {
    throw new Error('SP-16 template is not a vltrgzip project');
  }

  let body = zlib.inflateSync(source.subarray(HEADER.length));
  const projectName = cleanName(payload.projectName, 'Hitloop');
  const bpm = Number(payload.bpm);
  body = setDoubleField(body, 0, 'projectBpm', Number.isFinite(bpm) ? bpm : 120);
  body = setStringField(body, 0, 'projectFilePath', `/mnt/emmc/TORAIZ/SP-16 Projects/${projectName}.prj`);

  const assignments = Array.isArray(payload.assignments) ? payload.assignments.slice(0, MAX_PADS) : [];
  for (let i = 0; i < MAX_PADS; i += 1) {
    const t0 = trackStart(body, i);
    const t1 = i + 1 < MAX_PADS ? trackStart(body, i + 1) : body.length;
    const pad = assignments.find((a) => Number(a?.padIndex) === i);
    const sourcePath = pad?.samplePath ? String(pad.samplePath) : '';
    body = setStringField(body, t0, 'trackMode', pad ? 'Sample' : 'Sample');
    body = setStringField(body, t0, 'triggerMode', 'OneShot');
    body = setIntField(body, t0, 'startSample', 0);
    body = setIntField(body, t0, 'loopStartSample', 0);
    body = setIntField(body, t0, 'lengthSample', pad ? Number(pad.lengthSamples) || 0 : 0);
    body = setBoolField(body, t0, 'bLoop', Boolean(pad));
    body = setIntField(body, t0, 'pitchCent', 0);
    body = setStringField(body, t0, 'stretchMode', pad ? 'MT' : 'Off');
    body = setStringField(body, t0, 'audioSourceUrl', sourcePath);
    if (t1 <= t0) throw new Error(`TrackData${i} bounds invalid`);
  }

  return Buffer.concat([HEADER, zlib.deflateSync(body, { level: 9 })]);
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const project = buildProject(payload || {});
    return new NextResponse(project, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
