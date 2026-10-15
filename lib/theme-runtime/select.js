// Pure selector memo for useSyncExternalStore (kept React-free so it is unit-testable in node).
//
// createSelectorGetter(getSnapshot, isEqual?) -> get(selector)
// get() returns the SAME reference while the snapshot is unchanged and, when the snapshot changed
// but isEqual(prevSelected, nextSelected) holds, keeps returning the previous reference. That is what
// lets useSyncExternalStore skip the re-render when an unrelated field changed.

export function createSelectorGetter(getSnapshot, isEqual = Object.is) {
  let hasValue = false;
  let lastSnapshot;
  let lastSelector;
  let lastValue;
  return function get(selector) {
    const snap = getSnapshot();
    if (hasValue && snap === lastSnapshot && selector === lastSelector) return lastValue;
    const next = selector(snap);
    if (hasValue && isEqual(lastValue, next)) {
      lastSnapshot = snap;
      lastSelector = selector;
      return lastValue;
    }
    hasValue = true;
    lastSnapshot = snap;
    lastSelector = selector;
    lastValue = next;
    return next;
  };
}

export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  return true;
}
