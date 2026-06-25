# Video Studio UX Kit

Status: Canonical reference for video-editor and motion-studio UI
Source surface: `/dashboard/studio`
Primary implementation: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:1)

## Purpose

Use this kit whenever building a video editor, motion mockup tool, timeline editor, render studio, or any production surface where the user edits media while previewing an output frame.

The current Mockup Studio UI is the standard. A future video editor should inherit its shell, control hierarchy, timeline behavior, right-rail editing model, render terminal, responsive rules, and asset states before introducing new interaction language.

## Product Shape

The studio is an app workspace, not a dashboard modal. It owns the viewport and treats the preview as the primary object.

Core arrangement:

- Full-viewport fixed shell with no page scroll on desktop.
- Branded logo/control anchor at the top-left.
- Central export artboard over a soft internal-product background.
- Under-canvas transport and timeline controls.
- Floating right rail of collapsible editing cards.
- Render progress terminal as a closeable overlay.
- Toasts for render success and failure.
- Captures gallery inside the rail, not as a separate page.

Source anchors:

- Full shell and board: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2144)
- Under-canvas controls and timeline: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2246)
- Floating rail: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2394)
- Render console and toast: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2882)

## Visual Tokens

Use cool near-white glass. Do not shift this surface toward beige, yellow, tan, or paper.

Canonical tokens:

- Page background: `linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)` plus cyan/purple/pink wash.
- Glass surface: `rgba(255,255,255,0.72)`, `1px solid #E4E4E4`, `blur(20px)`.
- Ink: `#1a1a1a`.
- Soft ink: `#444`.
- Muted ink: `#8a8a8a`.
- Hairline: `#E4E4E4`.
- Accent gradient: `hsl(185,100%,45%) -> hsl(262,100%,55%) -> hsl(314,100%,50%)`.
- Main control type: `Space Grotesk`.
- Small uppercase labels only: `Space Mono`, 9-10px, uppercase, `0.06em` to `0.12em`.
- No negative letter spacing in compact controls.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:176)

## Shell Layout

Desktop:

- Shell is fixed to viewport and uses `display:flex; flex-direction:column`.
- Main row reserves a 336px right rail.
- Board fills everything left of the rail.
- Rail floats over the scene with transparent outer background.
- Rail cards carry their own frosting for legibility.

Mobile / narrow:

- At `max-width: 820px`, the shell stacks board above rail.
- Rail becomes full width with `padding:12px`.
- Artboard area gets an explicit viewport-height cap by format:
  - portrait/reel: `64vh`
  - square: `54vh`
  - landscape: `44vh`
- Controls wrap so transport stays usable before rail details.

## Preview And Artboard

The preview is the product. It must be the largest stable object on screen.

Rules:

- Use one exportable artboard; the canvas is the exported frame.
- Size the artboard with aspect-ratio constraints, not ad hoc JS measurements.
- Keep output formats explicit: landscape `1920x1200`, square `1080x1080`, reel `1080x1920`.
- Show output size as a small mono chip on desktop only.
- Keep mode utilities as icon buttons on the artboard corner: orbit/interact and refresh.
- Artboard surface uses dark preview fill, white hairline, 16px radius, and deep neutral shadow.

Source:

- Output formats: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:379)
- Artboard sizing: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2141)

## Under-Canvas Controls

Controls belong directly below the preview, not buried in the rail.

Control row structure:

- Left group: device size icons.
- Center group: playback controls.
- Right group: save and render actions.
- Equal-flex side groups keep playback visually centered.
- Icon buttons are 46px square/circle for tactile predictability.
- Labels are tiny mono text under device and transport controls.
- At small widths, labels drop and CTAs become icon-only 46px circles.

Device controls:

- Desktop, mobile, tablet.
- Use lucide icons: `Monitor`, `Smartphone`, `Tablet`.
- Active state is a lifted white rail-card style with accent icon color.

Transport controls:

- Play/loop, stop, reset.
- Use lucide icons: `Play`, `Square`, `RotateCcw`.
- Disabled transport drops to 40% opacity.
- Active play uses a white fill with accent-gradient hairline.

Primary actions:

- Save template is a white nav pill.
- Render is the single gradient primary CTA in the main workspace.
- Both collapse to icon-only circles on very small screens.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2246)

## Timeline

The timeline is a camera/keyframe editor. Preserve its rules for future editors.

Anatomy:

- Track height: 32px.
- Track shape: rounded pill.
- Track background: translucent white with inset shadow.
- Playhead: bold pink vertical line, 3px wide, extending past the track.
- Playhead handle: 22px hit area with 13px pink dot and white ring.
- Keyframes: 9px diamond markers, rotated 45 degrees.
- Selected keyframe: ink fill with white border.
- Duration field: compact mono numeric input at the right of the track.

Behavior:

- Drag the playhead handle to scrub.
- Scrub snaps to nearby keyframes.
- Drag keyframe markers to retime.
- Double-click or double-tap empty track to add a key.
- Double-click key or long-press key to remove.
- Tapping a key selects it without moving the playhead.
- Track gestures do not move the playhead; only the playhead handle scrubs.
- Playback disables orbit controls until stopped.

Source:

- Timeline constants: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:199)
- Keyframe logic: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:1496)
- Timeline markup: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2324)

## Right Rail

The rail is a stack of independent collapsible cards. Do not wrap it in a second enclosing panel.

Rail card anatomy:

- `RailCard` with full-width button header.
- Title, subtitle, optional badge, colored icon, chevron.
- Body reveals under header with max-height transition.
- Body uses tight vertical rhythm and simple controls.
- Cards float over the canvas with their own white glass.

Rail card states:

- Rest: `rgba(255,255,255,0.35)` with blur and gray hairline.
- Hover: white fill, lifted shadow, `scale(1.02) translateY(-2px)`.
- Active/open: same lifted white state as hover.
- Hover/open hairline: vertical cyan/purple/pink gradient through masked border.
- Content shifts right by 5px on hover.
- Icon scales to `1.12` on hover.
- Reduced-motion disables transitions.

Source:

- `RailCard`: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:313)
- Rail state CSS: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2410)

## Rail Sections

Use these section roles for the next video editor unless the product truly needs a new card.

Size:

- Output format selector.
- Cards for landscape, square, reel.
- Format tiles use icons and mono labels.

Background:

- Scene and Color are launch-safe.
- Image and Site can exist behind flags if the render pipeline supports them.
- Scene presets: Airport, Desk, Studio, Loft, Sunset.
- Color mode shows swatch, label, and hex value.
- Color grade sliders are always available: hue, saturation, brightness.
- Reset grade is a secondary white pill.

Environment:

- Controls optional animated scene elements.
- Include a binary on/off pill.
- Sliders expose size, horizontal, vertical, depth, opacity.
- Disabled controls drop opacity but remain visible for orientation.

Director:

- Cloud render controls.
- Camera move select.
- Length and FPS selects.
- Site speed slider.
- Scroll target mode: none, section, text, percent.
- Section mode includes Map sections and selectable mapped rows.
- Generate Cloud GPU button is full-width primary within this card only when the main workspace primary is not visible; otherwise use secondary treatment or ensure only one visible gradient primary exists.
- Admin-only new-signup default controls live at the bottom with a divider.

Export:

- Duration select.
- Template select, including saved optgroup.
- Capture density select.
- Full-page checkbox.
- Capture hi-res and Create video buttons.

Captures:

- Video uses `<video controls muted playsInline preload="metadata">`.
- Images use object-fit cover preview.
- Media cards include mono metadata and Open action.
- Empty state is plain text, not a decorative card.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2545)

## Render Console

Rendering gets a terminal overlay, not a spinner-only state.

Anatomy:

- Fixed overlay with dark translucent scrim and subtle blur.
- White modal body, 10px radius, deep stacked shadow.
- Top brand row: logo, mono uppercase label, bracket close button.
- Doto marquee headline.
- Dark terminal pane with three window dots.
- Log rows use two columns: prefix and message.
- Footer shows host on the left and success action on the right.
- Console is closeable and non-blocking; render continues after dismissal.

Log states:

- Active: blue prefix and bright message with blinking caret.
- Done: green prefix/message.
- Error: red prefix/message.
- Dim: muted gray setup rows.

Standard stage sequence:

- `QUEUE` Dispatching to GPU render service.
- `FETCH` Loading live site and capturing frames.
- `GPU` Rendering 3D device scene.
- `ENCODE` Encoding video.
- `SAVE` Saving to assets.
- `DONE` or `ERROR` terminal row.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2882)

## Toasts

Render outcome toasts mirror dashboard toast behavior.

Rules:

- Fixed top-right.
- Max width about 24rem.
- Mono 11-12px text.
- 10px radius, blurred glass, stacked shadow.
- Success uses pale green background and green dot.
- Error uses pale red background and red dot.
- Error uses `role="alert"` and assertive live region.
- Success uses `role="status"` and polite live region.
- Auto-dismiss: success around 6s, error around 8s.
- Dismiss button is plain text/icon, inherits color.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2987)

## Data And Persistence

The editor should remember useful setup, but render outputs belong to the client workspace.

Local persistence:

- Studio defaults: viewport, format, backdrop/background mode, color grade, loop config, capture scale, duration.
- Custom templates: saved camera keyframes and duration.
- Last custom template id.

Workspace/API persistence:

- Captures load from `/api/dashboard/studio-capture`.
- Hi-res capture posts `action: capture`.
- Video uploads post `action: upload-video`.
- Cloud render posts the current recipe to `/api/dashboard/studio-render`.
- Admin default video recipes save to `/api/dashboard/studio-default-recipe`.

Source:

- Saved defaults: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:45)
- Capture API calls: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:1776)
- Render recipe: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:663)

## Error And Blocked-Site States

The studio must explain blocked embeds and render constraints in-place.

Rules:

- If the client website cannot iframe, hide the live iframe and paint a message directly onto the device screen.
- Tell the user Render still works because the server captures the site directly.
- Refuse rendering when the loaded URL is the app origin instead of a client site.
- Show clear toast copy for missing URL, unsupported browser recording, render failure, or blocked setup.
- Never let a blank preview be the only signal.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:1876)

## Responsive Rules

Breakpoints:

- `1024px`: shorten CTA copy.
- `820px`: stack board and rail; playback row moves above device/action groups.
- `560px`: hide labels; make Save and Render icon-only circles; device buttons become bare compact icons.

Non-negotiables:

- Text must not clip inside controls.
- The preview must remain visible above the rail.
- Timeline must remain horizontally usable.
- Right-rail cards must not overflow viewport width.
- Tooltips are disabled inside dense rail/card groups where visible labels already exist.

Source: [app/dashboard/studio/page.jsx](/Users/bballi/Documents/Repos/Bballi_Portfolio/app/dashboard/studio/page.jsx:2497)

## Future Video Editor Mapping

For a full video editor, map new features onto this system:

- Media preview/canvas: use the export artboard model.
- Inspector panels: use rail cards.
- Media settings: Size, Background, Environment, Director, Export, Captures patterns.
- Clip/layer timeline: inherit timeline track, playhead, selected marker, duration, and drag rules.
- Render/export job: use the render console and toast states.
- Saved outputs: use Captures card media rows.
- Project templates: use Save template and template select.
- Background/audio/effects: add rail cards only after checking whether an existing section can absorb the controls.

## Acceptance Checklist

- Preview is the largest object and remains WYSIWYG.
- One visible gradient primary action in the main workspace.
- Under-canvas controls include device group, transport group, and action group.
- Timeline has playhead, key markers, duration, drag/snap/delete behavior, and disabled playback states.
- Right rail uses independent collapsible glass cards with dashboard rail-card hover/open states.
- Render jobs use terminal overlay plus outcome toast.
- Captures show saved videos/images with Open actions.
- Mobile stacks without clipping, overflow, or hidden primary workflows.
- Blocked embeds and missing client URLs produce explicit in-UI feedback.
- Any new video-editor control is added to this kit before implementation.
