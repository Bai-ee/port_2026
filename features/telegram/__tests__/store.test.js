import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as S from '../store.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../api/_lib/__tests__/fake-firestore.cjs');

const T0 = Date.parse('2026-10-11T12:00:00Z');
const MIN = 60_000;
const fresh = () => makeFakeContext().adminDb;

// ── link flow ──
async function linkedChallenge(db, tg = 111, now = T0) {
  const { code } = await S.createLinkChallenge(db, { uid: 'u1', clientId: 'c1', now });
  const r = await S.attachTelegramToChallenge(db, { code, telegramUserId: tg, chatId: tg, telegramUsername: 'bb', firstName: 'B', now });
  return { code, r };
}

test('createLinkChallenge: 32-char url-safe code, only hash stored', async () => {
  const db = fresh();
  const { code, expiresAt } = await S.createLinkChallenge(db, { uid: 'u1', clientId: 'c1', now: T0 });
  assert.match(code, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(expiresAt, new Date(T0 + 10 * MIN).toISOString());
  assert.equal(db._raw('telegram_link_challenges', code), undefined);
  assert.equal([...db._store.get('telegram_link_challenges').keys()].length, 1);
});

test('attach: ok, then pending visible, unknown/expired/used reasons', async () => {
  const db = fresh();
  const { r } = await linkedChallenge(db);
  assert.deepEqual(r, { ok: true, clientId: 'c1', uid: 'u1' });
  const pending = await S.getPendingLink(db, { uid: 'u1', clientId: 'c1', now: T0 + MIN });
  assert.equal(pending.telegramUsername, 'bb');

  assert.deepEqual(await S.attachTelegramToChallenge(db, { code: 'nope-nope-nope-nope-nope', telegramUserId: 1, chatId: 1, now: T0 }), { ok: false, reason: 'unknown' });

  const { code } = await S.createLinkChallenge(db, { uid: 'u2', clientId: 'c2', now: T0 });
  const late = await S.attachTelegramToChallenge(db, { code, telegramUserId: 5, chatId: 5, now: T0 + 11 * MIN });
  assert.deepEqual(late, { ok: false, reason: 'expired' });

  // A second person cannot take a claimed code.
  const { code: c3 } = await S.createLinkChallenge(db, { uid: 'u3', clientId: 'c3', now: T0 });
  await S.attachTelegramToChallenge(db, { code: c3, telegramUserId: 7, chatId: 7, now: T0 });
  assert.equal((await S.attachTelegramToChallenge(db, { code: c3, telegramUserId: 8, chatId: 8, now: T0 })).reason, 'used');
  assert.equal((await S.attachTelegramToChallenge(db, { code: c3, telegramUserId: 7, chatId: 7, now: T0 })).ok, true);
});

test('getPendingLink: expired claim returns null; confirmed code is used', async () => {
  const db = fresh();
  const { code } = await linkedChallenge(db);
  assert.equal(await S.getPendingLink(db, { uid: 'u1', clientId: 'c1', now: T0 + 11 * MIN }), null);
  await S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 + MIN });
  assert.equal((await S.attachTelegramToChallenge(db, { code, telegramUserId: 111, chatId: 111, now: T0 + 2 * MIN })).reason, 'used');
  assert.equal(await S.getPendingLink(db, { uid: 'u1', clientId: 'c1', now: T0 + 2 * MIN }), null);
});

test('confirmLink: creates active binding v1; throws with nothing pending or after expiry', async () => {
  const db = fresh();
  await assert.rejects(S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 }), (e) => e.code === 'no-pending-link');
  await linkedChallenge(db);
  const b = await S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 + MIN });
  assert.equal(b.status, 'active');
  assert.equal(b.bindingVersion, 1);
  assert.equal(b.chatId, '111');
  assert.deepEqual(await S.getBinding(db, 111), b);
  assert.equal((await S.getActiveBindingForClient(db, 'c1')).telegramUserId, '111');

  const db2 = fresh();
  await linkedChallenge(db2);
  await assert.rejects(S.confirmLink(db2, { uid: 'u1', clientId: 'c1', now: T0 + 11 * MIN }), (e) => e.code === 'no-pending-link');
});

test('confirmLink revokes previous binding for the client and bumps bindingVersion', async () => {
  const db = fresh();
  await linkedChallenge(db, 111);
  const first = await S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 + MIN });
  await linkedChallenge(db, 222, T0 + 5 * MIN);
  const second = await S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 + 6 * MIN });
  assert.equal(second.bindingVersion, first.bindingVersion + 1);
  const old = await S.getBinding(db, 111);
  assert.equal(old.status, 'revoked');
  assert.equal(old.bindingVersion, first.bindingVersion + 1);
  assert.equal((await S.getActiveBindingForClient(db, 'c1')).telegramUserId, '222');
  assert.equal((await S.listActiveBindings(db)).length, 1);
});

test('re-linking the same telegram user after revoke keeps version growing', async () => {
  const db = fresh();
  await linkedChallenge(db, 111);
  await S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 + MIN });
  const revoked = await S.revokeBinding(db, { clientId: 'c1', uid: 'u1', now: T0 + 2 * MIN });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.bindingVersion, 2);
  assert.equal(await S.getActiveBindingForClient(db, 'c1'), null);
  await linkedChallenge(db, 111, T0 + 3 * MIN);
  const again = await S.confirmLink(db, { uid: 'u1', clientId: 'c1', now: T0 + 4 * MIN });
  assert.equal(again.bindingVersion, 3);
  assert.equal(await S.revokeBinding(db, { clientId: 'zzz', uid: 'u1' }), null);
});

// ── inbox ──
const upd = (id, extra = {}) => ({
  update_id: id,
  message: { message_id: 5, chat: { id: 9, type: 'private', title: 'x' }, from: { id: 111, username: 'bb', first_name: 'B', last_name: 'secret', language_code: 'en' }, text: 'hello', ...extra },
});

test('sanitizeUpdate keeps only whitelisted fields', () => {
  const out = S.sanitizeUpdate(upd(1, {
    text: 'x'.repeat(5000),
    photo: [{ file_id: 'f', file_unique_id: 'u', file_size: 1, width: 2, height: 3, extra: 1 }],
    video: { file_id: 'v', mime_type: 'video/mp4', thumbnail: { a: 1 } },
    reply_to_message: { message_id: 3, text: 'old', from: { id: 1 } },
    contact: { phone_number: '123' },
  }));
  assert.equal(out.message.text.length, 4096);
  assert.equal(out.message.from.last_name, undefined);
  assert.equal(out.message.chat.title, undefined);
  assert.equal(out.message.contact, undefined);
  assert.deepEqual(out.message.photo[0], { file_id: 'f', file_unique_id: 'u', file_size: 1, width: 2, height: 3 });
  assert.deepEqual(out.message.video, { file_id: 'v', mime_type: 'video/mp4' });
  assert.deepEqual(out.message.reply_to_message, { message_id: 3 });
  const cb = S.sanitizeUpdate({ update_id: 2, callback_query: { id: 'q', from: { id: 1, username: 'x' }, data: 't:abc', message: { message_id: 4, chat: { id: 9, type: 'private' }, text: 'big' } } });
  assert.deepEqual(cb.callback_query, { id: 'q', from: { id: 1 }, data: 't:abc', message: { message_id: 4, chat: { id: 9 } } });
});

test('recordUpdate: duplicate update_id is a no-op', async () => {
  const db = fresh();
  const a = await S.recordUpdate(db, upd(100), { now: T0 });
  const b = await S.recordUpdate(db, upd(100, { text: 'changed' }), { now: T0 + 1000 });
  assert.deepEqual(a, { duplicate: false, id: '100' });
  assert.deepEqual(b, { duplicate: true, id: '100' });
  assert.equal(db._raw('telegram_updates', '100').payload.message.text, 'hello');
  assert.equal(db._raw('telegram_updates', '100').telegramUserId, '111');
  assert.equal(db._raw('telegram_updates', '100').kind, 'message');
});

test('claimUpdate: lease blocks, expiry allows reclaim, done is final', async () => {
  const db = fresh();
  await S.recordUpdate(db, upd(1), { now: T0 });
  const c1 = await S.claimUpdate(db, '1', { workerId: 'w1', now: T0, leaseMs: 60_000 });
  assert.equal(c1.attempts, 1);
  assert.equal(await S.claimUpdate(db, '1', { workerId: 'w2', now: T0 + 30_000 }), null);
  assert.deepEqual((await S.listReclaimableUpdates(db, { now: T0 + 30_000 })).map((d) => d.id), []);
  const rec = await S.listReclaimableUpdates(db, { now: T0 + 61_000 });
  assert.deepEqual(rec.map((d) => d.id), ['1']);
  const c2 = await S.claimUpdate(db, '1', { workerId: 'w2', now: T0 + 61_000 });
  assert.equal(c2.lease.workerId, 'w2');
  assert.equal(c2.attempts, 2);
  await S.completeUpdate(db, '1', { now: T0 + 62_000 });
  assert.equal(await S.claimUpdate(db, '1', { workerId: 'w3', now: T0 + 200_000 }), null);
  assert.deepEqual(await S.listReclaimableUpdates(db, { now: T0 + 200_000 }), []);
  assert.equal(await S.claimUpdate(db, 'missing', { workerId: 'w', now: T0 }), null);
});

test('failUpdate: retriable until 5 attempts, then dead', async () => {
  const db = fresh();
  await S.recordUpdate(db, upd(2), { now: T0 });
  for (let i = 1; i <= 5; i += 1) {
    const c = await S.claimUpdate(db, '2', { workerId: 'w', now: T0 + i * 1000 });
    assert.ok(c, `claim ${i}`);
    const r = await S.failUpdate(db, '2', { error: new Error('boom'), now: T0 + i * 1000 });
    assert.equal(r.status, i < 5 ? 'received' : 'dead');
  }
  assert.equal(db._raw('telegram_updates', '2').status, 'dead');
  assert.equal(db._raw('telegram_updates', '2').error, 'boom');
  assert.equal(await S.claimUpdate(db, '2', { workerId: 'w', now: T0 + 99_000 }), null);
  assert.deepEqual(await S.listReclaimableUpdates(db, { now: T0 + 99_000 }), []);
});

test('crashing worker (lease expiry only) also ends dead', async () => {
  const db = fresh();
  await S.recordUpdate(db, upd(3), { now: T0 });
  let t = T0;
  for (let i = 0; i < 5; i += 1) { assert.ok(await S.claimUpdate(db, '3', { workerId: 'w', now: t })); t += 61_000; }
  assert.equal(await S.claimUpdate(db, '3', { workerId: 'w', now: t }), null);
  assert.equal(db._raw('telegram_updates', '3').status, 'dead');
});

// ── tickets ──
const mkTicket = (db, over = {}) => S.issueTicket(db, { clientId: 'c1', postId: 'p1', revision: 3, action: 'approve', params: { x: 1 }, telegramUserId: 111, bindingVersion: 1, now: T0, ...over });

test('issueTicket: 12 url-safe chars; claim -> settle -> replay returns stored result', async () => {
  const db = fresh();
  const id = await mkTicket(db);
  assert.match(id, /^[A-Za-z0-9_-]{12}$/);
  const c = await S.claimTicket(db, id, { telegramUserId: 111, now: T0 + 1000 });
  assert.equal(c.state, 'claimed');
  assert.equal(c.ticket.action, 'approve');
  await S.settleTicket(db, id, { ok: true, outcome: 'posted' }, { now: T0 + 2000 });
  const again = await S.claimTicket(db, id, { telegramUserId: 111, now: T0 + 3000 });
  assert.equal(again.state, 'replay');
  assert.deepEqual(again.result, { ok: true, outcome: 'posted' });
});

test('claimTicket: unknown, forbidden, expired, superseded', async () => {
  const db = fresh();
  assert.equal((await S.claimTicket(db, 'nope', { telegramUserId: 1, now: T0 })).state, 'unknown');
  const id = await mkTicket(db, { ttlMs: MIN });
  assert.equal((await S.claimTicket(db, id, { telegramUserId: 999, now: T0 })).state, 'forbidden');
  assert.equal((await S.claimTicket(db, id, { telegramUserId: 111, now: T0 + 2 * MIN })).state, 'expired');

  const keep = await mkTicket(db);
  const drop = await mkTicket(db, { action: 'skip' });
  const other = await mkTicket(db, { postId: 'p2' });
  const n = await S.supersedeTicketsForPost(db, { clientId: 'c1', postId: 'p1', exceptTicketIds: [keep] });
  assert.equal(n, 2, 'the expired-but-open p1 ticket and `drop`');
  assert.equal((await S.claimTicket(db, drop, { telegramUserId: 111, now: T0 })).state, 'superseded');
  assert.equal((await S.claimTicket(db, keep, { telegramUserId: 111, now: T0 })).state, 'claimed');
  assert.equal((await S.claimTicket(db, other, { telegramUserId: 111, now: T0 })).state, 'claimed');
});

test('claimTicket: in-progress inside 120s, stale claim is re-claimable', async () => {
  const db = fresh();
  const id = await mkTicket(db);
  assert.equal((await S.claimTicket(db, id, { telegramUserId: 111, now: T0 })).state, 'claimed');
  assert.equal((await S.claimTicket(db, id, { telegramUserId: 111, now: T0 + 60_000 })).state, 'in-progress');
  assert.equal((await S.claimTicket(db, id, { telegramUserId: 111, now: T0 + 121_000 })).state, 'claimed');
});

test('supersede does not clobber a settled ticket', async () => {
  const db = fresh();
  const id = await mkTicket(db);
  await S.claimTicket(db, id, { telegramUserId: 111, now: T0 });
  await S.settleTicket(db, id, { ok: true }, { now: T0 });
  assert.equal(await S.supersedeTicketsForPost(db, { clientId: 'c1', postId: 'p1' }), 0);
  assert.equal((await S.claimTicket(db, id, { telegramUserId: 111, now: T0 })).state, 'replay');
});

// ── outbox ──
const msg = (db, key, over = {}) => S.enqueueMessage(db, { clientId: 'c1', chatId: 9, dedupKey: key, kind: 'handoff', payload: { text: 'hi', skip: undefined }, now: T0, ...over });

test('enqueueMessage: dedupKey dedups; undefined stripped', async () => {
  const db = fresh();
  const a = await msg(db, 'k1');
  const b = await msg(db, 'k1');
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(a.id, b.id);
  assert.ok(!('skip' in db._raw('telegram_outbox', a.id).payload));
});

test('claimOutbox: honors notBefore, limit, lease; complete marks sent', async () => {
  const db = fresh();
  const now = await msg(db, 'now');
  await msg(db, 'later', { notBefore: T0 + 10 * MIN });
  await msg(db, 'now2');
  const got = await S.claimOutbox(db, { now: T0, limit: 1, workerId: 'w' });
  assert.equal(got.length, 1);
  assert.equal(got[0].attempts, 1);
  const rest = await S.claimOutbox(db, { now: T0, limit: 10, workerId: 'w2' });
  assert.equal(rest.length, 1); // 'later' is not due, first is leased
  assert.deepEqual(await S.claimOutbox(db, { now: T0 + 30_000, workerId: 'w3' }), []);
  const reclaimed = await S.claimOutbox(db, { now: T0 + 61_000, workerId: 'w3' });
  assert.equal(reclaimed.length, 2); // both leases expired
  await S.completeOutbox(db, now.id, { messageIds: [55], now: T0 + 62_000 });
  assert.equal(db._raw('telegram_outbox', now.id).status, 'sent');
  assert.deepEqual(db._raw('telegram_outbox', now.id).messageIds, [55]);
  const due = await S.claimOutbox(db, { now: T0 + 11 * MIN, workerId: 'w4' });
  assert.equal(due.some((d) => d.dedupKey === 'later'), true);
});

test('retryOutbox: backoff 30s/2m/8m/20m then failed; retryAfter wins when larger', async () => {
  const db = fresh();
  const { id } = await msg(db, 'bo');
  const expected = [30_000, 120_000, 480_000, 1_200_000];
  let t = T0;
  for (const delay of expected) {
    const [c] = await S.claimOutbox(db, { now: t, workerId: 'w' });
    assert.ok(c);
    const r = await S.retryOutbox(db, id, { error: 'x', now: t });
    assert.equal(r.status, 'queued');
    assert.equal(Date.parse(r.nextAttemptAt) - t, delay);
    assert.deepEqual(await S.claimOutbox(db, { now: t + delay - 1, workerId: 'w' }), []);
    t += delay;
  }
  await S.claimOutbox(db, { now: t, workerId: 'w' });
  const last = await S.retryOutbox(db, id, { error: 'x', now: t });
  assert.equal(last.status, 'failed');
  assert.equal(db._raw('telegram_outbox', id).status, 'failed');
});

test('retryOutbox honors a long retryAfter', async () => {
  const db = fresh();
  const { id } = await msg(db, 'ra');
  await S.claimOutbox(db, { now: T0, workerId: 'w' });
  const r = await S.retryOutbox(db, id, { retryAfterSec: 300, error: '429', now: T0 });
  assert.equal(Date.parse(r.nextAttemptAt) - T0, 300_000);
  assert.deepEqual(await S.claimOutbox(db, { now: T0 + 299_000, workerId: 'w' }), []);
  assert.equal((await S.claimOutbox(db, { now: T0 + 300_000, workerId: 'w' })).length, 1);
});

test('failOutbox / supersedeOutbox are terminal and never reclaimed', async () => {
  const db = fresh();
  const a = await msg(db, 'a');
  const b = await msg(db, 'b');
  await S.failOutbox(db, a.id, { error: new Error('forbidden'), now: T0 });
  await S.supersedeOutbox(db, b.id, { reason: 'revision-changed', now: T0 });
  assert.equal(db._raw('telegram_outbox', a.id).error, 'forbidden');
  assert.equal(db._raw('telegram_outbox', b.id).status, 'superseded');
  assert.deepEqual(await S.claimOutbox(db, { now: T0 + 99 * MIN, workerId: 'w' }), []);
});

// ── notices, settings, state, pending ──
test('notices: record merges and reads back', async () => {
  const db = fresh();
  assert.equal(await S.getNotice(db, { clientId: 'c1', postId: 'p1' }), null);
  await S.recordNotice(db, { clientId: 'c1', postId: 'p1', revision: 2, chatId: '9', messageIds: [1], state: 'live' });
  await S.recordNotice(db, { clientId: 'c1', postId: 'p1', state: 'superseded' });
  const n = await S.getNotice(db, { clientId: 'c1', postId: 'p1' });
  assert.equal(n.revision, 2);
  assert.equal(n.state, 'superseded');
});

test('settings: defaults, default timezone, patch merge, validation', async () => {
  const db = fresh();
  const d = await S.getSettings(db, 'c1');
  assert.deepEqual(d, { timezone: 'America/Chicago', leadMinutes: 30, briefingEnabled: true, briefingHour: 8, quietHours: { enabled: true, start: 22, end: 7 }, notificationsPaused: false, notifyFailures: true, notifySuccessSummary: false });
  assert.equal((await S.getSettings(db, 'c1', { defaultTimezone: 'Europe/Paris' })).timezone, 'Europe/Paris');

  const s = await S.saveSettings(db, 'c1', { timezone: 'Europe/London', leadMinutes: 45, quietHours: { start: 23 }, notificationsPaused: true }, { now: T0 });
  assert.equal(s.timezone, 'Europe/London');
  assert.deepEqual(s.quietHours, { enabled: true, start: 23, end: 7 });
  const back = await S.getSettings(db, 'c1', { defaultTimezone: 'Europe/Paris' });
  assert.equal(back.timezone, 'Europe/London');
  assert.equal(back.notificationsPaused, true);
  assert.equal(back.briefingHour, 8);

  for (const bad of [{ timezone: 'Mars/Olympus' }, { timezone: '' }, { leadMinutes: 241 }, { leadMinutes: -1 }, { leadMinutes: 1.5 }, { briefingHour: 24 }, { quietHours: { start: 24 } }, { briefingEnabled: 'yes' }]) {
    await assert.rejects(S.saveSettings(db, 'c1', bad), (e) => e.code === 'invalid-settings' && e.status === 400, JSON.stringify(bad));
  }
  assert.equal((await S.getSettings(db, 'c1')).timezone, 'Europe/London'); // rejected writes changed nothing
});

test('state patch merges', async () => {
  const db = fresh();
  assert.deepEqual(await S.getState(db, 'c1'), {});
  await S.patchState(db, 'c1', { lastBriefingDate: '2026-10-11' });
  await S.patchState(db, 'c1', { lastFailureDigestKey: 'k' });
  assert.deepEqual(await S.getState(db, 'c1'), { lastBriefingDate: '2026-10-11', lastFailureDigestKey: 'k' });
});

test('pending: expires, clears', async () => {
  const db = fresh();
  await S.setPending(db, 111, { kind: 'revise', clientId: 'c1', postId: 'p1', revision: 2, ticketId: 't', ttlMs: 5 * MIN, now: T0 });
  assert.equal((await S.getPending(db, 111, { now: T0 + MIN })).kind, 'revise');
  assert.equal(await S.getPending(db, 111, { now: T0 + 5 * MIN }), null);
  await S.setPending(db, 111, { kind: 'permalink', clientId: 'c1', postId: 'p1', revision: 2, now: T0 });
  assert.equal((await S.getPending(db, 111, { now: T0 + MIN })).kind, 'permalink');
  await S.clearPending(db, 111);
  assert.equal(await S.getPending(db, 111, { now: T0 + MIN }), null);
});
