# CQ Creative Brief template (v1)

Fill this in for every Critters Quest gameplay/how-to video, then save it as the post's Creative Brief (`queue.post.video-brief.save`, `template`). Plain text, 8000 characters max, never published. When the owner approves the brief, HITLOOP turns it into a video request itself (`features/brief-video/brief-author.js`, Sonnet, one call plus one repair) and renders from that. Do not call `video.howto.request.submit` yourself for a Creative Brief.

Rules: describe only what the game scenes below can show. If a shot needs something not listed, say so in the brief ("NEEDS: ...") instead of faking it: the build fails with `unsupported:<shot>:<what>` and the owner sees it.

## Fields

- **Creative ID**: short code, e.g. CQ-S3-1119.
- **Title**: working title.
- **Type**: how-to | feature-promo.
- **Format**: e.g. vertical 9:16 video.
- **Length**: seconds, e.g. 21s.
- **Host**: none | mayor. `none` = a cursor walks the game (no host character).
- **Narration**: on | off.
- **Audience**: who it is for.
- **Goal**: what the viewer should do or understand.
- **Hook**: the first line, in words.
- **Opening banner**: 2-3 words, UPPERCASE.
- **Shots**: table, one row per shot: time range | what viewers see (game scene) | on-screen text | LATER y/n. Use 2-4 gameplay shots; the opening town shot is separate.
- **Gameplay label**: small on-screen tag, e.g. CURRENT GAMEPLAY.
- **Payoff**: what the viewer gets at the end of the gameplay.
- **Ending**: art path under `art/...` or `standard end card`, end caption, CTA line.
- **Audio**: music / sound notes.
- **Post copy**: the public post text (280 chars max; it goes in the post, not the video).

## Available game scenes

Generated from `features/brief-video/howto-catalog/catalog.json` (a test fails if this list drifts from it).

- **town establish shot**: the opening view of the town.
- **spotTile**: selecting a resource spot on the map (also `spotTileWide`). Actions: selectSpot, openInfo, openTools, openClaim. States: idle, selected, completed, ready, cycle.
- **spotInfo**: the spot info panel. Actions: close. States: idle, gathering, claimable, claimed.
- **critterSelection**: choosing a critter and sending it out. Actions: selectCritter, send, continue. States: list, selected, processing, sent.
- **spotClaimReward**: the claim reward screen. Actions: claim, close. States: claimable, processing, claimed.

Host: mayor, or none.

## Art

Upload to NAS `Critters Quest/video-assets/incoming`, then reference the `art/` path once the owner confirms it is added. Currently available: `art/posters/s3-first-look.jpg`.

## Example (CQ-S3-1119)

```
Creative ID: CQ-S3-1119
Title: Before the Titans: your first gathering run
Type: how-to
Format: vertical 9:16 video
Length: 21s
Host: none
Narration: off
Audience: new and returning players before Season 3
Goal: show the first gathering run so players are ready for Season 3
Hook: Before the Titans, your first gathering run.
Opening banner: GATHER FIRST

Shots:
| Time    | What viewers see                         | On-screen text         | LATER |
| 0-3s    | Town establishing shot                   | GATHER FIRST           | n     |
| 3-7s    | spotTile: select a resource spot         | 1. SELECT A RESOURCE   | n     |
| 7-11s   | critterSelection: choose a critter       | 2. CHOOSE YOUR CRITTER | n     |
| 11-14s  | critterSelection: send it                | 3. SEND (LATER)        | y     |
| 14-18s  | spotClaimReward: claim the reward        | 4. CLAIM               | n     |
| 18-21s  | Ending art                               | TOMORROW: SEASON 3 FIRST LOOK | n |

Gameplay label: CURRENT GAMEPLAY
Payoff: the haul is claimed and stocks your town.
Ending: art/posters/s3-first-look.jpg | TOMORROW: SEASON 3 FIRST LOOK | Return tomorrow for the Season 3 reveal.
Audio: light upbeat music, no voice-over.
Post copy: Before the Titans arrive, do your first gathering run. Season 3 first look tomorrow.
```

## Changing the video after it renders

Do not rewrite the brief for small changes. In the post's Creative Brief panel, type what should change in the feedback box ("Make the banner shorter") and send it: the video request is revised, the draft's video is re-rendered and the old video is kept as an earlier version. "Use this version" restores any earlier version (it re-renders that one). Feedback and versions work on drafts only, and only for videos made from a brief (never a video you uploaded). See CQ-DAILY-BRIEF-VIDEO.md section 16.
