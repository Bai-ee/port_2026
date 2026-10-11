import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBotTransport, createFakeTransport, TelegramError,
  escapeHtml, splitText, inlineKeyboard, replyKeyboard,
} from '../transport.js';

const TOKEN = '123456:SECRET-token_abc';

function jsonRes(status, body) {
  return { status, ok: status < 300, json: async () => body, headers: new Map() };
}
function recorder(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return handler(url, init, calls.length); };
  return { fetchImpl, calls };
}

test('posts JSON to the bot method URL and returns result', async () => {
  const { fetchImpl, calls } = recorder(() => jsonRes(200, { ok: true, result: { message_id: 7 } }));
  const t = createBotTransport({ token: TOKEN, fetchImpl });
  const r = await t.sendMessage(42, 'hi', { parseMode: 'HTML', disablePreview: true, replyToMessageId: 3 });
  assert.deepEqual(r, { message_id: 7 });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.chat_id, 42);
  assert.equal(body.parse_mode, 'HTML');
  assert.deepEqual(body.reply_parameters, { message_id: 3 });
  assert.deepEqual(body.link_preview_options, { is_disabled: true });
  assert.ok(!('reply_markup' in body));
});

test('editMessageReplyMarkup(null) sends an empty keyboard', async () => {
  const { fetchImpl, calls } = recorder(() => jsonRes(200, { ok: true, result: true }));
  await createBotTransport({ token: TOKEN, fetchImpl }).editMessageReplyMarkup(1, 2, null);
  assert.deepEqual(JSON.parse(calls[0].init.body).reply_markup, { inline_keyboard: [] });
});

test('429 maps to rate-limited with retryAfter', async () => {
  const { fetchImpl } = recorder(() => jsonRes(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 17 } }));
  const t = createBotTransport({ token: TOKEN, fetchImpl });
  await assert.rejects(t.getMe(), (e) => e instanceof TelegramError && e.code === 'rate-limited' && e.retryAfter === 17 && e.retryable === true && e.status === 429);
});

test('5xx is retryable server error', async () => {
  const { fetchImpl } = recorder(() => jsonRes(502, null));
  await assert.rejects(createBotTransport({ token: TOKEN, fetchImpl }).getMe(), (e) => e.code === 'server' && e.retryable);
});

test('400/403/404 are not retryable', async () => {
  for (const [status, code] of [[400, 'bad-request'], [403, 'forbidden'], [404, 'not-found']]) {
    const { fetchImpl } = recorder(() => jsonRes(status, { ok: false, description: 'nope' }));
    await assert.rejects(createBotTransport({ token: TOKEN, fetchImpl }).getMe(), (e) => e.code === code && e.retryable === false);
  }
});

test('network failure is retryable and timeout aborts', async () => {
  const net = createBotTransport({ token: TOKEN, fetchImpl: async () => { throw new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getMe`); } });
  await assert.rejects(net.getMe(), (e) => e.code === 'network' && e.retryable);

  const slow = createBotTransport({
    token: TOKEN,
    timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  await assert.rejects(slow.getMe(), (e) => e.code === 'timeout' && e.retryable);
});

test('errors never leak the token or URL', async () => {
  const cases = [
    () => jsonRes(400, { ok: false, description: `bad ${TOKEN} https://api.telegram.org/bot${TOKEN}/x` }),
    () => { throw new Error(`boom ${TOKEN}`); },
  ];
  for (const h of cases) {
    const t = createBotTransport({ token: TOKEN, fetchImpl: async () => h() });
    try { await t.sendMessage(1, 'x'); assert.fail('should throw'); } catch (e) {
      const dump = `${e.message}|${e.description}|${e.stack?.split('\n')[0]}|${JSON.stringify(e)}`;
      assert.ok(!dump.includes(TOKEN), dump);
      assert.ok(!dump.includes('api.telegram.org'), dump);
    }
  }
});

test('getFileInfo normalizes fields', async () => {
  const { fetchImpl, calls } = recorder(() => jsonRes(200, { ok: true, result: { file_id: 'a', file_size: 10, file_path: 'photos/x.jpg' } }));
  const info = await createBotTransport({ token: TOKEN, fetchImpl }).getFileInfo('a');
  assert.deepEqual(info, { fileId: 'a', fileSize: 10, filePath: 'photos/x.jpg' });
  assert.ok(calls[0].url.endsWith('/getFile'));
});

function streamOf(chunks) {
  return new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(new Uint8Array(x))); c.close(); } });
}

test('downloadFile streams under the limit', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, `https://api.telegram.org/file/bot${TOKEN}/photos/x.jpg`);
    return { status: 200, headers: new Map(), body: streamOf([[1, 2, 3], [4, 5]]) };
  };
  const buf = await createBotTransport({ token: TOKEN, fetchImpl }).downloadFile('photos/x.jpg', { maxBytes: 10 });
  assert.deepEqual([...buf], [1, 2, 3, 4, 5]);
});

test('downloadFile enforces maxBytes via fileSize, header, and stream count', async () => {
  const never = async () => { throw new Error('should not fetch'); };
  await assert.rejects(createBotTransport({ token: TOKEN, fetchImpl: never }).downloadFile('p', { maxBytes: 4, fileSize: 5 }), (e) => e.code === 'bad-request' && !e.retryable);

  const hdr = async () => ({ status: 200, headers: new Map([['content-length', '99']]), body: streamOf([[1]]) });
  await assert.rejects(createBotTransport({ token: TOKEN, fetchImpl: hdr }).downloadFile('p', { maxBytes: 4 }), (e) => /size limit/.test(e.description));

  const liar = async () => ({ status: 200, headers: new Map(), body: streamOf([[1, 2, 3], [4, 5, 6]]) });
  await assert.rejects(createBotTransport({ token: TOKEN, fetchImpl: liar }).downloadFile('p', { maxBytes: 4 }), (e) => /size limit/.test(e.description));
});

test('downloadFile failure does not leak the token', async () => {
  const f = async () => ({ status: 404, headers: new Map(), body: null });
  await assert.rejects(createBotTransport({ token: TOKEN, fetchImpl: f }).downloadFile('p'), (e) => !e.message.includes(TOKEN) && e.code === 'not-found');
});

test('fake transport: ids increment, calls recorded, failNext fires once', async () => {
  const f = createFakeTransport();
  const a = await f.sendMessage(1, 'a');
  const b = await f.sendPhoto(1, 'u');
  assert.equal(b.message_id, a.message_id + 1);
  f.failNext('sendMessage', new TelegramError({ code: 'rate-limited', retryAfter: 3, retryable: true }));
  await assert.rejects(f.sendMessage(1, 'x'), (e) => e.retryAfter === 3);
  await f.sendMessage(1, 'y');
  assert.deepEqual(f.calls.map((c) => c.method), ['sendMessage', 'sendPhoto', 'sendMessage', 'sendMessage']);
});

test('helpers: escapeHtml, splitText, keyboards', () => {
  assert.equal(escapeHtml('<a & b>'), '&lt;a &amp; b&gt;');
  assert.deepEqual(splitText('short'), ['short']);
  const long = `${'word '.repeat(50)}`.trim();
  const parts = splitText(long, 40);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 40));
  assert.equal(parts.join(' '), long);
  assert.ok(splitText('x'.repeat(100), 30).every((p) => p.length <= 30));

  assert.deepEqual(inlineKeyboard([[{ text: 'A', callbackData: 't:1' }, { text: 'L', url: 'https://x.com' }]]),
    { inline_keyboard: [[{ text: 'A', callback_data: 't:1' }, { text: 'L', url: 'https://x.com' }]] });
  assert.throws(() => inlineKeyboard([[{ text: 'A', callbackData: 'x'.repeat(65) }]]));
  assert.deepEqual(replyKeyboard([['One', 'Two']], { persistent: true }),
    { keyboard: [[{ text: 'One' }, { text: 'Two' }]], resize_keyboard: true, is_persistent: true });
});

test('setWebhook maps option names', async () => {
  const { fetchImpl, calls } = recorder(() => jsonRes(200, { ok: true, result: true }));
  await createBotTransport({ token: TOKEN, fetchImpl }).setWebhook({ url: 'https://h/x', secretToken: 's', allowedUpdates: ['message'], maxConnections: 5 });
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://h/x', secret_token: 's', allowed_updates: ['message'], max_connections: 5 });
});
