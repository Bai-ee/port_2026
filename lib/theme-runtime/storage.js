// Failure-tolerant wrapper over a Storage-like object (contract §7.5 "Storage failure").
// Every access is wrapped in try/catch, including the `window.localStorage` accessor
// itself (it throws in some private/blocked-site-data modes). A failure flips
// `available` to false and calls `onFail`; nothing ever throws to the caller.

/**
 * @param source  a Storage-like object, or a function returning one (the function is
 *                called on every access so an accessor that throws is also contained)
 * @param options { onFail?: (error) => void }
 */
export function createSafeStorage(source, options = {}) {
  const onFail = typeof options.onFail === 'function' ? options.onFail : null;
  let available = true;

  function fail(error) {
    const wasAvailable = available;
    available = false;
    if (wasAvailable && onFail) {
      try { onFail(error); } catch { /* listener errors never escape */ }
    }
  }

  function resolve() {
    try {
      const s = typeof source === 'function' ? source() : source;
      if (!s) { fail(new Error('storage unavailable')); return null; }
      return s;
    } catch (error) {
      fail(error);
      return null;
    }
  }

  return {
    get available() { return available; },
    get(key) {
      const s = resolve();
      if (!s) return null;
      try {
        const v = s.getItem(key);
        return typeof v === 'string' ? v : null;
      } catch (error) { fail(error); return null; }
    },
    set(key, value) {
      const s = resolve();
      if (!s) return false;
      try { s.setItem(key, String(value)); return true; } catch (error) { fail(error); return false; }
    },
    remove(key) {
      const s = resolve();
      if (!s) return false;
      try { s.removeItem(key); return true; } catch (error) { fail(error); return false; }
    },
  };
}

/** Default sources (browser only; they return undefined during SSR and are handled above). */
export const localSource = () => (typeof window === 'undefined' ? null : window.localStorage);
export const sessionSource = () => (typeof window === 'undefined' ? null : window.sessionStorage);
