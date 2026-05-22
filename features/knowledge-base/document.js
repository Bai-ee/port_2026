import { extname } from 'node:path';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.jsonl',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.rtf',
  '.log',
]);

const TEXT_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/csv',
  'application/x-ndjson',
  'application/rtf',
];

export { MAX_DOCUMENT_BYTES };

function extensionFor(fileName) {
  return extname(String(fileName || '').toLowerCase());
}

function isTextLike({ fileName, contentType }) {
  const ext = extensionFor(fileName);
  const type = String(contentType || '').toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || TEXT_CONTENT_TYPES.some((prefix) => type.startsWith(prefix));
}

function isPdf({ fileName, contentType }) {
  return extensionFor(fileName) === '.pdf' || String(contentType || '').toLowerCase() === 'application/pdf';
}

function isDocx({ fileName, contentType }) {
  const type = String(contentType || '').toLowerCase();
  return (
    extensionFor(fileName) === '.docx' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

function isLegacyDoc({ fileName, contentType }) {
  const type = String(contentType || '').toLowerCase();
  return extensionFor(fileName) === '.doc' || type === 'application/msword';
}

export function validateDocumentFile({ fileName, contentType, sizeBytes }) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    const err = new Error('Uploaded file is empty.');
    err.status = 400;
    throw err;
  }

  if (sizeBytes > MAX_DOCUMENT_BYTES) {
    const err = new Error('Uploaded files must be 10 MB or smaller.');
    err.status = 400;
    throw err;
  }

  if (isLegacyDoc({ fileName, contentType })) {
    const err = new Error('Legacy .doc files are not supported yet. Export the document as .docx, PDF, or .txt and upload that version.');
    err.status = 400;
    throw err;
  }

}

async function extractPdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  let result;
  try {
    result = await parser.getText();
  } catch (err) {
    const nextErr = new Error(`Could not extract text from this PDF: ${err.message || 'parser failed.'}`);
    nextErr.status = 400;
    throw nextErr;
  } finally {
    await parser.destroy();
  }
  return {
    text: String(result?.text || '').trim(),
    pages: Number(result?.total || result?.pages?.length) || null,
    parser: 'pdf-parse',
  };
}

async function extractDocxText(buffer) {
  const mammoth = await import('mammoth');
  let result;
  try {
    result = await mammoth.extractRawText({ buffer });
  } catch (err) {
    const nextErr = new Error(`Could not extract text from this DOCX file: ${err.message || 'parser failed.'}`);
    nextErr.status = 400;
    throw nextErr;
  }
  const messages = Array.isArray(result.messages) ? result.messages.map((m) => m.message).filter(Boolean) : [];
  return {
    text: String(result.value || '').trim(),
    pages: null,
    parser: 'mammoth',
    warnings: messages,
  };
}

function extractTextLike(buffer) {
  const text = buffer.toString('utf8').replace(/\u0000/g, '').trim();
  return {
    text,
    pages: null,
    parser: 'utf8-text',
  };
}

function looksLikeUtf8Text(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) return false;

  const decoded = sample.toString('utf8');
  if (!decoded) return false;

  let useful = 0;
  let replacement = 0;
  for (const char of decoded) {
    const code = char.charCodeAt(0);
    if (char === '\uFFFD') replacement += 1;
    if (char === '\n' || char === '\r' || char === '\t' || (code >= 32 && code !== 127 && code !== 0xfffd)) {
      useful += 1;
    }
  }

  return replacement / decoded.length < 0.02 && useful / decoded.length > 0.85;
}

export async function extractDocumentText({ buffer, fileName, contentType }) {
  let result;
  let type;

  if (isPdf({ fileName, contentType })) {
    type = 'pdf';
    result = await extractPdfText(buffer);
  } else if (isDocx({ fileName, contentType })) {
    type = 'docx';
    result = await extractDocxText(buffer);
  } else if (isTextLike({ fileName, contentType })) {
    type = 'file';
    result = extractTextLike(buffer);
  } else if (looksLikeUtf8Text(buffer)) {
    type = 'file';
    result = extractTextLike(buffer);
  } else {
    const err = new Error('Unsupported file type or no extractable text found. Upload PDF, DOCX, TXT, Markdown, CSV, JSON, HTML, XML, YAML, RTF, log, or another text-based file.');
    err.status = 400;
    throw err;
  }

  if (!result?.text || result.text.length < 20) {
    const err = new Error('No extractable text found in this file.');
    err.status = 400;
    throw err;
  }

  return { ...result, type };
}
