# Daily Content Loop — Phase S: Strategy Spine (plan only)

Date: 2026-10-10 · Status: **PLAN — no code until approved.** Addendum to `DAILY-CONTENT-LOOP-PROTOTYPE-BUILD-PLAN.md`; where they disagree on *what fills a suggestion*, this wins. Phase 3b cancelled, Phase 4 (launchd install) held until Phase S passes.
Strategy source of truth: `docs/plans/X-STRATEGY-SEB-MODEL.md` (§5 pillars, §6 slots, §7 rules).

## 1. Problem (verified)

The loop decides *what to say* from owned-library vocabulary, so strategy never drives it. Today's run: 35/35 watchlist posts rejected "off-brand" (they are the P1 curation-react targets), and "brand" came out as "deep house" (P6, low volume). `plan-day.js buildDayPlan` already decides the day (gap report → calendar slots type/time/lane → engine quotas → `matchDay`) and marks quote-react slots dynamic — nothing fills them. Also: plan-day slot times parse Chicago clock as UTC (`hoursFromNow` off 5–6h); the model drafts already-saved suggestions (wasted call); the Client Brain is the wrong client.

## 2. Target flow (slot filling)

```text
inputs (scan, search, library, own+Seb corpora)
  → slots.js: buildDayPlan(Tier 1) → today's slots {letter, timeCT→ISO, type, lane, pillar}
  → for each slot, in strategy order, a filler returns a candidate or a visible gap:
      quote-react  ← watchlist scan candidates; fit = vein/pillar + guard lane (NOT library vocabulary);
                     owned item only as optional "related" note
      original-showcase ← matchDay owned media (video); +why-now bonus if a live conversation fits
      original-text     ← story/facts items, else gap "no story/facts for this slot"
      reply             ← conversation search narratives (music-archive discovery feeds this and P6)
  → copy: quote-react = Seb template (reaction <50 chars, no explanation, no link, no owned facts);
          others unchanged (content-basis tiers, facts-only rule)
  → checks (+ content guard) → cap 3 in strategy order: best quote-react, showcase, then the first of original-text / reply that fills (§10)
  → existing run store / edit / dismiss / save-once
```
Slot times come from `time-ids.js zonedTimeToIso` (Chicago → UTC). Voice = Seb mechanical rules (§7) + `x-content-guard`; Brain not used, labelled "voice: Seb rules §7 — Brain not used" in the inputs panel. Strategy Builder plan = optional editorial input, **off for X**. Hashtag rule is design-lane only (§7.1 correction) — music-lane left as the guard already has it.

## 3. Tracks, files, owners (reuse the existing split)

| Track | Owns | Task |
|---|---|---|
| S1 foundation (sequential, first) **— built, awaiting review** | `daily-loop/slots.js` (new), `features/x-content-inventory/plan-day.js` (time fix only), `__tests__/daily-loop-slots.test.js` | Adapter over `buildDayPlan`: Tier 1 request, Chicago→UTC `startsAt`, pillar, strategy priority, daily reply slot. `hoursFromNow` fixed with `zonedTimeToIso`. Spike left for S2a: reuse `x-quote-targets/day-plan.js` vein-preferring pick (export `pickCandidateForSlot` — one-word change) vs reimplementing. |
| S2a quote fill | `daily-loop/fill-quote.js` (new), `__tests__/daily-loop-fill-quote.test.js` | Candidate fit via vein + `classifyLane`/`guardXPost`; no library requirement; optional `related` owned item. |
| S2b other fills | `daily-loop/fill-original.js`, `fill-reply.js` (new), `brand.js` (library fit scoped to replies / conversation-linked originals), `__tests__/daily-loop-fill-other.test.js` | showcase via `matchDay`, text via story/facts or gap, reply via narratives. |
| S2c copy | `daily-loop/copy.js`, `__tests__/daily-loop-copy.test.js` | quote-react prompt + fallback (Seb template); guard on output; others untouched. |
| S2d run + inputs | `daily-loop/run.js`, `inputs.js`, `run-store.js` (merge by slot), `__tests__/daily-loop-run-spine.test.js` | Wire fillers; run doc gets `strategySource {gapReportAsOf, tier, slots[]}`; **skip model call for saved/dismissed**; **regenerating without the model keeps a pending suggestion's existing model draft when the same suggestion id comes back** (suggestion ids stay stable across regenerations in v3: derived from client, date, slot letter, opportunity and package, never from the draft text; Regenerate's `force:true` stays as designed); add strategy input row; Strategy Builder row marked "not used for X". |
| S3 `select.js` | `daily-loop/select.js` | Becomes the slot orchestrator (strategy-order cap 3). Runs after S2a–d land; one agent. |
| S4 UI/CLI | `DailySuggestionsPanel.jsx`, `scripts/x-content/daily-run.mjs`, runbook | Cards show slot letter/time/type/pillar; inputs panel shows strategy source (gap report date, tier, today's slot list); `--show` prints slots. |

## 4. Untouched

`content-basis.js`, `conversations.js` (grouping/momentum), `evidence.js`, run-store claim/lease/fingerprint, `editSuggestion`/`saveSuggestionDraft`/dismiss, route actions, `social_posts` write path (`createDraftPostOnce`), `twitter-service.js`, scan job, X API anything. Nothing scheduled or posted.

## 5. Contract changes

Suggestion gains `slot: {letter, timeCT, startsAt, type, lane, pillar, fillReason}`; `package` becomes nullable for quote-react (`related` optional); `gaps[]` gains per-slot codes (`slot-unfilled:<letter>`). `why.content` reads "none required — reaction slot" for quote-react. Run doc gains `strategySource`; bump `LOOP_VERSION` to 3 (new run doc id; old v2 doc untouched).

## 6. Test cases (real failures only)

- A watchlist design post fills a quote-react slot **without owned content**.
- A deep-house lifestyle post (e.g. @Lush_Beauty1 "Deep house music is so soothing") **never** fills a quote-react slot; it may only reach a reply/original slot.
- Slot times: a 09:30 CT slot on 2026-10-10 is `14:30Z` (CDT), a slot on 2026-11-02 (CST) is 15:30Z; `hoursFromNow` correct across the DST boundary.
- Quote-react copy is <50 chars, has no link of its own, passes the guard (a question mark is avoided as a preference — the calendar brief says so — not a Seb rule, so it is not tested as one); model/fallback never invent owned facts.
- Quote-react with a vein-matching candidate within tolerance beats a higher-scoring off-vein one.
- Cap 3 holds in strategy order; fewer suggestions when slots unfillable, each with a visible gap.
- Saved/dismissed suggestions trigger zero model calls on regeneration (test: fake drafter counts calls).
- Regenerating without the model keeps a pending suggestion's model draft when the same id returns; replaces it only if the id is gone (test: pending model-drafted card survives a no-model forced regenerate).
- Suggestion ids are identical across two regenerations of the same inputs (test).
- Pillar mapping table (S1, built): quote → P1; showcase + music → P6, else P2; text + craft → P4, meta → P5, else P3; reply/self-quote/retweet → none.
- The reply slot always exists and is last-but-two in strategy order; with no calendar slots the day still lists `R`.
- Existing 213 loop tests + replay output unchanged except documented diffs.

## 7. Acceptance

1. Replay fixture: P1 slot filled from a watchlist candidate with no owned item; strategy source shown.
2. Real data (read-only run first): today's 35 "off-brand" watchlist posts are re-judged by vein/lane; ≥1 fills a quote-react slot, or a gap says exactly why not.
3. Inputs panel shows: gap-report date, tier, slot list, "voice: Seb rules, Brain not used".
4. Full suite unchanged vs baseline (4135 / 2 known failures); plan-day consumers (`day-view.mjs`, Content Engine plan tab) still pass.
5. Owner judges ≥1 quote-react suggestion usable. If not, recorded as a fail.

## 8. Phases (stop for approval after each)

S1 foundation → S2 (a–d in parallel) → S3 select.js + integration → S4 UI/CLI → S5 real-data read-only run (model copy only if approved, ≤3 calls) → then and only then reconsider Phase 4.

## 9. Risks

- `plan-day.js` is shared (Content Engine plan tab, `day-view.mjs`); the time fix changes effort gating → tests + before/after snapshot of its output.
- Scan candidates may carry no `vein` for non-watchlist authors → fall back to `classifyLane`; unknown lane is a gap, not a match.
- Quote semantics (trailing status URL vs `quote_tweet_id`) still unverified in the publisher — keep Save Draft only; Elevation item 7.
- `scoreXPost` undervalues quote-reacts → advisory score hidden for quotes (already `n/a`).
- Seb's "no link / no hashtag" rules are design-lane; music-lane unresolved — copy follows the guard, not a blanket rule.
- Scan freshness (12h stale bar in `day-plan.js` vs 36h quote window): pick one, show it.
- Dropping the library-fit requirement for quotes must not loosen the guard's hard blocks (casino lane).

## 10. S1 decisions (from the code read)

- **Tier 1 needs no new parameter.** `buildDayPlan` does not read the tier from history: `plan-day.js` sets `tier: posts >= 8 ? 2 : 1` from its `posts` input, which defaults to `engineConfig.authored.targetPerDay` (4). `planSlots` passes `posts` only if the caller gave one, clamped to 7, so the tier cannot flip. The post count is never faked. Note the mix is not the doc's 2/1/1/1: slot types come from the gap report's `targetMix`, so today's four slots are showcase, text, self-quote, quote-react (one quote-react, not two). The engine quotas, not the strategy doc, decide that; S2 does not change it.
- **Decided 2026-10-10 (owner):** keep `buildDayPlan`'s engine-derived mix; do not pin it to §6. The self-quote slot gets a filler (S2b) that uses only the own corpus, else `slot-unfilled`. Suggestion ids hash slot TYPE + opportunity/post id + package id (not the slot letter), so edits, dismissals and saves survive a calendar shift.
- **Pillar derivation** is in `slots.js pillarFor`. `buildCalendar` gives every slot of a type the same `brief` and rotates `lane` through the day, so brief adds nothing and lane is only a default for showcase (music → P6) and text (craft → P4, meta → P5, else P3). A filler may overwrite the pillar once it sees the real item. Reply, self-quote and retweet have no pillar.
- **Replies** are a daily minimum (`REPLY_QUOTA_PER_DAY` 10; strategy floor ≥5), not calendar slots. `slotsFromPlan` always appends slot `R` (type reply, source `daily-minimum`, no clock time, priority 4). The cap's third position goes to the first slot that fills among original-text then reply; if neither fills, the run records `slot-unfilled:<letter>` for each, so that position is never silently empty.
- **Retweet** slots are shown, flagged `manual`, never filled.
- `slots.js` is not added to the `daily-loop.js` barrel in S1 (keeps the export list equal to baseline); S2/S3 import it directly.
- **S5 cost check (read-only, done):** `claude-sonnet-4-6` is in `RATES` (`usage-logger.cjs:26`, $3/$15 per M tokens). The 3 logged calls carry `estimatedCostUsd` 0.0019–0.0022 (total about $0.006) with `clientId` set. The "empty costUsd" was the wrong field name; the stored field is `estimatedCostUsd`. Nothing to fix.

## 11. Elevation items

- Engine gives 1 quote-react/day vs the strategy doc's 2 (Tier 1). Revisit after a week of runs. (Add to `ELEVATION-LIST.md` — not present in this worktree.)

