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

---

## 12. Incident checkpoint — 2026-08-16: silent delivery failure + cost forensics

**Trigger.** `digest_config/paradice-dbBQCHUX` recorded `lastCronSendStatus: 'failed'`,
`lastCronSendReason: 'Email provider did not return an id.'` at `2026-08-15…` and — while this
investigation was running — again at `2026-08-16T13:52:48.394Z` (refresh had succeeded at
`13:18:20.283Z`). The failure is **live and reproducing**, not a one-off. paradice is currently the
**only** client enrolled in the daily crons (`bryan-balli-WUoltG84`'s `schedule.enabled` is `false`).

### Root cause — email delivery

**Proven, from code + the stamped reason string.** `sendEmail()` (old, in
`app/api/admin/daily-digest/route.js`) threw on any non-2xx Resend response (caught by the route's
OUTER try/catch → a generic 500, a *different* failure shape) and otherwise returned `res.json()`
unchecked, with the send path only ever reading `emailResult.id` at the **top level**. Because the
stamped reason on Aug 15/16/17 is exactly `"Email provider did not return an id."` — not a thrown
Resend-4xx/5xx error string — the code path that produced it requires a genuine **HTTP 2xx** whose
JSON body parsed cleanly but carried no top-level `id`. That rules out an invalid/revoked key or a
network error as the proximate cause of *this specific logged failure*.

**Inference, not proof.** The exact response body shape is unknown — Vercel Hobby's ~1h log
retention means it is gone, and no live/authorized test send has been run to reproduce it. A nested
`data.id` (Resend's own batch-endpoint shape) is a *plausible* candidate the fix defensively
accepts, but it is **not confirmed** as what actually happened. Do not cite it as proven.

**Timeline correction (caught in review, 2026-08-17).** Commit `fdc1740e` ("fix(digest): require
accepted email for cron send success", 2026-08-14 12:49, a parallel session) **introduced** the
exact string `"Email provider did not return an id."` and changed the cron-send success condition
to require `Boolean(emailId)`. **Before that commit, an id-less send reported `ok: true`** — i.e.
whatever response-shape issue is causing this had no way to be observed or stamped as a failure
before Aug 14. It is therefore an open question, not resolved in this pass, whether the underlying
delivery problem predates Aug 14 and was silently counted as a success the whole time. Do not
assume Aug 15 was the first occurrence.

**What is not in question**, regardless of the exact historical response shape: the old system's
single failure mode was **silently discard a possibly-accepted send with no retry, no persisted
record, and no signal beyond an hour-lived log line.** §12b's durable delivery system fixes that
failure mode itself — it does not require knowing the exact historical body shape to be correct.

### Root cause — cost (Aug 12 $3.53 / Aug 13 $2.28 spike)

Verified against the Anthropic Admin `cost_report` API (`ANTHROPIC_ADMIN_KEY` present) — the
official Aug 2–14 total is **exactly $16.02**, matching the daily figures cited in this incident's
brief 1-for-1. Breaking the spend down by **API key id** (via the `usage_report/messages`
`group_by[]=api_key_id`, which `cost_report` itself does not support) shows a **second, distinct**
key — `"Human in the Loop"` — active **only** on Aug 12–13 (486k input / 94k output tokens, ~$2.54
of the two days' $5.81 combined total, ~44%). Every other day in the window ran entirely on the
production key ("CQ-Marketing-2"). This is direct evidence the Opus session's local/manual work used
a **different API key** than the deployed app — confirming the mission's hypothesis that the session
was a **partial** explanation, not a purely systemic one.

The **remaining, production-key** share of Aug 12–13 (~$1.51 and ~$1.75 vs. an ~$0.73–1.08/day
baseline for Aug 1–11) is *also* attributable to the same testing window, not a separate systemic
bug: `clients/bryan-balli-WUoltG84/brief_runs` shows the home client's `pre-digest-refresh` running
**twice** on Aug 12 (06:16 UTC and 12:52 UTC — only the second is the scheduled `35 12 * * *` cron),
and `usage_events` shows the **same** `reddit-analysis` → `reply-targets` → `brief-summarizer` block
firing 2–3 times for the same client within a few hours on both days (e.g. paradice at 13:41, 18:08,
and 18:44 UTC on Aug 13 — the 18:43 `brief_runs` doc is stamped `source: 'manual-admin'`). Net: the
Aug 12–13 spike is **fully accounted for** by manual/duplicate refreshes during the development
session, not a hidden always-on cost.

**Internal cost-tracking coverage.** `usage_events` + `brief_runs.providerUsage.stageCosts` combined
total **$6.42** for the Aug 2–14 window against the **$16.02** official total — **40.0% coverage**.
The ~60% gap is Anthropic spend that reaches neither ledger (uninstrumented call sites; some of it
is also the "Human in the Loop"-key traffic, which — if it was raw interactive/tooling usage rather
than app code — could never write to either ledger by construction). This gap is **not** specific to
Aug 12–13; it is a standing, every-day under-report on the Operating Cost card and is called out here
as a finding, not fixed in this pass (full instrumentation of every remaining call site is a
separate, larger workstream).

**Web search cadence.** `usage.server_tool_use.web_search_requests` is a stable **~6/day** even
during the low-cost Aug 14–16 period — this is a fixed number of web-search-enabled calls in the
pipeline that always runs (not random/report noise). `scout-intake/scout-search-surcharge` in
`usage_events` (~$0.03/occurrence = 3 searches × $0.01) accounts for half of it per scout-brief run;
the other ~3/day were not traced to a specific call site in this pass — flagged for the next cost
pass rather than guessed at here.

### What shipped (first pass, 2026-08-16) — since hardened, see §12b

The first pass built durable delivery + a circuit breaker, but a review before deploy (§12b) found
three P1 correctness gaps: no real sub-daily retry wake-up, a non-atomic refresh lock, and a
same-UTC-day delivery identity that could regress an already-sent record. **§12b is the
authoritative current state.** The modules below are the same four files, now hardened; treat this
table as "what exists," and §12b as "how it actually behaves."

| File | Purpose |
|---|---|
| `api/_lib/resend-transport.cjs` | Pure response classifier (`classifyResendResponse`) + `sendViaResend`. Accepts a top-level **or nested `data.id`** (a defensive, unconfirmed-but-safe hypothesis — see the root-cause correction above); classifies every other 2xx-without-id as a *retryable* `malformed-2xx`, 400/401/403/404/422 as permanent, 429/5xx/network as retryable, and splits Resend's own 409 idempotency errors (verified against Resend's docs) into `concurrent_idempotent_requests` (retryable) vs. `invalid_idempotent_request` (permanent — a payload-mismatch bug signal). Deterministic `Idempotency-Key` header on every call; every classified result carries `responseKeys` (KEYS only, never values) for observability. |
| `api/_lib/digest-delivery.cjs` | Durable delivery records in `digest_deliveries/{deliveryId}`. See §12b for the corrected identity model, atomic claim/lock transactions, and retention. |
| `api/_lib/digest-circuit-breaker.cjs` | Per-client consecutive-**delivery**-failure counter on `digest_config/{clientId}.deliveryBreaker` (separate field from `schedule`, never mutated by the breaker). Trips at 3 consecutive terminal failures, pausing new paid refreshes; `resetBreaker` is an explicit, separately-called action. Unchanged by §12b. |
| `api/_lib/digest-refresh-preflight.cjs` | The one gate every paid refresh passes through: global kill switch → `RESEND_API_KEY` presence → per-client breaker → (§12b addition) no unresolved OLDER delivery for this client. Fails closed on its own (internal try/catch per check) — callers don't need a wrapping `.catch()`. Blocks before any Scout/LLM call, never blocks a retry of already-stored content. |

---

## 12b. P1 hardening pass — 2026-08-17 (review before deploy)

A review of the §12 patch against production evidence (paradice's delivery failing a **third**
consecutive day, 2026-08-17, identical reason string) found three P1 correctness gaps that had to
be fixed before this could deploy. All three are fixed, tested, and described below.

### P1-A: retry wake-up was not real

**The gap.** `nextRetryAt` used a 2m→3h backoff, but `sweepDueRetries()` was only ever called from
the once-daily fan-out cron — so a "2-minute" retry could wait up to ~24h. Combined with Resend's
**24-hour** idempotency-key validity (verified against Resend's own docs, 2026-08-17: `Idempotency-
Key` header, honored 24h, a replay with an unchanged payload returns the original id, a replay with
a *changed* payload 409s `invalid_idempotent_request`), a retry delayed close to 24h risks reusing
an **expired** key — which Resend then treats as an unrelated new send, a real duplicate-email risk.

**The fix — three layers, all real, none imaginary:**
1. **`app/api/worker/digest-delivery-sweep/route.js`** (new route) — authenticated (`CRON_SECRET` or
   `WORKER_SECRET`, same fail-closed pattern as every other worker route), bounded (`limit`, default
   10), does nothing but `sweepDueRetries()` — no Anthropic, Scout, X search, or renderer dependency
   exists in its call chain.
2. **`.github/workflows/digest-delivery-sweep.yml`** (new, **uncommitted**) — mirrors the already-
   live `.github/workflows/brief-worker-sweep.yml` exactly (same `HITLOOP_CRON_SECRET` repo secret,
   same `*/5 * * * *` schedule) targeting the new route. This is the established, already-working
   answer to "Vercel Hobby can't do sub-daily crons" in this exact repo — `run-brief` already uses
   it. **Not active**: taking effect requires committing + pushing this file to the default branch,
   which this session is not authorized to do. See the runbook (§12c) for the exact activation step.
3. **Opportunistic sweep on admin GET** — `app/api/admin/digest-config/route.js`'s main `GET`
   (loaded whenever the Email Digest card opens) now also calls a bounded (`limit: 5`) sweep before
   returning. Not a substitute for #2, but genuinely helps: an incident is most likely being
   actively investigated exactly when someone has the card open.
4. **Idempotency safety margin** — `recordSendAttempt` now refuses a further automatic retry once a
   delivery's *first* attempt is more than `IDEMPOTENCY_SAFETY_MARGIN_MS` (20h) old, going straight
   to `terminal-failure` instead of scheduling a retry that might reuse an expired key. This is the
   honest fallback for the case where even the pinger is down and only the daily cron remains.

**What is still true and documented, not hidden:** without the GitHub Actions pinger active, the
*only* guaranteed wake-up is the daily cron (~24h). The system now behaves correctly under that
constraint (the safety margin prevents a duplicate-send risk) rather than silently assuming a
cadence it cannot deliver.

### P1-B: refresh-lock acquisition was not atomic

**The gap.** `acquireRefreshLock` was read-then-write (two separate calls), so two concurrent
callers could both observe "unlocked" and both start a paid Scout run.

**The fix.** `acquireRefreshLock`/`releaseRefreshLock` now run inside `fb.adminDb.runTransaction`,
with a per-acquisition fencing token (`ownerId`). `releaseRefreshLock(deliveryId, ownerId)` only
clears the lock if `ownerId` still matches the current holder — an old/slow invocation can never
clear a newer owner's lock. Both **fail closed**: a transaction/read error returns
`{ acquired: false }`, never a fallback `true`. The exact same transactional-claim pattern
(`claimForSend`) now also gates the **send** step itself (a related bug the first pass introduced:
its "claim" used a plain `markStage` call, not a transaction — fixed in the same pass). Tested with
real concurrent `Promise.all` races against the fake-Firestore harness (whose `runTransaction` is
fully serialized — the established pattern in this repo, see `fake-firestore.cjs`'s own comment, for
deterministically proving "exactly one wins" under a concurrent `Promise.all`) and an explicit
stale-lock-takeover / fencing test.

### P1-C: same-day delivery identity could regress an already-sent record

**The gap.** Delivery id was `clientId + UTC day`. A second manual "Generate & Send" the same day
could retrieve the SAME record — including one already `sent` or `retry-wait` — and (in the first
pass) risked overwriting its stored HTML or resending under a stale idempotency key.

**The fix — `resolveDeliveryIdentity`:**
- Identity now uses the **client's own configured digest timezone** (`digest_config.schedule.
  timezone`, default `America/Chicago`) via `localDateKey()` (`Intl.DateTimeFormat`, correct across
  DST boundaries by construction — tested against both the 2026-03-08 spring-forward and 2026-11-01
  fall-back transitions), not UTC. "Today" now means what the client's own send-time expectation
  means.
- The **scheduled cron** always targets exactly one record per client per local day —
  `clientId__dateKey` — idempotent no matter how many times it's invoked (tested).
- A **manual send** targets that same primary record for the FIRST attempt of the day. Once that
  record has progressed past `scheduled` (i.e. anything has actually been rendered), a second manual
  send gets its **own, immutable, new attempt id** (`clientId__dateKey__manual-{ts}`) — two records,
  two independent provider calls, the first one completely untouched (tested).
- **Immutability, enforced twice:** `storeRenderedHtml` is a no-op once a delivery already has
  stored content (now via a transaction, closing a residual race between two near-simultaneous
  callers for the same id) — the html/subject/recipient/idempotency-key snapshot is fixed forever
  once persisted. `markStage` enforces an explicit stage-transition graph (`ALLOWED_TRANSITIONS`) —
  `sent` has zero outgoing edges (can never regress), `terminal-failure` permits exactly one edge
  back to `sending` (an explicit manual retry only; the automated sweep never even queries
  `terminal-failure` records). Both are directly tested, including a specific "illegal jump"
  regression test.
- An explicit `requestedDeliveryId` (the admin "Retry delivery" action) always wins identity
  resolution — a retry never mints new content or a new id, by construction.

### Spending protections (confirmed intact / added)

- `checkDigestRefreshPreflight` **fails closed by construction** now — every check (kill switch,
  breaker read, unresolved-prior-delivery scan) is individually try/caught inside the function
  itself, so a Firestore read error blocks paid work without relying on caller discipline. Tested by
  simulating a broken Firestore context.
- **New: unresolved-delivery guard.** `hasUnresolvedPriorDelivery(clientId, {excludeDeliveryId})`
  — if any other delivery for this client is still `retry-wait` or holding a live `sending` lease,
  a new paid refresh is blocked (never piling another paid-but-undelivered run on top of a backlog).
  The optional exclusion is an exact delivery id, never a date-wide exclusion that could hide a
  separate failed manual attempt from the same day. Production paid-refresh paths require no
  exclusion because their current pre-send record is not unresolved yet. An explicit
  `allowUnresolvedPrior` override exists in the function signature for a future deliberate admin
  action — nothing in this repo sets it automatically today.
- `DIGEST_REFRESH_KILL_SWITCH` (env, `.env.example`) remains separate from every per-client
  `schedule.enabled`/`deliveryBreaker` state, as required.
- `digest_config.dailyXSearch` (Critters' daily X brand search, currently `true`) is **untouched** —
  still correctly gated to the cron only when explicitly opted in per client; its spend remains
  invisible to the Operating Cost card (X API), called out here rather than silently left undocumented.
- **`force=1` Generate & Send (commit `563c8126`, 2026-08-13) is *not* reverted** — that decision
  belongs to the client-side `runAndSend` in `components/AdminEmailModals.jsx`, which is out of this
  session's granted scope (preserve-everything-else). What changed instead, server-side: `force=1`
  can no longer bypass the refresh-lock (P1-B, now atomic) or the unresolved-prior-delivery guard —
  so a rapid double-click or a send racing an in-flight retry backlog can no longer trigger two
  concurrent paid Scout runs, even under `force=1`. A deeper fix (only forcing when genuinely
  requested, not on every click) requires the client file and is flagged, not made, here.

### Retention

`digest_deliveries` records + their Storage HTML are **not** auto-purged by any cron in this pass.
`listDeliveriesOlderThan(cutoffMs)` / `purgeDeliveriesOlderThan(cutoffMs)` exist, are tested (only
fully-resolved `sent`/`terminal-failure` records past `DEFAULT_RETENTION_MS` — 14 days — are ever
eligible; a still-`retry-wait` record is never purged regardless of age), and are callable ad hoc.
Wiring a cron for this is a follow-up, not done here (Hobby cron budget is already tight — see
`VERCEL-HOBBY-DEPLOYMENT.md`).

### Tests

70 tests across the four modules (was 41 in the first pass) — added: 3 atomic-concurrency tests
(`claimForSend`/`acquireRefreshLock`/`storeRenderedHtml` each proven "exactly one/consistent winner"
under a real concurrent `Promise.all`), a fencing test (stale owner cannot release a replacement
lock), timezone/DST identity tests (including the two 2026 US transition dates), same-day
manual-vs-scheduled identity tests, stage-transition-graph regression tests, fail-closed tests
(simulated Firestore outages for both the breaker and the delivery scan), the idempotency
safety-margin test, retention selection/purge tests, and 409-semantics tests. **Full suite: 2614
passing** (was 2585 before this pass, 2544 baseline before the incident work began). `npm run build`
succeeds; `.vercel/output/functions` stays at **10** (the new sweep route bundled in without adding
a function group). `git diff --check` clean.

### Adversarial self-review — found and fixed during this pass (not just claimed)

- The first pass's send "claim" used a plain `markStage` call, not a transaction — a real
  concurrency bug in the exact class the review was checking for. Fixed with `claimForSend`
  (transactional), verified by a 3-way concurrent race test that initially caught it (all 3 callers
  sent before the fix; exactly 1 did after).
- `acquireRefreshLock`/`releaseRefreshLock` read `fb.adminDb.collection(...)` OUTSIDE their own
  try/catch, so a broken Firestore context threw past the fail-closed guard instead of being caught
  by it. Fixed by moving the read inside the try block; verified by a simulated-outage test.
- `pre-digest-refresh/route.js`'s preflight step silently continued to paid work if
  `getOrCreateDelivery` itself failed (`.catch(() => null)`, then only conditionally marking
  `refreshing`). Fixed to fail closed and return the preflight-blocked shape instead.
- `listDueRetries`'s Firestore query had no cap before its in-memory filter/slice — an unbounded
  read pattern. Added a defensive `DUE_RETRY_SCAN_CAP` (200) independent of the caller's processing
  `limit`.
- `storeRenderedHtml` was still a plain read-then-write, leaving the exact class of race the other
  fixes closed open for the render step specifically. Upgraded to the same transactional pattern
  (Storage upload first — harmless if duplicated with identical bytes — then a transaction decides
  which write wins the Firestore record, which is what's actually sent).

**Consciously accepted, not fixed:** the intermediate bookkeeping `markStage` calls for
`refreshing`/`generated` (as opposed to the send-claim and the render-store) remain plain
read-then-write. These are monotonic, forward-only per the transition graph, and a race between two
such calls produces at worst a harmless redundant write of the same target stage — not corruption,
not a duplicate send, not duplicate spend. Upgrading every stage transition to a transaction was
judged disproportionate to the residual risk given the actual traffic pattern (one client, one
digest per day); flagged here rather than silently left unexamined.

## 12d. Second review pass — 2026-08-17 (four more correctness gaps, all fixed)

A code review of §12b's patch — independently verified against the actual code, not taken on
faith — found four more gaps that had to be closed before deploy. All four are fixed, tested, and
described below. `digest-delivery.cjs` is now on its **third** pass.

### P1-1: a crashed sender was PERMANENTLY stuck in `sending`

**The gap.** The sweep only ever queried `stage == 'retry-wait'`. A process killed after
`claimForSend` but before `recordSendAttempt` (crash, OOM, a Vercel function hitting its
`maxDuration` ceiling) left the record in `sending` forever — the sweep never saw it, AND
`hasUnresolvedPriorDelivery` counted `sending` as unresolved unconditionally, so that client's
paid refresh was blocked forever too. A genuine two-way permanent deadlock from a single crash.

**The fix — a real send lease.** `claimForSend` now writes `sendLeaseOwner` + `sendLeaseExpiresAt`
atomically in the SAME transaction as the claim. A `sending` record is claimable again once its
lease has **expired** — the sweep reclaims it under a **new** lease owner, reusing the exact same
immutable `idempotencyKey` (safe: Resend dedupes within its 24h key window, §12b). A **live**
lease is never claimable — that is what stops two callers from ever sending the same delivery
twice; this is the same concurrency fence as before, just extended to cover reclaim.

**Lease TTL: 6 minutes**, chosen against the ACTUAL deployed `maxDuration` of every route that can
hold a `sending` claim — `app/api/admin/daily-digest` (300s) and
`app/api/worker/digest-delivery-sweep` (120s). 300s is the longest the platform itself will let a
legitimate send run before force-killing the function; `sendViaResend`'s own fetch times out at
15s, so a healthy send resolves in well under a minute in practice. 6 minutes is comfortably
longer than that 300s worst-case ceiling — a lease can never be falsely reclaimed out from under a
send the platform itself is still willing to let run — while staying short enough that a genuinely
crashed sender is recovered within about one external-pinger cycle (6 min + up to 5 min until the
next sweep tick ≈ 11 min worst case), nowhere near the 24h Resend boundary.

### P1-2: manual-send idempotency was incomplete

**The gap.** A manual attempt id was `${clientId}__${dateKey}__manual-${Date.now()}}` — wall-clock
time, not a stable per-action key. A resubmission after a perceived timeout would mint a brand-new
id and send a second email; two concurrent "first sends of the day" (the old identity rule reused
the primary occurrence for the first manual send) could silently collapse into one, losing a send.

**The fix.** Two parts, one server + one client (client scope explicitly granted for this fix):
- **`components/AdminEmailModals.jsx`** — `runAndSend` now generates a `requestId`
  (`crypto.randomUUID()`, with a fallback) ONCE per click and holds it in the closure across the
  whole task, including the final send call (`&requestId=…`). A genuinely new click always mints a
  fresh id; nothing in this codebase currently retries the SAME `authFetch` call automatically, but
  the id is generated *before* any such call so it is structurally correct for any retry pattern,
  present or future. Diff is 11 lines, scoped to exactly this — the file's other, unrelated
  parallel-session content is untouched.
- **`api/_lib/digest-delivery.cjs`** — `resolveDeliveryIdentity` no longer has a "first manual send
  reuses the primary occurrence" branch at all. A manual send **never** shares identity with the
  scheduled cron's own record, full stop, and its id is derived **deterministically** from the
  sanitized `requestId` (never from wall-clock time) whenever one is supplied — falling back to a
  timestamp only when a caller doesn't pass one (a known, documented, non-ideal compatibility path,
  not eliminated for hypothetical future callers, but no longer hit by the one real caller in this
  codebase). Consequence: the SAME requestId resubmitted resolves to the SAME record (idempotent,
  one email); two DIFFERENT requestIds — even genuinely concurrent ones — always get two distinct
  records (never a silent collapse).

### P1-3: the spending guard could miss unresolved deliveries

**The gap.** `hasUnresolvedPriorDelivery` did `.where('clientId','==',c).limit(20)` with no
`orderBy` — Firestore's return order for that shape is unspecified, so once a client passed 20
delivery records a genuinely unresolved one could fall outside the window and get missed, letting
another paid refresh proceed underneath a real backlog.

**The fix — denormalized, not sampled.** A new tiny per-client companion doc,
`digest_client_delivery_state/{clientId}`, tracks exactly which deliveries are currently
unresolved (`{ [deliveryId]: { dateKey, kind: 'sending'|'retry-wait', leaseExpiresAt } }`),
maintained **transactionally**, in the same transaction as the delivery doc's own stage write,
every time a delivery enters or leaves an unresolved state (`claimForSend` for entering `sending`;
`recordSendAttempt` — via the new `writeStageTransactional` helper — for entering `retry-wait` or
leaving to `sent`/`terminal-failure`). `hasUnresolvedPriorDelivery` is now a **single document
read by clientId** — O(1), exact, no query, no sampling, no index of any kind. The time-dependent
half of P1-1 (an expired `sending` lease stops blocking) is evaluated at READ time against the
stored `leaseExpiresAt`, so it's correct even before anything has gotten around to reclaiming it.

### P2-4: due retries could starve

**The gap.** The sweep applied its scan cap (`.limit(200)`) BEFORE sorting by `nextRetryAt`
client-side — the cap could select an arbitrary page, so genuinely-oldest work outside that page
might never be seen while newer work kept getting picked.

**The fix — server-side ordering, no composite index.** A denormalized `dueSortKey` field:
`nextRetryAt` while `retry-wait`, `sendLeaseExpiresAt` while freshly claimed `sending`, `null` for
every other stage. `listDueWork` is now `where('dueSortKey','<=',now).orderBy('dueSortKey')` — an
inequality filter and an `orderBy` on the exact SAME field, which Firestore serves off the
automatic single-field index. **No composite index is required or introduced** — verified against
this repo's no-new-composite-index rule (the site-recreate SSOT's known-gap precedent). The
database itself now returns the oldest-due `limit` rows directly; starvation is impossible by
construction, not by assuming a small collection. (`api/_lib/__tests__/fake-firestore.cjs` gained
range-operator support — `<`,`<=`,`>`,`>=` — to test this; verified against all 249 pre-existing
tests in every OTHER suite that shares this fixture, all still passing unchanged.)

### Adversarial self-review, round 3 — found and fixed

- **Any other stage that can wedge with no recovery path?** Yes — `scheduled`/`refreshing`/
  `generated`/`delivery-pending` carry no lease and no `dueSortKey`; if a route crashed before
  reaching a lease-tracked or terminal stage, the record would sit as an orphaned doc forever (not
  an *active* deadlock like P1-1 — the transition graph still lets a LATER legitimate call move it
  forward — but never cleaned up). Fixed: `listDeliveriesOlderThan`/`purgeDelivery` now also reap
  these "abandoned bookkeeping" stages past the retention cutoff (14 days — far longer than any
  legitimate refresh/render cycle). `sending` and `retry-wait` are explicitly excluded from this —
  they have their own lease/backoff-based recovery and must never be swept by age alone.
- **Any other sampled/unordered query used for a correctness decision?** `listDeliveriesOlderThan`
  itself (`.limit(500)`, no orderBy) is still a capped, unordered scan — but it backs a HOUSEKEEPING
  decision (retention purge), not a spend-gating one: missing an eligible old record under the cap
  just means it's caught on a later purge pass, never silently wrong. Judged a different severity
  class than P1-3/P2-4 and left as is; called out here rather than left unexamined.
- **Any other identity derived from wall-clock time?** The manual-attempt fallback path (no
  `requestId` supplied) still uses `Date.now()` — a known, documented, unresolved gap for any
  future caller that doesn't pass a requestId (the one real caller now always does). Fencing
  tokens (`ownerId`, `sendLeaseOwner`) also mix in wall-clock time, but that's the CORRECT use —
  they need uniqueness, never determinism.
- **Any newly introduced composite-index requirement?** Audited every `.where()` call added or
  touched this pass. Only one: `dueSortKey <= now` + `orderBy('dueSortKey')` — single-field range +
  orderBy on the SAME field, index-free by Firestore's own documented behavior. Nothing else in
  this pass adds a query at all (`hasUnresolvedPriorDelivery` removed its query entirely in favor
  of a single-doc read).
- **Breaker bookkeeping is atomic with delivery resolution.** A `sent` or `terminal-failure`
  transition, its per-client breaker update, and removal from the unresolved companion document
  now commit in one Firestore transaction. If that transaction fails, the delivery remains
  `sending` under its recoverable lease and paid refresh remains blocked. Breaker increments also
  use transactional read-modify-write semantics, so concurrent terminal failures cannot lose an
  increment. Production routes no longer swallow separate post-send breaker writes because there
  is no separate write to lose.
- **Send outcome writes are lease-fenced.** The owner token returned by `claimForSend` is carried
  through the transport attempt and verified again inside the terminal/retry transaction. A stale
  sender returning after another worker reclaimed its expired lease cannot overwrite the current
  owner's result or alter the breaker.

### Tests

**Focused delivery/breaker/preflight/transport suite: 80 passing.** The final correction adds
regressions proving a superseded lease owner cannot write a late outcome, terminal delivery and
breaker bookkeeping commit atomically or neither does, concurrent terminal failures cannot lose a
breaker increment, and exact-delivery exclusion never hides a separate same-day attempt.
**Full suite: 2624 passing** (was 2620 after the previous correction, 2614 after §12b, 2585 after
§12, 2544 baseline before the incident). `npm run build` succeeds. Deployed-function count verified the precise way (grouping
`.vc-config.json` by runtime/maxDuration/architecture, not just counting raw `.func` dirs): **5 API
bundles, 3 duration classes (120/180/300), unchanged from this repo's documented baseline** — the
new sweep route bundled into the existing 120s tier, adding no new function or duration class.
`git diff --check` clean.

### 12c. Controlled live-test runbook — PREPARED ONLY, NOT EXECUTED

To be run only after explicit approval, in this order:
1. **Guard paid generation**: set `DIGEST_REFRESH_KILL_SWITCH=1` in the target environment (or
   verify the breaker is intentionally paused for the test client) so the live test cannot trigger
   any Scout/LLM spend.
2. **Send one already-rendered test email** to `bryanballi@gmail.com`: use the admin
   `POST /api/admin/digest-config {action:'retry-delivery', clientId, dateKey}` against a delivery
   whose HTML was already generated by a prior real run (or a preview-only render manually stored
   via `storeRenderedHtml` in a one-off admin script) — never a fresh `Generate & Send`, since that
   would spend money and is blocked by step 1 anyway.
3. **Capture sanitized HTTP status + response shape**: read the delivery's `attemptLog[]` entry
   written by this attempt (`httpStatus`, `responseKeys`, `errorCode` if any) — never log the raw
   body, the Resend key, or the email content.
4. **Confirm provider id**: `delivery.providerEmailId` must be a real, non-empty string.
5. **Confirm inbox receipt**: manually check `bryanballi@gmail.com`.
6. **Retry the same delivery** (`action:'retry-delivery'` again on the same id) and confirm via
   `attemptLog` that Resend either returns the SAME id (same payload, same key, safe replay) or the
   call is a no-op (`alreadySent: true`) — never a second distinct id.
7. **Confirm zero Anthropic/Scout usage during the retry**: check `usage_events` for the test
   client — no new rows should appear from step 6 (the retry path has no such dependency by
   construction, but this step catches wiring drift).
8. **Confirm the production record reflects `sent`**: read the delivery via
   `GET /api/admin/digest-config?action=delivery-status&clientId=…`.
9. Unset `DIGEST_REFRESH_KILL_SWITCH` (or leave the breaker as it was) once the test is verified —
   never leave the kill switch on by accident.

### Verification status — unchanged: NOT yet run against live production

`CRON_SECRET` is absent from `.env.local`, so this session could not authenticate against the
deployed worker routes to observe a real end-to-end run. No real Resend call was made (would
require spend/side-effect approval this session was not authorized to give). Nothing was staged,
committed, pushed, deployed, rotated, or emailed at any point in this pass either.

**Unresolved / requires approval before closing:**
1. Run the §12c runbook (needs explicit approval — it sends one real email).
2. Confirm the real Resend response shape for this account (§12c's step 3 output, over enough real
   attempts, would finally answer this — currently still an inference, see the corrected root-cause
   section above).
3. Commit + push `.github/workflows/digest-delivery-sweep.yml` and confirm `HITLOOP_CRON_SECRET`
   matches production `CRON_SECRET` — without this, the ONLY wake-up is the ~24h daily cron.
4. Close the ~60% internal cost-tracking gap (separate, larger workstream, unchanged from §12).
5. Trace the remaining ~3 of the ~6 daily web_search calls to their exact call site (unchanged from §12).
6. Build dashboard UI for `delivery-status`/`retry-delivery`/`reset-breaker` (still API-only).
7. Decide whether `bryan-balli-WUoltG84` should re-enroll (unchanged from §12).
8. Investigate whether this failure predates Aug 14 (see the timeline correction above) — was it
   silently reported as `ok: true` for an unknown period before that commit?
9. Consider whether `force=1` on every Generate & Send click should become conditional
   (client-side change, out of this session's scope — see "Spending protections" above).
10. (§12d) The manual-attempt id's `Date.now()` fallback (no `requestId` supplied) is documented,
    not eliminated — only the one real caller (`AdminEmailModals.jsx`) is fixed. Any future manual-
    send caller must be checked to confirm it also passes `requestId`.
11. (§12d) `listDeliveriesOlderThan`'s own scan (`.limit(500)`, unordered) could still miss an
    eligible-for-purge record in an extreme backlog — self-correcting on a later pass, judged
    low-severity (housekeeping, not spend-gating), not fixed this round.
12. (§12d) If `digestBreaker.recordDeliveryOutcome` itself persistently fails to write (e.g. a
    sustained `digest_config` write outage), the breaker would never trip even after repeated real
    delivery failures — flagged, not fixed.
