// Tiny injectable scheduler so the applier, history and stores are deterministic in tests.
// `raf` falls back to a ~16 ms timeout where requestAnimationFrame does not exist.

export function createDefaultScheduler() {
  const hasRaf = typeof requestAnimationFrame === 'function';
  return {
    raf: hasRaf ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(() => fn(Date.now()), 16),
    caf: hasRaf ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    now: () => Date.now(),
  };
}
