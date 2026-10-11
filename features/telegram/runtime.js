// Production wiring for the Telegram command center: real Firestore, the Bot API transport, HITLOOP's shared
// readers (brief intel, social queue, month calendar) and the shared post lifecycle. Every module under
// features/telegram/ takes these as injected deps, so tests never reach this file.
//
// Nothing here creates a second content engine or publisher: all post state changes go through
// features/social-posting/twitter-service.js, the same functions the web calendar uses.

import { createRequire } from 'node:module';
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
  getSocialPost, readSocialQueue, updateSocialPost, approveAndSchedule, rejectDraft,
  claimManualDelivery, recordManualPosted, releaseManualClaim, approveAndPostNow,
} from '../social-posting/twitter-service.js';
import { buildMonthCalendar } from '../x-content-inventory/month-calendar.js';
import { resolveCalendarEngineConfig } from '../content-context/load-content-context.js';
import { createFirestorePlanStore } from '../x-strategy/plan-store.js';
import { upsertPackage } from '../x-content-inventory/store.js';

const require = createRequire(import.meta.url);
const fb = require('../../api/_lib/firebase-admin.cjs');
const briefIntel = require('../intelligence/_brief-intel.js');
const digestConfig = require('../intelligence/_digest-config.js');

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

  const services = {
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
