// Shared test harness for bot/scheduler tests: real store on the in-memory Firestore, the fake transport, and
// in-memory services/readModels/briefing that follow the track contracts. `events` is one ordered log across
// service writes and outgoing Telegram sends so tests can assert "claim happened before copy was sent".
import { createRequire } from 'node:module';
import * as store from '../../store.js';
import { createFakeTransport } from '../../transport.js';
import { createBot } from '../../bot.js';

const require = createRequire(import.meta.url);
const { makeFakeContext } = require('../../../../api/_lib/__tests__/fake-firestore.cjs');

export const T0 = Date.UTC(2026, 9, 14, 20, 0, 0); // Wed 2026-10-14 15:00 CDT
export const HOUR = 3600000;
export const MIN = 60000;

const err = (code, status = 409) => Object.assign(new Error(code), { code, status });

export function makePost(over = {}) {
  return {
    id: 'p1', clientId: 'c1', platform: 'x', content: 'Exact copy: line one\n& "quotes" <b>', status: 'draft', revision: 1,
    scheduledAt: new Date(T0 + 20 * MIN).toISOString(), mediaUrl: null, replyTo: null, engine: 'authored', ...over,
  };
}

export function makeServices(events) {
  const posts = new Map();
  const writes = [];
  let postNowOutcome = 'posted';
  const log = (name, args) => { writes.push({ name, args }); events.push(`svc:${name}`); };
  const need = (id) => { const p = posts.get(id); if (!p) throw err('not-found', 404); return p; };
  const check = (p, o) => { if (o?.expectedRevision != null && (p.revision || 0) !== Number(o.expectedRevision)) throw err('revision-conflict'); };
  const bump = (p, patch) => { Object.assign(p, patch, { revision: (p.revision || 0) + 1 }); return { ...p }; };
  return {
    posts, writes,
    setOutcome: (o) => { postNowOutcome = o; },
    add: (p) => { posts.set(p.id, p); return p; },
    getSocialPost: async (clientId, id) => (posts.has(id) ? { ...posts.get(id) } : null),
    claimManualDelivery: async (clientId, id, o) => {
      log('claimManualDelivery', [id, o]); const p = need(id); check(p, o);
      if (p.status === 'posting') throw err('auto-delivery-started');
      if (p.status === 'posted') throw err('already-posted');
      return bump(p, { status: 'manual', deliveryMode: 'manual' });
    },
    recordManualPosted: async (clientId, id, o) => { log('recordManualPosted', [id, o]); const p = need(id); check(p, o); return bump(p, { status: 'posted', deliveryMode: 'manual', deliveryVerified: false, permalink: o.permalink || null }); },
    releaseManualClaim: async (clientId, id, o) => { log('releaseManualClaim', [id, o]); const p = need(id); check(p, o); return bump(p, { status: 'draft' }); },
    approveAndSchedule: async (clientId, id, o) => { log('approveAndSchedule', [id, o]); const p = need(id); check(p, o); return bump(p, { status: 'scheduled', scheduledAt: o.scheduledAt }); },
    approveAndPostNow: async (clientId, id, o) => {
      log('approveAndPostNow', [id, o]); const p = need(id); check(p, o);
      const status = { posted: 'posted', held: 'draft', failed: 'failed' }[postNowOutcome] || 'draft';
      const post = bump(p, { status, ...(postNowOutcome === 'held' ? { heldReason: 'story required' } : {}), ...(postNowOutcome === 'failed' ? { error: 'X rejected it' } : {}) });
      return { ok: postNowOutcome === 'posted', post, outcome: postNowOutcome };
    },
    updateSocialPost: async (clientId, id, patch, o) => { log('updateSocialPost', [id, patch, o]); const p = need(id); check(p, o); return bump(p, { content: patch.content }); },
    rejectDraft: async (clientId, id, o) => { log('rejectDraft', [id, o]); const p = need(id); check(p, o); return bump(p, { status: 'rejected' }); },
  };
}

export const WRITE_NAMES = ['claimManualDelivery', 'recordManualPosted', 'releaseManualClaim', 'approveAndSchedule', 'approveAndPostNow', 'updateSocialPost', 'rejectDraft'];

export async function makeHarness({ users = [{ tg: 111, uid: 'u1' }], clientId = 'c1' } = {}) {
  const db = makeFakeContext().adminDb;
  const events = [];
  const clock = { t: T0 };
  const env = { PILOT_OWNER_UIDS: users.map((u) => u.uid).join(','), PILOT_CLIENT_IDS: clientId, NODE_ENV: 'test' };
  const transport = createFakeTransport();
  for (const m of ['sendMessage', 'sendPhoto', 'sendVideo']) {
    const orig = transport[m];
    transport[m] = async (...a) => { events.push(`tg:${m}`); return orig(...a); };
  }
  const services = makeServices(events);
  const calendarRows = [];
  const queue = { needsReview: [], awaitingApproval: [], drafts: [], failed: [], manual: [] };
  const readModels = {
    calls: [],
    loadAccountHandle: async () => 'bai_ee',
    loadCalendar: async () => { readModels.calls.push('calendar'); return { today: '2026-10-14', week: [{ date: '2026-10-14', posts: calendarRows }] }; },
    loadBriefing: async () => { readModels.calls.push('briefing'); return { queue }; },
  };
  const briefing = {
    formatWhatsHappening: () => ({ overview: '<b>Overview</b>', insights: 'I', conversations: 'C', review: 'R', detail: 'D' }),
    formatToday: () => '<b>Today</b>', formatWeek: () => '<b>Week</b>', formatNextActions: () => '<b>Next</b>',
  };
  const ctx = { db, store, transport, readModels, briefing, services, env, now: () => clock.t, botUsername: 'fake_bot' };
  const bot = createBot(ctx);
  ctx.bot = bot;
  const bindings = {};
  for (const u of users) {
    const { code } = await store.createLinkChallenge(db, { uid: u.uid, clientId, now: clock.t });
    await store.attachTelegramToChallenge(db, { code, telegramUserId: u.tg, chatId: u.tg, telegramUsername: `u${u.tg}`, firstName: 'T', now: clock.t });
    bindings[u.tg] = await store.confirmLink(db, { uid: u.uid, clientId, now: clock.t });
  }
  let updateId = 1;
  const h = {
    db, events, clock, env, transport, services, readModels, ctx, bot, bindings, calendarRows, queue, store,
    binding: (tg = 111) => store.getBinding(db, tg),
    msg: (text, tg = 111, extra = {}) => bot.handleUpdate({ update_id: updateId++, message: { message_id: updateId, chat: { id: tg, type: 'private' }, from: { id: tg }, text, ...extra } }),
    press: (ticketId, tg = 111) => bot.handleUpdate({ update_id: updateId++, callback_query: { id: `cq${updateId}`, from: { id: tg }, data: `t:${ticketId}`, message: { message_id: 1, chat: { id: tg } } } }),
    sent: (method = 'sendMessage') => transport.calls.filter((c) => c.method === method && !c.error),
    lastText: () => h.sent().at(-1)?.args[1],
    answers: () => transport.calls.filter((c) => c.method === 'answerCallbackQuery').map((c) => c.args[1].text),
    // Every inline button ever sent, newest last: {text, ticket, messageIndex}
    buttons: () => transport.calls.flatMap((c) => (c.args?.find((a) => a?.replyMarkup)?.replyMarkup?.inline_keyboard || []).flat()
      .map((b) => ({ text: b.text, ticket: String(b.callback_data).slice(2) }))),
    button: (re) => h.buttons().filter((b) => re.test(b.text)).at(-1),
    pressLabel: (re, tg = 111) => { const b = h.button(re); if (!b) throw new Error(`no button ${re}`); return h.press(b.ticket, tg); },
    card: async (postId = 'p1', opts = {}) => bot.sendCard(await h.binding(), await services.getSocialPost('c1', postId), opts),
    writeCalls: () => services.writes.filter((w) => WRITE_NAMES.includes(w.name)),
  };
  return h;
}
