import { createRequire } from 'module';

import {
  listKnowledgeChunks,
  markChunkEmbeddingErrorBatch,
  updateChunkEmbeddingBatch,
  updateKnowledgeItemStatus,
} from './store.js';

const require = createRequire(import.meta.url);

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
export const EMBEDDING_PROVIDER = 'openai';
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_ENV_KEY = 'OPENAI_API_KEY';
const MAX_INPUT_CHARS = 8000;
const DEFAULT_BATCH_SIZE = 24;
const DEFAULT_CONCURRENCY = 2;

let dotenvLoaded = false;

function maybeLoadDotenv() {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  try {
    require('dotenv/config');
  } catch {
    // Ignore missing dotenv in deployed environments.
  }
}

export function getEmbeddingConfig() {
  let apiKey = process.env[EMBEDDING_ENV_KEY];
  if (!apiKey) {
    maybeLoadDotenv();
    apiKey = process.env[EMBEDDING_ENV_KEY];
  }
  if (!apiKey) {
    const err = new Error(`${EMBEDDING_ENV_KEY} is not set.`);
    err.status = 500;
    throw err;
  }
  return {
    apiKey,
    provider: EMBEDDING_PROVIDER,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

function normalizeInput(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT_CHARS);
}

function chunkArray(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function embedBatch(inputs, config) {
  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: inputs,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    const err = new Error(`OpenAI embeddings API ${response.status}: ${text.slice(0, 400)}`);
    err.status = response.status;
    throw err;
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    const err = new Error('OpenAI embeddings API returned invalid JSON.');
    err.status = 502;
    throw err;
  }

  const byIndex = [...(payload.data || [])].sort((a, b) => a.index - b.index);
  if (byIndex.length !== inputs.length) {
    const err = new Error('OpenAI embeddings API returned an unexpected embedding count.');
    err.status = 502;
    throw err;
  }

  return byIndex.map((entry) => {
    if (!Array.isArray(entry.embedding) || entry.embedding.length !== config.dimensions) {
      const err = new Error('OpenAI embeddings API returned an embedding with unexpected dimensions.');
      err.status = 502;
      throw err;
    }
    return entry.embedding;
  });
}

export async function embedTexts(texts, options = {}) {
  const inputs = (Array.isArray(texts) ? texts : [])
    .map(normalizeInput)
    .filter(Boolean);
  if (!inputs.length) return [];

  const config = options.config || getEmbeddingConfig();
  const batches = chunkArray(inputs, Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE));
  const batchEmbeddings = await mapWithConcurrency(
    batches,
    Math.max(1, Number(options.concurrency) || DEFAULT_CONCURRENCY),
    (batch) => embedBatch(batch, config)
  );

  return batchEmbeddings.flat();
}

export async function embedQuery(text, options = {}) {
  const [embedding] = await embedTexts([text], options);
  if (!embedding) {
    const err = new Error('Query text is required.');
    err.status = 400;
    throw err;
  }
  return embedding;
}

export async function embedKnowledgeItemChunks({ clientId, itemId }) {
  const chunks = await listKnowledgeChunks({
    clientId,
    itemId,
    embeddingStatuses: ['pending', 'error'],
    limit: 500,
  });
  if (!chunks.length) {
    return { embedded: 0, failed: 0 };
  }

  const config = getEmbeddingConfig();
  const chunkIds = chunks.map((chunk) => chunk.id);

  try {
    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text), { config });
    const updates = chunks.map((chunk, index) => ({
      chunkId: chunk.id,
      embedding: embeddings[index],
      provider: config.provider,
      model: config.model,
      dimensions: config.dimensions,
    }));
    const result = await updateChunkEmbeddingBatch({ clientId, updates });
    await updateKnowledgeItemStatus({ clientId, itemId, status: 'ready', error: null });
    return { embedded: result.updated, failed: 0 };
  } catch (err) {
    await markChunkEmbeddingErrorBatch({ clientId, chunkIds, error: err.message });
    await updateKnowledgeItemStatus({ clientId, itemId, status: 'error', error: err.message });
    throw err;
  }
}
