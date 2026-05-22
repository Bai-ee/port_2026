import { formatKnowledgeContext, searchKnowledgeBase } from './retrieval.js';

const DEFAULT_TOP_K = 5;
const DEFAULT_CHAR_CAP = 3400;

function compact(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

export function buildKnowledgeBaseRuntimeQuery({
  intent = 'brand strategy',
  websiteUrl = '',
  clientName = '',
  brandOverview = null,
  sourceInputs = null,
} = {}) {
  const overview = brandOverview || {};
  const inputs = sourceInputs || {};
  return [
    intent,
    clientName,
    websiteUrl,
    overview.headline,
    overview.summary,
    overview.industry,
    overview.businessModel,
    overview.targetAudience,
    overview.positioning,
    inputs.ideaDescription,
  ]
    .map((part) => compact(part))
    .filter(Boolean)
    .join('\n');
}

export function summarizeKnowledgeSources(chunks = []) {
  return (Array.isArray(chunks) ? chunks : []).slice(0, DEFAULT_TOP_K).map((chunk, index) => ({
    index: index + 1,
    itemId: chunk.itemId || null,
    chunkId: chunk.id || null,
    title: chunk.sourceTitle || chunk.sourceFileName || 'Knowledge source',
    sectionTitle: chunk.sectionTitle || null,
    sourceType: chunk.sourceType || null,
    sourceUrl: chunk.sourceUrl || null,
    relevance: chunk.relevanceLabel || null,
    distance: typeof chunk.distance === 'number' ? chunk.distance : null,
  }));
}

export async function getKnowledgeBaseRuntimeContext({
  clientId,
  query,
  topK = DEFAULT_TOP_K,
  charCap = DEFAULT_CHAR_CAP,
} = {}) {
  if (!clientId || !String(query || '').trim()) {
    return {
      available: false,
      block: '',
      chunks: [],
      sources: [],
      error: null,
    };
  }

  try {
    const chunks = await searchKnowledgeBase({ clientId, query, topK });
    const block = formatKnowledgeContext(chunks, charCap);
    return {
      available: chunks.length > 0 && Boolean(block),
      block,
      chunks,
      sources: summarizeKnowledgeSources(chunks),
      error: null,
    };
  } catch (err) {
    return {
      available: false,
      block: '',
      chunks: [],
      sources: [],
      error: err?.message || String(err),
    };
  }
}
