# Dashboard Modal Component Style Guide

Source HTML:

- [public/docs/dashboard-modal-component-style-guide.html](/Users/bballi/Documents/Repos/Bballi_Portfolio/public/docs/dashboard-modal-component-style-guide.html:1)

Video studio extension:

- [VIDEO_STUDIO_UX_KIT.md](/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/dashboard-ui/VIDEO_STUDIO_UX_KIT.md:1)
- Use the video studio kit, not the modal tab kit, for full-screen video editors, render studios, timeline editors, and motion preview tools.

Local review URL when the dev server is running:

- `/docs/dashboard-modal-component-style-guide.html`

Purpose:

- Iterate on the complete modal component vocabulary in one place before applying it across card modals.
- Normalize tabs, action buttons, toggles, segmented controls, sliders, tables, stat rows, list cards, chips, artifact panes, and empty states.
- Preserve the existing dashboard direction: white glass surfaces, readable operational UI, homepage table influence, card `Run Now` / `Details` outline buttons, the `Meet With Bryan` gradient CTA language, and the source URL `Update & Rerun` control.

Rules:

- One animated primary CTA per visible screen.
- The animated CTA uses the homepage blue/purple/pink gradient fill plus the shared `colors.css` masked conic “comet border”; do not recreate it with a loose border-box gradient or unmasked pseudo-element.
- Static gradient references such as `Contact` can use the same fill without the animated border.
- Field-level run/update actions use a white-fill button with the same masked conic animated border. They are allowed inside source URL/input rows because they are scoped field actions, not the page's main primary CTA.
- Secondary card actions use the black-outline website button shape.
- Nested panels use 8px radius.
- Top-level modal cells can keep the larger 16px radius.
- Default copy should be readable without zooming.
- Inputs, selects, textareas, toggles, and segmented controls use readable compact white fields with mono uppercase labels and neutral gray borders.
- Tables, lists, and stat rows should share the same spacing and divider language.

Coverage:

- `Buttons`: primary CTA, static gradient CTA, black-outline secondary, dark command, icon, destructive, source URL update/rerun.
- `Fields`: input, select, textarea, code textarea, checkbox row, file drop, field action bar.
- `Data`: stat rows, metric cards, chips, data table, audit/inventory rows.
- `Artifacts`: document iframe, image/screenshot preview, external preview link, toolbar, code/pre block, empty state.
- `Operations`: search result cards, citation chips, highlighted matches, saved artifact cards, event/result cards.
- `Composer`: social composer, character count, diagnostics, queue card, schedule/export/action states.
- `Calendar`: pacing strip, generated post rows, inline edit/regen/queue actions.
- `Video Studio`: full-screen editor shell, export artboard, under-canvas controls, keyframe timeline, floating rail cards, render terminal, toasts, captures.
