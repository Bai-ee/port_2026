# Discogs drafts — label/video mismatch audit (2026-10-22)

Continuity note. Follows `DISCOGS-2026-10-21-UNPROCESSED-RECORDS-SESSION.md`. Worker SSOT: `~/Documents/Repos/assetManager/docs/discogs/{RUNBOOK,STATUS}.md`.

## What the owner saw
Calendar draft "Black Traxx – Volume III · NCL-005" plays a clip of a yellow NARCOTIC label (Roger Sanchez). Same off-by-one as the 10-21 session, now confirmed across the whole batch.

## Root cause (confirmed from capture timestamps, not just eyeballing)
- Owner shoots **video first, then the label photo** (1–3 min apart); the next record's video follows 1–3 min after that label.
- `lib/discogs/media.ts` `groupRecords` attaches each video to the **nearest label by absolute time** (ties prefer the video *after* the label). With near-equal gaps either side this is a coin flip, and a lone video sitting between two labels usually lands on the earlier label = the wrong record.
- The publisher renders the group's **longest** video, so groups holding both a before- and an after-label clip can render the wrong one too.
- The 2026-10-05 `--apply --rename` ran on that grouping, so several NAS filenames are wrong: `NCL-005_Black-Traxx_Volume-III_video1.mov` is Roger Sanchez's clip; `IN-003_3-Play_…_video1.mov` is Fantom's clip (the 10-21 note said Fantom had no video; it does).
- Rule that fits every row: **the correct video is the nearest video captured BEFORE the label (within ~5 min).**

## Proof points
- Row 4 Black Traxx: assigned video captured after its label → clip shows Narcotic (row 5's label). Row 5's correct video is the file *named* Black Traxx.
- Row 1 3-Play: assigned video after label → clip shows Fantom. Fantom's correct video is the file *named* 3-Play.
- The chain holds through rows 4→5→6→7→8→9 (each clip is the next record's).
- Contact sheets (label still left, mid-clip frame right, 8 rows per sheet in table order): `~/Desktop/discogs-review-2026-10-22/sheet0..8.jpg`.

## State in prod (client bryan-balli-WUoltG84)
- 66 discogs drafts, **none scheduled or posted**. 27 `rejected` (26 of them at 2026-10-22 16:30 UTC via `agent-card`), 39 `draft`.
- NAS `/Volumes/bryan/MacTransfer/discogs` was **not mounted** during this audit → nothing re-rendered.

## Verdict table (row = index in `~/.discogs-ingest/published.json`)
WRONG = group only had an after-label video · RIGHT = only a before-label video · CHECK(both) = group had both, clip eyeballed OK · WRONG (eyeballed) = group had both, clip is the wrong record.

| # | Release | Record | Draft | Verdict | Re-render from |
|---|---|---|---|---|---|
| 0 | 74379 | Lith De Lanka – Fairy Tale | draft | CHECK(both) |  |
| 1 | 92069 | 3-Play – The Cream Of The Krop EP | draft | WRONG | `IMG_0669 2.MOV` |
| 2 | 151581 | Braxton Holmes, Dewey B., Weezie Jefferson – The Adventures Of A Full Figured Woman E.P. \| | draft | WRONG | `BVR-12006_Braxton-Holmes-and-Dewey-B.-Present-Weezie-Jefferson_The-Adventures-Of-A-Full-Figured_video2.mov` |
| 3 | 2525744 | Furious George – 3 | draft | NO VIDEO → use CAJ-220-1 video (10 m before) | `CAJ-220-1_DJ-Sneak_Moon-Doggy-E.P_video1.mov` |
| 4 | 12839082 | Black Traxx – Volume III | draft | WRONG | `HS-536_Furious-George_3_video2.mov` |
| 5 | 24191 | Roger Sanchez, Twilight – I Want Your Love | draft | WRONG | `NCL-005_Black-Traxx_Volume-III_video1.mov` |
| 6 | 1580157 | Ricky Bradshaw – The Jump? Skip! EP. | rejected | WRONG | `NAR-014_Roger-Sanchez-Presents-Twilight_I-Want-Your-Love_video1.mov` |
| 7 | 10207 | Glenn Underground, Cei-Bei – House Music Will Never Die | draft | WRONG | `MDR9616-1_Ricky-Bradshaw_The-Jump-Skip-EP_video1.mov` |
| 8 | 461456 | Just 4 Groovers, Freddy Turner – I Got Jazz In My Soul | draft | WRONG | `CAJ-261_G-U-and-Cei-Bei_House-Music-Will-Never-Die_video1.mov` |
| 9 | 30820134 | Kojak – Hold Me | draft | WRONG | `KG-0103_Just-4-Groovers-Featuring-Frederick-Turner_I-Got-Jazz-In-My-Soul_video1.mov` |
| 10 | 4393 | Mateo & Matos – Night Moods | draft | CHECK(both) |  |
| 11 | 15399 | DJ Sneak – Recycled Loops | rejected | WRONG | `LAR-032_Mateo-and-Matos_Night-Moods_video2.mov` |
| 12 | 5660 | DJ Q – Porn King EP | draft | WRONG | `AV09_DJ-Sneak_Recycled-Loops_video1.mov` |
| 13 | 1247 | Blue Boy – Scattered Emotions EP | draft | CHECK(both) |  |
| 14 | 3679686 | DJ Jacq – Ghetto Survival | draft | WRONG | `GDR-004_Blue-Boy_Scattered-Emotions-EP_video3.mov` |
| 15 | 16103 | Johnny Fiasco – Deep State E.P. | draft | WRONG | `RER-003_DJ-Jacq_Ghetto-Survival_video1.mov` |
| 16 | 7351 | DJ Sneak – Moon Doggy E.P. | draft | WRONG, no video on NAS |  |
| 17 | 2718456 | Kojak – Hold Me | rejected | WRONG | `KG-0103_Just-4-Groovers-Featuring-Frederick-Turner_I-Got-Jazz-In-My-Soul_video1.mov` |
| 18 | 1090271 | Johnny D & Nicky P – The Bay Ridge EP 2 | draft | CHECK(both) |  |
| 19 | 162526 | Uptempo – Rise | rejected | WRONG | `IMG_0777.MOV` |
| 20 | 10442424 | Bob Sinclar – Paradise | rejected | WRONG | `IMG_0781.MOV` |
| 21 | 12601660 | Rick Garcia, Aquarius – Fly Away | draft | RIGHT |  |
| 22 | 1972053 | Mateo & Matos – Songs For The Soul | rejected | WRONG (eyeballed) | `IMG_0794.MOV` |
| 23 | 42398 | Mateo & Matos – No Props 1 1/2 | draft | WRONG | `IMG_0796.MOV` |
| 24 | 2584427 | M1 – Luv 2 Dance | draft | WRONG | `IMG_0805.MOV` |
| 25 | 1137606 | DJ Jacq – Ghetto Pleasures | draft | WRONG | `IMG_0807.MOV` |
| 26 | 70452 | Jose Nuñez, Octavia Lambertis – Hold On > Pt.2 | draft | CHECK(both) |  |
| 27 | 2305708 | Da Mongoloids – Spark Da Meth | draft | RIGHT |  |
| 28 | 139394 | Gordon Gattrell – For Christine | draft | CHECK(both) |  |
| 29 | 178899 | Ice Cube – Lethal Injection | rejected | CHECK(both) |  |
| 30 | 1358933 | Lenny Fontana, Andricka Hall – I'll Give You Love | rejected | CHECK(both) |  |
| 31 | 44387 | Watanabe – Odoru | draft | RIGHT |  |
| 32 | 6915 | Derrick Jamerson – Got To Give It Up | draft | WRONG | `IMG_0835 2.MOV` |
| 33 | 241984 | Jezebel – I Just Want Your Love | rejected | RIGHT |  |
| 34 | 174344 | Sounds Of Blackness – Joy | rejected | WRONG, no video on NAS |  |
| 35 | 38110 | Inner City – Share My Life | draft | WRONG | `IMG_0847.MOV` |
| 36 | 15904837 | Dubble Dose – Come On / Make Me Feel Good | draft | WRONG (eyeballed) | `IMG_0853.MOV` |
| 37 | 182850 | Moné – Movin' | draft | WRONG (eyeballed) | `IMG_0857.MOV` |
| 38 | 259548 | Lil' John Coleman – Red Dog Grooves | rejected | WRONG | `IMG_0859.MOV` |
| 39 | 152421 | Groove Source – Thank You! Thank You! | draft | WRONG | `IMG_0865.MOV` |
| 40 | 407882 | The Outhere Brothers – Un-Released Vol.II | draft | RIGHT |  |
| 41 | 1713431 | Craig S. Loftis – Don't Want To Be Right | draft | CHECK(both) |  |
| 42 | 490375 | Butch Quick – Always (Part 1 Of 2) | draft | WRONG | `IMG_0872.MOV` |
| 43 | 4302995 | Washerman, James Johnston – Split Slam EP | draft | CHECK(both) |  |
| 44 | 112890 | Bizarre Inc, Angie Brown – I'm Gonna Get You | draft | WRONG (eyeballed) | `IMG_0887.MOV` |
| 45 | 3643487 | Tracie Spencer – This House | draft | WRONG | `IMG_0889.MOV` |
| 46 | 13664446 | Urban Rhythm – Feel It Baby All Nite | rejected | RIGHT |  |
| 47 | 4153689 | Various – Underground Blues | draft | CHECK(both) |  |
| 48 | 81681 | The 2nd Opinion – A Tracky Hold | draft | WRONG | `IMG_0897.MOV` |
| 49 | 169837 | Mike "Hitman" Wilson, Shawn Christopher – Another Sleepless Night (The Dave Morales Remix) | rejected | WRONG | `IMG_0903.MOV` |
| 50 | 528695 | Fire House – In The Bottle | draft | RIGHT |  |
| 51 | 13245248 | Park Avenue, Tony Jenkins – Don't Turn Your Love | rejected | RIGHT |  |
| 52 | 14165 | Shawn Benson – Natural Thing | rejected | CHECK(both) |  |
| 53 | 2356550 | Shey Alexander – You Put A Spell On Me | rejected | RIGHT |  |
| 54 | 8353062 | Reality – Yolanda | draft | RIGHT |  |
| 55 | 2477922 | Clinton Daniel – Right Here And Now | rejected | WRONG (eyeballed) | `IMG_0929.MOV` |
| 56 | 1044995 | Stayshon 2 Stayshon – My, My, My | rejected | WRONG (eyeballed) | `IMG_0935.MOV` |
| 57 | 124356 | Krush – House Arrest (The Beat Is The Law) (Exclusive American Fashion) | rejected | WRONG | `IMG_0937.MOV` |
| 58 | 690875 | Crystal Waters – What I Need | draft | NO VIDEO in group → use IMG_0943.MOV (2 m before) | `IMG_0943.MOV` |
| 59 | 3033733 | Bang The Party – Release Your Body | draft | WRONG (eyeballed) | `IMG_0947.MOV` |
| 60 | 2180708 | Dreamer G – I Got That Feelin | draft | RIGHT |  |
| 61 | 24527 | Derrick Carter – Mo Pschidt | rejected | FIXED 10-21 |  |
| 62 | 150716 | Rhythm Masters – Fulla Flava Grooves (Funk Essentials On Plastic) Chapter 1 | rejected | FIXED 10-21 |  |
| 63 | 1093094 | Tone Theory, Hydroponic Sound System – Untitled | rejected | FIXED 10-21 |  |
| 64 | 591124 | Fantom – Faithfull | rejected | WRONG | `IN-003_3-Play_The-Cream-Of-The-Krop-EP_video1.mov` |
| 65 | 61824 | Todd Edwards – Look Out | draft | FIXED 10-21 |  |

**37 drafts need a re-render.** 11 right, 12 eyeballed OK, 4 fixed on 10-21, 2 have no clip on the NAS (rows 16, 34).

## Fix — Phase 1: re-render the 37 (keeps draft ids; NAS must be mounted; worker repo, branch `analyzer-fast-rerun`)
Script: `~/Desktop/discogs-review-2026-10-22/rerender.sh` (one line per record, same as below).
```
cd ~/Documents/Repos/assetManager
D=/Volumes/bryan/MacTransfer/discogs
npm run discogs:publish -- $D --release 92069 --force --video "IMG_0669 2.MOV"   # 3-Play – The Cream Of The Krop EP
npm run discogs:publish -- $D --release 151581 --force --video "BVR-12006_Braxton-Holmes-and-Dewey-B.-Present-Weezie-Jefferson_The-Adventures-Of-A-Full-Figured_video2.mov"   # Braxton Holmes, Dewey B., Weezie Jefferson – The Adventures Of A Full Figured Woman E.P. |
npm run discogs:publish -- $D --release 2525744 --force --video "CAJ-220-1_DJ-Sneak_Moon-Doggy-E.P_video1.mov"   # Furious George – 3
npm run discogs:publish -- $D --release 12839082 --force --video "HS-536_Furious-George_3_video2.mov"   # Black Traxx – Volume III
npm run discogs:publish -- $D --release 24191 --force --video "NCL-005_Black-Traxx_Volume-III_video1.mov"   # Roger Sanchez, Twilight – I Want Your Love
npm run discogs:publish -- $D --release 1580157 --force --video "NAR-014_Roger-Sanchez-Presents-Twilight_I-Want-Your-Love_video1.mov"   # Ricky Bradshaw – The Jump? Skip! EP.
npm run discogs:publish -- $D --release 10207 --force --video "MDR9616-1_Ricky-Bradshaw_The-Jump-Skip-EP_video1.mov"   # Glenn Underground, Cei-Bei – House Music Will Never Die
npm run discogs:publish -- $D --release 461456 --force --video "CAJ-261_G-U-and-Cei-Bei_House-Music-Will-Never-Die_video1.mov"   # Just 4 Groovers, Freddy Turner – I Got Jazz In My Soul
npm run discogs:publish -- $D --release 30820134 --force --video "KG-0103_Just-4-Groovers-Featuring-Frederick-Turner_I-Got-Jazz-In-My-Soul_video1.mov"   # Kojak – Hold Me
npm run discogs:publish -- $D --release 15399 --force --video "LAR-032_Mateo-and-Matos_Night-Moods_video2.mov"   # DJ Sneak – Recycled Loops
npm run discogs:publish -- $D --release 5660 --force --video "AV09_DJ-Sneak_Recycled-Loops_video1.mov"   # DJ Q – Porn King EP
npm run discogs:publish -- $D --release 3679686 --force --video "GDR-004_Blue-Boy_Scattered-Emotions-EP_video3.mov"   # DJ Jacq – Ghetto Survival
npm run discogs:publish -- $D --release 16103 --force --video "RER-003_DJ-Jacq_Ghetto-Survival_video1.mov"   # Johnny Fiasco – Deep State E.P.
npm run discogs:publish -- $D --release 2718456 --force --video "KG-0103_Just-4-Groovers-Featuring-Frederick-Turner_I-Got-Jazz-In-My-Soul_video1.mov"   # Kojak – Hold Me
npm run discogs:publish -- $D --release 162526 --force --video "IMG_0777.MOV"   # Uptempo – Rise
npm run discogs:publish -- $D --release 10442424 --force --video "IMG_0781.MOV"   # Bob Sinclar – Paradise
npm run discogs:publish -- $D --release 1972053 --force --video "IMG_0794.MOV"   # Mateo & Matos – Songs For The Soul
npm run discogs:publish -- $D --release 42398 --force --video "IMG_0796.MOV"   # Mateo & Matos – No Props 1 1/2
npm run discogs:publish -- $D --release 2584427 --force --video "IMG_0805.MOV"   # M1 – Luv 2 Dance
npm run discogs:publish -- $D --release 1137606 --force --video "IMG_0807.MOV"   # DJ Jacq – Ghetto Pleasures
npm run discogs:publish -- $D --release 6915 --force --video "IMG_0835 2.MOV"   # Derrick Jamerson – Got To Give It Up
npm run discogs:publish -- $D --release 38110 --force --video "IMG_0847.MOV"   # Inner City – Share My Life
npm run discogs:publish -- $D --release 15904837 --force --video "IMG_0853.MOV"   # Dubble Dose – Come On / Make Me Feel Good
npm run discogs:publish -- $D --release 182850 --force --video "IMG_0857.MOV"   # Moné – Movin'
npm run discogs:publish -- $D --release 259548 --force --video "IMG_0859.MOV"   # Lil' John Coleman – Red Dog Grooves
npm run discogs:publish -- $D --release 152421 --force --video "IMG_0865.MOV"   # Groove Source – Thank You! Thank You!
npm run discogs:publish -- $D --release 490375 --force --video "IMG_0872.MOV"   # Butch Quick – Always (Part 1 Of 2)
npm run discogs:publish -- $D --release 112890 --force --video "IMG_0887.MOV"   # Bizarre Inc, Angie Brown – I'm Gonna Get You
npm run discogs:publish -- $D --release 3643487 --force --video "IMG_0889.MOV"   # Tracie Spencer – This House
npm run discogs:publish -- $D --release 81681 --force --video "IMG_0897.MOV"   # The 2nd Opinion – A Tracky Hold
npm run discogs:publish -- $D --release 169837 --force --video "IMG_0903.MOV"   # Mike "Hitman" Wilson, Shawn Christopher – Another Sleepless Night (The Dave Morales Remix)
npm run discogs:publish -- $D --release 2477922 --force --video "IMG_0929.MOV"   # Clinton Daniel – Right Here And Now
npm run discogs:publish -- $D --release 1044995 --force --video "IMG_0935.MOV"   # Stayshon 2 Stayshon – My, My, My
npm run discogs:publish -- $D --release 124356 --force --video "IMG_0937.MOV"   # Krush – House Arrest (The Beat Is The Law) (Exclusive American Fashion)
npm run discogs:publish -- $D --release 690875 --force --video "IMG_0943.MOV"   # Crystal Waters – What I Need
npm run discogs:publish -- $D --release 3033733 --force --video "IMG_0947.MOV"   # Bang The Party – Release Your Body
npm run discogs:publish -- $D --release 591124 --force --video "IN-003_3-Play_The-Cream-Of-The-Krop-EP_video1.mov"   # Fantom – Faithfull
```
Each run re-uploads `publish-staging/discogs/<id>/video-*.mp4` and keeps the draft id. Eyeball `~/.discogs-ingest/work/<id>/clip-1x1.mp4` vs `label-1x1.jpg` after each (or rebuild the contact sheets).
A rejected draft stays rejected after a re-render; un-reject in Compose once the clip is right.

## Fix — Phase 2: stop it recurring (worker code; approval needed before coding)
- `media.ts` `groupRecords`: assign each video to the **first label captured after it** inside the window (video precedes its label); fall back to the nearest earlier label only when no later label exists. Keep the 10-min window.
- Replay test over the real `~/.discogs-ingest/index.json` timeline: every release in this table must resolve to its "Re-render from" file.
- Do not run `--apply --rename` again until Phase 2 is in; current NAS video names are untrustworthy.

## Not done
- No re-render executed (NAS unmounted). No Firestore writes. No worker code changed.
- Rows 16 (DJ Sneak Moon Doggy) and 34 (Sounds Of Blackness): no clip on the NAS. Shoot again or leave rejected.
- Row 3 (Furious George) would use a clip shot 10 min earlier; confirm by eye before scheduling.

## Result (2026-10-22, later the same day)
- Phase 1 ran: 36 + 1 (Black Traxx test) + 3 second-pass re-renders, 0 failures, ~$0.28 vision spend. Draft ids unchanged; media in `publish-staging/discogs/<id>/` replaced.
- Second full-batch eyeball (`~/Desktop/discogs-review-2026-10-22/` is the first pass; second pass sheets were scratch) found three more wrong where the group held both clips and the publisher took the longest: Blue Boy 1247 (→ `GDR-004…video2.mov`), Loftis 1713431 (→ `IMG_0870.MOV`), Watanabe 44387 (two label groups; → `IMG_0912.MOV`). All three verified.
- **62 of 66 drafts now play the right record.**
- **4 drafts have no clip on the NAS** (the video that sits before their label is a different, un-photographed record): row 3 Furious George 2525744, row 6 Ricky Bradshaw / Moody 1580157, row 16 DJ Sneak Moon Doggy 7351, row 34 Sounds Of Blackness 174344. Their current clips are wrong; reject or reshoot. Three clips on the NAS belong to records with no label photo: `NAR-014…video1.mov` (orange swirl label), `CAJ-220-1…video1.mov` (blue "Underground House Sounds" label), `IMG_0843.MOV` ("Tangerine Train").
- Phase 2 done in the worker (uncommitted, branch `analyzer-fast-rerun`): `media.ts` `groupRecords` now gives each video to the first label shot after it (fallback: nearest earlier label); doc header + tests updated (`npm run test:discogs` 86/86). Replay of the new rule over the real `index.json`: 58/60 audited rows resolve to the verified clip; the 2 misses are rows 3 and 58, both have no valid clip or an intervening label.
- Draft status untouched: 27 still `rejected` (26 from the 10-22 16:30 UTC reject) even though their clips are now right. Un-reject in Compose.
- NAS filenames from the 10-05 rename are still wrong for the 09-28 session's videos; not renamed (owner call).

## 2026-10-23 follow-up batch

- Dry run with the fixed grouping: 122 groups. 44 unpublished with a release match, 39 with a video; every pairing checked label-vs-clip before publishing (`~/Desktop/discogs-review-2026-10-22/pairings-2026-10-23.html`).
- `discogs:ingest --apply` (no rename): 12 added to the collection (journal `~/.discogs-ingest/runs/2026-10-23T00-48-36-192Z-applied.jsonl`).
- `publish-2026-10-23.sh`: 35 drafts created, 0 failed, ~$0.30 vision; rendered clip vs rendered label verified for all 35. Pinned: Swirl People → `IMG_0691.MOV`, Halo & Justin Long → `ET-007_…video1.mov`. IMG_0680 identified by hand as Jordan Fields – Underground Fundamentals Volume One (Red Cat RC004, release 48478).
- Held for a release id: Nasty Beats Vol 1 (IMG_0774, matcher says Apollo Two 1464), KMS comp white label (IMG_0902), Mike Dunn TRAK white label (IMG_0940), Richie Rich – Salsa House pressing (IMG_0961: UK 119404 vs Benelux 148509).
- No clip on the NAS: Kelvin K, Johnny Fiasco Hardgrooves, Ari Bald, Club Supreme, second 280 West label.
- Worker commits on `analyzer-fast-rerun`: `4eac7cd` grouping fix, `cb302ad` publish overrides, Phase A refactor (`publish-run.ts`). Button plan: `DISCOGS-PROCESS-BUTTON-PLAN.md`.
