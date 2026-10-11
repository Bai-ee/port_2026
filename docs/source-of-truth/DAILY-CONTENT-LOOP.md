# Daily Content Loop — runbook (as-built)

Status: prototype, owner account only. Build plan: `docs/plans/DAILY-CONTENT-LOOP-PROTOTYPE-BUILD-PLAN.md`; product intent: `docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md`. Where this file and the plans disagree about what exists today, this file wins.

## What it does

Answers one question: which current X conversations are gaining momentum, which fit the brand, and what content already owned can contribute something useful. Flow: inputs → conversation shortlist → momentum + brand-fit → owned-content match → grounded draft → checks → human review → **save once as an unscheduled draft**.

Up to 3 suggestions per run (`MAX_SUGGESTIONS`) is a review limit, not a quota; fewer is a valid result. **The loop cannot post or schedule.** The only queue write is Save Draft: one `social_posts` row (`status:'draft'`, `scheduledAt:null`, `sourceRef.kind:'daily-loop'`) via `createDraftPostOnce` (derived id + `ref.create`, so a double save yields one row). Gated to `OWNER_CLIENT_IDS` (`bryan-balli-WUoltG84`); any other client gets 403.

## Inputs (every run lists each with status and age, first in the output)

| Input | Lives in | Produced by |
|---|---|---|
| Watchlist scan | `dashboard_state/{client}.marketingBrief.quoteTargets` | `scripts/x-content/scan-quote-targets.mjs` (local `bird`) |
| Brand-topic search | `dashboard_state/{client}.marketingBrief.conversationSearch` | `daily-run.mjs --discover --write` (local `bird`) |
| Content library | `x_content_packages` (global). Default = verified demo set `features/x-content-inventory/daily-loop-demo-set.json` (31 items) | the content inventory |
| Client Brain | `clients/{client}/client_brain/current` | Client Brain card; **only `status:'approved'` is used** |
| Strategy Builder plan | `dashboard_state/{client}.strategyBuilder.lastPlan` | Strategy Builder; excluded with a reason when it does not cover today |
| Own history / benchmark | `docs/audits/bai-ee-x-corpus.json`, `seb-design-x-corpus.json` | committed corpora; benchmark is computed on the fly and labelled so |

Runs are stored in `x_content_daily_runs/{client}__{localDate}__x__v{LOOP_VERSION}` — one doc per local day (America/Chicago).

## Commands

All from the repo root. `--client` must be the owner id except for `--replay`.

```text
node scripts/x-content/daily-run.mjs --replay features/x-content-inventory/__tests__/fixtures/daily-loop-replay.json
node scripts/x-content/daily-run.mjs --client <id> --discover [--write] [--queries N]
node scripts/x-content/daily-run.mjs --client <id> --execute [--library full|demo] [--set ids.json] [--force] [--draft-with-model]
node scripts/x-content/daily-run.mjs --client <id> --show [--json]
node scripts/x-content/daily-run.mjs --client <id> --edit <suggestionId> --text "working copy"   # --text "" clears
node scripts/x-content/daily-run.mjs --client <id> --save <suggestionId> [--text "copy"]
node scripts/x-content/daily-run.mjs --client <id> --dismiss <suggestionId>
scripts/x-content/daily-loop-local.sh <id>              # scan → discover → execute, logged
scripts/x-content/install-scan-schedule.sh install-daily-loop <id> [--install]   # dry run unless --install
```

- `--replay` runs entirely in memory on a fixture: `inputSource:'fixture'`, no Firestore, no `bird`.
- `--library` defaults to `demo` (same as the dashboard route); `--set` overrides both. `--discover` builds its queries from the same item set.
- Dashboard: Content Engine card → **Today** tab, `POST /api/dashboard/quote-targets` actions `daily-run-latest|generate|edit|save-draft|dismiss`. The panel has not been walkthrough-verified.

## Daily automation (optional, NOT installed by default)

`daily-loop-local.sh` runs the three steps in order, always attempting all of them: a failed scan does not stop discover/execute (the run then shows the stale scan in INPUTS). Exit is non-zero if any step failed. Log: `~/Library/Logs/hitloop-daily-loop.log` (timestamped START/OK/FAIL per step). It never passes `--draft-with-model`.

`install-daily-loop` writes a separate launchd job (`com.hitloop.x-daily-loop`, 06:45 in the Mac's local zone — America/Chicago only while the Mac is on Central time). Without `--install` it only prints the plist. Companion: `uninstall-daily-loop`, `status-daily-loop`. The existing 06:30 scan job is untouched; with both installed the scan runs twice (harmless). A sleeping Mac runs the job at next wake; a missed day shows as stale inputs or no run. Not yet soak-tested.

## Cost

| Action | Cost |
|---|---|
| `--replay`, `--show`, `--edit`, `--save`, `--dismiss`, dashboard Today tab | free (Firestore reads/writes only) |
| scan, `--discover` (local `bird`) | free; no X API, no ScrapeCreators |
| `--execute` (fallback copy) | free |
| `--execute --draft-with-model` / dashboard "Use model copy" | **paid**: one Anthropic call per suggestion (≤3), `claude-sonnet-4-6`, logged via `logAnthropicCall` → Operating Cost card |
| X API | never called by the loop |

## Traps

- **`bird` is local-only.** It uses this Mac's x.com browser cookies; scan and discover cannot run on Vercel. `--discover` spawns it; paced 3s apart.
- **Worker routes run unauthenticated locally** (`CRON_SECRET` unset). Never curl `/api/worker/*` to test the loop.
- **Demo set vs full library.** Default is the 31 mechanically verified items. `--library full` reads all ~4k, including NAS flyers whose printed facts are not OCR-verified.
- **Brain must be approved to shape voice.** A draft/unapproved Brain is shown as a gap and used for nothing.
- **Fixture vs live.** Check `inputSource` (and `copySource: model|fallback|mixed`) on the run. Older docs carry only `mode`, which conflated the two. Never read a fixture replay as real data.
- Facts-tier items (Discogs, rendered mixes) are drafted with no memory/attendance claims; only real stories may use first person.
- Reply type is only proposed inside the 6h window; older conversations get quote/original.
- Save Draft refuses text blocked by the content guard; an edit is re-checked when stored.

## Reading a run

1. **INPUTS** — status/age of each input. Missing, stale, `draft` Brain and `excluded` strategy are the first things to check.
2. **BRAND PROFILE** — phrases derived from the library; sources line says whether the Brain contributed.
3. **CONVERSATIONS** — funnel: posts → narratives → on-brand with owned content (+ off-brand / without-content counts), then the shortlist with rank, brand fit and matched item.
4. **SUGGESTIONS** — per suggestion: type, review state, the conversation posts, then the why-lines (now, brand, brain, strategy, content, history), draft + source, checks (blocked/pass, guard lane, advisory score), proposed slot (display only).
5. **GAPS** — every reason something was not suggested. An empty result with clear gaps is a correct result.

## Reset or re-run a day

- Unchanged input fingerprint → the run is skipped. `--execute --force` regenerates anyway.
- Regeneration keeps reviewed work first: edited, saved and dismissed suggestions survive; fresh pending ones fill only the remaining slots (total ≤3, dismissed do not count) and a pair dismissed today is not re-suggested.
- A claim is a 5-minute lease; a second concurrent Generate is refused.
- A saved draft stays in `social_posts` until deleted from the queue. There is no command that wipes a day; clearing a run means deleting its `x_content_daily_runs` doc by hand (not built, not recommended).

## Module layout — `features/x-content-inventory/daily-loop/`

`daily-loop.js` and `daily-run-store.js` are barrels; import from those. Dependency order: `config, text, time-ids` → `content-basis` → `brand, conversations, evidence` → `select` → `copy` → `run`; `run-store` → `review`; `inputs`, `drafter` stand alone.

| Module | Role |
|---|---|
| `config.js` | version, caps, thresholds, owner allowlist |
| `text.js`, `time-ids.js` | tokenizing/phrases; local date, stable ids |
| `content-basis.js` | story / facts / none tiers; eligibility |
| `brand.js` | brand profile, brand fit, discovery queries |
| `conversations.js` | normalize posts, momentum, narratives |
| `evidence.js` | own-history evidence, strategy |
| `select.js` | match, contribution type, suggestion selection |
| `copy.js` | prompt, fallback copy, text checks |
| `run.js` | inputs table, fingerprint, `runDailyLoop` |
| `run-store.js`, `review.js` | memory/Firestore stores; edit, save, dismiss |
| `inputs.js`, `drafter.js` | read-only input loader; model drafter |

## Not built

Approved-Brain-as-brand-fit, momentum over time, conversation depth, image-only post vision, full-library default, scheduling/approval, performance feedback, second client. See plan §9.
