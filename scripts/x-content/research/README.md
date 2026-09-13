# X account research scripts

Pipeline used to build [`docs/audits/seb-design-x-post-database.md`](../../../docs/audits/seb-design-x-post-database.md) and [`docs/plans/X-STRATEGY-SEB-MODEL.md`](../../../docs/plans/X-STRATEGY-SEB-MODEL.md).

## Cost policy

Reads go through the cheap paths only — never the X API. See [`X-API-AND-PROFILE-OPERATIONS.md`](../../../docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) §2c.

| Step | Path | Cost |
|---|---|---|
| Timeline pull | `bird` CLI → X web GraphQL, browser cookie auth | **free** |
| Profile | ScrapeCreators `/v1/twitter/profile` | 1 credit |
| View backfill | ScrapeCreators `/v1/twitter/tweet` | 1 credit **per post** |

At $47 / 25,000 credits that is ~$0.0019/credit. The 2026-09-10 run cost **153 credits ≈ $0.29**.

⚠️ `backfill-views.mjs` is the only script that spends. It refuses to run past `MAX_CREDITS` (default 150) and resumes from its own output file, so a re-run never double-spends on a post already resolved.

⚠️ ScrapeCreators `/v1/twitter/user-tweets` returns **0 tweets for small accounts** (verified: `seb__design` → 0, `levelsio` → 99). It is not a usable timeline source here. That is why the timeline comes from `bird`.

## Setup

`bird` is not a repo dependency. Install it anywhere and point the scripts at it:

```bash
mkdir -p ~/.local/birdtool && cd ~/.local/birdtool
npm init -y && npm install @steipete/bird
./node_modules/.bin/bird whoami   # must print your logged-in account
```

Auth is your browser's x.com cookies (Chrome/Firefox/Safari). Safari's cookie jar is usually unreadable without Full Disk Access; Chrome works out of the box.

`SCRAPECREATORS_API_KEY` is read from the env, falling back to `~/.config/last30days/.env`.

## Working directory

Each script reads and writes its intermediates **next to itself** (`seb-corpus.json`, `seb-views.json`, `seb-stats.json`, `seb-profile.json`). Only the final artifacts are promoted to `docs/audits/`. Run them from a scratch copy of this directory if you do not want intermediates landing in the repo.

## Order

```bash
# 1. Timeline -> seb-corpus.json (free). Stops at the cutoff date or X's depth limit (~800 posts).
node pull-timeline.mjs @handle 2026-06-10T00:00:00Z

# 2. Profile (1 credit)
curl -s "https://api.scrapecreators.com/v1/twitter/profile?handle=<handle>" \
  -H "x-api-key: $SCRAPECREATORS_API_KEY" -o seb-profile.json

# 3. Views for the top 100 by likes + random controls (MAX_CREDITS is a hard stop)
MAX_CREDITS=150 node backfill-views.mjs

# 4. Normalize + classify -> docs/audits/*.json + *.csv
node analyze-corpus.mjs

# 5. Render the database doc -> docs/audits/seb-design-x-post-database.md
node build-database-doc.mjs

# 6. Score draft posts through features/x-growth (free, deterministic)
node score-drafts.mjs

# 7. Audience graph -> docs/audits/x-audience-graph.json (free, no network)
node analyze-audience-graph.mjs

# 8. Render the dashboard page -> docs/audits/x-dashboard.html
node build-dashboard-html.mjs
```

## The dashboard page

`x-dashboard.html` is **generated**. Edit `x-dashboard.template.html` and re-run
`build-dashboard-html.mjs` — do not hand-edit the page, or the next build
discards the change.

Three JSON payloads are inlined at build time:

| Payload | Source |
|---|---|
| `#payload` | `x-dashboard-data.json` (from `build-dashboard-data.mjs`) |
| `#pack` | carried forward from the existing page, with `audienceGraph` refreshed from `x-audience-graph.json` |
| `#cal` | carried forward from the existing page |

`pack` and `cal` are written copy with no generator behind them, so the builder
reads them back out of the page it is about to overwrite. That makes the page
the store of record for those two — edit them there (or in the builder), never
in both places at once.

⚠️ `analyze-audience-graph.mjs` derives everything from the **outbound** graph —
who each account retweets and quotes. The follower roster and following list are
not available to it: ScrapeCreators has no followers endpoint and
`x_monitor/{id}/roster` has never been synced. Follower *quality* needs either
`sync-audience` on the X Monitor card (X API, ~1 call per 1,000 followers, spend-gated)
or the `bird` CLI. Until then the dashboard says so in the audience section rather
than implying the roster was measured.

## Retargeting to another account

`backfill-views.mjs` is parametrized by env (`HANDLE`, `CORPUS`, `VIEWS`, `MAX_CREDITS`). The analyze/build pair is not — `HANDLE`, `TZ_OFFSET_HOURS` and output filenames are hardcoded at the top of each. The `@bai_ee` variants are committed alongside as worked examples:

- `analyze-corpus-baiee.mjs` / `build-database-doc-baiee.mjs` — `HANDLE=bai_ee`, `TZ_OFFSET_HOURS=-5` (US Central, inferred from git commit offsets), Bryan-specific topic taxonomy, and a head-to-head comparison section against the seb corpus.

Copy the pair and change those three values to point at a new account.

The topic taxonomy in `analyze-corpus.mjs` (`TOPICS`) is tuned to a design-niche account and matches against the caption **and** the quoted post. Retune it per subject; a high `untagged-riff` count means the taxonomy missed, not that the account posts nothing.
