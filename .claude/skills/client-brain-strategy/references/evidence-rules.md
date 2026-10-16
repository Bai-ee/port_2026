# Evidence rules — what counts, and how sure

## 1. Measurement hygiene (apply before quoting any number)

- **Likes for lifts.** Bird corpora have no views; likes are complete on every row.
- **Pooled engagement rate only** (sum engagements / sum views), never a mean of per-post ratios — that reversed a conclusion once.
- **Compare within a type.** Media and caption effects are measured inside one post type; mixing types measures the type mix.
- **n ≥ 30** for a confident per-type figure, **n ≥ 10** to mention at all; below that, label "anecdotal".
- **Replies are floors** (profile timelines hide them). **Follower deltas are unmeasured** unless stated publicly or synced (spend-gated).
- **Topic labels are per-account taggers** — don't compare topic shares across accounts when label overlap < 30%.
- **A share delta is not a recommendation.** Act only on gaps where the client's own lift supports the change.
- **The post scorer (`scoreXPost`) models originals only.** It has no model of borrowed reach and gives `?` a small bonus; on quote-reacts trust the corpus.

## 2. Confidence labels (put one on every rule written into the Brain's Rules / Formats)

| Label | Means |
|---|---|
| **proven** | holds in ≥ 2 independent accounts, or is platform mechanics from the published ranking code |
| **model** | measured in one model account; lane-specific until replicated |
| **own** | measured on the client's own account |
| **unmeasured** | reasoning or prior, not data — keep out of Rules, put in Open questions |

## 3. Starting rule set (re-verify against this client's models; don't paste blindly)

| Rule | Label | Basis |
|---|---|---|
| Retweets and out-of-network replies don't reach non-followers; quote-tweets do | proven | `OONRetweetReplyFilter`, xai-org/x-algorithm |
| Earned actions (share, reply, quote, follow) outweigh likes; reports/mutes are heavy negatives | proven | ranking weights, profile `x-2026-10-03` |
| Author diversity decays same-author posts within a session; volume matters more than spacing | proven | ranking code + measured density |
| Promo/announcement posts underperform the account's own baseline | proven | 3 accounts (design + music) |
| Speculation / price / politics is the worst lane on a work account | own (+ model) | measured on the HITLOOP account |
| Quote-react = reach engine; own-work showcase = conversion engine | model | @seb__design 65-day corpus |
| Quote-react captions: flat recognition statements, ~20–65 chars, no question | model | @seb__design: 1/199 with "?" earned 6 vs 45.6 avg |
| Winning originals are longer and structured (claim, break, substance) | model | @seb__design top-30 vs bottom-200 |
| Video > no media > static image (within showcase) | model | @seb__design |
| Links in the first self-reply, not the post | model + learned negative | engagement drop with inline links |
| No hashtags | model, design lane only | a music-lane account tags and performs fine |
| Self-quote a winner the next day | model | high avg in model, rarely used by most clients |
| Don't stack posts to catch up a missed day; hold the tier | unmeasured→practice | consistency observation; keep in Decisions, not Rules |

## 4. Cadence tiers (size from the time budget)

| Tier | Posts/day | Replies/day | ~Time |
|---|---|---|---|
| 1 sustainable | 5 | ≥ 5 | 25 min |
| 2 competitive | 8 | ≥ 10 | 45 min |
| 3 full model | 12 | ≥ 15 | 90 min |

Start at Tier 1 unless the client already holds a higher rate; move up only after two weeks without a gap day.
