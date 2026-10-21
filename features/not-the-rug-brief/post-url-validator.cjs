'use strict';

// Shared permalink validator.
// Returns the URL if it looks like a real post permalink for its platform,
// otherwise null. Non-social hosts (news, blogs) are accepted as long as the
// path is non-trivial — bare platform homepages and bare profile roots are
// rejected.
//
// Used by:
//   - features/not-the-rug-brief/xscout.js (strips unverifiable urls from agentData)
//   - app/api/dashboard/brief-preview/route.js (gates which URLs the brief renders)

function validatePostUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try { parsed = new URL(String(rawUrl)); } catch { return null; }
  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname || '/';

  if (host === 'x.com' || host === 'twitter.com') {
    return /^\/[^/]+\/status\/\d+/.test(path) ? rawUrl : null;
  }
  if (host === 'reddit.com' || host === 'old.reddit.com') {
    return /\/r\/[^/]+\/comments\/[^/]+/.test(path) ? rawUrl : null;
  }
  if (host === 'instagram.com') {
    return /^\/(p|reel|tv)\/[^/]+/.test(path) ? rawUrl : null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    return parsed.searchParams.get('v') ? rawUrl : null;
  }
  if (host === 'youtu.be') {
    return /^\/[A-Za-z0-9_-]{5,}/.test(path) ? rawUrl : null;
  }
  if (host === 'tiktok.com') {
    return /\/video\/\d+/.test(path) ? rawUrl : null;
  }
  if (host === 'news.ycombinator.com') {
    return parsed.searchParams.get('id') ? rawUrl : null;
  }
  if (host === 'linkedin.com') {
    return /^\/(posts|feed\/update)\//.test(path) ? rawUrl : null;
  }
  // Non-social hosts (news, blogs, docs): accept any URL whose path is more
  // than a single segment OR has a query string — reject bare homepages.
  if (path === '/' && !parsed.search) return null;
  return rawUrl;
}

// ── Reply-opportunity gate ───────────────────────────────────────────────────
// A reply/engagement opportunity points at a specific external thread or post.
// If nobody can open it, it is not actionable and must never be presented as
// one. Generic content ideas (e.g. signup `opportunityMap` items: topic/whyNow/
// priority/format only) are NOT thread-based and are left alone.

function hasHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const { protocol } = new URL(value.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Thread-based = carries any scout reply-opportunity marker, or has a `url`
// field at all (even null/''): the field exists because a link was expected.
function isThreadOpportunity(item) {
  if (!item || typeof item !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(item, 'url')
    || item.conversation != null
    || item.injectionAngle != null
    || item.suggestedReply != null
    || item.windowHours != null
    || item.raw != null;
}

function isActionableOpportunity(item) {
  if (!item || typeof item !== 'object') return false;
  return !isThreadOpportunity(item) || hasHttpUrl(item.url);
}

// Returns { kept, droppedNoUrl }. Non-arrays pass through as an empty list.
function filterActionableOpportunities(list) {
  const items = Array.isArray(list) ? list : [];
  const kept = items.filter(isActionableOpportunity);
  return { kept, droppedNoUrl: items.length - kept.length };
}

module.exports = {
  validatePostUrl,
  hasHttpUrl,
  isThreadOpportunity,
  isActionableOpportunity,
  filterActionableOpportunities,
};
