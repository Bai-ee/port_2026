# Homepage below-the-fold content — parked (2026-10-18)

The homepage now shows only the hero (scene + HUMAN IN THE LOOP) and the email/booking row. Everything that used to
sit below the fold is **parked, not deleted**: the code is unchanged in `StackedSlidesSection.jsx` and is skipped by
one prop.

Why: on iOS the scroll-locked page still panned, and pinch / input-focus zoom shifted the whole layout. With nothing
below the fold there is nothing to reach, and the lock is simple.

## What is parked
Inside the first panel (`#stack-peek-panel` → `#panel-grid-layout`), everything after `#panel-hero-intro-centering`:
- HELLO marquee (`#testimonials-marquee-shell`, `[data-capability-header]`)
- Onboarding table (`#onboarding-table-section`)
- The testimonials / work-history section that follows it

After the slides wrapper:
- Reel (`#section-break-spacer` → `ReelPlayer`)
- Capabilities panel + inline footer (`#capabilities-panel`)

Still rendered: the email/booking row (`#hero-url-input-row`, `#panel-hero-cta`), the Let's Connect modal
(`#cmo-modal-overlay`, portaled), the particle debug panel.

## Bring it back
`HomePage.jsx`: `<StackedSlidesSection aboveFoldOnly />` → `<StackedSlidesSection />`. The two
`{!aboveFoldOnly && (<>…</>)}` wraps in `StackedSlidesSection.jsx` mark the parked blocks.
Then re-check the homepage scroll lock in `HomePage.jsx` (it assumes a one-screen page) and the iOS touch/pinch guard
there.

## Also changed with this
- Touch screens: both email inputs (`#hero-url-input`, `#cmo-modal-url-input`) are 16px — iOS zooms into any field
  under 16px on focus and leaves the page shifted.
- `HomePage.jsx` blocks touch panning, multi-touch pinch and Safari `gesturestart/gesturechange` on the homepage,
  except inside elements that scroll on their own.
