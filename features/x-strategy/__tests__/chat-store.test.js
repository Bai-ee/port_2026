import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryChatStore, createFirestoreChatStore, ChatCapError, MAX_MESSAGES, SUMMARY_NOTE_MAX, resolveTurnCap, dayKey,
} from '../agent/chat-store.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const prop = (id, status = 'pending') => ({ id, threadId: 't1', kind: 'plan-change', payload: {}, status, createdAt: '2026-10-11T12:00:00.000Z' });

test('appendTurn creates then extends a thread; getThread returns a copy', async () => {
  const s = createMemoryChatStore();
  const t = await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'hi', assistantText: 'hello', proposals: [prop('p1')], usage: { calls: 1 }, now: NOW });
  assert.equal(t.messages.length, 2);
  assert.deepEqual(t.messages[1].proposalIds, ['p1']);
  assert.equal(t.proposals.p1.status, 'pending');
  await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'again', assistantText: 'ok', proposals: [], now: NOW + 1000 });
  const got = await s.getThread('c1', 't1');
  assert.equal(got.messages.length, 4);
  got.messages.length = 0; // mutate the copy
  assert.equal((await s.getThread('c1', 't1')).messages.length, 4);
  assert.equal(await s.getThread('c1', 'nope'), null);
  assert.equal(await s.getThread('other', 't1'), null);
});

test('thread is bounded at 60 messages; dropped user questions fold into a deterministic summaryNote', async () => {
  const s = createMemoryChatStore();
  for (let i = 0; i < 50; i += 1) {
    await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: `question number ${i} ${'x'.repeat(200)}`, assistantText: `a${i}`, proposals: [], now: NOW + i });
  }
  const t = await s.getThread('c1', 't1');
  assert.equal(t.messages.length, MAX_MESSAGES);
  assert.ok(t.summaryNote.length > 0 && t.summaryNote.length <= SUMMARY_NOTE_MAX);
  assert.match(t.summaryNote, /Q: question number 19/);
  assert.ok(!t.summaryNote.includes('x'.repeat(100)), 'questions are truncated to 80 chars');
  assert.equal(t.messages.at(-1).text, 'a49'); // newest kept
  assert.ok(JSON.stringify(t).length < 60000);
});

test('decided proposals no longer referenced are pruned past the cap; pending ones are never dropped', async () => {
  const s = createMemoryChatStore();
  await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop('keep')], now: NOW });
  for (let i = 0; i < 45; i += 1) {
    await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop(`d${i}`, 'confirmed')], now: NOW + i + 1 });
  }
  const t = await s.getThread('c1', 't1');
  assert.ok(Object.keys(t.proposals).length <= 40 + 1);
  assert.ok(t.proposals.keep, 'pending proposal survives');
});

test('daily turn cap: reserveTurn counts, then throws ChatCapError(429) with used/cap', async () => {
  const s = createMemoryChatStore({ cap: 3 });
  assert.equal(await s.usedToday('c1', NOW), 0);
  for (let i = 1; i <= 3; i += 1) assert.equal(await s.reserveTurn('c1', NOW), i);
  assert.equal(await s.usedToday('c1', NOW), 3);
  await assert.rejects(() => s.assertTurnAvailable('c1', NOW), (e) => e instanceof ChatCapError && e.status === 429 && e.used === 3 && e.cap === 3);
  await assert.rejects(() => s.reserveTurn('c1', NOW), (e) => e instanceof ChatCapError && e.used === 3);
  assert.equal(await s.usedToday('c1', NOW), 3, 'a refused reserve does not increment');
  assert.equal(await s.reserveTurn('c1', NOW + 24 * 3600 * 1000), 1, 'next UTC day resets');
  assert.equal(await s.usedToday('c2', NOW), 0, 'per client');
});

test('cap resolution: default 60, env override, junk falls back', () => {
  assert.equal(resolveTurnCap(undefined, {}), 60);
  assert.equal(resolveTurnCap(undefined, { X_STRATEGY_DAILY_TURN_CAP: '5' }), 5);
  assert.equal(resolveTurnCap(undefined, { X_STRATEGY_DAILY_TURN_CAP: 'abc' }), 60);
  assert.equal(resolveTurnCap(undefined, { X_STRATEGY_DAILY_TURN_CAP: '0' }), 60);
  assert.equal(createMemoryChatStore({ env: { X_STRATEGY_DAILY_TURN_CAP: '7' } }).cap, 7);
  assert.equal(dayKey(NOW), '2026-10-11');
});

test('listThreads: newest first, limited, summarized', async () => {
  const s = createMemoryChatStore();
  await s.appendTurn({ clientId: 'c1', threadId: 'a', userText: 'first thread', assistantText: 'x', proposals: [prop('p')], now: NOW });
  await s.appendTurn({ clientId: 'c1', threadId: 'b', userText: 'second thread', assistantText: 'x', proposals: [], now: NOW + 5000 });
  await s.appendTurn({ clientId: 'c2', threadId: 'z', userText: 'other client', assistantText: 'x', proposals: [], now: NOW + 9000 });
  const l = await s.listThreads('c1', 20);
  assert.deepEqual(l.map((t) => t.threadId), ['b', 'a']);
  assert.equal(l[1].pendingProposals, 1);
  assert.equal(l[0].title, 'second thread');
  assert.equal((await s.listThreads('c1', 1)).length, 1);
});

test('claimProposal is exclusive until saved; saveProposal clears the lease', async () => {
  const s = createMemoryChatStore();
  await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop('p1')], now: NOW });
  const a = await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW });
  assert.equal(a.claimed, true);
  const b = await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW + 1000 });
  assert.deepEqual([b.claimed, b.inFlight], [false, true]);
  const c = await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW + 61000 });
  assert.deepEqual([c.claimed, c.inFlight], [false, true], "'deciding' is never auto-reclaimed, even after the old 60s lease");
  assert.equal((await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW + 3600000 * 24 })).claimed, false);
  assert.equal((await s.getThread('c1', 't1')).proposals.p1.status, 'deciding');
  assert.equal(a.proposal.status, 'pending', 'the claimer gets the pre-claim pending snapshot');
  const saved = await s.saveProposal({ clientId: 'c1', threadId: 't1', proposal: { ...a.proposal, status: 'confirmed' }, now: NOW });
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.decidingAt, undefined);
  assert.equal((await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW })).claimed, false);
  assert.equal((await s.claimProposal({ clientId: 'c1', threadId: 'missing', proposalId: 'p1', now: NOW })).threadMissing, true);
});

// ---- Firestore flavour over a minimal fake: same behaviour, writes confined to x_strategy_chats/{clientId}/** ----
function fakeDb() {
  const data = new Map();
  const writes = [];
  const mkDoc = (path) => ({
    path,
    collection: (n) => mkCol(`${path}/${n}`),
    async get() { return snap(path); },
  });
  const snap = (path) => ({ exists: data.has(path), id: path.split('/').at(-1), data: () => JSON.parse(JSON.stringify(data.get(path))) });
  const mkCol = (path) => ({
    path,
    doc: (id) => mkDoc(`${path}/${id}`),
    orderBy(field, dir) { return { limit: (n) => ({ kind: 'query', path, field, dir, n }) }; },
  });
  const db = {
    writes,
    collection: (n) => mkCol(n),
    async runTransaction(fn) {
      const pending = [];
      const tx = {
        async get(ref) {
          if (ref.kind === 'query') {
            const docs = [...data.entries()].filter(([k]) => k.startsWith(`${ref.path}/`) && !k.slice(ref.path.length + 1).includes('/'))
              .map(([k, v]) => ({ data: () => JSON.parse(JSON.stringify(v)), id: k }))
              .sort((a, b) => String(b.data()[ref.field]).localeCompare(String(a.data()[ref.field])));
            return { docs: docs.slice(0, ref.n) };
          }
          return snap(ref.path);
        },
        set(ref, v) { pending.push([ref.path, v]); },
      };
      const out = await fn(tx);
      for (const [p, v] of pending) { data.set(p, JSON.parse(JSON.stringify(v))); writes.push(p); }
      return out;
    },
  };
  return db;
}

test('firestore store: round-trip, cap, list, and every write is under x_strategy_chats/{clientId}', async () => {
  const db = fakeDb();
  const s = createFirestoreChatStore(db, { cap: 2, env: {} });
  await s.reserveTurn('c1', NOW);
  await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop('p1')], now: NOW });
  await s.appendTurn({ clientId: 'c1', threadId: 't2', userText: 'q2', assistantText: 'a', proposals: [], now: NOW + 1000 });
  assert.equal((await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW })).claimed, true);
  await s.saveProposal({ clientId: 'c1', threadId: 't1', proposal: prop('p1', 'rejected'), now: NOW });
  assert.equal((await s.getThread('c1', 't1')).proposals.p1.status, 'rejected');
  assert.deepEqual((await s.listThreads('c1')).map((t) => t.threadId), ['t2', 't1']);
  assert.equal(await s.usedToday('c1', NOW), 1);
  await s.reserveTurn('c1', NOW);
  await assert.rejects(() => s.reserveTurn('c1', NOW), ChatCapError);
  assert.ok(db.writes.length > 0);
  for (const p of db.writes) assert.match(p, /^x_strategy_chats\/c1(\/threads\/t[12])?$/);
});

test('ids are validated: path-traversal clientId / threadId rejected', async () => {
  const s = createMemoryChatStore();
  await assert.rejects(() => s.getThread('a/b', 't1'), /clientId/);
  await assert.rejects(() => s.getThread('c1', '../x'), /threadId/);
});

test('releaseProposal puts a deciding proposal back to pending (and only then)', async () => {
  const s = createMemoryChatStore();
  await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop('p1')], now: NOW });
  assert.equal(await s.releaseProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW }), false, 'pending: nothing to release');
  await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW });
  assert.equal(await s.releaseProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW }), true);
  const p = (await s.getThread('c1', 't1')).proposals.p1;
  assert.equal(p.status, 'pending');
  assert.equal(p.decidingAt, undefined);
  assert.equal((await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'p1', now: NOW })).claimed, true);
});

test('deciding proposals are never pruned past the proposal cap', async () => {
  const s = createMemoryChatStore();
  await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop('keep')], now: NOW });
  await s.claimProposal({ clientId: 'c1', threadId: 't1', proposalId: 'keep', now: NOW });
  for (let i = 0; i < 45; i += 1) {
    await s.appendTurn({ clientId: 'c1', threadId: 't1', userText: 'q', assistantText: 'a', proposals: [prop(`d${i}`, 'confirmed')], now: NOW + i });
  }
  assert.equal((await s.getThread('c1', 't1')).proposals.keep.status, 'deciding');
});
