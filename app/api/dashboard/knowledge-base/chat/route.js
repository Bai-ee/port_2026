import { NextResponse } from 'next/server';
import { createRequire } from 'module';

import { formatKnowledgeContext, searchKnowledgeBase } from '../../../../../features/knowledge-base/retrieval.js';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../../api/_lib/auth.cjs');
const { getEffectiveClientContext } = require('../../../../../api/_lib/client-provisioning.cjs');
const { callAnthropic } = require('../../../../../features/scout-intake/_anthropic-client.js');

const MODEL = 'claude-haiku-4-5-20251001';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

function buildChatPrompt({ question, chunks }) {
  const context = formatKnowledgeContext(chunks, 6500);
  const citations = chunks.map((chunk, index) => {
    const section = chunk.sectionTitle ? ` · ${chunk.sectionTitle}` : '';
    return `[${index + 1}] ${chunk.sourceTitle || 'Knowledge source'}${section}`;
  }).join('\n');

  return `Answer the user's question using only the Knowledge Base context below.

Rules:
- If the context does not contain the answer, say what is missing.
- Be direct and useful. Use bullets when that helps.
- Cite supporting sources inline using [1], [2], etc.
- Do not invent facts, dates, claims, metrics, or product behavior.

Question:
${question}

Source map:
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
    const chunks = await searchKnowledgeBase({
      clientId: context.clientId,
      query: question,
      topK: 8,
    });

    if (!chunks.length) {
      return json({
        ok: true,
        answer: 'I could not find relevant Knowledge Base context for that question yet.',
        chunks: [],
        model: MODEL,
      });
    }

    const response = await callAnthropic({
      model: MODEL,
      max_tokens: 700,
      temperature: 0.1,
      messages: [
        {
          role: 'user',
          content: buildChatPrompt({ question, chunks }),
        },
      ],
    });

    return json({
      ok: true,
      answer: extractText(response) || 'I could not generate an answer from the retrieved context.',
      chunks,
      model: MODEL,
      usage: response?.usage || null,
    });
  } catch (err) {
    return json({ error: err.message || 'Knowledge Base chat failed.' }, err.status || 500);
  }
}
