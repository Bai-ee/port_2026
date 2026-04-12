# Internal Page Background System

This file defines the default background treatment for non-homepage product pages and the surface language that sits above it.

## Intent

New internal pages should keep the homepage motion identity without carrying the full hero intensity.

The default stack is:

1. Homepage `three.js` scene as the base layer
2. `data-stack-panel` style glass layer above it
3. Foreground page content above both

## Rules

- Reuse the shared `ox.jsx` scene rather than introducing separate background scenes.
- Internal pages should use calmer params than the homepage hero, but the animated object should still be visibly present.
- The overlay layer should match the section 2 `data-stack-panel` surface language:
  - `rgba(245, 241, 223, 0.18)` family translucency
  - `blur(24px)` glass effect
  - inset white highlight / border treatment
  - white / neutral panel feel, not warm yellow wash
- Foreground cards and content should still provide strong readability.
- Page-level cards placed over this background should prefer the `data-capability-card` surface treatment for consistency.

## Current implementation

- Shared component: `/Users/bballi/Documents/Repos/Bballi_Portfolio/InternalPageBackground.jsx`
- Shared surface tokens: `/Users/bballi/Documents/Repos/Bballi_Portfolio/pageSurfaceSystem.js`
- Applied to:
  - `/login`
  - `/dashboard`

## Current card rule

For internal entry cards such as login/signup containers:

- use the `data-capability-card` style surface language
- keep:
  - `background: rgba(255,255,255,0.5)`
  - `border: 1px solid rgba(212, 196, 171, 0.82)`
  - `box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4)`
- additional page-specific elevation can be layered on top

## Follow-on pages

When a new internal page is introduced, prefer this same structure:

- fixed background scene
- fixed `data-stack-panel` style overlay
- content shell at a higher z-index
- cards using the shared capability-card surface language where appropriate

Good candidates:

- `/admin`
- future client detail pages
- future onboarding/setup pages
