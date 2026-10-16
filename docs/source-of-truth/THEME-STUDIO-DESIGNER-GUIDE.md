# Theme Studio: designer guide

For designers. You do not need to read code. Engine and schema details live in [`THEME-STUDIO.md`](THEME-STUDIO.md); the binding spec is [`../plans/THEME-STUDIO-CONTRACT.md`](../plans/THEME-STUDIO-CONTRACT.md).

## What it is

Theme Studio changes the colors of the whole site from one place: both Light and Dark, the animated background, and the accent colors. Everything you do is a **local draft** stored in your own browser. Nothing reaches visitors until a developer publishes the file you export (see "Hand off").

## What's in the Studio

Top to bottom: **Mode and preset**, **Master controls** (hue, intensity, chroma, lightness shift, contrast, dark depth, warmth, hue spread, each with its own Reset), **Palette combos** (ready-made combos plus a harmony builder with Generate and a seeded Shuffle), **My themes** (save, load, star and back up named snapshots in this browser), then **Palette**, **Background object**, **Advanced roles**, **Accessibility**, **Compare** and **Save, export and import**. Click any color swatch to open the color picker and set an exact value. The suggested ranges are only hints; you can go to the extremes, and the "Hide suggested-range hints" switch in Palette hides the warnings.

## 1. Open it

- Sign in as an admin and click **Theme Studio** (bottom left), or press **Alt+Shift+T**.
- On a laptop it opens as a panel on the right and the page stays usable, so you see your changes live. On a phone it opens as a bottom sheet.
- Close with the X, or press **Esc** (Esc first closes any open confirmation, then the panel).

Two labels at the top are always visible:

- **Editing**: which palette (Light or Dark) the controls change.
- **Previewing**: which mode this page is showing.

They are separate on purpose. You can edit the Dark palette while the page still shows Light. When they differ, a dashed outline reminds you.

## 2. Move one slider

Open **02 Master hue** and drag **Master hue**. The accent, supporting colors and decorative gradients follow in both palettes at once.

- Type a number instead if you prefer. 370 wraps around to 10.
- Arrow keys nudge by 1, hold **Shift** for 10, **Home** and **End** jump to the ends.
- **Intensity** goes from grey (0) through today's look (1) to punchy (1.5).
- Dragging counts as one step in undo. Use **Undo / Redo** in the header, or Ctrl/Cmd+Z.

## 3. Refine

**03 Accent, supporting and neutrals** shows the colors the slider produced, grouped. Each group has a badge:

| Badge | Meaning |
|---|---|
| **Linked** | Still follows the master hue (or another color). Moves when you move the slider. |
| **Custom** | You set it by hand. The master slider no longer changes it. |
| **Locked** | Custom, and protected: master moves, "copy between palettes", reset palette and contrast suggestions all leave it alone. |

Click any color to open it in **05 Advanced roles**. There you can press **Make custom** (the color does not jump), **Lock**, **Reset**, or **Copy to Dark** / **Copy to Light** for just that color. Typing a HEX works on custom colors. Status colors (success, warning, danger, info) keep their hue so they keep their meaning; adjust lightness and chroma only.

Also in section 03: the hue spread of the supporting colors, how strong the warm tint of the neutrals is (0 removes it), and small per-palette tuning.

## 4. Tune both palettes

Switch **Editing** to Dark (section 01) and repeat. The Dark palette is new design, not an inversion, so review it before trusting it.

Helpful shortcuts in section 01:

- **Copy Light to Dark** (or the reverse) gives one palette the other's values once.
- **Dark follows Light** keeps one palette tied to the other. Check contrast afterwards.
- **Preview** switches what the page shows: Light, Dark, or System.
- **Before and after** flips the page between your draft and the published theme.

## 5. The background object

**04 Background object** has separate Light and Dark settings.

- **Follow theme**: the animation takes the master hue, plus hue shift, saturation, lightness, opacity and how far the hue travels.
- **Custom palette**: pick a base color, an optional second color, and a highlight.

No second animation is created; the existing one is recolored.

## 6. Read contrast

Every color row in Advanced roles carries a badge such as `Fail 2.21:1, needs 4.5` or `Pass 7.22:1`. Section **06 Accessibility** lists every check for Light or Dark.

- **Required** checks must pass for an export to be marked validated.
- **Advisory** checks are reported but do not block.
- Each failing result shows a suggestion. **Nothing is applied automatically.** Press **Apply suggestion** to accept it; that role becomes Custom. If a role in the pair is locked, it is never changed.

These are automated contrast checks only. They are not a statement of WCAG conformance, and the Studio never says otherwise.

To see Light and Dark side by side on the real tokens (buttons, links, inputs, cards, dialog, status messages, focus ring), open **07 Compare Light and Dark**.

## 7. Save and export

Section **08 Save, export and import**:

- **Save draft (local)** keeps the draft in this browser only. The confirmation says so.
- **Keep this draft on every page** applies your draft across the whole site in this browser, even after a reload. Turn it off to return to the published theme.
- The banner says **Draft** until every required check passes, then **Validated against the in-app checks**. File names carry the same word, for example `my-theme.draft.theme.json`.
- Downloads: **JSON** (the theme itself), **CSS**, **Color guide** (token, value and usage for every color), and the **Validation report**.
- **Import** a theme file by pasting or choosing a file. Press **Validate**; errors and warnings are listed. Loading it replaces your draft, and Undo brings your draft back.

## 8. Hand off to a developer

1. Send the JSON (and the validation report).
2. The developer replaces `lib/theme/production/production-theme.json`, then runs `npm run theme:build` and `npm run theme:check`.
3. They commit and deploy as usual.

**Rollback:** revert that commit. Browser drafts never reach other people, so they are not part of production or rollback.

## If something looks off

- **The panel stays readable even with a terrible draft.** That is deliberate: the Studio uses its own fixed colors.
- **"Browser storage is unavailable"**: your draft cannot be saved (private window or blocked storage). Export the JSON to keep your work.
- **"Another tab saved a different draft"**: choose **Load other draft** (Undo brings yours back) or **Keep mine**. Your open draft is never overwritten without asking.
- Two decisions belong to the owner, not to the Studio: the default for new visitors (Light, Dark or System) and the **keyboard focus ring** and **themed selection** toggles in Advanced roles.
