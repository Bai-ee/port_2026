import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../store.js';
import { makeHarness, makePost, T0, HOUR, MIN } from './helpers/fakes.js';

const OUT = /out of date/i;
const harness = async (opts) => { const h = await makeHarness(opts); h.services.add(makePost()); return h; };

// ── 1. access ──────────────────────────────────────────────────────────────
test('unbound user gets only linking help: no data reads, no actions', async () => {
  const h = await harness();
  await h.msg("Today's posts", 999);
  await h.msg("What's happening?", 999);
  assert.match(h.lastText(), /private bot/);
  assert.deepEqual(h.readModels.calls, []);
  assert.equal(h.sent().every((c) => c.args[0] === 999), true);
  await h.press('abcdef123456', 999);
  assert.match(h.answers().at(-1), /Not linked/);
  assert.deepEqual(h.writeCalls(), []);
});

test('revoked binding and non-pilot binding are treated as unbound', async () => {
  const h = await harness();
  await S.revokeBinding(h.db, { clientId: 'c1', uid: 'u1', now: T0 });
  await h.msg("Today's posts");
  assert.match(h.lastText(), /private bot/);
  assert.deepEqual(h.readModels.calls, []);
  const h2 = await harness();
  h2.env.PILOT_OWNER_UIDS = 'someone-else'; // access is re-checked on every update
  await h2.msg("Today's posts");
  assert.match(h2.lastText(), /private bot/);
  assert.deepEqual(h2.readModels.calls, []);
});

test('access is re-checked on every update: a card button stops working once revoked', async () => {
  const h = await harness();
  await h.card();
  const b = h.button(/Skip/);
  h.env.PILOT_CLIENT_IDS = 'other-client';
  await h.press(b.ticket);
  assert.match(h.answers().at(-1), /Not linked/);
  assert.deepEqual(h.writeCalls(), []);
});

test('/start <code> attaches the challenge and says to confirm in HITLOOP (never completes linking)', async () => {
  const h = await harness({ users: [] });
  const { code } = await S.createLinkChallenge(h.db, { uid: 'u1', clientId: 'c1', now: T0 });
  await h.msg(`/start ${code}`, 555);
  assert.match(h.lastText(), /Confirm in HITLOOP/);
  assert.equal(await S.getBinding(h.db, 555), null);
  await h.msg('/start nope-nope', 555);
  assert.match(h.lastText(), /not valid/);
});

// ── 2. stale / foreign tickets ─────────────────────────────────────────────
test('stale revision: no service call, out-of-date answer, fresh card', async () => {
  const h = await harness();
  await h.card();
  const b = h.button(/Approve & post now/);
  h.services.posts.get('p1').revision = 5; // edited in web
  const before = h.sent().length;
  await h.press(b.ticket);
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.answers().at(-1), OUT);
  assert.ok(h.sent().length > before);
  assert.match(h.lastText(), /Revision 5/);
});

test('superseded ticket (a newer card replaced it) does not reach a service', async () => {
  const h = await harness();
  await h.card();
  const old = h.button(/Skip/);
  await h.card();
  await h.press(old.ticket);
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.answers().at(-1), OUT);
});

test('expired ticket does not reach a service', async () => {
  const h = await harness();
  await h.card();
  const b = h.button(/Skip/);
  h.clock.t += 25 * HOUR;
  await h.press(b.ticket);
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.answers().at(-1), OUT);
});

test("another user's ticket is refused", async () => {
  const h = await harness({ users: [{ tg: 111, uid: 'u1' }, { tg: 222, uid: 'u1' }] });
  await h.card();
  await h.press(h.button(/Skip/).ticket, 222);
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.answers().at(-1), /not for you/);
});

test('bindingVersion mismatch (relinked since the card) does not reach a service', async () => {
  const h = await harness();
  await h.card();
  const b = h.button(/Skip/);
  await h.db.collection('telegram_bindings').doc('111').set({ bindingVersion: 99 }, { merge: true });
  await h.press(b.ticket);
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.answers().at(-1), OUT);
});

// ── 3. duplicates ──────────────────────────────────────────────────────────
test('duplicate callback: service called once, second press returns the stored result', async () => {
  const h = await harness();
  await h.card();
  const b = h.button(/Approve & post now/);
  await h.press(b.ticket);
  await h.press(b.ticket);
  assert.equal(h.writeCalls().filter((w) => w.name === 'approveAndPostNow').length, 1);
  const [first, second] = h.answers().slice(-2);
  assert.equal(second, first);
});

test('concurrent duplicate callbacks call the service once', async () => {
  const h = await harness();
  await h.card();
  const b = h.button(/Approve & post now/);
  await Promise.all([h.press(b.ticket), h.press(b.ticket)]);
  assert.equal(h.writeCalls().filter((w) => w.name === 'approveAndPostNow').length, 1);
});

// ── 4. Post myself ─────────────────────────────────────────────────────────
test('Post myself claims BEFORE any copy or asset is sent; copy is exact with no parse mode; media sent separately', async () => {
  const h = await harness();
  const post = h.services.posts.get('p1');
  post.mediaUrl = 'https://cdn.example/v.mp4'; post.mediaType = 'video';
  await h.card();
  h.events.length = 0;
  await h.pressLabel(/^Post myself/);
  const claim = h.events.indexOf('svc:claimManualDelivery');
  const video = h.events.indexOf('tg:sendVideo');
  assert.ok(claim >= 0 && video > claim, `claim before media: ${h.events}`);
  const copy = h.sent().find((c) => c.args[1] === post.content);
  assert.ok(copy, 'exact copy message sent');
  assert.equal(copy.args[2]?.parseMode, undefined);
  assert.ok(h.events.indexOf('tg:sendMessage') > claim);
  assert.deepEqual(h.sent('sendVideo')[0].args.slice(0, 2), ['111', 'https://cdn.example/v.mp4']);
  assert.match(h.lastText(), /manually/i); // manual card follows
  assert.ok(h.button(/I've posted it/));
});

test('Post myself: media failure falls back to a "Download media" link', async () => {
  const h = await harness();
  Object.assign(h.services.posts.get('p1'), { mediaUrl: 'https://cdn.example/i.png', mediaType: 'image' });
  await h.card();
  h.transport.failNext('sendPhoto', Object.assign(new Error('bad'), { code: 'bad-request' }));
  await h.pressLabel(/^Post myself/);
  assert.ok(h.sent().some((c) => /Download media: https:\/\/cdn\.example\/i\.png/.test(c.args[1])));
  assert.ok(h.sent().some((c) => c.args[1] === h.services.posts.get('p1').content));
});

test('Post myself refused once auto delivery started or already posted: explains, sends no copy/assets', async () => {
  for (const [status, re] of [['posting', /already started posting/], ['posted', /already posted/]]) {
    const h = await harness();
    await h.card();
    h.services.posts.get('p1').status = status;
    h.services.posts.get('p1').revision = 1; // same revision, status raced
    await h.pressLabel(/^Post myself/);
    assert.ok(h.sent().some((c) => re.test(c.args[1])), status);
    assert.ok(!h.sent().some((c) => c.args[1] === h.services.posts.get('p1').content), 'copy must not be sent');
    assert.deepEqual(h.sent('sendVideo').concat(h.sent('sendPhoto')), []);
  }
});

// ── 5. I've posted it ──────────────────────────────────────────────────────
test("I've posted it + link: recorded as self-reported, permalink passed through", async () => {
  const h = await harness();
  h.services.posts.get('p1').status = 'manual';
  await h.card();
  await h.pressLabel(/I've posted it/);
  assert.deepEqual(h.writeCalls(), [], 'nothing recorded until link or No link');
  await h.msg('not a link');
  assert.match(h.lastText(), /does not look like/);
  await h.msg('https://x.com/bai_ee/status/12345');
  const call = h.writeCalls().at(-1);
  assert.equal(call.name, 'recordManualPosted');
  assert.equal(call.args[1].permalink, 'https://x.com/bai_ee/status/12345');
  assert.match(call.args[1].by, /^telegram:111:u1$/);
  assert.equal(h.lastText(), 'Recorded as posted (self-reported, not verified by X).');
});

test("I've posted it + No link", async () => {
  const h = await harness();
  h.services.posts.get('p1').status = 'manual';
  await h.card();
  await h.pressLabel(/I've posted it/);
  await h.pressLabel(/No link/);
  assert.equal(h.writeCalls().at(-1).args[1].permalink, null);
  assert.equal(h.lastText(), 'Recorded as posted (self-reported, not verified by X).');
  assert.equal(await S.getPending(h.db, 111, { now: T0 }), null);
});

// ── 6. approve buttons / outcomes ──────────────────────────────────────────
test('approve buttons appear for normal rows only, labelled with local time', async () => {
  const h = await harness();
  h.services.add(makePost({ id: 'r1', replyTo: { url: 'https://x.com/z/status/1', author: 'z' } }));
  await h.card('p1');
  assert.match(h.button(/Approve & schedule/).text, /Approve & schedule .*3:20\s?PM/);
  assert.ok(h.button(/^Approve & post now$/));
  const n = h.buttons().length;
  await h.card('r1');
  const replyButtons = h.buttons().slice(n).map((b) => b.text);
  assert.ok(!replyButtons.some((t) => /Approve/.test(t)), replyButtons.join('|'));
  assert.ok(replyButtons.some((t) => /Post myself/.test(t)));
});

test('Approve & schedule passes the ticket time and expected revision', async () => {
  const h = await harness();
  await h.card();
  await h.pressLabel(/Approve & schedule/);
  const c = h.writeCalls().at(-1);
  assert.equal(c.name, 'approveAndSchedule');
  assert.equal(c.args[1].scheduledAt, makePost().scheduledAt);
  assert.equal(c.args[1].expectedRevision, 1);
  assert.match(h.answers().at(-1), /scheduled for .*3:20/);
  assert.match(h.lastText(), /no action needed/); // status reminder, no approve button
});

test('Approve & post now reports posted / held / failed honestly', async () => {
  for (const [outcome, re] of [['posted', /^Posted to X/], ['held', /Held, not posted: story required/], ['failed', /Failed: X rejected it/]]) {
    const h = await harness();
    h.services.setOutcome(outcome);
    await h.card();
    await h.pressLabel(/^Approve & post now$/);
    assert.match(h.answers().at(-1), re, outcome);
    assert.ok(h.sent().some((c) => re.test(c.args[1])), outcome);
  }
});

// ── 7. revise ──────────────────────────────────────────────────────────────
test('Revise: next text becomes the new copy, old buttons stripped, old tickets superseded, new card sent', async () => {
  const h = await harness();
  await h.card();
  const oldSkip = h.button(/Skip/);
  const oldMsg = h.sent().at(-1);
  await h.pressLabel(/Revise/);
  await h.msg('Better copy.');
  const upd = h.writeCalls().at(-1);
  assert.equal(upd.name, 'updateSocialPost');
  assert.deepEqual(upd.args.slice(1), [{ content: 'Better copy.' }, { expectedRevision: 1 }]);
  assert.ok(h.transport.calls.some((c) => c.method === 'editMessageReplyMarkup' && c.args[2] === null), 'old keyboard stripped');
  assert.match(h.lastText(), /Better copy\./);
  assert.match(h.lastText(), /Revision 2/);
  await h.press(oldSkip.ticket);
  assert.match(h.answers().at(-1), OUT);
  assert.ok(!h.writeCalls().some((w) => w.name === 'rejectDraft'));
  assert.ok(oldMsg);
});

test('Revise over 280 chars: error, nothing written, pending kept so a shorter retry works', async () => {
  const h = await harness();
  await h.card();
  await h.pressLabel(/Revise/);
  await h.msg('x'.repeat(281));
  assert.match(h.lastText(), /281 characters/);
  assert.deepEqual(h.writeCalls(), []);
  await h.msg('short enough');
  assert.equal(h.writeCalls().at(-1).name, 'updateSocialPost');
});

test('Revise typed after the post changed elsewhere is not applied', async () => {
  const h = await harness();
  await h.card();
  await h.pressLabel(/Revise/);
  h.services.posts.get('p1').revision = 4;
  await h.msg('late edit');
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.sent().find((c) => OUT.test(c.args[1])).args[1], OUT);
});

// ── 8. reschedule ──────────────────────────────────────────────────────────
test('Reschedule quick pick approves at the picked time', async () => {
  const h = await harness();
  await h.card();
  await h.pressLabel(/Approve & pick time|Reschedule/);
  await h.pressLabel(/^\+1 hour/);
  const c = h.writeCalls().at(-1);
  assert.equal(c.name, 'approveAndSchedule');
  assert.equal(c.args[1].scheduledAt, new Date(T0 + HOUR).toISOString());
});

test('Reschedule typed time is read in the settings timezone; past time rejected without a service call', async () => {
  const h = await harness();
  await h.card();
  await h.pressLabel(/Approve & pick time|Reschedule/);
  await h.msg('13:00');
  assert.match(h.lastText(), /already passed/);
  assert.deepEqual(h.writeCalls(), []);
  await S.saveSettings(h.db, 'c1', { timezone: 'America/Los_Angeles' }, { now: T0 });
  await h.msg('2026-12-01 09:00');
  const c = h.writeCalls().at(-1);
  assert.equal(c.args[1].scheduledAt, '2026-12-01T17:00:00.000Z'); // PST = UTC-8
});

// ── 9. free text ───────────────────────────────────────────────────────────
test('free text with no pending state is never approval', async () => {
  const h = await harness();
  await h.card();
  for (const t of ['yes', 'approve', 'post it', 'ok do it', 'Approve & post now']) await h.msg(t);
  assert.deepEqual(h.writeCalls(), []);
  assert.match(h.lastText(), /does not approve or post/);
});

test('a menu press clears a pending revise so the next text is not treated as copy', async () => {
  const h = await harness();
  await h.card();
  await h.pressLabel(/Revise/);
  await h.msg('Calendar');
  await h.msg('some random text');
  assert.deepEqual(h.writeCalls(), []);
});

// ── menu ───────────────────────────────────────────────────────────────────
test("What's happening? sends the overview with section buttons; a section tap sends that section", async () => {
  const h = await harness();
  await h.msg("What's happening?");
  assert.equal(h.lastText(), '<b>Overview</b>');
  await h.pressLabel(/Market insights/);
  assert.equal(h.lastText(), 'I');
});

test('Today lists reviewable posts as buttons that open the card', async () => {
  const h = await harness();
  h.calendarRows.push({ id: 'p1', status: 'draft', content: 'hello', scheduledAt: makePost().scheduledAt, revision: 1 });
  await h.msg("Today's posts");
  await h.pressLabel(/hello/);
  assert.match(h.lastText(), /Draft \(not approved\)/);
});

test('Settings toggles persist; Upload without the intake module explains it is coming', async () => {
  const h = await harness();
  await h.msg('Settings');
  await h.pressLabel(/Pause notifications/);
  assert.equal((await S.getSettings(h.db, 'c1')).notificationsPaused, true);
  await h.pressLabel(/Lead time/);
  assert.equal((await S.getSettings(h.db, 'c1')).leadMinutes, 60);
  await h.msg('Upload content');
  assert.match(h.lastText(), /coming next/);
});

test('Upload content explains intake; media and context replies go to ctx.intake, menu text never does', async () => {
  const h = await harness();
  const got = [];
  h.ctx.intake = { handleMessage: async (a) => { got.push(a); return true; } };
  await h.msg('Upload content');
  assert.equal(got.length, 0, 'the button itself is not captured as content or context');
  await h.msg('Finished this installation today.');
  assert.equal(got.length, 1, 'a plain reply is offered to intake (context answer)');
  assert.equal(got[0].binding.clientId, 'c1');
});
