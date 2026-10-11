# Social archive timeline (SSOT)

Turns Facebook / X / Instagram **data exports** into dated timeline entries, links each post to the analyzed media it carried, and exposes them to search, the Timeline tab, the item drawer and the Client Brain's tone retrieval. Plan and rationale: `docs/plans/LIVING-TIMELINE-ARCHIVE-PLAN.md`. Module contract (APIs, shapes): `features/social-archive/CONTRACT.md`.

## What is built (2026-10-08)

| Piece | Where | State |
|---|---|---|
| Ingest contract + sanitizer + voice features | `features/social-archive/schema.js` | built, 11 tests |
| Archive readers (dir / in-memory) | `fs-reader.js` | built |
| Facebook HTML adapter (posts, albums, events) | `adapters/facebook.js` | built; **real-tested** on the Housepit CHI page export |
| X archive adapter (tweets.js, tweet.js, Grailbird) | `adapters/x.js` | built; synthetic fixtures only — **no real X archive on the NAS yet** |
| Instagram adapter (JSON + HTML flavors) | `adapters/instagram.js` | JSON on synthetic fixtures; **HTML flavor real-tested** on the @bai__ee export |
| Post ⇄ media matcher | `match.js` | built; exact path match against `nas.relativePath`, never fuzzy |
| Timeline store (Firestore) | `timeline-store.js` | built |
| Ingest orchestration + CLI | `ingest.js`, `scripts/social-archive/ingest.mjs` | built; **dry run is the default** |
| Voice fingerprint + exemplars + Brain context | `voice.js`, `features/client-brain/store.cjs` | built; opt-in via `loadClientBrainContext(id, {platform, topic})` |
| Routes + Timeline tab + drawer "Posted copy" + `day:` search | `actions.js`, `quote-targets/route.js`, `TimelinePanel.jsx`, `ItemDrawer.jsx`, `search-index.js` | built, unit-tested; not yet viewed in a browser |

## Data model

- `timeline_entries/{clientId}__{entryId}` — one row per post/media/event (fields in `schema.js`). Text trimmed to 600 chars; raw archives are never stored.
- `timeline_days/{clientId}__{YYYY-MM-DD}` — one doc per day (counts per kind, platforms, 5 snippets, entry ids). "Search a day" is one doc read.
- `social_archives/{clientId}__{platform}__{account}__{archive}` — one row per imported archive (entries, date range, matched/unmatched).
- On matched analyzer items (`x_content_packages/nas-*`): `post {platform, account, entryId, postedAt, day, text≤300, album}`, `postIds[]`, `dates[{kind, date, source, platform}]`. Additive only; `lastPostedAt`, status, story and owner fields are never touched.

## Rules (owner decisions)

1. **Dates carry their kind** (`posted` / `taken` / `event` / `created`) and source. File dates (mtime, download time) are rejected by `sanitizeEntry`. A photo's *posted* date is not its event date.
2. Only the owner's own words. No DMs, no other people's comments, no likes/ads/device data; adapters read an **allowlist** of paths only (a test per adapter proves nothing else is opened).
3. `audience` gates reuse; only `public` entries can be voice exemplars or appear in Brain context.
4. Idempotent: ids come from `entryId()`; re-running an import changes nothing (tested, and verified live).
5. Retweets/reposts keep a `relation` but **empty text**.

## How to import an archive

```
cd ~/Documents/Repos/Bballi_Portfolio-content-system
node scripts/social-archive/ingest.mjs --platform facebook --account "Housepit CHI" \
  --dir "/Volumes/Public/Bryan/Facebook Downloads/facebook-HousepitCHI" \
  --archive-root-rel "Facebook Downloads/facebook-HousepitCHI"          # dry run: prints the report, writes nothing
… add --write to import      # --client <id> to target another client (default bryan-balli-WUoltG84)
```
- `--archive-root-rel` is the archive folder's path **relative to the NAS source root** (e.g. `Public/Bryan` is the root of source "Public · Bryan"); it is how post media paths are joined to analyzed items.
- Run from the Mac with the NAS mounted. Env is loaded the project way (never `node --env-file`).
- Platforms: `facebook`, `x`, `instagram`. One command per account/archive; many accounts = many runs.

## First real import

Facebook page export "Housepit CHI": **1,381 entries** (1,263 posts, 78 album media, 40 events) over **421 days**, 2018-03-16 → 2020-06-18; **1,061 of 1,064** media files matched to analyzed items (3 unmatched: one video, two images not in the analyzed set). **1,055** analyzed items now carry their post copy and posted date. Skipped on purpose: 468 empty status shells, 104 duplicate export rows, 814 album photos already carried by a post.

Instagram @bai__ee (HTML export, 2026-05-29): **2,834 entries** (1,318 posts incl. 74 reposts with empty text, 1,343 stories, 169 reels, 3 events) over **1,538 days**, 2015-07-25 → 2026-05-08, no rejects. **The export contains no photo/video files** (only `your_instagram_activity/media/*.html`), so 0 of 3,616 media refs match analyzed items; captions and dates are still in the timeline and feed the Instagram voice fingerprint. Skipped: 1,282 duplicates, 6 empty blocks. `posts.html` carries ~79 posts that `posts_1.html` lacks; both are parsed, de-duplicated by media path.

Voice fingerprints from the two imports (public posts): **Facebook** median 98 chars, 0.44 hashtags/post, 5% lowercase starts; **Instagram** median 111 chars, 1.75 hashtags/post, 22% lowercase starts, ~1 emoji/post.

## Traps

- **Facebook HTML is class-obfuscated.** The adapter splits blocks on the repeated `uiBoxWhite` class and takes the last date-only div as the timestamp. If Facebook renames it, the adapter finds nothing — the dry run's counts will show it. Prefer asking for **JSON** exports where offered.
- **HTML times have no timezone** (Facebook and Instagram HTML). Converted from `America/Chicago` (DST-aware) with `tsConfidence:'medium'`; if an export is really UTC, stored times are off by 5–6 h and a late-evening post can land on the wrong day. The ingest CLI does not expose `tz` yet. Pass `tz` to `parse()` to override.
- **Event names:** the Facebook events export has no name field; `text` starts with the description.
- Matching uses `nas.relativePath` (the original path). The analyzer **copies**, never moves, so paths stay valid. If the older organizer (W-B) moves files, matching needs `nas.organizedPath` as a second candidate.
- The Brain hook is opt-in; with neither `platform` nor `topic` it is byte-identical to before.

## Open items

- Real **X** archive to validate `adapters/x.js` (none on the NAS yet).
- Real **Instagram JSON** export (the one on the NAS is HTML). Locate the photo/video files for @bai__ee (the export has none) so posts can link to media.
- Expose `--tz` on the ingest CLI; verify the real timezone of the Instagram HTML export.
- Import the other Facebook exports on the NAS (`facebook-bryanballi7`, `facebook-secretstudiorecords`, `facebook-SoundsFromTheDivide`) and decide which client owns each.
- EXIF / video-container **taken** dates (plan P4), then the Unknown group and the old `2020/` folder clean-up.
- Brain "Content library" tab (plan P6); an analyzer-side "Import archive" button instead of the CLI.
- Browser-verify the Timeline tab and the drawer's Posted copy section.
