# HITLOOP vs "Connect Claude to your social manager" — Capability Audit

> Audit prompted by the viral OmniSocials post: *"we can now connect our social media
> manager directly to Claude … Claude can draft, schedule, and publish to 10 platforms
> from one single command. No Hootsuite. No Buffer. No per-seat pricing."*
>
> Question asked: what does that product claim to do that **can't be done just with Claude**,
> where's the daylight against what HITLOOP actually is, and what's the honest callout.
>
> Every load-bearing claim about HITLOOP below is code-verified (`✓ file:line`). Claims about
> the OmniSocials product are read off the marketing post and the general shape of an MCP
> "custom connector," and are labelled as such — we have not audited their backend.

---

## TL;DR — the nugget

**The one thing that post sells as magic — "Claude publishes to 10 platforms" — is the exact
part that is NOT Claude.** Claude drafts text. Everything after the word *publish* — per-platform
OAuth, a scheduler that survives serverless restarts, rate-limit / credit / duplicate handling,
media upload, retries — is a **paid third-party backend** you're renting from OmniSocials and
reaching through a custom MCP connector. The screenshot even shows the tell: *"Add Custom
Connector."* That's not a Claude feature shipping; that's you wiring your posting keys into an
unvetted external service and letting it act as Claude's hands.

So the honest framing:

1. **It isn't a Claude capability.** It's a paid SaaS with a Claude-shaped front door. "No
   per-seat pricing" is per-seat pricing with the seats renamed — you've swapped Hootsuite's bill
   for OmniSocials' bill, plus a new connector holding write-access to 10 accounts.
2. **The value was never the drafting.** Drafting is the free, easy, actually-Claude part.
   The value — and the risk — is the *loop around the draft*: approval, brand-voice guardrails,
   algorithm-quality checks, durable scheduling, real publish-error handling. "One command → 10
   platforms, published" is precisely the design that **strips that loop out**.
3. **That's the anti-pattern HITLOOP is named after.** HITLOOP = *human-in-the-loop*. It treats
   an AI draft as **step one** of a pipeline, not a fire-and-forget command.

We should **not** counter-claim "HITLOOP does 10 platforms better." It doesn't — see the honesty
box. The differentiation is **depth and posture, not breadth.**

---

## What "just Claude" can and can't do (so we're precise)

| Step | Just Claude (in a chat / normal MCP) | Requires an external paid backend |
|---|---|---|
| Draft a post in brand voice | ✅ yes — this is the core model capability | — |
| Rewrite / improve / fix a draft | ✅ yes | — |
| **Schedule** a post for later | ❌ no — a chat has no durable timer or cron | ✅ a scheduler + persistent store |
| **Publish** to X / IG / LinkedIn / … | ❌ no — needs each platform's OAuth + API | ✅ per-platform auth + publish infra |
| Survive a restart with the queue intact | ❌ no | ✅ durable storage, not process memory |
| Handle rate limits / billing / duplicates per platform | ❌ no | ✅ real error handling per API |

Everything in the right-hand column is what OmniSocials *is* — and it's the unglamorous 90% the
post waves past with "from one single command." **HITLOOP has actually built that column** (for
the platform it ships), which is why we can speak to it concretely instead of hand-waving.

---

## What HITLOOP actually ships (code-verified)

HITLOOP ships **production social posting for exactly one platform — X/Twitter** — and it is
built depth-first. This is the point: the hard part isn't posting to *ten* places, it's posting
to *one* place *correctly, on a schedule, without a human babysitting it.*

- **Real publish path, not a demo.** `postToTwitter()` uses OAuth 1.0a via `twitter-api-v2`,
  uploads media, and maps X's real failure modes — 403 `client-not-enrolled`, 401 auth, 429
  rate limit, **402 out-of-credits**, duplicate-content rejection — each to an actionable hint.
  `✓ features/social-posting/twitter-service.js:567, mapTwitterError ~:480`. *This is the exact
  layer "publish from one command" pretends doesn't exist.*
- **Scheduling that survives serverless.** Scheduled posts live in a top-level Firestore
  `social_posts` collection, **not** a local file — because "the file is ephemeral on Vercel
  serverless, so scheduled posts written by one invocation were invisible to the cron in the
  next." `✓ twitter-service.js:16-23`. A cron (`/api/social-posting/process-due`, `*/15 * * * *`)
  sweeps due posts. `✓ vercel.json`, `app/api/social-posting/process-due/route.js`. **This is the
  precise bug "schedule to 10 platforms" hides** — if their scheduler is naïve, posts silently
  never fire.
- **A human-in-the-loop status machine.** Posts move `draft → scheduled/queued → posting →
  posted/failed`; `DUE_STATUSES` only ever picks up `scheduled|queued|failed`.
  `✓ twitter-service.js:263, createSocialPost ~:611, postNow ~:668`. Nothing publishes just
  because a model emitted it — the opposite of "one command."
- **Brand-voice grounding, not generic output.** Draft generation and the AI-Enhance step feed
  **approved Client Brain** context into Claude and are told to *avoid the brand's do-not-use
  language.* `✓ generatePromoCopy ~:306, enhancePost ~:349` (model `claude-sonnet-4-6`).
- **Algorithm-aware quality gate.** `scoreXPost()` scores a draft against a versioned X algorithm
  profile (`x-2026-05-15`) on P(reply)/P(repost)/dwell/profile-click, and **penalizes
  engagement-bait, scam phrasing, hashtag-stuffing, and hard-sell CTAs.**
  `✓ features/x-growth/score-draft.js`, `algorithm-profile.js`, `docs/audits/x-algo-review.md`.
  A fire-and-forget "post to 10 platforms" command has no such gate — it will happily broadcast
  the engagement-bait that gets an account down-ranked.

**And HITLOOP's own product docs forbid over-claiming this.** Multi-platform "social-posting
automation" is explicitly **gated / do-not-market** — X is the only certified publisher.
`✓ docs/source-of-truth/SOURCE-OF-TRUTH.md` ("Gated, do not market: … Social-posting automation"),
`marketing/HITLOOP-Capability-Profile.md` ("Gated / roadmap (do not market yet): … social-posting
automation"). HITLOOP's whole positioning is *human-first, anti-hype, a named person owns the
result* — `marketing/HITLOOP-Positioning-Statement.md`.

---

## The honest box (do not skip this)

To keep the callout credible, state our own limit plainly:

- **HITLOOP ships 1 production platform (X), not 10.** OmniSocials *claims* 10. On raw breadth
  they win the headline. Do not imply otherwise.
- HITLOOP's multi-platform posting is **gated and unmarketed** by our own SSOT.
- So the argument is **not** "we post to more places, better." It's: *"publish to 10 platforms
  from one command" is breadth-first with the hard parts hand-waved; the value is the loop, and a
  fire-and-forget connector is defined by not having one.*

If we ever pitch breadth, we'd be making the same move we're calling out. Stay on depth + posture.

---

## The callout (ready to post)

Three lengths. All keep to the house voice — short, tactical, no hype, no dunking-for-dunk's-sake.

**A — one-liner (quote-tweet):**
> "Connect Claude to publish to 10 platforms" — the part they're selling isn't Claude. Claude
> drafts (that's the free bit). The publish + schedule + per-platform auth is a paid backend
> you're renting and handing your keys to. It's per-seat pricing with the seats renamed.

**B — the substance (thread-starter):**
> The thing that post sells as magic is the exact thing that *isn't* Claude.
>
> Claude drafts text. Everything after "publish" — 10 platforms of OAuth, a scheduler that
> survives a restart, rate-limit + billing + duplicate handling — is a paid service you're
> wiring in as a custom connector. That's not a Claude feature. It's a SaaS with a Claude
> front door.
>
> And "one command → published to 10 platforms" is the tell. No approval step, no brand-voice
> guardrail, no algorithm check = it will confidently post off-brand engagement-bait that gets
> you down-ranked. The value was never the draft. It's the loop around the draft — which is the
> one thing "fire from one command" deletes.

**C — with our proof (if we want to show, not tell):**
> We built the boring 90% they wave past. Real X publish path that handles the 402-out-of-credits
> and duplicate-rejection cases. A scheduler in durable storage because the naïve version silently
> drops posts on serverless. A draft → *human approves* → scheduled → cron-publishes pipeline. A
> quality gate that scores every draft against the live X algorithm and kills engagement-bait
> before it ships. That's for **one** platform, done right — which is worth more than ten done
> from a single unreviewed command.

---

## One-sentence version for Bryan

> The post is selling the free part (Claude drafting) wrapped around a paid part (a connector that
> actually publishes) and calling the bundle "Claude" — and the "one command to 10 platforms"
> framing is exactly the fire-and-forget anti-pattern HITLOOP exists to replace with a loop:
> draft → brand-voice + algorithm check → **human approves** → durable schedule → real publish.
