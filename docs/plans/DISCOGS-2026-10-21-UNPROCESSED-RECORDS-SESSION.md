# Discogs records — 2026-10-21 "unprocessed NAS files" session

Continuity note (not a feature SSOT). Worker SSOT: `~/Documents/Repos/assetManager/docs/discogs/{RUNBOOK,STATUS}.md`.
HITLOOP contract: `docs/plans/DISCOGS-PANEL-CONTRACT.md`, plan `docs/plans/DISCOGS-RECORDS-MASTER-PLAN.md`.

## What the owner saw
Raw `IMG_*.MOV/.heic` files in `/Volumes/bryan/MacTransfer/discogs` with no draft in the system
(IMG_0785.heic, IMG_0784.MOV, IMG_0783.MOV, FullSizeRender 3.HEIC, IMG_0673.MOV).

## Why nothing happened
1. The worker publisher (`npm run discogs:publish`) only renders records whose Discogs match has an
   **exact catalog number**. These labels read partial/no catno, so they were skipped even though the
   releases were already in the collection.
2. Portrait label photos carry an EXIF rotation; ffmpeg 8 autorotates, the crop plan did not → `crop`
   rejected (`Invalid too big or non positive size`). Fixed in `lib/discogs/video.ts` `labelToJpeg`.
3. **Capture-time grouping is off by one** when the label is photographed after the video: each label
   gets the NEXT record's video. Every record in this batch rendered the wrong clip the first time.
   Bob Sinclar's 2026-10-16 draft (`social_1792187004076_egjv3s`, rejected by the owner) was the same bug.

## Where the processed records are now (prod, client `bryan-balli-WUoltG84`)
`social_posts` drafts, `source: discogs-ingest`, `engine: record`, `packageId: discogs-<releaseId>`,
media in Firebase `publish-staging/discogs/<releaseId>/video-{1x1,9x16}.mp4` + `label-*.jpg`.
Content Center › Library shows the packages (`x_content_packages/discogs-<id>`, status `idea`);
Queue & Calendar › Compose shows the drafts. Caption is a stub (`[add your memory]`, `needsStory: true`).

| Record | Release | Draft | Source video |
|---|---|---|---|
| Derrick L. Carter – Mo Pschidt | 24527 | `social_1792598956777_k4pewp` | IMG_0784.MOV |
| Tone Theory / Hydroponic Sound System – Untitled (white vinyl) | 1093094 | `social_1792599078129_kqvhu8` | IMG_0673.MOV |
| Rhythm Masters – Fulla Flava Grooves | 150716 | `social_1792599018027_3qtl50` | IMG_0675.MOV |
| Todd Edwards – Look Out | 61824 | `social_1792600381632_20upcy` | IMG_0677.MOV |
| Fantom – Faithfull | 591124 | `social_1792599175844_te6m7c` **rejected** — no video on NAS | — |
| Bob Sinclar – Paradise | 10442424 | `social_1792187004076_egjv3s` rejected (wrong video) | IMG_0781.MOV would be right; not re-rendered |

Local copies: `~/Desktop/discogs-renders-2026-10-21/<releaseId>-clip-{1x1,9x16}.mp4`
and `~/.discogs-ingest/work/<releaseId>/`.

## How to do this next time (worker repo)
```
npm run discogs:ingest -- /Volumes/bryan/MacTransfer/discogs            # dry run, free (cached reads)
npm run discogs:publish -- <dir> --release <id>                          # owned best match, catno not exact = OK
npm run discogs:publish -- <dir> --release <id> --group <g-id>           # [REVIEW] row, release picked by hand
npm run discogs:publish -- <dir> --release <id> --force --video IMG_x.MOV  # wrong clip → re-render, same draft
```
Always compare `clip-1x1.mp4` frame vs `label-1x1.jpg` before scheduling.
Do not bulk `--apply --rename` a session shot video-then-label (videos would get the wrong record's name).

## Still open
- Swirl People (FullSizeRender 6 + IMG_0690/0691): no Discogs match; needs a release id by hand.
- Bob Sinclar re-render from IMG_0781.MOV (`--release 10442424 --force --video IMG_0781.MOV`) if wanted.
- NAS files keep raw `IMG_*` names.
- Worker changes uncommitted on `analyzer-fast-rerun`.
- Grouping fix in the ingest itself (prefer the video *before* a label when the label is the later capture) not built.
