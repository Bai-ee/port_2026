// Cross-tab transport for the draft (contract §7.5 "Cross-tab"). BroadcastChannel plus `storage`
// events; both deliver the same raw JSON string stored under STORAGE_KEYS.draft, and receivers
// de-duplicate by the payload's savedAt (see draft-store). Nothing here writes or throws.

import { STORAGE_KEYS, CHANNEL_NAME } from '../theme/constants.js';

/**
 * @param options { win, ChannelCtor, channelName, onDraftRaw(raw:string) }
 */
export function createCrossTab(options = {}) {
  const win = options.win !== undefined ? options.win : (typeof window !== 'undefined' ? window : null);
  const Ctor = options.ChannelCtor !== undefined ? options.ChannelCtor : (typeof BroadcastChannel === 'function' ? BroadcastChannel : null);
  const name = options.channelName || CHANNEL_NAME;
  const onDraftRaw = typeof options.onDraftRaw === 'function' ? options.onDraftRaw : () => {};

  let channel = null;
  const onStorage = (event) => {
    if (!event || event.key !== STORAGE_KEYS.draft || typeof event.newValue !== 'string') return;
    onDraftRaw(event.newValue);
  };
  const onMessage = (event) => {
    const data = event && event.data;
    if (data && data.type === 'draft' && typeof data.raw === 'string') onDraftRaw(data.raw);
  };

  if (win && typeof win.addEventListener === 'function') win.addEventListener('storage', onStorage);
  if (Ctor) {
    try {
      channel = new Ctor(name);
      if (typeof channel.addEventListener === 'function') channel.addEventListener('message', onMessage);
      else channel.onmessage = onMessage;
    } catch { channel = null; }
  }

  return {
    get hasChannel() { return !!channel; },
    post(raw) {
      if (!channel) return false;
      try { channel.postMessage({ type: 'draft', raw }); return true; } catch { return false; }
    },
    close() {
      if (win && typeof win.removeEventListener === 'function') win.removeEventListener('storage', onStorage);
      if (channel) {
        try {
          if (typeof channel.removeEventListener === 'function') channel.removeEventListener('message', onMessage);
          channel.close();
        } catch { /* ignore */ }
        channel = null;
      }
    },
  };
}
