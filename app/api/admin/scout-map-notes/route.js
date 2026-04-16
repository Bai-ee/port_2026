import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import path from 'node:path';
import { promises as fs } from 'node:fs';

const require = createRequire(import.meta.url);
const { verifyAdminRequest, verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

// Scout Data Map — notes endpoint.
//
// Admin-gated review annotations for the scout data map + card contract.
// Notes persist to a git-tracked JSON file so the assistant can read every
// annotation in one file read during review cycles.
//
// File: docs/scout-data-map.notes.json
// Shape: { version, updatedAt, notes: [{ id, anchor, status, text, author,
//          createdAt, updatedAt, history: [{ at, status, by }] }] }
//
// Anchors are freeform strings addressable in the Data Map UI, e.g.:
//   card:brand-identity-design.missing-state.no-favicon
//   source:site.meta
//   scribe.action-class:service-offer
//
// Methods:
//   GET    → list notes (optional ?status=open|addressed|dismissed)
//   POST   → create { anchor, text }
//   PATCH  → update  { id, status?, text? }
//   DELETE → remove ?id=…
//
// Writes are dev-only (rejected in production) to keep the file strictly
// an internal review tool.

const NOTES_PATH = path.resolve(process.cwd(), 'docs/scout-data-map.notes.json');
const MAX_TEXT_CHARS = 2000;
const VALID_STATUSES = new Set(['open', 'addressed', 'dismissed']);

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function isWriteAllowed() {
  return process.env.NODE_ENV !== 'production';
}

async function readNotes() {
  try {
    const raw = await fs.readFile(NOTES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.notes)) {
      return { version: 1, updatedAt: null, notes: [] };
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, updatedAt: null, notes: [] };
    throw err;
  }
}

async function writeNotes(state) {
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(NOTES_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function genId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `note-${t}-${r}`;
}

async function adminOrDiagnose(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return { ok: false, status: 401, body: { error: err instanceof Error ? err.message : 'Unauthorized.' } };
  }
  const email = decoded.email || null;
  if (!email) {
    return { ok: false, status: 403, body: { error: 'No email claim on token.', diagnostic: { uid: decoded.uid, provider: decoded.firebase?.sign_in_provider } } };
  }
  const snap = await fb.adminDb.collection('admins').doc(email).get();
  if (!snap.exists) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Forbidden: admin access required.',
        diagnostic: {
          tokenEmail: email,
          emailVerified: decoded.email_verified ?? null,
          adminLookupDocId: email,
          adminDocExists: false,
          hint: `Create Firestore doc admins/${email} with { active: true } to grant access.`,
        },
      },
    };
  }
  return { ok: true, decoded };
}

export async function GET(request) {
  const auth = await adminOrDiagnose(request);
  if (!auth.ok) return json(auth.body, auth.status);

  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const anchorFilter = url.searchParams.get('anchor');

  const state = await readNotes();
  let notes = state.notes;
  if (statusFilter && VALID_STATUSES.has(statusFilter)) {
    notes = notes.filter((n) => n.status === statusFilter);
  }
  if (anchorFilter) {
    notes = notes.filter((n) => n.anchor === anchorFilter);
  }

  return json({ version: state.version, updatedAt: state.updatedAt, notes, writeAllowed: isWriteAllowed() });
}

export async function POST(request) {
  if (!isWriteAllowed()) return json({ error: 'Write disabled in production.' }, 403);

  let decoded;
  try {
    decoded = await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const anchor = typeof body.anchor === 'string' ? body.anchor.trim() : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';

  if (!anchor) return json({ error: 'anchor required.' }, 400);
  if (!text)   return json({ error: 'text required.' }, 400);
  if (text.length > MAX_TEXT_CHARS) return json({ error: `text exceeds ${MAX_TEXT_CHARS} chars.` }, 400);

  const now = new Date().toISOString();
  const note = {
    id:        genId(),
    anchor,
    status:    'open',
    text,
    author:    decoded.email || decoded.uid || 'unknown',
    createdAt: now,
    updatedAt: now,
    history:   [{ at: now, status: 'open', by: decoded.email || decoded.uid || 'unknown' }],
  };

  const state = await readNotes();
  state.notes.push(note);
  await writeNotes(state);

  return json({ note }, 201);
}

export async function PATCH(request) {
  if (!isWriteAllowed()) return json({ error: 'Write disabled in production.' }, 403);

  let decoded;
  try {
    decoded = await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return json({ error: 'id required.' }, 400);

  const newStatus = body.status;
  const newText   = body.text;

  if (newStatus != null && !VALID_STATUSES.has(newStatus)) {
    return json({ error: `status must be one of ${[...VALID_STATUSES].join('|')}.` }, 400);
  }
  if (newText != null && typeof newText !== 'string') {
    return json({ error: 'text must be a string.' }, 400);
  }
  if (typeof newText === 'string' && newText.length > MAX_TEXT_CHARS) {
    return json({ error: `text exceeds ${MAX_TEXT_CHARS} chars.` }, 400);
  }

  const state = await readNotes();
  const idx = state.notes.findIndex((n) => n.id === id);
  if (idx === -1) return json({ error: 'note not found.' }, 404);

  const note = state.notes[idx];
  const now = new Date().toISOString();
  const by = decoded.email || decoded.uid || 'unknown';

  if (newStatus && newStatus !== note.status) {
    note.status = newStatus;
    note.history = Array.isArray(note.history) ? note.history : [];
    note.history.push({ at: now, status: newStatus, by });
  }
  if (typeof newText === 'string' && newText.trim() && newText.trim() !== note.text) {
    note.text = newText.trim();
  }
  note.updatedAt = now;

  await writeNotes(state);
  return json({ note });
}

export async function DELETE(request) {
  if (!isWriteAllowed()) return json({ error: 'Write disabled in production.' }, 403);

  try {
    await verifyAdminRequest(makeReqShim(request));
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unauthorized.' }, 401);
  }

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id query param required.' }, 400);

  const state = await readNotes();
  const before = state.notes.length;
  state.notes = state.notes.filter((n) => n.id !== id);
  if (state.notes.length === before) return json({ error: 'note not found.' }, 404);

  await writeNotes(state);
  return json({ ok: true, removed: id });
}
