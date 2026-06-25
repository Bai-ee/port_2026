# Plan — Market Signals config bootstrap (auto-research category · brand · handles)

**Status:** PLAN — not built. Proposed direction for review.
**Owner workstream:** Market Signals card / Scout config.
**Related SSOT:** [`../source-of-truth/MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](../source-of-truth/MARKET-SIGNALS-AND-SCOUT-PROJECTION.md) (§8 recipes, §7 two-tier model) · visual [`../dashboard-ui/analysis-recipes-flow.html`](../dashboard-ui/analysis-recipes-flow.html).

---

## 1. Objective

When a client lands in Market Signals, prefill the SOURCES config with the **deepest, best-grounded** starting point we can — specifically:
- `categoryTerms` (the conversation the brand sits inside)
- `brandKeywords` (exact-match + product names + hostname)
- `competitors` (real named alternatives)
- **2 watchlist @handles** worth following on X — real, active, relevant, with a *why*

…so the very first Scout run produces high-confidence signals instead of thin/Low ones. Admin always reviews; nothing auto-finalizes.

## 2. What we already pull (raw material available pre-config)

| Source | Holds | Where |
|---|---|---|
| Site crawl evidence | pages, meta, OG, **socialLinks**, contact, brand overview | intake pipeline → `intakeResult.evidence` |
| `siteMeta` | title, description, locale, canonical | dashboard_state |
| Seed identity | company name, URL | client record |
| Onboarding answers (optional) | tone, context, uploads | `onboarding/OnboardingChatModal.jsx` |

## 3. Current architecture — the skill we already have

`features/scout-intake/scout-config-generator.js` → **`ensureScoutConfig({clientId, intakeResult, ...})`**:
- One **Haiku** tool-use call (~$0.002) reads the crawl and infers `brandKeywords`, `competitors`, `categoryTerms`, `kols`, plus per-source enablement, via a **CAPABILITIES registry** (add a source = one registry entry).
- **Grounded** to crawl evidence ("ignore prior inference whenever it disagrees with the crawl").
- **Generate-once** at first intake (never overwrites unless `force`).
- Already detects an Instagram handle from on-site social links (`detectInstagramFromSite`).

This output seeds `marketingBriefConfig` (the editable SOURCES surface). **Analysis recipes (§8) are analyzers over `agentData` — they run *after* Scout and cannot fetch**, so they can't discover live handles by themselves.

## 4. The gap

1. **Category/competitors are crawl-shallow.** A homepage rarely states the full competitive set or the real conversation vocabulary — it states the brand's *own* framing.
2. **Live @handles are the weakest field.** The crawl almost never lists "who to follow on X." `kols` inference is therefore frequently empty or guesses. Finding 2 *good* handles needs a **fetch + validation**, not crawl inference.
3. **No validation loop.** Nothing confirms an inferred handle exists, is active, or is on-topic; nothing confirms a competitor is real and in-category.

## 5. Proposed direction — a 3-stage bootstrap (reviewable prefill)

```
A. EXTRACT (have it)      B. DISCOVER (new, fetch)        C. RANK + VALIDATE (new, analyzer)
crawl → ensureScoutConfig  web/X/Reddit search over the    score candidates vs brand →
→ seed category/brand/     seed → candidate category        top categoryTerms, brandKeywords,
competitors/kols           terms, competitors, @handles     competitors, EXACTLY 2 handles + why
                                                            + confidence + alternates
                                   ↓ prefill marketingBriefConfig (admin reviews/edits — never auto-final)
```

- **Stage A — Extract (existing):** `ensureScoutConfig` from the crawl. Keep as the seed.
- **Stage B — Discover (new fetch step):** run a bounded multi-query search over the seed to surface real-world candidates the crawl can't:
  - category depth → how the market actually talks (vocabulary, pains)
  - competitor set → "X alternative / vs / competitors"
  - **handle candidates** → who posts in this category on X (the discovery the crawl lacks)
  - *Leverage existing engines:* `last30days` skill (multi-platform incl. X/Reddit), `web_search`, and `claude-seo`/DataForSEO for competitor keywords. This is Scout-altitude, not a recipe.
- **Stage C — Rank + validate (new analyzer recipe):** a `config-recommender` recipe (synthesis altitude, same pattern as §8) reads {seed + discovery results} and returns a structured, confidence-scored recommendation: final category terms, brand keywords, competitors, and **exactly 2 handles each with a one-line why + an alternate**, plus a `gaps` list. Grounding rule applies — every handle/competitor traces to a discovered item or is dropped.
- **Output:** prefilled `marketingBriefConfig` shown in SOURCES as *suggested* (admin accepts/edits). Mirrors the existing "generate once, human reviews" rule.

## 6. The "best questions" framework (the depth lever)

Two layers. Layer 1 is what the bootstrap LLM asks of the evidence; Layer 2 is what we optionally ask the user when the crawl is thin.

### Layer 1 — extraction questions (per dimension)

**Category (deepest conversation, not the brand's self-label)**
- What job/problem is this product hired for, in the customer's words?
- What broader conversation/category does that job live inside?
- What words do *customers* use for it (vs the brand's marketing label)?
- What adjacent categories does the audience also follow?

**Brand (exact, findable)**
- Exact brand spellings, product names, and common misspellings/abbreviations actually present on the site?
- The hostname and any sub-brands/handles linked from the site?

**Competitors (real, in-category)**
- Who does a buyer realistically compare this to (named alternatives, DIY, "doing nothing")?
- Which of those are confirmed by external mentions, not just inferred?
- Who shows up for "&lt;category&gt; alternative / vs / switched from"?

**Handles (the 2 to follow)**
- Who consistently posts about this exact category on X — and is *active* (recent posts)?
- Whose audience overlaps the brand's buyer (not just big-follower accounts)?
- For each candidate: does engagement reflect the category, or is it off-topic?
- Pick 2 that maximize **relevance × activity × audience overlap**; keep 1 alternate each.

### Layer 2 — user-facing onboarding questions (ask only when crawl is thin; 3–5 max)
1. "In one line, who's your customer and what do they hire you for?" → category + JTBD
2. "Name 2–3 competitors or alternatives you watch." → competitors seed
3. "Whose posts on X would your customer already follow?" → handle seed
4. "What phrase would a frustrated customer type into search?" → unprompted vocabulary
5. (optional) "Any subreddits/communities your audience lives in?" → reddit targeting

## 7. Why this raises Market Signals quality (closes the loop)

Recipe/signal confidence = **frequency × independent sources, unprompted voice** (§8). A deeper, validated seed →
- richer `categoryTerms` → PAIN POINTS + vocabulary queries hit real conversation
- real `competitors` → Alternatives + Contradictions populate
- 2 *relevant* handles → watchlist + "Happening on X" carry signal, not noise

→ first run lands High/Medium themes instead of Low. The recipe's **"What we still don't know" (gaps)** then names the next search to add — feeding Stage B on the next run. Self-improving.

## 8. Skills / assets to leverage (no new infra where possible)
- **`ensureScoutConfig`** (have it) — Stage A; extend, don't rebuild.
- **`last30days` skill** — Stage B handle/category discovery across X/Reddit/etc.
- **`deep-research` skill** — optional deeper competitor/category pass when warranted.
- **`claude-seo` / DataForSEO** — competitor keyword/traffic depth (already in env).
- **Analysis-recipes pattern (§8)** — Stage C `config-recommender` is just another recipe + render fn.

## 9. Keep vs change
- **Keep:** `ensureScoutConfig` seed, generate-once rule, admin-review-before-final, `marketingBriefConfig` as the editable surface, the recipe registry pattern.
- **Change/add:** a bounded discovery fetch (Stage B) + a `config-recommender` recipe (Stage C) + a "suggested config" review affordance in SOURCES.

## 10. Files likely involved
- `features/scout-intake/scout-config-generator.js` (extend / call into Stage B+C)
- `features/intelligence/analysis-recipes/` (`config-recommender.md` + register in `recipes.js`)
- new discovery helper (Scout-altitude; reuse `scout-test`/`last30days` plumbing)
- `app/api/dashboard/marketing-brief/config/route.js` (accept suggested prefill)
- `DashboardPage.jsx` SOURCES tab (render "suggested" + accept/edit)

## 11. Risks
- **Handle hallucination** — biggest risk. Mitigate: Stage C must ground every handle to a discovered post; validate existence/activity before suggesting; cap at 2 + alternates; admin confirms.
- **Cost creep** — Stage B is a real fetch. Bound queries (reuse `MAX_RECIPES_PER_RUN`-style caps); run once at intake, not per visit.
- **Over-trusting prefill** — must read as *suggested*, never silently final (preserve generate-once + review).
- **Crawl-thin clients** — fall back to Layer-2 onboarding questions.

## 12. Recommended phase order
1. **Phase 0 (no code):** approve this plan + the `config-recommender` output schema + the 2-handle selection rule.
2. **Phase 1:** Stage C recipe (`config-recommender`) over the *existing* `ensureScoutConfig` seed only — prove ranking/validation on real data via the CLI (no fetch yet).
3. **Phase 2:** Stage B discovery fetch (start with `last30days` for handles + category), feed Stage C.
4. **Phase 3:** SOURCES "suggested config" review UI + config-route accept.
5. **Phase 4:** wire the gaps→next-search feedback loop.

**Approval recommendation:** approve Phase 0–1 first (cheap, no fetch, proves the ranking/handle-selection quality on stored data) before committing to the discovery fetch in Phase 2.
