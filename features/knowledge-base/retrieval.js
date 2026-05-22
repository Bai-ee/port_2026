import { createRequire } from 'module';

import { embedQuery } from './embed.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');

const DEFAULT_TOP_K = 5;
const MAX_TOP_K = 10;
const DEFAULT_CHAR_CAP = 3200;
const SIGNED_SOURCE_URL_TTL_MS = 15 * 60 * 1000;

export function clampTopK(value, fallback = DEFAULT_TOP_K) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(MAX_TOP_K, Math.floor(n)));
}

function serializeChunkDoc(doc) {
  const data = doc.data() || {};
  const text = data.text || '';
  return {
    id: doc.id,
    itemId: data.itemId || '',
    position: Number(data.position) || 0,
    text,
    sourceTitle: data.sourceTitle || '',
    sourceUrl: data.sourceUrl || null,
    tokenEstimate: Number(data.tokenEstimate) || 0,
    distance: typeof data.distance === 'number' ? data.distance : null,
  };
}

function cleanTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[|>]\s*Source:.+$/i, '')
    .replace(/\s*Exported:.+$/i, '')
    .replace(/^[#\s-]+/, '')
    .trim()
    .slice(0, 120);
}

export function inferSectionTitle(text, fallback = '') {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return cleanTitle(fallback) || 'Knowledge excerpt';

  const headingMatches = [...compact.matchAll(/(?:^|\s)#{1,6}\s+([^#]+?)(?=\s+#{1,6}\s+|$)/g)]
    .map((match) => cleanTitle(match[1]))
    .filter((title) => title && !/https?:\/\//i.test(title) && !/\bsource\b|\bexported\b/i.test(title));
  if (headingMatches.length) {
    const title = headingMatches[headingMatches.length - 1];
    const questionMatch = title.match(/^(What|Why|How|When|Where|Who)\s+\S+(?:\s+\S+){0,5}/i);
    if (questionMatch) return cleanTitle(questionMatch[0]);
    return title.split(/\s+/).slice(0, 10).join(' ');
  }

  const firstSentence = compact.split(/(?<=[.!?])\s+/)[0] || '';
  const sentenceTitle = firstSentence.split(/\s+/).slice(0, 9).join(' ');
  return cleanTitle(sentenceTitle || fallback) || 'Knowledge excerpt';
}

function tokenize(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]{2,}/g) || [])]
    .filter((term) => !new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'what', 'when', 'where', 'which', 'into', 'about', 'your', 'you']).has(term))
    .slice(0, 12);
}

export function extractMatchedTerms({ query, text, limit = 8 } = {}) {
  const textLower = String(text || '').toLowerCase();
  return tokenize(query).filter((term) => textLower.includes(term)).slice(0, limit);
}

export function relevanceLabel(distance) {
  if (typeof distance !== 'number') return 'semantic match';
  if (distance <= 0.3) return 'very close match';
  if (distance <= 0.45) return 'close match';
  if (distance <= 0.62) return 'related context';
  return 'loose context';
}

export function buildExcerpt(text, charCap = 900) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  const cap = Math.max(240, Number(charCap) || 900);
  return compact.length > cap ? `${compact.slice(0, cap).trim()}...` : compact;
}

async function signedUrlForStoragePath(storagePath) {
  if (!storagePath) return null;
  try {
    const [url] = await fb.adminStorage.bucket().file(storagePath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + SIGNED_SOURCE_URL_TTL_MS,
    });
    return url;
  } catch (err) {
    console.warn('[knowledge-base] signed source url failed:', err.message);
    return null;
  }
}

async function enrichChunks({ clientId, chunks, query }) {
  const ids = [...new Set(chunks.map((chunk) => chunk.itemId).filter(Boolean))];
  const itemSnaps = await Promise.all(ids.map((id) => (
    fb.adminDb.collection('knowledge_base').doc(clientId).collection('items').doc(id).get()
  )));
  const itemsById = new Map();
  for (const snap of itemSnaps) {
    if (snap.exists) itemsById.set(snap.id, snap.data() || {});
  }

  const signedUrlByItemId = new Map();
  await Promise.all([...itemsById.entries()].map(async ([itemId, item]) => {
    if (!item?.storagePath) return;
    signedUrlByItemId.set(itemId, await signedUrlForStoragePath(item.storagePath));
  }));

  return chunks.map((chunk) => {
    const item = itemsById.get(chunk.itemId) || {};
    const sourceTitle = item.title || chunk.sourceTitle || item.fileName || 'Knowledge source';
    const sourceHref = item.sourceUrl || chunk.sourceUrl || signedUrlByItemId.get(chunk.itemId) || null;
    const type = item.type || (item.storagePath ? 'file' : 'text');
    const matchedTerms = extractMatchedTerms({ query, text: chunk.text });
    return {
      ...chunk,
      sourceTitle,
      sourceUrl: item.sourceUrl || chunk.sourceUrl || null,
      sourceHref,
      sourceFileName: item.fileName || null,
      sourceType: type,
      sectionTitle: inferSectionTitle(chunk.text, sourceTitle),
      excerpt: buildExcerpt(chunk.text),
      matchedTerms,
      relevanceLabel: relevanceLabel(chunk.distance),
    };
  });
}

function annotateVectorIndexError(err) {
  const message = String(err?.message || err || '');
  if (/index|nearest|vector/i.test(message)) {
    const wrapped = new Error(
      `${message}\n\nCreate a Firestore vector index for knowledge_base/{clientId}/chunks on field "embedding" with cosine distance. Include filters for clientId and embeddingStatus if Firestore requests a composite/vector index.`
    );
    wrapped.status = err.status || 500;
    return wrapped;
  }
  return err;
}

export async function searchKnowledgeBase({ clientId, query, topK = DEFAULT_TOP_K } = {}) {
  if (!clientId) throw new Error('searchKnowledgeBase: clientId is required');
  const q = String(query || '').trim();
  if (!q) {
    const err = new Error('query is required.');
    err.status = 400;
    throw err;
  }

  const queryVector = await embedQuery(q);
  const limit = clampTopK(topK);

  try {
    const snap = await fb.adminDb
      .collection('knowledge_base')
      .doc(clientId)
      .collection('chunks')
      .where('clientId', '==', clientId)
      .where('embeddingStatus', '==', 'embedded')
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit,
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance',
      })
      .get();

    const chunks = snap.docs.map(serializeChunkDoc);
    return enrichChunks({ clientId, chunks, query: q });
  } catch (err) {
    throw annotateVectorIndexError(err);
  }
}

export function formatKnowledgeContext(chunks, charCap = DEFAULT_CHAR_CAP) {
  const cap = Math.max(500, Number(charCap) || DEFAULT_CHAR_CAP);
  const parts = (Array.isArray(chunks) ? chunks : [])
    .slice(0, DEFAULT_TOP_K)
    .map((chunk, index) => {
      const source = chunk.sourceTitle || chunk.sourceUrl || `Source ${index + 1}`;
      const text = String(chunk.text || '').replace(/\s+/g, ' ').trim();
      return text ? `[${index + 1}] ${source}: ${text}` : '';
    })
    .filter(Boolean);

  const joined = parts.join('\n');
  return joined.length > cap ? `${joined.slice(0, cap)}...` : joined;
}
