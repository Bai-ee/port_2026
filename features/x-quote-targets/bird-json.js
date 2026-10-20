// Parse `bird ... --json` stdout. Pure.
//
// ⚠️ The old parse (`raw.indexOf('[')`) landed INSIDE a bio / tweet text whenever a warning line or a "[" in a name
// came before the payload, and JSON.parse then failed. The payload always starts at column 0 of a line (bird pretty
// prints), so anchor on that.

/** @returns {unknown} the parsed JSON document; throws when there is none. */
export function parseBirdJson(raw) {
  const text = String(raw ?? '');
  const start = text.search(/^[[{]/m);
  if (start === -1) throw new Error('bird returned no JSON');
  return JSON.parse(text.slice(start));
}

/** Tweets from a bird JSON document: a bare array, or { tweets: [...] }. */
export function tweetsFromBird(doc) {
  if (Array.isArray(doc)) return doc;
  return Array.isArray(doc?.tweets) ? doc.tweets : [];
}
