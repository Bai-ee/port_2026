# Life Timeline interaction prototype

A standalone, sample-only prototype using HITLOOP's shared UI kit. It does not change `/dashboard/life` or connect to Firebase, the NAS, or the photolib worker.

## Run from this repo

Use the repository's existing installed dependencies; no prototype-specific installation is needed.

```sh
npm --prefix prototypes/life-timeline run dev
```

Local URL: http://127.0.0.1:3077/. If that port is busy, pass another port after `--`.

```sh
npm --prefix prototypes/life-timeline run build
python3 -m http.server 3078 --bind 127.0.0.1 --directory prototypes/life-timeline/out
```

`out/` is the self-contained static export. No server secrets or runtime configuration are needed. Do not deploy the HITLOOP root application to publish this prototype.

## Scope

- Three.js instanced photo field, date zoom/pan/scrub, jump to month, hover lens.
- Whole-library metadata search and 30-field condition builder, filtering in a native Web Worker.
- Bounded contact sheet and photo dialog with previous/next and enlargement.
- HITLOOP IconButton, SegmentedControl, Badge, mu-* forms, generated theme tokens, and local fonts.
- Light/dark themes, mobile layout, semantic HTML alternative.
- 20,000 generated records across 2005–2022. The 36 public sample photographs repeat. All titles, dates, camera labels, and coordinates are invented examples, not personal archive data.
- This is an interaction study, not a performance benchmark of 20,000 distinct photographs. Family libraries and original/video playback are future work.

Photo sources are listed in `public/sample-credits.json` (Lorem Picsum / Unsplash). Existing font license files accompany the bundled fonts. `prepare-samples.mjs` reproduces the sample photos/atlas using the repository's Sharp dependency; it downloads public sample images and never reads the personal library.

## Publication

The isolated Sites project is recorded in `.openai/hosting.json`. The public Site source checkout contains only the static export and a short description; the editable application source lives here. Use the Sites source/packaging workflow to publish a fresh static export. Never upload `.env`, the HITLOOP server, or personal photo data.

Public prototype: https://hitloop-life-timeline-study-bb.victorioustrout2.chatgpt.site

Sites version: 2. Static deployment verified successfully; no production HITLOOP server or private data was deployed.

## Validation

Production static build passed. Browser checks covered timeline zoom, combined filters, contact sheet, viewer navigation/enlargement, and mobile overflow. Direct worker checks confirmed 20,000 records, 384 favorite Canon items, and 329 favorite Canon items with GPS. This does not establish physical-iPhone performance or production owner authorization.

Design/architecture plan: `../../docs/plans/LIFE-TIMELINE-WEB-EXPERIENCE-PLAN.md`.
