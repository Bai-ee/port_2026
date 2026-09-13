# X Monitor card — SSOT

Read-only performance dashboard for the connected X account (`@bai_ee`). Answers
three questions the rest of the repo cannot: **is the account growing**, **who
arrived and who left**, and **which posts actually worked**.

Built 2026-09-10. Admin-only, Social Media Manager bucket, card id `x-monitor`.

> This card only **reads**. It never posts, replies, follows, or edits the
> profile — those live in Social Accounts (`x-profile`) and Copywriter.
> For how this card fits the wider X work — the strategy it measures against,
> the content guard, and the calendar that feeds Copywriter — see
> [`X-GROWTH-SYSTEM.md`](./X-GROWTH-SYSTEM.md). That doc is the map; this one
> owns the card.
> Read [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md)
> §0 and §3 before touching anything here: every sync spends X API credits, and
> that spend is **invisible to the Operating Cost card**.

---

## 1. Files

| File | Role |
|---|---|
| `features/x-monitor/audience-diff.js` | **Pure** roster/metric math — chunking, gained/lost diff, snapshot deltas + series, engagement rate, post deltas. No Firestore, no X API. Imported by the client component too (it has no node builtins). |
| `features/x-monitor/store.js` | Firestore persistence. |
| `features/x-monitor/sync.js` | The **only** metered code. `syncProfile` / `syncPosts` / `syncAudience`, each returns `callsMade`. |
| `features/x-monitor/__tests__/audience-diff.test.js` | 10 tests, mostly guarding the truncation + baseline traps in §5. |
| `app/api/dashboard/x-monitor/route.js` | Admin-gated route. `GET` is free; every `POST` sync action is metered. |
| `components/dashboard/XMonitorCard.jsx` | The modal dashboard. |
| `scripts/x-monitor/import-bird-timeline.mjs` | Free post-history backfill (§6). |
| `DashboardPage.jsx` | Card definition (`isAdmin` spread, `category:'social'`), lazy import, modal panel. |
| `lib/dashboard/tile-config.js` | `x-monitor` in `CUSTOM_DETAIL_CARD_IDS` and in the new `FULL_WIDTH_MODAL_CARD_IDS`. |

`FULL_WIDTH_MODAL_CARD_IDS` replaced two hardcoded `=== 'media-library'` checks
in the modal render. Adding an id to that set drops the left visual/about cell
and collapses the bento grid to one column — that is what makes this card wide.

---

## 2. Data model

```
x_monitor/{accountId}                          profile + sync meta
x_monitor/{accountId}/snapshots/{YYYY-MM-DD}   daily counters (UTC), last write wins
x_monitor/{accountId}/posts/{tweetId}          post + capped metric history (40 entries)
x_monitor/{accountId}/roster/{chunk-000}       follower roster, 400 profiles per chunk
x_monitor/{accountId}/audience_events/{auto}   {type:'gained'|'lost', detectedAt, user}
```

`accountId` is the **immutable X user id**, not the handle — a handle change
must not orphan the history.

Every query is single-field ordered or a plain collection read. **No composite
indexes**, deliberately: they have to be hand-created in the console and a
missing one fails in production only.

Two sizing decisions worth keeping:
- **400 profiles per roster chunk** (~100KB) against Firestore's 1MB document
  cap, with `compactUser` clamping each bio to 220 chars.
- **`EVENT_WRITE_MAX = 2000`** audience events per sync, so a pathological diff
  cannot write forever. The overflow count is returned, not swallowed.

---

## 3. Cost model — why this card uses the X API

The repo rule is that X **reads** go through ScrapeCreators, not the paid API
(X SSOT §2c). This card is the documented exception, because for these three
reads ScrapeCreators either cannot answer or is more expensive:

| Need | ScrapeCreators | X API (what this card uses) |
|---|---|---|
| Follower/following/post counts | `/v1/twitter/profile`, 1 credit | `GET /2/users/me` — 1 call |
| **Who followed / who unfollowed** | **no followers endpoint exists** | `GET /2/users/:id/followers` — 1 call per 1,000 followers |
| Per-post metrics | `/v1/twitter/user-tweets` returns **0 posts for small accounts** (verified: a 1.5k-follower account → 0, `levelsio` → 99); views cost **1 credit per post** | `GET /2/users/:id/tweets` — **1 call → 100 posts with impressions** |
| Impressions / profile clicks / link clicks | impossible — owner-only data | `non_public_metrics` + `organic_metrics`, last 30 days |

A full **Sync now** on a ~1.5k-follower account is **≈3 calls**. The card names
the count in a confirm row before anything fires, and repeats that the spend
does not reach the Operating Cost card. Call counts are logged to `usage_events`
as `provider:'x-api'`, `model:'x-read'` — counts only, no dollar rate, because X
publishes none we could apply honestly.

**Cadence is manual by design.** No cron, no background sync, no Vercel function
added. Every credit is spent by a human clicking Confirm. If that ever changes,
it is a decision, not a refactor.

---

## 4. Actions

`GET /api/dashboard/x-monitor` — free. Connection status + everything stored.
Post history is trimmed to the last 8 entries and `postMetricDeltas` is computed
server-side before crossing the wire.

| POST action | Calls | Effect |
|---|---|---|
| `connect-start` | 0 | Starts the OAuth 2.0 PKCE flow (delegates to `startXOAuthFlow`, same global `@bai_ee` connection the `x-profile` card owns). |
| `sync-profile` | 1 | Counters + today's snapshot. |
| `sync-posts` | 1 (2 on fallback or `deep`) | Last 30 days with private metrics. |
| `sync-audience` | 1 per 1,000 followers | Roster pull + diff + events. |
| `sync-all` | ≈3 | Profile → posts → audience, in that order. |

Profile runs first in `sync-all` on purpose: it refreshes the follower count
that the audience call-count estimate and the day's snapshot are both built from.

---

## 5. The four traps this card is built around

1. **A truncated roster must never manufacture unfollows.** If a follower pull
   stops early (page cap, 429, 402), the roster is stored with `complete:false`
   and `diffRosters` refuses to emit losses — on that run *and* the next one.
   Without this, every follower simply not fetched reads as an unfollow. The UI
   says so in the audience panel rather than showing a silently empty column.
2. **The first sync is a baseline, not 1,500 new followers.** `diffRosters`
   returns `baseline:true` and emits nothing.
3. **Unknown is not zero.** `snapshotDeltas` returns `null` for a window with no
   old-enough snapshot, and the KPI chips print `—`. Growth is snapshot-derived
   and **cannot be backfilled** — X publishes no follower history. Day one is a
   baseline; the line starts drawing from the second sync.
4. **Private metrics are a 30-day window.** `syncPosts` bounds the request with
   `start_time` instead of hoping — asking for `non_public_metrics` on older
   posts is what fails the whole request. On a 400/403 it retries once with
   public fields only and marks `metricsSource:'public'`; on 429/402/401 it
   stops rather than burning a second credit on a retry that will fail
   identically.

### ⚠️ styled-jsx trap (cost two rounds of debugging)

`<style jsx>` scopes by stamping a generated class onto JSX written **directly
in the component body**. JSX returned from a helper (`gate()`) or a child
component (`GrowthChart`, `AudienceRow`) never gets that class, so those parts
render unstyled while everything else looks fine. This card therefore uses
`<style jsx global>` with **every selector prefixed `#x-monitor-card`** — same
containment, no dependency on that pass. Separately, handing `<style jsx>` a
`const` instead of an inline template literal **fails the compile**, and the
dynamic import then resolves to nothing: the modal opens with an empty pane and
no console error.

> `components/dashboard/XProfileCard.jsx` uses the same `gate()` + scoped
> `<style jsx>` pattern, so its confirm rows are very likely unstyled the same
> way. Not fixed here — separate card, separate decision.

---

## 6. Free history backfill (`scripts/x-monitor/import-bird-timeline.mjs`)

The X API only serves ~100 recent posts. The `bird` CLI reads the same timeline
through x.com's web GraphQL using your browser cookies — free, ~800 posts deep.
Pipeline and setup: [`scripts/x-content/research/README.md`](../../scripts/x-content/research/README.md).

```bash
node scripts/x-content/research/pull-timeline.mjs @bai_ee 2026-01-01T00:00:00Z   # free
node scripts/x-monitor/import-bird-timeline.mjs --corpus <path>                  # dry run
node scripts/x-monitor/import-bird-timeline.mjs --corpus <path> --write
```

Zero X API calls, zero ScrapeCreators credits. It resolves the account id from
the stored OAuth record (a Firestore read, not an X call), skips retweets, and
writes through the same `writePosts` the card uses — which **merges** metric
keys, so real impressions from a metered sync are never clobbered by an import
that has none, and vice versa. `--views` accepts the output of
`backfill-views.mjs` if you paid the 1 credit/post for view counts.

---

## 7. Deliberately not built

- **Any automatic cadence.** See §3.
- **Per-client monitoring.** The store is keyed by X user id, so this is a
  config change rather than a migration when it is wanted — but nothing in the
  UI or route exposes a client selector today.
- **Writes of any kind.** No posting, following, or profile edits.
- **A dollar figure for X spend.** There is no rate to apply; the card shows
  call counts and points at console.x.com.

---

## 8. Verification record (2026-09-10)

- `npm test` → **3468 pass / 0 fail** (10 of them this card's).
- Route returns 401 unauthenticated; card renders in the live dev dashboard as
  `@bai_ee`, all panels present, empty states honest.
- Spend gate armed and cancelled. **No sync has ever been run** — the follower
  and post endpoints are therefore untested against the live access tier. The
  first Confirm is the real test; if the tier refuses, the card degrades to
  public metrics and says so.
- Not verified: phone-width layout.

Related: [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) ·
[`SOCIAL-AUTO-PUBLISH.md`](./SOCIAL-AUTO-PUBLISH.md) ·
[`COPYWRITER-CARD.md`](./COPYWRITER-CARD.md) ·
[`OPERATING-COST-CARD.md`](./OPERATING-COST-CARD.md)
