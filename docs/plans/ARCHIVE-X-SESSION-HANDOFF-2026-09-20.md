# Archive ⇄ X — Session Handoff, 2026-09-20

Everything built, found, decided and left undone in one session. Written for
whoever picks this up next, including the things that went wrong.

**Branch:** `claude/archive-poc-finalization-f0u17f` @ `27c8ecd` (pushed)
**Second repo touched:** `Bai-ee/assetManager` @ `8d9fa08` on `feat/archive-master-plan` (pushed)

---

## 0. Read this part first

**The work is verified but was never seen rendered.** 225 tests pass, the build
compiles, routes return correct status codes. Nobody has ever looked at the two
dashboard cards in a browser. That is the single biggest risk in this handoff:
the logic is tested, the UI is not.

**Why it was never seen** (three separate walls, all environmental):
1. This session ran in a cloud container with **no Firebase credentials** — no
   `.env.local` (gitignored, never cloned), every `FIREBASE_*` var unset.
2. Vercel preview URLs are behind **SSO protection** (`ssoProtection: enabled`,
   `all_except_custom_domains`). Only `hitloop.agency` is exempt.
3. Preview domains are **not in Firebase's authorized-domains list**, so Google
   auth rejects login even past the SSO wall.

**The stable preview alias** (add once to Firebase authorized domains and it
never changes, because Vercel repoints it at each new build of this branch):

```
port-2026-git-claude-archive-poc-finaliz-484cee-baiees-projects.vercel.app
```

**Or run it locally** — `localhost` is authorized in Firebase by default:

```bash
lsof -ti:3000 | xargs kill -9
cd <port_2026>
git fetch origin claude/archive-poc-finalization-f0u17f
git checkout claude/archive-poc-finalization-f0u17f
npm install     # REQUIRED — the merge pulled in another session's components
npm run dev
```

⚠️ If the dashboard shows **another client's data**, that is client
impersonation stuck in sessionStorage, not a bug in this work:

```js
sessionStorage.removeItem('dashboard.impersonateClientId'); location.reload();
```

(Key is `dashboard.impersonateClientId`, set from `?as=<clientId>`, read in
`lib/dashboard/bootstrap-session.js`. It is per-tab — a new tab is also clean.)

---

## 1. What this feature is, in one paragraph

Two systems that were built separately and did not touch. **The Archive**
(`Bai-ee/assetManager` worker + the `/archive` control plane in this repo)
answers *what an artifact is* — it walks a NAS, fingerprints every file by its
bytes, has a model describe it, asks six questions about it, and a human
confirms the answers. **The X content engine** (`features/x-content-inventory/`)
answers *what to post today* — it knows the best time, type and lane for every
slot from measured benchmark data, and it had three rows of inventory to work
with. This session built the seam between them: a confirmed archive asset now
becomes a postable row automatically, carrying the human's corrections rather
than the model's guesses.

The one thing a machine cannot supply is **the story**. A model can say "flyer,
Housepit, 2018"; it cannot say what happened that night. That field stays empty
by design and shows up as a validation gap until a person writes it.

---

## 2. The flow, end to end

```
NAS drive
   ↓  worker walks it, waits for each file to stop changing
SHA-256 of the bytes                  ← identity; filename is never identity
   ↓  same hash already seen → duplicate, both paths kept as provenance
content_assets (SQLite, survives restart)
   ↓  TwelveLabs describes video → observations     ⚠️ DORMANT, no API key
Jev answers 6 questions from those observations     (never sees raw media)
   ↓
HUMAN confirms or corrects each answer              ← /archive page (Phase 5)
   ↓  archive_review.state becomes CONFIRMED
ARCHIVE INBOX card → you write the story
   ↓  saved to x_content_packages
CONTENT ENGINE card → fills today's 5 slots
```

Two deliberate gates: nothing becomes postable until a human confirms, and
client work stays blocked until a human answers "no" to the rights question.

---

## 3. Commits in this repo (newest first)

| SHA | What |
|---|---|
| `27c8ecd` | **Two Content Engine cards → one.** Retired `x-content-day` (mine), kept `x-content` |
| `25ae359` | **Three inventory stores → one** (`x_content_packages`) |
| `c1282ec` | Merge: brought the other session's `x-content` card onto this branch |
| `1bfa87e` | **Fix: a story written in Archive Inbox reached nothing.** My own defect |
| `a262d87` | Handoff-map doc corrections |
| `915b2f6` | Jev vocabulary export the worker must vendor |
| `eb24f3b` | Archive Inbox card, `social` bucket |
| `5588547` | **The seam** — `archive-ingest.js`, archive record → ContentPackage |
| `4496202` | First day-view card (later retired in `27c8ecd`) |

`assetManager`: `8d9fa08` on `feat/archive-master-plan`.

---

## 4. Files that matter

### The seam (pure, tested, no Firestore)
- `features/x-content-inventory/archive-ingest.js` — `packageFromReviewRecord`,
  `ingestArchiveRecords`, **`mergeInventory`**. 18 tests.
- `features/x-content-inventory/jev-taxonomy.js` — the six questions.
  **Modified this session**: `routeDecision` now applies a human-confirmed
  answer unconditionally, including on the `clientWork` gate.
- `features/x-content-inventory/day-plan-projection.js` — narrows a day plan for
  the wire; names each slot's state once. 10 tests.
- `scripts/x-content/export-jev-taxonomy.mjs` → `jev-taxonomy.export.json`.
  `--check` fails when stale; a test guards the committed artifact.

### Persistence
- `features/x-content-inventory/store.js` — **the only module that touches
  Firestore for this feature.** Rewritten this session to back the
  `x_content_packages` collection.

### Dashboard (both in the `social` / Social Media Manager bucket)
- `components/dashboard/ArchiveInboxCard.jsx` + `app/api/dashboard/archive-inbox/route.js`
- `components/dashboard/XContentEngineCard.jsx` + `x-content/{PlanPanel,InventoryPanel}.jsx`
  (another session's; its API lives on `POST /api/dashboard/quote-targets`)

---

## 5. Decisions and why — do not silently reverse these

**The archive is read-only from this side.** `archive-inbox` reads
`archive_review` and `archive_uploads` and never writes to either. Jev's answers
and the human confirmations over them belong to `/archive`, which remains the
only writer. What this side owns is the **story** — a publishing decision, not
an archival fact, because the archive record is meant to outlive every decision
about how to post it.

**Human confirmations beat model answers, keyed exactly as the control plane
keys them** (`d.id || d.question`, see the PATCH handler in
`app/api/archive/review/route.js`). Deriving that key differently silently drops
every correction and republishes a guess as if a person approved it.

**A human answer clears the `clientWork` gate; a confident model answer never
does.** The gate's own rule is "a model answer is evidence, never permission" —
a person answering *is* the permission it was waiting for. Without the change in
`915b2f6`/`5588547` a human's "no" could never clear it.

**NAS paths never enter a package.** Provenance keeps a *count*, not the paths.
No private network detail belongs in something built to be posted.

**One store, a collection not a doc field.** The original design
(`dashboard_state.marketingBrief.contentInventory`, 200-row cap) was correct for
a hand-curated list. The Archive changes the premise: row count is set by how
much of a 30-year archive gets reviewed. A 1MB doc with a 200-row cap fails
exactly when the archive starts delivering, and fails by refusing saves.

**Not per-client.** `buildDayPlan` is @bai_ee's regardless of which dashboard is
open, so scoping rows by clientId while the plan ignored it was an
inconsistency, not a feature.

**Behaviour preserved from the original store**: `updatedAt` (not emptiness)
marks a written inventory, so deleting your last row does not resurrect the
examples; reads never persist their own fallback; the seed materializes on first
write; a full inventory rejects rather than trimming.

---

## 6. Bugs found and fixed

**Worker dropped files silently** (`assetManager`, real durability bug). The
`FileLocation` row is only inserted *after* `waitForStableFile()` succeeds, and
the catch block guarded its repair with `if (current)`. Any failure before that
point — a file still being written, an unreadable stat — wrote nothing at all.
Retry is driven off `file_locations.state`, so **a file that lost the stability
race was permanently dropped from the archive with no record it had ever been
seen.** Violates ARCHITECTURE safety invariant 9. The catch now synthesizes the
row as `RETRYABLE_FAILED` so the next scan retries it.

**Three of four archive test files never ran.** `test:archive` used
`lib/archive/*.test.ts` — top level only. Fixing it needed care:
**CI runs Node 20, which rejects glob patterns as `--test` positional
arguments**, and `tsx --test` with an empty argument list **exits green having
run zero tests**. The script now enumerates with `find` and fails loudly when
nothing matches. Result: **9 run / 8 pass / 1 fail → 14 tests, 14 pass**.

**Stories reached nothing** (mine). Archive Inbox wrote to
`x_content_packages`; the day plan read the static `content-packages.json`. The
two halves of the seam did not touch. Fixed by `mergeInventory` in `1bfa87e`.

**Three stores / two cards** — see `25ae359` and `27c8ecd`.

---

## 7. Stale claims in existing docs — correct these

`assetManager/docs/archive/CURRENT_STATE.md` says the HITLOOP Vercel deployment
is failing and the Vercel tool exposes no projects. **Both were untrue as of this
session**: the Vercel connection lists projects fine and the last several deploys
are READY. The two ERROR builds were on the sibling branch and were fixed there
(a lockfile out of sync with `@ardrive/turbo-sdk`, then import paths one
directory too far — per that commit, **no archive code had ever deployed before**).

The same file lists Archive Worker CI as red. As of `8d9fa08`, it is green.

---

## 8. What is NOT done

| Item | Blocked on |
|---|---|
| **Nothing has ever touched a real drive** | nothing — this is the next move |
| TwelveLabs | no API key configured; must be added locally, never pasted into chat |
| Entities | no table, no code in `lib/archive/`. `DATA_MODEL.md` §26/§29 designs them. **7 of 21 posting triggers reference entities, 5 at max strength** |
| Publishing | P4, deliberately unbuilt. Nothing in this work can post |
| Still → video render | P5. Most of the archive is stills, and a showcase slot requires video |
| Large-file Arweave upload | worker upload is **buffered**; fine for a POC file, not for large originals |
| The UI, visually | never rendered by anyone |

**Also unfixed, deliberately:**
- `assetManager/.gitignore` is **empty** — `node_modules` and the lockfile are
  trackable. Left alone because another session was live on that branch.
- `ArchiveDaemon.execute()` maps only non-`COMPLETE` to `FAILED`, so **a
  collection with failed files reports clean to the control plane.** Matches the
  docs ("partial completion is valid") but is worth a decision.
- `x-profile` and `x-calendar` both carry the card badge `XC`. Pre-existing.

---

## 9. Branch/merge reality

Verified against live `origin/main` @ `4ea390e`:

- This branch: **22 behind, 55 ahead**.
- Merging live `main` in produces **17 conflicts**, including `HomePage.jsx`,
  `HeroHeadline.jsx`, `app/layout.jsx`, `app/page.jsx` and three binary
  og-images — i.e. the live marketing site.
- Neither `features/x-content-inventory/` nor `app/api/archive/` exists on live
  `main`. **This work cannot ship to production alone**; it stacks on the X
  content engine (P0–P3) and the archive control plane, neither of which is live.
- `origin/claude/archive-poc-finalization-6qmg7k` is **0 behind / 43 ahead** —
  the graph-clean P0 candidate identified in
  `HITLOOP-MERGE-PROGRAM-2026-09-20.md`.

**The missing piece for production** is a P1 integration branch cut clean off
`origin/main` carrying the X content engine + the seam + the two cards, with the
marketing-site conflicts resolved deliberately. That was offered and not started.

---

## 10. The one number that matters

**The inventory is 3 rows.** Everything downstream works and has almost nothing
to work on. Steps 1–3 of the flow have never processed a real folder.

**Next move: point the worker at one small folder — not the terabyte.**
Everything after that is built and tested and starving.

---

## 11. Process note

This session verified tests and builds thoroughly and never established, up
front, how the user would actually *look at* any of it. That ordering was wrong:
work the user cannot see is not finished work. Establish the viewing path before
building on top of it.
