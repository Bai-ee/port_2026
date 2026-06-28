# X Algorithm Review

**Profile ID:** `x-2026-05-15`
**Reviewed at:** 2026-06-18
**Note:** Weights below are community-derived estimates from reverse-engineering published architecture docs and public engagement studies. X does not publish exact numeric weights. Treat all numeric values as hypotheses, not facts.

---

## Sources

- https://github.com/xai-org/x-algorithm
- https://github.com/xai-org/x-algorithm/blob/main/README.md
- https://github.com/xai-org/x-algorithm/blob/main/phoenix/README.md

---

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
