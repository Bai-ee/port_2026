// Test helper: Firestore rejects arrays that directly contain arrays (and
// undefined values). Throws on any such shape anywhere in `value`.
export function assertFirestoreSafe(value, at = 'doc') {
  if (value === undefined) throw new Error(`Firestore-unsafe undefined at ${at}`);
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (Array.isArray(item)) throw new Error(`Firestore-unsafe nested array at ${at}[${i}]`);
      assertFirestoreSafe(item, `${at}[${i}]`);
    });
    return;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value)) assertFirestoreSafe(v, `${at}.${k}`);
  }
}
