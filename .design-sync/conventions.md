# Bballi Portfolio — Design System Conventions

## Wrapping and setup

Components are standalone React and **do not require a provider wrapper** for basic rendering. Auth-dependent components (`Header`, `SubscribeModal`, dashboard panels) read from a shimmed `useAuth()` context that returns `{user: null, loading: false}` — they render their logged-out state by default.

```jsx
// Minimal usage — no provider needed
<Header logoSrc="/img/sig.png" onOpenPage={() => {}} />

// Dashboard components receive explicit props; Firebase calls are shimmed
<ModuleCardControls onOpenCard={() => {}} onRefresh={() => {}} />
```

## Styling idiom

**Inline styles are the primary idiom.** Most components set their appearance via `style` props directly, not utility classes. A small set of custom CSS classes is defined in `styles.css`:

| Class | Purpose |
|---|---|
| `.cta-pill-btn` | Animated comet-border CTA button |
| `.nav-avatar-ring` | Gradient ring around nav avatar |
| `.light` / `.light-theme` | Light theme modifier on a container |
| `.founders-chat-cta--light` | Founders chat button in light context |
| `.founders-chat-label-full` / `.founders-chat-label-short` | Responsive CTA label switching |
| `.reel-playing` | State class on the reel player container |

Dashboard components use additional classes (e.g. `tile-foot-action-btn`) that are injected by page-level `<style>` blocks — these won't appear in standalone previews. Use inline `style` overrides when building new dashboard UIs.

Design tokens are minimal. The single CSS custom property with animation:
```css
/* In styles.css — used by .cta-pill-btn */
--cta-angle: 0deg  /* animated via @keyframes cta-border-spin */
```

## Where the truth lives

- `styles.css` — global CSS (colors.css copy); the `@import "./_ds_bundle.css"` closure is what designs receive
- `_ds_bundle.js` — all components at `window.BballiPortfolio.*`
- `components/<group>/<Name>/<Name>.prompt.md` — per-component prop reference

## Idiomatic build snippet

```jsx
// Homepage hero section — uses GSAP for scroll animations
<HeroHeadline />

// Auth-aware nav header
<Header
  logoSrc="/img/sig.png"
  onOpenPage={(pageId) => console.log('open', pageId)}
/>

// Dashboard card with inline dark theme
<KnowledgeBaseCard
  getIdToken={() => Promise.resolve('token')}
/>

// Animated CTA button using the .cta-pill-btn class
<button className="cta-pill-btn">
  Get started
</button>
```

**Icons** are individually exported with `Icon` suffix: `ArrowBigRightDashIcon`, `BotIcon`, `BrainIcon`, etc. They accept `size` (default 28) and `className`.
