'use strict';

// _store.js — Firestore read/write helpers for the intelligence namespace
// Paths: clients/{clientId}/intelligence/master
//        clients/{clientId}/intelligence/sources/{sourceId}
//        clients/{clientId}/intelligence/events/{eventId}
//
// Note: setSourceSetting and setPipelineInjection use a read-modify-write pattern
// (non-transactional). Concurrent admin writes are unlikely in Phase 1; if
// contention becomes an issue, promote to runTransaction in Phase 2.

const path = require('path');
const fb   = require(path.resolve(__dirname, '../../api/_lib/firebase-admin.cjs'));
const { validateSourceRecord } = require('./_contract');
const { generateDigest }       = require('./_digest');
const { computeLedger }        = require('./_ledger');

const SCHEMA_VERSION      = '2.0.0';
const EVENTS_FETCH_LIMIT  = 500; // load ceiling for ledger rebuild

// ── Path helpers ──────────────────────────────────────────────────────────────

function intelligenceCol(clientId) {
  return fb.adminDb.collection('clients').doc(clientId).collection('intelligence');
}

function masterRef(clientId) {
  return intelligenceCol(clientId).doc('master');
}

function sourcesCol(clientId) {
  return masterRef(clientId).collection('sources');
}

function eventsCol(clientId) {
  return masterRef(clientId).collection('events');
}

// ── Read helpers ──────────────────────────────────────────────────────────────

async function getMaster(clientId) {
  const snap = await masterRef(clientId).get();
  return snap.exists ? snap.data() : null;
}

async function getSource(clientId, sourceId) {
  const snap = await sourcesCol(clientId).doc(sourceId).get();
  return snap.exists ? snap.data() : null;
}

async function listSources(clientId) {
  const snap = await sourcesCol(clientId).get();
  return snap.docs.map((d) => d.data());
}

async function listRecentEvents(clientId, limit = 50) {
  const snap = await eventsCol(clientId).orderBy('at', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data());
}

// ── Write helpers ─────────────────────────────────────────────────────────────

/**
 * Validate and upsert a source record into sources/{sourceId}.
 * Throws SourceRecordValidationError if the record is invalid.
 */
async function upsertSource(clientId, sourceRecord) {
  validateSourceRecord(sourceRecord);
  await sourcesCol(clientId).doc(sourceRecord.id).set(sourceRecord, { merge: true });
  return sourceRecord;
}

/**
 * Patch a source's settings in master.sourceSettings.
 * patch: { enabled?: boolean, refreshPolicy?: string }
 * Read-modify-write. Creates the master doc if absent.
 */
async function setSourceSetting(clientId, sourceId, patch) {
  const ref  = masterRef(clientId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};

  const prevSettings = data.sourceSettings || {};
  const prevSource   = prevSettings[sourceId] || {};

  await ref.set({
    sourceSettings: {
      ...prevSettings,
      [sourceId]: {
        ...prevSource,
        ...(patch.enabled        !== undefined ? { enabled:       patch.enabled }        : {}),
        ...(patch.refreshPolicy  !== undefined ? { refreshPolicy: patch.refreshPolicy }  : {}),
      },
    },
    meta: {
      ...(data.meta || {}),
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
  }, { merge: true });
}

/**
 * Toggle pipeline injection flag in master.meta.
 * Read-modify-write. Creates the master doc if absent.
 */
async function setPipelineInjection(clientId, enabled) {
  const ref  = masterRef(clientId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};

  await ref.set({
    meta: {
      ...(data.meta || {}),
      pipelineInjection: Boolean(enabled),
      updatedAt: fb.FieldValue.serverTimestamp(),
    },
  }, { merge: true });
}

/**
 * Append an event to events/{auto-id}.
 * event: { at?, sourceId, provider, kind, usd, quotaUnits, durationMs, note, runId }
 */
async function appendEvent(clientId, event) {
  await eventsCol(clientId).add({
    ...event,
    at: event.at || new Date().toISOString(),
  });
}

/**
 * Read all source docs + recent events, recompute digest + ledger, and write to master.
 * Safe to call after any source upsert.
 */
async function rebuildMasterDigestAndLedger(clientId) {
  const [sourceDocs, eventSnap, masterSnap] = await Promise.all([
    listSources(clientId),
    eventsCol(clientId).orderBy('at', 'desc').limit(EVENTS_FETCH_LIMIT).get(),
    masterRef(clientId).get(),
  ]);

  const events     = eventSnap.docs.map((d) => d.data());
  const digest     = generateDigest(sourceDocs);
  const { totals, byProvider } = computeLedger(events);
  const existing   = masterSnap.exists ? masterSnap.data() : {};

  const master = {
    meta: {
      ...(existing.meta || {}),
      schemaVersion:    SCHEMA_VERSION,
      clientId,
      updatedAt:        fb.FieldValue.serverTimestamp(),
      briefingTokenEst: digest.totalTokenEst,
      pipelineInjection: existing.meta?.pipelineInjection ?? false,
    },
    sourceSettings: existing.sourceSettings || {},
    digest,
    ledger: { totals, byProvider },
  };

  await masterRef(clientId).set(master, { merge: true });
  return master;
}

module.exports = {
  getMaster,
  getSource,
  listSources,
  listRecentEvents,
  upsertSource,
  setSourceSetting,
  setPipelineInjection,
  appendEvent,
  rebuildMasterDigestAndLedger,
};
