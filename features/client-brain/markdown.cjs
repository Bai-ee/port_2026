'use strict';

const SCHEMA_VERSION = 'hitloop.client-brain.v1';

const STATUS_MAP = new Set(['draft', 'suggested', 'generated', 'approved', 'stale']);
const ACQUISITION_METHODS = new Set(['automatic', 'interview', 'research', 'feedback', 'manual']);

function nowIso() {
  return new Date().toISOString();
}

function compact(value, max = 600) {
  const text = String(value || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function cleanList(input, { maxItems = 30, maxLen = 180 } = {}) {
  const rows = Array.isArray(input)
    ? input
    : String(input || '').split(/\n+/);
  return rows
    .flatMap((item) => String(item || '').split(/,(?=\s*[^,\s])/))
    .map((item) => String(item || '').replace(/^[-*]\s+/, '').trim().slice(0, maxLen))
    .filter(Boolean)
    .filter((item, index, arr) => {
      const key = item.toLowerCase().replace(/^@+/, '').replace(/^["']|["']$/g, '');
      return arr.findIndex((other) => other.toLowerCase().replace(/^@+/, '').replace(/^["']|["']$/g, '') === key) === index;
    })
    .slice(0, maxItems);
}

function slugify(value, fallback = 'client-brain') {
  const slug = String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  return slug || fallback;
}

function normalizeKey(value) {
  return slugify(value, '').replace(/-/g, '_');
}

function parseFrontmatter(markdown) {
  const text = String(markdown || '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: {}, body: text };
  const raw = text.slice(4, end).trim();
  const frontmatter = {};
  raw.split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) frontmatter[key] = value;
  });
  const bodyStart = text.indexOf('\n', end + 4);
  return { frontmatter, body: bodyStart >= 0 ? text.slice(bodyStart + 1) : '' };
}

function parseSections(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  const root = {};
  let h2 = '';
  let h3 = '';
  let buffer = [];

  function flush() {
    if (!h2 || !h3) return;
    if (!root[h2]) root[h2] = {};
    root[h2][h3] = buffer.join('\n').trim();
    buffer = [];
  }

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+?)\s*$/);
    if (h2Match) {
      flush();
      h2 = normalizeKey(h2Match[1]);
      h3 = '';
      buffer = [];
      continue;
    }
    const h3Match = line.match(/^###\s+(.+?)\s*$/);
    if (h3Match) {
      flush();
      h3 = normalizeKey(h3Match[1]);
      buffer = [];
      continue;
    }
    if (h2 && h3) buffer.push(line);
  }
  flush();
  return root;
}

function firstSection(sections, names) {
  for (const name of names) {
    const key = normalizeKey(name);
    if (sections[key]) return sections[key];
  }
  return {};
}

function field(section, names, fallback = '') {
  for (const name of names) {
    const key = normalizeKey(name);
    if (section[key] != null && String(section[key]).trim()) return section[key];
  }
  return fallback;
}

function listField(section, names, opts) {
  return cleanList(field(section, names), opts);
}

function normalizeAcquisition(meta = {}) {
  const acquisition = meta.acquisition && typeof meta.acquisition === 'object' ? meta.acquisition : {};
  const method = ACQUISITION_METHODS.has(acquisition.method) ? acquisition.method : (meta.method || 'manual');
  return {
    method,
    confidenceReason: acquisition.confidenceReason || meta.confidenceReason || 'Compiled from CLIENT_BRAIN.md.',
    researchRequired: Boolean(acquisition.researchRequired),
    lastValidatedAt: acquisition.lastValidatedAt || meta.updatedAt || nowIso(),
    validationStatus: acquisition.validationStatus || (meta.status === 'approved' ? 'approved' : 'pending'),
  };
}

function decisionValue(value, meta = {}) {
  return {
    value,
    status: meta.status || 'suggested',
    confidence: meta.confidence || 'high',
    sourceIds: ['client-brain-md'],
    updatedBy: 'operator',
    updatedAt: meta.updatedAt || nowIso(),
    appliedToCards: Array.isArray(meta.appliedToCards) ? meta.appliedToCards : [],
    acquisition: normalizeAcquisition(meta),
  };
}

function decisionList(input, meta, opts) {
  return decisionValue(cleanList(input, opts), meta);
}

function buildContextPack({ identity, positioning, voice, audience, offers, proof, content, discovery, decisions }) {
  const shortParts = [
    identity.name,
    positioning.oneLiner || identity.description,
    voice.toneSummary ? `Voice: ${voice.toneSummary}` : '',
    offers.services?.length ? `Offers: ${offers.services.join('; ')}` : '',
    content.pillars?.length ? `Content pillars: ${content.pillars.slice(0, 6).join('; ')}` : '',
  ].filter(Boolean);

  const longParts = [
    `CLIENT IDENTITY\n${[identity.name, identity.category, identity.primaryUrl].filter(Boolean).join(' · ')}\n${identity.description || ''}`.trim(),
    `POSITIONING\n${positioning.oneLiner || ''}\n${(positioning.differentiation || []).join('\n')}`.trim(),
    `AUDIENCE\n${(audience.primary || []).join('\n')}`.trim(),
    `AUTHORITY\n${(proof.projects || []).join('\n')}\n${(proof.metrics || []).join('\n')}`.trim(),
    `MARKET INTELLIGENCE\n${(decisions?.market?.categories?.value || []).join('\n')}`.trim(),
    `DISCOVERY INTELLIGENCE\n${[
      ...(discovery?.keywords || []),
      ...(discovery?.primaryPlatforms || []),
      ...(discovery?.communities || []),
      ...(discovery?.watchLists || []),
    ].join('\n')}`.trim(),
    `CONTENT\n${(content.pillars || []).join('\n')}\n${(content.recurringSeries || []).join('\n')}`.trim(),
    `DO NOT SAY\n${(voice.bannedWords || []).join('\n')}`.trim(),
  ].filter(Boolean);

  return {
    shortContext: compact(shortParts.join('. '), 1800),
    longContext: compact(longParts.join('\n\n'), 5200),
    promptRules: [
      'Use Client Brain as approved strategic context.',
      'Do not invent facts beyond approved decisions and source-backed proof.',
      'Respect do-not-say and prohibited-claim rules.',
    ],
    downstreamUsage: ['creative-brief', 'marketing-insights', 'strategy-builder', 'post-me', 'email-digest', 'leadgen'],
  };
}

function parseExplicitDecisionDrivers(driverSection, meta) {
  const textByHeading = driverSection || {};
  return Object.entries(textByHeading).map(([rawLabel, body]) => {
    const groups = {};
    let current = '';
    String(body || '').split('\n').forEach((line) => {
      const label = line.match(/^([A-Za-z][A-Za-z\s]+):\s*$/);
      if (label) {
        current = normalizeKey(label[1]);
        groups[current] = [];
        return;
      }
      if (current && line.trim()) groups[current].push(line);
    });
    const label = rawLabel.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
    return {
      id: slugify(rawLabel, 'decision-driver'),
      label,
      status: meta.status,
      confidence: 'high',
      sourceIds: ['client-brain-md'],
      own: cleanList(groups.own || []),
      avoid: cleanList(groups.avoid || []),
      search: cleanList(groups.search || []),
      competitors: cleanList(groups.competitors || []),
      kols: cleanList(groups.kols || groups.thought_leaders || []),
      publications: cleanList(groups.publications || []),
      communities: cleanList(groups.communities || []),
      contentSeries: cleanList(groups.content_series || groups.series || []),
      campaigns: cleanList(groups.campaigns || []),
      leadGen: cleanList(groups.lead_gen || groups.leadgen || []),
    };
  }).filter((driver) => [
    driver.own,
    driver.search,
    driver.competitors,
    driver.kols,
    driver.publications,
    driver.communities,
    driver.contentSeries,
    driver.leadGen,
  ].some((list) => list.length));
}

function compileClientBrainMarkdown(markdown, { clientId = '' } = {}) {
  const source = String(markdown || '').trim();
  if (!source) throw new Error('CLIENT_BRAIN.md source is required.');

  const { frontmatter, body } = parseFrontmatter(source);
  const sections = parseSections(body);
  const status = STATUS_MAP.has(frontmatter.status) ? frontmatter.status : 'draft';
  const generatedAt = nowIso();
  const meta = { status: status === 'approved' ? 'approved' : 'suggested', updatedAt: generatedAt };

  const identitySec = firstSection(sections, ['Identity Intelligence', 'Identity']);
  const marketSec = firstSection(sections, ['Market Intelligence', 'Market']);
  const discoverySec = firstSection(sections, ['Discovery Intelligence', 'Discovery']);
  const authoritySec = firstSection(sections, ['Authority Intelligence', 'Authority']);
  const contentSec = firstSection(sections, ['Content Intelligence', 'Content']);
  const opportunitySec = firstSection(sections, ['Opportunity Intelligence', 'Opportunity']);
  const driversSec = firstSection(sections, ['Decision Drivers']);

  const name = compact(field(identitySec, ['Name'], frontmatter.clientName || clientId), 140);
  const categoryToOwn = listField(identitySec, ['Category To Own', 'Categories To Own', 'Category'], { maxItems: 20 });
  const categoryToAvoid = listField(identitySec, ['Category To Avoid', 'Categories To Avoid'], { maxItems: 20 });
  const positioningText = compact(field(identitySec, ['Positioning', 'One Liner', 'One-Liner']), 600);
  const primaryAudience = listField(identitySec, ['Primary Audience', 'Audience', 'Who Hires Them'], { maxItems: 20 });
  const offersList = listField(identitySec, ['Offers', 'Services', 'What They Sell'], { maxItems: 20 });
  const authorityClaims = listField(identitySec, ['Authority', 'Authority Claim', 'Legitimate Authority'], { maxItems: 20 });

  const searchKeywords = listField(marketSec, ['Search Keywords', 'Keywords'], { maxItems: 40 });
  const competitors = listField(marketSec, ['Competitors', 'Direct Competitors'], { maxItems: 30 });
  const adjacentCompetitors = listField(marketSec, ['Adjacent Competitors'], { maxItems: 30 });
  const thoughtLeaders = listField(marketSec, ['Thought Leaders', 'KOLs', 'Influencers', 'Founder Accounts'], { maxItems: 40 });
  const publications = listField(marketSec, ['Publications', 'News Sources'], { maxItems: 30 });
  const communities = listField(marketSec, ['Communities'], { maxItems: 30 });
  const topicsToMonitor = listField(marketSec, ['Topics To Monitor', 'Topics'], { maxItems: 40 });

  const discoveryKeywords = listField(discoverySec, ['Keywords', 'Search Keywords'], { maxItems: 50 });
  const primaryPlatforms = listField(discoverySec, ['Primary Platforms', 'Platforms'], { maxItems: 20 });
  const discoveryCommunities = listField(discoverySec, ['Communities'], { maxItems: 40 });
  const discoveryPublications = listField(discoverySec, ['Publications'], { maxItems: 40 });
  const podcasts = listField(discoverySec, ['Podcasts'], { maxItems: 30 });
  const events = listField(discoverySec, ['Events', 'Conferences'], { maxItems: 30 });
  const directories = listField(discoverySec, ['Directories'], { maxItems: 30 });
  const awards = listField(discoverySec, ['Awards'], { maxItems: 30 });
  const socialEcosystems = listField(discoverySec, ['Social Ecosystems', 'Ecosystems'], { maxItems: 40 });
  const hashtags = listField(discoverySec, ['Hashtags'], { maxItems: 40 });
  const watchLists = listField(discoverySec, ['Watch Lists', 'Watchlists', 'KOL Watchlist', 'KOLs'], { maxItems: 50 });

  const proofPoints = listField(authoritySec, ['Proof Points', 'Proof'], { maxItems: 40 });
  const workHistory = listField(authoritySec, ['Work History', 'Career'], { maxItems: 40 });
  const metrics = listField(authoritySec, ['Metrics'], { maxItems: 20 });
  const allowedClaims = listField(authoritySec, ['Allowed Claims', 'Claims Allowed'], { maxItems: 30 });
  const prohibitedClaims = listField(authoritySec, ['Prohibited Claims', 'Claims Prohibited'], { maxItems: 30 });

  const pillars = listField(contentSec, ['Content Pillars', 'Pillars'], { maxItems: 30 });
  const recurringSeries = listField(contentSec, ['Recurring Series', 'Series'], { maxItems: 30 });
  const topicsToOwn = listField(contentSec, ['Topics To Own'], { maxItems: 30 });
  const topicsToAvoid = listField(contentSec, ['Topics To Avoid'], { maxItems: 30 });
  const voiceText = compact(field(contentSec, ['Voice', 'Tone', 'Writing Style']), 500);
  const doNotSay = listField(contentSec, ['Do Not Say', 'Banned Words'], { maxItems: 40 });
  const ctas = listField(contentSec, ['Calls To Action', 'CTAs'], { maxItems: 20 });

  const icpSegments = listField(opportunitySec, ['ICP Segments', 'ICP', 'Opportunity Targets'], { maxItems: 30 });
  const verticals = listField(opportunitySec, ['Verticals'], { maxItems: 30 });
  const geographies = listField(opportunitySec, ['Geographies', 'Locations'], { maxItems: 20 });
  const leadGenTargets = listField(opportunitySec, ['Lead Gen Targets', 'LeadGen', 'Lead Gen'], { maxItems: 40 });
  const disqualifiers = listField(opportunitySec, ['Disqualifiers'], { maxItems: 20 });

  const identity = {
    name,
    category: categoryToOwn[0] || '',
    description: positioningText,
    stage: '',
    location: geographies[0] || '',
    primaryUrl: compact(field(identitySec, ['Primary Url', 'Website', 'URL']), 300),
  };
  const positioning = {
    oneLiner: positioningText,
    authorityPosition: authorityClaims[0] || '',
    differentiation: [...categoryToOwn, ...authorityClaims].slice(0, 12),
    valueProps: offersList,
    avoidPositioning: categoryToAvoid,
  };
  const audience = {
    primary: primaryAudience,
    secondary: [],
    motivations: [],
    objections: disqualifiers,
    platforms: [],
  };
  const offers = {
    services: offersList,
    products: [],
    callsToAction: ctas,
  };
  const proof = {
    projects: proofPoints,
    metrics,
    testimonials: [],
    workHistory,
  };
  const voice = {
    toneSummary: voiceText,
    writingRules: voiceText ? [voiceText] : [],
    preferredWords: [],
    bannedWords: [...doNotSay, ...prohibitedClaims].slice(0, 40),
    formattingRules: ['Keep claims source-backed.', 'Use approved Client Brain decisions as the source of truth.'],
    exampleGood: [],
    exampleBad: [],
    pillars: [],
    avoidPatterns: prohibitedClaims,
    instagramFormatting: {},
    scribeInstructions: voiceText,
    dailyBriefVoice: {},
  };
  const content = {
    pillars: [...pillars, ...topicsToOwn].slice(0, 30),
    recurringSeries,
    postExamples: [],
    linkedInStyle: '',
    twitterStyle: '',
    emailDigestStyle: '',
  };
  const discovery = {
    keywords: (discoveryKeywords.length ? discoveryKeywords : searchKeywords).slice(0, 50),
    primaryPlatforms: (primaryPlatforms.length ? primaryPlatforms : ['web', 'x', 'reddit', 'hackernews', 'instagram']).slice(0, 20),
    communities: (discoveryCommunities.length ? discoveryCommunities : communities).slice(0, 40),
    publications: (discoveryPublications.length ? discoveryPublications : publications).slice(0, 40),
    podcasts,
    events,
    directories,
    awards,
    socialEcosystems,
    hashtags,
    watchLists: watchLists.slice(0, 50),
  };

  const intelligence = {
    identity: {
      who: decisionValue(positioningText || name, meta),
      selling: decisionValue(offersList, meta),
      hiredBy: decisionValue(primaryAudience, meta),
      categoryToOwn: decisionValue(categoryToOwn, meta),
      categoryToAvoid: decisionValue(categoryToAvoid, meta),
      legitimateAuthority: decisionValue([...authorityClaims, ...proofPoints, ...workHistory].slice(0, 40), meta),
    },
    market: {
      directCompetitors: decisionValue(competitors, meta),
      adjacentCompetitors: decisionValue(adjacentCompetitors, meta),
      thoughtLeaders: decisionValue(thoughtLeaders, meta),
      publications: decisionValue(publications, meta),
      communities: decisionValue(communities, meta),
      brandsToolsStartups: decisionValue([...competitors, ...adjacentCompetitors], meta),
      keywords: decisionValue([...searchKeywords, ...topicsToMonitor], meta),
    },
    discovery: {
      keywords: decisionValue(discovery.keywords, meta),
      primaryPlatforms: decisionValue(discovery.primaryPlatforms, meta),
      communities: decisionValue(discovery.communities, meta),
      publications: decisionValue(discovery.publications, meta),
      podcasts: decisionValue(discovery.podcasts, meta),
      events: decisionValue(discovery.events, meta),
      directories: decisionValue(discovery.directories, meta),
      awards: decisionValue(discovery.awards, meta),
      socialEcosystems: decisionValue(discovery.socialEcosystems, meta),
      hashtags: decisionValue(discovery.hashtags, meta),
      watchLists: decisionValue(discovery.watchLists, meta),
    },
    authority: {
      trustReasons: decisionValue([...proofPoints, ...workHistory, ...authorityClaims], meta),
      workHistory: decisionValue(workHistory, meta),
      metrics: decisionValue(metrics, meta),
      allowedClaims: decisionValue([...allowedClaims, ...authorityClaims], meta),
      prohibitedClaims: decisionValue(prohibitedClaims, meta),
    },
    content: {
      recurringThemes: decisionValue([...pillars, ...topicsToOwn], meta),
      topicsToOwn: decisionValue(topicsToOwn.length ? topicsToOwn : pillars, meta),
      topicsToAvoid: decisionValue(topicsToAvoid, meta),
      frameworks: decisionValue([], meta),
      stories: decisionValue([], meta),
      opinions: decisionValue([], meta),
      recurringSeries: decisionValue(recurringSeries, meta),
      formats: decisionValue([], meta),
    },
    opportunity: {
      icpSegments: decisionValue(icpSegments.length ? icpSegments : primaryAudience, meta),
      verticals: decisionValue(verticals, meta),
      geographies: decisionValue(geographies, meta),
      partnershipTargets: decisionValue(thoughtLeaders, meta),
      outreachAngles: decisionValue([...topicsToOwn, positioningText].filter(Boolean), meta),
      qualificationSignals: decisionValue(offersList, meta),
      disqualifiers: decisionValue(disqualifiers, meta),
    },
  };

  const explicitDrivers = parseExplicitDecisionDrivers(driversSec, meta);
  const derivedDriver = {
    id: slugify(categoryToOwn[0] || positioningText || name, 'client-positioning'),
    label: `Own ${categoryToOwn[0] || name || 'Client Positioning'}`,
    status: meta.status,
    confidence: 'high',
    sourceIds: ['client-brain-md'],
    own: categoryToOwn,
    avoid: [...categoryToAvoid, ...topicsToAvoid, ...prohibitedClaims].slice(0, 30),
    search: [...searchKeywords, ...topicsToMonitor, ...topicsToOwn].slice(0, 40),
    competitors: [...competitors, ...adjacentCompetitors].slice(0, 30),
    kols: [...thoughtLeaders, ...discovery.watchLists].slice(0, 50),
    publications: [...publications, ...discovery.publications, ...podcasts, ...events].slice(0, 50),
    communities: [...communities, ...discovery.communities, ...socialEcosystems].slice(0, 50),
    contentSeries: [...recurringSeries, ...pillars].slice(0, 30),
    campaigns: recurringSeries.map((series) => `${series} campaign`).slice(0, 12),
    leadGen: [...leadGenTargets, ...icpSegments, ...verticals].slice(0, 40),
  };
  const decisionDrivers = explicitDrivers.length ? explicitDrivers : [derivedDriver];

  const decisions = {
    intelligence,
    decisionDrivers,
    identity: {
      name: decisionValue(name, meta),
      category: decisionValue(categoryToOwn[0] || '', meta),
      primaryUrl: decisionValue(identity.primaryUrl, meta),
    },
    positioning: {
      oneLiner: decisionValue(positioningText, meta),
      differentiation: decisionValue(positioning.differentiation, meta),
    },
    audience: {
      primary: decisionValue(primaryAudience, meta),
      motivations: decisionValue([], meta),
      objections: decisionValue(disqualifiers, meta),
    },
    voice: {
      toneSummary: decisionValue(voiceText, meta),
      preferredWords: decisionValue([], meta),
      doNotSay: decisionValue([...doNotSay, ...prohibitedClaims], meta),
    },
    offers: {
      services: decisionValue(offersList, meta),
      callsToAction: decisionValue(ctas, meta),
    },
    proof: {
      points: decisionValue(proofPoints, meta),
      metrics: decisionValue(metrics, meta),
    },
    search: {
      keywords: decisionValue([...discovery.keywords, ...searchKeywords, name].filter(Boolean), meta),
      excludedTerms: decisionValue([...doNotSay, ...prohibitedClaims], meta),
      topicsToMonitor: decisionValue([...topicsToMonitor, ...categoryToOwn, ...topicsToOwn, ...discovery.watchLists, ...discovery.socialEcosystems], meta),
      competitorTerms: decisionValue([...competitors, ...adjacentCompetitors], meta),
      customSearches: decisionValue([], meta),
    },
    social: {
      handlesToFollow: decisionValue([...thoughtLeaders, ...discovery.watchLists], meta),
      handlesToAvoid: decisionValue([], meta),
      platforms: decisionValue(discovery.primaryPlatforms, meta),
      postAngles: decisionValue([...pillars, ...topicsToOwn], meta),
    },
    market: {
      categories: decisionValue(categoryToOwn, meta),
      verticals: decisionValue(verticals, meta),
      locations: decisionValue(geographies, meta),
      signalsToWatch: decisionValue(topicsToMonitor, meta),
    },
    content: {
      pillars: decisionValue([...pillars, ...topicsToOwn], meta),
      recurringSeries: decisionValue(recurringSeries, meta),
      defaultCtas: decisionValue(ctas, meta),
      doNotSay: decisionValue([...doNotSay, ...prohibitedClaims], meta),
    },
  };

  const aiContextPack = buildContextPack({ identity, positioning, voice, audience, offers, proof, content, discovery, decisions });

  return {
    clientId: frontmatter.clientId || clientId || '',
    version: 1,
    status,
    generatedBy: 'markdown',
    markdownSource: source,
    markdownMeta: {
      schemaVersion: frontmatter.schemaVersion || SCHEMA_VERSION,
      sourceStatus: frontmatter.status || 'draft',
      compiledAt: generatedAt,
      clientName: frontmatter.clientName || name,
    },
    identity,
    positioning,
    voice,
    audience,
    offers,
    proof,
    content,
    discovery,
    decisions,
    aiContextPack,
    missingData: [
      !name ? { field: 'identity.name', reason: 'Name missing from CLIENT_BRAIN.md.', priority: 'high' } : null,
      !positioningText ? { field: 'positioning.oneLiner', reason: 'Positioning missing from CLIENT_BRAIN.md.', priority: 'high' } : null,
      !categoryToOwn.length ? { field: 'intelligence.identity.categoryToOwn', reason: 'No category-to-own decisions supplied.', priority: 'medium' } : null,
      !proofPoints.length && !workHistory.length ? { field: 'intelligence.authority', reason: 'No authority proof supplied.', priority: 'medium' } : null,
      !discovery.keywords.length ? { field: 'intelligence.discovery.keywords', reason: 'No discovery keywords supplied.', priority: 'medium' } : null,
      !discovery.watchLists.length ? { field: 'intelligence.discovery.watchLists', reason: 'No KOL/watchlist decisions supplied.', priority: 'medium' } : null,
    ].filter(Boolean),
    contradictions: [],
    confidence: name && positioningText && categoryToOwn.length ? 'high' : 'medium',
    sourceRefs: [{
      id: 'client-brain-md',
      sourceType: 'manual_note',
      label: 'CLIENT_BRAIN.md',
      enabled: true,
      trustLevel: 'high',
      freshness: 'current',
      relevance: 'high',
      useFor: {
        tone: true,
        strategy: true,
        copy: true,
        audience: true,
        proof: true,
        positioning: true,
        offers: true,
        emailDigest: true,
        socialPosts: true,
        marketingInsights: true,
      },
      summary: compact(positioningText || name, 600),
      extractedFields: { schemaVersion: frontmatter.schemaVersion || SCHEMA_VERSION },
      manualNotes: '',
      doNotUseNotes: '',
      lastImportedAt: generatedAt,
      lastUpdatedAt: generatedAt,
    }],
    generatedAt,
  };
}

function createClientBrainMarkdownTemplate({ clientId = '', clientName = '' } = {}) {
  return `---
schemaVersion: ${SCHEMA_VERSION}
clientId: ${clientId}
clientName: ${clientName}
status: draft
updatedAt: ${new Date().toISOString().slice(0, 10)}
---

# Client Brain

## Identity Intelligence

### Name
${clientName}

### Category To Own
- 

### Category To Avoid
- 

### Positioning

### Primary Audience
- 

### Offers
- 

## Market Intelligence

### Search Keywords
- 

### Competitors
- 

### Thought Leaders
- 

### Publications
- 

### Communities
- 

### Topics To Monitor
- 

## Discovery Intelligence

### Keywords
- 

### Primary Platforms
- web
- x
- reddit
- hackernews
- instagram

### Communities
- 

### Publications
- 

### Podcasts
- 

### Events
- 

### Directories
- 

### Awards
- 

### Social Ecosystems
- 

### Hashtags
- 

### Watch Lists
- 

## Authority Intelligence

### Proof Points
- 

### Work History
- 

### Allowed Claims
- 

### Prohibited Claims
- 

## Content Intelligence

### Content Pillars
- 

### Recurring Series
- 

### Voice

### Do Not Say
- 

### Calls To Action
- 

## Opportunity Intelligence

### ICP Segments
- 

### Verticals
- 

### Geographies
- 

### Lead Gen Targets
- 
`;
}

module.exports = {
  SCHEMA_VERSION,
  compileClientBrainMarkdown,
  createClientBrainMarkdownTemplate,
  parseFrontmatter,
  parseSections,
};
