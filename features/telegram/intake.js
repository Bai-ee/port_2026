// intake.js — Telegram media intake (capture) state machine.
//
// Deterministic: no LLM, no posting, no remix/analysis. A shared photo/video lands in
// the SAME library the web uses (x_content_packages, via intake-storage) with
// provenance and rights NOT cleared (possession != clearance).
//
// Sessions: telegram_intakes/{id}. Single message => id from chat+message; album =>
// id from user+chat+media_group_id. Ids are deterministic, so redelivery and retries
// reuse the same intake. Item states: received -> downloading -> stored | rejected |
// failed(retryable) | needs-web-upload. Intake states: collecting -> review ->
// registered | split | needs-web-upload | rejected | failed.
//
// Captions are stored as DATA (`context.caption`), never interpreted as instructions.
// Never log or store a Telegram file URL (it embeds the bot token): only error codes
// are persisted for failures.

import { createHash } from 'node:crypto';
import { TELEGRAM_GET_FILE_LIMIT } from './intake-storage.js';

export const COLLECTION = 'telegram_intakes';
export const QUIET_MS = 3000;
export const REVIEW_MS = 10 * 60 * 1000;
export const ADD_MORE_MS = 60 * 1000;
export const CONTEXT_TTL_MS = 60 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 30 * 1000;
export const CONTEXT_QUESTION = 'What should people know about this?';
const CONTEXT_MAX = 1000;

const sha = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, n);
const strip = (o) => JSON.parse(JSON.stringify(o));

/** Pull the media payload out of a Telegram message. null = no media; {unsupported} = media we don't take. */
export function extractMedia(message) {
  if (!message) return null;
  if (Array.isArray(message.photo) && message.photo.length) {
    const p = [...message.photo].sort((a, b) => (a.file_size || a.width * a.height || 0) - (b.file_size || b.width * b.height || 0)).pop();
    return { kind: 'image', fileId: p.file_id, fileUniqueId: p.file_unique_id, fileSize: p.file_size ?? null };
  }
  if (message.video) {
    const v = message.video;
    return { kind: 'video', fileId: v.file_id, fileUniqueId: v.file_unique_id, fileSize: v.file_size ?? null };
  }
  if (message.document) {
    const d = message.document;
    const mime = String(d.mime_type || '');
    if (mime.startsWith('image/') || mime.startsWith('video/')) {
      return { kind: mime.startsWith('video/') ? 'video' : 'image', fileId: d.file_id, fileUniqueId: d.file_unique_id, fileSize: d.file_size ?? null };
    }
    return { unsupported: true };
  }
  if (message.animation || message.audio || message.voice || message.video_note || message.sticker) return { unsupported: true };
  return null;
}

const noun = (items) => {
  const kinds = new Set(items.map((i) => i.kind));
  const n = items.length;
  if (kinds.size === 1 && kinds.has('video')) return n === 1 ? 'video' : 'videos';
  if (kinds.size === 1 && kinds.has('image')) return n === 1 ? 'photo' : 'photos';
  return n === 1 ? 'item' : 'items';
};

const REASON_TEXT = {
  'unsupported-type': "that file isn't a supported photo or video (JPEG, PNG, WebP, HEIC, MP4, MOV)",
  'too-large': 'that file is too large',
  'empty-file': 'that file was empty',
};

/**
 * @param {{
 *   db: object,
 *   transport: { getFileInfo(fileId):Promise<{fileSize?:number,filePath:string}>, downloadFile(filePath,{maxBytes}):Promise<Buffer> },
 *   storage: ReturnType<import('./intake-storage.js').createIntakeStorage>,
 *   send: (chatId, text, opts?: {actions?: Array<{action:string,label:string,intakeId:string}>}) => Promise<any>,
 *   now: () => number|Date,
 *   continuationUrl: (intakeId:string) => string,
 * }} ctx
 */
export function createIntake(ctx) {
  const { db, transport, storage, send, continuationUrl } = ctx;
  const nowMs = (v = ctx.now()) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v));
  const col = () => db.collection(COLLECTION);

  async function load(id) {
    const snap = await col().doc(id).get();
    return snap.exists ? strip(snap.data()) : null;
  }
  const save = (intake) => col().doc(intake.id).set(strip(intake));
  async function say(chatId, text, opts) {
    try { await send(chatId, text, opts); } catch { /* delivery is the outbox's problem; intake state is already durable */ }
  }

  function newIntake(binding, message, media) {
    const chatId = message.chat?.id ?? binding.chatId;
    const group = message.media_group_id ? String(message.media_group_id) : null;
    const id = `ti_${group ? sha(`${binding.telegramUserId}:${chatId}:g${group}`) : sha(`${chatId}:m${message.message_id}`)}`;
    return {
      id, clientId: binding.clientId, uid: binding.uid ?? null, telegramUserId: binding.telegramUserId, chatId,
      mediaGroupId: group, mode: group ? 'album' : 'single', status: 'collecting',
      items: [], messageIds: [], context: {}, createdAt: nowMs(), updatedAt: nowMs(),
    };
  }

  function addItem(intake, message, media) {
    intake.items.push({
      fileUniqueId: media.fileUniqueId, fileId: media.fileId, kind: media.kind, fileSize: media.fileSize,
      messageId: message.message_id, status: 'received', attempts: 0, retryable: false,
    });
    if (message.message_id != null && !intake.messageIds.includes(message.message_id)) intake.messageIds.push(message.message_id);
    const caption = clip(message.caption, CONTEXT_MAX);
    if (caption && !intake.context.caption) intake.context.caption = caption;
  }

  // ---- item processing -------------------------------------------------------

  async function processItem(intake, item, index) {
    const tooBig = (n) => Number.isFinite(n) && n > TELEGRAM_GET_FILE_LIMIT;
    if (tooBig(item.fileSize)) { item.status = 'needs-web-upload'; return; } // never download
    item.status = 'downloading';
    item.attempts += 1;
    await save(intake);
    let buffer;
    try {
      const info = await transport.getFileInfo(item.fileId);
      if (tooBig(info?.fileSize)) { item.status = 'needs-web-upload'; return; }
      buffer = await transport.downloadFile(info.filePath, { maxBytes: TELEGRAM_GET_FILE_LIMIT });
    } catch (err) {
      // Persist a code only: err.message may embed the token-bearing file URL.
      item.status = 'failed';
      item.error = clip(err?.code || err?.status || 'download-failed', 60);
      item.retryable = item.attempts < MAX_ATTEMPTS;
      return;
    }
    const res = await storage.store({ clientId: intake.clientId, intakeId: intake.id, index, fileUniqueId: item.fileUniqueId, buffer });
    if (!res.ok) { item.status = 'rejected'; item.reason = res.reason; item.retryable = false; return; }
    Object.assign(item, { status: 'stored', storagePath: res.storagePath, contentType: res.contentType, kind: res.kind, bytes: res.bytes, sha256: res.sha256, retryable: false });
    delete item.error;
  }

  async function processItems(intake) {
    for (let i = 0; i < intake.items.length; i += 1) {
      const it = intake.items[i];
      if (it.status === 'received' || it.status === 'downloading' || (it.status === 'failed' && it.retryable)) {
        await processItem(intake, it, i);
      }
    }
  }

  const itemsBy = (intake, s) => intake.items.filter((i) => i.status === s);

  async function register(intake) {
    const { packageId } = await storage.register(intake);
    intake.packageId = packageId;
    intake.status = 'registered';
    intake.registeredAt = nowMs();
    return packageId;
  }

  async function notifyOversize(intake) {
    if (!itemsBy(intake, 'needs-web-upload').length || intake.continuationSent) return;
    intake.continuationSent = true;
    // One scoped link per oversize file: each continuation token names exactly one item.
    const links = itemsBy(intake, 'needs-web-upload').map((it) => continuationUrl(intake.id, it, intake)).filter(Boolean);
    if (!links.length) {
      await say(intake.chatId, 'That file is over Telegram\'s 20 MB bot limit, so I didn\'t download it. Add it in HITLOOP instead (large-file links are not set up yet).');
      return;
    }
    const lead = links.length === 1 ? 'That file is' : `${links.length} files are`;
    await say(intake.chatId, `${lead} over Telegram's 20 MB bot limit, so I didn't download ${links.length === 1 ? 'it' : 'them'}. Upload here instead (link works for 30 minutes):\n${links.join('\n')}`);
  }

  function rejectionLine(intake) {
    const rej = itemsBy(intake, 'rejected');
    if (!rej.length) return '';
    return ` Skipped ${rej.length}: ${REASON_TEXT[rej[0].reason] || 'not accepted'}.`;
  }

  function savedText(intake, prefix) {
    const stored = itemsBy(intake, 'stored');
    return `${prefix || 'Saved'} ${stored.length} ${noun(stored)} to your library. Rights aren't cleared, so nothing is posted from this until you approve it.${rejectionLine(intake)}`;
  }

  /** Decide what happens after items have been attempted. mode: 'single' | 'review' | 'late' */
  async function settle(intake, mode) {
    intake.updatedAt = nowMs();
    const pending = intake.items.some((i) => ['received', 'downloading'].includes(i.status) || (i.status === 'failed' && i.retryable));
    if (pending) {
      const attempts = Math.max(...intake.items.map((i) => i.attempts || 0), 1);
      intake.status = 'failed';
      intake.retryAt = nowMs() + RETRY_BASE_MS * attempts;
      const first = !intake.failureNotified;
      intake.failureNotified = true;
      await save(intake);
      if (first) await say(intake.chatId, "I couldn't download that just now. I'll retry shortly.");
      return intake;
    }
    delete intake.retryAt;
    await notifyOversize(intake);
    const stored = itemsBy(intake, 'stored');
    if (!stored.length) {
      const over = itemsBy(intake, 'needs-web-upload').length;
      intake.status = over ? 'needs-web-upload' : itemsBy(intake, 'failed').length ? 'failed' : 'rejected';
      await save(intake);
      if (!over) {
        const reason = itemsBy(intake, 'rejected')[0]?.reason;
        await say(intake.chatId, intake.status === 'failed'
          ? "I couldn't save that after several tries. Please send it again."
          : `Couldn't save that: ${REASON_TEXT[reason] || 'not accepted'}.`);
      }
      return intake;
    }
    if (mode === 'review') {
      intake.status = 'review';
      intake.reviewDeadline = nowMs() + REVIEW_MS;
      await save(intake);
      const over = itemsBy(intake, 'needs-web-upload').length;
      await say(intake.chatId, `${stored.length} ${noun(stored)} received${over ? ` (${over} too large, see the upload link)` : ''}.${rejectionLine(intake)} Finish to save them as one upload.`, {
        actions: [
          { action: 'finish', label: 'Finish', intakeId: intake.id },
          { action: 'add-more', label: 'Add more', intakeId: intake.id },
          { action: 'split', label: 'Split', intakeId: intake.id },
        ],
      });
      return intake;
    }
    await register(intake);
    const asked = await maybeAsk(intake, mode === 'late' ? 'Added to the same upload:' : 'Saved');
    await save(intake);
    if (!asked) await say(intake.chatId, savedText(intake, mode === 'late' ? 'Added to the same upload:' : 'Saved'));
    return intake;
  }

  /** Save-confirmation and the single context question go out as ONE message. */
  async function maybeAsk(intake, prefix) {
    const hasContext = intake.context.caption || intake.context.note;
    if (hasContext || intake.questionAsked || prefix?.startsWith('Added')) return false;
    intake.questionAsked = true;
    intake.awaitingContext = true;
    intake.contextAskedAt = nowMs();
    await say(intake.chatId, `${savedText(intake, prefix)} ${CONTEXT_QUESTION}`);
    return true;
  }

  // ---- public handlers --------------------------------------------------------

  async function handleText(binding, message) {
    const text = clip(message.text, CONTEXT_MAX);
    if (!text || text.startsWith('/')) return false;
    const snap = await col().where('telegramUserId', '==', binding.telegramUserId).get();
    const t = nowMs();
    const candidates = snap.docs.map((d) => strip(d.data())).filter((i) => i.awaitingContext && i.clientId === binding.clientId
      && String(i.chatId) === String(message.chat?.id ?? binding.chatId) && t - (i.contextAskedAt || 0) < CONTEXT_TTL_MS);
    if (!candidates.length) return false;
    const intake = candidates.sort((a, b) => b.contextAskedAt - a.contextAskedAt)[0];
    intake.context.note = text;
    intake.awaitingContext = false;
    intake.updatedAt = t;
    const targets = intake.splitInto?.length ? await Promise.all(intake.splitInto.map(load)) : [intake];
    for (const target of targets.filter(Boolean)) {
      if (target !== intake) { target.context.note = text; target.updatedAt = t; await save(target); }
      if (target.status === 'registered') await storage.register(target); // idempotent upsert, now with context
    }
    await save(intake);
    await say(intake.chatId, 'Got it. Added that to the upload.');
    return true;
  }

  async function handleMessage(binding, message) {
    if (!message) return false;
    const media = extractMedia(message);
    if (!media) return handleText(binding, message);
    if (media.unsupported) {
      await say(message.chat?.id ?? binding.chatId, 'I can only save photos and videos.');
      return true;
    }
    let intake = (await load(newIntake(binding, message, media).id));
    if (!intake) intake = newIntake(binding, message, media);
    const existing = intake.items.find((i) => i.fileUniqueId === media.fileUniqueId);
    if (existing) {
      // Duplicate delivery. Only an unfinished/retryable item is worth touching.
      const unfinished = ['received', 'downloading'].includes(existing.status) || (existing.status === 'failed' && existing.retryable);
      if (!unfinished) return true;
    } else {
      addItem(intake, message, media);
    }
    intake.updatedAt = nowMs();
    if (intake.mode === 'album') {
      if (intake.status === 'registered') intake.lateAdd = true;
      if (intake.status === 'split') { await say(intake.chatId, 'That album was already split. Send the new item on its own.'); return true; }
      intake.status = 'collecting';
      intake.finalizeAfter = nowMs() + QUIET_MS;
      await save(intake);
      return true;
    }
    await save(intake);
    await processItems(intake);
    await settle(intake, 'single');
    return true;
  }

  async function finish(intake) {
    if (intake.status === 'registered' || intake.status === 'split') return intake;
    if (intake.status === 'collecting') await processItems(intake);
    return settle(intake, 'single');
  }

  async function split(intake) {
    const stored = itemsBy(intake, 'stored');
    const ids = [];
    for (let i = 0; i < stored.length; i += 1) {
      const child = {
        ...intake, id: `${intake.id}-s${i + 1}`, mode: 'single', items: [stored[i]], messageIds: [stored[i].messageId],
        context: { ...intake.context }, parentId: intake.id, splitInto: undefined, awaitingContext: false, questionAsked: true,
        continuationSent: true, updatedAt: nowMs(),
      };
      await register(child);
      await save(child);
      ids.push(child.id);
    }
    intake.splitInto = ids;
    intake.status = 'split';
    const asked = !(intake.context.caption || intake.context.note) && !intake.questionAsked;
    if (asked) { intake.questionAsked = true; intake.awaitingContext = true; intake.contextAskedAt = nowMs(); }
    await save(intake);
    await say(intake.chatId, `Saved ${ids.length} separate ${noun(stored)} to your library. Rights aren't cleared.${asked ? ` ${CONTEXT_QUESTION}` : ''}`);
    return intake;
  }

  async function handleCallback(binding, action, intakeId) {
    const intake = await load(intakeId);
    if (!intake || String(intake.telegramUserId) !== String(binding.telegramUserId) || intake.clientId !== binding.clientId) {
      return { ok: false, reason: 'unknown-intake' };
    }
    if (action === 'finish') {
      await finish(intake);
      return { ok: true, status: intake.status };
    }
    if (action === 'add-more') {
      if (intake.status !== 'review') return { ok: true, status: intake.status };
      intake.status = 'collecting';
      intake.finalizeAfter = nowMs() + ADD_MORE_MS;
      await save(intake);
      await say(intake.chatId, 'Send the next ones now. I will group them with this upload.');
      return { ok: true, status: intake.status };
    }
    if (action === 'split') {
      if (intake.status === 'collecting') await processItems(intake);
      if (intake.status === 'split' || intake.status === 'registered') return { ok: true, status: intake.status };
      await split(intake);
      return { ok: true, status: intake.status };
    }
    return { ok: false, reason: 'unknown-action' };
  }

  /** Called by the dispatcher. Quiet-period album finalize, review timeout, retries. */
  async function finalizeDue({ now } = {}) {
    const t = nowMs(now ?? ctx.now());
    const out = { reviewed: 0, autoFinished: 0, retried: 0 };
    // Background work re-checks access: after unlink/revoke nothing is downloaded, registered or messaged.
    const allowed = async (intake) => !ctx.canProcess || Boolean(await ctx.canProcess(intake));
    const by = async (status) => (await col().where('status', '==', status).get()).docs.map((d) => strip(d.data()));
    for (const intake of await by('collecting')) {
      if ((intake.finalizeAfter || 0) > t || intake.mode !== 'album') continue;
      if (!(await allowed(intake))) continue;
      await processItems(intake);
      await settle(intake, intake.lateAdd ? 'late' : 'review');
      out.reviewed += 1;
    }
    for (const intake of await by('review')) {
      if ((intake.reviewDeadline || 0) > t) continue;
      if (!(await allowed(intake))) continue;
      await finish(intake);
      out.autoFinished += 1;
    }
    for (const intake of await by('failed')) {
      if (!intake.retryAt || intake.retryAt > t) continue;
      if (!(await allowed(intake))) continue;
      await processItems(intake);
      await settle(intake, intake.mode === 'album' ? 'review' : 'single');
      out.retried += 1;
    }
    return out;
  }

  /**
   * A completed large-file web upload resumes the chat. `file` is already in storage:
   * { storagePath, contentType, bytes, sha256? }. Marks the oversize item stored and registers.
   */
  async function attachWebUpload(intakeId, fileUniqueId, file) {
    const intake = await load(intakeId);
    if (!intake) return { ok: false, reason: 'unknown-intake' };
    const item = intake.items.find((i) => i.fileUniqueId === fileUniqueId && i.status === 'needs-web-upload');
    if (!item) return { ok: true, noop: true };
    Object.assign(item, { status: 'stored', storagePath: file.storagePath, contentType: file.contentType, bytes: file.bytes, sha256: file.sha256, kind: String(file.contentType).startsWith('video/') ? 'video' : 'image' });
    const stillWaiting = intake.items.some((i) => i.status === 'needs-web-upload');
    if (!stillWaiting && intake.status !== 'collecting') await settle(intake, intake.packageId ? 'late' : 'single');
    else await save(intake);
    return { ok: true, status: intake.status };
  }

  return { handleMessage, handleCallback, finalizeDue, attachWebUpload };
}
