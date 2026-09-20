'use strict';

// Pure, firebase-free rules for the Lane 2 (phone upload) intake lifecycle —
// see docs/archive/INTAKE_CONTRACT.md. Kept separate from
// archive-intake.cjs / archive-worker-intake.cjs so the transition table and
// filename/content-type/size guards are unit-testable with zero mocking.
//
// State machine:
//   PENDING_UPLOAD --(browser PATCH, object must exist)--> UPLOADED
//   UPLOADED       --(worker PATCH)--> CLAIMED
//   CLAIMED        --(worker PATCH)--> HASHED
//   HASHED         --(worker PATCH)--> REVIEWED
//   REVIEWED       --(worker PATCH)--> ARCHIVED
//   ARCHIVED       --(worker DELETE only, deletes the Firebase object)--> PURGED
//   any state      --(worker PATCH, error required)--> FAILED
//
// ARCHIVED -> PURGED is deliberately NOT a PATCH target: purging has the
// required side effect of deleting the storage object, so it only happens
// through the DELETE route (archive-worker-intake.cjs purgeArchived()).

const WORKER_PATCH_TRANSITIONS = Object.freeze({
  UPLOADED: ['CLAIMED'],
  CLAIMED: ['HASHED'],
  HASHED: ['REVIEWED'],
  REVIEWED: ['ARCHIVED'],
  ARCHIVED: [],
});

const FAILED_STATE = 'FAILED';
const PENDING_UPLOAD_STATE = 'PENDING_UPLOAD';
const UPLOADED_STATE = 'UPLOADED';
const ARCHIVED_STATE = 'ARCHIVED';
const PURGED_STATE = 'PURGED';

const ALL_STATES = Object.freeze([
  PENDING_UPLOAD_STATE, UPLOADED_STATE, 'CLAIMED', 'HASHED', 'REVIEWED', ARCHIVED_STATE, PURGED_STATE, FAILED_STATE,
]);

/** Is `fromState -> toState` a transition the worker PATCH route may apply? */
function isValidWorkerTransition(fromState, toState) {
  if (!ALL_STATES.includes(toState)) return false;
  if (toState === FAILED_STATE) return true; // any known state -> FAILED
  const allowed = WORKER_PATCH_TRANSITIONS[fromState];
  return Array.isArray(allowed) && allowed.includes(toState);
}

/** Only the DELETE route may retire an ARCHIVED intake doc. */
function isValidPurgeTransition(fromState) {
  return fromState === ARCHIVED_STATE;
}

/** The browser PATCH may only ever confirm an upload; idempotent if already UPLOADED. */
function isValidBrowserUploadConfirm(fromState) {
  return fromState === PENDING_UPLOAD_STATE || fromState === UPLOADED_STATE;
}

const MAX_INTAKE_IMAGE_BYTES = 50 * 1024 * 1024; // mirrors Media Library's sanitizeUploadFile image cap
const MAX_INTAKE_VIDEO_BYTES = 500 * 1024 * 1024; // mirrors Media Library's sanitizeUploadFile video cap

function isAllowedIntakeContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  return ct.startsWith('image/') || ct.startsWith('video/');
}

function maxBytesForContentType(contentType) {
  return String(contentType || '').toLowerCase().startsWith('video/') ? MAX_INTAKE_VIDEO_BYTES : MAX_INTAKE_IMAGE_BYTES;
}

/**
 * originalName -> a safe storage-path leaf. Keeps the extension, lowercases
 * and dash-normalizes the base name. Falls back to "upload" for a name that
 * sanitizes to nothing (e.g. an emoji-only filename).
 */
function sanitizeIntakeFileName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) throw Object.assign(new Error('fileName is required.'), { status: 400 });
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const base = stem
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'upload';
  return ext ? `${base}.${ext}` : base;
}

module.exports = {
  WORKER_PATCH_TRANSITIONS,
  ALL_STATES,
  FAILED_STATE,
  PENDING_UPLOAD_STATE,
  UPLOADED_STATE,
  ARCHIVED_STATE,
  PURGED_STATE,
  isValidWorkerTransition,
  isValidPurgeTransition,
  isValidBrowserUploadConfirm,
  isAllowedIntakeContentType,
  maxBytesForContentType,
  sanitizeIntakeFileName,
  MAX_INTAKE_IMAGE_BYTES,
  MAX_INTAKE_VIDEO_BYTES,
};
