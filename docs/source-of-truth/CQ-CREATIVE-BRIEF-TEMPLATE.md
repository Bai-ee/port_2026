# CQ Creative Brief template (v2)

For ChatGPT (the strategy and creative writer of the Critters Quest calendar). Save each calendar post's brief with `queue.post.video-brief.save`, ALWAYS using the structured `v2` argument (the fields below, exactly). Never put the brief only in free text `template`; that is the old v1 path. Source spec: the CQ Director's `CREATIVE_BRIEF_V2.md`, `CHATGPT_PROMPT.md`, `KIT_CATALOG.md`, `GUIDE_LESSONS.md`.

## Purpose and what happens next

Every calendar video is a real Critters Quest EPISODE (bar: E27 "Fighting Gravitax", E31 "Titans Are Coming", E01 "The Mayor's Guide"). You write the creative INTENT; the CQ Director on the video side turns it into a storyboard for the owner, and only a storyboard the owner approves is built into a video.

- You SAVE only (`status` `draft` or `ready`). You never approve, render, publish or schedule, and you never call `video.howto.request.submit`.
- `ready` is refused (400, with the list of missing fields) until the brief is complete. Save `draft` while you work, then `ready`.
- The owner approves the brief in HITLOOP, or from the MCP (`creative_brief_review`) once the Director has accepted the current version. Today an approval leads to a STORYBOARD (outline + frames) for the owner to review, not to a render. Do not promise a video. Never approve on the owner's behalf.
- The brief text shown in the panel is generated from your fields. Write plain language: intent and real game moments, no pixel, frame or camera numbers.

## Three formats

1. **feature**: a story around one feature, built from approved game scenes (E27, E31).
2. **guide**: a host walks the viewer through ONE in-game guide lesson on the real UI (E01, the gather how-to): designed poster, the host on his dock, the lesson's real click path, a payoff, the end card, narrated. This is the default for every "how does X work" post. Ask with `format: guide`, `lesson`, `host`, `focus`.

3. **promo**: a short (15-23 s) animated poster built from an approved live treatment, not an episode. Set `treatment`, `cast` and `bubbles`. 1-3 beats; the two-cursor-actions rule does not apply, but something must still happen (a parallax drift, a rise, a clash, converging lines, a card swap). Money lines on a statCard need the owner's OK. Treatments:
   - `faceOff`: two game characters face off with an energy clash, two bubbles (live: Oct 16 Gravitax vs skull duck).
   - `mapConverge`: the real game map with full HUD, attack lines converging on a landmark, a bubble and a date banner (live: Nov 5 World Bank Battle). Never a real player name in a bubble.
   - `hostPoster`: a host (Mayor, Gravitax, a Titan, an NPC) in front of the lockup with a bubble and banner (live: Oct 13 THE GUIDE, Nov 6 LAST DAY).
   - `heroRise`: one Titan or character rises over its in-game background with logos and a date banner (live: Nov 13 DECEMBER 18TH).
   - `statCard`: a stat card with badge, building art and a big line (live: Season 2 in numbers; money lines need the owner's OK).

The game ships 28 lessons; each has a teacher (host = that NPC, or the Mayor). Lesson (teacher):
- Town Hall, Your Profile (Mayor)
- The Bank, Boosts, Vouchers, Resource Market, Speedup Wheel, Vault Shards, World Bank (Banker)
- Your First Squad, Building a Squad, Posting a Defender, Visiting a Town, Raiding a Town, Reading a Raid Report, Attacking a Monster, Reading a Battle Report (Mandryll)
- The Hospital (Sallow), The Market (Bruno), The Muddy Anvil (Hammersnout), The Glowing Cog (Bytefang), The Gleaming Nest (Gemsworth), The Mystic Mirror (Highseer), The Bubbling Barrel (Koaldron)
- Beach Chests, The Graveyard (Reaper), Spin Wheels, The Clone Manifest (Dark Platypus)

If the teacher has no animated rig yet (Sallow, Bytefang, Reaper), write `host: mayor`. One lesson slice (3-5 steps, 20-30 s) per video; a long lesson (World Bank, about 49 steps) is a series, never one video.

Readiness (check before choosing a lesson; not ready is not a reason to change the topic, see "Gaps"):
- **Ready now**: the gather loop, World Bank (parts), Vault Shards (owner-check the Season 3 dating), Raiding a Town, the Charter guide.
- **Being built now**: Posting a Defender, Building a Squad / Your First Squad, The Town Hall (upgrades), Visiting a Town, Attacking a Monster. Use them and list the missing panel in `needs`.
- **Owner-check (money is the subject)**: The Bank, Boosts, Vouchers, Resource Market, Speedup Wheel, The Market, Spin Wheels, The Clone Manifest. Do not schedule without the owner's OK; write `OWNER OK:` in `mustNot` only after the owner gave it.

## First-time-right: what a brief must LOCK (owner standard, 2026-11-20)

A brief is `ready` only when it fixes all six (the Director still picks camera and timing). Source: `CREATIVE_BRIEF_V2.md` "First-time-right", `formats/chapter-story.md`; the library's `formats.chapterStory` and `posterHeroes` hold the details.
1. **Format**: feature | guide | promo | chapter (a chapter story: 3-5 steps in order, one real scene per step, `format: chapter`).
2. **Poster hero** (`poster.hero`, at most 80 characters): a library `posterHeroes` character, the real place, idle, facing camera, e.g. "king-critter, inside the town, idle, facing camera"; plus a two-line `poster.banner`. No Titans on the poster unless the topic is Titans. Required for feature, guide and chapter; a warning for promo.
3. **Steps / beats in order**: each = a real library scene id + what visibly happens in it + its label (chapter story: the beat `caption` is its chapter banner, "MONSTERS / CHAPTER 3"). The scene must show exactly what its narration line says.
4. **Narration, verbatim and final**: one short line per step plus a poster line, ellipses for beats ("Then... monsters!"), no verb repeated across lines, dates in words, last line a call to action. `voiceMode: narrated`, one steady pace, music bed.
5. **End card**: the still art and its banner with the CTA "CRITTERS QUEST / PLAY NOW!".
6. **Length**: 22-30 s (up to 34 s for a 5-chapter story).

Ready gate (every format): `poster.idea`, `poster.banner` and `poster.hero` present; each beat has a real `screen`, a visible happening (cursor or response) and a `caption`; when narrated, `narrationLines` at least beats + 1 (poster line + one per beat) and the last line a call to action (warning only); `end` present. For promo the hero, the narration count and the CTA are warnings. `chapter` is just an allowed format value (up to 34 s); the Director decides the structure from the brief.

## Story rules (an episode, not a short)

- 22-30 s, square 1080x1080. Arc: designed poster (the thumbnail) -> where we are -> the one idea -> the ACTION -> payoff -> end card. Your beats add up to 30 s at most (the server refuses more); aim for about 20-27 s.
- Every beat after the poster shows something HAPPENING in the real game: a click, a window opening or changing, a squad picked, a timer or bar moving, a unit walking, a level changing, a strike. No beat is just a hold or a glide. No hold longer than about 2 s.
- At least 2 real cursor actions in the episode, in the order the game requires.
- One hero moment the viewer remembers, and a payoff that visibly happens.
- Captions are editorial and concrete, about what the viewer sees ("PICK A READY SQUAD", "SET YOUR DEFENDER"), never moods ("THERE IT IS", "MOVE WITH INTENT").
- Narrated by default: a calm narrator (or the guide host) explains what is happening; short lines; dates in words; numbers never spoken; no word repeated across lines.
- Never change a post's topic because a scene is missing. Keep the topic, write the idea, and put the gap in `needs`.

## Rules

- **Game art only.** Every frame comes from the game's own art and UI or an approved scene. No supplied posters or new artwork. Supplied art that carries its own banner is shown static, exactly as supplied (nothing on top).
- **Real UI, full state.** Never ask for cropped or hidden UI; ask for a real state in which the unwanted thing is not present (for example the pool card collapsed). If the state does not exist, write `NEEDS: <what>` in `needs`; never ask for a fake.
- **Money: incidental, never the subject.** Natural game economy UI may appear incidentally ($QUEST balance, resources, inventory, town resources, critter stats, in-game currencies, a real window's own fee pill or pool line). Never featured (not the subject, not in captions, banner, bubble, narration or post copy, never highlighted or zoomed): USD, SOL price, token price, floor, ROI, yield, pool values, reward amounts, investment framing.
- **No unverified Season 3 mechanics** (rounds, fees, daily rotation, rewards, Titan count at launch). The approved Titan names are fine; ability names need `owner-check`. No real player names, no "beta", no mint or price promises.
- **Dec 18 campaign.** Every promo drives to Season 3 on December 18. `end` = the campaign end card: TITANS ARE COMING / SEASON 3 · DEC 18. The call to action lives in `postCopy`, never drawn on the video.

## Approved scenes you can name

Write each beat's `screen` from this catalog (condensed from the Director's KIT_CATALOG.md). Anything else: `needs`.

- **Titans (Season 3)**: titans.poster (seven lit Titans under the wordmark, banner reworded) · titans.mayor-dock (Mayor on his dock: "Titans are waking up across the map") · titans.wake-on-map (fly into the real map with full HUD, Floranix awake on its building) · titans.roll-call (the seven Titans rise on the map with names: Floranix, Terravus, Axiom, Aquaris, Chronos, Solus, Necrothis) · titans.line-up (attack wave; ability names owner-check) · titans.window (the real Titan window, a squad picked, ATTACK pressed; fee and rounds only incidental) · titans.end (end card). Not available: single-Titan stat close-up, countdown to Dec 18, Titan HP drain or victory, faction-of-the-day.
- **World Bank / Gravitax (live)**: poster (several layouts, lava theme) · arrival (lava map, full HUD, World Bank sign, castle click, dive) · guardian (World Bank window, shared health bar, Gravitax in front, pool card collapsed) · squads (real states ready / COOLDOWN / WALKING HOME; pick a squad; Attack; the camera can push onto the cards) · swing (Gravitax swings, the bar drops) · end (campaign card). Frozen mock numbers: never quote them. Battle report: money featured, owner-check.
- **Raids**: raid.target (two towns, tap the rival) · raid.march (red line, a squad walks) · raid send modal and the defender's raid.warning banner (mock numbers, owner-check).
- **Vault Shards**: the dome cracks, shards scatter (ready to hook); shard map, window and contest are owner-check (Season 2 data).
- **Gather loop**: town / map, select a resource spot, choose and send a critter, the gathering bar, claim reward (the claim screen shows rewards: money featured unless approved).
- **Mayor's Guide (E01)**: Mayor dock, Charter panel, lesson play/go. The Season 2 poster and end card are owner-check.
- **Not available yet**: the squad builder modal, Visiting a Town view, and any scene the library marks `needs-build` (for example `shards.cracks`). A post about one of these keeps its topic and lists `NEEDS: <panel>`; never name it in a beat `screen`.
- **Town and raid UI (real)**: the town upgrade panel (`town.upgrade-panel`), the incoming-raid warning (`raids.incoming-warning`) and the Town Defense screen (`raids.defense-tab`) are REAL, owner-approved game UI rebuilt from the game code, not fake UI.

### Fallback: older cursor-template scenes

Used only when no kit fits, and say so in `needs`. They cannot carry a poster, full chrome or a payoff. Generated from `features/brief-video/howto-catalog/catalog.json` (a test fails if this list drifts from it).

- **town establish shot**: the opening view of the town.
- **spotTile**: selecting a resource spot on the map (also `spotTileWide`). Actions: selectSpot, openInfo, openTools, openClaim. States: idle, selected, completed, ready, cycle.
- **spotInfo**: the spot info panel. Actions: close. States: idle, gathering, claimable, claimed.
- **critterSelection**: choosing a critter and sending it out. Actions: selectCritter, send, continue. States: list, selected, processing, sent.
- **spotClaimReward**: the claim reward screen. Actions: claim, close. States: claimable, processing, claimed.

Host: mayor, or none.

## Ready rules (the server refuses `status: ready` until all hold)

Drafts may stay incomplete; `ready` (and approval) runs these, and the error lists exactly what to fix.

1. **Every beat, every format:** non-empty `camera`, non-empty `transition`, and a `cursor` or a `response`. `poster.idea` is required.
2. **feature and guide:** at least 3 beats; 20-30 s in total; at least 2 beats whose `cursor` is a real action (not empty, `none`, `no cursor`); no beat that is only a hold or glide (a `response` with hold / glide / pan / linger and no action verb such as open, click, tap, pick, select, press, set, rise, wake, swing, drop, march, claim, upgrade, start, complete, fill, send, appear, when the beat has no cursor action).
3. **promo:** `treatment` is one of the library `promoTreatments`. `heroRise`, `hostPoster` and `faceOff` cast entries must be characters (Mayor, Banker, Mandryll, Gravitax, the seven Titans: Floranix, Terravus, Axiom, Aquaris, Chronos, Solus, Necrothis); a building such as "Vault" is not a character. `faceOff` needs exactly 2. `mapConverge` target is "World Bank" (the only landmark supported today). A promo beat never uses a feature/guide scene id (for example `titans.mayor-dock`).
4. **Built scenes only:** a beat `screen` that names a scene the library marks `needs-build` is refused. Keep the topic and put it in `needs`, or choose a ready scene.
5. **Format fits the post:** if the post's own copy reads as a how-to / "what changed" / tour / step / guide post, the format must be `guide` or `feature`, never `promo`. **Promo is for announcements/hype only; how-to and "what changed" posts are guide or feature episodes.** The post's topic and copy are fixed: saving a brief never changes the post, and `postCopy` should match it (a large difference is returned as a warning).

## The v2 fields (exactly the `v2` argument of `queue.post.video-brief.save`)

Required to mark `ready` for feature, guide and chapter: format, angle, poster.banner, poster.hero, hero, theme, at least 3 beats (each with screen, cursor or response, and a caption; write `none` for no caption), payoff, end, voiceMode (and narrationLines when narrated: at least beats + 1, lesson when guide). Required to mark a **promo** `ready`: format, treatment, cast, poster.banner, bubbles or hero, theme, at least 1 beat (screen, response or cursor, caption) totalling 15-23 s, end (`none` if the treatment has no end card), voiceMode (narrationLines when narrated). Everything may be empty in a `draft`.

| Field | What to write | Limit |
|---|---|---|
| `format` | `feature`, `guide` or `promo` | enum |
| `treatment` | promo only: `faceOff`, `mapConverge`, `hostPoster`, `heroRise`, `statCard` | enum |
| `cast[]`, `bubbles[]` | promo only: game characters or landmarks on the poster (max 6); up to 3 short bubble lines | 120 each |
| `lesson`, `host`, `focus` | guide only: the lesson title, its teacher (or `mayor`), the one slice of the UI | 120 / 120 / 400 |
| `angle` | Why this episode exists and how it differs from the closest shipped or recent video (name it: E21 Vault Shards, E27 Fighting Gravitax, E30 Titans guide, E31 Titans teaser, or a recent draft): idea, hero moment, poster look | 400 |
| `poster.hero` | The poster hero, at most 80 chars: a library posterHeroes character, the real place, the pose ("king-critter, inside the town, idle, facing camera"). Required to mark ready (a warning for promo) | 80 |
| `poster.idea` | The designed first frame: who is on it, the world or theme (lava = Gravitax). Not a screenshot of beat one | 400 |
| `poster.banner` | 2-4 words, an action phrase that sells what the player can DO | 120 |
| `poster.dateLine`, `poster.bubble` | optional second banner line (date or offer); optional speech bubble | 120 |
| `hero` | The one moment the viewer remembers, in one or two sentences. No hero moment = concept not ready | 400 |
| `theme` | One sentence: what the viewer understands at the end | 400 |
| `beats[]` | feature/guide: 1-6 objects (3+ to be ready), 30 s total; promo: 1-3, 15-23 s total. See below | 6 items |
| `payoff` | What visibly happens at the end of the gameplay | 400 |
| `end` | The campaign end card, or an approved `art/...` path | 400 |
| `mustNot` | What this video may never say or show, plus anything post-specific | 400 |
| `voiceMode` | `narrated` (default), `caption-only`, `music` | enum |
| `voiceReason` | Why it is not narrated; required (non-empty) for `caption-only` / `music` | text |
| `narrationLines[]` | Up to 8 short calm lines. Dates in words, no numbers spoken, no word repeated across lines | 8 x 200 |
| `needs[]` | `NEEDS: <scene or panel not built yet>`, one per entry | 10 x 160 |
| `postCopy` | The public post text; it goes in the post, not the video | 280 |

Each beat has these keys (all strings of at most 160 characters, plus `seconds`):

| Key | What to write |
|---|---|
| `purpose` | Why the beat exists: arrival, the idea, the decision, the action, the payoff |
| `screen` | A REAL game screen AND its state ("World Bank window, guardian state, pool card collapsed"). Never a mood |
| `camera` | Framing in words: creep, push onto the cards, pull back |
| `cursor` | What the player clicks, in the order the game needs; `none` if nothing |
| `response` | What the game does next: window opens, bar drops, level plate changes |
| `caption` | Editorial and concrete, about what the viewer sees; `none` only if narrated |
| `transition` | Into the next beat; prefer continuous motion |
| `seconds` | 1-15; holds about 2 s or less; all beats together 30 s at most |

## Worked example: Nov 19 "Which fight first?" (feature)

Post `social_1795122401104_f4bhkx`. The v1 brief asked for: Valdara with a monster, pause on the target, open squad selection, choose Critters, stop at the attack decision. Here it is as a v2 episode (this block is checked by a test: it must validate and be ready).

```json v2-example
{
  "format": "feature",
  "angle": "Readiness, not the fight. E27 teaches HOW to attack; this is the decision before you swing: which squad is ready. Gravitax close-up on the left (E27 had him right), hero is the squad cards, no battle report.",
  "poster": {
    "idea": "Gravitax huge on the left under the wordmark and Season 3 numeral, lava theme; a designed frame, not a screenshot of beat one.",
    "hero": "gravitax, lava map under the dome, idle, facing camera",
    "banner": "WHICH FIGHT FIRST?",
    "dateLine": "TITANS LAND DEC 18",
    "bubble": "Is your squad ready?"
  },
  "hero": "The camera pushes onto the squad cards while the cursor passes COOLDOWN and WALKING HOME, then lands on the ready squad: the selected-squad panel flips to At the Bank.",
  "theme": "The first hit goes to the squad that is ready, so check before you swing.",
  "beats": [
    { "purpose": "arrival: where you are", "screen": "gravitax.arrival: Valdara lava map, full HUD and World Bank sign, Gravitax asleep under the dome", "camera": "slow creep, then the dive", "cursor": "click the castle", "response": "the dome pushes into the World Bank window", "caption": "none (narration carries it)", "transition": "continuous push", "seconds": 5 },
    { "purpose": "the target", "screen": "gravitax.guardian: World Bank window, guardian state (Ends-in, Weakening, HP, pool card collapsed), Gravitax rises in front", "camera": "creep", "cursor": "none", "response": "the shared health bar drains a sliver", "caption": "CHECK THE TARGET", "transition": "the window grows into the picker", "seconds": 4.5 },
    { "purpose": "the decision (hero)", "screen": "gravitax.squads: squad picker: two ready squads, one COOLDOWN, one WALKING HOME", "camera": "push onto the cards, then ease back to show the button", "cursor": "hover COOLDOWN, hover WALKING HOME, click the ready squad, click Attack", "response": "selected squad panel reads At the Bank", "caption": "PICK A READY SQUAD", "transition": "cut on the Attack click", "seconds": 7 },
    { "purpose": "payoff: it counted", "screen": "gravitax.swing: Gravitax swing framing from the World Bank window", "camera": "the E27 swing framing", "cursor": "none", "response": "Gravitax swings and the shared bar visibly drops", "caption": "THE FIRST HIT COUNTS", "transition": "into the end card", "seconds": 4 }
  ],
  "payoff": "The hit lands; the shared bar visibly drops.",
  "end": "standard campaign end card: TITANS ARE COMING / SEASON 3 · DEC 18",
  "mustNot": "Feature or speak pool, fee or reward values; claim unverified Season 3 mechanics; reuse E27's report or poster layout; show real player names.",
  "voiceMode": "narrated",
  "narrationLines": [
    "Some of your squads are resting.",
    "Check the target first.",
    "Then choose the squad that is ready.",
    "That first hit decides the fight.",
    "Critters Quest. Play now!"
  ],
  "needs": [],
  "postCopy": "Get a ready squad in before December 18."
}
```

A promo example (also checked by a test):

```json v2-promo-example
{
  "format": "promo",
  "treatment": "heroRise",
  "cast": ["Axiom"],
  "poster": { "idea": "Axiom rises over the Season 3 skyline.", "hero": "mayor, inside the town, idle, facing camera", "banner": "THE TITANS ARE COMING", "dateLine": "DECEMBER 18TH" },
  "hero": "Axiom rises out of the dark over its in-game background.",
  "theme": "The Titans arrive on December 18.",
  "beats": [
    { "purpose": "the rise", "screen": "titans.wake-on-map: Axiom's in-game background with the wordmark", "camera": "slow push in", "cursor": "none", "response": "Axiom rises from below the frame as the glow builds", "caption": "AXIOM WAKES", "transition": "into the date banner", "seconds": 9 },
    { "purpose": "the date", "screen": "titans.window: same background, logos and date banner", "camera": "hold with a parallax drift", "cursor": "none", "response": "the date banner slams in and the logos settle", "caption": "DECEMBER 18TH", "transition": "end", "seconds": 8 }
  ],
  "end": "none",
  "mustNot": "No prices, rewards or unverified Season 3 mechanics.",
  "voiceMode": "music",
  "voiceReason": "silent poster: the rise and the date banner carry it, music bed only",
  "postCopy": "The Titans arrive December 18th."
}
```

## Checklist before saving

- [ ] The post's topic is unchanged; gaps are in `needs`, not a swapped idea.
- [ ] `angle` names the closest shipped or recent video and what differs.
- [ ] A designed poster (banner 2-4 words), a hero moment in one sentence, a theme in one sentence.
- [ ] Promo: treatment, cast and banner set; 1-3 beats, 15-23 s, something happens in each. Otherwise: 3-6 beats; in EVERY beat something happens (cursor action and/or what the game does), on a real named screen and state; at least 2 cursor actions overall; holds about 2 s or less; total at most 30 s.
- [ ] Every beat has camera, transition and a cursor or response; `poster.idea` set; feature/guide: 20-30 s, 2+ real cursor actions, no hold-only beat; promo: character cast per treatment, no feature/guide scene id; no needs-build scene in a `screen`; the format fits the post (how-to = guide/feature).
- [ ] Captions are concrete; payoff visibly happens.
- [ ] No money subject, no unverified Season 3 mechanics, no real player names; `end` is the campaign card or an approved `art/...` path; the call to action is in `postCopy` only.
- [ ] Narrated: `narrationLines` written (short, dates in words, no numbers).
- [ ] Differs from the last few CQ videos (check recent drafts and posts first).
- [ ] Saved with `v2` and status `draft` or `ready`. Not approved, not rendered.

## Old v1 briefs

A v1 brief (free text in `template`, Creative ID / Title / Type / Shots table / ...) still works and is turned into a video request when the owner approves it. Do not write new ones for Critters Quest episodes. A change after a v1 video renders goes through the panel's feedback box (see CQ-DAILY-BRIEF-VIDEO.md section 16). v2 briefs have no feedback or versions yet: owner notes go on the storyboard.

## Art

Supplied end art is not planned on (game art only). Currently available if the owner asks for it: `art/posters/s3-first-look.jpg`.
