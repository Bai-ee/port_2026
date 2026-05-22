import assert from 'node:assert/strict';
import test from 'node:test';

import { extractDocumentText, validateDocumentFile } from '../document.js';

test('validateDocumentFile accepts common text documents', () => {
  assert.doesNotThrow(() => validateDocumentFile({
    fileName: 'notes.txt',
    contentType: 'text/plain',
    sizeBytes: 128,
  }));
});

test('validateDocumentFile rejects legacy Word .doc files', () => {
  assert.throws(
    () => validateDocumentFile({
      fileName: 'legacy.doc',
      contentType: 'application/msword',
      sizeBytes: 128,
    }),
    /Legacy \.doc files are not supported/
  );
});

test('extractDocumentText extracts utf8 text-like files', async () => {
  const result = await extractDocumentText({
    buffer: Buffer.from('This client knowledge file has enough extractable text to store.', 'utf8'),
    fileName: 'knowledge.md',
    contentType: 'text/markdown',
  });

  assert.equal(result.type, 'file');
  assert.equal(result.parser, 'utf8-text');
  assert.match(result.text, /client knowledge file/);
});

test('extractDocumentText accepts unknown extensions when content is text', async () => {
  const result = await extractDocumentText({
    buffer: Buffer.from('An unknown extension can still contain useful client notes and context.', 'utf8'),
    fileName: 'context.custom',
    contentType: 'application/octet-stream',
  });

  assert.equal(result.type, 'file');
  assert.match(result.text, /unknown extension/);
});

test('extractDocumentText rejects binary files without text', async () => {
  await assert.rejects(
    () => extractDocumentText({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 4]),
      fileName: 'image.png',
      contentType: 'image/png',
    }),
    /Unsupported file type/
  );
});
