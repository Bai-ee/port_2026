#!/usr/bin/env node
/**
 * Audience-graph analysis for the X dashboard.
 *
 * Answers one question: how does the follow graph — who follows you, and who
 * you spend your activity on — gate reach, independent of what you post?
 *
 * Reads the two corpora already in docs/audits/ and writes
 * docs/audits/x-audience-graph.json, which is inlined into the `pack` payload
 * of x-dashboard.html.
 *
 * Free. Reads no network. Spends nothing.
 *
 * ⚠️ What this CANNOT see: the follower roster and the following list. Neither
 * is stored anywhere in this repo (x_monitor/{id}/roster has never been
 * synced), and ScrapeCreators has no followers endpoint. Everything here is
 * derived from the OUTBOUND graph — who each account amplifies — plus
 * per-follower reach ratios. Follower *quality* is Phase 2 and needs either
 * the X API (`sync-audience`, ~2 calls) or the bird CLI.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

const OUT_PATH = path.join(REPO_ROOT, 'docs/audits/x-audience-graph.json');

const ACCOUNTS = [
  { key: 'seb', handle: 'seb__design', followers: 1549, corpus: 'docs/audits/seb-design-x-corpus.json' },
  { key: 'baiee', handle: 'bai_ee', followers: 1725, corpus: 'docs/audits/bai-ee-x-corpus.json' },
];

const WINDOW = { start: '2026-07-07', end: '2026-09-10' };

/** Retweet captions keep the original author in `RT @handle:` form. */
const RT_AUTHOR = /^RT @([A-Za-z0-9_]+)/;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * The account an entry hands its distribution to. A quote carries its target in
 * `quotedAuthor`; a retweet only carries it in the caption.
 */
function amplifiedHandle(post) {
  if (post.quotedAuthor) return String(post.quotedAuthor).replace(/^@/, '');
  const m = RT_AUTHOR.exec(post.text || '');
  return m ? m[1] : null;
}

function buildAmplification(posts, selfHandle) {
  const tally = new Map();
  for (const p of posts) {
    const h = amplifiedHandle(p);
    if (!h) continue;
    const row = tally.get(h) || { handle: h, n: 0, types: {} };
    row.n += 1;
    row.types[p.type] = (row.types[p.type] || 0) + 1;
    tally.set(h, row);
  }

  const self = tally.get(selfHandle) || null;
  // Self-quoting is resurfacing your own work, not amplifying someone else's.
  // It belongs in its own number, not in the concentration figures.
  const external = [...tally.values()]
    .filter((r) => r.handle.toLowerCase() !== selfHandle.toLowerCase())
    .sort((a, b) => b.n - a.n);

  const spent = external.reduce((sum, r) => sum + r.n, 0);
  const top5 = external.slice(0, 5).reduce((sum, r) => sum + r.n, 0);
  const onceOnly = external.filter((r) => r.n === 1).length;

  // The same act — handing someone else's post to your audience — ships in two
  // vehicles with opposite distribution. A quote is a new post of your own and
  // can reach strangers; a retweet is stripped for non-followers by
  // OONRetweetReplyFilter. This split is the difference that matters.
  const vehicles = { quote: 0, retweet: 0 };
  for (const r of external) {
    for (const [type, n] of Object.entries(r.types)) {
      if (type === 'retweet') vehicles.retweet += n;
      else if (type.startsWith('quote')) vehicles.quote += n;
    }
  }
  const vehicleTotal = vehicles.quote + vehicles.retweet;

  return {
    viaQuote: vehicles.quote,
    viaRetweet: vehicles.retweet,
    quoteSharePct: vehicleTotal ? round2((100 * vehicles.quote) / vehicleTotal) : 0,
    distinctAccounts: external.length,
    postsSpent: spent,
    onceOnly,
    onceOnlyShare: external.length ? round2((100 * onceOnly) / external.length) : 0,
    repeat3Plus: external.filter((r) => r.n >= 3).length,
    top5Share: spent ? round2((100 * top5) / spent) : 0,
    selfQuotes: self ? self.n : 0,
    topTargets: external.slice(0, 8).map((r) => ({ handle: r.handle, n: r.n, types: r.types })),
  };
}

function buildActivity(posts) {
  const retweets = posts.filter((p) => p.type === 'retweet');
  const authored = posts.filter((p) => p.type !== 'retweet');
  const rtWithViews = retweets.filter((p) => p.views != null && p.views > 0);

  return {
    total: posts.length,
    authored: authored.length,
    retweets: retweets.length,
    retweetShare: posts.length ? round2((100 * retweets.length) / posts.length) : 0,
    // A retweet's impressions are credited to the original author. If this is
    // ever non-zero the claim on the dashboard has to be restated.
    retweetsWithOwnViews: rtWithViews.length,
  };
}

function buildReach(posts, followers) {
  const authored = posts.filter((p) => p.type !== 'retweet');
  const likes = authored.map((p) => Number(p.likes) || 0);
  const avgLikes = likes.length ? likes.reduce((a, b) => a + b, 0) / likes.length : 0;

  const viewed = authored.filter((p) => p.views != null && p.views > 0);
  const medViews = median(viewed.map((p) => p.views));

  return {
    authoredPosts: authored.length,
    avgLikesAuthored: round2(avgLikes),
    // Complete data on both accounts — every post carries a like count. This is
    // the comparison that is safe to make.
    likesPerFollowerPct: followers ? round2((100 * avgLikes) / followers) : 0,
    medianViewsAuthored: medViews,
    viewsResolved: viewed.length,
    viewsCoveragePct: authored.length ? round2((100 * viewed.length) / authored.length) : 0,
    // ⚠️ Only safe where view coverage is near-complete. seb's views are a
    // top-weighted sample, so his figure is an upper bound, not a measurement.
    viewsPerFollowerPct: followers && medViews != null ? round2((100 * medViews) / followers) : null,
  };
}

function main() {
  const out = {
    generatedAt: new Date().toISOString(),
    window: WINDOW,
    method:
      'Outbound amplification graph derived from post captions and quotedAuthor. ' +
      'Follower roster and following list are NOT available — see the caveat in the dashboard section.',
    accounts: {},
  };

  for (const acct of ACCOUNTS) {
    const posts = JSON.parse(readFileSync(path.join(REPO_ROOT, acct.corpus), 'utf8'));
    out.accounts[acct.key] = {
      handle: acct.handle,
      followers: acct.followers,
      amplification: buildAmplification(posts, acct.handle),
      activity: buildActivity(posts),
      reach: buildReach(posts, acct.followers),
    };
  }

  const s = out.accounts.seb;
  const b = out.accounts.baiee;
  out.ratios = {
    likesPerFollower: b.reach.likesPerFollowerPct
      ? round2(s.reach.likesPerFollowerPct / b.reach.likesPerFollowerPct)
      : null,
    followerCount: round2(b.followers / s.followers),
    selfQuoteGap: b.amplification.selfQuotes
      ? round2(s.amplification.selfQuotes / b.amplification.selfQuotes)
      : s.amplification.selfQuotes,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log('wrote', path.relative(REPO_ROOT, OUT_PATH));
  for (const [key, a] of Object.entries(out.accounts)) {
    console.log(
      `  @${a.handle}: ${a.followers} followers · ` +
        `${a.amplification.distinctAccounts} amplified (${a.amplification.onceOnly} once-only, ` +
        `top5 ${a.amplification.top5Share}%) · self-quotes ${a.amplification.selfQuotes} · ` +
        `RT share ${a.activity.retweetShare}% · ` +
        `likes/follower ${a.reach.likesPerFollowerPct}% · ` +
        `views coverage ${a.reach.viewsCoveragePct}%`
    );
  }
  console.log(`  gap: seb earns ${out.ratios.likesPerFollower}x the likes per follower`);
}

main();
