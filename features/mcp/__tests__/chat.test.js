import test from 'node:test';
import assert from 'node:assert/strict';
import { registry } from '../registry.js';
import { handleRpc } from '../jsonrpc.js';
import { createActionRuntime, runActionTool } from '../../x-strategy/agent/action-runtime.js';
import { createMemoryActionStores } from '../../x-strategy/agent/action-stores.js';
import { createMemoryChatStore } from '../../x-strategy/agent/chat-store.js';
import { createFakeDb } from './fake-db.js';
import { realHandlers } from './tools.test.js';

const OWNER = 'bryan-balli-WUoltG84';
const NOW = Date.parse('2026-10-12T12:00:00Z');

function setup({ cap = 60 } = {}) {
  const chatStore = createMemoryChatStore({ cap });
  const invoked = [];
  const stores = createMemoryActionStores();
  const actionRuntime = createActionRuntime({ ...stores, invoke: async (e, a) => { invoked.push(e.id); return { ok: true, status: 200, json: {} }; } });
  let seenAuth = null;
  const agentLoopFactory = ({ toolDeps }) => ({
    runTurn: async ({ userText }) => {
      seenAuth = toolDeps.actions.ctx.authorization;
      const out = await runActionTool('run_action', { actionId: 'queue.post.update', args: { postId: 'p1', content: userText } }, toolDeps);
      return { text: 'ok', proposals: out.proposal ? [out.proposal] : [], toolResults: [] };
    },
  });
  const { h, chat } = realHandlers({ actionRuntime, agentLoopFactory, chatStore });
  const ctx = { db: createFakeDb({ [`clients/${OWNER}`]: { name: 'B' } }), email: 'bryanballi@gmail.com', clientId: OWNER, now: () => NOW, services: { strategyHandlers: () => h } };
  const call = async (name, args) => {
    const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { registry, ctx, instructions: '' });
    return r.body.result;
  };
  return { call, invoked, chat: chatStore, seenAuth: () => seenAuth };
}
const textOf = (r) => JSON.parse(r.content[0].text);

test('chat_send: same thread store, writes degrade to a pending card, nothing invoked, no authorization', async () => {
  const s = setup();
  const sent = textOf(await s.call('chat_send', { text: 'fix post p1' }));
  assert.equal(sent.cards.length, 1);
  assert.equal(sent.cards[0].status, 'pending');
  assert.equal(sent.cards[0].kind, 'action');
  assert.equal(s.seenAuth(), null);
  assert.deepEqual(s.invoked, []);
  assert.match(sent.next, /confirm/i);

  const list = textOf(await s.call('chat_threads', {}));
  assert.equal(list.threads[0].threadId, sent.threadId);
  assert.equal(list.threads[0].openCards, 1);
  assert.equal(list.turnsUsedToday, 1);

  const th = textOf(await s.call('chat_thread', { threadId: sent.threadId }));
  assert.equal(th.thread.messages.length, 2);
  assert.equal(th.thread.cards[0].status, 'pending');

  // continue the same thread
  const again = textOf(await s.call('chat_send', { text: 'again', threadId: sent.threadId }));
  assert.equal(again.threadId, sent.threadId);
});

test('chat_send: daily cap is shared (429 surfaces as a tool error)', async () => {
  const s = setup({ cap: 1 });
  await s.call('chat_send', { text: 'one' });
  const r = await s.call('chat_send', { text: 'two' });
  assert.equal(r.isError, true);
});

test('runtime without authorization: tier 0 refused, undo refused', async () => {
  const stores = createMemoryActionStores();
  const rt = createActionRuntime({ ...stores, invoke: async () => { throw new Error('must not invoke'); } });
  const read = await rt.run({ clientId: 'c1', authorization: null }, { actionId: 'queue.post.list', args: {} });
  assert.equal(read.kind, 'error');
  assert.equal((await rt.undo({ clientId: 'c1' }, 'x')).ok, false);
});

test('find_actions and get_action_log are read-only and work without authorization', async () => {
  const s = setup();
  const f = textOf(await s.call('find_actions', { query: 'edit post' }));
  assert.ok(f.actions.length >= 1);
  const l = textOf(await s.call('get_action_log', {}));
  assert.deepEqual(l.actions, []);
  assert.equal(registry.find((t) => t.name === 'find_actions').annotations.readOnlyHint, true);
  assert.equal(registry.find((t) => t.name === 'chat_send').annotations.readOnlyHint, false);
});
