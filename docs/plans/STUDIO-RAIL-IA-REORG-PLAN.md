# Studio Rail IA Reorg — Plan (approved schematic, implementer handoff)

**Status:** EXECUTED 2026-08-01 (Sonnet implementer, Fable-verified live; uncommitted). All three phases shipped with one accepted deviation: **Scene Templates stays two adjacent cards** (grouped under the OUTPUT bucket, not merged into one shell) — `SceneTemplatesCard.jsx` renders its own RailCard wrapper internally, so a true merge would have violated this plan's own "don't modify component internals" rule; the implementer correctly stopped and the grouped state was accepted as final. Also accepted: the Diffusion Camera descriptive hint moved with its card; camera Undo/Redo stayed in Camera (`camHistoryRef` spans both cameras). Verification: 1033/1033 studio tests after every phase, `npm run build` succeeded, live DOM audit confirmed all 5 bucket labels + every legacy and new `#cloth-*` id present in exactly the planned order.

Original plan follows for reference.

~~**Status:** PLAN — approved in shape by owner (2026-08-01), not implemented.~~ Presentation-only pass: JSX regrouping, ZERO state/logic changes.

**File:** everything lives in `app/dashboard/studio/ClothStudio.jsx` (the rail render, ~L7100–8200 as of writing) plus the standalone card components it mounts (`components/Studio*.jsx`). Card open/closed state vars and every existing DOM id MUST survive unchanged (global DOM-naming rule + users' muscle memory for `#cloth-*-panel` anchors).

## Why

17 cards with no grouping, and three cards doing unrelated jobs:
- **Images** carries five: artwork library, primary-shape selector (Flyer/T-Shirt/Device), T-shirt print, the entire Device stack (screen capture/live/upload, scroll, scale, sway, colors), and Image Layers.
- **Background** carries the backdrop AND the environment light (IBL) — light, not backdrop.
- **Camera** carries the shot cam AND all ten Diffusion Camera controls.

## Target IA — 5 buckets, 15 cards

```
━━ STAGE — what's in the scene ━━━━━━━━━━━━━━━━━━━━━━━━━━━
├─ Subject            ← NEW (split from Images): Flyer/T-Shirt/Device selector
│   ├─ Flyer: aspect presets                (from Images "SHEET SHAPE")
│   ├─ T-Shirt: hanger + print controls     (from Images)
│   └─ Device: type · screen (capture/live/upload) · scroll · scale  (from Images)
├─ Artwork            ← NEW (split from Images): upload/library — prints on the subject
├─ Image Layers       ← promoted to own card: add-PNG button + hint
├─ Elements           (unchanged)
├─ Inspector          (stays glued directly under Elements)
├─ Glass              (moved up from the LOOK region — it's a stage object)
└─ Hero Text          (title overlays; pairs with the bottom Timeline bar)

━━ LOOK — how it reads ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
├─ Material           (unchanged)
├─ Background         (modes · image fit+shift · diffusion-on-bg; LOSES env light)
├─ Lighting           (cans + templates + ENVIRONMENT LIGHT ← moved from Background)
└─ Effects            (unchanged)

━━ MOTION — how it moves ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
├─ Animate            (unchanged)
└─ Physics            (unchanged; one-line hint pointing at the Timeline bar)

━━ CAMERA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
├─ Camera             (orbit lock · shot cam · HUD · cam undo/redo)
└─ Diffusion Camera   ← promoted out of Camera (10 controls + badge + notes)

━━ GENERATE & OUTPUT ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
├─ Randomize          (unchanged)
├─ Curated Sets       (unchanged)
├─ Scene Templates    ← MERGED: "Saved (this browser)" + "Cloud (team/global)" sections
└─ Render             (unchanged)
```

Bucket order = making-order: build the stage → style it → move it → frame it → ship it.

## Exact moves (nothing else changes)

| Move | From | To | Notes |
|---|---|---|---|
| SHEET SHAPE row + T-SHIRT PRINT + `#cloth-device-primary-section` | Images card | new **Subject** card (`#cloth-subject-panel`) | The whole device stack moves as one block — screen + hardware stay together |
| Artwork picker/upload/delete/library | Images card | new **Artwork** card (`#cloth-artwork-panel`) | `artworkId`/library state untouched |
| `#cloth-image-layer-add-btn` + hint | Images card | new **Image Layers** card (`#cloth-image-layers-panel`) | |
| ENVIRONMENT LIGHT grid + LIGHT INTENSITY | Background card | Lighting card | env state/handlers untouched |
| DIFFUSION CAMERA block (badge → LOCK, incl. `#cloth-diffusion-camera-*` ids) | Camera card | new **Diffusion Camera** card (`#cloth-diffusion-camera-panel`) | Camera keeps shot cam/HUD/undo-redo |
| Scene Templates + Scene Templates — Cloud | two cards | one **Scene Templates** card, two labeled sections | keep both components; the card is just a shared shell |
| Glass card position | LOOK region | STAGE bucket after Inspector | pure reorder |
| Hero Text position | above Material | end of STAGE bucket | pure reorder |

New open/closed state: new cards need their own `useState` open flags (Subject/Artwork/ImageLayers/DiffusionCamera default to the old parent card's current defaults). The retired `Images` card's open flag maps to Subject.

Bucket headers: a lightweight non-collapsing label row component (e.g. `RailBucketLabel`) between card groups — text + hairline, same `ui.label` idiom, ids `#cloth-rail-bucket-stage` etc.

## Kill list (during Phase 3 polish)

- The name "Images" (dies with the split).
- Subtitles that don't state current value — every card subtitle should read like `Device · critters.quest`, `4 layers`, `Bloom · Grain 4%`.

## Risks

- The Images split moves the rail's largest JSX block (device/live/capture controls) — mechanical but the diff is big; move it verbatim, no editing in flight.
- `uploadBtnStyle`/`ui.*` and handler closures are component-scope — moves within the same component body are safe; nothing moves across component files.
- Card-order muscle memory changes once — the bucket labels are the compensation.
- No tests cover rail layout; the safety net is `npm run build` + a click-through of every moved control (each moved section has at least one stable id to verify against).

## Phases (stop between each)

1. **Bucket headers + reorder only.** Add the 5 labels, resequence existing cards. No content moves. Verify: all 17 cards render, ids unchanged.
2. **The three splits + env-light move.** Images → Subject/Artwork/Image Layers; Diffusion Camera out of Camera; Environment Light into Lighting. Verify: every moved control works live (capture, live screen, print sliders, env swap, diffusion dials).
3. **Merge + polish.** Scene Templates merge, naming/subtitle/icon pass per the kill list.

## Out of scope

Timeline bar (stays as-is), any control behavior/state change, mobile layout work, the Mockup Video tab.
