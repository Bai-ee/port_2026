import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore } from '../draft-store.js';
import { createPrefStore } from '../pref-store.js';
import { createCrossTab } from '../cross-tab.js';
import { setMasterHue, setIntensity } from '../../theme/edit.js';
import { STORAGE_KEYS, CHANNEL_NAME } from '../../theme/constants.js';
import { setStudioSessionActive } from '../registry.js';
import {
  createFakeDocument, createFakeStorage, createManualScheduler, createFakeWindow, createFakeSceneBridge,
  createFakeMatchMedia,
} from './helpers.js';

/** Two (or more) tabs over one shared localStorage + one BroadcastChannel hub, like a real browser. */
function createTabs(names) {
  const shared = new Map();
  const hub = new Map(); // channel name -> Set of instances
  const tabs = {};
  const all = [];

  class FakeChannel {
    constructor(name) { this.name = name; this.listeners = new Set(); (hub.get(name) || hub.set(name, new Set()).get(name)).add(this); }
    addEventListener(type, fn) { if (type === 'message') this.listeners.add(fn); }
    removeEventListener(type, fn) { if (type === 'message') this.listeners.delete(fn); }
    postMessage(data) { for (const c of hub.get(this.name)) if (c !== this) for (const fn of c.listeners) fn({ data }); }
    close() { hub.get(this.name).delete(this); }
  }

  for (const name of names) {
    const win = createFakeWindow();
    const storage = {
      getItem: (k) => (shared.has(k) ? shared.get(k) : null),
      setItem(k, v) {
        const old = shared.has(k) ? shared.get(k) : null;
        shared.set(k, String(v));
        if (old !== String(v)) for (const other of all) if (other.win !== win) other.win.emit('storage', { key: k, newValue: String(v), oldValue: old });
      },
      removeItem(k) { shared.delete(k); },
    };
    const scheduler = createManualScheduler();
    const doc = createFakeDocument();
    const store = createDraftStore({
      document: doc, storage, scheduler, win, ChannelCtor: FakeChannel,
      getSceneBridge: () => createFakeSceneBridge(),
    });
    const tab = { name, win, storage, scheduler, doc, store };
    tabs[name] = tab;
    all.push(tab);
  }
  return { tabs, shared, hub, all };
}

const hue = (t) => t.store.getSnapshot().draft.master.hue;
const edit = (t, h) => t.store.updateDraft((d) => setMasterHue(d, h));

test.afterEach(() => setStudioSessionActive(false));

test('a clean tab adopts the draft another tab SAVED', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.a, 55);
  const res = tabs.a.store.saveDraft();
  assert.equal(res.ok, true);
  assert.equal(hue(tabs.b), 55);
  assert.equal(tabs.b.store.getSnapshot().dirty, false);
  assert.equal(tabs.b.store.getSnapshot().externalChange, false);
  assert.equal(tabs.b.store.getSnapshot().savedAt, res.savedAt);
});

test('a DIRTY tab is never overwritten: externalChange is raised and the in-memory draft is untouched', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.b, 111); // B has unsaved work
  const mine = tabs.b.store.getSnapshot().draft;
  edit(tabs.a, 55);
  tabs.a.store.saveDraft();
  const s = tabs.b.store.getSnapshot();
  assert.equal(s.externalChange, true);
  assert.equal(s.draft, mine, 'same object: not replaced');
  assert.equal(hue(tabs.b), 111);
  assert.equal(s.dirty, true);
});

test('while the notice is pending, autosave and pagehide never overwrite the other tab\'s saved draft', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.b, 111);
  edit(tabs.a, 55);
  const saved = tabs.a.store.saveDraft();
  const stored = tabs.a.storage.getItem(STORAGE_KEYS.draft);
  assert.equal(tabs.b.store.getSnapshot().externalChange, true);
  edit(tabs.b, 201);
  tabs.b.scheduler.advance(500); // autosave timer
  tabs.b.win.emit('pagehide', {});
  assert.equal(tabs.a.storage.getItem(STORAGE_KEYS.draft), stored, 'shared key untouched');
  assert.equal(JSON.parse(stored).savedAt, saved.savedAt);
  assert.equal(tabs.b.store.acceptExternal(), true);
  assert.equal(hue(tabs.b), 55);
});

test('after "Keep mine" autosave resumes', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.b, 111);
  edit(tabs.a, 55); tabs.a.store.saveDraft();
  tabs.b.store.keepMine();
  edit(tabs.b, 201);
  tabs.b.scheduler.advance(500);
  assert.equal(JSON.parse(tabs.a.storage.getItem(STORAGE_KEYS.draft)).definition.master.hue, 201);
});

test('"Keep mine" dismisses the notice and the same payload does not re-flag', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.b, 111);
  edit(tabs.a, 55);
  tabs.a.store.saveDraft();
  assert.equal(tabs.b.store.getSnapshot().externalChange, true);
  tabs.b.store.keepMine();
  assert.equal(tabs.b.store.getSnapshot().externalChange, false);
  assert.equal(hue(tabs.b), 111);
  // late duplicate delivery of the same save
  tabs.b.win.emit('storage', { key: STORAGE_KEYS.draft, newValue: tabs.a.storage.getItem(STORAGE_KEYS.draft) });
  assert.equal(tabs.b.store.getSnapshot().externalChange, false);
});

test('"Load other draft" adopts the other draft and your version stays reachable with undo', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.b, 111);
  edit(tabs.a, 55);
  tabs.a.store.saveDraft();
  assert.equal(tabs.b.store.acceptExternal(), true);
  assert.equal(hue(tabs.b), 55);
  assert.equal(tabs.b.store.getSnapshot().externalChange, false);
  assert.equal(tabs.b.store.getSnapshot().dirty, false, 'now matches the saved draft');
  tabs.b.store.undo();
  assert.equal(hue(tabs.b), 111, 'undo brings back my unsaved version');
});

test('a newer save while a notice is pending replaces the pending payload', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.b, 111);
  edit(tabs.a, 55); tabs.a.store.saveDraft();
  tabs.a.scheduler.advance(10);
  edit(tabs.a, 66); tabs.a.store.saveDraft();
  tabs.b.store.acceptExternal();
  assert.equal(hue(tabs.b), 66);
});

test('autosave traffic (no explicit save) never reaches another tab, even a clean one', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  const before = tabs.b.store.getSnapshot().draft;
  edit(tabs.a, 55);
  tabs.a.scheduler.advance(500); // autosave fires -> storage event in B
  assert.equal(tabs.b.store.getSnapshot().draft, before);
  assert.equal(tabs.b.store.getSnapshot().externalChange, false);
});

test('storage event + channel message for one save are applied once', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  let notifications = 0;
  tabs.b.store.subscribe(() => { notifications += 1; });
  edit(tabs.a, 55);
  tabs.a.store.saveDraft();
  const afterFirst = notifications;
  tabs.b.win.emit('storage', { key: STORAGE_KEYS.draft, newValue: tabs.a.storage.getItem(STORAGE_KEYS.draft) });
  assert.equal(notifications, afterFirst, 'duplicate delivery is ignored');
});

test('a tab without a draft session ignores broadcasts (it will load the saved draft on start)', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft();
  edit(tabs.a, 55); tabs.a.store.saveDraft();
  assert.equal(tabs.b.store.getSnapshot().active, false);
  assert.equal(tabs.b.store.startDraft().source, 'saved');
  assert.equal(hue(tabs.b), 55);
});

test('older or equal savedAt is ignored', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.a.store.start(); tabs.b.store.start();
  tabs.a.store.startDraft(); tabs.b.store.startDraft();
  edit(tabs.a, 55); tabs.a.store.saveDraft();
  const staleRaw = JSON.stringify({ v: 1, savedAt: '2000-01-01T00:00:00.000Z', savedHash: null, definition: setIntensity(tabs.a.store.getSnapshot().draft, 0.2) });
  const before = tabs.b.store.getSnapshot().draft;
  tabs.b.win.emit('storage', { key: STORAGE_KEYS.draft, newValue: staleRaw });
  assert.equal(tabs.b.store.getSnapshot().draft, before);
  assert.equal(tabs.b.store.getSnapshot().externalChange, false);
});

test('corrupt or foreign payloads are ignored without throwing', () => {
  const { tabs } = createTabs(['a', 'b']);
  tabs.b.store.start(); tabs.b.store.startDraft();
  const before = tabs.b.store.getSnapshot().draft;
  for (const bad of ['{nope', '[]', JSON.stringify({ v: 2 }), JSON.stringify({ v: 1, savedAt: 'x', definition: 'str' })]) {
    assert.doesNotThrow(() => tabs.b.win.emit('storage', { key: STORAGE_KEYS.draft, newValue: bad }));
  }
  assert.equal(tabs.b.store.getSnapshot().draft, before);
});

test('stop() detaches storage and channel listeners', () => {
  const { tabs, hub } = createTabs(['a', 'b']);
  tabs.b.store.start(); tabs.b.store.startDraft();
  assert.equal(tabs.b.win.count('storage'), 1);
  tabs.b.store.stop();
  assert.equal(tabs.b.win.count('storage'), 0);
  assert.equal(hub.get(CHANNEL_NAME).size, 0);
});

test('createCrossTab works without BroadcastChannel (storage events only)', () => {
  const win = createFakeWindow();
  const seen = [];
  const ct = createCrossTab({ win, ChannelCtor: null, onDraftRaw: (r) => seen.push(r) });
  assert.equal(ct.hasChannel, false);
  assert.equal(ct.post('x'), false);
  win.emit('storage', { key: STORAGE_KEYS.draft, newValue: 'raw' });
  win.emit('storage', { key: 'other', newValue: 'raw2' });
  win.emit('storage', { key: STORAGE_KEYS.draft, newValue: null });
  assert.deepEqual(seen, ['raw']);
  ct.close();
  assert.equal(win.count('storage'), 0);
});

test('createCrossTab survives a throwing BroadcastChannel constructor', () => {
  const ct = createCrossTab({ win: createFakeWindow(), ChannelCtor: class { constructor() { throw new Error('no'); } }, onDraftRaw() {} });
  assert.equal(ct.hasChannel, false);
});

test('preference sync: a storage event from another tab updates the preference without writing back', () => {
  const doc = createFakeDocument();
  const win = createFakeWindow();
  const storage = createFakeStorage();
  const scheduler = createManualScheduler();
  const store = createPrefStore({ document: doc, storage, scheduler, win, matchMedia: createFakeMatchMedia(false), defaultPreference: 'light' });
  store.start();
  let writes = 0;
  storage.onWrite = () => { writes += 1; };
  win.emit('storage', { key: STORAGE_KEYS.pref, newValue: 'dark' });
  assert.equal(store.getSnapshot().preference, 'dark');
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(writes, 0, 'no ping-pong between tabs');
  win.emit('storage', { key: STORAGE_KEYS.pref, newValue: 'bogus' });
  assert.equal(store.getSnapshot().preference, 'light', 'garbage falls back to the default');
  win.emit('storage', { key: 'unrelated', newValue: 'dark' });
  assert.equal(store.getSnapshot().preference, 'light');
  win.emit('storage', { key: null, newValue: null }); // localStorage.clear() in another tab
  assert.equal(store.getSnapshot().preference, 'light');
});
