'use strict';

// Per-asset "archive record" JSON — schema 1.1 (docs/archive/PERMANENT_ARCHIVE_CONTRACT.md
// §C). Pure, Firebase-free builder: takes the archive_review doc + the
// archive_uploads "original" doc for the same asset and produces the exact
// JSON that gets uploaded to Arweave as a UPLOAD_JSON archive-record
// command's payload (api/_lib/archive-permanent-archive.cjs).
//
// Rule: `value` on a decision is the human-corrected value when one exists,
// else Jev's. NEVER include NAS paths — only a location count
// (provenance.sourceCount) and a basename (asset.archiveName).

function basename(rawPath) {
  if (!rawPath) return null;
  const parts = String(rawPath).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/** The value a decision should carry: the human confirmation when one exists, else Jev's own pick. */
function resolveDecisionValue(decision, humanConfirmations) {
  const key = decision.id || decision.question;
  const confirmations = humanConfirmations || {};
  if (Object.prototype.hasOwnProperty.call(confirmations, key)) return confirmations[key];
  return decision.selectedValue ?? decision.selected ?? null;
}

/** The most recent humanCorrections[] entry's `at` for a given decisionId, or null. */
function latestCorrectionAt(humanCorrections, decisionId) {
  if (!Array.isArray(humanCorrections)) return null;
  const matches = humanCorrections.filter((c) => (c && (c.decisionId || c.id)) === decisionId);
  if (!matches.length) return null;
  return matches[matches.length - 1].at || null;
}

function buildDecisionRecords({ decisions = [], humanConfirmations = {}, humanCorrections = [] } = {}) {
  return (decisions || []).map((d) => {
    const key = d.id || d.question;
    const hasHuman = Object.prototype.hasOwnProperty.call(humanConfirmations || {}, key);
    return {
      id: key,
      question: d.question || null,
      value: resolveDecisionValue(d, humanConfirmations),
      jev: {
        value: d.selectedValue ?? d.selected ?? null,
        confidence: Number(d.confidence || 0),
        reviewBand: d.reviewBand || null,
        choices: d.choices || [],
      },
      human: hasHuman ? { value: humanConfirmations[key], at: latestCorrectionAt(humanCorrections, key) } : null,
    };
  });
}

function buildEvidence(observations = []) {
  return (observations || []).map((o) => ({
    provider: (o && o.provider) || 'twelvelabs',
    kind: (o && o.kind) || 'video_understanding',
    summary: (o && (o.summary || o.text)) || '',
    status: (o && o.status) || 'READY',
    at: (o && (o.at || o.createdAt)) || null,
  }));
}

/**
 * @param {object} params
 * @param {object} params.review - archive_review/{id} doc data (decisions, humanConfirmations,
 *   humanCorrections, observations, sha256, sizeBytes, mediaType, archiveName, sourcePaths,
 *   collectionId, collectionTitle).
 * @param {object} params.upload - the permanent original's archive_uploads doc / UPLOAD_ASSET_ARWEAVE
 *   COMPLETE result (transactionId, arweaveUrl, sizeBytes, sha256, contentType, archiveName, collectionId).
 * @param {number} [params.version]
 * @param {string|null} [params.previousTransactionId] - the prior archive-record JSON's own Arweave tx.
 */
function buildArchiveRecord({ review, upload, version = 1, previousTransactionId = null, now } = {}) {
  if (!review) throw new Error('review is required');
  if (!upload || !upload.transactionId) throw new Error('upload.transactionId is required');

  const generatedAt = now || new Date().toISOString();
  const archiveName = basename(upload.archiveName || review.archiveName)
    || basename((review.sourcePaths || [])[0])
    || review.assetId
    || review.id
    || 'archive-asset';
  const sourceCount = (Array.isArray(review.sourcePaths) && review.sourcePaths.length) || review.sourceCount || 1;
  const collectionId = upload.collectionId || review.collectionId || null;

  return {
    schemaVersion: '1.1',
    recordType: 'archive-record',
    version: Number(version) || 1,
    previousRecordTransactionId: previousTransactionId || null,
    asset: {
      id: String(upload.contentAssetId || review.assetId || review.id),
      sha256: upload.sha256 || review.sha256 || null,
      sizeBytes: Number(upload.sizeBytes ?? review.sizeBytes ?? 0),
      mediaType: review.mediaType || null,
      contentType: upload.contentType || 'application/octet-stream',
      archiveName,
      originalTransactionId: upload.transactionId,
      originalUrl: upload.arweaveUrl || `https://arweave.net/${upload.transactionId}`,
    },
    collection: {
      id: collectionId,
      title: review.collectionTitle || collectionId,
    },
    provenance: {
      sourceCount,
      sourceSystem: 'HITLOOP Archive',
      originalsReadOnly: true,
      contentAddressing: 'sha256',
    },
    evidence: buildEvidence(review.observations),
    decisions: buildDecisionRecords({
      decisions: review.decisions || [],
      humanConfirmations: review.humanConfirmations || {},
      humanCorrections: review.humanCorrections || [],
    }),
    corrections: (review.humanCorrections || []).map((c) => ({
      decisionId: c.decisionId,
      previousValue: c.previousValue ?? null,
      value: c.value,
      actor: c.actor || null,
      at: c.at || null,
    })),
    generatedAt,
  };
}

module.exports = {
  basename,
  resolveDecisionValue,
  buildDecisionRecords,
  buildEvidence,
  buildArchiveRecord,
};
