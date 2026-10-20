// Telegram bot brain: turns updates into replies and service calls. Everything external is injected through `ctx`
// (store, transport, readModels, briefing, services, access, now) so it runs against fakes in tests.
//
// Safety model: no free text is ever an approval. Every state-changing button is a single-use ticket bound to
// (post, revision, telegram user, bindingVersion); a stale/superseded/expired/foreign ticket never reaches a service.
import { checkBindingAccess } from './access.js';
import { buildSuggestionBundle, readySummary } from './suggestions.js';
import {
  MAX_POST_CHARS, buildHandoffBundle, escapeHtml, localTime, localParts, parseLocalTime, tomorrowSameTime, toMs, TERMINAL_STATUSES,
} from './handoff.js';
import { hasPlaceholder, selfReplyText, creativeFilename, resolveCreativeMedia, TELEGRAM_URL_FETCH_MAX_BYTES } from './creative.js';
import { SLOT_COVER_MS, quotePickFor, slotAlertHtml, slotCovered, suggestionFor } from './slot-alerts.js';

export const MENU_LABELS = Object.freeze({
  happening: "What's happening?", today: "Today's posts", calendar: 'Calendar', upload: 'Upload content', settings: 'Settings',
});
export const OUT_OF_DATE = 'This card is out of date.';
const TICKET_TTL_MS = 24 * 3600000;
const PENDING_TTL_MS = 30 * 60000;
const LEAD_CYCLE = [15, 30, 60, 120];
const NO_REVISION_CHECK = new Set(['show-card', 'show-section', 'settings-toggle', 'cancel-pending', 'creative']);
export const CREATIVE_LABEL = 'Copy + high-res';
const CREATIVE_ROUTE = /^\/?creative(?:@\w+)?(?:\s+(\d{4}-\d{2}-\d{2}))?$/i;
const MANUAL_REFUSALS = {
  'auto-delivery-started': 'Too late to take over: HITLOOP has already started posting this. Check its status in Today\'s posts.',
  'already-posted': 'This is already posted, so there is nothing to take over.',
  'needs-review-reconcile': 'This post needs review in HITLOOP before it can be handled. Open HITLOOP to reconcile it.',
  rejected: 'This post was skipped, so it cannot be posted.',
};
const MENU_ROUTES = new Map([
  ["what's happening?", 'happening'], ["what's happening", 'happening'], ['happening', 'happening'], ["today's posts", 'today'], ['today', 'today'],
  ['calendar', 'calendar'], ['upload content', 'upload'], ['upload', 'upload'], ['settings', 'settings'], ['menu', 'menu'], ['help', 'menu'],
]);

const LINKING_HELP = 'This is a private bot. To link it: open HITLOOP, go to Content > Telegram, tap Connect, and open the link it shows. Then confirm in HITLOOP. Until then I cannot show any data or take any action.';
const MENU_HELP = 'Use the menu buttons below. Typing text does not approve or post anything. To change a post, open it from Today\'s posts and use its buttons.';

export function createBot(ctx) {
  const { db, store, transport, readModels, briefing, services, env } = ctx;
  const accessFn = typeof ctx.access === 'function' ? ctx.access : (ctx.access?.checkBindingAccess || checkBindingAccess);
  const check = (binding) => accessFn(binding, env);
  const nowMs = () => toMs(ctx.now ? ctx.now() : Date.now());
  const byOf = (b) => `telegram:${b.telegramUserId}:${b.uid}`;
  const menuMarkup = () => ({
    keyboard: [[{ text: MENU_LABELS.happening }, { text: MENU_LABELS.today }], [{ text: MENU_LABELS.calendar }, { text: MENU_LABELS.upload }], [{ text: MENU_LABELS.settings }]],
    resize_keyboard: true, is_persistent: true,
  });
  const say = (chatId, text, opts = {}) => transport.sendMessage(chatId, text, opts);
  const sayHtml = (chatId, html, opts = {}) => say(chatId, html, { parseMode: 'HTML', disablePreview: true, ...opts });
  const answer = (id, text, showAlert = false) => transport.answerCallbackQuery(id, { text: String(text || '').slice(0, 200), showAlert });
  const tzOf = async (clientId) => (await store.getSettings(db, clientId)).timezone;

  async function mkTicket(binding, { postId = null, revision = null, action, params = {} }) {
    return store.issueTicket(db, {
      clientId: binding.clientId, postId, revision, action, params, telegramUserId: binding.telegramUserId,
      bindingVersion: binding.bindingVersion, ttlMs: TICKET_TTL_MS, now: nowMs(),
    });
  }
  const keyboard = (rows) => ({ inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: `t:${b.ticket}` }))) });
  const pack = (buttons) => {
    const rows = []; let row = [];
    for (const b of buttons) {
      if (b.text.length > 20) { if (row.length) rows.push(row); rows.push([b]); row = []; } else { row.push(b); if (row.length === 2) { rows.push(row); row = []; } }
    }
    if (row.length) rows.push(row);
    return rows;
  };
  const setPend = (binding, data) => store.setPending(db, binding.telegramUserId, { ...data, clientId: binding.clientId, ttlMs: PENDING_TTL_MS, now: nowMs() });

  // ── Media / copy ───────────────────────────────────────────────────────────
  async function sendMedia(chatId, media) {
    if (!media) return;
    try {
      if (media.type === 'video') await transport.sendVideo(chatId, media.url, {});
      else await transport.sendPhoto(chatId, media.url, {});
    } catch {
      await say(chatId, `Download media: ${media.url}`);
    }
  }
  // A NAS item with no staged file yet: its library thumbnail as a preview (the original comes on an explicit tap).
  async function sendNasPreview(chatId, packageId, clientId, caption) {
    if (!packageId || typeof services.creative?.thumbMedia !== 'function') return false;
    const thumb = await services.creative.thumbMedia(packageId, clientId).catch(() => null);
    if (!thumb?.url) return false;
    try { await transport.sendPhoto(chatId, thumb.url, { caption }); return true; } catch { return false; }
  }
  // Exact copy, separate message, NO parse mode (so it is copy-pasteable verbatim).
  const sendCopy = (chatId, post) => say(chatId, String(post.content ?? ''), { disablePreview: true });
  async function sendTakeover(chatId, post) {
    await sendMedia(chatId, buildHandoffBundle({ post, tz: 'UTC', now: nowMs() }).media);
    await sendCopy(chatId, post);
  }

  // ── Cards ──────────────────────────────────────────────────────────────────
  async function retirePostCards(binding, postId, { exceptTickets = [], exceptMessages = [] } = {}) {
    await store.supersedeTicketsForPost(db, { clientId: binding.clientId, postId, exceptTicketIds: exceptTickets });
    const notice = await store.getNotice(db, { clientId: binding.clientId, postId });
    for (const mid of notice?.messageIds || []) {
      if (exceptMessages.includes(mid)) continue;
      try { await transport.editMessageReplyMarkup(notice.chatId || binding.chatId, mid, null); } catch { /* message gone or already stripped */ }
    }
  }

  async function sendCard(binding, post, { mode = 'card', headline, withMedia = false, targetAt } = {}) {
    const chatId = binding.chatId;
    const settings = await store.getSettings(db, binding.clientId);
    const handle = await readModels.loadAccountHandle(binding.clientId).catch(() => null);
    const bundle = buildHandoffBundle({ post, handle, tz: settings.timezone, now: nowMs(), mode, targetAt, headline });
    if (withMedia && bundle.media) await sendMedia(chatId, bundle.media);
    else if (withMedia) await sendNasPreview(chatId, post.packageId, binding.clientId, `Preview. The original is on the NAS: tap ${CREATIVE_LABEL} to get it.`);
    const ticketIds = []; const buttons = [];
    for (const a of bundle.actions) {
      const ticket = await mkTicket(binding, { postId: post.id, revision: post.revision ?? 0, action: a.action, params: a.params || {} });
      ticketIds.push(ticket); buttons.push({ text: a.label, ticket });
    }
    // Read-only: sends the exact copy + the full-resolution creative. Tied to the post but not to a revision (always latest).
    const creativeTicket = await mkTicket(binding, { postId: post.id, revision: post.revision ?? 0, action: 'creative' });
    ticketIds.push(creativeTicket); buttons.push({ text: CREATIVE_LABEL, ticket: creativeTicket });
    const sent = await sayHtml(chatId, bundle.metaHtml, buttons.length ? { replyMarkup: keyboard(pack(buttons)) } : {});
    const messageIds = buttons.length && sent?.message_id != null ? [sent.message_id] : [];
    await retirePostCards(binding, post.id, { exceptTickets: ticketIds, exceptMessages: messageIds });
    await store.recordNotice(db, {
      clientId: binding.clientId, postId: post.id, revision: post.revision ?? 0, kind: mode, targetAt: bundle.targetAt,
      chatId, messageIds, sentAt: new Date(nowMs()).toISOString(), state: buttons.length ? 'live' : 'retired',
    });
    return { messageIds, ticketIds };
  }

  async function freshCard(binding, postId) {
    const post = await services.getSocialPost(binding.clientId, postId);
    if (post) await sendCard(binding, post, { headline: 'Latest version of this post' });
  }

  // ── Copy + high-res ────────────────────────────────────────────────────────
  // Copy goes out as its own plain messages (no parse mode, no extra words) so a long-press copies exactly the post.
  // `followup` = the queued send after a drive copy finished: creative only, never queues staging again.
  async function sendCreative(binding, postId, { followup = false } = {}) {
    const chatId = binding.chatId;
    const post = await services.getSocialPost(binding.clientId, postId);
    if (!post || (post.clientId && post.clientId !== binding.clientId)) return say(chatId, 'That post no longer exists.');
    if (!followup) {
      const text = String(post.content ?? '');
      if (hasPlaceholder(text)) await say(chatId, 'Placeholder still in the text');
      if (text) await say(chatId, text, { disablePreview: true });
      const reply = selfReplyText(post);
      if (hasPlaceholder(reply)) await say(chatId, 'Placeholder still in the self-reply text');
      if (reply) await say(chatId, reply, { disablePreview: true });
    }
    const res = services.creative
      ? await resolveCreativeMedia(services.creative, post, { clientId: binding.clientId, notify: { telegramUserId: binding.telegramUserId, chatId, bindingVersion: binding.bindingVersion }, stage: !followup })
      : { state: 'none' };
    if (res.notice) await say(chatId, res.notice);
    if (res.state === 'staging') {
      return say(chatId, `Copying the original from the drive (usually under a minute). I'll send it when it's ready.${res.workerOnline === false ? ' The Mac worker looks offline, so it starts when the worker is back.' : ''}`);
    }
    if (res.state === 'none') {
      if (followup) return undefined;
      return say(chatId, `No creative on this post.${res.suggestion ? ` The library has a possible match: ${res.suggestion}.` : ''}`);
    }
    const media = res.media;
    const tz = await tzOf(binding.clientId);
    const filename = creativeFilename(post, media, { dateKey: localParts(toMs(post.scheduledAt) ?? nowMs(), tz).dateKey });
    if (Number.isFinite(media.size) && media.size > TELEGRAM_URL_FETCH_MAX_BYTES) {
      return say(chatId, `Too large for Telegram to fetch (${(media.size / 1048576).toFixed(1)} MB). Download ${filename}: ${media.url}`, { disablePreview: true });
    }
    try {
      await transport.sendDocument(chatId, media.url, { caption: filename });
    } catch {
      await say(chatId, `Could not send the file. Download ${filename}: ${media.url}`, { disablePreview: true });
    }
    return undefined;
  }

  // Lists a day's posts, each with a ticketed "Copy + high-res" button. Same posts as Today's posts for today.
  async function showCreative(binding, date) {
    const tz = await tzOf(binding.clientId);
    const now = nowMs();
    let day;
    if (date && typeof readModels.loadDay === 'function') day = await readModels.loadDay(binding.clientId, date, { now });
    else {
      const cal = await readModels.loadCalendar(binding.clientId, { now });
      day = (cal?.week || []).find((d) => d.date === (date || cal.today));
    }
    const rows = (day?.posts || []).filter((r) => r?.id && !TERMINAL_STATUSES.has(r.status)).slice(0, 8);
    if (!rows.length) return say(binding.chatId, `No posts to show for ${date || 'today'}.`);
    const buttons = [];
    for (const r of rows) {
      const label = `${CREATIVE_LABEL}: ${localTime(r.scheduledAt || r.proposedAt, tz).split(', ').pop()} ${String(r.content || '').replace(/\s+/g, ' ').slice(0, 20)}`.trim();
      buttons.push({ text: label, ticket: await mkTicket(binding, { postId: r.id, revision: r.revision ?? 0, action: 'creative' }) });
    }
    return sayHtml(binding.chatId, `<b>Copy + high-res</b>\n${escapeHtml(date || day?.date || 'Today')}: pick a post.`, { replyMarkup: keyboard(buttons.map((b) => [b])) });
  }

  // ── Daily-loop suggestions ─────────────────────────────────────────────────
  async function loadSuggestions(clientId) {
    const empty = { runKey: null, suggestions: [] };
    try {
      if (typeof services.listTodaySuggestions === 'function') return (await services.listTodaySuggestions(clientId)) || empty;
      if (typeof readModels.todaySuggestions === 'function') return (await readModels.todaySuggestions(clientId, { now: nowMs() })) || empty;
    } catch { /* unavailable: behave as "none" */ }
    return empty;
  }

  async function sendSuggestionCard(binding, runKey, s) {
    const chatId = binding.chatId;
    const bundle = buildSuggestionBundle(s);
    if (bundle.media) {
      try {
        if (bundle.media.type === 'video') await transport.sendVideo(chatId, bundle.media.url, {});
        else await transport.sendPhoto(chatId, bundle.media.url, {});
      } catch { await say(chatId, `Open media: ${bundle.media.url}`); }
    } else if (s.needsStaging) {
      await sendNasPreview(chatId, s.packageId, binding.clientId, 'Preview from the NAS library.');
    }
    if (bundle.copyText) await say(chatId, bundle.copyText, { disablePreview: true }); // exact copy, no parse mode
    const params = { runKey, suggestionId: s.id, rev: s.rev };
    const buttons = [];
    if (s.needsStaging) buttons.push({ text: 'Stage from NAS', ticket: await mkTicket(binding, { action: 'suggestion', params: { op: 'stage', ...params } }) });
    else buttons.push({ text: 'Save draft', ticket: await mkTicket(binding, { action: 'suggestion', params: { op: 'save', ...params } }) });
    buttons.push({ text: 'Dismiss', ticket: await mkTicket(binding, { action: 'suggestion', params: { op: 'dismiss', ...params } }) });
    return sayHtml(chatId, bundle.metaHtml, { replyMarkup: keyboard([buttons.map((b) => b)]) });
  }

  // ── Slot alerts ────────────────────────────────────────────────────────────
  // Re-checked at send time: a post placed on the slot since it was queued (or a slot long past) drops the alert.
  async function sendSlotAlert(binding, alert) {
    const now = nowMs();
    const at = Date.parse(alert?.at);
    if (!Number.isFinite(at) || at + SLOT_COVER_MS < now) return { skipped: 'slot-passed', messageIds: [] };
    const sd = typeof readModels.loadSlotDay === 'function' ? await readModels.loadSlotDay(binding.clientId, { now }).catch(() => null) : null;
    if (sd?.day && slotCovered(sd.day, at)) return { skipped: 'slot-filled', messageIds: [] };
    const slot = { time: alert.time, track: alert.track, trackId: alert.trackId };
    const pick = alert.quote ? quotePickFor(sd?.day, slot) : null;
    let suggestion = null; let runKey = null;
    if (!alert.quote) {
      const sugg = await loadSuggestions(binding.clientId);
      suggestion = sugg.runKey ? suggestionFor(sugg.suggestions, slot) : null;
      runKey = sugg.runKey;
    }
    // A quote pick keeps the link preview on, so the original post (and its media) shows in the chat.
    const sent = await sayHtml(binding.chatId, slotAlertHtml(alert, { pick, suggestion }), pick ? { disablePreview: false } : {});
    if (suggestion) await sendSuggestionCard(binding, runKey, suggestion);
    return { messageIds: sent?.message_id != null ? [sent.message_id] : [] };
  }

  async function sendSuggestionsNotice(binding) {
    const sugg = await loadSuggestions(binding.clientId);
    const open = sugg.suggestions.filter((x) => x.state === 'open');
    if (!open.length || !sugg.runKey) return { skipped: true, messageIds: [] };
    const ticket = await mkTicket(binding, { action: 'suggestion', params: { op: 'review', runKey: sugg.runKey } });
    const sent = await sayHtml(binding.chatId, `<b>Today's suggestions</b>\n${escapeHtml(readySummary(open))}`, { replyMarkup: keyboard([[{ text: `Review suggestions (${open.length})`, ticket }]]) });
    return { messageIds: sent?.message_id != null ? [sent.message_id] : [] };
  }

  // op: review | show | save | dismiss | stage. Every write re-reads the run and compares the card's rev: a regenerate
  // or edit since the card was sent means "out of date" and nothing is written.
  async function runSuggestionAction(binding, t) {
    const { clientId, chatId } = binding;
    const { op, runKey, suggestionId, rev } = t.params || {};
    const sugg = await loadSuggestions(clientId);
    const stale = { answer: OUT_OF_DATE, followup: () => say(chatId, 'Those suggestions changed. Tap "What\'s happening?" or "Today\'s posts" for the latest.') };
    if (!runKey || sugg.runKey !== runKey) return stale;
    if (op === 'review') {
      const open = sugg.suggestions.filter((x) => x.state === 'open').slice(0, 5);
      if (!open.length) return { answer: 'No open suggestions.' };
      return { answer: `Sending ${open.length}.`, followup: async () => { for (const x of open) await sendSuggestionCard(binding, runKey, x); } };
    }
    const s = sugg.suggestions.find((x) => x.id === suggestionId);
    if (!s || s.rev !== rev) return stale;
    if (op === 'show') {
      if (s.state !== 'open') return { answer: s.state === 'dismissed' ? 'Already dismissed.' : 'Already saved.' };
      return { answer: 'Opening.', followup: () => sendSuggestionCard(binding, runKey, s) };
    }
    if (s.state === 'dismissed') return { answer: 'Already dismissed.' };
    if (op === 'dismiss') {
      if (s.state === 'saved') return { answer: 'Already saved as a draft. Skip it from the post card.' };
      await services.dismissSuggestion({ clientId, runKey, suggestionId });
      return { answer: 'Dismissed.' };
    }
    if (op === 'stage') {
      if (!s.needsStaging) return { answer: 'Already staged.' };
      const r = await services.stageSuggestion({ clientId, runKey, suggestionId });
      const msg = r?.status === 'queued' ? 'Staging requested. The Mac analyzer must be online; I will not save anything until the file is ready.'
        : r?.status === 'offline' ? 'The Mac analyzer is offline, so nothing was staged. Bring it online and tap Stage from NAS again.'
          : `Could not stage: ${String(r?.message || 'error').slice(0, 140)}`;
      return { answer: r?.status === 'queued' ? 'Staging requested.' : r?.status === 'offline' ? 'Mac analyzer offline.' : 'Could not stage.', followup: () => say(chatId, r?.status === 'queued' || r?.status === 'offline' ? msg : msg) };
    }
    if (op === 'save') {
      if (s.needsStaging) return { answer: 'Stage this from the NAS first.' }; // never a text-only save for showcase slots
      let post = null;
      if (s.state === 'saved' && s.postId) post = await services.getSocialPost(clientId, s.postId); // already saved: no second write
      else {
        const res = await services.saveSuggestion({ clientId, runKey, suggestionId });
        post = res?.post || (res?.draftId ? await services.getSocialPost(clientId, res.draftId) : null);
      }
      if (!post) return { answer: 'Saved, but the draft could not be loaded. Open HITLOOP.' };
      return { answer: 'Saved as a draft.', followup: () => sendCard(binding, post, { headline: 'Draft saved. Review it before posting.' }) };
    }
    return { answer: 'That action is not available.' };
  }

  // ── Menu surfaces ──────────────────────────────────────────────────────────
  async function showHappening(binding) {
    const tz = await tzOf(binding.clientId);
    const data = await readModels.loadBriefing(binding.clientId);
    const f = briefing.formatWhatsHappening(data, { now: nowMs(), tz });
    const secs = [['insights', 'Market insights'], ['conversations', 'Conversations to join'], ['review', 'Needs review'], ['detail', 'More detail']];
    const buttons = [];
    const sugg = data.suggestions ? { runKey: data.suggestionsRunKey, suggestions: data.suggestions } : await loadSuggestions(binding.clientId);
    const open = sugg.suggestions.filter((x) => x.state === undefined || x.state === 'open');
    if (open.length && sugg.runKey) buttons.push({ text: `Review suggestions (${open.length})`, ticket: await mkTicket(binding, { action: 'suggestion', params: { op: 'review', runKey: sugg.runKey } }) });
    for (const [section, text] of secs) buttons.push({ text, ticket: await mkTicket(binding, { action: 'show-section', params: { section } }) });
    await sayHtml(binding.chatId, f.overview, { replyMarkup: keyboard(pack(buttons)) });
  }

  async function showSection(binding, section) {
    const tz = await tzOf(binding.clientId);
    const now = nowMs();
    if (section.startsWith('cal-')) {
      const cal = await readModels.loadCalendar(binding.clientId, { now });
      if (section === 'cal-today') return sayHtml(binding.chatId, briefing.formatToday(cal, { now, tz, handle: await readModels.loadAccountHandle(binding.clientId).catch(() => null) }));
      if (section === 'cal-next') return sayHtml(binding.chatId, briefing.formatNextActions(await readModels.loadBriefing(binding.clientId), cal, { now, tz }));
      return sayHtml(binding.chatId, briefing.formatWeek(cal, { now, tz }));
    }
    const f = briefing.formatWhatsHappening(await readModels.loadBriefing(binding.clientId), { now, tz });
    return sayHtml(binding.chatId, f[section] || 'Nothing here in the latest brief.');
  }

  async function showToday(binding) {
    const tz = await tzOf(binding.clientId);
    const now = nowMs();
    const cal = await readModels.loadCalendar(binding.clientId, { now });
    const handle = await readModels.loadAccountHandle(binding.clientId).catch(() => null);
    const sugg = await loadSuggestions(binding.clientId);
    const openSugg = sugg.suggestions.filter((x) => x.state === 'open').slice(0, 6);
    const day = (cal?.week || []).find((d) => d.date === cal.today);
    const rows = (day?.posts || []).filter((r) => r?.id && !TERMINAL_STATUSES.has(r.status)).slice(0, 6);
    const buttons = [];
    for (const r of rows) {
      const label = `${localTime(r.scheduledAt || r.proposedAt, tz).split(', ').pop()} ${String(r.content || '').replace(/\s+/g, ' ').slice(0, 24)}`.trim();
      buttons.push({ text: label, ticket: await mkTicket(binding, { postId: r.id, action: 'show-card' }) });
    }
    for (const x of openSugg) buttons.push({ text: `${x.trackLabel}: ${x.text.replace(/\s+/g, ' ').slice(0, 24)}`.trim(), ticket: await mkTicket(binding, { action: 'suggestion', params: { op: 'show', runKey: sugg.runKey, suggestionId: x.id, rev: x.rev } }) });
    await sayHtml(binding.chatId, briefing.formatToday(cal, { now, tz, handle, suggestions: openSugg }), buttons.length ? { replyMarkup: keyboard(buttons.map((b) => [b])) } : {});
  }

  async function showCalendar(binding) {
    const tz = await tzOf(binding.clientId);
    const now = nowMs();
    const cal = await readModels.loadCalendar(binding.clientId, { now });
    const buttons = [
      { text: "Today's agenda", ticket: await mkTicket(binding, { action: 'show-section', params: { section: 'cal-today' } }) },
      { text: 'Next actions', ticket: await mkTicket(binding, { action: 'show-section', params: { section: 'cal-next' } }) },
    ];
    await sayHtml(binding.chatId, briefing.formatWeek(cal, { now, tz }), { replyMarkup: keyboard([buttons]) });
  }

  async function showSettings(binding) {
    const s = await store.getSettings(db, binding.clientId);
    const text = [
      '<b>Settings</b>',
      `Timezone: ${escapeHtml(s.timezone)}`,
      `Lead time: ${s.leadMinutes} min before a post`,
      `Daily briefing: ${s.briefingEnabled ? `on at ${s.briefingHour}:00` : 'off'}`,
      `Quiet hours: ${s.quietHours?.enabled ? `${s.quietHours.start}:00 to ${s.quietHours.end}:00` : 'off'}`,
      `Slot alerts: ${s.slotAlerts ? 'on (a nudge before each empty posting slot)' : 'off'}`,
      `Notifications: ${s.notificationsPaused ? 'PAUSED (publishing is not paused)' : 'on'}`,
      'Full settings (timezone, quiet hours, alerts) are in HITLOOP.',
    ].join('\n');
    const t = (key) => mkTicket(binding, { action: 'settings-toggle', params: { key } });
    const buttons = [
      { text: s.notificationsPaused ? 'Resume notifications' : 'Pause notifications', ticket: await t('notificationsPaused') },
      { text: s.briefingEnabled ? 'Briefing off' : 'Briefing on', ticket: await t('briefingEnabled') },
      { text: s.slotAlerts ? 'Slot alerts off' : 'Slot alerts on', ticket: await t('slotAlerts') },
      { text: `Lead time: ${s.leadMinutes} min (change)`, ticket: await t('leadMinutes') },
    ];
    await sayHtml(binding.chatId, text, { replyMarkup: keyboard(buttons.map((b) => [b])) });
  }

  async function applyToggle(binding, key) {
    const s = await store.getSettings(db, binding.clientId);
    let patch;
    if (key === 'notificationsPaused') patch = { notificationsPaused: !s.notificationsPaused };
    else if (key === 'briefingEnabled') patch = { briefingEnabled: !s.briefingEnabled };
    else if (key === 'slotAlerts') patch = { slotAlerts: !s.slotAlerts };
    else if (key === 'leadMinutes') patch = { leadMinutes: LEAD_CYCLE[(LEAD_CYCLE.indexOf(s.leadMinutes) + 1) % LEAD_CYCLE.length] };
    else return null;
    await store.saveSettings(db, binding.clientId, patch, { now: nowMs() });
    return patch;
  }

  // ── Scheduling / manual completion helpers ─────────────────────────────────
  async function schedule(binding, post, iso) {
    const ms = Date.parse(iso);
    const tz = await tzOf(binding.clientId);
    if (!Number.isFinite(ms) || ms <= nowMs()) return { ok: false, answer: 'That time has passed. Pick a future time.' };
    await services.approveAndSchedule(binding.clientId, post.id, { scheduledAt: new Date(ms).toISOString(), reviewedBy: byOf(binding), expectedRevision: post.revision ?? 0 });
    await store.clearPending(db, binding.telegramUserId);
    const fresh = await services.getSocialPost(binding.clientId, post.id);
    return { ok: true, answer: `Approved and scheduled for ${localTime(ms, tz)}.`, fresh };
  }

  async function recordPosted(binding, post, permalink) {
    await services.recordManualPosted(binding.clientId, post.id, { by: byOf(binding), permalink: permalink || null, expectedRevision: post.revision ?? 0 });
    await store.clearPending(db, binding.telegramUserId);
    await retirePostCards(binding, post.id);
    return 'Recorded as posted (self-reported, not verified by X).';
  }

  // Only a real revision race is "out of date"; any other refusal is shown as-is (re-sending the same card would loop).
  const isConflict = (e) => e?.code === 'revision-conflict';

  // ── Ticket actions: each returns {answer, followup?} ───────────────────────
  async function runAction(binding, t, post) {
    const { clientId } = binding; const chatId = binding.chatId; const rev = post?.revision ?? 0;
    switch (t.action) {
      case 'post-myself': {
        let row;
        try {
          row = await services.claimManualDelivery(clientId, post.id, { by: byOf(binding), expectedRevision: rev });
        } catch (e) {
          if (MANUAL_REFUSALS[e?.code]) return { answer: 'Cannot take over this post.', followup: async () => { await say(chatId, MANUAL_REFUSALS[e.code]); await freshCard(binding, post.id); } };
          throw e;
        }
        const claimed = row?.content != null ? row : await services.getSocialPost(clientId, post.id);
        return {
          answer: 'You have this post. HITLOOP will not auto-post it.',
          followup: async () => {
            await sendTakeover(chatId, claimed);
            await sendCard(binding, claimed, { headline: 'You are posting this manually' });
          },
        };
      }
      case 'send-assets':
        if (post.status !== 'manual') return { answer: 'Not in manual mode. Use Post myself first.' };
        return { answer: 'Sending assets.', followup: () => sendTakeover(chatId, post) };
      case 'posted-it':
        return {
          answer: 'Send the link to your post, or tap No link.',
          followup: async () => {
            await setPend(binding, { kind: 'permalink', postId: post.id, revision: rev, ticketId: t.id });
            const none = await mkTicket(binding, { postId: post.id, revision: rev, action: 'posted-nolink' });
            await say(chatId, 'Paste the x.com link to your post (optional), or tap No link.', { replyMarkup: keyboard([[{ text: 'No link', ticket: none }]]) });
          },
        };
      case 'posted-nolink': {
        const msg = await recordPosted(binding, post, null);
        return { answer: msg, followup: () => say(chatId, msg) };
      }
      case 'release': {
        await services.releaseManualClaim(clientId, post.id, { by: byOf(binding), expectedRevision: rev });
        return { answer: 'Released back to HITLOOP.', followup: () => freshCard(binding, post.id) };
      }
      case 'skip': {
        await services.rejectDraft(clientId, post.id, { reviewedBy: byOf(binding), expectedRevision: rev });
        return { answer: 'Skipped.', followup: async () => { await retirePostCards(binding, post.id); await say(chatId, 'Skipped. It will not be sent.'); } };
      }
      case 'revise':
        return {
          answer: 'Send the new text.',
          followup: async () => {
            await setPend(binding, { kind: 'revise', postId: post.id, revision: rev, ticketId: t.id });
            const cancel = await mkTicket(binding, { action: 'cancel-pending' });
            await say(chatId, `Send the new copy as your next message (max ${MAX_POST_CHARS} characters).`, { replyMarkup: keyboard([[{ text: 'Cancel', ticket: cancel }]]) });
          },
        };
      case 'cancel-pending':
        await store.clearPending(db, binding.telegramUserId);
        return { answer: 'Cancelled.' };
      case 'approve-schedule': {
        const r = await schedule(binding, post, t.params?.scheduledAt);
        if (!r.ok) return { answer: r.answer, followup: () => freshCard(binding, post.id) };
        return { answer: r.answer, followup: async () => { await say(chatId, r.answer); if (r.fresh) await sendCard(binding, r.fresh, { mode: 'reminder', headline: 'Approved and scheduled' }); } };
      }
      case 'reschedule-at': {
        const r = await schedule(binding, post, t.params?.scheduledAt);
        if (!r.ok) return { answer: r.answer };
        return { answer: r.answer, followup: async () => { await say(chatId, r.answer); if (r.fresh) await sendCard(binding, r.fresh, { mode: 'reminder', headline: 'Rescheduled' }); } };
      }
      case 'approve-post-now': {
        const res = await services.approveAndPostNow(clientId, post.id, { reviewedBy: byOf(binding), expectedRevision: rev });
        const p = res?.post || {};
        const reason = p.heldReason || p.error || res?.reason || 'a pre-publish check';
        const text = ({
          posted: 'Posted to X.', held: `Held, not posted: ${reason}`, failed: `Failed: ${reason}`,
          'already-claimed': 'Already being handled elsewhere. Not posted a second time.',
        })[res?.outcome] || `Not confirmed: ${res?.outcome || 'unknown outcome'}. Check HITLOOP.`;
        return {
          answer: text,
          followup: async () => {
            await say(chatId, text);
            if (res?.outcome === 'posted') await retirePostCards(binding, post.id);
            else await freshCard(binding, post.id);
          },
        };
      }
      case 'reschedule': {
        const tz = await tzOf(clientId);
        const now = nowMs();
        const picks = [{ text: '+1 hour', ms: Math.ceil((now + 3600000) / 60000) * 60000 }];
        const base = toMs(post.scheduledAt);
        picks.push({ text: 'Tomorrow, same time', ms: tomorrowSameTime(base && base > now ? base : now, tz) });
        try {
          const cal = await readModels.loadCalendar(clientId, { now });
          const slot = (cal?.week || []).flatMap((d) => d.posts || []).find((r) => r.id === post.id && r.proposed && toMs(r.proposedAt) > now);
          if (slot) picks.push({ text: 'Next open slot', ms: toMs(slot.proposedAt) });
        } catch { /* calendar unavailable: quick picks only */ }
        return {
          answer: 'Pick a time or type one.',
          followup: async () => {
            await setPend(binding, { kind: 'reschedule', postId: post.id, revision: rev, ticketId: t.id });
            const buttons = [];
            for (const p of picks) buttons.push({ text: `${p.text} (${localTime(p.ms, tz)})`, ticket: await mkTicket(binding, { postId: post.id, revision: rev, action: 'reschedule-at', params: { scheduledAt: new Date(p.ms).toISOString() } }) });
            buttons.push({ text: 'Cancel', ticket: await mkTicket(binding, { action: 'cancel-pending' }) });
            await say(chatId, `Pick a time, or type one in ${tz}: 15:30 (today) or 2026-10-14 15:30.`, { replyMarkup: keyboard(buttons.map((b) => [b])) });
          },
        };
      }
      case 'creative':
        return { answer: 'Sending.', followup: () => sendCreative(binding, post.id) };
      case 'show-card':
        return { answer: 'Opening.', followup: () => sendCard(binding, post, { headline: 'Post' }) };
      case 'show-section':
        return { answer: 'Loading.', followup: () => showSection(binding, String(t.params?.section || 'detail')) };
      case 'settings-toggle': {
        const patch = await applyToggle(binding, t.params?.key);
        return patch ? { answer: 'Updated.', followup: () => showSettings(binding) } : { answer: 'Unknown setting.' };
      }
      case 'suggestion':
        return runSuggestionAction(binding, t);
      case 'intake': {
        if (!ctx.intake?.handleCallback) return { answer: 'Uploads are not available.' };
        const r = await ctx.intake.handleCallback(binding, String(t.params?.op || ''), String(t.params?.intakeId || ''));
        return { answer: r?.ok === false ? 'That upload changed — check the latest message.' : 'Done.' };
      }
      default:
        return { answer: 'That action is not available.' };
    }
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────
  async function handleCallback(cq) {
    const from = cq.from; const cqId = cq.id;
    const binding = await store.getBinding(db, from.id);
    if (!check(binding).ok) return answer(cqId, 'Not linked. Link this chat in HITLOOP first.', true);
    const m = String(cq.data || '').match(/^t:([A-Za-z0-9_-]{4,40})$/);
    if (!m) return answer(cqId, 'Unknown button.');
    const ticketId = m[1];
    const claim = await store.claimTicket(db, ticketId, { telegramUserId: from.id, now: nowMs() });
    const owned = (tk) => tk && String(tk.telegramUserId) === String(from.id) && tk.clientId === binding.clientId && tk.bindingVersion === binding.bindingVersion;
    switch (claim.state) {
      case 'replay': return answer(cqId, claim.result?.answer || 'Already done.');
      case 'in-progress': return answer(cqId, 'Still working on that.');
      case 'forbidden': return answer(cqId, 'This button is not for you.', true);
      case 'expired': case 'superseded': case 'unknown': {
        await answer(cqId, OUT_OF_DATE);
        const tk = claim.ticket;
        if (tk?.postId && owned(tk)) await freshCard(binding, tk.postId);
        return undefined;
      }
      case 'claimed': break;
      default: return answer(cqId, 'Unknown button.');
    }
    const t = { ...claim.ticket, id: ticketId };
    const settle = (res) => store.settleTicket(db, ticketId, res, { now: nowMs() });
    const stale = async (post) => {
      await settle({ ok: false, stale: true, answer: OUT_OF_DATE });
      await answer(cqId, OUT_OF_DATE);
      if (post && owned(t)) await freshCard(binding, post.id);
    };
    if (!owned(t)) { await settle({ ok: false, stale: true, answer: OUT_OF_DATE }); return answer(cqId, OUT_OF_DATE); }
    let post = null;
    if (t.postId) {
      post = await services.getSocialPost(binding.clientId, t.postId);
      if (!post) { await settle({ ok: false, answer: 'That post no longer exists.' }); return answer(cqId, 'That post no longer exists.'); }
      if (!NO_REVISION_CHECK.has(t.action) && (post.revision ?? 0) !== (t.revision ?? 0)) return stale(post);
    }
    let out;
    try {
      out = await runAction(binding, t, post);
    } catch (e) {
      if (isConflict(e)) return stale(post);
      out = { answer: `Could not do that: ${String(e?.message || 'error').slice(0, 140)}` };
    }
    await settle({ ok: true, answer: out.answer });
    // A slow action (post-now publishes inline) can outlive the callback query; the result still stands.
    await answer(cqId, out.answer).catch(() => {});
    if (out.followup) {
      try { await out.followup(); } catch { await say(binding.chatId, 'That worked, but I could not send the follow-up message. Open Today\'s posts to continue.').catch(() => {}); }
    }
    return undefined;
  }

  // ── Messages ───────────────────────────────────────────────────────────────
  async function handlePending(binding, pending, text) {
    const chatId = binding.chatId;
    if (pending.clientId !== binding.clientId) { await store.clearPending(db, binding.telegramUserId); return say(chatId, MENU_HELP, { replyMarkup: menuMarkup() }); }
    const post = await services.getSocialPost(binding.clientId, pending.postId);
    if (!post || (post.revision ?? 0) !== (pending.revision ?? 0)) {
      await store.clearPending(db, binding.telegramUserId);
      await say(chatId, `${OUT_OF_DATE} The post changed, so I did not apply that.`);
      return post ? sendCard(binding, post, { headline: 'Latest version of this post' }) : undefined;
    }
    if (pending.kind === 'revise') {
      if (!text) return say(chatId, 'Send the new copy as text.');
      if (text.length > MAX_POST_CHARS) return say(chatId, `That is ${text.length} characters; the limit is ${MAX_POST_CHARS}. Send a shorter version.`);
      try {
        await services.updateSocialPost(binding.clientId, post.id, { content: text }, { expectedRevision: post.revision ?? 0 });
      } catch (e) {
        if (isConflict(e)) { await store.clearPending(db, binding.telegramUserId); await say(chatId, OUT_OF_DATE); return freshCard(binding, post.id); }
        return say(chatId, `Could not update: ${String(e?.message || 'error').slice(0, 200)}. Send different copy or tap Cancel.`);
      }
      await store.clearPending(db, binding.telegramUserId);
      const fresh = await services.getSocialPost(binding.clientId, post.id);
      return sendCard(binding, fresh, { headline: 'Copy updated. Review it again before approving.' });
    }
    if (pending.kind === 'reschedule') {
      const tz = await tzOf(binding.clientId);
      const parsed = parseLocalTime(text, tz, nowMs());
      if (!parsed.ok) return say(chatId, parsed.error);
      try {
        const r = await schedule(binding, post, parsed.iso);
        await say(chatId, r.answer);
        if (r.fresh) await sendCard(binding, r.fresh, { mode: 'reminder', headline: 'Rescheduled' });
      } catch (e) {
        if (isConflict(e)) { await store.clearPending(db, binding.telegramUserId); await say(chatId, OUT_OF_DATE); return freshCard(binding, post.id); }
        return say(chatId, `Could not reschedule: ${String(e?.message || 'error').slice(0, 200)}`);
      }
      return undefined;
    }
    if (pending.kind === 'permalink') {
      if (!/^https?:\/\/(www\.)?(x|twitter)\.com\/[\w]+\/status\/\d+/i.test(text)) return say(chatId, 'That does not look like an X post link (x.com/<name>/status/<id>). Send the link, or tap No link.');
      try { return say(chatId, await recordPosted(binding, post, text.split(/\s+/)[0])); } catch (e) {
        if (isConflict(e)) { await store.clearPending(db, binding.telegramUserId); await say(chatId, OUT_OF_DATE); return freshCard(binding, post.id); }
        return say(chatId, `Could not record: ${String(e?.message || 'error').slice(0, 200)}`);
      }
    }
    await store.clearPending(db, binding.telegramUserId);
    return say(chatId, MENU_HELP, { replyMarkup: menuMarkup() });
  }

  async function handleStart(msg, code) {
    const chatId = msg.chat.id; const from = msg.from;
    if (!code) {
      const binding = await store.getBinding(db, from.id);
      if (check(binding).ok) return say(chatId, 'Linked. Pick something from the menu.', { replyMarkup: menuMarkup() });
      return say(chatId, LINKING_HELP);
    }
    const r = await store.attachTelegramToChallenge(db, { code, telegramUserId: from.id, chatId, telegramUsername: from.username || null, firstName: from.first_name || null, now: nowMs() });
    if (!r?.ok) {
      const why = { expired: 'That link code has expired.', used: 'That link code was already used.' }[r?.reason] || 'That link code is not valid.';
      return say(chatId, `${why} Generate a new one in HITLOOP (Content > Telegram).`);
    }
    return say(chatId, 'Almost there. Confirm in HITLOOP to finish linking. Nothing is shared until you confirm there.');
  }

  async function handleMessage(msg) {
    if (msg.chat?.type && msg.chat.type !== 'private') return undefined;
    if (!msg.from || !msg.chat) return undefined;
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/);
    if (start) return handleStart(msg, start[1]);
    const binding = await store.getBinding(db, msg.from.id);
    if (!check(binding).ok || String(binding.chatId) !== String(msg.chat.id)) return say(msg.chat.id, LINKING_HELP);
    const chatId = binding.chatId;
    const key = MENU_ROUTES.get(text.toLowerCase().replace(/^\//, '').replace(/@\w+$/, ''));
    const guard = async (fn) => { try { await fn(); } catch { await say(chatId, 'Could not load that right now. Try again, or open HITLOOP.'); } };
    const creativeCmd = text.match(CREATIVE_ROUTE);
    if (creativeCmd) {
      await store.clearPending(db, binding.telegramUserId);
      return guard(() => showCreative(binding, creativeCmd[1] || null));
    }
    if (key === 'upload') {
      if (ctx.intake?.handleMessage) return say(chatId, 'Send photos or videos here (several at once is fine), with a caption saying what they show. They go to your HITLOOP library only: nothing is analysed, remixed or posted.');
      return say(chatId, 'Uploading content from Telegram is coming next. For now, add content in HITLOOP.');
    }
    if (key) {
      await store.clearPending(db, binding.telegramUserId);
      if (key === 'happening') return guard(() => showHappening(binding));
      if (key === 'today') return guard(() => showToday(binding));
      if (key === 'calendar') return guard(() => showCalendar(binding));
      if (key === 'settings') return guard(() => showSettings(binding));
      return say(chatId, MENU_HELP, { replyMarkup: menuMarkup() });
    }
    if (!text) {
      if (ctx.intake?.handleMessage && await ctx.intake.handleMessage({ msg, binding, chatId, ctx })) return undefined;
      return say(chatId, ctx.intake ? 'I can save photos and videos. Other files aren\'t supported.' : 'Uploading content from Telegram is coming next. For now, add content in HITLOOP.');
    }
    const pending = await store.getPending(db, binding.telegramUserId);
    if (pending) return handlePending(binding, pending, text);
    // A plain reply may answer an upload's "what should people know?" question; it is stored as context only.
    if (ctx.intake?.handleMessage && await ctx.intake.handleMessage({ msg, binding, chatId, ctx })) return undefined;
    return say(chatId, MENU_HELP, { replyMarkup: menuMarkup() });
  }

  async function handleUpdate(update) {
    if (update?.callback_query) return handleCallback(update.callback_query);
    if (update?.message) return handleMessage(update.message);
    return undefined;
  }

  return { handleUpdate, handleMessage, handleCallback, sendCard, sendCreative, sendSuggestionsNotice, sendSlotAlert, showHappening, sendMedia, sendTakeover, retirePostCards };
}
