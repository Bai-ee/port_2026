// Shared test doubles (not a test file: the repo glob only runs *.test.js).

export function createFakeDocument() {
  const attrs = new Map();
  const listeners = new Map();
  const head = {
    children: [],
    appendChild(el) { el.parentNode = head; head.children.push(el); return el; },
    removeChild(el) { head.children = head.children.filter((c) => c !== el); el.parentNode = null; return el; },
  };
  const root = {
    style: { colorScheme: '' },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => { attrs.set(k, String(v)); },
    hasAttribute: (k) => attrs.has(k),
    removeAttribute: (k) => { attrs.delete(k); },
    appendChild: (el) => head.appendChild(el),
  };
  const doc = {
    documentElement: root,
    head,
    createElement: (tag) => ({ tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null }),
    getElementById: (id) => head.children.find((c) => c.id === id) || null,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); },
    dispatchEvent(evt) { for (const fn of Array.from(listeners.get(evt.type) || [])) fn(evt); return true; },
    _attrs: attrs,
    _events: [],
  };
  doc.addEventListener('theme:tokens-changed', (e) => doc._events.push(e));
  return doc;
}

export function createFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  const storage = {
    map,
    failGet: false,
    failSet: false,
    getItem(k) { if (storage.failGet) throw new Error('getItem blocked'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      if (storage.failSet) throw new Error('quota');
      const old = map.has(k) ? map.get(k) : null;
      map.set(k, String(v));
      storage.onWrite && storage.onWrite(k, String(v), old);
    },
    removeItem(k) { map.delete(k); },
    writes: [],
  };
  return storage;
}

/** Deterministic frame + timer clock. frame() advances 16 ms, fires due timers, then runs queued rAF callbacks. */
export function createManualScheduler() {
  let t = 0;
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  function fireDue() {
    for (;;) {
      const due = Array.from(timers.entries()).filter(([, x]) => x.at <= t).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (!due.length) return;
      const [id, x] = due[0];
      timers.delete(id);
      x.fn();
    }
  }
  return {
    raf(fn) { const id = nextId++; frames.set(id, fn); return id; },
    caf(id) { frames.delete(id); },
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: t + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    now: () => 1_700_000_000_000 + t,
    frame() {
      t += 16;
      fireDue();
      const run = Array.from(frames.values());
      frames.clear();
      run.forEach((fn) => fn(t));
    },
    advance(ms) { t += ms; fireDue(); },
    get pendingFrames() { return frames.size; },
    get pendingTimers() { return timers.size; },
  };
}

export function createFakeMatchMedia(initialDark = false) {
  const listeners = new Set();
  const mql = {
    matches: initialDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener(type, fn) { if (type === 'change') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'change') listeners.delete(fn); },
    set(dark) { mql.matches = dark; for (const fn of Array.from(listeners)) fn({ matches: dark, type: 'change' }); },
    get listenerCount() { return listeners.size; },
  };
  const fn = () => mql;
  fn.mql = mql;
  return fn;
}

export function createFakeWindow() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { if (listeners.has(type)) listeners.get(type).delete(fn); },
    emit(type, evt) { for (const fn of Array.from(listeners.get(type) || [])) fn({ type, ...evt }); },
    count(type) { return (listeners.get(type) || new Set()).size; },
  };
}

export function createFakeSceneBridge() {
  const calls = [];
  return {
    calls,
    draft: undefined,
    setProduction(v) { calls.push(['setProduction', v]); },
    setMode(v) { calls.push(['setMode', v]); },
    setDraft(v) { this.draft = v; calls.push(['setDraft', v]); },
    get() { return null; },
    subscribe() { return () => {}; },
  };
}
