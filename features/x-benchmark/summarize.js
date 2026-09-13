// Turn a normalized X corpus into a scale-free stat block.
//
// The corpus row shape is the one produced by scripts/x-content/research/
// analyze-corpus*.mjs and stored per account: { id, utc, dateLocal, hourLocal,
// weekday, type, media, topics[], chars, text, likes, reposts, replies, views,
// engagement, ... }. Same shape for every account, which is what makes two of
// them comparable at all.
//
// Pure: no fs, no network, no clock. Same input always yields the same block.
//
// ⚠️ Everything here is designed to be compared ACROSS accounts with different
// audience sizes, so nothing absolute is allowed to carry meaning. The unit of
// comparison is `lift` — a post class's performance relative to the SAME
// account's own average. An account with 66 median views and one with 2,205
// both have an average, and "self-quotes do 1.8× your own average" means the
// same thing in both. Raw likes do not.

/** A post class needs at least this many posts before its own lift is trusted.
 * Below it, compare.js borrows the benchmark's lift and lowers confidence —
 * eight posts is already thin, it is simply the point below which a single
 * outlier owns the mean. */
export const MIN_CLASS_N = 8;

/** Retweets carry no authored text and, on this source, no view count and no
 * likes of their own — a retweet's likes belong to the original author. They
 * are counted for cadence (they occupy a slot in the day) and excluded from
 * every performance and composition metric, where they would otherwise drag
 * the mean toward zero and make "post less" look like a strategy. */
const RETWEET = 'retweet';

/** Post types that cannot reach a non-follower. X's OONRetweetReplyFilter
 * strips replies and retweets out of the out-of-network candidate set, so
 * output spent here can grow engagement with an existing audience but cannot
 * grow the audience itself. */
const STRANGER_INELIGIBLE = new Set([RETWEET, 'reply']);

const MEDIA_KINDS = ['video', 'image', 'gif', 'none'];

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function round4(n) {
  return n == null ? null : Math.round(n * 10000) / 10000;
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Nearest-rank percentile (no interpolation). p is 0-1. Deliberately simple:
 * these feed human-readable copy-length bands, where interpolating between two
 * real character counts would invent a length no post actually had. */
function percentile(nums, p) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function median(nums) {
  return percentile(nums, 0.5);
}

/** A row is usable if it can be placed in time and carries a like count.
 * Anything else is dropped rather than defaulted — a post counted with 0 likes
 * because the field was missing is indistinguishable from a post that flopped. */
function isUsable(row) {
  return isObj(row)
    && typeof row.type === 'string' && row.type !== ''
    && typeof row.dateLocal === 'string' && row.dateLocal !== ''
    && num(row.likes) != null;
}

function hourOf(row) {
  const h = num(row.hourLocal);
  if (h != null) return Math.trunc(h);
  const m = /^(\d{1,2}):/.exec(String(row.timeLocal ?? ''));
  return m ? Number(m[1]) : null;
}

function engagementOf(row) {
  const explicit = num(row.engagement);
  if (explicit != null) return explicit;
  return (num(row.likes) ?? 0) + (num(row.reposts) ?? 0) + (num(row.replies) ?? 0);
}

/** Pooled engagement rate: total engagement / total views across a set, as a
 * percentage. Preferred over the mean of per-post rates, which a handful of
 * low-view posts inflates badly (1 like on an 18-view post reads as 5.6% and
 * outweighs a 40k-view post). Returns null when no post in the set has views. */
function pooledER(rows) {
  const withViews = rows.filter((r) => (num(r.views) ?? 0) > 0);
  if (!withViews.length) return null;
  const eng = withViews.reduce((a, r) => a + engagementOf(r), 0);
  const views = withViews.reduce((a, r) => a + num(r.views), 0);
  return views === 0 ? null : (eng / views) * 100;
}

function groupBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key == null || key === '') continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(row);
  }
  return out;
}

/** Performance of a subset relative to the whole, on both available bases.
 * `lift` is the one callers should use; `liftER` is reported alongside so a
 * consumer can see whether the two agree. */
function liftBlock(rows, baseAvgLikes, baseER) {
  const avgLikes = mean(rows.map((r) => num(r.likes) ?? 0));
  const er = pooledER(rows);
  return {
    n: rows.length,
    avgLikes: round2(avgLikes),
    pooledER: round2(er),
    lift: baseAvgLikes ? round4(avgLikes / baseAvgLikes) : null,
    liftER: baseER && er != null ? round4(er / baseER) : null,
  };
}

/**
 * Summarize one account's corpus into a comparable stat block.
 *
 * @param {object[]} posts - normalized corpus rows
 * @param {object} [opts]
 * @param {string} [opts.handle] - the account, for labelling only
 * @returns {object} stat block consumed by compare.js
 */
export function summarizeCorpus(posts, opts = {}) {
  const handle = String(opts.handle ?? '').replace(/^@+/, '');
  const rows = (Array.isArray(posts) ? posts : []).filter(isUsable);

  const authored = rows.filter((r) => r.type !== RETWEET);
  const retweets = rows.filter((r) => r.type === RETWEET);

  const activeDays = new Set(rows.map((r) => r.dateLocal));
  const dates = [...activeDays].sort();

  // Views coverage decides whether engagement-rate figures can be trusted at
  // all. A corpus whose views were backfilled for the top-liked posts plus a
  // few controls has a VIEW SAMPLE THAT IS BIASED UPWARD, and its pooled ER is
  // not comparable to one sampled completely. Likes are complete on every row
  // by construction, which is why `lift` is likes-based and ER is secondary.
  const authoredWithViews = authored.filter((r) => num(r.views) != null);
  const viewsCoverage = authored.length ? authoredWithViews.length / authored.length : 0;

  const baseAvgLikes = mean(authored.map((r) => num(r.likes) ?? 0));
  const baseER = pooledER(authored);

  // ---- cadence -----------------------------------------------------------
  // Occupied hours are date+hour cells. This is the measure that corrected the
  // early "spread your posts out" inference: the model account is DENSER per
  // occupied hour, not sparser, so density is not the lever — total volume is,
  // and the hour count follows from it.
  const cells = groupBy(rows, (r) => {
    const h = hourOf(r);
    return h == null ? null : `${r.dateLocal}|${h}`;
  });
  const cellSizes = [...cells.values()].map((c) => c.length);
  const multiCells = cellSizes.filter((n) => n >= 2);
  const postsInMultiHour = multiCells.reduce((a, n) => a + n, 0);

  const cadence = {
    activeDays: activeDays.size,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    postsPerActiveDay: activeDays.size ? round2(rows.length / activeDays.size) : null,
    authoredPerActiveDay: activeDays.size ? round2(authored.length / activeDays.size) : null,
    occupiedHours: cells.size,
    occupiedHoursPerDay: activeDays.size ? round2(cells.size / activeDays.size) : null,
    postsPerOccupiedHour: cells.size ? round2(rows.length / cells.size) : null,
    busiestHour: cellSizes.length ? Math.max(...cellSizes) : 0,
    shareInMultiHour: rows.length ? round2((postsInMultiHour / rows.length) * 100) : null,
  };

  // ---- composition -------------------------------------------------------
  // Type mix is computed over AUTHORED posts and renormalized, so a corpus
  // that is two-thirds retweets does not report every authored type as rare.
  // The retweet share itself is carried separately as `authoredShare`.
  const byType = {};
  for (const [type, list] of groupBy(authored, (r) => r.type)) {
    byType[type] = {
      ...liftBlock(list, baseAvgLikes, baseER),
      share: round2((list.length / authored.length) * 100),
    };
  }

  const byMedia = {};
  for (const kind of MEDIA_KINDS) {
    const list = authored.filter((r) => r.media === kind);
    if (!list.length) continue;
    byMedia[kind] = {
      ...liftBlock(list, baseAvgLikes, baseER),
      share: round2((list.length / authored.length) * 100),
    };
  }

  // Media lift measured WITHIN a type, because the two are confounded: an
  // account whose videos are all showcases and whose text posts are all
  // one-liners would otherwise credit "video" with the showcase effect.
  const mediaWithinType = {};
  for (const [type, list] of groupBy(authored, (r) => r.type)) {
    const typeAvg = mean(list.map((r) => num(r.likes) ?? 0));
    const cell = {};
    for (const kind of MEDIA_KINDS) {
      const sub = list.filter((r) => r.media === kind);
      if (!sub.length) continue;
      const subAvg = mean(sub.map((r) => num(r.likes) ?? 0));
      cell[kind] = {
        n: sub.length,
        avgLikes: round2(subAvg),
        liftWithinType: typeAvg ? round4(subAvg / typeAvg) : null,
      };
    }
    if (Object.keys(cell).length) mediaWithinType[type] = cell;
  }

  const byTopic = {};
  for (const [topic, list] of groupBy(
    authored.flatMap((r) => (Array.isArray(r.topics) ? r.topics.map((t) => ({ ...r, _topic: t })) : [])),
    (r) => r._topic,
  )) {
    byTopic[topic] = {
      ...liftBlock(list, baseAvgLikes, baseER),
      share: round2((list.length / authored.length) * 100),
    };
  }

  // ---- copy length -------------------------------------------------------
  // The band that matters is the one the account's OWN best posts occupy, not
  // the band of everything it published. Top quartile by likes within the
  // type, which is why `topQuartile` is the field compare.js reads.
  const lengthByType = {};
  for (const [type, list] of groupBy(authored, (r) => r.type)) {
    const withChars = list.filter((r) => num(r.chars) != null);
    if (!withChars.length) continue;
    const sortedByLikes = [...withChars].sort((a, b) => (num(b.likes) ?? 0) - (num(a.likes) ?? 0));
    const quartileSize = Math.max(1, Math.ceil(sortedByLikes.length / 4));
    const top = sortedByLikes.slice(0, quartileSize);
    const chars = (set) => set.map((r) => num(r.chars));
    lengthByType[type] = {
      n: withChars.length,
      median: median(chars(withChars)),
      topQuartile: {
        n: top.length,
        p10: percentile(chars(top), 0.1),
        median: median(chars(top)),
        p90: percentile(chars(top), 0.9),
      },
    };
  }

  const strangerEligible = rows.filter((r) => !STRANGER_INELIGIBLE.has(r.type));

  // ---- hour of day -------------------------------------------------------
  // ⚠️ Per-account LOCAL hours. Two accounts in different timezones cannot
  // have their clock hours compared directly, and compare.js does not try —
  // it uses the SHAPE (how many hours, how dense) only. Absolute posting times
  // are an own-account question, answered against this account's own history.
  const byHour = [];
  for (let hour = 0; hour < 24; hour += 1) {
    const list = authored.filter((r) => hourOf(r) === hour);
    byHour.push({ hour, ...liftBlock(list, baseAvgLikes, baseER) });
  }

  return {
    handle,
    posts: rows.length,
    authoredPosts: authored.length,
    retweets: retweets.length,
    dropped: (Array.isArray(posts) ? posts.length : 0) - rows.length,
    authoredShare: rows.length ? round2((authored.length / rows.length) * 100) : null,
    strangerEligibleShare: rows.length ? round2((strangerEligible.length / rows.length) * 100) : null,
    base: {
      avgLikes: round2(baseAvgLikes),
      pooledER: round2(baseER),
      medianViews: median(authoredWithViews.map((r) => num(r.views))),
      viewsCoverage: round4(viewsCoverage),
      // The basis every `lift` in this block is computed on. Likes, always —
      // ER is reported per class but never used as the comparison unit,
      // because view coverage varies by account and by collection method.
      liftBasis: 'avgLikes',
    },
    cadence,
    byType,
    byMedia,
    mediaWithinType,
    byTopic,
    byHour,
    lengthByType,
  };
}
