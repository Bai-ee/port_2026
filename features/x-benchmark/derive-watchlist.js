// Derive the accounts worth quote-reacting to, from a benchmark's own corpus.
//
// `features/x-quote-targets/watchlist.js` is 39 handles that were read off the
// benchmark's corpus by hand: the accounts it quoted and retweeted, weighted by
// likes earned, with the list cut where 31 accounts covered 80% of the
// quote-derived likes. That rule is the thing worth keeping — the specific 39
// handles are one account's answer to it. This module is the rule.
//
// Why quote targets are derived from the BENCHMARK and not from the client: a
// quote-tweet inherits the reading audience of the post it quotes, so the
// question is "whose posts carry an audience worth borrowing in this lane",
// and the benchmark has already answered it with 65 days of evidence the
// client does not have.
//
// Pure: no fs, no network, no clock.

import { UNTAGGED, tagTopics } from './taxonomy.js';

/** Cut the list where this share of quote-derived likes is covered. Measured:
 * 31 of 195 quoted accounts covered 80% of the benchmark's quote-derived
 * likes, which is the shape a curated list wants — long enough that something
 * is always live, short enough to stay curated. */
export const COVERAGE_TARGET = 0.8;

/** Never return more than this many accounts however flat the distribution.
 * A 39-account sweep already gets rate-limited on 32 of them; a 200-account
 * list would be unscannable. */
export const MAX_ACCOUNTS = 45;

/** An account quoted once, for few likes, is noise. */
export const MIN_APPEARANCES = 1;

const QUOTE_TYPES = new Set(['quote-react', 'quote-commentary']);

function cleanHandle(v) {
  return String(v ?? '').trim().replace(/^@+/, '');
}

/** The handle a retweet carries in its text — retweets have no quotedAuthor. */
function retweetAuthor(text) {
  const m = /^RT @([A-Za-z0-9_]{1,15})\b/.exec(String(text ?? ''));
  return m ? m[1] : null;
}

/**
 * Derive a watchlist from a benchmark corpus.
 *
 * @param {object[]} rows - normalized corpus rows for the benchmark account
 * @param {object} [opts]
 * @param {number} [opts.coverage=COVERAGE_TARGET]
 * @param {number} [opts.max=MAX_ACCOUNTS]
 * @param {string} [opts.ownHandle] - excluded, since self-quotes are not a
 *   watchlist entry
 * @returns {{accounts: object[], meta: object}}
 */
export function deriveWatchlist(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const coverage = Number.isFinite(opts.coverage) ? opts.coverage : COVERAGE_TARGET;
  const max = Number.isFinite(opts.max) ? opts.max : MAX_ACCOUNTS;
  const own = cleanHandle(opts.ownHandle).toLowerCase();

  const byAccount = new Map();
  const bump = (handle, patch) => {
    const key = cleanHandle(handle);
    if (!key || key.toLowerCase() === own) return;
    const cur = byAccount.get(key) ?? { handle: key, quotes: 0, retweets: 0, likesEarned: 0, topics: new Map() };
    cur.quotes += patch.quotes ?? 0;
    cur.retweets += patch.retweets ?? 0;
    cur.likesEarned += patch.likesEarned ?? 0;
    for (const topic of patch.topics ?? []) {
      if (topic === UNTAGGED) continue;
      cur.topics.set(topic, (cur.topics.get(topic) ?? 0) + 1);
    }
    byAccount.set(key, cur);
  };

  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const likes = Number(row.likes);
    if (QUOTE_TYPES.has(row.type) && row.quotedAuthor) {
      // The vein must describe what the TARGET posts, so it is read from the
      // quoted text where that exists. The row's own topics are tagged across
      // caption + quote together, which lets the caption's subject leak in —
      // it produced a "growth-milestone" vein for a typography account.
      const quotedTopics = row.quotedText ? tagTopics(row.quotedText) : null;
      bump(row.quotedAuthor, {
        quotes: 1,
        // The likes the BENCHMARK earned by quoting them — the value of
        // borrowing that audience, not the target account's own popularity.
        likesEarned: Number.isFinite(likes) ? likes : 0,
        topics: (quotedTopics && quotedTopics[0] !== UNTAGGED)
          ? quotedTopics
          : (Array.isArray(row.topics) ? row.topics : []),
      });
    } else if (row.type === 'retweet') {
      const author = retweetAuthor(row.text);
      // A retweet earns the retweeter nothing measurable, so it counts as a
      // signal of interest with no likes attached.
      if (author) bump(author, { retweets: 1, topics: Array.isArray(row.topics) ? row.topics : [] });
    }
  }

  const candidates = [...byAccount.values()]
    .filter((a) => a.quotes + a.retweets >= MIN_APPEARANCES)
    .map((a) => {
      const vein = [...a.topics.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
      return {
        handle: a.handle,
        vein,
        quotes: a.quotes,
        retweets: a.retweets,
        likesEarned: a.likesEarned,
        // Quotes are the signal; retweets break ties. A quote is a considered
        // act that earns measurable engagement, a retweet is one tap.
        weight: a.likesEarned + a.quotes * 10 + a.retweets * 2,
      };
    })
    .sort((a, b) => b.weight - a.weight || b.likesEarned - a.likesEarned || a.handle.localeCompare(b.handle));

  const totalLikes = candidates.reduce((sum, a) => sum + a.likesEarned, 0);
  const accounts = [];
  let cumulative = 0;
  for (const candidate of candidates) {
    if (accounts.length >= max) break;
    const share = totalLikes > 0 ? candidate.likesEarned / totalLikes : 0;
    cumulative += share;
    accounts.push({
      ...candidate,
      share: Math.round(share * 10000) / 10000,
      cumulativeShare: Math.round(cumulative * 10000) / 10000,
    });
    // Cut AFTER the account that crosses the threshold, so the list covers the
    // target rather than stopping just short of it.
    if (totalLikes > 0 && cumulative >= coverage) break;
  }

  return {
    accounts,
    meta: {
      candidatesConsidered: candidates.length,
      accountsReturned: accounts.length,
      coverageTarget: coverage,
      coverageAchieved: accounts.length ? accounts[accounts.length - 1].cumulativeShare : 0,
      totalQuoteDerivedLikes: totalLikes,
      // Zero means the corpus had no quotes or no likes on them: the list is
      // then frequency-ordered only, and the caller should know that.
      likesWeighted: totalLikes > 0,
    },
  };
}

/**
 * Merge a derived list with hand-curated entries.
 *
 * A client's own lanes are usually not in the benchmark's corpus — they are the
 * ground only that account can credibly occupy — so a derived list alone would
 * drop them. Curated entries are kept and marked `unproven`, exactly as the
 * hand-written watchlist already marks them.
 */
export function mergeWatchlist(derived = [], curated = []) {
  const out = new Map();
  for (const a of Array.isArray(derived) ? derived : []) {
    const key = cleanHandle(a?.handle);
    if (key) out.set(key.toLowerCase(), { ...a, handle: key, source: 'derived' });
  }
  for (const c of Array.isArray(curated) ? curated : []) {
    const key = cleanHandle(c?.handle);
    if (!key) continue;
    const existing = out.get(key.toLowerCase());
    if (existing) {
      // A curated note is worth keeping on a derived entry; the measurements
      // are not overwritten.
      out.set(key.toLowerCase(), { ...existing, note: c.note ?? existing.note, vein: existing.vein ?? c.vein });
    } else {
      out.set(key.toLowerCase(), {
        handle: key,
        vein: c.vein ?? null,
        note: c.note ?? null,
        quotes: 0,
        retweets: 0,
        likesEarned: 0,
        weight: 0,
        share: 0,
        cumulativeShare: 0,
        unproven: true,
        source: 'curated',
      });
    }
  }
  return [...out.values()];
}
