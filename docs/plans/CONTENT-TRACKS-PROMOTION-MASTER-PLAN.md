# Content Tracks + Promotion Loop — Master Plan (2026-10-11)

Status: approved direction, ready for multi-agent build. Supersedes `CONTENT-PROMOTION-CONTRACTS.md` (folded in here)
and narrows `VIDEO-REMIX-CONTENT-MANAGEMENT-PROMPT.md` (its Video Remix bucket already exists — extend, don't rebuild).

## 1. Objective

One daily system for the **Hitloop client (`bryan-balli-WUoltG84`, posts as @bai_ee)** that:

1. Plans the channel from **multiple benchmarks, each owning a content track** — @seb__design sets overall cadence and the
   design/work track; music benchmark(s) (added later by the owner in the UI) teach how DJ mixes, Discogs records and music
   talk are best posted. Benchmarks are never averaged across tracks.
2. Monitors X per track and flags worthy conversations/originals.
3. Fills suggestions with **existing library content** — Underground Existence mixes (Video Remix renders), Discogs record
   videos/posts, client work — carrying the right promotion link in the self-reply.
4. Delivers every suggestion to **Telegram**: save → Post myself / I've posted it / Approve & schedule / Approve & post now.
5. Ships to `main` (Telegram command center included) so the owner reviews live and adds music benchmarks there.

No new render automation, no paid generation in automated paths, no auto-publish.

## 2. Verified current state (read-only inspection 2026-10-11)

Branch base: worktree `~/Documents/Repos/Bballi_Portfolio-promo`, branch `feat/content-promotion` = `feat/telegram-command-center`
(`78cddc6f`, Telegram built + tested, not pushed) on top of `main` `b3978fca` (production). Fast-forward mergeable.

| Area | Fact |
|---|---|
| Library | `x_content_packages` (global, no clientId): `ue` bucket 820 rendered mixes (19 artists, all artist-known; 285 BAI-EE `owned`, 535 third-party `never-public`+`approval:needed`, 290 `retired`, ALL `story:'[add your memory]'`); Discogs C1 18; NAS ~5.4k owned |
| Video Remix sync | `features/rendered-videos/{adapter,sync}.js`, route action `sync-rendered-videos` (quote-targets route). Stable id `rv-<jobId>`, ev: object paths, rights preserved when `rightsSetBy:'human'`. No invalidation of videos deleted upstream |
| Benchmarks | Corpora: `seb__design` 987 rows, `bai_ee` 262 (bird). Profile `client_configs/{id}.marketingBriefConfig.xGrowth` holds ≤5 `benchmarkHandles` + topic `lanes` (labels only). Plan `x_strategy_plans/bryan-balli-WUoltG84` v12: `authoredPerDay 4`, `benchmarkPrimary seb__design`, `typeFloors {quote-react:1}`. Only the primary is ever used (`content-plan.js`, `evaluate.js` "never averaged", `loop-corpora.js` takes `[0]`) |
| Corpus refresh | `features/x-strategy/refresh.js`: UI/chat queue `x_strategy_refresh_requests`; drained by the **Mac worker** `scripts/x-content/strategy-refresh-worker.mjs` (bird cookies) — not on Vercel |
| Daily loop | `features/x-content-inventory/daily-loop/run.js` `runDailyLoop`; triggered by local launchd or dashboard `daily-run-generate`; default library = **demo set** (`quote-targets/route.js:~730`); `MAX_SUGGESTIONS=3`; writes `x_content_daily_runs`; drafts only on Save (`review.js saveSuggestionDraft`) |
| Blockers | (1) planner rejects placeholder story (`match.js:99`) ⇒ no rv- package fills a slot; (2) `content-basis.js` facts only for BAI-EE mixes; (3) saved drafts carry **no media** (`review.js` payload); (4) no promotion goals/links, `cta`/`campaign` unread; (5) matching ignores `searchTokens`/promotion; quote slots never attach a package; `brand.js:77` excludes bai-ee from discovery; (6) no cloud cron for the loop; (7) Telegram never reads `x_content_daily_runs`; (8) chat `search_inventory` reports `hasStory:true` for placeholders |
| Telegram | `features/telegram/*`, routes `app/api/telegram/*`, `app/api/worker/telegram-dispatch` (*/5), dashboard tab Content Engine → More → Telegram. SSOT `docs/source-of-truth/TELEGRAM-COMMAND-CENTER.md` |
| Second client | `undergroundexistence-0CsKkpaq` has its own Social Auto-Publish daily-video approvals. **Out of scope — do not touch.** |

## 3. Owner decisions (binding)

- **D1 Rights:** UE-hosted mixes are cleared to promote. Rendered-video packages: BAI-EE ⇒ `owned`; others ⇒ `rights:'cleared'`,
  `approval:{state:'none'}`, `rightsSource:{by:'owner', policy:'ue-hosted-cleared', at:'2026-10-11'}`. `rightsSetBy:'human'` always wins.
  Applying this to production records is **authorized** (idempotent script, dry-run first, logged counts).
- **D2 Account/client:** everything under `bryan-balli-WUoltG84`, posting as @bai_ee. No second client.
- **D3 Links:** promotion URLs start `null`; owner fills them in the UI.
- **D4 Launch:** merge to `main` and push once tests + review are green (production deploy authorized). Telegram bot creation,
  env, `setWebhook`, real Telegram messages and **live X posting remain separate owner gates**.
- **D5 Music benchmarks:** none chosen now. Ship with the music track's benchmark list empty and an honest "add a benchmark"
  state; owner adds handles in the UI during review.

## 4. Design

### 4.1 Content tracks (new plan field)

`x_strategy_plans/{clientId}.plan.contentTracks` (optional; absent ⇒ defaults). Named *tracks* because `lanes` already means
topic labels (`x-benchmark/profile.js`) and content-guard categories.

```js
ContentTrack = {
  id: 'design' | 'music' | <slug>,     // ≤6 tracks
  label: string,
  engines: ('record'|'ue'|'client'|'identity')[],   // disjoint across tracks; every engine in exactly one track
  benchmarks: string[],                 // handles, no @, ≤3 per track; total distinct ≤ PLAN_LIMITS.maxBenchmarkHandles (raise to 8)
  share: number,                        // 0..1 of authored originals; shares sum to 1 (normalize)
  promotions: Promotion[],              // see 4.2
  topics: string[],                     // optional topic labels; seed from profile.lanes
}
DEFAULT_TRACKS = [
  { id:'design', label:'Design & client work', engines:['client','identity'], benchmarks:['seb__design'], share:0.5,
    promotions:[{ id:'client', label:'Client work', engine:'client', url:null, weeklyTarget:2 }] },
  { id:'music',  label:'Music (UE mixes, Discogs)', engines:['ue','record'], benchmarks:[], share:0.5,
    promotions:[{ id:'ue', label:'Underground Existence', engine:'ue', url:null, weeklyTarget:3 },
                { id:'discogs', label:'Discogs store', engine:'record', url:null, weeklyTarget:3 }] },
]
```
- **Pace source** stays `plan.benchmarkPrimary` (seb__design): total authored/day, reply/quote habits, type floors/caps — unchanged.
- **Allocation:** track `share` × authored originals → per-engine minimums fed through the existing `engineTargets` /
  `engine-quota.js` merge. Never lower existing hard caps/floors; identity quote-react floor stays.
- **Per-track profile:** for each track, pool the **rows** of its benchmarks' corpora (`x_corpora`), filtered to the track's
  topic/engine signal where possible, and compute with existing `x-benchmark` profile/report code: format mix (video/image/text),
  median length, link-in-reply rate, best CT hours, post-type mix, top examples (ids). Keep a per-handle breakdown. No
  cross-track averaging. Empty `benchmarks` ⇒ `{ status:'no-benchmark', fallback:'own-history' }` using @bai_ee rows for that
  track's content, surfaced as a visible gap — never invented numbers.
- **Where guidance is used:** slot timing for that track's slots; copy prompt + fallback copy (format/length/hook pattern);
  Telegram + web cards show `track · benchmark · why`; `evaluate.js` results grouped per track vs its own benchmark.
- **Monitoring per track:** `derive-watchlist.js` run per track's benchmarks (who they quote/reply to) → candidates tagged
  `track`; discovery terms add cleared UE artist names (top N by package count) and Discogs label/artist terms; remove the
  blanket `bai-ee` exclusion only for owner-artist names inside the music track.

### 4.2 Promotions
`features/x-strategy/promotions.js` (draft exists, unit-test it; reshape to read from tracks):
`normalizePromotions`, `promotionsOf(planDoc)` (flatten tracks), `promotionFor(pkg, promotions)` (ue ⇒ `source.kind==='rendered-video'`,
record ⇒ `source.kind==='discogs'`, client ⇒ engine client), `promotionSelfReply(p)` (`''` when url null). Link always in the
self-reply, never the main post.

### 4.3 Content eligibility (fixes blockers 1, 2, 8)
- `rendered-videos/adapter.js` + `sync.js`: apply D1 policy; keep producer-owned vs operator-owned fields (operator: story,
  rights when human, thumbRef, tags added by human); add upstream-deleted invalidation (`status:'retired'`,
  `retiredReason:'source-missing'`) **only when the full listing completed**; never delete docs.
- `content-basis.js`: facts for cleared third-party mixes (`mix`, `"<Artist> – <Title>", hosted on Underground Existence`,
  provenance `Underground Existence`), duration/year/genre tag. No invented memories/dates.
- `match.js`: placeholder story blocks a slot **only when the package has no facts basis** (import `contentBasis`).
- `scripts/x-content/apply-ue-rights-policy.mjs`: dry-run default, `--write`, respects human rights, prints counts only.
- `x-strategy/route-handlers.js`: `hasStory` false for placeholders.

### 4.4 Daily loop (fixes 3, 5, 6)
- `item-actions.js`: export `pickMedia`. `review.js saveSuggestionDraft`: optional deps `signEvLong`, `hitloopUrl`; attach media
  + `mediaStoragePath` (object ref, re-signed at publish by existing twitter-service path); revalidate eligibility (exists).
- `select.js`/`run.js`: thread `contentTracks` + promotions; each suggestion carries `track`, `promotion {id,label,url}`,
  `package.media {kind, ref}`, `draft.selfReply = promotionSelfReply()` when empty; matching also uses `searchTokens` +
  entities; a conversation that strongly matches a track package yields an original-with-media suggestion ("related to
  @author's post") rather than a quote-with-video.
- Library default `full` for the pilot client; `MAX_SUGGESTIONS` 3 → 5.
- New `app/api/worker/daily-loop/route.js`: Bearer `CRON_SECRET` (fail closed in prod), runs `runDailyLoop` **without the model
  drafter** (fallback copy, zero spend) for `PILOT_CLIENT_IDS`; `vercel.json` cron `30 11 * * *` (06:30 CT). Uses the latest saved
  scan; never calls bird/X.

### 4.5 Telegram (fixes 7)
- `read-models.js`: `todaySuggestions(clientId)` from `x_content_daily_runs` (today's CT run).
- `briefing.js`: "What's happening?" adds "N suggestions ready" grouped by track; Today's posts lists unsaved suggestions.
- `bot.js`/`handoff.js`: suggestion card = media (by URL ≤20MB, else poster + "open video" link) + exact copy message + track ·
  promotion · why; buttons **Save draft** / **Dismiss** (ticket action `'suggestion'`, params `{op, runKey, suggestionId}`); after
  save, send the existing post handoff card (Post myself / Approve…).
- `scheduler.js`: one outbox notice per new run (dedupe by run key), respecting quiet hours/pause.
- Orchestrator wires `ctx.services.{listTodaySuggestions, saveSuggestion, dismissSuggestion}` in `runtime.js`.

### 4.6 UI — X Strategy tab "Content tracks"
Per track: label, engines (read-only chips), benchmarks (add/remove handle → existing refresh request; show corpus rows,
last pulled, queued/needs Mac worker), share slider (sum 100%), promotion links (https or empty), per-track profile summary
(or "no benchmark yet"). Stable DOM ids (`id="x-strategy-content-tracks-panel"`, `x-strategy-track-<id>-row`, …). Plan saves go
through the existing versioned plan store (history + revision). Strategy chat: plan-change proposals may edit `contentTracks`.

## 5. Build waves (multi-agent)

**Wave 0 — orchestrator (≤30 min):** read this plan + SSOTs; confirm base; write `features/x-strategy/content-tracks.js`
(types, defaults, `normalizeContentTracks`, `tracksOf(planDoc)`, `trackForEngine`) + reshape `promotions.js` to it, with unit
tests. These two files are the shared contract; agents import, never edit.

**Wave 1 — 5 parallel Sonnet agents, disjoint files:**
| Agent | Owns |
|---|---|
| A Eligibility & rights | §4.3 files + tests |
| B Track strategy | `x-strategy/{contracts,plan-state,plan-store,content-plan,evaluate,loop-corpora,agent/tools,agent/proposals,agent/prompt}.js`, new `x-strategy/track-profile.js`, `x-benchmark/derive-watchlist.js` per-track entry, `engine-quota.js` hook, tests |
| C Daily loop | §4.4 files (`daily-loop/{select,run,review,brand,config,inputs}.js`, `item-actions.js` export, quote-targets route daily-run deps, worker route, `vercel.json`) + tests |
| D Telegram | §4.5 files except `runtime.js` + tests |
| E UI | X Strategy tab Content tracks panel (find the plan editor component under `components/dashboard/x-content/` or X Strategy tab), Library bucket label/rights display tweaks, Telegram/web suggestion card track·promotion chips |

Rules for agents: no git writes; no network/Firestore/X/bird/paid calls; tests with fake stores; report files changed + tests run.

**Wave 2 — orchestrator integration:** wire `runtime.js` services, route deps, resolve contract drift; run all affected suites
then full `npm test` (baseline: only the 2 known vendor-api-lib failures); `npm run build` in this worktree only (no dev server
running here); fresh reviewer agent on rights/client-scope/lifecycle/queue/auth; fix findings.

**Wave 3 — launch:** commit; update SSOTs (new `docs/source-of-truth/CONTENT-TRACKS.md`, append TELEGRAM + CONTENT-MANAGEMENT +
X-STRATEGY-TAB + DEVELOPER-HANDOFF pointers); merge `feat/content-promotion` → `main` (fast-forward or merge commit), push;
watch the Vercel deploy to Ready; smoke routes (dashboard 200, worker 401 without secret, webhook 503 until configured);
run `apply-ue-rights-policy.mjs` dry-run then `--write` (D1); trigger one daily-loop worker run with `CRON_SECRET` (free, no
model) and confirm the run doc has track-tagged suggestions with media refs. Rollback target: previous production deployment.

## 6. Acceptance

1. Plan with no `contentTracks` behaves exactly as before (back-compat tests).
2. Defaults: design track uses seb__design profile; music track shows `no-benchmark` gap, still allocates music slots from shares.
3. Adding a handle to a track queues a refresh; with a fixture corpus, the track profile computes from that handle only.
4. A cleared third-party mix and a BAI-EE mix both fill music showcase slots; `never-public`/human-blocked/retired/source-missing never do.
5. Sync twice ⇒ same items; human rights/story survive; upstream-deleted ⇒ retired only after a complete listing.
6. Saved suggestion ⇒ one `social_posts` draft with `mediaStoragePath` = the package's object ref, promotion link in self-reply
   (or none when url null), `packageId`, sourceRef; re-save idempotent; no scheduling.
7. Worker route runs zero model calls; unauthenticated ⇒ 401; prod without secret ⇒ fail closed.
8. Telegram fake transport: briefing shows grouped suggestion count; Save creates the draft once and sends the handoff card;
   Dismiss hides it; stale ticket after regenerate ⇒ "out of date", no write.
9. Chat `search_inventory` finds a mix by artist; `hasStory` false for placeholders.
10. Existing NAS/Discogs/Video Remix UI and Telegram tests still pass; full suite at baseline; build passes.

## 7. Risks / limits

- Corpus refresh needs the owner's Mac worker (`node scripts/x-content/strategy-refresh-worker.mjs`, bird cookies) — UI must say so.
- Library is global (no clientId); owner-pilot only. Not multi-client ready.
- Fallback (no-model) copy from the cron is plainer; owner revises in Telegram or regenerates with the model from the dashboard.
- Telegram video by URL caps at 20MB; long mixes fall back to poster + link.
- D1 clears 535 third-party mixes by owner policy; per-artist override = set rights by hand in the Library.
