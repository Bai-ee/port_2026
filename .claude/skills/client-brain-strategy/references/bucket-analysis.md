# Bucket analysis — reading a model account and the client's own account

## 1. Pull (free, local only)

`bird` reads Chrome's x.com cookies. Check it first: `~/.local/birdtool/node_modules/.bin/bird whoami`. If it fails, the fix is logging into x.com in Chrome.

```bash
# one account → normalized rows (dry run: writes nothing to Firestore)
node scripts/x-content/ingest-corpus.mjs --handle <model> --out <scratchpad>/<model>.json
node scripts/x-content/ingest-corpus.mjs --handle <own> --tz <utcOffset> --out <scratchpad>/<own>.json

# quick snapshot + A/B gap report (one timeline page, not a corpus)
node scripts/x-content/session-brief.mjs --handle <own> --days 14 --benchmark <model>

# already-committed corpora (only for handles that have them)
docs/audits/<handle>-x-corpus.json   # rows
docs/audits/<handle>-x-stats.json    # stat block
```

`pull-corpora.mjs --client <id>` resolves a client's stored own/benchmark handles; dry run unless `--write`. Do not `--write` from this skill.

Row fields (`features/x-benchmark/normalize-corpus.js`): `type` (quote-react · quote-commentary · original-showcase · original-text · self-quote · reply · retweet), `media` (video · image · gif · none), `hasLink`, `chars`, `lines`, `text`, `likes`, `reposts`, `replies`, `views` (usually null from bird), `quotedAuthor`, `topics`, `lanes`, `hourLocal`, `weekday`, `dateLocal`.

⚠️ Bird has no views → use **likes** for every lift. ⚠️ Profile timelines hide most replies → reply counts are floors. ⚠️ Retweets carry no own engagement → exclude from lifts.

## 2. Model account — what to extract (per bucket)

Compute over authored rows (not retweets). For each, record n and the filter used.

| Question | Measure |
|---|---|
| **Reach driver** | avg likes by `type`; which type has the highest ceiling (top-10 by likes, which types) |
| **Conversion driver** | which type shows the client's own work; its avg likes vs account avg. Followers/inquiries are not measurable here — say so |
| **Media effect** | avg likes by `media` within the top two types (compare within a type, not across) |
| **Caption shape** | for quote-reacts: chars of top-10 vs rest, share containing `?` and its avg; for originals: chars/lines of top-30 vs bottom half |
| **Links / hashtags** | avg with vs without `hasLink`; count of `#` in authored text |
| **Cadence** | authored posts per active day, gap days, posts per occupied hour |
| **Quote targets** | `quotedAuthor` frequency + avg likes earned per target → the bucket's quote-react watchlist |
| **What never works** | bottom-decile types/topics; promo/announcement posts vs account avg |
| **Growth evidence** | follower count now vs at window start, if public posts state it (e.g. "1,000 followers"); else unmeasured |

Write the 5–8 findings that matter as one line each, each with n and avg. Drop findings with n < 10 or label them anecdotal.

## 3. Own account — diagnosis by bucket

1. Tag each authored row to a bucket (topic/lane labels, keywords, quoted author). Untaggable = "other"; report its share.
2. Per bucket: n, share of authored, avg likes, **lift = bucket avg / account avg**, best post.
3. Account-level: retweet share, authored/day, gap days, quote-target hit rate (targets on the model's list vs not), rule breaks (image-only, long quote captions, inline links).
4. Verdict line: **distribution problem** (content converts when seen, too little is seen) vs **content problem** (posts are seen and still don't land). Evidence: lift of the best type vs model, and volume gap.

## 4. Audience overlap between buckets (for the blend)

Without follower lists, use the corpora:

- **Quote-target overlap**: Jaccard of the models' `quotedAuthor` sets. > 0.15 = shared taste community; < 0.05 = separate.
- **Interaction overlap**: accounts appearing in both models' quoted/replied-to sets.
- **Own cross-over**: does the client's own bucket-B post outperform when it carries bucket-A framing (e.g. music post framed as design)?

State which of these were measured and which were judged.
