# Email Digest Card — Source of Truth

**Status:** P1 shipped · P2(b) shipped (calendar toggle migrated) · P2(a) stage 1 shipped
(config backbone + digest wiring) · P2(a) stage 2 pending (the dashboard card UI) ·
**Granular per-section toggles shipped** (§9) · **Fresh-run-on-send + hosted Executive
Brief link shipped** (§10).
**Owner workstream:** normalize the Email Digest onto the Market Signals card pattern.

> **Read me first if you're touching the digest (as-built jump-list):**
> - **Every email section is on/off individually** via `include.*` (17 granular keys) — see §9.
>   Sections are gated **purely by their toggle** with an explicit empty-state, so the EMAIL
>   PREVIEW and the sent email hide/show identically.
> - **Refresh and send are separate.** The scheduled pre-digest worker refreshes
>   intelligence before the daily cron. **Generate & Send Email** skips refresh and
>   immediately sends saved data plus the last completed video. See §10.
> - **Preview = what sends.** EMAIL PREVIEW defaults to **live** mode; Run & Send **saves the
>   settings first** so saved == previewed == sent.
> - **The selected video client owns publishing.** Generate & Send attaches the
>   latest completed Video Remix selected by `dailyVideo.assetSourceClientId`
>   (blank = publishing owner); it does not start a new render.
>   `dailyVideo.sourceClientId` independently selects the publishing owner,
>   which supplies the caption
>   voice, approval policy, connected X account, post, and approval tokens.
>   `recipientEmail` remains independent, so both the client's email and the
>   Hitloop/admin email may approve the same owner-scoped post without creating
>   a second X post.
> - **Daily is opt-in per client.** The card is scoped to the **loaded dashboard client**
>   (`activeClientId` → `digest-config?clientId=`). Its **Daily-email toggle** (`schedule.enabled`,
>   default **OFF**) is the SOLE gate for BOTH crons — `pre-digest-refresh` (12:35 refresh/crawl)
>   **and** `daily-digest` (13:00 send). The refresh cron loops `listCronEnrolledClientIds()`
>   (home ∪ enabled), not a global `includeClientIds` fan-out; the send cron skips a non-enrolled
>   client (Send Now + previews bypass). A one-time `system_flags/digest_optin_v1` migration turned
>   legacy daily-on configs OFF except the home client. A per-client **`recipientEmail`** sets the
>   send-to (blank = the admin `DIGEST_EMAIL`; a client is never emailed until it's set). New
>   signups write no config → OFF → Creative Brief only. This is what fixed the ~$10/day leak
>   (every client was being crawled daily) — cost visibility lives in
>   [`OPERATING-COST-CARD.md`](OPERATING-COST-CARD.md).
> - **⚠️ Pending:** per-client **send fan-out** (each enrolled client → its own email) is NOT built —
>   the scheduled send still builds one email for the resolved client. `recipientEmail` is stored/honored
>   for that single send; looping enrolled clients with their own recipients is the remaining refactor.

> **Guiding principle.** The **Market Signals card** is the reference pattern for how we
> build a brief: a control panel that toggles content on/off and produces a brief. The
> **Email Digest** must follow the same setup + run process. Its "brief" is the **email**.
> Every feature the email pulls in gets **its own card** that owns *that feature's settings*;
> the Email Digest card only owns the **include-in-email toggle + schedule** for each feature.

Related SSOT: [`MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](MARKET-SIGNALS-AND-SCOUT-PROJECTION.md) (the pattern being mirrored),
[`CREATIVE-BRIEF-DELIVERABLES-WIRING.md`](CREATIVE-BRIEF-DELIVERABLES-WIRING.md) (the official brief standard),
[`NOT-THE-RUG-HITLOOP-CONFIG.md`](NOT-THE-RUG-HITLOOP-CONFIG.md) (NTR client/digest setup and cutover guardrails).

---

## 1. The three-brief picture (where this fits)

```
[Market Signals card]  → produces Marketing Brief   (reference pattern)
[Creative Brief card]  → official brief standard
[Email Digest card]    → sends scheduled email + links to Executive Brief
[Executive Brief]      → aggregates Marketing + Creative + operational intelligence
```

The Email Digest is a **read-only aggregator at render time** — `buildEmailHtml` reads
finalized intelligence. The scheduled pre-digest worker refreshes Scout, strategy,
and summaries into `dashboard_state`; the scheduled send then reads that saved
state. Interactive **Generate & Send Email** intentionally skips refresh so it cannot
sit in a long-running module loop. Previews stay fully read-only.
The hosted **Executive Brief** linked from the email is a freshly-published page at
`/briefs/{clientSlug}/{briefSlug}` (was `/dashboard?open=brief`; that's now only the fallback).

Its primary content is **whatever the Market Signals card produced** (the Marketing Brief).
Secondary content is the **Creative Brief**, **Calendar agenda**, **Web Stats** (site/user
performance), platform/deployment status, watchlist analysis, and any other finalized brief
sections exposed through the shared projection.

---

## 2. Card placement (decided)

| Card | Bucket / location | Status |
|---|---|---|
| **Email Digest** card (single, two tabs) | dashboard **Admin bucket** (`category: 'admin'`) | `email-digest` card, modal `AdminEmailDigestView` in `components/AdminEmailModals.jsx`: **SETTINGS** tab = params (sources, summary, included sections, schedule, docs) + **EMAIL PREVIEW** tab = rendered email + Run&Send. Mirrors the Market Signals CONFIG→preview pattern. The former separate `email-settings` card was folded in. ⚠️ NOT the standalone `/admin` AdminPage. |
| **Calendar** (connection + which-calendar settings) | **Knowledge Officer** bucket | EXISTS — `calendar-connect` card (`DashboardPage.jsx:9734`, `CalendarConnectView`) |
| **Web Stats** (analytics settings: GA4 property, tracked events) | **Website Developer** bucket | NEW — does not exist yet |

These are 1-off cards now; candidates for subscriber-facing use later.

---

## 3. Email anatomy (current — the thing we are managing)

Source: `app/api/admin/daily-digest/route.js` `buildEmailHtml`. Sections render top-to-bottom.
**Each section now maps to its own granular `include.*` key** (§9). ⚠️ **Parity rule:** every
section is gated **only by its toggle**, never by data presence — when a toggle is ON but the
data is empty/errored, the section still renders with an explicit empty-state ("No traffic
recorded…", "GA4 unavailable: <error>"). This is what makes the EMAIL PREVIEW match the sent
email. **Do not** re-introduce `ga4.overview ? … : ''` / `?.length ? … : ''` data-presence
gates — that was the exact bug that made analytics silently vanish from the real email.

| # | Section | Data source (collector) | Producer / origin | `include.*` key |
|---|---|---|---|---|
| 1 | **Hero** (date) | — | static | always on |
| 1b | **Open Executive Brief CTA** | freshly-published `/briefs/{slug}` (fallback `/dashboard?open=brief`) | brief-link resolver (§10) | `execBriefLink` |
| 1c | **"Contact Your Human" CTA** | `digestCfg.contactUrl` (env `DIGEST_CONTACT_URL` fallback) | static | `contactHuman` |
| 2 | **Executive Summary** (LLM callouts) | `generateBriefSummary` (`_brief-summary.js`) | **LLM — Haiku** (`DIGEST_SUMMARY_MODEL`, dflt `claude-haiku-4-5`). Brain context via `loadClientBrainContext(homeClientId, { useFor:'emailDigest' })` — system prompt says "strictly follow Formatting Rules." | `execSummary` (render) + `summaryEnabled` (LLM spend) |
| 2b | **Video Remix post content** (video card + X promo caption) | `media_jobs` (status `complete`) + `generateVideoPromoPosts` | `_brief-summary.js:generateVideoPromoPosts` — uses `loadClientBrainContext({ useFor:'copy' })` (voice + few-shot). System prompt bans em dashes + hashtags explicitly. | `videoPosts` |
| 2c | **Mockup Studio video promo** | Mockup Studio render jobs | same generator as `videoPosts` | `videoPromo` |

> ⚠️ **Video reuse is labeled, never silent (2026-07-20).** Both video sections serve the newest
> capture within `VIDEO_CAPTURE_MAX_AGE_MS` — tightened **30h → 26h** so the fallback can only ever
> reach back to yesterday's send, never the day before. When the chosen capture is not from **today**
> (`isSameDigestDay`, digest timezone), the email card carries an amber `⚠ from <Mon, Jul 19>` badge
> and the run terminal reports `REUSED from … — today's render was not ready in time` (step level
> `warn`, not `success`). Before this, a stalled render was indistinguishable from a working one:
> the digest quietly re-sent the previous day's MP4 and the video looked "the same every day."
> Root cause of the stall was the unawaited `repository_dispatch` — see the Video Remix SSOT gotcha #1.
| 3 | **Today's Agenda** (5-day calendar) | `getCalendarAgenda` → Google Calendar API | Calendar card / OAuth | `agenda` |
| 3b | **Local weather forecast** | weather API | weather service | `weather` |
| 3c | **Follower posts** (1 recent post per followed handle) | `intel.watchlist` built from `marketingBrief.watchlistTimelines` | `refreshWatchlist` in pre-digest worker | `followerPosts` |
| 4 | **Human brief blurb** | `intel.humanBrief` (`scoutBrief.humanBrief`) | Market Signals scout narrative | `humanBrief` |
| 4b | **Post opportunities** | `intel.opportunities` | Market Signals scout `viralOpportunities` | `opportunities` |
| 4c | **Suggested Replies** (reply-pool targets with drafted copy) | `intel.digestRecipes[recipeId='reply-targets']` — populated to `marketingBrief.reportSnapshot.digestRecipes` by `refreshReplyTargets` in the pre-digest worker. Fallback: `intel.opportunities[].suggestedReply` if no recipe result. | reply-targets recipe (`features/intelligence/analysis-recipes/reply-targets.md`) run over `{watchlistMentions, brandMentions, redditSignals, kolActivity}` + `useFor:'copy'` voice context | `suggestedReplies` (**default ON**) |
| 4d | **Signals** (KOLs / competitors / narratives) | `intel.kols`, `intel.competitors`, `intel.narratives` | Market Signals scout `agentData` | `signals` |
| 4e | **Watchlist accounts** (name-for-name handle activity) | `intel.watchlist` built from `watchlistTimelines` | `refreshWatchlist` + `buildWatchlist` | `watchlistAccounts` |
| 4f | **Suggested posts** (strategy posts of the day) | `intel.strategyBuilder.today.posts` + `intel.content` (Scribe-drafted copy) | strategy builder + Market Signals | `suggestedPosts` |
| 4g | **30-day plan preview** | `intel.strategyBuilder.items` | strategy builder | `planPreview` |
| 5 | **"Happening on X"** watchlist brief | `intel.watchlistAnalysis` (`reportSnapshot.watchlistAnalysis.text`) | watchlist-pull recipe | `watchlist` |
| 5b | **Creative Brief** (attached run deliverable — cover summary + hero image) | `getCreativeBriefForClient` → `dashboard_state.briefSummaries.onboarding.summary` + `artifacts.homepageDeviceMockup`/`siteMeta.ogImage` | **Creative Brief card** (`onboarding-brief`) | `creativeBrief` (opt-in, **default off**) |
| 6 | **Platform Overview** stats | `getFirebaseMetrics` | Firestore counts | `platformOverview` |
| 7 | **GA4 Traffic** | `getGA4Metrics` → GA4 API | Web Stats card | `ga4Traffic` |
| 7b | **Top Pages / Sources / Key Events** | `getGA4Metrics` | Web Stats card | `topPages` / `trafficSources` / `keyEvents` |
| 8 | **Homepage interactions** (clicks, scroll, web vitals) | `getHomepageAnalyticsMetrics` → `homepage_events` | Web Stats card | `homepage` (AND `webStatsConfig.homepageEnabled`) |
| 9 | **Firebase: New Sign-ups / Dashboards / Pipeline Status** | `getFirebaseMetrics` | Firestore | `signups` / `dashboards` / `pipeline` |
| 10 | **Vercel Deployments** | `getVercelMetrics` → Vercel API | Vercel | `deployments` |
| 10b | **Vercel Runtime Errors** | `getVercelMetrics` | Vercel | `runtimeErrors` |
| 11 | **Footer** | — | static | always on |

> **Voice / formatting note (rows 2, 2b, 4c).** Client Brain formatting rules (e.g. "avoid em dashes") are soft context — models follow them inconsistently when they appear only in the context block. The pattern to enforce hard rules: add an explicit line in the *system prompt* (not just the context block): "Strictly follow the Formatting Rules from brand context." `generateVideoPromoPosts` does this explicitly; apply the same to `generateBriefSummary` and `generateStrategyPlan` if voice drift recurs.

> **Collector cost note.** Collectors are still skipped when none of their sections are on:
> the route derives group flags (`needGA4 = ga4Traffic||topPages||trafficSources||keyEvents`,
> `needVercel = deployments||runtimeErrors`, `needHomepage = homepage && homepageEnabled`) so a
> fully-off analytics group makes no GA4 API call.

> **Preserve-analysis rule.** The LLM executive summary (#2) and the watchlist analysis (#5)
> stay configurable, not removed. A later phase expands the digest's analysis to carry
> **scribe tone + guardian feedback/QA style** — do not rip out the Haiku summary.

---

## 4. Config shape (extend `digest_config/{clientId}`)

> **UPDATE (granular toggles + hosted brief link).** `include.*` is now **per-section**
> (one key = one rendered block in `buildEmailHtml`), so the EMAIL PREVIEW and the sent
> email hide/show **identically** — every section is gated purely by its toggle, with an
> explicit empty-state when the data is absent (no more data-presence gating that made
> analytics silently vanish from the real email). Granular keys (default ON except
> `creativeBrief`): `execBriefLink, execSummary, agenda, marketingBrief, watchlist,
> creativeBrief, ga4Traffic, topPages, trafficSources, keyEvents, homepage, platformOverview,
> signups, dashboards, pipeline, deployments, runtimeErrors`. Legacy coarse keys
> (`calendar/webStats/platformStats/...`) still load via `LEGACY_INCLUDE_EXPANSION` in
> `normalizeInclude`. New field **`briefLinkMode`** (`'fresh' | 'latest' | 'off'`, default
> `'fresh'`) controls the "Open Executive Brief" link: `fresh` = run + publish a new hosted
> brief on send (LLM cost; reuses a publish < 90 min old; falls back to the dashboard link on
> any failure — never blocks the email), `latest` = newest already-published hosted brief,
> `off` = no hosted link. Resolver: `features/intelligence/_digest-brief-link.js`
> (`resolveExecutiveBriefUrl`). UI: §03 of `AdminEmailDigestView` (grouped toggle cards +
> brief-link segmented control). Preview never triggers a paid fresh run (`allowFreshRun: !isPreview`).

Original doc (`features/intelligence/_digest-config.js` DEFAULTS):

```js
{
  summaryEnabled: true,
  tone: 'concise, professional, direct',
  recentDocsCount: 5,
  maxDocChars: 8000,
  extraInstructions: '',
  homeClientId: null,        // primary brief source
  includeClientIds: [],      // additional clients' briefs to fold in
}
```

**Proposed additions** (additive — keep all current fields, default everything ON so behavior
is unchanged until a user toggles):

```js
{
  // ── Aggregation toggles: what flows into the email ──
  include: {
    calendar:       true,   // §3 row 3   (settings owned by Calendar card, Knowledge Officer)
    marketingBrief: true,   // §3 row 4+5 (settings owned by Market Signals card)
    webStats:       true,   // §3 row 7+8 (settings owned by Web Stats card, Website Dev)
    platformStats:  true,   // §3 row 6+9
    deployments:    true,   // §3 row 10
  },
  // ── Schedule: when + how often the email sends ──
  schedule: {
    enabled:   true,
    frequency: 'daily',     // 'daily' | 'weekly' | 'off'
    sendHour:  7,           // 0–23, in `timezone`
    weekday:   1,           // 0–6 when frequency==='weekly'
    timezone:  'America/Chicago',
  },
  // summaryEnabled stays as the §2 toggle; tone/extraInstructions stay as the analysis knobs.
}
```

`saveDigestConfig` (same file) clamps/validates new fields the same way it does today. The
digest route reads `include.*` and skips the matching `buildEmailHtml` section when false.

---

## 5. Run + preview process (mirror Market Signals)

The Market Signals card = config save → IN BRIEF preview → Run. The Email Digest card maps 1:1
onto what already exists, just re-skinned as a card:

| Market Signals action | Email Digest equivalent | Already exists? |
|---|---|---|
| Save config (`/api/dashboard/marketing-brief/config`) | `/api/admin/digest-config` (GET+POST) | ✅ |
| IN BRIEF preview tab | preview HTML via `/api/admin/daily-digest?preview=1` (or `?preview=template` for layout-only) | ✅ |
| Run (produces brief) | Send now (`?send=1&skipRefresh=1`) + scheduled cron run over pre-refreshed data | ✅ |

**Preview = what sends (as-built).** The EMAIL PREVIEW tab now defaults to **live** mode
(`?preview=1`), not template — so what you see is exactly what sends (same route code, same
toggles, real data). Template (`?preview=template`, placeholder data) is an opt-in "layout only"
view. The preview endpoint takes an optional `&include=<csv-of-on-keys>` override (preview only)
so the tab renders the card's *current, even unsaved* toggles (`form.include`); `include=` empty
= all off, param absent = saved config. **Run & Send saves the current settings first**, so
`saved == previewed == sent`. Because every `buildEmailHtml` section is gated only by `include.*`
(never by data presence — §3 parity rule), and `?preview=1` and `?send=1` share one code path,
live preview and the sent email share the same renderer. Generate & Send Email uses
the same latest saved data rather than starting a refresh.

### 5b. Generate & Send run UX (as-built — shared global terminal)

**Generate & Send** does NOT render its own inline terminal panel anymore (the old embedded
`digest.generate-send` box was removed). It streams through the **shared global run terminal** —
the same `#intake-modal-overlay` / `#intake-modal-card` terminal (driven by `adhocTerminal` state)
that **every** card run uses (Mockup Video, Market Signals). The helper is
**`runWithTerminal({ title, brand, host, stages, task })`** (`DashboardPage.jsx`, ~line 3183),
**prop-drilled** into `AdminEmailDigestView` (`runWithTerminal` prop). Inside `runAndSend`
(`components/AdminEmailModals.jsx`) the run body is the `task({ advance, note })` callback:
`advance(pfx, text)` = settle the prior line ✓ + open a new phase line; `note(text)` = a dim status
line. Step map: `[SAVE]` save config → `[SEND]` call
`/api/admin/daily-digest?send=1&skipRefresh=1` → render + send from saved data
and the latest completed video → `note` the send log + subject →
`return { doneText }`.

- **No confirm gate.** Clicking Generate & Send runs immediately (the old `window.confirm` was
  removed). `sendStatus` still drives the button label (`Working…`) + the actionbar hint.
- **Minimized run = the established chip, NOT a bottom pill.** Closing the terminal (`✕`) while the
  run is still going **minimizes** it (`adhocTerminal.open = false`); the run keeps going. The
  minimized state surfaces through the SAME **`#run-active-indicator-chip`** "Running" UI in the
  dashboard coverage header (`DashboardPage.jsx` ~line 13173) that server/module runs use — its
  condition is `isRunActive || moduleRunInFlight || adhocMinimized`
  (`adhocMinimized = adhocTerminal && !adhocTerminal.open`, ~line 8084) and its click branches
  `adhocMinimized ? reopenAdhocTerminal : reopenIntakeModal`. The old bottom-right floating
  `#adhoc-run-status-pill` was **deleted**. ⚠️ This is a **shared** surface — the chip now backs
  Mockup Video + Market Signals minimized runs too. The chip lives in the dashboard header, so it's
  hidden behind an open tile modal (same as server runs) and visible once the modal is closed;
  inside the digest modal the run status still shows in the actionbar hint.
- **Background scroll is locked** while any terminal overlay is open. The `document.body`
  `overflow:hidden` effect (`DashboardPage.jsx` ~line 8176) includes `Boolean(adhocTerminal?.open)`
  alongside the other modals; the lock releases when the terminal closes or is minimized.
- **Auto-close.** ~4s after a run reaches `done` (while open) the terminal auto-closes (standard for
  all adhoc runs).

---

## 6. Phase order

- **P0 — this doc.** Approve before coding.
- **P1 — Email Digest card. ✅ SHIPPED.** Admin digest panel now carries per-section include
  toggles (§4 `include.*`) + schedule fields (§4 `schedule.*`) + preview/send. `digest_config` +
  `_digest-config.js` extended & validated. Digest route honors `include.*` (gates collectors +
  hides sections); §3 analysis behavior preserved.
- **P2 — Feature cards.**
  - (a) **Web Stats** card in Website Developer bucket owning GA4 property + tracked-event
    settings (today hardcoded as `GA4_PROPERTY_ID` + `DIGEST_EVENT_NAMES` in the route).
    - **Stage 1 ✅ SHIPPED** — config backbone. New route `app/api/dashboard/web-stats/config`
      (GET/POST) stores `client_configs/{clientId}.webStatsConfig` = `{ ga4PropertyId,
      trackedEvents[], homepageEnabled }`. The digest route reads it for the home client and
      threads it through `getGA4Metrics({propertyId,eventNames})` / `runGA4Report(…, propertyId)`;
      homepage block honors `homepageEnabled` via `renderInclude.homepage`. Empty values fall
      back to env/defaults → no behavior change until set.
    - **Stage 2 — pending.** The dashboard card UI in the Website Developer bucket
      (`DashboardPage.jsx` card def + config modal wired to the route). v1 knobs to confirm:
      GA4 property ID · tracked-events list · homepage on/off (lookback window = maybe).
  - (b) **Calendar include-toggle migration. ✅ SHIPPED.** `include.calendar` (Email Digest card)
    is now the single include authority. Removed the Market Signals "06" Calendar/Agenda toggle
    + its state/handler; digest route no longer ANDs with `marketingBriefConfig.calendar.enabled`.
    The `calendar-connect` settings card stays in Knowledge Officer (its copy now points to the
    Email Digest admin panel). Note: `marketing-brief/config` still persists a dead
    `calendar.enabled` field — harmless, no reader; clean up opportunistically.
- **P3 — Live schedule.** Cron becomes a dispatcher that reads each subscriber's
  `schedule.{frequency,sendHour,weekday,timezone}` instead of one fixed Vercel cron time.
- **P4 (LATER, not scoped).** Expand digest analysis to scribe-tone + guardian feedback style;
  aggregate Email + Marketing + Creative into an Executive Brief.

---

## 7. Touch points (file map)

| Concern | File |
|---|---|
| Digest route (collectors + `buildEmailHtml` + send) | `app/api/admin/daily-digest/route.js` |
| Digest config persistence + defaults + validation | `features/intelligence/_digest-config.js` |
| Digest config admin API | `app/api/admin/digest-config/route.js` |
| Web Stats settings API (P2a stage 1) | `app/api/dashboard/web-stats/config/route.js` → `client_configs/{clientId}.webStatsConfig` |
| Email Digest card modal (the control surface) | `components/AdminEmailModals.jsx` → `AdminEmailDigestView`: **SETTINGS** tab (`.vrk-scope` kit). §03 now renders the **17 granular toggles grouped** (`SECTION_GROUPS` = Brief / Web analytics / Platform / Ops) as `.toggle-card`s + a **brief-link-mode** `.segmented` control (`fresh`/`latest`/`off`) + per-section **"Customize ↗"** (`onOpenCard` → signals / onboarding-brief / calendar-connect). EMAIL PREVIEW defaults to **live**; **Run & Send saves config first** then `?send=1`. |
| Generate & Send run (streams the send through the shared terminal) | `components/AdminEmailModals.jsx` → `runAndSend` (uses the `runWithTerminal` prop). See **§5b**. |
| Shared global run terminal + minimized-run chip + scroll lock (⚠️ shared by ALL adhoc runs) | `DashboardPage.jsx`: `runWithTerminal` (~3183) · `adhocMinimized` (~8084) · body scroll-lock effect (~8176) · `#run-active-indicator-chip` (~13173, condition `isRunActive \|\| moduleRunInFlight \|\| adhocMinimized`). The old `#adhoc-run-status-pill` was removed. See **§5b**. |
| Hosted brief link resolver | `features/intelligence/_digest-brief-link.js` → `resolveExecutiveBriefUrl({clientId,mode,origin,allowFreshRun})` + `getLatestPublishedBrief`. Renders `renderMarketingBriefHtml` (dynamic-imported from brief-preview route) and writes a public `clients/{cid}/custom_briefs/{daily-YYYY-MM-DD}` doc + `brief_client_slugs` alias. |
| Pre-digest fresh-run worker | `app/api/worker/pre-digest-refresh/route.js` → exports `refreshDigestClient(clientId)` (Scout-only brief + strategy regen → `completeRun` persists to `dashboard_state`). Called inline by the digest route on a real send; also a standalone cron-secret route. |
| Shared strategy-plan core (used by the refresh) | `features/strategy-builder/generate-plan.js` → `generateStrategyPlan({clientId,clientConfig})` |
| Creative Brief attachment fetch | `features/intelligence/_brief-intel.js` → `getCreativeBriefForClient(clientId)`; rendered by `buildCreativeBriefSection` in the digest route |
| Admin-bucket card def (`email-digest`) | `DashboardPage.jsx` (~line 10297, `category: 'admin'`); modal render branch where `activeTileModal.cardId === 'email-digest'` |
| ⚠️ Legacy parallel surface (do NOT add settings here) | `AdminPage.jsx` digest panel — pre-existing tone/summary/docs form; superseded by the Email Settings card, retire opportunistically |
| LLM summary (analysis to preserve) | `features/intelligence/_brief-summary.js` |
| Canonical brief projection (Market Signals content) | `features/intelligence/_brief-intel.js` (`projectBrief`) |
| Calendar settings card (Knowledge Officer) | `DashboardPage.jsx:9734` (`calendar-connect`, `CalendarConnectView`) |
| Calendar include-toggle to MOVE (currently MS "06") | `DashboardPage.jsx:~5599` |
| Web Stats card (NEW, Website Developer bucket) | `DashboardPage.jsx` card defs + CAP_STEPS (~line 2427) |

---

## 8. Open items / decisions still needed

1. **Web Stats settings scope** — what's editable in the Web Stats card v1? (GA4 property id,
   which `DIGEST_EVENT_NAMES` to track, homepage-events on/off.) Currently all hardcoded.
2. **Schedule granularity** — daily/weekly enough for v1, or also "off + manual send only"?
3. **Per-client vs single-recipient** — `digest_config` is per-clientId but the digest sends to
   one `DIGEST_EMAIL`. Subscriber expansion (P-later) implies many recipients × schedules.
4. **DOM identifiers** — new card containers get stable ids per repo naming rule
   (`email-digest-card-shell`, `email-digest-include-toggles-row`, `web-stats-card-shell`, etc.).

---

## 9. Granular per-section toggles (as-built)

Defined in `features/intelligence/_digest-config.js`. **28 keys, one per rendered section.**
The UI groups them (`SECTION_GROUPS` in `AdminEmailModals.jsx`); the route gates each
`buildEmailHtml` section on exactly one key.

```
CTAs (always-in-header, not in section flow):
  execBriefLink · contactHuman

Default ON (tease core):
  execSummary · agenda · weather · followerPosts · videoPosts · videoPromo
  signups · suggestedReplies

Default OFF (opt-in extras — full detail lives in the linked Executive Brief):
  humanBrief · opportunities · signals · watchlistAccounts
  suggestedPosts · planPreview · watchlist · creativeBrief
  platformOverview · ga4Traffic · topPages · trafficSources · keyEvents
  homepage · dashboards · pipeline · deployments · runtimeErrors
```

**Back-compat (critical).** Existing `digest_config` docs written with the OLD 6 coarse keys
still work. `normalizeInclude` expands legacy keys first via `LEGACY_INCLUDE_EXPANSION`:
```
calendar        → [agenda]
webStats        → [ga4Traffic, topPages, trafficSources, keyEvents, homepage]
platformStats   → [platformOverview, signups, dashboards, pipeline]
deployments     → [deployments, runtimeErrors]
marketingBrief  → [humanBrief, opportunities, suggestedReplies, signals,
                    watchlistAccounts, suggestedPosts, planPreview, watchlist]
creativeBrief   → [creativeBrief]
```
Granular keys present in the same saved doc override the legacy expansion. ⚠️ If you add a new
section, add its key to `INCLUDE_KEYS` + `DEFAULT_INCLUDE`, gate the section in
`buildEmailHtml`, parse it in the route's `includeOverride`, and add it to a `SECTION_GROUPS`
group in the UI — and give it an empty-state (parity rule, §3).

**Preview override.** The route's `includeOverride` parses `&include=<csv>` against
`digestConfig.INCLUDE_KEYS`; the UI builds that csv from `form.include`. Keys absent from the
csv are treated as OFF, so `getDigestConfig` (which normalizes to all 17 keys) must back the UI.

**Summary's two gates.** `execSummary` (include key) controls whether the summary *block
renders*; `summaryEnabled` (separate field, §02 of the UI) controls whether the *LLM runs*
(spend). Both default true; the block shows an empty-state if rendered without a paragraph.

**`briefLinkMode`** (top-level `digest_config` field, not under `include`): `'fresh' | 'latest'
| 'off'`, default `'fresh'`. Validated by `normalizeBriefLinkMode`. Drives the resolver (§10).

---

## 9c. Generate & Send always scouts fresh (2026-08-13)

Scout has a **6-hour freshness skip** (`SCOUT_FRESH_WINDOW_MS`, `pre-digest-refresh/route.js:150`): a refresh with no `force` returns `{ ok: true, skipped: 'fresh', ageMinutes }` without spending anything when the stored brief is under 6h old.

The card's **Generate & Send** now passes **`force=1`** on its `signals` phase, so a human clicking it always gets a real scout. Previously it inherited the cron's skip, which meant a send within 6h of the last run silently reused the old `agentData` — and the run terminal printed `scout ✓` either way, so config changes looked like they had no effect. The terminal now prints `scout skipped (fresh, 276m old)` when the gate trips anywhere it still can.

**The daily cron deliberately keeps the skip** — unattended, once a day, ~24h since the last run, so the gate rarely trips and the saving is real. Only the human-triggered path forces.

Path summary:

| Path | Refreshes | 6h gate |
|---|---|---|
| Market Signals → Generate Report (`marketing-brief/run`) | yes | no gate exists on this route |
| Email Digest → Generate & Send | yes | **bypassed via `force=1`** |
| Daily cron (`12:35` UTC) | yes | yes — intentional |

---

## 9a. Press Coverage section + the THREE hardcoded lists (added 2026-08-13)

`pressCoverage` is a Market-Signals-group section rendering `projectBrief`'s `coverage` (articles: publication · date · headline · link, cap `EMAIL_CAPS.pressCoverage`). **Default ON**, and deliberately absent from `LEGACY_INCLUDE_EXPANSION` so a legacy coarse `marketingBrief: false` can't silently switch it off. Gated only by its toggle, with an explicit empty state, per §9's rule.

⚠️ **Adding a digest section means editing FOUR places — three of them hardcoded lists.** Missing any one renders nothing, silently:
1. `INCLUDE_KEYS` + `DEFAULT_INCLUDE` (`features/intelligence/_digest-config.js`) — `ORDERABLE_KEYS`/`DEFAULT_ORDER` derive from it automatically.
2. The `RENDER` map in `daily-digest/route.js` (the section renderer itself).
3. **The `renderGroup([...])` call for that group** (`marketSignalsSection = renderGroup([...])`). This is the one that bit: the key was in `INCLUDE_KEYS`, in `RENDER`, enabled in config, in the order — and still rendered nothing, because group membership is a separate hardcoded array.
4. The toggle rows in `components/AdminEmailModals.jsx` (also hardcoded, not generated from `INCLUDE_KEYS`).

`normalizeOrder` now inserts a key the saved order predates **next to its canonical neighbour** instead of appending it, so a new section lands beside its group (Press Coverage after Signals) rather than at the bottom of every existing client's email.

---

## 9b. Multi-client fan-out — only enrolled clients, concurrently (fixed 2026-08-13)

**The bug:** both daily crons served exactly one client — for months. Evidence: `bryan-balli-WUoltG84` had a `pre-digest-refresh` run every single day; two other clients with `schedule.enabled: true` had **never** had one (one enrolled 12 days earlier). Every `usage_event` in the 12:00–14:30 UTC cron window across 5 days belonged to that one client.

**Two causes, both fixed:**

1. **Home was prepended unconditionally.** Both routes built `clientIds = [homeClientId, ...enrolledIds]`. The send route's per-client gate (`isCronEnrolled`) meant home was never actually *mailed* when its toggle was off — but `pre-digest-refresh` had **no such gate in its loop**, so home ran a full paid scout every day regardless of its toggle, and being first it consumed the budget the enrolled clients needed. Both routes now take **enrolled clients only** (`listCronEnrolledClientIdsByStaleness`), so home appears exactly when its own toggle is on, like everyone else.
2. **Sequential fan-out under a budget smaller than one client's work.** Both loops ran clients one at a time and `break`-ed at `270_000`ms — but a single client's refresh alone exceeds that, so client #2 was never reached, and the silent `break` still returned `ok`. Both now run **bounded-concurrency waves** (`send: 4`, `refresh: 3`); each sub-request is its own invocation with its own `maxDuration`, so wall-clock is the slowest client per wave rather than the sum. `pre-digest-refresh` gained a **dispatcher mode**: with no `?clientId=` it re-enters itself once per client (the explicit-clientId path is the unchanged single-client worker).

**Observability (this is why it hid for so long).** Nothing recorded a refresh or a send anywhere. `digestConfig.stampCronRun(clientId, 'refresh'|'send', outcome)` now writes `lastCronRefreshAt/Status/Reason` + `lastCronSendAt/Status/Reason` onto `digest_config/{clientId}`. Dropped clients are stamped `skipped` and logged as an **error** (`*_budget_exhausted` with `droppedIds`), never a quiet break, and the response carries `dropped: []`. Ordering is **least-recently-served first**, so a short run rotates instead of starving the same client every day.

⚠️ Vercel Hobby retains runtime logs ~1h, so cron-time logs are gone by the time anyone investigates — the Firestore stamps are the durable record. Check those first.

⚠️ `schedule.sendHour` / `timezone` are stored, clamped, and rendered in the card but **read by nothing**. Actual send time is fixed by `vercel.json` (`0 13 * * *` UTC) and Hobby allows daily crons only, so per-client hours are not achievable as built. Either honor it or retire the input — it currently promises something the system cannot do.

---

## 10. Pre-refresh + fast send + hosted Executive Brief link (as-built)

**The goal:** scheduled refresh work finishes before the daily send, while an
interactive send remains fast and deterministic by using saved data. A preview
never spends money.

**`refreshDigestClient` pipeline** (`app/api/worker/pre-digest-refresh/route.js`):

The single exported function runs in three phases (sequential between phases; parallel within):

```
Phase 1 (parallel):
  refreshSiteCreativeModules — module run (style-guide, seo-performance, etc.) → dashboard_state.moduleBriefs
  refreshScoutBrief         — Scout-only marketing brief (~$0.10) → dashboard_state.marketingBrief.scoutBrief
  refreshWatchlist          — pull X timelines for followed handles → marketingBrief.watchlistTimelines + reportSnapshot.watchlistAnalysis

Phase 2 (parallel, needs phase-1 data):
  refreshStrategyPlan       — regenerate strategyBuilder.lastPlan (reads fresh scout)
  refreshReplyTargets       — run reply-targets recipe over {watchlistMentions, brandMentions, redditSignals, kolActivity}
                              + useFor:'copy' brain context → marketingBrief.reportSnapshot.digestRecipes

Phase 3 (sequential):
  refreshBriefSummaries     — regenerate brief cover/analysis summaries (executive-daily + onboarding brief types)
```

Failures in any scheduled refresh phase are logged and never block the eventual scheduled email,
which falls back to last-good data. The interactive **Generate & Send Email** action does not call the
refresh worker at all: it saves the current settings and immediately calls the fast send route with
`skipRefresh=1`, using the latest saved digest data and last completed video. The send route remains
strict about actual delivery prerequisites (recipient, selected rendered video, approval URL, and
connected target social account).

**Send flow** (`app/api/admin/daily-digest/route.js` GET, main `try`):
1. Resolve `homeClientId` + `digestCfg`; compute `briefClientIds = [home, ...includeClientIds]`.
2. The route never runs Scout inline. `skipRefresh=1` identifies the interactive
   fast path; scheduled sends use the latest state produced by
   `/api/worker/pre-digest-refresh`.
3. Collectors (GA4 / Vercel / Calendar / Firebase / homepage) run, gated by the group flags.
4. Briefs are fetched from saved `dashboard_state` via `getBriefForClient`.
5. **Brief link:** if `execBriefLink` on and `briefLinkMode !== 'off'`,
   `resolveExecutiveBriefUrl({clientId:home, mode, origin, allowFreshRun:!isPreview})`:
   - `mode:'fresh'` + real send → `renderMarketingBriefHtml` over the fresh `dashboard_state`
     (renderer dynamic-imported from the brief-preview route), then **publish** a public
     `clients/{cid}/custom_briefs/daily-YYYY-MM-DD` doc (`merge:true`, so a same-day re-send
     overwrites with fresh content, stable URL) + a `brief_client_slugs/{publicClientSlug}`
     alias. Returns `/briefs/{publicClientSlug}/{publicBriefSlug}`.
   - `mode:'latest'` (or a `'fresh'` preview, or a `'fresh'` publish that threw) → newest
     published brief via `getLatestPublishedBrief`.
   - `mode:'off'` → null. Any null → `buildEmailHtml` falls back to `/dashboard?open=brief`.
6. `buildEmailHtml(..., renderInclude, creative, briefUrl)` → preview returns it, send sends it.

**Why refresh is separate.** Running Scout/module refreshes inline caused
time-boxed sends and orphaned `brief_runs`. The pre-digest worker owns refresh;
the digest route owns bounded collection, rendering, approval creation, and
email delivery.

**⚠️ Gotchas for future edits:**
- **Don't re-add a reuse window / second pipeline in the resolver.** It used to run its own
  `runClientPipeline` + a 90-min publish-reuse window — that caused a today-URL with yesterday's
  content. The refresh (step 2) is now the single source of freshness; the resolver only
  renders + publishes what's already fresh.
- **Cost:** Generate & Send Email does not run Scout or module refreshes. Caption and
  fresh Executive Brief generation may still incur their existing model cost
  unless their respective settings skip those calls.
- **Auth:** publishing writes Firestore directly via the admin SDK — it does NOT call the
  admin-only `custom-briefs` POST route, so no JWT/worker-secret plumbing is needed in cron.
- **Dynamic imports of route modules** (`refreshDigestClient`, `renderMarketingBriefHtml`) are
  the established pattern here; both are wrapped so a resolution/runtime failure degrades to
  last-good data.

---

## 11. Demo (zeroed) metric groups — `demoMetrics` (as-built)

**The problem.** Four section groups are backed by **our** accounts, not by the client's own:
GA4 reads *our* property, `getFirebaseMetrics` counts *our* Firestore users/runs, Vercel reads
*our* project, and the agenda reads *the admin's* connected Google Calendar. For the home client
those are real. For every other client they are someone else's data — a leak, and confusing.

**The fix.** A per-group **demo toggle** renders the group *structurally intact but zeroed*, so
a client sees the slot and understands the data can pipe in once connected. This is a
presentation/teaser feature — it does **not** wire up per-client live data.

`digest_config/{clientId}.demoMetrics` — top-level field, **default all `false`** (home client's
email is unchanged). Registry `DEMO_METRIC_GROUPS` in `_digest-config.js`:

| Group key | Label | Demos these `include.*` sections | Collector skipped |
|---|---|---|---|
| `calendar` | Calendar Agenda | `agenda` | `getCalendarAgenda` (Google Calendar API) |
| `webPerformance` | Web Performance | `ga4Traffic · topPages · trafficSources · keyEvents · homepage` | `getGA4Metrics` + `getHomepageAnalyticsMetrics` |
| `platform` | Platform | `platformOverview · signups · dashboards · pipeline` | `getFirebaseMetrics` |
| `deployments` | Deployments | `deployments · runtimeErrors` | `getVercelMetrics` |

**How it renders.** A demo group skips its collector entirely (**no API cost**) and is fed a
`ZERO_*` fixture in the route instead of the `NEUTRAL_*` one. The key difference: `ZERO_GA4`
carries a **real zeroed `overview` object, not `null`**, so the GA4 block renders its five stat
cells at `0` rather than collapsing to prose — the "registers as 0" behavior is the point.
Each fixture sets `demo: true`, which flips every empty-state through the `emptyCopy(source,
demoMsg, realMsg)` helper in `buildEmailHtml` from *"No traffic recorded in the last 24 hours"*
(reads as a dead result) to *"Not connected yet — connect Google Analytics to see your traffic
here"* (reads as an available slot).

**⚠️ Calendar is the exception — it does NOT zero, it opens.** An empty `agenda.days` makes
`buildAgendaSection` early-return a flat one-line "No events on the calendar for the next 5
days" card, which loses the swipe strip entirely — the opposite of showing the client what the
slot gives them. So `buildDemoAgenda(timestamp)` returns the **real 5-day window** (genuine
dates, weekdays, TODAY badge) with zero events, and `demo: true` turns each day's row from
*"No events"* into *"Open"* plus a note under the strip. The client sees the full working
calendar UI with every day available. The day-window construction is shared with the real
collector via **`buildAgendaDayWindow(timestamp)`** — extracted from `getCalendarAgenda` so the
demo strip can never drift from the real one. Weather (`include.weather`, same UI group) is
**not** affected by this toggle.

**Subject line.** Built from `firebase.newUsers` / `firebase.recentRuns`. With `platform` demo
ON it zeroes automatically via `ZERO_FIREBASE` — deliberate, so a client's subject line never
quotes our internal sign-up/dashboard counts. No separate gate.

**Preview parity.** `&demo=<csv-of-on-group-keys>` (preview only), mirroring `&include=`. The
card passes `form.demoMetrics` so flipping a group previews zeroed **without saving first**.
Present-but-empty (`demo=`) = every group real; param absent = saved config.

**UI.** A demo checkbox under the four matching group headers in §03 of `AdminEmailDigestView`
(`#email-digest-demo-metrics-<groupKey>-row`). The label→config map
`DEMO_METRIC_GROUP_BY_LABEL` is **hardcoded in the component** (same reason `SECTION_GROUPS` is)
— `_digest-config.js` is CJS + server-only and must never be imported client-side. Each entry
carries its own `affects` label + `hint`, because a UI group can hold sections the toggle does
**not** touch (the "Top of email" group holds Weather alongside the Agenda), so generic
group-level copy would overstate what the checkbox does.

**⚠️ If you add a section to one of these groups**, add its key to that group's `keys` array in
`DEMO_METRIC_GROUPS` *and* give its empty-state a demo variant via `emptyCopy` — otherwise the
section renders real HITLOOP data while the rest of its group shows zeros.
