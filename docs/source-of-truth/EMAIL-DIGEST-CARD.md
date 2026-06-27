# Email Digest Card — Source of Truth

**Status:** P1 shipped · P2(b) shipped (calendar toggle migrated) · P2(a) stage 1 shipped
(config backbone + digest wiring) · P2(a) stage 2 pending (the dashboard card UI).
**Owner workstream:** normalize the Email Digest onto the Market Signals card pattern.

> **Guiding principle.** The **Market Signals card** is the reference pattern for how we
> build a brief: a control panel that toggles content on/off and produces a brief. The
> **Email Digest** must follow the same setup + run process. Its "brief" is the **email**.
> Every feature the email pulls in gets **its own card** that owns *that feature's settings*;
> the Email Digest card only owns the **include-in-email toggle + schedule** for each feature.

Related SSOT: [`MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`](MARKET-SIGNALS-AND-SCOUT-PROJECTION.md) (the pattern being mirrored),
[`CREATIVE-BRIEF-DELIVERABLES-WIRING.md`](CREATIVE-BRIEF-DELIVERABLES-WIRING.md) (the official brief standard).

---

## 1. The three-brief picture (where this fits)

```
[Market Signals card]  → produces Marketing Brief   (reference pattern)
[Creative Brief card]  → official brief standard
[Email Digest card]    → sends scheduled email + links to Executive Brief
[Executive Brief]      → aggregates Marketing + Creative + operational intelligence
```

The Email Digest is a **read-only aggregator** — it never runs the scout/scribe/guardian
pipeline. It READS finalized intelligence and renders + sends it. The scheduled email is the
delivery surface; the hosted **Executive Brief** is the full daily stand-up link opened from
the email at `/dashboard?open=brief`.

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

Source: `app/api/admin/daily-digest/route.js` `buildEmailHtml` (~line 957). Sections render
top-to-bottom. Each section maps to a **future include-toggle** in the Email Digest card.

| # | Section | Data source (collector) | Producer / origin | Toggle target |
|---|---|---|---|---|
| 1 | **Hero** (date) | — | static | always on |
| 1b | **Open Executive Brief CTA** | `/dashboard?open=brief` | hosted dashboard brief preview | always on |
| 2 | **Executive Summary** (LLM paragraph) | `generateBriefSummary` (`_brief-summary.js`) | **LLM — Haiku** (`DIGEST_SUMMARY_MODEL`, dflt `claude-haiku-4-5`) | `summaryEnabled` (exists) |
> §2 also injects the **approved Client Brain** voice when present: the digest route loads `loadClientBrainContext(homeClientId, { useFor:'emailDigest' })` and passes it to `generateBriefSummary({ clientBrainContext })`. Absent/unapproved ⇒ `''` ⇒ summary reads exactly as before. See [`docs/company-brain/`](../company-brain/).
| 3 | **Today's Agenda** (5-day calendar) | `getCalendarAgenda` → Google Calendar API | Calendar card / OAuth | `include.calendar` (NEW) |
| 4 | **Strategic Brief** (opportunities, KOLs, competitors, narratives, watchlist, posts, weather) | `getBriefForClient` → `projectBrief` (`_brief-intel.js:53`) | **Market Signals** (scout `agentData`) | `include.marketingBrief` |
| 5 | **"Happening on X"** watchlist brief | `intel.watchlistAnalysis` (`reportSnapshot.watchlistAnalysis.text`) | watchlist-pull recipe | sub-toggle of #4 |
| 4b | **Creative Brief** (attached run deliverable — cover summary + hero image) | `getCreativeBriefForClient` → `dashboard_state.briefSummaries.onboarding.summary` + `artifacts.homepageDeviceMockup`/`siteMeta.ogImage` | **Creative Brief card** (`onboarding-brief`) | `include.creativeBrief` (opt-in, **default off**) |
| 6 | **Platform Overview** stats | `getFirebaseMetrics` | Firestore counts | `include.platformStats` (NEW) |
| 7 | **GA4 Traffic / Top Pages / Sources / Key Events** | `getGA4Metrics` → GA4 API | Web Stats card | `include.webStats` (NEW) |
| 8 | **Homepage interactions** (clicks, scroll, web vitals) | `getHomepageAnalyticsMetrics` → `homepage_events` | Web Stats card | `include.webStats` (NEW) |
| 9 | **Firebase: New Sign-ups / Dashboards / Pipeline Status** | `getFirebaseMetrics` | Firestore | `include.platformStats` (NEW) |
| 10 | **Vercel Deployments / Runtime Errors** | `getVercelMetrics` → Vercel API | Vercel | `include.deployments` (NEW) |
| 11 | **Footer** | — | static | always on |

> **Preserve-analysis rule (this phase).** The existing analysis stays and becomes
> *configurable*, not removed: the LLM executive summary (#2) and the watchlist analysis (#5).
> A **later phase** expands the digest's analysis to carry **scribe tone + guardian
> feedback/QA style** — capture the current behavior now so it can be tweaked then. Do not
> rip out the Haiku summary; make it a managed knob.

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
| Run (produces brief) | Send now (`?send=1`) + scheduled cron run | ✅ |

So P1 is mostly a **UI/control-surface** job + **config extension**, not a new pipeline.

**Live toggle reflection.** The preview endpoint accepts an optional `&include=<csv-of-on-keys>`
override (preview only) so the EMAIL PREVIEW tab renders with the card's *current, even unsaved*
section toggles. `AdminEmailDigestView` reloads the template preview on each tab-switch passing
`form.include`. `include=` (empty) = all sections off; param absent = use saved config. Override
applies to both `?preview=template` and `?preview=1` (live); every section in `buildEmailHtml` is
gated by `include.*` (not by neutral data) so template + live hide identically.

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
| Email Digest card modal (the control surface) | `components/AdminEmailModals.jsx` → `AdminEmailDigestView`: **SETTINGS** tab styled with the dashboard-modal style guide (scoped `.vrk-scope` kit — `.section`/`.toggle-grid`/`.segmented`/`.field-grid`; the 6 section toggles are `.toggle-card`s, each with a **"Customize ↗"** link that opens that section's own card via `onOpenCard(cardId)` → `openCapabilityCard` — marketingBrief→`signals`, creativeBrief→`onboarding-brief`, calendar→`calendar-connect`; frequency is a `.segmented` control; "Include client briefs" is a **collapsible, default-collapsed** menu) + **EMAIL PREVIEW** tab (rendered email + Run&Send) |
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
