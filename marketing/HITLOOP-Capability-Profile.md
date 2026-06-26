# HITLOOP — Capability Profile

> Capabilities document for HITLOOP (the product/company): what it is, what it does, where it
> excels and where it's thin. Structured to the Client Brain section model
> (Identity · About · Positioning · Voice · Audience · Proof · Offers · Do · Do not · Content pillars)
> so it doubles as a Brain source — drop into a SOURCE, set `useFor` toggles, generate + approve.

---

## Identity

HITLOOP (hitloop.agency) is a human-in-the-loop creative operating system — a productized agency pipeline that turns a client's website into a repeatable set of brand and marketing deliverables. It is a multi-tenant SaaS: clients sign up, and the system scouts their brand and market, then generates a creative brief, an executive/market brief, a video promo, social and multi-device mockups, and a downloadable kit.

Built by Bryan Balli (Bai-ee), Creative Systems Architect. Stack: Next.js 16 / React 19 / Firebase / Vercel, with a Cloud Run GPU studio for video render. The defining trait of the system is discipline: a single `cardId` contract wiring data source to deliverable, single-source state, and self-verifying documentation.

## About

HITLOOP encodes creative-agency judgment — brand brief, brand voice, QA — into a pipeline that runs the same way for every client, on a schedule, unattended. It is the "factory": scale, repeatability, persistence, and rendering. It is not a chat assistant and not a bespoke service; its value is producing the same high-quality output across many clients without a human redoing the work each time.

## Positioning

The productized agency-in-a-box for founders and small/local businesses: sign up and get a full creative brief plus a video promo for your brand in minutes, not a six-week agency engagement.

Strategic frame to reinforce: HITLOOP is the **factory layer** — repeatable client delivery at scale. Open-ended strategy, positioning, and go-to-market are a **separate lab layer** (operator + AI judgment). HITLOOP produces client deliverables; it does not produce its own strategy. Sell the factory on what it does best — speed, repeatability, proof — not on open-ended cleverness.

Core differentiators:
- Website-in, full kit-out — automated brief → deliverables, no manual agency cycle.
- Deterministic and repeatable — same wiring, same quality, every run.
- Multi-tenant with persistent state, billing, and scheduled market monitoring.
- Heavy rendering built in — GPU video promo, not just text.

## Capabilities (what HITLOOP does well)

- Deterministic, repeatable output — same brief → deliverables pipeline per client, wired by `cardId`.
- Persistent multi-tenant state — Firestore `dashboard_state`, brief runs, usage, auth, gating, Stripe billing.
- Scheduled, always-on ingestion — scout engine + cron pull market signals on a cadence; daily digest emails.
- Heavy rendering — Cloud Run GPU video studio, FFmpeg bridge, Arweave archival.
- Encoded domain knowledge — brand voice, Guardian QA, analysis recipes; versioned and reusable per client.
- A product surface — dashboard cards, downloadable kits; something a customer logs into and pays for.

## Limits (where HITLOOP is thin)

- Off-rail work needs code — anything outside the templated pipeline is an engineering task.
- Can't produce its own strategy or launch — it makes client deliverables, not its own GTM.
- Demand under-built vs supply — strong factory, weak distribution: zero Reddit (Perplexity's #1 source), no Wikipedia, weak authority signals.
- Proof is thin — one dogfood client; needs 2–3 visible before/after case studies.
- Every capability is also an ops liability — Vercel env, GPU health, queue depth, Stripe live mode.

## Voice

Short, direct, tactical, systems-first. Low fluff, no generic agency language, no hype. Calm authority. Founder- and operator-facing. Lead with the outcome and the mechanism, not adjectives.

Example lines in voice:
- "Most brands optimize for launch day. Few optimize for year three. Durability > hype."
- "AI generates options. Systems decide what survives."
- "Your website in. A full creative brief and video promo out. In minutes."

## Audience

Primary ICP: solo founders and small / local businesses that need brand and marketing output but can't afford a full agency cycle. Dogfood anchor: It's Raw Poke Shop (San Diego poke restaurant evaluating online ordering) — proof the pipeline works on a real local business.

Secondary: small agencies and operators who want to productize their own delivery.

Buyer mindset: time-poor, outcome-driven, skeptical of agency fluff, convinced by visible before/after proof.

## Proof

- Live product at hitloop.agency with a real client dashboard and downloadable deliverable kits.
- Disciplined architecture: `cardId` join key, single-source `dashboard_state`, source-of-truth docs tagged by verification method.
- Dogfood client (It's Raw Poke Shop / "Fast Poker") run through the pipeline.
- Gap to close for launch: 2–3 visible before/after case studies. Proof is currently thin and is the top believability priority.

## Offers

Shipping (launch scope): Creative Brief bucket + Deliverables bucket — Creative Brief, Executive/Market Brief, Video Promo, Visual Audit, Social Preview, Multi-Device Mockup, Full-Page Images, Post Me.

Gated / roadmap (do not market yet): Knowledge Base, Strategy Builder, Leadgen, social-posting automation, Client Brain, scout/market-signals depth, archival publishing.

## Do

- Lead with the wow: sign up → full brief + video promo for your brand in minutes.
- Speak to outcomes and mechanisms; keep it tactical and concrete.
- Use visible before/after proof to carry believability.
- Position as the repeatable factory for client delivery at scale.

## Do not

- Do not pitch HITLOOP as an open-ended "ask-it-anything" assistant — that is the lab layer, not the product.
- Do not market gated/roadmap features as available.
- Do not use generic agency language, hype, or vague "transform your brand" copy.
- Do not over-claim distribution/authority — that is currently a known gap, not a strength.

## Content pillars

- Productized creative infrastructure — agency judgment encoded as a pipeline.
- Human-in-the-loop automation — AI generates, systems and operators decide.
- Durability over hype — building for year three, not launch day.
- Speed to proof — website in, deliverables out, before/after as the unit of trust.
- Systems-first operating discipline — single source of truth, repeatable wiring.

---

## Strategic note (operator context, not client-facing copy)

HITLOOP has over-invested in supply (a genuinely strong factory) and under-invested in demand (distribution, sharp positioning, proof). The GEO posture confirms it: strong crawler access and technical accessibility, but zero Reddit presence (Perplexity's #1 source), no Wikipedia, weak authority signals. The launch motion itself — positioning, ICP, messaging, channel seeding, the launch moment — is lab work, built outside the system; HITLOOP serves as the proof engine and, post-launch, the content/monitoring loop.

Routing rule: same output, many times, unattended → HITLOOP. Novel output, once, needs judgment → the lab.
