'use strict';

const { randomUUID } = require('crypto');
const fb = require('./firebase-admin.cjs');

function buildDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function saveBufferArtifact({
  bucketName = null,
  storagePath,
  buffer,
  contentType,
  metadata = {},
}) {
  const bucket = bucketName
    ? fb.adminStorage.bucket(bucketName)
    : fb.adminStorage.bucket();
  const downloadToken = randomUUID();

  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    contentType,
    metadata: {
      cacheControl: 'private, max-age=0, no-transform',
      metadata: {
        ...metadata,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  return {
    bucket: bucket.name,
    storagePath,
    contentType,
    sizeBytes: buffer.length,
    downloadToken,
    downloadUrl: buildDownloadUrl(bucket.name, storagePath, downloadToken),
  };
}

async function downloadArtifactToFile({
  bucketName,
  storagePath,
  destination,
}) {
  const bucket = bucketName
    ? fb.adminStorage.bucket(bucketName)
    : fb.adminStorage.bucket();

  await bucket.file(storagePath).download({ destination });
  return destination;
}

module.exports = {
  buildDownloadUrl,
  downloadArtifactToFile,
  saveBufferArtifact,
};
