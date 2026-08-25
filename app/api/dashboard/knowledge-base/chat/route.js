import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import { searchKnowledgeBase } from '../../../../../features/knowledge-base/retrieval.js';
import { listKnowledgeItems } from '../../../../../features/knowledge-base/store.js';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { callAnthropic } = require('../../../../../features/scout-intake/_anthropic-client.js');
const { logAnthropicCall } = require('../../../../../api/_lib/usage-logger.cjs');

const MODEL = 'claude-haiku-4-5-20251001';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

async function resolveContext(request) {
  const decoded = await verifyRequestUser(makeReqShim(request));
  const context = await getEffectiveClientContext({ uid: decoded.uid, email: decoded.email, request });
  if (!context.userProfile) {
    const err = new Error('No user record.');
    err.status = 404;
    throw err;
  }
  if (!context.clientId) {
    const err = new Error('No clientId on user record.');
    err.status = 404;
    throw err;
  }
  return context;
}

function extractText(response) {
  return (response?.content || [])
    .map((part) => part?.type === 'text' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
}

// Chunks max out at 3200 chars (chunk.js DEFAULT_MAX_CHARS), so this budget
// fits all topK=8 chunks whole — the source map and the context must always
// cover the same set, or the model cites sources it never saw.
const CONTEXT_CHAR_BUDGET = 26_000;

function selectPromptChunks(chunks, budget = CONTEXT_CHAR_BUDGET) {
  const included = [];
  let used = 0;
  for (const chunk of chunks) {
    const text = String(chunk.text || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (included.length && used + text.length > budget) break;
    included.push({ ...chunk, promptText: text });
    used += text.length;
  }
  return included;
}

function buildChatPrompt({ question, chunks, inventory }) {
  const citations = chunks.map((chunk, index) => {
    const section = chunk.sectionTitle ? ` · ${chunk.sectionTitle}` : '';
    return `[${index + 1}] ${chunk.sourceTitle || 'Knowledge source'}${section}`;
  }).join('\n');
  const context = chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.sourceTitle || 'Knowledge source'}: ${chunk.promptText}`)
    .join('\n');
  const inventoryLines = (inventory || [])
    .map((item) => `- ${item.title || item.fileName || 'Untitled document'}`)
    .join('\n');

  return `Answer the user's question using only the Knowledge Base context below.

Rules:
- If the context does not contain the answer, say what is missing.
- Be direct and useful. Use bullets when that helps.
- Cite supporting sources inline using [1], [2], etc.
- Only cite sources whose text appears in the Knowledge Base context. Never cite a source from its title alone.
- The document inventory lists every document in this client's Knowledge Base. The context below contains only the excerpts retrieved for this question — if an inventory document is not in the source map, its contents were not retrieved; do not guess what it says.
- Do not invent facts, dates, claims, metrics, or product behavior.

Question:
${question}

Document inventory (${(inventory || []).length} documents in this Knowledge Base):
${inventoryLines || 'No documents.'}

Source map (retrieved excerpts):
${citations || 'No sources.'}

Knowledge Base context:
${context || 'No retrieved context.'}`;
}

export async function POST(request) {
  let context;
  try {
    context = await resolveContext(request);
  } catch (err) {
    return json({ error: err.message || 'Unauthorized.' }, err.status || 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const question = String(body?.question || '').trim();
  if (!question) return json({ error: 'question is required.' }, 400);

  try {
    const [retrieved, inventory] = await Promise.all([
      searchKnowledgeBase({
        clientId: context.clientId,
        query: question,
        topK: 8,
      }),
      listKnowledgeItems(context.clientId).catch(() => []),
    ]);

    if (!retrieved.length) {
      return json({
        ok: true,
        answer: 'I could not find relevant Knowledge Base context for that question yet.',
        chunks: [],
        model: MODEL,
      });
    }

    // Only chunks whose full text fits the prompt budget — the answer's
    // citation numbers must line up with what the model actually read.
    const chunks = selectPromptChunks(retrieved);

    const response = await callAnthropic({
      model: MODEL,
      max_tokens: 700,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: buildChatPrompt({ question, chunks, inventory }),
        },
      ],
    });

    // Instrument — user-triggered KB chat was untracked.
    try { await logAnthropicCall({ module: 'knowledge-base', action: 'chat', model: MODEL, response, clientId: context.clientId }); } catch { /* best-effort */ }

    return json({
      ok: true,
      answer: extractText(response) || 'I could not generate an answer from the retrieved context.',
      chunks: chunks.map(({ promptText, ...chunk }) => chunk),
      model: MODEL,
      usage: response?.usage || null,
    });
  } catch (err) {
    return json({ error: err.message || 'Knowledge Base chat failed.' }, err.status || 500);
  }
}
