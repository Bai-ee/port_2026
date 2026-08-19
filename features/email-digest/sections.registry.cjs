'use strict';

// sections.registry.cjs — the ONE section-definition array for the daily
// digest email. Single source of truth for: features/intelligence/
// _digest-config.js's INCLUDE_KEYS/DEFAULT_INCLUDE/ORDERABLE_KEYS, render.js's
// per-group render dispatch arrays, and AdminEmailModals.jsx's SECTION_GROUPS
// UI rows. Deliberately a PLAIN CJS module with zero requires/imports and no
// Node-only APIs — safe to `require()` from CJS, `import` from ESM (Next/Node
// both interop a dependency-free CJS module transparently), and bundle into a
// CLIENT component (AdminEmailModals.jsx is a client component; it cannot
// import _digest-config.js directly — that module requires firebase-admin.cjs
// at its top level).
//
// Row order is LOAD-BEARING: it is the fallback render order (DEFAULT_ORDER)
// whenever a client has no saved custom order. Do not reorder rows without
// re-running the render.js characterization tests — they will fail loudly
// (features/email-digest/__fixtures__/01-default-config.html encodes the
// current order).
//
// Field meaning:
//   key          INCLUDE_KEYS entry / render dispatch key / order key.
//   uiLabel      AdminEmailModals SETTINGS-tab row label. Every key has one
//                as of 2026-08-19 (opportunitySignals previously had none —
//                a pre-existing gap, fixed alongside Phase 3).
//   uiHint       AdminEmailModals row description. null when uiLabel is null.
//   uiGroup      AdminEmailModals SECTION_GROUPS group label. null when
//                uiLabel is null.
//   relatedCardId  Optional dashboard card id this section's data comes from
//                (the AdminEmailModals row's 4th tuple element today, e.g.
//                'signals', 'video-remix', 'calendar-connect',
//                'onboarding-brief'). null when not applicable.
//   platformIcon 'x' | 'reddit' | 'instagram' | null — only the four
//                platform-sourced Market Signals rows carry this.
//   renderGroup  Which of render.js's 8 render-dispatch groups this section
//                belongs to (topOfEmail/today/postContent/marketSignals/
//                creative/webPerf/platform/ops), or null for the two CTA
//                keys (execBriefLink/contactHuman), which render via the
//                separate ctaRow path, not the RENDER-map/renderGroup path —
//                per the agreed schema, CTAs stay outside the registry's
//                render-dispatch concern even though they're listed here for
//                INCLUDE_KEYS/defaultOn/orderable completeness.
//   defaultOn    DEFAULT_INCLUDE value for a brand-new config.
//   orderable    false only for execBriefLink/contactHuman (ORDERABLE_KEYS
//                excludes them — they render via the fixed top/bottom CTA
//                row, not the shuffleable section flow).
//   uiOrder      AdminEmailModals SETTINGS-tab row sequence. INDEPENDENT of
//                this array's own row order: the array order below matches
//                INCLUDE_KEYS (load-bearing for DEFAULT_ORDER/render order),
//                but the UI's presentation order is genuinely different —
//                e.g. followerPosts renders early in the email but is listed
//                LAST in its Market Signals brief settings group. Deriving
//                SECTION_GROUPS must sort by uiOrder, not array position.
//                Groups themselves sort by their members' minimum uiOrder.
//                null when uiLabel is null (no UI row).

const SECTIONS = [
  { key: 'execBriefLink', uiLabel: 'Executive Brief link', uiHint: 'The “Open Executive Brief” button', uiGroup: 'Call to action', relatedCardId: null, platformIcon: null, renderGroup: null, defaultOn: true, orderable: false, uiOrder: 5 },
  { key: 'contactHuman', uiLabel: 'Contact Your Human', uiHint: 'CTA → your booking link (Calendly)', uiGroup: 'Call to action', relatedCardId: null, platformIcon: null, renderGroup: null, defaultOn: true, orderable: false, uiOrder: 6 },
  { key: 'execSummary', uiLabel: 'Executive summary', uiHint: 'The “Today” callout summary', uiGroup: 'Executive Summary', relatedCardId: null, platformIcon: null, renderGroup: 'today', defaultOn: true, orderable: true, uiOrder: 2 },
  { key: 'videoPosts', uiLabel: 'Video Remix Post', uiHint: 'Latest remix video + X promo post', uiGroup: 'Post Content', relatedCardId: 'video-remix', platformIcon: null, renderGroup: 'postContent', defaultOn: true, orderable: true, uiOrder: 3 },
  { key: 'videoPromo', uiLabel: 'Video Promo Post', uiHint: 'Latest Video Promo (mockup) + X post', uiGroup: 'Post Content', relatedCardId: null, platformIcon: null, renderGroup: 'postContent', defaultOn: true, orderable: true, uiOrder: 4 },
  { key: 'agenda', uiLabel: 'Calendar Agenda', uiHint: 'Up to 5 days of events', uiGroup: 'Top of email', relatedCardId: 'calendar-connect', platformIcon: null, renderGroup: 'topOfEmail', defaultOn: true, orderable: true, uiOrder: 0 },
  { key: 'weather', uiLabel: 'Weather', uiHint: 'Local forecast (today + 3-day)', uiGroup: 'Top of email', relatedCardId: null, platformIcon: null, renderGroup: 'topOfEmail', defaultOn: true, orderable: true, uiOrder: 1 },
  { key: 'followerPosts', uiLabel: 'Follower Posts', uiHint: '1 post from each followed handle', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: true, orderable: true, uiOrder: 20 },
  { key: 'watchlist', uiLabel: 'Happening on X', uiHint: 'Watchlist analysis', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: 'x', renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 15 },
  { key: 'redditAnalysis', uiLabel: 'Happening on Reddit', uiHint: 'Reddit platform analysis', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: 'reddit', renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 16 },
  { key: 'instagramAnalysis', uiLabel: 'Happening on Instagram', uiHint: 'Instagram platform analysis', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: 'instagram', renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 17 },
  { key: 'xMarketTalk', uiLabel: 'Market Talk on X', uiHint: 'What the market is saying about you on X — a brand-handle search. Paid X API; runs on Generate & Send only.', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: 'x', renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 18 },
  { key: 'opportunitySignals', uiLabel: 'Opportunity Signals', uiHint: 'Public buying-signal opportunities scan — trigger, problem, and response angle per match', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 19 },
  { key: 'creativeBrief', uiLabel: 'Creative cover', uiHint: 'Creative assets of the day', uiGroup: 'Creative brief', relatedCardId: 'onboarding-brief', platformIcon: null, renderGroup: 'creative', defaultOn: false, orderable: true, uiOrder: 21 },
  { key: 'humanBrief', uiLabel: 'Human Brief', uiHint: 'The strategist’s opening blurb', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 7 },
  { key: 'opportunities', uiLabel: 'Post Opportunities', uiHint: 'Conversation / angle to enter', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 8 },
  { key: 'suggestedReplies', uiLabel: 'Suggested Replies', uiHint: 'Drafted reply per opportunity', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: true, orderable: true, uiOrder: 9 },
  { key: 'signals', uiLabel: 'Signals', uiHint: 'KOLs, competitors, narratives', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 10 },
  { key: 'pressCoverage', uiLabel: 'Press Coverage', uiHint: 'Articles about you, competitors, or the category — each with a working link', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: true, orderable: true, uiOrder: 11 },
  { key: 'watchlistAccounts', uiLabel: 'Watchlist Accounts', uiHint: 'Tracked accounts, name-for-name', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 12 },
  { key: 'suggestedPosts', uiLabel: 'Suggested Posts', uiHint: 'Drafted posts for today', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 13 },
  { key: 'planPreview', uiLabel: '30-Day Plan', uiHint: 'Upcoming scheduled posts', uiGroup: 'Market Signals brief', relatedCardId: 'signals', platformIcon: null, renderGroup: 'marketSignals', defaultOn: false, orderable: true, uiOrder: 14 },
  { key: 'platformOverview', uiLabel: 'Platform Overview', uiHint: 'Sign-ups, users, dashboards', uiGroup: 'Platform', relatedCardId: null, platformIcon: null, renderGroup: 'platform', defaultOn: false, orderable: true, uiOrder: 27 },
  { key: 'ga4Traffic', uiLabel: 'GA4 Traffic', uiHint: 'Sessions, views, bounce', uiGroup: 'Web Performance', relatedCardId: null, platformIcon: null, renderGroup: 'webPerf', defaultOn: false, orderable: true, uiOrder: 22 },
  { key: 'topPages', uiLabel: 'Top Pages', uiHint: 'Most-viewed pages', uiGroup: 'Web Performance', relatedCardId: null, platformIcon: null, renderGroup: 'webPerf', defaultOn: false, orderable: true, uiOrder: 23 },
  { key: 'trafficSources', uiLabel: 'Traffic Sources', uiHint: 'Source / medium', uiGroup: 'Web Performance', relatedCardId: null, platformIcon: null, renderGroup: 'webPerf', defaultOn: false, orderable: true, uiOrder: 24 },
  { key: 'keyEvents', uiLabel: 'Key Events', uiHint: 'Tracked GA4 events', uiGroup: 'Web Performance', relatedCardId: null, platformIcon: null, renderGroup: 'webPerf', defaultOn: false, orderable: true, uiOrder: 25 },
  { key: 'homepage', uiLabel: 'Homepage Activity', uiHint: 'Clicks, scroll, web vitals', uiGroup: 'Web Performance', relatedCardId: null, platformIcon: null, renderGroup: 'webPerf', defaultOn: false, orderable: true, uiOrder: 26 },
  { key: 'signups', uiLabel: 'New Sign-ups', uiHint: 'Recent user table', uiGroup: 'Platform', relatedCardId: null, platformIcon: null, renderGroup: 'platform', defaultOn: true, orderable: true, uiOrder: 28 },
  { key: 'dashboards', uiLabel: 'Dashboards', uiHint: 'Recent brief runs', uiGroup: 'Platform', relatedCardId: null, platformIcon: null, renderGroup: 'platform', defaultOn: false, orderable: true, uiOrder: 29 },
  { key: 'pipeline', uiLabel: 'Pipeline Status', uiHint: 'Run status breakdown', uiGroup: 'Platform', relatedCardId: null, platformIcon: null, renderGroup: 'platform', defaultOn: false, orderable: true, uiOrder: 30 },
  { key: 'deployments', uiLabel: 'Deployments', uiHint: 'Vercel deploys', uiGroup: 'Deployments', relatedCardId: null, platformIcon: null, renderGroup: 'ops', defaultOn: false, orderable: true, uiOrder: 31 },
  { key: 'runtimeErrors', uiLabel: 'Runtime Errors', uiHint: 'Vercel error logs', uiGroup: 'Deployments', relatedCardId: null, platformIcon: null, renderGroup: 'ops', defaultOn: false, orderable: true, uiOrder: 32 },
];

// UI group presentation sequence (Top of email, Executive Summary, Post
// Content, Call to action, Market Signals brief, Creative brief, Web
// Performance, Platform, Deployments) — reproducible by sorting each
// uiLabel-having row's uiGroup by the group's minimum uiOrder, but exported
// explicitly so consumers don't have to recompute it.
const UI_GROUP_ORDER = [
  'Top of email', 'Executive Summary', 'Post Content', 'Call to action',
  'Market Signals brief', 'Creative brief', 'Web Performance', 'Platform', 'Deployments',
];

module.exports = { SECTIONS, UI_GROUP_ORDER };
