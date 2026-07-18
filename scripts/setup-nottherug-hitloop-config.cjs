#!/usr/bin/env node
// One-off setup for the HITLOOP Not The Rug client.
// Applies NTR-specific Firestore config while keeping daily sends disabled.

require('../features/not-the-rug-brief/load-env');

const fb = require('../api/_lib/firebase-admin.cjs');
const { buildRuntimeConfigFromFirestore } = require('../features/not-the-rug-brief/config-loader');
const digestConfig = require('../features/intelligence/_digest-config.js');

const CLIENT_ID = process.argv[2] || 'nottherug-ten-QSMYxuuv';

const ntrSearches = [
  {
    label: 'BRAND + LOCAL WEB',
    query: '"Not The Rug" OR nottherug.com OR "Williamsburg dog walking" OR "Brooklyn dog walker" OR "Greenpoint dog walker" OR site:reddit.com/r/williamsburg "Not The Rug" OR site:reddit.com/r/Brooklyn "Not The Rug"',
    goal: 'Find direct brand mentions, local listicles, neighborhood content, Reddit mentions, and organic search-result opportunities.',
  },
  {
    label: 'COMPETITOR REVIEWS + POSITIONING',
    query: 'Rover OR Wag OR Swifto OR POOCHi OR "Happy Pants NYC" OR "Spot Dog Walkers" reviews Brooklyn OR NYC dog walker',
    goal: 'Find review themes, complaints, trust gaps, and competitor positioning language from review pages, local directories, and service pages.',
  },
  {
    label: 'LOCAL EVENTS + DOG HOLIDAYS',
    query: '"Williamsburg Brooklyn events this week" OR "Brooklyn dog events" OR "National Dog Day" OR "National Pet Day" OR "National Puppy Day"',
    goal: 'Find real upcoming events, neighborhood disruptions, or dog-related calendar hooks that can drive content or operations.',
  },
  {
    label: 'LOCAL DEMAND + REDDIT',
    query: 'site:reddit.com/r/williamsburg "dog walker" OR site:reddit.com/r/Brooklyn "dog walker" OR site:reddit.com/r/AskNYC "dog walker" Brooklyn OR site:reddit.com/r/nyc Rover Williamsburg OR site:reddit.com/r/nyc Wag Brooklyn OR site:reddit.com/r/dogs "dog walker" NYC',
    goal: 'Find real buyer questions, neighborhood pain points, pricing objections, recommendation threads, and local Reddit participation opportunities.',
  },
  {
    label: 'OPERATOR + INDUSTRY INTEL',
    query: 'site:timetopet.com dog walking OR site:petsitters.org pet sitter OR site:americanpetproducts.org pet industry OR "Google Business Profile" dog walker',
    goal: 'Find operator-side trends, local SEO opportunities, software/process shifts, and pet-industry demand signals.',
  },
];

const ntrAgentDataTemplate = `{
  "runMeta": {
    "timestamp": "<ISO-8601>",
    "freshnessWindowDays": 7,
    "queryTrace": ["<exact query string used for each search>"]
  },
  "emptySections": ["<sections searched but not found>"],
  "brandMentions": [{"source":"...","author":"...","content":"...","sentiment":"positive|neutral|negative","reach":"high|medium|low","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post/article permalink>"}],
  "competitorIntel": [{"competitor":"...","finding":"...","impact":"high|medium|low","signalType":"LIVE|BACKGROUND","ageHours":0,"url":"<post/article permalink>"}],
  "categoryTrends": [{"trend":"...","relevance":"high|medium|low","detail":"...","ageHours":0,"url":"<post/article permalink, optional>"}],
  "weatherImpact": null,
  "localEvents": [{"event":"...","date":"...","impact":"...","opportunity":"...","url":"..."}],
  "redditSignals": [{"title":"...","subreddit":"...","signalType":"brand_mention|recommendation_thread|pain_point|participation_opportunity","summary":"...","actionableTakeaway":"...","url":"..."}],
  "localDemandSignals": [{"signal":"...","relevance":"high|medium|low","detail":"..."}],
  "reviewInsights": [{"source":"...","insight":"...","sentiment":"positive|neutral|negative","actionableTakeaway":"...","url":"..."}],
  "partnershipOpportunities": [{"partner":"...","type":"referral|community|creator|local_business","finding":"...","priority":"high|medium|low","url":"..."}],
  "escalations": [{"level":"CRITICAL|IMPORTANT|QUIET","status":"NEW|CHANGED|ESCALATED|RESOLVED","summary":"...","url":"<source permalink, optional>"}],
  "viralOpportunities": {
    "found": true,
    "opportunities": [{"conversation":"...","url":"<specific thread/post permalink>","injectionAngle":"...","authenticity":"high|medium|low","windowHours":0,"suggestedReply":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  },
  "contentOpportunities": {
    "found": true,
    "opportunities": [{"topic":"...","whyNow":"...","format":"...","priority":"high|medium|low","source":"...","url":"..."}],
    "searchedFor": ["trigger 1","trigger 2"]
  }
}`;

const ntrBrandKeywords = [
  '"Not The Rug"',
  'nottherug.com',
  'Williamsburg dog walking',
  'Brooklyn dog walker',
  'Greenpoint dog walker',
];

const ntrCategoryTerms = [
  'dog walking industry trends 2026',
  'pet care business news',
  'NYC dog walking',
  'Brooklyn dog owner trends',
  'pet services local SEO',
  'dog walking app updates',
  'pet care consumer trends',
  'Williamsburg Brooklyn pets',
];

const ntrCompetitors = [
  'Rover',
  'Wag',
  'Swifto',
  'POOCHi',
  'Happy Pants NYC',
  'Spot Dog Walkers',
  'Strutting Mutts',
  'Williamsburg Dog Walking',
  'Dogger NYC',
  'Brooklyn Bark',
];

const ntrReddit = {
  provider: 'web-search',
  subreddits: ['williamsburg', 'Brooklyn', 'AskNYC', 'nyc', 'dogs', 'puppy101'],
  mentionQueries: ['"Not The Rug"', 'nottherug'],
  opportunityQueries: ['"dog walker"', '"dog walking"', 'Rover', 'Wag', '"dog boarding"', '"Brooklyn dog walker"', '"Williamsburg dog walker"'],
};

const ntrWeatherScout = {
  provider: 'nws',
  operationalWindowStartHour: 7,
  operationalWindowHours: 12,
  serviceNeighborhoods: [{ name: 'Brooklyn', latitude: 40.7184, longitude: -73.9571 }],
  thresholds: {
    heatWatchTempF: 80,
    heatRiskTempF: 85,
    coldRiskTempF: 35,
    highRainChancePct: 50,
    moderateRainChancePct: 30,
    windyMph: 18,
  },
};

const ntrReviews = {
  provider: 'web-search',
  sources: [{
    key: 'yelp',
    label: 'Yelp',
    query: '"site:yelp.com/biz/not-the-rug-brooklyn" OR "Not The Rug Yelp Brooklyn"',
  }],
};

const ntrMarketingPatch = {
  enabled: true,
  brandName: 'Not The Rug',
  brandKeywords: ntrBrandKeywords,
  categoryTerms: ntrCategoryTerms,
  competitors: ntrCompetitors,
  kols: [],
  instagramHandles: ['nottherug'],
  sourcePlatforms: ['web', 'reddit', 'instagram'],
  searches: ntrSearches,
  sourceFocus: 'Focus on pet care industry news, local Brooklyn and NYC dog-owner conversations, neighborhood trends, reviews, and service-business opportunities that can drive bookings or organic reach.',
  scoutInstructions: 'Prioritize high-trust local service signals: neighborhood conversations, platform shifts, seasonal pet-safety topics, SEO/content gaps, referral or partnership opportunities, and the exact language buyers use when choosing a dog walker. Treat Reddit as a primary source for recommendation threads, buyer pain points, and neighborhood participation opportunities. Surface Reddit only when the thread is recent enough and specific enough to matter. Separate LIVE signals from BACKGROUND context, and never fabricate local events, weather details, reviews, or competitor claims.',
  agentDataTemplate: ntrAgentDataTemplate,
  freshnessDays: 7,
  kolSearchMode: 'per-handle',
  scribeTone: 'Tone: warm, local, trustworthy, lightly funny, never corporate. Write like a sharp local marketing advisor for a Williamsburg dog walking business. Never use guilt-based fear tactics, generic startup jargon, fake luxury language, or unsupported urgency.',
  scribeHardConstraints: [
    "Every piece connects to Scout's priority action",
    'Zero live signal = create useful or local signal, not vague filler',
    'Do not imply veterinary, behavioral, or medical expertise unless surfaced in the brief',
    'Do not invent client stories, review quotes, certifications, or safety claims',
    'Keep the voice human and neighborhood-specific, not platform-generic',
    'Avoid dunking on competitors by name unless Scout surfaced a clearly newsworthy comparison',
    'Prefer "founded in 2011" or "since 2011" over hardcoding the business age unless the current age is explicitly provided',
    'Do not claim "same walker every time", "never a stranger", or any no-substitution absolute unless the brief explicitly verifies that guarantee',
    'Prefer "consistent walker relationships", "familiar walker", or "known team" over absolutes',
    'Each output must be complete and ready to copy-paste',
  ],
  includeClientBrain: true,
  guardianReviewerContext: 'Not The Rug — a Williamsburg, Brooklyn dog walking and pet care business. Review for factual accuracy, local specificity, brand voice, and unsupported service claims.',
  guardianRestrictedPatterns: [
    'insured and bonded',
    'veterinarian approved',
    'guaranteed same walker every time',
    '24/7 availability',
  ],
  analysisRecipes: ['reddit-analysis', 'instagram-analysis', 'customer-research'],
  calendar: { enabled: false },
  watchlistDetail: { tweets: false, mentions: false, latestOnly: true },
  localSignals: [
    'Williamsburg and Greenpoint dog owners value familiar walkers, clear updates, and reliability over app-style convenience.',
    'Weather and street-level neighborhood conditions can be valid daily content hooks when sourced from live data.',
    'Trust signals should be operational: small groups, GPS tracking, photos, walk reports, meet-and-greet, and familiar walker relationships.',
  ],
};

const ntrScoutPatch = {
  clientName: 'Not The Rug',
  brandKeywords: ntrBrandKeywords,
  categoryTerms: ntrCategoryTerms,
  competitors: ntrCompetitors,
  kols: [],
  weather: ntrWeatherScout,
  reviews: ntrReviews,
  reddit: ntrReddit,
  instagram: {
    provider: 'search',
    handles: ['nottherug'],
    recentMediaLimit: 6,
  },
  scout: {
    freshnessDays: 7,
    sourceFocus: ntrMarketingPatch.sourceFocus,
    analysisInstructions: ntrMarketingPatch.scoutInstructions,
    preferredSources: ['Instagram', 'Reddit', 'Google reviews', 'Google Trends', 'TikTok', 'Meta Ad Library', 'NAPPS', 'APPA', 'Time To Pet', 'local blogs'],
    deprioritizedSources: ['X/Twitter'],
    searchPlan: ntrSearches,
    agentDataTemplate: ntrAgentDataTemplate,
  },
};

const digestIncludePatch = {
  execBriefLink: false,
  contactHuman: true,
  execSummary: true,
  videoPosts: false,
  videoPromo: false,
  agenda: false,
  weather: true,
  followerPosts: false,
  watchlist: false,
  redditAnalysis: true,
  instagramAnalysis: true,
  creativeBrief: false,
  humanBrief: true,
  opportunities: true,
  suggestedReplies: true,
  signals: true,
  watchlistAccounts: false,
  suggestedPosts: true,
  planPreview: false,
  platformOverview: false,
  ga4Traffic: false,
  topPages: false,
  trafficSources: false,
  keyEvents: false,
  homepage: false,
  signups: false,
  dashboards: false,
  pipeline: false,
  deployments: false,
  runtimeErrors: false,
};

const digestOrder = [
  'weather',
  'execSummary',
  'humanBrief',
  'opportunities',
  'suggestedReplies',
  'signals',
  'redditAnalysis',
  'instagramAnalysis',
  'suggestedPosts',
  'videoPosts',
  'videoPromo',
  'agenda',
  'followerPosts',
  'watchlist',
  'creativeBrief',
  'watchlistAccounts',
  'planPreview',
  'platformOverview',
  'ga4Traffic',
  'topPages',
  'trafficSources',
  'keyEvents',
  'homepage',
  'signups',
  'dashboards',
  'pipeline',
  'deployments',
  'runtimeErrors',
];

async function readDoc(path) {
  const [collection, docId, subcollection, subdoc] = path;
  const ref = subcollection
    ? fb.adminDb.collection(collection).doc(docId).collection(subcollection).doc(subdoc)
    : fb.adminDb.collection(collection).doc(docId);
  const snap = await ref.get();
  return { exists: snap.exists, data: snap.exists ? snap.data() : null };
}

async function main() {
  const clientConfigRef = fb.adminDb.collection('client_configs').doc(CLIENT_ID);
  const digestRef = fb.adminDb.collection('digest_config').doc(CLIENT_ID);
  const clientRef = fb.adminDb.collection('clients').doc(CLIENT_ID);

  const [clientConfigSnap, digestSnap, clientSnap, brainSnap] = await Promise.all([
    readDoc(['client_configs', CLIENT_ID]),
    readDoc(['digest_config', CLIENT_ID]),
    readDoc(['clients', CLIENT_ID]),
    readDoc(['clients', CLIENT_ID, 'client_brain', 'current']),
  ]);

  if (!clientConfigSnap.exists) throw new Error(`client_configs/${CLIENT_ID} not found`);

  const backupId = `${CLIENT_ID}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await fb.adminDb.collection('config_backups').doc(backupId).set({
    clientId: CLIENT_ID,
    reason: 'before-not-the-rug-hitloop-config-setup',
    createdAt: fb.FieldValue.serverTimestamp(),
    clientConfig: clientConfigSnap.data,
    digestConfig: digestSnap.data,
    client: clientSnap.data,
    brain: brainSnap.data ? {
      status: brainSnap.data.status || null,
      identity: brainSnap.data.identity || null,
      positioning: brainSnap.data.positioning || null,
      voice: brainSnap.data.voice || null,
      content: brainSnap.data.content || null,
      markdownMeta: brainSnap.data.markdownMeta || null,
    } : null,
  });

  const currentMarketing = clientConfigSnap.data.marketingBriefConfig || {};
  const currentScout = clientConfigSnap.data.scoutConfig || {};
  const currentDigest = digestSnap.data || {};
  const currentInclude = currentDigest.include || {};
  const currentPostPlatforms = currentDigest.postPlatforms || {};
  const currentSchedule = currentDigest.schedule || {};

  await clientConfigRef.set({
    displayName: 'Not The Rug',
    companyName: 'Not The Rug',
    marketingBriefConfig: {
      ...currentMarketing,
      ...ntrMarketingPatch,
      weather: {
        ...(currentMarketing.weather || {}),
        enabled: true,
        zip: '11211',
        lat: 40.7095,
        lon: -73.9563,
        place: 'Brooklyn, NY',
      },
      acknowledgedCards: {
        ...(currentMarketing.acknowledgedCards || {}),
        'brand-keywords': true,
        'scout-focus': true,
        'client-brain': true,
      },
      updatedAtIso: new Date().toISOString(),
    },
    scoutConfig: {
      ...currentScout,
      ...ntrScoutPatch,
    },
    ntrConfigVersion: '2026-07-05T-not-the-rug-v1',
    updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  await digestRef.set({
    ...currentDigest,
    tone: 'warm, local, concise, founder-ready',
    summaryEnabled: true,
    recentDocsCount: currentDigest.recentDocsCount || 5,
    maxDocChars: currentDigest.maxDocChars || 8000,
    extraInstructions: 'Write the email for the Not The Rug operator. Keep it local, operational, specific, and useful. Prioritize weather, local demand, Reddit threads, competitor positioning, and copy the business could post today. Do not include HITLOOP platform analytics unless explicitly enabled.',
    homeClientId: null,
    includeClientIds: [],
    include: {
      ...currentInclude,
      ...digestIncludePatch,
    },
    order: digestOrder,
    postPlatforms: {
      ...currentPostPlatforms,
      x: false,
      thread: false,
      discord: false,
      reddit: true,
      instagram: true,
    },
    schedule: {
      ...currentSchedule,
      enabled: false,
      frequency: 'off',
      sendHour: Number.isFinite(Number(currentSchedule.sendHour)) ? Number(currentSchedule.sendHour) : 7,
      weekday: Number.isFinite(Number(currentSchedule.weekday)) ? Number(currentSchedule.weekday) : 1,
      timezone: 'America/New_York',
    },
    briefLinkMode: currentDigest.briefLinkMode || 'off',
    contactUrl: currentDigest.contactUrl || '',
    autoPostX: false,
    recipientEmail: currentDigest.recipientEmail || '',
    ntrConfigVersion: '2026-07-05T-not-the-rug-v1',
    updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: false });

  await clientRef.set({
    name: 'Not The Rug',
    displayName: 'Not The Rug',
    companyName: 'Not The Rug',
    updatedAt: fb.FieldValue.serverTimestamp(),
  }, { merge: true });

  const updated = (await clientConfigRef.get()).data();
  const runtime = buildRuntimeConfigFromFirestore(CLIENT_ID, updated);
  const normalizedDigest = await digestConfig.getDigestConfig(CLIENT_ID);

  console.log(`Backup written: config_backups/${backupId}`);
  console.log(`Client configured: ${CLIENT_ID}`);
  console.log(JSON.stringify({
    runtime: {
      clientName: runtime.clientName,
      sourcePlatforms: runtime.scout?.sourcePlatforms,
      searchLabels: (runtime.scout?.searchPlan || []).map((row) => row.label),
      brandKeywords: runtime.brandKeywords,
      categoryTerms: runtime.categoryTerms,
      competitors: runtime.competitors,
      reddit: runtime.reddit,
      last30days: runtime.last30days,
      scribeTone: runtime.scribe?.fallbackTone,
    },
    digest: {
      schedule: normalizedDigest.schedule,
      includeOn: Object.entries(normalizedDigest.include).filter(([, on]) => on).map(([key]) => key),
      order: normalizedDigest.order.slice(0, 12),
      postPlatforms: normalizedDigest.postPlatforms,
      recipientEmail: normalizedDigest.recipientEmail || '(blank)',
      autoPostX: normalizedDigest.autoPostX,
    },
    brain: {
      exists: brainSnap.exists,
      status: brainSnap.data?.status || null,
      name: brainSnap.data?.identity?.name || null,
      voicePillars: Array.isArray(brainSnap.data?.voice?.pillars) ? brainSnap.data.voice.pillars.length : 0,
      examples: Array.isArray(brainSnap.data?.content?.postExamples) ? brainSnap.data.content.postExamples.length : 0,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
