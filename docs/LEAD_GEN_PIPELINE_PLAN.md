# Lead Generation Pipeline — Implementation Plan

## Objective

Build an automated, cloud-native lead generation system that discovers businesses with poor web presences, scores them for conversion probability, audits their current sites, generates redesigned preview sites, and surfaces everything through a dedicated dashboard UI. The system runs 24/7 on Vercel crons with Firebase as the persistence layer, requiring zero manual intervention after initial configuration.

## Design Principles

- **Extend, don't replace.** The existing scout-intake pipeline, PageSpeed integration, Browserless screenshots, visual palette sampler, AI SEO audit, and Scribe are all reused. The lead gen system wraps them with a prospecting front-end and a site generation back-end.
- **Queue-driven, not monolithic.** Each prospect moves through discrete stages with Firestore as the queue. Cron jobs pick up work per-stage so no single function exceeds Vercel's timeout.
- **UI-steerable.** The dashboard lets the operator (Bryan) configure target verticals, geographies, scoring weights, and outreach priorities in real time. The pipeline reads these configs on each cron tick.
- **Cost-conscious.** Hybrid data sourcing (scrape for discovery, API for enrichment). LLM calls use Haiku where possible. PageSpeed API is free. Estimated cost: $0.10–$0.30 per fully-processed prospect.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LEAD GEN PIPELINE                            │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ DISCOVER │───▶│  SCORE   │───▶│  AUDIT   │───▶│ GENERATE │     │
│  │          │    │          │    │          │    │          │     │
│  │ Google   │    │ Multi-   │    │ Existing │    │ Preview  │     │
│  │ Maps     │    │ signal   │    │ scout    │    │ site     │     │
│  │ scrape + │    │ scoring  │    │ intake   │    │ deploy   │     │
│  │ Places   │    │ engine   │    │ pipeline │    │ to       │     │
│  │ API      │    │          │    │ reuse    │    │ Vercel   │     │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │
│       │               │               │               │            │
│       ▼               ▼               ▼               ▼            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    FIRESTORE                                │   │
│  │  leadgen_prospects  │  leadgen_audits  │  leadgen_configs   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                               │                                    │
│                               ▼                                    │
│                    ┌────────────────────┐                          │
│                    │  DASHBOARD UI      │                          │
│                    │  /lead-generation  │                          │
│                    │                    │                          │
│                    │  Stats overview    │                          │
│                    │  Prospect table    │                          │
│                    │  Scoring config    │                          │
│                    │  Geography filter  │                          │
│                    │  Vertical filter   │                          │
│                    └────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Prospect Discovery

### 1.1 Data Source Strategy (Hybrid)

**Tier 1 — Bulk Discovery (SerpAPI or direct Google Maps scrape)**

Use SerpAPI's Google Maps endpoint (`/search?engine=google_maps`) to pull business listings by query + location. This gives us 20 results per request at ~$0.01/request on the $50/mo plan (5,000 searches).

Query construction:
```
"{vertical} near {location}"
"{vertical} in {zip_code}"
"{vertical} {neighborhood}, {city}"
```

Example queries:
```
"personal injury lawyer near 60608"
"dentist in Pilsen, Chicago"
"HVAC contractor 60616"
"roofing company near 18th street chicago"
```

Each result from SerpAPI returns:
- `title` (business name)
- `place_id` (Google Place ID — used for enrichment)
- `rating`, `reviews` (count)
- `address`, `phone`
- `website` (URL — critical)
- `type` / `category`
- `thumbnail` (GBP photo)
- `hours` (operating hours)

**Tier 2 — Enrichment (Google Places API, only for qualified leads)**

After scoring, prospects that pass the threshold get enriched via Google Places Details API ($17/1000 requests):
- Verified phone number and website
- Full address with lat/lng
- Price level indicator ($ to $$$$)
- Business status (operational, closed, etc.)
- Editorial summary
- Photos (up to 10)
- Google Ads presence (detected via separate SERP check)

### 1.2 Discovery Configuration (UI-driven)

Firestore collection: `leadgen_configs/discovery`

```js
{
  // Active search campaigns — each one runs on the cron
  campaigns: [
    {
      id: "chicago-lawyers-60608",
      enabled: true,
      vertical: "lawyer",
      queries: [
        "personal injury lawyer near 60608",
        "family law attorney Pilsen Chicago",
        "immigration lawyer 18th street chicago"
      ],
      location: {
        label: "Pilsen / 18th St, Chicago",
        lat: 41.8579,
        lng: -87.6616,
        radiusMiles: 3
      },
      maxProspectsPerRun: 20,
      lastRunAt: null
    },
    {
      id: "chicago-dentists-loop",
      enabled: true,
      vertical: "dental",
      queries: ["dentist near downtown chicago", "cosmetic dentist loop chicago"],
      location: { label: "The Loop, Chicago", lat: 41.8819, lng: -87.6278, radiusMiles: 2 },
      maxProspectsPerRun: 15,
      lastRunAt: null
    }
  ],

  // Generic (nationwide) discovery — runs lower priority
  genericEnabled: true,
  genericVerticals: ["lawyer", "dental", "home_services", "restaurant"],
  genericLocations: [
    // Populated from UI — user adds zip codes / cities
    { label: "Chicago, IL", lat: 41.8781, lng: -87.6298, radiusMiles: 15 },
  ],

  // Global settings
  dailyBudget: {
    maxDiscoveries: 100,        // cap per day across all campaigns
    maxEnrichments: 30,         // Places API calls per day
    maxAudits: 15,              // full pipeline runs per day
    maxSiteGenerations: 5       // preview sites per day
  },

  // Deduplication
  dedupeKey: "place_id"         // never re-process a known place_id
}
```

### 1.3 Discovery Module

New file: `features/leadgen/prospector.js`

```
prospector.js
├── discoverFromCampaign(campaign)    → Prospect[]
├── discoverGeneric(vertical, location) → Prospect[]
├── dedupeAgainstExisting(prospects)  → Prospect[] (filters known place_ids)
├── enrichProspect(prospect)          → EnrichedProspect
└── persistProspects(prospects)       → writes to Firestore
```

**Prospect schema** (Firestore: `leadgen_prospects/{place_id}`):

```js
{
  // Identity
  placeId: "ChIJ...",
  name: "Garcia & Associates Law Firm",
  vertical: "lawyer",
  subVertical: "personal_injury",   // detected from GBP categories

  // Contact
  phone: "+1-312-555-0123",
  email: null,                       // scraped from website if found
  website: "https://garcialawfirm.com",
  address: "1845 S Blue Island Ave, Chicago, IL 60608",
  lat: 41.8563,
  lng: -87.6612,

  // Google Business signals
  rating: 4.6,
  reviewCount: 187,
  priceLevel: 2,                     // $$ — from Places API
  businessStatus: "OPERATIONAL",
  hoursComplete: true,               // did they fill out hours?
  photosCount: 23,
  gbpCompleteness: 0.85,            // 0-1 score based on fields filled

  // Discovery metadata
  campaignId: "chicago-lawyers-60608",
  discoveredAt: "2026-05-06T14:00:00Z",
  source: "serpapi_google_maps",

  // Pipeline state
  stage: "discovered",              // discovered → scored → auditing → audited → generating → ready → contacted
  score: null,                      // populated after scoring
  scoreBreakdown: null,
  enrichedAt: null,
  auditedAt: null,
  previewUrl: null,
  contactedAt: null,
  outcome: null                     // "responded", "converted", "declined", "no_response"
}
```

### 1.4 Vertical Detection & Sub-classification

Google Business categories map to our verticals. The prospector includes a classifier:

```js
const VERTICAL_MAP = {
  lawyer: {
    gbpCategories: [
      "Attorney", "Law firm", "Personal injury attorney",
      "Family law attorney", "Criminal justice attorney",
      "Immigration attorney", "Bankruptcy attorney",
      "Real estate attorney", "Tax attorney",
      "Corporate lawyer", "Employment attorney"
    ],
    subVerticalFromCategory: {
      "Personal injury attorney": "personal_injury",
      "Family law attorney": "family_law",
      "Criminal justice attorney": "criminal_defense",
      "Immigration attorney": "immigration",
      // ...
    },
    avgDealValue: { min: 3000, max: 15000 },
    closeProbability: 0.08           // baseline conversion for cold outreach
  },
  dental: {
    gbpCategories: [
      "Dentist", "Cosmetic dentist", "Orthodontist",
      "Pediatric dentist", "Oral surgeon", "Endodontist",
      "Periodontist", "Dental implants provider"
    ],
    avgDealValue: { min: 2000, max: 8000 },
    closeProbability: 0.06
  },
  home_services: {
    gbpCategories: [
      "HVAC contractor", "Plumber", "Roofing contractor",
      "Electrician", "General contractor", "Landscaper",
      "Pest control service", "Painting contractor",
      "Garage door supplier", "Fencing contractor"
    ],
    avgDealValue: { min: 1500, max: 5000 },
    closeProbability: 0.10
  },
  restaurant: {
    gbpCategories: [
      "Restaurant", "Catering service", "Event venue",
      "Banquet hall", "Bar", "Bakery", "Café",
      "Food truck", "Caterer"
    ],
    // Only target restaurants with catering/events — not just any restaurant
    qualifyingSignals: ["catering", "event", "banquet", "private dining"],
    avgDealValue: { min: 1000, max: 4000 },
    closeProbability: 0.12
  }
};
```

---

## Phase 2: Lead Scoring Engine

### 2.1 Scoring Philosophy

A perfect lead has three properties:
1. **Their website is bad** (we can help them)
2. **Their business is good** (they can afford to pay us)
3. **They're actively investing in growth** (they'll see the value)

The scoring engine evaluates all three dimensions.

### 2.2 Scoring Signals

New file: `features/leadgen/scorer.js`

**Signal 1: Website Quality Score (0–100, inverted — lower site quality = higher lead score)**

Sourced from the lightweight pre-audit (before full pipeline):
- Homepage loads at all? (15 pts if broken/slow)
- Mobile responsive? (20 pts if not)
- HTTPS? (10 pts if no)
- Page load time > 5s? (15 pts)
- Detected platform: Wix/Squarespace/GoDaddy template? (10 pts)
- Last modified date > 2 years ago? (15 pts — stale site)
- No meta description? (5 pts)
- No OG tags? (5 pts)
- No structured data / JSON-LD? (5 pts)

This is a LIGHTWEIGHT pre-scan — not the full scout-intake pipeline. We run it on every discovered prospect. Cheerio + a single fetch, no Browserless, no LLM calls. Cost: ~$0.00.

```js
async function quickSiteAudit(websiteUrl) {
  // Single fetch, parse with cheerio, score deficiencies
  // Returns: { siteScore: 0-100, deficiencies: string[], platform: string|null, loadTimeMs: number }
}
```

**Signal 2: Business Success Score (0–100)**

Derived from Google Business data:
- Review count: 0–50 (10 pts), 50–150 (25 pts), 150–500 (40 pts), 500+ (50 pts)
- Rating: below 3.5 (0 pts), 3.5–4.0 (10 pts), 4.0–4.5 (25 pts), 4.5+ (35 pts)
- Photos count > 10 (5 pts) — shows engagement
- Hours filled out (5 pts)
- Price level ≥ 2 (5 pts) — mid-range+ pricing suggests healthy margins

**Signal 3: Growth Investment Score (0–100)**

- Active Google Ads detected (40 pts) — strongest signal; they're paying for traffic already
- GBP posts/updates in last 90 days (15 pts) — checked via Places API
- Complete GBP profile (15 pts)
- Multiple GBP photos uploaded recently (10 pts)
- Website has blog or news section (10 pts) — detected during quick site audit
- Social media links present (10 pts)

**Signal 4: Contact Accessibility (0–100)**

- Phone number available (30 pts)
- Email found on website (30 pts)
- Contact form on website (20 pts)
- Physical address verified (10 pts)
- Owner name identifiable (10 pts)

### 2.3 Composite Score

```js
function calculateLeadScore(signals) {
  const weights = {
    websiteQuality: 0.35,     // bad site = biggest opportunity
    businessSuccess: 0.25,    // good business = can pay
    growthInvestment: 0.25,   // investing in growth = sees value
    contactAccess: 0.15       // can we actually reach them?
  };

  const composite = (
    signals.websiteQuality * weights.websiteQuality +
    signals.businessSuccess * weights.businessSuccess +
    signals.growthInvestment * weights.growthInvestment +
    signals.contactAccess * weights.contactAccess
  );

  return {
    score: Math.round(composite),
    grade: letterGrade(composite),      // A/B/C/D/F
    tier: composite >= 75 ? 'hot'
        : composite >= 55 ? 'warm'
        : composite >= 35 ? 'cool'
        : 'cold',
    breakdown: signals,
    recommendation: buildRecommendation(signals)
  };
}
```

### 2.4 Scoring Configuration (UI-adjustable)

Firestore: `leadgen_configs/scoring`

```js
{
  weights: {
    websiteQuality: 0.35,
    businessSuccess: 0.25,
    growthInvestment: 0.25,
    contactAccess: 0.15
  },
  thresholds: {
    autoAudit: 65,         // score >= 65 → auto-enrich + full audit
    autoGenerate: 75,      // score >= 75 → auto-generate preview site
    minimumScore: 35       // below this → discard (don't waste storage)
  },
  // UI toggle: user can override and manually push any prospect to audit
  manualOverrideEnabled: true
}
```

---

## Phase 3: Full Audit Pipeline (Reuse Existing)

### 3.1 Integration Point

Once a prospect scores above the `autoAudit` threshold, the system creates a lightweight "client" in Firestore and routes it through the existing scout-intake pipeline.

New file: `features/leadgen/audit-bridge.js`

This bridges the lead gen system to the existing `runIntakePipeline()`:

```js
async function auditProspect(prospect) {
  // 1. Create a temporary client config compatible with runner.js
  const clientConfig = {
    sourceInputs: { websiteUrl: prospect.website },
    clientName: prospect.name,
    isLeadGenProspect: true,        // flag so the pipeline knows this is automated
    leadgenProspectId: prospect.placeId
  };

  // 2. Run the existing intake pipeline
  //    This gives us: snapshot, signals, strategy, screenshots, design system,
  //    pagespeed scores, SEO audit, scribe-generated copy — everything.
  const result = await runIntakePipeline({
    clientId: `leadgen_${prospect.placeId}`,
    clientConfig,
    onProgress: (stage, label) => updateProspectStage(prospect.placeId, stage, label)
  });

  // 3. Run the AI SEO audit as a supplementary signal
  const seoAudit = await runAiSeoAudit({ websiteUrl: prospect.website });

  // 4. Persist audit results back to the prospect record
  await persistAuditResults(prospect.placeId, result, seoAudit);

  return { intakeResult: result, seoAudit };
}
```

### 3.2 What We Get from the Existing Pipeline

From `runner.js` (already built):
- **Site evidence** — crawled HTML, meta tags, OG data
- **Design system extraction** — colors, fonts, spacing from `visual-palette-sampler.js` and `design-system-extractor.js`
- **PageSpeed Insights** — performance, accessibility, SEO, best practices scores
- **Screenshots** — desktop, mobile, tablet via Browserless
- **Device mockups** — composited multi-device images
- **LLM synthesis** — brand overview, tone analysis, visual identity summary
- **Scribe output** — card-by-card copy (short + expanded) covering every dimension
- **Strategy** — content angles, opportunity map, priority actions

From `ai-seo-audit/` (already built):
- **AI/GEO visibility score** — how well the site is optimized for LLM discoverability
- **/llms.txt validation** — present or not
- **robots.txt AI access** — are AI bots blocked?
- **Schema/JSON-LD scoring** — structured data quality
- **Content extractability** — heading structure, JS dependency

### 3.3 Audit Results Schema

Added to the prospect document in Firestore:

```js
{
  // ... existing prospect fields ...

  audit: {
    completedAt: "2026-05-06T16:30:00Z",
    pipelineRunId: "uuid",

    // Scores (from existing pipeline)
    pagespeed: {
      performance: 34,
      accessibility: 61,
      bestPractices: 72,
      seo: 55
    },
    aiSeo: {
      overallScore: 22,
      grade: "F",
      findings: [...]
    },

    // Design system (from visual-palette-sampler + design-system-extractor)
    designSystem: {
      colors: { primary: "#1a3c5e", secondary: "#d4a853", ... },
      fonts: { heading: "Georgia", body: "Arial" },
      mode: "light",
      palette: [{ hex: "#1a3c5e", coverage: 0.32 }, ...]
    },

    // Screenshots (from Browserless)
    screenshots: {
      desktop: "gs://bucket/leadgen/ChIJ.../desktop.png",
      mobile: "gs://bucket/leadgen/ChIJ.../mobile.png",
      tablet: "gs://bucket/leadgen/ChIJ.../tablet.png"
    },
    mockupUrl: "gs://bucket/leadgen/ChIJ.../mockup.png",

    // Content analysis (from scribe/synthesis)
    brandSummary: "Garcia & Associates presents itself as...",
    toneAnalysis: "Professional but dated...",
    topDeficiencies: [
      "No mobile responsiveness",
      "Page load time 8.2s",
      "No structured data",
      "Missing meta descriptions on all pages",
      "No SSL certificate"
    ],
    topOpportunities: [
      "Add JSON-LD for LocalBusiness + Attorney",
      "Implement responsive design",
      "Add client testimonial schema",
      "Enable HTTPS"
    ],

    // Estimated value — what fixing these issues is worth
    estimatedImpact: {
      currentMonthlyTraffic: "~200 visits (estimated)",
      projectedTrafficLift: "2-3x with technical fixes",
      conversionImpact: "High — mobile users currently bouncing"
    }
  }
}
```

---

## Phase 4: Preview Site Generation

### 4.1 Strategy

For each audited prospect that scores above the `autoGenerate` threshold, we generate a modern one-page site using their extracted brand assets and LLM-generated content, deployed to a Vercel preview URL.

The preview site is NOT a full production site — it's a **sales tool**. It shows the prospect "this is what your web presence could look like" and makes the value proposition tangible.

### 4.2 Site Generator Module

New file: `features/leadgen/site-generator.js`

```js
async function generatePreviewSite(prospect, auditResults) {
  // 1. Build the design guide from audit results
  const designGuide = buildDesignGuide(auditResults.designSystem, prospect.vertical);

  // 2. Generate site content via Claude (Haiku for cost)
  const content = await generateSiteContent(prospect, auditResults);

  // 3. Assemble the template
  const html = renderPreviewSite({
    designGuide,
    content,
    prospect,
    screenshots: auditResults.screenshots  // "before" images
  });

  // 4. Deploy to Vercel as a static preview
  const previewUrl = await deployPreview(prospect.placeId, html);

  // 5. Update prospect record
  await updateProspect(prospect.placeId, {
    stage: 'ready',
    previewUrl,
    generatedAt: new Date().toISOString()
  });

  return previewUrl;
}
```

### 4.3 Design Guide Builder

Uses the extracted design system to create a consistent visual language:

```js
function buildDesignGuide(extractedDesign, vertical) {
  // Start from their existing brand colors (from visual-palette-sampler)
  const { colors, fonts, mode } = extractedDesign;

  // Apply vertical-specific defaults where extraction failed
  const verticalDefaults = VERTICAL_DESIGN_DEFAULTS[vertical];

  return {
    colors: {
      primary: colors.primary || verticalDefaults.primary,
      secondary: colors.secondary || verticalDefaults.secondary,
      accent: colors.accent || verticalDefaults.accent,
      background: mode === 'dark' ? '#0a0a0a' : '#ffffff',
      text: mode === 'dark' ? '#f5f5f5' : '#1a1a1a',
      muted: mode === 'dark' ? '#a0a0a0' : '#6b7280'
    },
    typography: {
      heading: fonts.heading || verticalDefaults.headingFont,
      body: fonts.body || verticalDefaults.bodyFont,
      scale: { h1: '3rem', h2: '2rem', h3: '1.5rem', body: '1.125rem' }
    },
    spacing: { section: '6rem', element: '2rem', tight: '1rem' },
    borderRadius: verticalDefaults.borderRadius || '0.5rem',
    mode
  };
}
```

### 4.4 Content Generation

```js
async function generateSiteContent(prospect, auditResults) {
  // Single Haiku call — structured output
  const prompt = `
    Generate website content for a ${prospect.vertical} business.

    Business: ${prospect.name}
    Location: ${prospect.address}
    Rating: ${prospect.rating} (${prospect.reviewCount} reviews)
    Current brand tone: ${auditResults.audit.toneAnalysis}

    Generate a modern one-page website with these sections:
    1. Hero headline + subheadline + CTA
    2. About / value proposition (2-3 sentences)
    3. Services list (4-6 services appropriate for this business type)
    4. Social proof section (testimonial-style placeholder text)
    5. Contact section (use their real phone + address)
    6. Footer tagline

    Output as JSON with keys: hero, about, services, socialProof, contact, footer.
    Keep the tone ${auditResults.audit.toneAnalysis || 'professional and approachable'}.
  `;

  return callHaiku(prompt);
}
```

### 4.5 Preview Template

The preview site template is a self-contained HTML file with:
- Responsive design (mobile-first)
- Their brand colors and fonts applied
- Before/after comparison (screenshots of current site vs. the preview)
- A subtle banner: "This is a preview redesign by Bballi Studio — [Contact us]"
- PageSpeed score comparison (current vs. expected after redesign)
- Call-to-action for the business owner

Template stored at: `features/leadgen/templates/preview-site.html`

Vertical-specific templates can override the generic one:
```
features/leadgen/templates/
├── preview-site.html           # generic template
├── preview-lawyer.html         # legal vertical overrides
├── preview-dental.html         # dental vertical overrides
├── preview-home-services.html  # home services overrides
└── preview-restaurant.html     # restaurant/hospitality overrides
```

### 4.6 Deployment

Preview sites deploy as static files to Vercel:
- URL pattern: `preview.bballi.com/{place-id-slug}`
- Or under a subdirectory: `bballi.com/preview/{place-id-slug}`
- Each preview is a single HTML file + inlined CSS/JS (no build step)
- Deployed via Vercel API (`POST /v13/deployments`)
- Auto-expires after 30 days (configurable) to avoid clutter

---

## Phase 5: Cron Orchestration

### 5.1 Cron Schedule

Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/admin/daily-digest", "schedule": "0 13 * * *" },
    { "path": "/api/leadgen/discover",   "schedule": "0 8 * * *" },
    { "path": "/api/leadgen/score",      "schedule": "0 9 * * *" },
    { "path": "/api/leadgen/audit",      "schedule": "0 10 * * *" },
    { "path": "/api/leadgen/generate",   "schedule": "0 12 * * *" }
  ]
}
```

### 5.2 Cron Route Handlers

Each cron handler follows the same pattern:

```
app/api/leadgen/
├── discover/route.js     # Pulls from campaigns, writes new prospects
├── score/route.js        # Reads discovered prospects, runs scorer, updates
├── audit/route.js        # Reads scored prospects above threshold, fans out to workers
├── generate/route.js     # Reads audited prospects above threshold, generates sites
└── worker/
    └── audit-single/route.js   # Worker that audits a single prospect (called by fan-out)
```

**Fan-out pattern** (same as existing `/api/worker/run-brief`):

The `audit` cron doesn't run the pipeline itself — it reads the queue, picks up to `dailyBudget.maxAudits` prospects, and fires individual POST requests to `/api/leadgen/worker/audit-single` for each one. Each worker call stays under Vercel's function timeout.

### 5.3 Stage Transitions

```
discovered → scored → [discarded if below minimum]
                    → auditing → audited → [skip if below autoGenerate]
                                         → generating → ready → contacted
```

All transitions are idempotent. If a cron run crashes, the next run picks up where it left off because it reads stage from Firestore.

---

## Phase 6: UI — Lead Generation Dashboard

### 6.1 Navigation

New nav item in the existing dashboard header: **"Lead Generation"**

Route: `app/lead-generation/page.jsx` (or `app/dashboard/lead-generation/page.jsx` depending on existing routing pattern)

### 6.2 Dashboard Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│  Lead Generation Pipeline                              [Settings ⚙] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐      │
│  │  247   │  │  183   │  │   42   │  │   18   │  │    7   │      │
│  │Discover│  │ Scored │  │Audited │  │  Ready │  │Contact │      │
│  │  -ed   │  │        │  │        │  │        │  │  -ed   │      │
│  └────────┘  └────────┘  └────────┘  └────────┘  └────────┘      │
│                                                                     │
│  ┌─── Filters ────────────────────────────────────────────────────┐ │
│  │ Vertical: [All ▼]  Location: [All ▼]  Score: [≥65 ▼]         │ │
│  │ Stage: [All ▼]     Sort: [Score desc ▼]   [+ New Campaign]   │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─── Prospect Table ────────────────────────────────────────────┐ │
│  │ Name              │ Vertical │ Score │ Stage   │ Location     │ │
│  │ Garcia & Assoc.   │ Lawyer   │ 82 🔥 │ Ready   │ Pilsen, CH  │ │
│  │ Bright Smile Dent │ Dental   │ 76 🔥 │ Audited │ Loop, CH    │ │
│  │ ABC Plumbing      │ HVAC     │ 71    │ Scored  │ Bridgeport  │ │
│  │ Casa Azul Events  │ Rest.    │ 68    │ Scored  │ 18th St, CH │ │
│  │ ...               │          │       │         │             │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─── Prospect Detail (slide-out panel) ─────────────────────────┐ │
│  │ Garcia & Associates Law Firm                    Score: 82/100 │ │
│  │                                                               │ │
│  │ Contact: +1-312-555-0123 | garcialaw.com                     │ │
│  │ 187 reviews, 4.6★ | Pilsen, Chicago                          │ │
│  │                                                               │ │
│  │ Score Breakdown:                                              │ │
│  │ ████████░░ Website Quality  78/100 (bad site = opportunity)   │ │
│  │ ██████████ Business Success 92/100 (strong reviews)           │ │
│  │ ███████░░░ Growth Signal    70/100 (active Google Ads)        │ │
│  │ █████████░ Contact Access   85/100 (phone + email found)      │ │
│  │                                                               │ │
│  │ [📸 Current Site Screenshots]  [🔗 Preview Site]              │ │
│  │ [▶ Run Full Audit]            [📧 Generate Outreach]          │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─── Active Campaigns ──────────────────────────────────────────┐ │
│  │ 🟢 chicago-lawyers-60608     │ Last run: 2h ago │ 47 found   │ │
│  │ 🟢 chicago-dentists-loop     │ Last run: 2h ago │ 23 found   │ │
│  │ 🟡 generic-home-services     │ Last run: 26h    │ 89 found   │ │
│  │                                         [+ Add Campaign]     │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 Settings Panel

Accessible via the gear icon. Controls:

- **Scoring Weights** — sliders for websiteQuality, businessSuccess, growthInvestment, contactAccess weights (must sum to 1.0)
- **Thresholds** — autoAudit, autoGenerate, minimumScore
- **Daily Budget** — max discoveries, enrichments, audits, site generations per day
- **Campaign Manager** — add/edit/disable search campaigns with query builder
- **Vertical Manager** — enable/disable verticals, customize sub-classifications
- **API Keys** — SerpAPI key, Google Places API key (stored in env, displayed masked)

### 6.4 Campaign Builder UI

The "+ New Campaign" button opens a form:

```
Campaign Name: [chicago-lawyers-pilsen        ]
Vertical:      [Lawyer ▼                      ]
Location:      [Pilsen, Chicago               ] (autocomplete + map pin)
Radius:        [3 miles ▼                     ]
Search Queries:
  [personal injury lawyer pilsen chicago      ] [×]
  [immigration attorney 18th street chicago   ] [×]
  [+ Add query                                ]
Max per run:   [20    ]
Enabled:       [✓]
                                    [Save Campaign]
```

---

## Phase 7: Outreach Integration (Future)

### 7.1 Outreach Email Generator

Once a prospect reaches "ready" stage, the system can generate a personalized outreach email:

```js
async function generateOutreachEmail(prospect, auditResults) {
  // Claude generates a short, personalized cold email
  // References specific findings from the audit
  // Includes the preview URL
  // Tone: helpful neighbor, not salesy agency
}
```

### 7.2 Outreach Channels (future expansion)

- Email (via SendGrid or similar)
- Direct mail (generate a PDF postcard with before/after)
- SMS (via Twilio — for hyper-local, personal touch)
- LinkedIn (manual for now — system generates the message, user sends it)

---

## File Structure Summary

```
features/leadgen/
├── prospector.js              # Discovery: SerpAPI → Firestore
├── scorer.js                  # Multi-signal scoring engine
├── quick-auditor.js           # Lightweight pre-audit (cheerio, no LLM)
├── audit-bridge.js            # Bridges scored prospects → existing runner.js
├── site-generator.js          # Assembles + deploys preview sites
├── design-guide-builder.js    # Extracted design → design guide
├── content-generator.js       # LLM content for preview sites
├── outreach-generator.js      # Outreach email/message generation
├── vertical-map.js            # GBP category → vertical classification
├── config.js                  # Reads leadgen_configs from Firestore
├── constants.js               # Scoring weights, defaults, thresholds
├── templates/
│   ├── preview-site.html
│   ├── preview-lawyer.html
│   ├── preview-dental.html
│   ├── preview-home-services.html
│   └── preview-restaurant.html
└── __tests__/
    ├── scorer.test.js
    ├── prospector.test.js
    └── quick-auditor.test.js

app/api/leadgen/
├── discover/route.js          # Cron: discovery
├── score/route.js             # Cron: scoring
├── audit/route.js             # Cron: audit fan-out
├── generate/route.js          # Cron: site generation
└── worker/
    └── audit-single/route.js  # Worker: single prospect audit

app/lead-generation/
├── page.jsx                   # Main dashboard page
├── components/
│   ├── StatsBar.jsx           # Pipeline stage counts
│   ├── ProspectTable.jsx      # Sortable/filterable table
│   ├── ProspectDetail.jsx     # Slide-out detail panel
│   ├── CampaignManager.jsx    # Campaign CRUD
│   ├── ScoringConfig.jsx      # Weight/threshold sliders
│   └── CampaignBuilder.jsx    # New campaign form
└── hooks/
    ├── useProspects.js        # Firestore listener for prospects
    └── useLeadgenConfig.js    # Firestore listener for configs
```

---

## Environment Variables (new)

```env
# Lead Generation
SERPAPI_KEY=your_serpapi_key
GOOGLE_PLACES_API_KEY=your_google_places_key
LEADGEN_CRON_SECRET=your_cron_secret          # reuse CRON_SECRET or separate
LEADGEN_PREVIEW_DOMAIN=preview.bballi.com     # or bballi.com/preview
LEADGEN_DAILY_BUDGET_DISCOVERIES=100
LEADGEN_DAILY_BUDGET_AUDITS=15
LEADGEN_DAILY_BUDGET_GENERATIONS=5
```

---

## Cost Estimates

| Stage | Cost per prospect | Daily (100 prospects) |
|-------|------------------|-----------------------|
| Discovery (SerpAPI) | ~$0.01 | $1.00 |
| Quick pre-audit | $0.00 | $0.00 |
| Scoring | $0.00 | $0.00 |
| Places API enrichment (30/day) | ~$0.017 | $0.51 |
| Full audit pipeline (15/day) | ~$0.05 | $0.75 |
| Screenshot capture (15/day) | ~$0.02 | $0.30 |
| Preview site generation (5/day) | ~$0.03 | $0.15 |
| **Daily total** | | **~$2.71** |
| **Monthly total** | | **~$81** |

Revenue potential: 1 closed deal at $3,000 covers 3 years of pipeline costs.

---

## Implementation Order

1. **`features/leadgen/quick-auditor.js`** — lightweight site scanner (cheerio only, no external APIs). This lets us test scoring immediately.
2. **`features/leadgen/scorer.js`** — scoring engine with all four signal dimensions.
3. **`features/leadgen/vertical-map.js`** — GBP category classifier.
4. **`features/leadgen/prospector.js`** — SerpAPI integration + Firestore persistence.
5. **`features/leadgen/audit-bridge.js`** — wire scored prospects into existing `runner.js`.
6. **`features/leadgen/site-generator.js`** + templates — preview site generation.
7. **`app/api/leadgen/` routes** — cron handlers + worker.
8. **`app/lead-generation/` UI** — dashboard, table, filters, campaign builder.
9. **Vercel cron config** — add the four new cron entries.
10. **End-to-end test** — run a single campaign manually, verify full pipeline.

---

## Risk Considerations

- **SerpAPI TOS / rate limits** — Respect Google's ToS. SerpAPI handles this on their end but monitor for blocks. Implement exponential backoff.
- **Google Places API costs** — Capped by dailyBudget. Monitor via GCP billing alerts.
- **Vercel function timeout** — Fan-out pattern avoids this. Each worker handles ONE prospect.
- **Prospect data freshness** — Businesses close, change phone numbers. Add a `lastVerifiedAt` field and re-verify prospects older than 30 days before outreach.
- **Legal / CAN-SPAM** — Cold email outreach must comply with CAN-SPAM. Include unsubscribe, physical address, honest subject lines. Consider starting with phone outreach for the hyper-local play.
- **Preview site liability** — The preview uses the prospect's brand colors and name. Include a clear disclaimer that this is a mockup/proposal, not an official site for the business.
