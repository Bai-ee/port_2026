// Telegram Bot API transport. Thin, injectable-fetch wrapper.
// Invariant: the bot token lives only inside this closure. It appears in the
// request URL, so no error message, description, or log line may carry a URL.

const API_ORIGIN = 'https://api.telegram.org';

export class TelegramError extends Error {
  constructor({ status = 0, code, retryAfter = null, retryable = false, description = '' }) {
    super(`Telegram ${code}${status ? ` (${status})` : ''}${description ? `: ${description}` : ''}`);
    this.name = 'TelegramError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.retryable = retryable;
    this.description = description;
  }
}

function classify(status) {
  if (status === 429) return { code: 'rate-limited', retryable: true };
  if (status >= 500) return { code: 'server', retryable: true };
  if (status === 401 || status === 403) return { code: 'forbidden', retryable: false };
  if (status === 404) return { code: 'not-found', retryable: false };
  return { code: 'bad-request', retryable: false };
}

function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

export function createBotTransport({ token, fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  if (!token) throw new Error('Telegram bot token is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required');

  // Defensive: strip the token (and anything bot-URL-shaped) from any text we surface.
  const scrub = (s) => String(s ?? '')
    .split(token).join('[redacted]')
    .replace(/https?:\/\/api\.telegram\.org\S*/g, '[telegram-url]');

  async function request(url, init, { method, expect }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await fetchImpl(url, { ...init, signal: controller.signal });
      } catch (err) {
        const aborted = err?.name === 'AbortError' || controller.signal.aborted;
        throw new TelegramError({
          code: aborted ? 'timeout' : 'network',
          retryable: true,
          description: aborted ? `${method} timed out` : `${method} network failure`,
        });
      }
      return await expect(res, controller);
    } finally {
      clearTimeout(timer);
    }
  }

  function failFromResponse(res, json, method) {
    const status = res.status || 0;
    const base = classify(status);
    const retryAfter = status === 429 ? Number(json?.parameters?.retry_after) || 1 : null;
    return new TelegramError({
      status,
      ...base,
      retryAfter,
      description: scrub(json?.description || `${method} failed`),
    });
  }

  async function call(method, body = {}) {
    const url = `${API_ORIGIN}/bot${token}/${method}`;
    return request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(compact(body)),
    }, {
      method,
      expect: async (res) => {
        let json = null;
        try { json = await res.json(); } catch { /* non-JSON body */ }
        if (res.status >= 200 && res.status < 300 && json?.ok) return json.result;
        throw failFromResponse(res, json, method);
      },
    });
  }

  const replyParams = (id) => (id ? { message_id: id } : undefined);
  const media = (field, method) => (chatId, ref, { caption, parseMode, replyMarkup } = {}) =>
    call(method, { chat_id: chatId, [field]: ref, caption, parse_mode: parseMode, reply_markup: replyMarkup });

  async function downloadFile(filePath, { maxBytes = 20 * 1024 * 1024, fileSize } = {}) {
    const tooLarge = () => new TelegramError({ status: 413, code: 'bad-request', retryable: false, description: 'file exceeds size limit' });
    if (Number.isFinite(fileSize) && fileSize > maxBytes) throw tooLarge();
    const url = `${API_ORIGIN}/file/bot${token}/${filePath}`;
    return request(url, { method: 'GET' }, {
      method: 'downloadFile',
      expect: async (res, controller) => {
        if (!(res.status >= 200 && res.status < 300)) throw failFromResponse(res, null, 'downloadFile');
        const declared = Number(res.headers?.get?.('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
        const reader = res.body?.getReader?.();
        if (!reader) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > maxBytes) throw tooLarge();
          return buf;
        }
        // Count bytes as they stream so a lying/missing content-length can't blow memory.
        const chunks = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) {
            controller.abort();
            try { await reader.cancel(); } catch { /* already closed */ }
            throw tooLarge();
          }
          chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
      },
    });
  }

  return {
    sendMessage: (chatId, text, { replyMarkup, parseMode, replyToMessageId, disablePreview } = {}) => call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
      reply_parameters: replyParams(replyToMessageId),
      link_preview_options: disablePreview ? { is_disabled: true } : undefined,
    }),
    sendPhoto: media('photo', 'sendPhoto'),
    sendVideo: media('video', 'sendVideo'),
    sendDocument: media('document', 'sendDocument'),
    // null markup clears the keyboard (Telegram wants an empty inline_keyboard, not null).
    editMessageReplyMarkup: (chatId, messageId, replyMarkup) => call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: replyMarkup || { inline_keyboard: [] },
    }),
    editMessageText: (chatId, messageId, text, { parseMode, replyMarkup, disablePreview } = {}) => call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
      link_preview_options: disablePreview ? { is_disabled: true } : undefined,
    }),
    answerCallbackQuery: (id, { text, showAlert } = {}) => call('answerCallbackQuery', {
      callback_query_id: id,
      text,
      show_alert: showAlert ? true : undefined,
    }),
    setWebhook: ({ url, secretToken, allowedUpdates, maxConnections } = {}) => call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: allowedUpdates,
      max_connections: maxConnections,
    }),
    deleteWebhook: () => call('deleteWebhook', {}),
    getMe: () => call('getMe', {}),
    async getFileInfo(fileId) {
      const r = await call('getFile', { file_id: fileId });
      return { fileId: r.file_id, fileSize: r.file_size ?? null, filePath: r.file_path ?? null };
    },
    downloadFile,
  };
}

// In-memory stand-in with the same surface. Used by bot/scheduler tests.
export function createFakeTransport() {
  const calls = [];
  const failures = new Map();
  let nextMessageId = 1000;
  const files = new Map();

  const record = (method, args, result) => {
    const failure = failures.get(method);
    if (failure?.length) {
      const err = failure.shift();
      calls.push({ method, args, error: err });
      throw err;
    }
    calls.push({ method, args });
    return typeof result === 'function' ? result() : result;
  };
  const sent = (chatId) => () => ({ message_id: nextMessageId++, chat: { id: chatId } });

  const fake = {
    calls,
    files,
    failNext(method, error) {
      if (!failures.has(method)) failures.set(method, []);
      failures.get(method).push(error);
    },
    sendMessage: async (chatId, text, opts) => record('sendMessage', [chatId, text, opts], sent(chatId)),
    sendPhoto: async (chatId, url, opts) => record('sendPhoto', [chatId, url, opts], sent(chatId)),
    sendVideo: async (chatId, url, opts) => record('sendVideo', [chatId, url, opts], sent(chatId)),
    sendDocument: async (chatId, url, opts) => record('sendDocument', [chatId, url, opts], sent(chatId)),
    editMessageReplyMarkup: async (chatId, messageId, markup) => record('editMessageReplyMarkup', [chatId, messageId, markup], true),
    editMessageText: async (chatId, messageId, text, opts) => record('editMessageText', [chatId, messageId, text, opts], true),
    answerCallbackQuery: async (id, opts) => record('answerCallbackQuery', [id, opts], true),
    setWebhook: async (opts) => record('setWebhook', [opts], true),
    deleteWebhook: async () => record('deleteWebhook', [], true),
    getMe: async () => record('getMe', [], { id: 1, is_bot: true, username: 'fake_bot' }),
    getFileInfo: async (fileId) => record('getFileInfo', [fileId], { fileId, fileSize: files.get(fileId)?.length ?? 0, filePath: `fake/${fileId}` }),
    downloadFile: async (filePath, opts) => record('downloadFile', [filePath, opts], () => files.get(filePath.replace(/^fake\//, '')) || Buffer.alloc(0)),
  };
  return fake;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Split on paragraph/line/space boundaries when possible; hard-cut as last resort.
export function splitText(s, max = 4096) {
  const text = String(s ?? '');
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '));
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

export function inlineKeyboard(rows) {
  return {
    inline_keyboard: rows.map((row) => row.map((b) => {
      if (b.url) return { text: b.text, url: b.url };
      if (Buffer.byteLength(String(b.callbackData ?? ''), 'utf8') > 64) {
        throw new Error('callback_data exceeds 64 bytes');
      }
      return { text: b.text, callback_data: b.callbackData };
    })),
  };
}

export function replyKeyboard(rows, { persistent = false } = {}) {
  return {
    keyboard: rows.map((row) => row.map((b) => (typeof b === 'string' ? { text: b } : b))),
    resize_keyboard: true,
    is_persistent: !!persistent,
  };
}
