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

module.exports = { validatePostUrl };
