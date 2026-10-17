// instrument.js — wrap a twitter-api-v2 client so EVERY v1/v2 call is counted in the ledger.
// Proxy over client.v1 / client.v2 (and readOnly/readWrite views); paginator follow-up pages
// (fetchNext / next ...) are real HTTP calls and are counted too.
import { recordXApiCall } from './ledger.js';

const WRITE_METHOD = /^(tweet|reply|tweetThread|retweet|unretweet|like|unlike|follow|unfollow|block|unblock|mute|unmute|deleteTweet|bookmark|deleteBookmark|uploadMedia|post|put|delete|patch|updateAccountProfile|updateAccountProfileImage|updateAccountProfileBanner|hideReply|createList|updateList|deleteList|quote|sendDm|sendDmInConversation|createDmConversation|uploadMediaV1|createMediaMetadata|updateStatus)$/;

// method name -> [endpoint, kind?]. Unlisted v2 methods fall back to `v2.<name>`.
const V2 = {
  userByUsername: 'users/by/username', usersByUsernames: 'users/by', user: 'users/:id', users: 'users',
  me: 'users/me', userTimeline: 'users/:id/tweets', userMentionTimeline: 'users/:id/mentions',
  homeTimeline: 'users/:id/timelines/reverse_chronological', search: 'tweets/search/recent',
  searchAll: 'tweets/search/all', followers: 'users/:id/followers', following: 'users/:id/following',
  singleTweet: 'tweets/:id', tweets: 'tweets', userLikedTweets: 'users/:id/liked_tweets',
  bookmarks: 'users/:id/bookmarks', tweet: 'tweets', reply: 'tweets', tweetThread: 'tweets', quote: 'tweets',
  retweet: 'users/:id/retweets', unretweet: 'users/:id/retweets/:id', like: 'users/:id/likes', unlike: 'users/:id/likes/:id',
  follow: 'users/:id/following', unfollow: 'users/:id/following/:id', deleteTweet: 'tweets/:id',
  bookmark: 'users/:id/bookmarks', deleteBookmark: 'users/:id/bookmarks/:id', uploadMedia: 'media/upload',
  usage: 'usage/tweets',
};
const V1 = {
  tweet: 'statuses/update', uploadMedia: 'media/upload', verifyCredentials: 'account/verify_credentials',
  updateAccountProfile: 'account/update_profile', createMediaMetadata: 'media/metadata/create',
};

const norm = (p) => String(p || '').replace(/^\/+/, '').replace(/^2\//, '').replace(/\?.*$/, '').replace(/\/\d{4,}(?=\/|$)/g, '/:id').replace(/^users\/\d{4,}/, 'users/:id');

function endpointFor(ns, name, args) {
  if ((name === 'get' || name === 'post' || name === 'put' || name === 'delete' || name === 'patch') && typeof args[0] === 'string') {
    return norm(args[0]);
  }
  return (ns === 'v1' ? V1[name] : V2[name]) || `${ns}.${name}`;
}

const kindFor = (name) => (WRITE_METHOD.test(name) ? 'write' : 'read');

/** posts/users returned by a result (raw JSON, paginator, or single object). */
export function countResult(res) {
  if (res == null) return 0;
  if (Array.isArray(res.tweets)) return res.tweets.length;
  if (Array.isArray(res.users)) return res.users.length;
  const d = res.data;
  if (Array.isArray(d)) return d.length;
  if (d && Array.isArray(d.data)) return d.data.length;
  if (d && typeof d === 'object') return d.id ? 1 : 0;
  if (typeof res.id === 'string') return 1;
  return 0;
}

const PAGE_METHODS = new Set(['fetchNext', 'fetchPrevious', 'fetchLast', 'next', 'previous', 'last']);

function wrapPaginator(p, record) {
  if (!p || typeof p !== 'object' || typeof p.fetchNext !== 'function') return p;
  const proxy = new Proxy(p, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && PAGE_METHODS.has(prop) && typeof v === 'function') {
        return async (...a) => {
          const before = countResult(target);
          let out;
          try { out = await v.apply(target, a); } catch (err) { await record(0, false, err); throw err; }
          const fresh = out === target ? Math.max(0, countResult(target) - before) : countResult(out);
          await record(fresh, true);
          return out === target ? proxy : wrapPaginator(out, record);
        };
      }
      return v;
    },
  });
  return proxy;
}

function wrapNamespace(ns, target, deps) {
  return new Proxy(target, {
    get(t, prop) {
      const v = Reflect.get(t, prop, t);
      if (typeof prop !== 'string' || typeof v !== 'function') return v;
      return async (...args) => {
        const endpoint = endpointFor(ns, prop, args);
        const kind = (ns !== 'v1' && ['post', 'put', 'delete', 'patch'].includes(prop)) ? 'write' : kindFor(prop);
        const record = (posts, ok, err) => deps.record({ endpoint, kind, posts, ok, status: err?.code ?? err?.status });
        let res;
        try { res = await v.apply(t, args); } catch (err) { await record(0, false, err); throw err; }
        await record(kind === 'write' ? 1 : countResult(res), true);
        return wrapPaginator(res, record);
      };
    },
  });
}

const VIEWS = new Set(['readOnly', 'readWrite']);

/** Wrap a TwitterApi instance. Idempotent. `record` is injectable for tests. */
export function instrumentXClient(client, { record = recordXApiCall } = {}) {
  if (!client || client.__xUsageInstrumented) return client;
  const deps = { record };
  const cache = new Map();
  return new Proxy(client, {
    get(t, prop) {
      if (prop === '__xUsageInstrumented') return true;
      const v = Reflect.get(t, prop, t);
      if (prop === 'v1' || prop === 'v2') {
        if (!cache.has(prop)) cache.set(prop, wrapNamespace(prop, v, deps));
        return cache.get(prop);
      }
      if (typeof prop === 'string' && VIEWS.has(prop) && v && typeof v === 'object') {
        if (!cache.has(prop)) cache.set(prop, instrumentXClient(v, { record }));
        return cache.get(prop);
      }
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}
