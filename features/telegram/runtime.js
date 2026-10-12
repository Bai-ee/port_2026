// Production wiring for the Telegram command center: real Firestore, the Bot API transport, HITLOOP's shared
// readers (brief intel, social queue, month calendar) and the shared post lifecycle. Every module under
// features/telegram/ takes these as injected deps, so tests never reach this file.
//
// Nothing here creates a second content engine or publisher: all post state changes go through
// features/social-posting/twitter-service.js, the same functions the web calendar uses.

import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import * as store from './store.js';
import * as briefing from './briefing.js';
import { createBotTransport } from './transport.js';
import { createReadModels } from './read-models.js';
import { createBot } from './bot.js';
import { runDispatch } from './scheduler.js';
import { checkBindingAccess } from './access.js';
import { createIntake } from './intake.js';
import { createIntakeStorage } from './intake-storage.js';
import { signContinuationToken, continuationUrlFor, UPLOAD_SECRET_ENV } from './continuation.js';
import {
  createDraftPostOnce, getSocialPost, readSocialQueue, updateSocialPost, approveAndSchedule, rejectDraft,
  claimManualDelivery, recordManualPosted, releaseManualClaim, approveAndPostNow,
} from '../social-posting/twitter-service.js';
import { buildMonthCalendar } from '../x-content-inventory/month-calendar.js';
import { resolveCalendarEngineConfig } from '../content-context/load-content-context.js';
import { createFirestorePlanStore } from '../x-strategy/plan-store.js';
import { upsertPackage, getPackage } from '../x-content-inventory/store.js';
import { createFirestoreRunStore } from '../x-content-inventory/daily-loop/run-store.js';
import { saveSuggestionDraft, dismissSuggestion as dismissDailySuggestion, overlayStagedMedia } from '../x-content-inventory/daily-loop/review.js';
import { handleNasAction } from '../x-content-inventory/nas.js';
import { tokenUrlFor } from '../x-content-inventory/thumbs.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const briefIntel = require('../intelligence/_brief-intel.js');
const digestConfig = require('../intelligence/_digest-config.js');

const EV_LONG_SIGN_MS = 6.9 * 24 * 60 * 60 * 1000; // v4 signed URLs cap at 7 days

// "<clientId>__<localDate>__<channel>__v<version>" (daily-loop runDocId) -> run-store key. Null when malformed.
function parseRunKey(runKey) {
  const m = /^(.+)__(\d{4}-\d{2}-\d{2})__([a-z]+)__v(\d+)$/.exec(String(runKey || ''));
  return m ? { clientId: m[1], localDate: m[2], channel: m[3], version: Number(m[4]) } : null;
}

// Same signers the web daily-run Save uses; the draft stores the object ref and publish re-signs.
function mediaSigners() {
  return {
    async signEvLong(path) {
      try {
        void fb.adminDb; // initialize the Hitloop app BEFORE the named EditVideos bridge app
        const bridge = require('../../api/_lib/editvideos-bridge.cjs');
        const [url] = await bridge.bridgeBucket().file(path).getSignedUrl({ version: 'v4', action: 'read', expires: Date.now() + EV_LONG_SIGN_MS });
        return url;
      } catch { return null; }
    },
    hitloopUrl: (path) => tokenUrlFor(fb.adminStorage.bucket(), path),
  };
}

// Resolve a suggestion's storage-path media ref to a sendable URL (read side only; saves keep the raw object ref).
async function withMediaUrls(rawRun) {
  const run = await overlayStagedMedia(rawRun, getPackage); // a card staged since the run was written shows its media + Save
  if (!run?.suggestions?.length) return run;
  const signers = mediaSigners();
  const suggestions = await Promise.all(run.suggestions.map(async (s) => {
    const m = s?.package?.media;
    if (!m?.ref || m.url || typeof m.ref !== 'string') return s;
    const ev = /^ev:(.+)$/.exec(m.ref)?.[1];
    const path = ev || (m.ref.startsWith('publish-staging/') ? m.ref : null);
    if (!path) return s;
    const url = await (ev ? signers.signEvLong(path) : signers.hitloopUrl(path)).catch(() => null);
    return url ? { ...s, package: { ...s.package, media: { ...m, url } } } : s;
  }));
  return { ...run, suggestions };
}

const PUBLIC_BASE_URL = () => String(process.env.TELEGRAM_PUBLIC_BASE_URL || 'https://hitloop.agency').replace(/\/+$/, '');

// Same engine config the web month calendar uses (quote-targets route handleMonthCalendar).
async function readEngineConfig(clientId) {
  let overrides = null;
  try {
    const snap = await fb.adminDb.collection('content_system_config').doc('x').get();
    overrides = snap.exists ? snap.data() : null;
  } catch {
    // Advisory: defaults keep the calendar usable.
  }
  const planDoc = await createFirestorePlanStore(fb.adminDb).get(clientId).catch(() => null);
  return resolveCalendarEngineConfig({ planDoc, legacyOverrides: overrides });
}

export function createTelegramRuntime({ env = process.env, db = fb.adminDb, transport = null } = {}) {
  const tx = transport || (env.TELEGRAM_BOT_TOKEN ? createBotTransport({ token: env.TELEGRAM_BOT_TOKEN }) : null);
  if (!tx) throw Object.assign(new Error('Telegram bot is not configured.'), { status: 503, code: 'telegram-not-configured' });
  const now = () => Date.now();

  const runStore = createFirestoreRunStore(db);
  const keyFor = (clientId, runKey) => {
    const key = parseRunKey(runKey);
    if (!key || key.clientId !== clientId) throw Object.assign(new Error('Suggestion run not found.'), { status: 404 });
    return key;
  };
  const nasDeps = {
    db, fieldValue: fb.FieldValue, getPackage, upsertPackage: (pkg) => upsertPackage(pkg, { returnPackages: false }),
    now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), randomId: () => crypto.randomUUID(),
  };

  const services = {
    // Suggestions (daily loop). All writes reuse the web Save/Dismiss functions, so Telegram and the dashboard cannot diverge.
    async saveSuggestion({ clientId, runKey, suggestionId }) {
      const key = keyFor(clientId, runKey);
      const postExists = async (id) => (await db.collection('social_posts').doc(String(id)).get()).exists;
      const saved = await saveSuggestionDraft(
        { store: runStore, getPackage, createDraftPostOnce, postExists, ...mediaSigners() },
        { key, suggestionId },
      );
      return { draftId: saved.postId, post: await getSocialPost(clientId, saved.postId) };
    },
    async dismissSuggestion({ clientId, runKey, suggestionId }) {
      return dismissDailySuggestion({ store: runStore }, { key: keyFor(clientId, runKey), suggestionId });
    },
    // Owner tap = approval (nas-stage marks the item approved and queues STAGE_FOR_PUBLISH). Never called automatically.
    async stageSuggestion({ clientId, runKey, suggestionId }) {
      const key = keyFor(clientId, runKey);
      const run = await runStore.read(key);
      const s = (run?.suggestions || []).find((x) => x.id === suggestionId);
      const packageId = s?.package?.id;
      if (!packageId) return { ok: false, status: 'error', message: 'This suggestion has no library item to stage.' };
      try {
        const online = (await handleNasAction(nasDeps, 'nas-status', {}, null)).online === true;
        await handleNasAction(nasDeps, 'nas-stage', { id: packageId }, { email: 'telegram-owner' });
        return online
          ? { ok: true, status: 'queued', message: 'Staging started. Check back in a few minutes.' }
          : { ok: true, status: 'offline', message: 'Queued, but the Mac analyzer is offline. It stages when the analyzer is back online.' };
      } catch (err) {
        return { ok: false, status: 'error', message: String(err?.message || err).slice(0, 200) };
      }
    },
    getSocialPost, updateSocialPost, approveAndSchedule, rejectDraft,
    claimManualDelivery, recordManualPosted, releaseManualClaim, approveAndPostNow,
  };
  const readModels = createReadModels({
    db,
    getBriefForClient: (clientId) => briefIntel.getBriefForClient(clientId),
    readSocialQueue,
    buildMonthCalendar,
    readEngineConfig,
    getDigestConfig: (clientId) => digestConfig.getDigestConfig(clientId),
    getSocialPost,
    runStore: { read: async (key) => withMediaUrls(await runStore.read(key)) },
    now,
  });

  // Intake buttons become tickets like every other button, so the same binding/expiry/dedup rules apply.
  const intakeSend = async (chatId, text, opts = {}) => {
    const actions = Array.isArray(opts.actions) ? opts.actions : [];
    if (!actions.length) return tx.sendMessage(chatId, text);
    const binding = (await store.listActiveBindings(db)).find((b) => String(b.chatId) === String(chatId));
    if (!binding || !checkBindingAccess(binding, env).ok) return tx.sendMessage(chatId, text);
    const rows = [];
    for (const a of actions) {
      const ticket = await store.issueTicket(db, {
        clientId: binding.clientId, postId: null, revision: null, action: 'intake',
        params: { op: a.action, intakeId: a.intakeId }, telegramUserId: binding.telegramUserId,
        bindingVersion: binding.bindingVersion, ttlMs: 24 * 3_600_000, now: now(),
      });
      rows.push([{ text: a.label, callback_data: `t:${ticket}` }]);
    }
    return tx.sendMessage(chatId, text, { replyMarkup: { inline_keyboard: rows } });
  };
  const uploadSecret = env[UPLOAD_SECRET_ENV] || null;
  const intake = createIntake({
    db,
    transport: tx,
    // Lazy bucket: resolved only when a file is actually saved.
    storage: createIntakeStorage({ bucket: { file: (path) => fb.adminStorage.bucket().file(path) }, db, registerAsset: (pkg) => upsertPackage(pkg, { returnPackages: false }) }),
    send: intakeSend,
    now,
    canProcess: async (it) => {
      const b = await store.getBinding(db, it.telegramUserId);
      return Boolean(b) && b.clientId === it.clientId && checkBindingAccess(b, env).ok;
    },
    // One token per oversize file, scoped to the intake's client and Telegram user. No secret = no link.
    continuationUrl: (intakeId, item, owner) => {
      if (!uploadSecret || !item?.fileUniqueId || !owner?.clientId) return null;
      const token = signContinuationToken({ intakeId, fileUniqueId: item.fileUniqueId, clientId: owner.clientId, telegramUserId: owner.telegramUserId }, uploadSecret);
      return token ? continuationUrlFor(PUBLIC_BASE_URL(), token) : null;
    },
  });

  const ctx = {
    db, store, transport: tx, readModels, briefing, services, env, now,
    access: (binding) => checkBindingAccess(binding, env),
    botUsername: String(env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    intake: {
      handleMessage: ({ msg, binding }) => intake.handleMessage(binding, msg),
      handleCallback: (binding, op, intakeId) => intake.handleCallback(binding, op, intakeId),
    },
  };
  const bot = createBot(ctx);
  ctx.bot = bot;

  async function processUpdate(id) {
    const claimed = await store.claimUpdate(db, id, { workerId: 'telegram-webhook', now: now() });
    if (!claimed) return { skipped: true };
    try {
      await bot.handleUpdate(claimed.payload);
      await store.completeUpdate(db, claimed.id ?? id, { now: now() });
      return { ok: true };
    } catch (error) {
      await store.failUpdate(db, claimed.id ?? id, { error: String(error?.message || error).slice(0, 300), now: now() });
      throw error;
    }
  }

  async function dispatch({ now: at = now() } = {}) {
    const result = await runDispatch(ctx, { now: at });
    const intakes = await intake.finalizeDue({ now: at }).catch((error) => ({ error: String(error?.message || error).slice(0, 200) }));
    return { ...result, intakes };
  }

  return { processUpdate, dispatch, bot, ctx };
}

let cached = null;
export function getTelegramRuntime() {
  if (!cached) cached = createTelegramRuntime();
  return cached;
}
