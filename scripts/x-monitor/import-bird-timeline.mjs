#!/usr/bin/env node
// import-bird-timeline.mjs — seed the X Monitor post table for FREE.
//
// The card's own "Posts only" sync reads the X API, which is metered and only
// serves the last ~100 posts (impressions only within 30 days). The `bird` CLI
// reads the same timeline through x.com's web GraphQL using your browser
// cookies, at zero cost and ~800 posts deep — so this script exists to backfill
// history the API will not give you cheaply.
//
// It writes into the SAME Firestore store the card reads
// (features/x-monitor/store.js), and writePosts merges metric keys, so a later
// metered sync that brings real impressions will NOT be overwritten by this
// import, and this import will not erase impressions already stored.
//
// Zero X API calls. Zero ScrapeCreators credits. Nothing is posted.
//
// Usage:
//   1. Produce a corpus with the existing research puller (free):
//        node scripts/x-content/research/pull-timeline.mjs @bai_ee 2026-01-01T00:00:00Z
//      (writes seb-corpus.json next to that script — pass its path below)
//   2. Preview what would be written (default — writes nothing):
//        node scripts/x-monitor/import-bird-timeline.mjs --corpus <path>
//   3. Commit it:
//        node scripts/x-monitor/import-bird-timeline.mjs --corpus <path> --write
//
// Options:
//   --corpus <path>   bird corpus JSON (array of tweets). Required.
//   --views <path>    optional {tweetId: viewCount} map from
//                     scripts/x-content/research/backfill-views.mjs
//   --handle <name>   override the handle used to build post URLs
//   --limit <n>       only import the n most recent posts
//   --write           actually write to Firestore (default is a dry run)

import fs from 'node:fs';
import path from 'node:path';
import { getXOAuthStatus } from '../../features/social-posting/x-oauth.js';
import { writePosts } from '../../features/x-monitor/store.js';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const has = (name) => process.argv.includes(`--${name}`);

const corpusPath = arg('corpus');
const viewsPath = arg('views');
const limit = Number(arg('limit', 0)) || 0;
const write = has('write');

if (!corpusPath) {
  console.error('--corpus <path> is required (see the usage block at the top of this file).');
  process.exit(1);
}

const corpus = JSON.parse(fs.readFileSync(path.resolve(corpusPath), 'utf8'));
if (!Array.isArray(corpus)) {
  console.error('Corpus must be a JSON array of tweets, as written by pull-timeline.mjs.');
  process.exit(1);
}
const views = viewsPath ? JSON.parse(fs.readFileSync(path.resolve(viewsPath), 'utf8')) : {};

// Free: reads the stored OAuth record, no network call to X.
const status = await getXOAuthStatus();
if (!status.connected || !status.userId) {
  console.error('No X account is connected — connect one in the X Monitor card first.');
  process.exit(1);
}
const accountId = String(status.userId);
const handle = String(arg('handle', status.username || '')).replace(/^@/, '');

function kindOf(tweet) {
  if (tweet.inReplyToStatusId) return 'reply';
  if (tweet.quotedTweet) return 'quote';
  return 'post';
}

const own = corpus.filter((t) => t?.id && !/^RT @/.test(t.text || ''));
own.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
const selected = limit ? own.slice(0, limit) : own;

const posts = selected.map((tweet) => {
  const viewCount = Number(views[tweet.id]);
  return {
    id: String(tweet.id),
    text: String(tweet.text || ''),
    url: handle ? `https://x.com/${handle}/status/${tweet.id}` : `https://x.com/i/web/status/${tweet.id}`,
    createdAt: tweet.createdAt || null,
    kind: kindOf(tweet),
    metricsSource: 'bird',
    metrics: {
      likes: Number(tweet.likeCount) || 0,
      retweets: Number(tweet.retweetCount) || 0,
      replies: Number(tweet.replyCount) || 0,
      quotes: Number(tweet.quoteCount) || 0,
      bookmarks: Number(tweet.bookmarkCount) || 0,
      // Views are only present when backfill-views.mjs was run (1 credit/post).
      // Left undefined otherwise so writePosts does not clobber a real
      // impressions reading from a metered sync.
      ...(Number.isFinite(viewCount) ? { impressions: viewCount } : {}),
    },
  };
});

const oldest = posts[posts.length - 1]?.createdAt;
const newest = posts[0]?.createdAt;
const withViews = posts.filter((p) => p.metrics.impressions != null).length;

console.error(`account   : ${accountId}${handle ? ` (@${handle})` : ''}`);
console.error(`corpus    : ${corpus.length} tweets → ${posts.length} own posts (retweets skipped)`);
console.error(`range     : ${oldest || 'n/a'} → ${newest || 'n/a'}`);
console.error(`views     : ${withViews} of ${posts.length} carry a view count`);

if (!write) {
  console.error('\nDRY RUN — nothing written. Re-run with --write to commit.');
  process.exit(0);
}

const result = await writePosts(accountId, posts);
console.error(`\nwrote ${result.written} posts into x_monitor/${accountId}/posts`);
