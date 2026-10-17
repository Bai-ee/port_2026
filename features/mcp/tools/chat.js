// chat.js - conversation parity with the dashboard Strategy chat (Marketing Director > Strategy (chat)).
// Same threads (x_strategy_chats), same agent turn (strategy-chat-send), same daily turn cap. Uses only the identity
// the MCP server already verified (OAuth) and the in-process strategy handlers; passes NO authorization header, so the
// action runtime turns every write into a confirm card and the owner confirms in the dashboard. Also exposes the
// read-only action registry search and audit log.

import { ToolError } from '../jsonrpc.js';
import { defTool, resolveClientId, CLIENT_ID_PROP, str } from './common.js';
import { ACTION_TOOLS } from '../../x-strategy/agent/action-runtime.js';

const authFor = (ctx) => ({ decoded: { email: ctx.email, uid: ctx.uid ?? null } });
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DASHBOARD_PATH = 'HITLOOP Marketing Director > Strategy (chat)';

const unwrap = (res, what) => {
  if (!res || res.ok === false) throw new ToolError(`${what} failed: ${res?.error || 'unknown error'}${res?.status ? ` (${res.status})` : ''}`);
  return res;
};

const cardOf = (p) => ({
  id: p.id, kind: p.kind, status: p.status, summary: clip(p.summary, 240),
  ...(p.result ? { result: clip(p.result.message ?? JSON.stringify(p.result), 300) } : {}),
  ...(p.error ? { error: clip(p.error, 200) } : {}),
});

const shapeThread = (t) => ({
  threadId: t.threadId, createdAt: t.createdAt ?? null, updatedAt: t.updatedAt ?? null,
  ...(t.summaryNote ? { earlierSummary: clip(t.summaryNote, 600) } : {}),
  messages: (t.messages || []).map((m) => ({
    role: m.role, at: m.at, text: String(m.text ?? '').slice(0, 4000),
    ...(m.proposalIds?.length ? { cardIds: m.proposalIds } : {}),
  })),
  cards: Object.values(t.proposals || {}).map(cardOf),
});

const handlersOf = (ctx) => ctx.services.strategyHandlers();

const chatThreads = defTool({
  name: 'chat_threads',
  title: 'Strategy chat threads',
  description: `Recent Strategy chat threads for the client, the SAME threads the dashboard shows in ${DASHBOARD_PATH} (including ones started in the dashboard). Each row: threadId, title (first line), updatedAt, messageCount, open (pending) card count. Also returns today's turn usage vs the daily cap. Read-only, free.`,
  inputSchema: { type: 'object', properties: { clientId: CLIENT_ID_PROP } },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const r = unwrap(await handlersOf(ctx).handle('strategy-chat-history', { clientId }, { clientId }, authFor(ctx)), 'Thread list');
    return {
      threads: (r.threads || []).map((t) => ({ threadId: t.threadId, title: t.title, updatedAt: t.updatedAt, messageCount: t.messageCount, openCards: t.pendingProposals })),
      turnsUsedToday: r.turnsUsedToday, cap: r.cap,
    };
  },
});

const chatThread = defTool({
  name: 'chat_thread',
  title: 'Strategy chat thread',
  description: `One Strategy chat thread in full: messages (user and assistant) plus the confirm cards it created, each with kind, status (pending, confirmed, rejected, failed), result and summary. Use a threadId from chat_threads to read a dashboard conversation, then continue it with chat_send. Cards are confirmed in ${DASHBOARD_PATH}, never here. Read-only, free.`,
  inputSchema: { type: 'object', properties: { threadId: str('Thread id from chat_threads.'), clientId: CLIENT_ID_PROP }, required: ['threadId'] },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const r = unwrap(await handlersOf(ctx).handle('strategy-chat-history', { clientId, threadId: args.threadId }, { clientId }, authFor(ctx)), 'Thread read');
    return { thread: shapeThread(r.thread), turnsUsedToday: r.turnsUsedToday, cap: r.cap };
  },
});

const chatSend = defTool({
  name: 'chat_send',
  title: 'Send to Strategy chat',
  kind: 'propose',
  description: `Send a message to the dashboard Strategy agent and return its reply. Runs the SAME agent turn as the dashboard chat (same tools, rules, memory of the thread), so it makes ONE model call and counts against the same daily turn cap (use sparingly). Omit threadId to start a new thread; pass a threadId from chat_threads to continue a dashboard thread. Anything that would change data comes back as a PENDING card in ${DASHBOARD_PATH}; nothing is applied until the owner confirms it there (there is no confirm tool). Tell the owner to confirm in the dashboard; never say it was done.`,
  inputSchema: { type: 'object', properties: { text: str('The message to send, as the owner would type it in the chat.'), threadId: str('Existing thread id to continue; omit to start a new thread.'), clientId: CLIENT_ID_PROP }, required: ['text'] },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const body = { clientId, text: args.text, ...(args.threadId ? { threadId: args.threadId } : {}) };
    const r = unwrap(await handlersOf(ctx).handle('strategy-chat-send', body, { clientId, uid: ctx.uid ?? null, email: ctx.email }, authFor(ctx)), 'Chat turn');
    return {
      threadId: r.threadId, reply: r.text, turnsUsedToday: r.turnsUsedToday, cap: r.cap,
      cards: (r.proposals || []).map(cardOf),
      ...(r.droppedProposals?.length ? { droppedCards: r.droppedProposals } : {}),
      next: r.proposals?.length ? `${r.proposals.length} card(s) are PENDING and NOT applied. Tell the owner to confirm them in ${DASHBOARD_PATH} (thread ${r.threadId}).` : 'No cards were created.',
    };
  },
});

const findActions = defTool({
  name: 'find_actions',
  title: 'Find dashboard actions',
  description: ACTION_TOOLS.find((t) => t.name === 'find_actions').description + ' Over MCP this only SEARCHES the registry (what the dashboard can do and its arguments); to have one run, use chat_send, which turns writes into cards the owner confirms in the dashboard.',
  inputSchema: { type: 'object', properties: { query: str('What to do, in plain words'), group: str('Optional group filter'), clientId: CLIENT_ID_PROP }, required: ['query'] },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const a = handlersOf(ctx).toolDepsFor(clientId, { clientId, uid: ctx.uid ?? null, email: ctx.email }).actions;
    if (!a?.runtime) throw new ToolError('The action registry is not available on this deployment.');
    return { actions: a.runtime.find(String(args.query ?? ''), { group: args.group }) };
  },
});

const getActionLog = defTool({
  name: 'get_action_log',
  title: 'Agent action log',
  description: ACTION_TOOLS.find((t) => t.name === 'get_action_log').description + ' Same log as the dashboard. Undo is dashboard-only.',
  inputSchema: { type: 'object', properties: { clientId: CLIENT_ID_PROP } },
  handler: async ({ args, ctx }) => {
    const clientId = await resolveClientId(ctx, args);
    const a = handlersOf(ctx).toolDepsFor(clientId, { clientId, uid: ctx.uid ?? null, email: ctx.email }).actions;
    if (!a?.runtime) throw new ToolError('The action log is not available on this deployment.');
    return { actions: await a.runtime.log(a.ctx) };
  },
});

export const chatTools = Object.freeze([chatThreads, chatThread, chatSend, findActions, getActionLog]);
