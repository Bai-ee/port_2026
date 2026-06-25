# HIT Agency — GTM Launch Plan
**Prepared:** 2026-06-23 | **Status:** Draft — ASSUMPTIONS REQUIRE USER CONFIRMATION

---

## ASSUMPTIONS BLOCK
> These were derived from the repo by reading code, copy, and pipeline docs. They are not confirmed by the operator. Validate before executing.

| Assumption | Source | Confidence |
|---|---|---|
| Core product is a self-serve Creative Brief SaaS, not a traditional design agency | README + SOURCE-OF-TRUTH | High |
| ICP is founder-stage / small agency teams, not enterprise | AiDesignConsultingPage.jsx "who-its-for" | High |
| Starting price point is $5/one-time-run or $4–$99/month subscriptions | SubscribeModal.jsx SUBSCRIPTION_TIERS | High |
| $3,500 is the floor for bespoke service engagements, separate from the SaaS product | HomePage.jsx hidden SEO h2 | Medium |
| Launch deliverable = Creative Brief pipeline + 8 dashboard cards | SOURCE-OF-TRUTH.md | High |
| Knowledge Base, Strategy Builder, Leadgen, Social Posting are gated (not in launch scope) | SOURCE-OF-TRUTH.md | High |
| Positioning is "AI-native, phase-gated, small-team-safe" — not "AI bolt-on" | AiDesignConsultingPage.jsx "What It Is" | High |
| Studio (GPU render / Video Promo card) is live but production GPU URL requires ops confirmation | SOURCE-OF-TRUTH.md ⚠ops | Medium |

---

## 1. Launch Context

**Product:** HIT Agency Platform — a multi-tenant client intelligence platform built by Bryan Balli (AI Design Engineer, Chicago). The core launch surface is a self-serve Creative Brief pipeline: a user submits a URL, pays, and receives a structured intelligence package including a Creative Brief, Executive/Market Brief, Visual Audit, Social Preview, Multi-Device Mock, Full Page Images, Video Promo, and a "Post Me" social card.

**Tech stack:** Next.js 16 / React 19 / Firebase / Vercel / Stripe / Claude API / Anthropic / Three.js / GSAP.

**Delivery model:** SaaS with a pay-per-run option ($5 one-time) and subscription tiers ($4–$99/month). A free tier gives 1 brief every 30 days. A premium "Studio" tier at $1,500/month adds human-in-the-loop creative services.

**Scope gate:** Launch ships only Creative Brief + Deliverables cards. Knowledge Base, Strategy Builder, Leadgen, and Social Posting automation are gated. Do not market gated features.

**Bryan's agency background:** Publicis, Epsilon, Conversant, Alliance Data — clients include TikTok, HBO Max, TST. This is credible social proof for the agency buyer segment.

---

## 2. Positioning

### Derived Positioning One-Liner
> **ASSUMPTION — confirm or rewrite:**
> "HIT Agency delivers an AI-powered Creative Brief for any website in minutes — structured brand intelligence, SEO baseline, visual audit, and social-ready assets, all from a single URL."

### Positioning Alternatives (pick one)
1. **Speed angle:** "Paste a URL. Get a full client brief in minutes, not weeks."
2. **AI-native angle:** "The first brief system where AI is the pipeline, not the plugin."
3. **Agency operator angle:** "Replace your onboarding questionnaire with an automated brief that arrives before the first call."

### What it is NOT
- Not another AI chatbot
- Not a generic website scanner / SEO tool
- Not a freelancer marketplace
- Not a competitor to Canva or Figma

---

## 3. Research Notes (from Repo)

**Deliverables confirmed live at launch (SOURCE-OF-TRUTH.md):**
- Creative Brief (brand snapshot, offer clarity, audience signals)
- Executive/Market Brief (competitor moves, trend signals)
- Video Promo (GPU render, Cloud Run L4 — verify ops before promoting)
- Visual Audit (style guide, design system tokens)
- Social Preview
- Multi-Device Mock
- Full Page Images (cross-device screenshots)
- Post Me (composed social caption card)

**Pricing (SubscribeModal.jsx — exact labels):**
- Free: 1 brief / 30 days
- Weekly: $4/month — 1 brief/week, exec + market
- Weekly+: $19/month — with 30 Days of Dynamic Content
- Daily: $39/month — 1 brief/day
- Continuous: $99/month — 2–3 briefs/day + human monitoring
- Studio: $1,500/month — dedicated human-in-loop + creative services
- One-time run: $5/brief

**Starting bespoke engagement floor:** $3,500 (from SEO-targeted hidden h2 in HomePage.jsx).

**Pipeline confirmed:** URL submission → scout intake modules → Claude API brief generation → Firebase dashboard_state → Stripe-gated client dashboard → PDF/ZIP download.

---

## 4. Competitive / ICP Analysis

### Competitive Landscape (ASSUMPTION — not verified by market research)
| Competitor | Category | Gap HIT exploits |
|---|---|---|
| Looka / Brandmark | Brand generation | No strategic brief; output is aesthetic only |
| Screaming Frog / Semrush | SEO audit | No brand layer; no visual deliverables; requires technical knowledge |
| Jasper / Copy.ai | AI content | No site intelligence; no design system output |
| Agency onboarding questionnaires | Status quo | Manual, slow, inconsistent; no automation |
| Runway / Synthesia | AI video | No business-intelligence layer; not brief-anchored |

### ICP (ASSUMPTION — derived from copy, not customer data)
**Primary ICP:** Independent founders and small teams (2–10 people) who are launching or refreshing a brand and need professional-grade intelligence fast, without a full agency engagement. Comfortable paying $5–$39/month. Tech-adjacent but not necessarily technical.

**Secondary ICP:** Small-to-mid agencies (boutique, 5–30 staff) who want to automate client onboarding briefs and sell the output as part of their discovery package. Likely the Studio ($1,500/month) or custom-engagement path.

**Tertiary ICP:** Solo consultants and freelance designers who want structured intake for new clients and need SEO/brand signals to frame their recommendations.

### ICP Jobs to Be Done
1. "I need to understand a client's brand before the first call."
2. "I need a one-page brief I can show a new hire without a 3-hour onboarding."
3. "I need SEO and visual audit materials to justify my engagement scope to a client."
4. "I need social-ready assets without waiting on a creative team."

---

## 5. Audience and Super-Spreaders

### First 100 Users (ASSUMPTION — validate with Bryan)
> **Bryan must confirm this cohort before outreach begins.**

| Cohort | Size estimate | Channel | Why |
|---|---|---|---|
| Bryan's direct network (agency contacts, ex-colleagues at Publicis/Epsilon/Conversant) | 20–40 | Direct DM / email | Highest trust; lowest friction |
| Chicago startup / founder community (1871, TechNexus, Built In Chicago) | 15–25 | In-person + LinkedIn | Local credibility; Bryan already based in Chicago |
| Freelance design/dev Twitter / X community | 20–30 | X posts + threads | Already tech-adjacent; high brief-share rate |
| Product Hunt early-access waitlist (pre-launch) | 30–50 | PH Coming Soon page | Platform incentivizes sign-ups before launch day |
| Indie Hacker community (IH forums + newsletter) | 10–20 | IH post + Show HN adjacent | Founder-dense; loves "built this in X weeks" stories |

**Super-Spreaders to identify and warm before launch day:**
- Agency owners who share tools publicly on X/LinkedIn
- Design Twitter accounts with 5K–50K followers who post about process/workflow
- Newsletter writers covering AI tools for creatives (The Rundown, Ben's Bites, TLDR Design)
- IH "makers" who cross-promote launches

---

## 6. Launch Loops

### Loop 1 — "Try it on your own site" Viral Loop (PRIMARY)
**Mechanism:** Free tier (1 brief / 30 days) allows zero-friction first use. User pastes their own URL, gets the Creative Brief, then shares a screenshot or the "Post Me" card on X/LinkedIn. Output contains visible HIT Agency branding + URL.

**Trigger:** The "Post Me" card is literally a built deliverable (confirmed live). This is the built-in viral surface. Every brief produced can become a post.

**Loop:** User gets brief → shares "Post Me" card on social → audience sees HIT Agency brand → clicks → signs up for free brief → shares their own → loop repeats.

**Investment needed:**
- "Post Me" card must include a subtle but visible "Made with HIT Agency" badge
- CTA on the shared card should link to the homepage with UTM tracking
- Low-friction sharing (pre-populated tweet text on the dashboard)

### Loop 2 — Agency Operator Referral Loop (SECONDARY)
**Mechanism:** Agency operators who use the product embed HIT Agency briefs in their client deliverables. Clients see the brief format and ask "how did you make this?"

**Trigger:** The Studio tier ($1,500/month) or bespoke engagements ($3,500+) produce polished deliverables that agencies present to their own clients.

**Loop:** Agency operator subscribes → includes brief in client presentation → client asks about it → operator refers client → client signs up for Weekly or Daily tier → loop compounds.

**Investment needed:**
- White-label or co-brand option would dramatically accelerate (currently not scoped — flag as a future growth lever)
- Agency case study content ("How Agency X uses HIT brief to cut onboarding from 3 hours to 20 minutes")

### Loop 3 — Comparison Hook Loop (ACQUISITION)
**Mechanism:** Run briefs on competitor or well-known brand URLs, publish the output as comparison content. "What the HIT brief found about [Brand X]'s site" as X threads, newsletters, or Reddit posts.

**Trigger:** The Visual Audit, Multi-Device Mock, and SEO/GEO signals in the brief are inherently shareable. "Here's what our AI found on [Famous Startup]'s homepage" is highly clickable content.

**Loop:** Public-facing brief excerpt published → audience engagement → "what does it say about MY site?" → sign-up → first run → share → acquisition loop.

**Investment needed:**
- Permission/legal check: publishing brief outputs on third-party URLs (brief analysis of public sites is generally fine; confirm no TOS issues)
- 3–5 "demo briefs" on well-known startup sites published before launch day as seed content

---

## 7. Distribution

### Channel Priority (2026 playbook)

**Tier 1 — Highest ROI, execute immediately:**

**Product Hunt**
- Launch on Tuesday or Wednesday, 12:01 AM PST
- "Product of the Day" target — needs 100+ upvotes in first 6 hours
- Hunter: Bryan or a PH-credible friend with 500+ followers
- PH-specific angle: "Paste your URL. Get a Creative Brief in minutes."
- Maker comment must be posted immediately at launch — personal story, authentic
- Prepare 5–10 supporters to upvote and leave genuine comments at launch
- Asset: 3 GIF/video clips of the dashboard in action (< 30 seconds each)
- Gallery: before/after of manual brief vs. HIT brief output

**X (Twitter)**
- Bryan's personal account is the primary distribution vehicle
- Pre-launch: post a 3-part thread "I spent 6 months building this" with demo clips
- Launch day: post the PH link + a visual demo of the "Post Me" card output
- Tag design/AI/founder community accounts who have shared similar tools
- Use "Build in Public" angle — share WIP screenshots in the weeks before launch
- 2026 note: X reach is still strongest for maker/builder audiences; do not abandon for LinkedIn-only

**Hacker News — Show HN**
- Title format: "Show HN: I built an AI Creative Brief — paste a URL, get brand + SEO + visual audit"
- Post Tuesday or Wednesday morning (9–11 AM EST)
- Do not post same day as PH — stagger by 2–3 days to maximize each channel's window
- Lead comment: technical explanation of pipeline (Claude API + Next.js + Firebase + Cloud Run GPU for video) — HN audience rewards technical depth
- Prepared for: "why not just use ChatGPT?" — answer is the pipeline automation, structured output, and deliverable packaging (ZIP, PDF, social card)

**Tier 2 — High-fit, lower-volume:**

**Reddit**
- r/Entrepreneur, r/startups, r/webdev, r/designtools
- Post format: "I quit my agency job to build this — here's what an AI Creative Brief actually outputs" (story-first, not ad-first)
- Include real output screenshots — Reddit responds to tangible proof
- Avoid: r/artificial (too noisy); avoid cross-posting the same post to multiple subs on the same day

**LinkedIn**
- Bryan's agency background (Publicis, Epsilon, TikTok, HBO Max) is directly relevant here
- Post 1 week before launch: "After 10 years in agencies I noticed every engagement started the same way — a 3-hour onboarding call to gather a brief. I automated it."
- LinkedIn algorithm rewards native video: post a short walkthrough clip (not a link)
- Target: agency owners and creative directors who are 1st-degree connections

**Newsletters (pitch 2–3 weeks before launch):**
- Ben's Bites (AI tools for builders) — pitch as "new AI brief tool"
- The Rundown AI — pitch the pipeline story (Claude + GPU video + structured output)
- TLDR Design — pitch the visual audit + design system extraction angle
- Indie Hackers newsletter — pitch the "built in public" story with MRR potential

**Tier 3 — Longer burn, compound over time:**

**SEO / Content**
- GEO-ANALYSIS.md exists in the repo — Bryan has already done this work
- Target: "AI creative brief tool", "automated client brief generator", "brand audit AI"
- Publish 3–5 "demo brief" posts (real site analyses) as blog content before launch
- These also seed the Comparison Hook Loop (Loop 3)

**Cold outreach**
- 30–50 personalized DMs to agency operators Bryan already knows or has worked with
- Message: "Built something that automates the brief we always had to write by hand — want to see it?"
- Do not blast; do not use templates that read as spam

---

## 8. Timeline and War Room

### Pre-Launch (T-4 weeks: June 23 – July 20, 2026)

| Week | Action |
|---|---|
| Week 1 (now) | Confirm: Stripe live mode, GPU render service URL, Vercel env vars. Run 5 internal test briefs end-to-end. Fix "Post Me" social share CTA with UTM. |
| Week 2 | Build 3–5 "demo briefs" on public well-known startup sites. Publish to site as /blog or /examples. Begin X "build in public" thread series. |
| Week 3 | Pitch Ben's Bites, TLDR Design, The Rundown. Warm 5–10 PH supporters. DM Bryan's 30 highest-trust agency contacts. PH Coming Soon page live. |
| Week 4 | Lock all copy. Record 3 demo GIFs/clips. Write PH tagline, description, and first maker comment. Draft HN Show HN post. Confirm free tier cooldown UX is polished. |

### Launch Day (T-0: recommended Tuesday July 22 or 29, 2026)

| Time | Action |
|---|---|
| 12:01 AM PST | Product Hunt goes live |
| 6:00 AM PST | Bryan posts X thread linking PH |
| 7:00 AM PST | First PH maker comment posted |
| 8:00 AM PST | Notify all supporters to upvote |
| 9:00 AM PST | LinkedIn native video post |
| 12:00 PM PST | Mid-day update post on X with real-time stats |
| 3:00 PM PST | Reddit posts go live (stagger: r/Entrepreneur then r/webdev 2 hours later) |
| 6:00 PM PST | Evening recap post on X |

### Post-Launch (T+1 to T+4 weeks)

| Week | Action |
|---|---|
| Week 1 post | Show HN post (2–3 days after PH to avoid overlap). Respond to every comment personally. |
| Week 2 post | First paid subscriber case study or testimonial posted. Newsletter placements go live. |
| Week 3 post | Cold outreach batch 2 (warm leads who interacted with launch content). |
| Week 4 post | Retro: conversion rate from free → paid, which channel drove paying users, what briefs got shared. |

---

## 9. Creative and Asset Bank

### Required before launch:
- [ ] 3 screen-capture GIFs or MP4s: (1) URL paste → brief delivered, (2) dashboard card walkthrough, (3) "Post Me" card generation
- [ ] 1 hero screenshot: dashboard with all 8 cards populated (use a real or seeded demo account)
- [ ] 3 "demo brief" outputs on recognizable public sites (with permission or using public info only)
- [ ] PH tagline (< 60 chars): "AI Creative Brief — paste a URL, get brand + SEO + visual"
- [ ] PH description (< 260 chars): the why story, not the what
- [ ] X launch thread (5–7 tweets): open with the problem ("every agency engagement starts with a manual brief"), build to the solution, close with the PH link
- [ ] HN Show HN post (title + first comment): technical depth, pipeline explanation
- [ ] LinkedIn native video (30–60 sec): screen recording with voiceover

### Optional but high-leverage:
- [ ] Side-by-side: "manual onboarding brief (3 hours) vs. HIT brief (8 minutes)"
- [ ] "What our AI found on [Famous Startup]'s site" — shareable comparison thread
- [ ] Email sequence for free-tier users: 3 emails over 14 days → upgrade to Weekly or Daily

---

## 10. Product Requirements (GTM-blocking items)

> These are items the GTM plan depends on that are either confirmed gaps in SOURCE-OF-TRUTH.md or risks identified from reading the code.

| Item | Status | Blocking? | Notes |
|---|---|---|---|
| Stripe live mode + webhook secret | ⚠ops — unconfirmed | YES | Cannot take real payments without this |
| GPU render service (STUDIO_RENDER_URL) | ⚠ops — "verified 2026-06-23" but env not confirmed in prod | YES for Video Promo card | Can launch without promoting this card if not confirmed |
| "Post Me" share CTA with UTM tracking | Not confirmed in code | YES for viral loop | Add UTM `?ref=post-me` to shared URL |
| "Made with HIT Agency" badge on Post Me card | Not confirmed | HIGH | Core viral surface |
| Free tier cooldown UX polish | Partially confirmed | NO (but affects activation) | Cooldown panel exists; confirm it renders correctly for new users |
| "Already running" guard on brief-run route | Known gap (SOURCE-OF-TRUTH.md) | NO for launch | UI-guarded; note post-launch hardening |
| PDF export on briefs | Confirmed feature (commit 8230501) | NO | Good launch talking point |

---

## 11. Metrics

### North Star
**Activated paying users in 30 days** (free-tier user who upgrades to any paid tier, OR completes a $5 one-time run)

### Launch Week Targets (ASSUMPTION — set real targets with Bryan)
| Metric | Target |
|---|---|
| PH upvotes | 200+ (top 5 of day) |
| Unique visitors on launch day | 500+ |
| Free tier sign-ups (30 days) | 100 |
| Activated paying users (30 days) | 10–20 |
| MRR at day 30 | $200–$800 |
| "Post Me" cards shared publicly | 15+ |
| HN Show HN front-page | Yes (target top 10) |

### Funnel to track:
```
Homepage visit
  → Free brief started
    → Brief delivered (dashboard loaded)
      → "Post Me" card generated
        → Share clicked
          → Referral visit
      → Upgrade modal opened
        → Payment started
          → Paying subscriber
```

### Do NOT optimize for:
- Raw traffic without activation (PH traffic is often low-intent; brief delivery = real intent signal)
- Vanity social impressions without click-throughs
- Newsletter opens without sign-ups

---

## 12. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| GPU render service not confirmed in prod before launch | Medium | High (Video Promo card fails for early users) | Launch without promoting Video Promo card; add "coming soon" state to card if ops not confirmed |
| Stripe live mode not verified | Medium | Critical | Block launch until Stripe test payment confirmed end-to-end |
| "Brief already running" rapid-resubmit bug | Low (UI-guarded) | Medium | Acceptable for launch; queue serial; add hard guard post-launch |
| Free tier used as permanent tool without converting | High | Medium | 30-day cooldown is strong; add upgrade prompt at cooldown wall |
| PH launch falls flat (< 50 upvotes) | Medium | Medium | Prepare HN Show HN as independent channel; launch is not PH-dependent |
| Demo brief published on third-party site causes objection | Low | Low | Use publicly available site data; no proprietary info surfaced |
| Bryan perceived as "just a portfolio site" not a real product | Medium | High | Ensure paying-user proof (even 1–2 testimonials) before PH day |

---

## 13. Post-Launch Playbook (Template)

To be filled in at T+7, T+14, T+30:

```
## Week [N] Post-Launch Retro

**Paying users:** X
**MRR:** $X
**Top acquisition channel:** [PH / HN / X / LinkedIn / referral]
**Best-converting content:** [link]
**Post Me cards shared:** X
**Free-to-paid conversion rate:** X%
**Top user feedback:** [3 bullet points]
**Biggest surprise:** [1 sentence]
**Next 2-week focus:** [one thing]
```

---

## 14. Final Recommendation — Single Strategy to Execute

**Launch on Product Hunt with X as the amplification layer, anchored by the "Post Me" viral card as the built-in sharing mechanism.**

This is the highest-ROI path because:
1. The product has a built-in viral surface (Post Me card). This is rare. Use it.
2. Bryan's agency credibility (Publicis, TikTok, HBO Max) is the trust anchor — lead with it in PH copy and HN comment.
3. The $5 one-time run removes the subscription barrier for the first conversion. Let users buy one brief, see the output, then upsell to recurring.
4. PH + HN together cover both the "maker/founder" ICP (PH) and the "technical skeptic" ICP (HN). Both are valid buyers or super-spreaders.

**Do not spread across all channels simultaneously.** Execute in sequence: PH first, then Show HN 3 days later, then Reddit and LinkedIn in the following week. Each channel benefits from the momentum of the previous.

### Immediate Next Actions (in order)

1. **Ops check (Bryan, today):** Confirm Stripe live mode, GPU render URL, and run one full end-to-end brief payment + delivery in production.
2. **Post Me viral surface (this week):** Add "Made with HIT Agency" badge + UTM-tagged share URL to the Post Me card output. This is the single highest-leverage technical change before launch.
3. **3 demo briefs (this week):** Run briefs on 3 well-known public startup sites. Screenshot and save outputs. These are your PH gallery and X thread material.
4. **PH Coming Soon page (this week):** Go live at producthunt.com/products. Start collecting email subscribers before launch day.
5. **Warm 10 supporters (next week):** DM Bryan's highest-trust contacts. Ask for upvotes and one genuine comment on launch day, not before.
6. **Launch day: Tuesday July 22 or 29, 2026.**

---

## 15. Sources

All claims in this document are derived from the following repo files (verified by read, not assumed):

- `/README.md` — product name, stack, pipeline overview
- `/CLAUDE.md` — architecture orientation, launch scope, feature map
- `/HomePage.jsx` — hidden SEO h2 (positioning, engagement floor, timeline, client names)
- `/AboutPage.jsx` — Bryan's background, agency credentials, approach
- `/AiDesignConsultingPage.jsx` — "What It Is", "Who It's For", "What You Get", service list
- `/BrandIdentityPage.jsx` — brand snapshot deliverables, turnaround times
- `/SeoGeoPage.jsx` — SEO/GEO/performance/content intelligence service scope
- `/WebDevelopmentPage.jsx` — stack, build types, timeline, quality standards
- `/components/payments/SubscribeModal.jsx` — exact pricing tiers ($4, $19, $39, $99, $1.5K/month), free tier mechanics, $5 one-time run, crypto option (not launched)
- `/docs/source-of-truth/SOURCE-OF-TRUTH.md` — 8 launch cards (confirmed live), pipeline file-by-file trace, gated features, known gaps, cron jobs, collections

**Channel playbooks used:** Product Hunt 2025–2026 best practices (launch timing, hunter selection, maker comment strategy); HN Show HN conventions; Reddit community norms; X/Twitter build-in-public pattern; newsletter outreach timing.

**Market research:** NOT included — this plan contains zero external competitive data verified by web search. Competitive landscape table is based on category knowledge only. Recommend running a basic competitive sweep before finalizing positioning.
