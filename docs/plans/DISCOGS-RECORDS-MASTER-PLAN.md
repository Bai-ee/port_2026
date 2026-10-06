# Discogs Records — master plan (source of truth)

Owner: Bryan (@bai_ee). Started 2026-10-05. Orchestrated from the Claude Code session that built the POC; HITLOOP-only phases are handed to a HITLOOP-repo agent with the prompt at the bottom.

## Goal (owner, verbatim order)

1. **Save and consolidate.** Verify what works across both repos; reproducible local run.
2. **One record end to end.** Photo + video + your story → confirmed Discogs match → finished clips → editable HITLOOP draft.
3. **Reliable batch.** Progress, failure handling, no duplicates, cost tracking. Worker stays on the Mac.
4. **Five strong examples** that show the archive, the clips and personal storytelling.
5. **Launch `/records`** — walkthrough + waitlist, real results, "access opens in batches".
6. **Test demand** — a few labels / shops / collectors on a manually supported pilot.

## Where things live

| Piece | Repo / branch | Path |
|---|---|---|
| Worker: scan, label read (Claude vision), Discogs match + collection add, NAS renames, cost ledger, clip/image render, publish | `Bai-ee/assetManager` · `feat/discogs-ingest` | `lib/discogs/`, `docs/discogs/RUNBOOK.md`, `docs/discogs/STATUS.md` |
| HITLOOP: worker routes (signed upload, draft + content package, usage), self-reply + media variants on `social_posts`, `[add your memory]` scheduling guard, Copywriter display, idea-with-empty-story rule | `Bai-ee/port_2026` · `feat/discogs-x-drafts` (worktree `~/Documents/Repos/Bballi_Portfolio-discogs`) | `app/api/archive/worker/discogs/*`, `app/api/archive/worker/usage`, `features/discogs-ingest/`, `features/social-posting/self-reply.js` |
| Local state (Mac) | — | `~/.discogs-ingest/{src,work,runs,cache,index.json,costs.jsonl,published.json}` |
| Media for posting | Firebase Storage | `publish-staging/discogs/<releaseId>/{video,image}-{1x1,9x16}.{mp4,jpg}` |
| Drafts / bucket | Firestore | `social_posts` (source `discogs-ingest`), `x_content_packages/discogs-<releaseId>` (series C1) |
| Source media | NAS | `/Volumes/bryan/MacTransfer/discogs` (renamed `<catno>_<artist>_<title>_{labelN,videoN}.ext`) |

The worker runs on the owner's Mac on purpose: NAS mount + VideoToolbox HDR→SDR + hardware encode.

## Owner rules (do not reopen)

- Only releases that already exist on Discogs. No database submissions.
- Auto-add to the collection only on an exact catalog-number match; everything else is review.
- Renaming files is allowed in `MacTransfer/discogs` only, journaled with undo (exception to "NAS writes only inside HITLOOP-ARCHIVE").
- Look: `rich-plus` (owner-approved saturation). No video fade; audio fades only.
- Clip: 60 s from the **middle** of the video, unless a break is flagged at the **beginning** (first ~25% of the music) — then start on the break.
- Formats: 1:1 and 9:16 for video and image. 1:1 is a plain sharp crop centred on the record/label — never a blurred pad. 9:16 is the full portrait frame. Record never cut off.
- Post: video + `Artist – Title` / `Label · Catno · Year` / `[add your memory]`. First self-reply: label image + Discogs link. X post uses 1:1 by default.
- **No emoji in any post, reply or draft text. Ever.**
- Nothing posts automatically. Scheduling is refused while `[add your memory]` is present.
- Keep cost low; test lean (one record, short clip, one look) — the NAS is slow (~5 MB/s).

## State at 2026-10-05 (end of POC)

Verified: 24 records added to the owner's collection (exact-catno), 56 files renamed on the NAS (journal + undo), notes refreshed on 25 entries, one live draft (Deep Touch, release 74379) in the owner's Copywriter queue, cost ledger ≈ $0.45 total. Render ≈ 11 s per record warm, ≈ 35 s per record uncached with prefetch. Tests: worker 60/60, HITLOOP discogs + X suites green.

Not built / open:
- Posting the first self-reply to X (phase C2 — live posting path; needs approval + deploy).
- HITLOOP branch not merged or deployed: the live site shows the draft but lacks the self-reply display and the placeholder guard. **Do not schedule Discogs drafts from the live site until merged.**
- Studio DISCOGS tab (run controls, review queue, cost) — not started.
- 8 records held for review (side-suffix catnos, unreadable labels); Furious George "3" added twice (2525744 test pressing + 51268) — owner to confirm.
- X engine matcher can propose `idea` rows with empty story; drafting refuses them (< 40 chars). Noise only.

## Phases with acceptance criteria

### 1 · Save and consolidate (in progress)
- Both branches committed and pushed; archive-thread work in `assetManager` left untouched and uncommitted.
- `npm run discogs:doctor` passes on the Mac; tests pass in a clean checkout; one cached dry-run reproduces.
- RUNBOOK + STATUS in `assetManager/docs/discogs/`; this plan in HITLOOP.

### 2 · One record end to end (next)
- Owner writes the story for Deep Touch in Copywriter (replaces `[add your memory]`); the story syncs to `x_content_packages/discogs-74379.story` and the package moves `idea → drafted`.
- Draft carries the 1:1 video, 1:1 label image in the self-reply, 9:16 variants stored for Instagram.
- Republish Deep Touch with the final template (middle clip, rich-plus, no video fade, 4 variants) — idempotent update of the existing draft, no duplicate.
- Merge `feat/discogs-x-drafts` → deploy so the live Copywriter matches localhost (owner approval required).
- Optional C2: post the self-reply as a real reply after the main post (owner approval; touches live X posting).

### 3 · Reliable batch
- `discogs:publish` over the folder: progress line per record (n/N, step, ETA), resumable, per-record failure isolation, retries on network errors, idempotent (published.json + server-side sourceRef lookup), cost per run → Operating Cost card.
- Review queue for non-exact matches (approve → add to collection → publish).
- A summary report per run (added / drafted / skipped / failed / cost).

### 4 · Five strong examples
- Owner picks five records with real stories; each has a finished draft (story + clip + label + link) and is posted manually by the owner. Capture before/after (raw phone video vs finished clip) for the `/records` page.

### 5 · Launch `/records` (HITLOOP agent)
- Public page: what it does (photo + video + story → Discogs + finished clips), the five examples, a short walkthrough, waitlist form ("access opens in batches"). No self-serve upload yet.
- Waitlist stored in Firestore with admin view; analytics on views and signups.

### 6 · Test demand
- 3–5 labels / shops / collectors on a manually supported pilot: their folder → our worker → their drafts. Measure time saved, quality, willingness to pay. Decide on the Studio DISCOGS tab and per-user Discogs OAuth after this.

## Who orchestrates

The originating Claude Code session orchestrates phases 1–4 (it holds both repos' context and the Mac worker). Phase 5 is HITLOOP-only and goes to a HITLOOP-repo agent using the prompt below. Phase 6 is owner-led with engineering support.

## Master prompt for the HITLOOP-repo agent (phase 5)

```
You are working in the HITLOOP repo (Bai-ee/port_2026). Task: phase 5 of the Discogs Records plan — launch a public /records page with a walkthrough and a waitlist.

Read first, in order:
1. docs/plans/DISCOGS-RECORDS-MASTER-PLAN.md (this plan — source of truth; owner rules are not up for debate)
2. features/discogs-ingest/ and app/api/archive/worker/discogs/* (what the pipeline produces)
3. The existing public-page patterns in app/ (layout, analytics, forms) — reuse them; no new libraries.

Re-check state before proposing: git branch and whether feat/discogs-x-drafts is merged; which five example records the owner has approved (ask if not listed in the plan); where finished media lives (Firebase publish-staging/discogs/<releaseId>/).

Scope: /records page (hero: photo + video + your story -> Discogs entry + finished clips; the five examples with their 1:1 clips, label images, story and Discogs link; a 3-step walkthrough; "access opens in batches" waitlist form). Waitlist writes to Firestore with an admin list view; track page views and signups with the repo's analytics. No self-serve upload, no payments, no per-user Discogs OAuth.

Rules: plan first (compact), then one phase at a time, stop for approval. No emoji in any copy. Every edited container gets a stable kebab-case id (repo rule). Mobile-first; no horizontal scroll at 390px. No commits, pushes, deploys or paid API calls without the owner's explicit OK. Never post to X.
```

## Sync with Active Content System

Cross-reference: `ACTIVE-CONTENT-SYSTEM-PLAN.md` (ACS), sections 3a, 3e, 4 (Phase 2A), 6.4.

- **Ownership split (ACS 6.4).** This Discogs thread keeps the Mac worker and the ingest (`features/discogs-ingest/**`). ACS owns allocation, scheduling and the publish lock.
- **Gate 0 is resolved.** The records release merged to main as `349f0a96` and is live on hitloop.agency as `dpl_2j1DFnSBuAatKSimS9CaHzSyj3Tm`.
- **Scheduler is interim.** The fixed 09:00 CT records scheduler stays until the ACS quota layer routes records.
- **Publisher stays OFF.** Both the launchd publisher and the GitHub Actions sweep remain disabled until ACS 1D's atomic claim lands.
- **Records adapter hook (ACS 2A, this half).** Every package the ingest writes now carries the ACS 3a additive fields: `engine:'record'`, `source{kind:'discogs',externalId,url}`, `priority:'evergreen'`, `format:'video'`, `tags`, `related:[]`, `approval{state:'none'}`, and `variants.x` (1x1) / `variants.instagram` (9x16) when variant paths exist. Existing values always win, so human or ACS edits are never overwritten. `social_posts` carry `packageId:'discogs-<releaseId>'` (set by a merge patch after create, because `createSocialPost` drops unknown fields). `scripts/discogs/backfill-acs-fields.mjs [--dry-run]` adds the same fields to existing rows.
- **Open editorial decision (owner).** Post copy order: recommendation is the memory first, then `Artist – Title`. Today the builder emits `Artist – Title`, meta, then the memory. Not changed; story sync (`extractStory`) depends on the current shape.
