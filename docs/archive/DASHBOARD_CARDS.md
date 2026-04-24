# Dashboard Cards & Nav Buckets

## Tile Cards (AI Automation & Workflows — all have "Chat with Bryan" CTA)

| Card | Description | Visual When Data Available | Placeholder / Fallback |
|------|-------------|---------------------------|------------------------|
| **01 · CREATIVE PIPELINES** | Posts drafted in real time, aligned to your brand voice and audience. | Segmented bar chart (Instagram 8/10, X/Twitter 10/10, LinkedIn 6/10, TikTok 4/10) — hardcoded demo data. | Same demo viz always renders. |
| **02 · COMPANY BRAIN** | Your entire knowledge stack indexed, organized, and instantly queryable. | 16×7 memory-node grid with random on/hot/off states — animated dot matrix. | Same demo viz always renders. |
| **03 · KNOWLEDGE ASSISTANT** | Team asks a question; system pulls the answer directly from your own docs. | Mock Q&A block: "WHERE IS Q3 ROADMAP?" with a simulated answer and blinking cursor. | Same demo viz always renders. |
| **04 · EXECUTIVE SUPPORT** | Every meeting pre-briefed with full context loaded before you sit down. | Meeting schedule list (Board Sync, Design Review, Investor Call, 1:1) with READY/DRAFTING badges. | Same demo viz always renders. |
| **05 · DAILY OPERATIONS** | Triage, task tracking, and reports — runs every day without oversight. | Three SVG score rings: TRIAGE 87%, TASKS 62%, UPDATES 100%. | Same demo viz always renders. |
| **06 · EMAIL MARKETING** | Campaigns built, scheduled, and optimized across regions from one system. | Sparkline chart showing 38.4% open rate with EU/NA/APAC region chips. | Same demo viz always renders. |
| **07 · AI RESEARCH** | Consumer insights, competitive analysis, and market validation — in hours. | Large countdown timer "48H TO DELIVERY" with "COMPETITOR TEARDOWN · Q2 2026" subtitle. | Same demo viz always renders. |
| **09 · COMPLIANCE MONITORING** | Deadlines, filings, and rules — monitored daily so nothing slips through. | Deadline tracker rows (Form 10-Q, CA Sales Tax, GDPR Audit, SOC 2) with days remaining and progress bars. | Same demo viz always renders. |
| **10 · DISTRIBUTION & INSIGHT** | Publishing, SEO fixes, and rankings — unified into one continuous system. | Mini table: Organic/Social/Referral/Direct channels with post counts and rank deltas. | Same demo viz always renders. |
| **11 · RAPID PRODUCT DEV** | Tools and integrations scoped, built, and shipped from a single request. | Pipeline tracker: BRIEF → SPEC → BUILD → QA → SHIP with done/active states. | Same demo viz always renders. |
| **12 · SELF-IMPROVING** | Tracks outcomes and refines execution rules automatically from feedback. | Delta comparison bars: Response Time +12%, Accept Rate +8%, Cost/Run −18% with before/after bars. | Same demo viz always renders. |
| **13 · REDDIT & COMMUNITY** | Finds relevant threads and drafts contextual replies — queued for review. | Thread list from r/saas, r/startups, r/marketing, r/devops, r/biz with draft counts and WATCH status. | Same demo viz always renders. |
| **14 · SEO CONTENT** | Surfaces content gaps and delivers drafts aligned to your keyword targets. | Keyword opportunity rows (AI Agents for Startups 18K/mo, etc.) with search-volume bars. | Same demo viz always renders. |
| **15 · MULTI-AGENT PIPELINE** | Four-agent pipeline running daily — Scout, Scribe, Guardian, and Reporter. | Segmented bar chart — same viz as Creative Pipelines. | Same demo viz always renders. |
| **16 · HYPERLOCAL SIGNALS** | X, Instagram, Reddit, reviews, and weather — normalized and synthesized. | Sparkline chart with region chips — same viz as Email Marketing. | Same demo viz always renders. |
| **17 · PLATFORM CONTENT GEN** | Instagram, X, Facebook, Discord — formatted and voiced for each channel. | Thread/list viz — same as Reddit & Community. | Same demo viz always renders. |
| **18 · BRAND SAFETY GATE** | Restricted terms, competitor mentions, factual accuracy, voice scoring. | Deadline tracker — same viz as Compliance Monitoring. | Same demo viz always renders. |
| **19 · FOUNDER DAILY BRIEF** | Priority action, signals, and QA-approved drafts — delivered on schedule. | Meeting schedule list — same viz as Executive Support. | Same demo viz always renders. |
| **20 · ADMIN & BRIEF HISTORY** | Real-time dashboard and complete archive of every brief and run on record. | Mini channel table — same viz as Distribution & Insight. | Same demo viz always renders. |
| **21 · IMAGE GENERATION** | Canvas generator with logo placement, text controls, and a live preview. | Three SVG score rings — same viz as Daily Operations. | Same demo viz always renders. |
| **22 · KNOWLEDGE FILE CONFIG** | Swap JSON knowledge files to onboard a brand — no code changes. | Memory-node grid — same viz as Company Brain. | Same demo viz always renders. |

---

## Capability Cards (data-driven — visual changes based on intake state)

| Card | Nav Bucket | Description | Visual When Data Available | Placeholder / No-Data State |
|------|------------|-------------|---------------------------|----------------------------|
| **BR · BRIEF** | Brand Identity & Design | Synthesized creative brief from intake signals — brand positioning, audience frame, voice, and the one move most worth making right now. | Renders a live **iframe preview** of the generated brief document (scaled to fit the card). | Text: "BRAND BRIEF" (or "NO BRIEF" if intake incomplete). |
| **08 · INTAKE TERMINAL** | Websites & Landing Pages | Tracks every scraped page, extracted signal, and normalization decision across the full intake lifecycle. | AI-generated **multi-device website mockup image** (desktop + tablet + phone) from the user's URL. | Text: intake status (e.g., "QUEUED", "RUNNING", "COMPLETE") or "SEO AUDIT" during re-run. |
| **BT · SOCIAL PREVIEW** | Brand Identity & Design | Open Graph metadata, Twitter Card tags, favicon, and canonical URL parsed from your live homepage. | Shows the live **OG image** from the user's website with favicon overlay. | Text: "FIX SOCIAL PREVIEW" (if OG missing) or "VOICE PREVIEW" / "NO SIGNALS" (brand-tone fallback). |
| **SG · STYLE GUIDE** | Brand Identity & Design | Typography, color palette, layout system, and motion signals extracted from your live site's CSS. | **4-quadrant grid**: brand-mark logo, color swatches, typography specimen, primary→secondary gradient. | Text: "STYLE SNAPSHOT" (or "NO STYLE" if no CSS extracted). |
| **SP · SEO + PERF** | SEO & Content Strategy | Core Web Vitals, Lighthouse scores, and meta-tag coverage from PageSpeed Insights. | **SVG score rings** (Perform, SEO, Access, BP) + LCP/CLS bars + diagnostic tiles with gradient numbers. | Text: "SITE AUDIT" (or "NO AUDIT" / "AUDIT QUEUED" / "SEO AUDIT FAILED" depending on state). |
| **IN · INDUSTRY** | Content & Social Media | Market vertical and service category normalized from intake signals. | No visual — shows data rows (Sector) in modal only. | Text: "MARKET CATEGORY" (or "INDUSTRY UNKNOWN"). |
| **BI · BIZ INFO** | Websites & Landing Pages | Revenue structure and commercial setup extracted from pricing pages and service tiers. | **Homepage screenshot** pulled from the user's live site. | Text: "REVENUE MODEL" (or "NO MODEL"). |
| **PS · PRIORITY SIGNAL** | Content & Social Media | The highest-confidence marketing move available right now — derived from brand readiness, content gaps, and channel fit. | No visual — shows Focus + Channel rows in modal. | Text: "SIGNAL BRIEF" (or "NO SIGNAL"). |
| **DP · DRAFT POST** | AI Automation & Workflows | A publish-ready social draft built from your brand voice, audience frame, and priority signal. | No visual — shows the drafted post text in modal rows. | Text: "POST DRAFT" (or "NO DRAFT"). |
| **CA · CONTENT ANGLE** | Content & Social Media | The specific editorial lens, audience pain point, and positioning frame selected for the next content push. | No visual — shows Angle + Format rows in modal. | Text: "ANGLE LOCKED" (or "NO ANGLE"). |
| **CO · CONTENT OPPORTUNITIES** | Content & Social Media | Ranked list of content and channel moves with the highest signal-to-noise ratio. | No visual — shows opportunity list in modal rows. | Text: "OPPORTUNITY MAP" (or "NO DATA"). |
| **CI · COMPETITOR INFO** | AI Automation & Workflows | Competitive landscape pulled from live sources — positioning, messaging, and offer comparison. | No visual — work-needed message in modal. | Text: "NOT MAPPED" (permanent placeholder until intake supports competitor mapping). |
| **SG · SIGNALS** | AI Automation & Workflows | Live signal feed from geographic events, trending topics, and social conversations relevant to your brand. | No visual — work-needed message in modal. | Text: "NO SIGNALS" (permanent placeholder until intake supports signal collection). |
| **MK · MARKETING** | AI Automation & Workflows | Strategy recommendations generated from live signals — cross-referenced with brand positioning. | No visual — work-needed message in modal. | Text: "NO STRATEGY" (permanent placeholder until intake supports strategy generation). |
