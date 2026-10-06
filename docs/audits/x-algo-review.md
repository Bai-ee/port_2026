# X Algorithm Review

**Profile ID:** `x-2026-10-03` (supersedes `x-2026-05-15`)
**Reviewed at:** 2026-10-05, against upstream commit `b412112d` (2026-10-03)
**Note:** Since 2026-08-13 X publishes its real ranking weight defaults. The numbers in the 2026-10 section are read from source, not estimated. They are population defaults; X runs A/B arms that override them per user. The Phoenix model's predicted probabilities (what the weights multiply) are not public. Sections below the 2026-10 refresh are the June review, kept for history — where they disagree, the refresh wins.

**How to re-check:** `git clone --depth 1 https://github.com/xai-org/x-algorithm`, then read `home-mixer/params/param.rs` (weights), `vm-ranker/params.rs` (OON + author diversity), and any new `docs/*.md` change notes. Upstream pushes near-daily; re-review monthly or when X announces a change.

---

## 2026-10 refresh — verified weights

### Positive actions (score = Σ P(action) × weight)
| Action | Weight | vs like |
|---|---|---|
| `share_via_copy_link` | 20.0 | 40× |
| `reply` | 5.0 (+15 = 20.0 when author is a mutual follow, originals only) | 10× (40×) |
| `quote` | 5.0 | 10× |
| `share_via_dm` | 5.0 | 10× |
| `follow_author` | 4.0 | 8× |
| `share` | 2.0 | 4× |
| `repost` | 1.0 | 2× |
| `favorite` (like) | 0.5 | 1× |
| `cont_click_dwell_time` | 0.4 | — |
| `click` | 0.3 | — |
| `open_link` | 0.2 | — |
| `video_open` | 0.07 | — |
| `photo_expand` / `dwell` / `quoted_click` | 0.05 | — |
| `profile_click` / `vqv` / `quoted_vqv` | **0.0** | — |

### Negative actions
| Action | Weight | Likes erased |
|---|---|---|
| `report` | −234.0 | 468 |
| `mute_author` | −58.8 | 118 |
| `not_interested` | −47.52 | 95 |
| `block_author` | −31.2 | 62 |
| `not_dwelled` | −0.02 | — |

### Multipliers and small-account rules
- **Out-of-network:** non-followers see posts scored ×0.75 (×0.5 via topic retrieval).
- **Author diversity:** in one viewer's feed, an author's 2nd post ×0.5, 3rd+ ×0.25 (floor). Bunching posts wastes them.
- **Cold start (accounts < 50k followers):** posts < 2h old with < 200 impressions get exploration slots (positions ~15–16, Thompson sampling). The first 2 hours decide a post's reach.
- **Video:** clips under 10s don't count as a video quality view; VQV itself carries 0 weight.
- **Links:** no hard-coded penalty — `has_url` is a learned model feature. Our measured ~44% engagement penalty on @bai_ee stays the operative number.
- **Tone:** third-party claims that Grok down-ranks combative tone are not visible as a weight in source. Treat as unverified.

### What changed vs the June profile
| June assumption | Now |
|---|---|
| Repost is a top signal | **Downgraded.** Repost = 1.0; reply/quote/DM share = 5.0, copy-link = 20.0 |
| Profile click is a primary action (authority posts) | **Wrong.** Weight 0.0. Authority posts should target `follow_author` (4.0) |
| Media boost — high confidence | **Downgraded to medium.** Media weights are tiny (≤0.07); media helps only through dwell/replies/shares. Our measured video > text > still result still governs slot routing |
| Dwell length — low confidence | **Medium.** Dwell *after tapping in* (0.4) is ~8× in-feed dwell (0.05) |
| Author diversity — hypothesis | **Confirmed in code** (0.5 decay, 0.25 floor) |
| — | **New:** mutual-follow reply boost (+15), share signals, OON ×0.75, small-account cold start |

### Scorer re-weighting (applied 2026-10-06)
`features/x-growth/score-draft.js` now follows the verified weights. Composite (post mode) = sqrt-compressed `rankingWeights` over reply+quote (10), copy-link+DM share (25), follow (4), repost (1), click-dwell (0.4), profile_click (0), scaled by a measured link factor (x0.56, ~44% penalty), plus a small measured video prior, minus 0.60 x negative-feedback risk (asymmetric). New dimensions: `sharePotential`, `followPotential`. `profileClickPotential` is still emitted but carries zero weight. Pattern banks are labelled heuristics. "Add a question" is no longer recommended (questions measured below baseline on @bai_ee); recommendations favour share-earning substance and "move link to first reply". Reply mode keeps its own weighting.
Evidence: `node scripts/x-content/research/replay-scorer.mjs` (84 originals; Spearman vs views old 0.04 -> new 0.10, vs likes -0.14 -> -0.14). Both are weak: text heuristics barely predict reach, and the composite was deliberately not fit to this corpus.
Caveat: `xGrowthScore` values stored on existing `social_posts` are from the old model and are not comparable to new scores.

---

## Sources

- https://github.com/xai-org/x-algorithm/blob/b412112d/home-mixer/params/param.rs
- https://github.com/xai-org/x-algorithm/blob/b412112d/vm-ranker/params.rs
- https://github.com/xai-org/x-algorithm/blob/b412112d/xai-value-model/scoring.rs
- https://github.com/xai-org/x-algorithm/blob/b412112d/home-mixer/scorers/author_cold_start.rs
- https://github.com/xai-org/x-algorithm/blob/b412112d/docs/BIDIRECTIONAL_BOOST_CHANGE.md
- June sources: README.md and phoenix/README.md in the same repo

---

# June 2026 review (historical — `x-2026-05-15`)

## Predicted Phoenix Actions

### Positive signals
| Action | Description |
|--------|-------------|
| `reply` | User replies to the post |
| `repost` | User reposts/retweets |
| `quote` | User quote-tweets |
| `click` | User clicks a link in the post |
| `profile_click` | User clicks author profile |
| `video_view` | User watches attached video |
| `photo_expand` | User expands attached image |
| `dwell` | User spends time reading (dwell time) |
| `follow_author` | User follows the author after seeing post |
| `favorite` | User likes the post |
| `share` | User shares externally |

### Negative signals
| Action | Description |
|--------|-------------|
| `not_interested` | User marks as not interested |
| `mute_author` | User mutes the author |
| `block_author` | User blocks the author |
| `report` | User reports the post |

---

## Assumptions

### linkRisk
- **Confidence:** medium
- **Hypothesis:** Posts with external links are distributed less aggressively in For You feed. X prefers native content.
- **Workaround:** Put link in first reply, or use 'link in bio' approach.

### replyBoost
- **Confidence:** high
- **Hypothesis:** Questions and direct conversation invitations meaningfully raise P(reply), which is a high-weight positive signal.

### replyEarlyWindow (reply-side)
- **Confidence:** medium
- **Hypothesis:** Replying to a *young, accelerating* post (high engagement-velocity, still inside an early window of ~6h) rides that post's rising For-You distribution, so the reply itself is surfaced more widely than a reply on an old or stalled post. Velocity (engagement ÷ age) matters more than absolute engagement total.
- **Applied in:** the `reply-targets` recipe ranks candidates on `velocityPerHour` + `replyWindowOpen` (computed in `app/api/dashboard/recipe-run`); `replyWindowHours = 6`.

### mediaBoost
- **Confidence:** high
- **Hypothesis:** Native video (MP4) and images increase P(video_view) and P(photo_expand) signals, boosting overall score.

### engagementBaitPenalty
- **Confidence:** high
- **Hypothesis:** Explicit engagement-bait phrases ('like if', 'rt if', 'drop a like') trigger P(not_interested) and are likely filtered pre-rank.

### hardSellPenalty
- **Confidence:** medium
- **Hypothesis:** 'Buy now', 'limited time', 'act now' patterns correlate with high P(not_interested) and P(mute_author).

### dwellLengthCorrelation
- **Confidence:** low
- **Hypothesis:** Longer, substantive posts may increase dwell time, but very long posts risk lower completion rate. Optimal range unclear.

### authorDiversityAttenuation
- **Confidence:** high
- **Hypothesis:** Phoenix Scorer penalizes repeated same-author exposure in a single feed session. Cadence matters more than volume.

### topicConsistency
- **Confidence:** medium
- **Hypothesis:** Consistent topical posting helps the candidate retrieval tower (Two-Tower Model) surface posts to relevant audiences.

---

## Post Type Scoring Hints

| Post Type | Primary Action | Secondary Action |
|-----------|---------------|-----------------|
| `authority` | `profile_click` | `follow_author` |
| `reply-loop` | `reply` | `quote` |
| `proof-loop` | `repost` | `quote` |
| `kol-adjacent` | `reply` | `repost` |
| `case-study` | `repost` | `profile_click` |
| `offer` | `click` | `profile_click` |
| `asset` | `photo_expand` | `repost` |
| `conversation-starter` | `reply` | `quote` |

---

## Reply-side scoring (HITLOOP)

The profile above scores **posts we author**. Replies are scored and ranked symmetrically:

- **Reply-aware draft scoring** — `scoreXPost(text, { kind: 'reply' })` (`features/x-growth/score-draft.js`) re-weights toward substance (dwell + topic authority) and away from announcement/repost framing, and penalises links harder (no "move to first reply" escape on a reply). It runs at the single chokepoint `runPostingAgents` (`features/social-posting/twitter-service.js`), which detects a reply (a `replyTo` target or `kind:'reply'`), passes `kind:'reply'` to the scorer, and skips hashtag injection. Reply drafts created from the `reply-targets` skill (`create-reply-drafts` in `app/api/social-posting`) carry this score.
- **Velocity ranking** — see `replyEarlyWindow` above. The `reply-targets` recipe prompt (`features/intelligence/analysis-recipes/reply-targets.md`) ranks on `velocityPerHour` + `replyWindowOpen` and drafts replies under explicit algorithm rules (substantive, no link, no bait).

## Human Review Checklist

- [ ] Sources above still resolve and content has not changed significantly
- [ ] Confidence labels reflect current understanding (high/medium/low)
- [ ] Any new assumptions from community research or X announcements added
- [ ] Post type hints still match observed engagement patterns
- [ ] Profile `reviewedAt` updated to today's date after completing this review
- [ ] If significant changes: increment profile ID (e.g. `x-2026-08-01`) and update `algorithm-profile.js`

_Generated by `npm run review:x-algo` on 2026-06-18_
