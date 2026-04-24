# Hero Footer Section Guide

## Overview

The hero footer is a responsive two-column section that sits at the bottom of your hero header. It displays key messaging and a call-to-action button, following modern SaaS design patterns.

---

## Layout

### Desktop (2 Columns)
```
┌─────────────────────────────────────────────────┐
│  Left Column (50%)    │    Right Column (50%)    │
│                       │                         │
│  Large Headline      │  Subtext Description    │
│  (56px, bold)        │  (18px, regular)        │
│                      │                         │
│                      │  [CTA BUTTON]           │
└─────────────────────────────────────────────────┘
```

### Mobile (Stacks Vertically)
```
┌──────────────────┐
│  Headline        │
│  (28px)          │
│                  │
│  Description     │
│  (14px)          │
│                  │
│  [CTA BUTTON]    │
└──────────────────┘
```

---

## Features

### Fully Editable
- Click "✏️ Edit Footer" button to enable editing
- Edit controls appear in the bottom-left corner
- Change headline, description, and button text
- Edits apply in real-time

### Responsive Design
- **Desktop**: Two-column layout with 60px gap
- **Tablet**: Adjusts spacing and font sizes
- **Mobile**: Stacks vertically for full readability
- Font sizes use `clamp()` for fluid scaling

### Color Integration
- Uses your color palette's dominant and accent colors
- Border automatically matches accent color
- Text adapts to background
- Hover states on button

### Lock-Compatible
- When locked (🔒), footer is read-only
- Cannot edit content while locked
- Edit button is disabled
- Perfect for client handoff

---

## How to Use

### Basic Usage

The footer displays by default with:
- **Headline**: "IN THE LOOP"
- **Description**: "Experience human-controlled AI systems with cutting-edge visualization."
- **Button**: "EXPLORE NOW"

### Editing Content

1. Click **✏️ Edit Footer** button (bottom-left)
2. Edit controls appear with three fields:
   - **Headline** (max 80 characters)
   - **Description** (max 200 characters)
   - **Button Text** (max 30 characters)
3. Type to update content
4. Click **Done** to close editor
5. Changes apply immediately

### Locking for Presentation

1. Click **🔒 Lock** button (top-right)
2. Footer becomes read-only
3. Edit button is disabled
4. Perfect for presenting to clients

### Exporting Configuration

When you export your config with **⬇️ Export**, the footer content is NOT included (it's runtime-only). To save footer content:

1. Note the text you want to keep
2. Update it via Edit controls when needed
3. For multi-version footers, save separate configs with notes

---

## Styling Details

### Typography

**Headline**:
- Font Size: `clamp(28px, 6vw, 56px)` (responsive)
- Font Weight: 900 (ultra-bold)
- Line Height: 1.1 (tight)
- Color: White (#fff)

**Description**:
- Font Size: `clamp(14px, 2vw, 18px)` (responsive)
- Line Height: 1.6 (readable)
- Color: Light gray (#d1d5db)

**Button**:
- Uses accent color from palette
- 12px padding vertical, 28px horizontal
- Hover state: Inverted colors
- Letter spacing: 0.5px
- Text transform: Uppercase

### Spacing

**Desktop**:
- Section padding: 60px
- Column gap: 60px
- Padding-top/bottom: 60px

**Mobile** (768px and below):
- Section padding: 40px (20px horizontal)
- Column gap: 40px
- Auto-stack to single column

---

## Responsive Breakpoint

```css
@media (max-width: 768px) {
  grid-template-columns: 1fr; /* Stack vertically */
  gap: 40px; /* Reduce gap */
  padding: 40px 20px; /* Reduce padding */
}
```

All font sizes automatically scale using `clamp()` at smaller viewports.

---

## Real-World Examples

### SaaS Product
```
Headline: "Powerful AI at Your Fingertips"
Description: "Streamline your workflow with our intelligent automation tools."
Button: "TRY FOR FREE"
```

### Creative Agency
```
Headline: "Transform Your Vision"
Description: "We turn bold ideas into stunning digital experiences."
Button: "START PROJECT"
```

### Tech Portfolio
```
Headline: "See What I've Built"
Description: "Explore my latest projects and case studies."
Button: "VIEW PORTFOLIO"
```

---

## Workflow

### Step 1: Customize Text
1. Click **✏️ Edit Footer**
2. Update headline, description, button
3. Click **Done**

### Step 2: Adjust with Colors
1. Open **Color System** panel
2. Change background color
3. Footer automatically adapts
4. Border and text adjust for contrast

### Step 3: Test Responsive
1. Resize browser window
2. Watch layout respond
3. At 768px, layout stacks
4. Typography scales smoothly

### Step 4: Lock & Present
1. Click **🔒 Lock**
2. Share with stakeholders
3. They see final version
4. Cannot accidentally edit

### Step 5: Export
1. Configure all footer text
2. Take screenshot (footer is visible)
3. Export hero-config.json
4. Use in your website

---

## Technical Details

### Component: HeroFooter.jsx

**Props**:
- `colorPalette`: Object with dominant, secondary, accent colors
- `isLocked`: Boolean to disable editing

**State**:
- `headline`: Main heading text
- `subtext`: Description text
- `ctaText`: Call-to-action button text
- `showEditing`: Toggle edit panel

**Features**:
- Inline editing with visual feedback
- Real-time text updates
- Responsive grid layout
- Hover states on button
- Lock integration

### Mobile-First Approach
- Base styles work on mobile
- Breakpoint at 768px for desktop
- Font scaling with `clamp()`
- Touch-friendly button size (min 44px)

---

## Browser Support

**Modern Browsers**:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers

**Features Used**:
- CSS Grid
- Media queries
- Clamp function
- Flexbox

---

## Tips

### For Maximum Impact
1. Keep headline to 1-2 short lines
2. Description should be scannable
3. Button text should be action-oriented
4. Ensure sufficient contrast with background

### Testing Responsiveness
1. Use browser DevTools
2. Toggle device toolbar
3. Test at 320px, 768px, 1200px widths
4. Verify text readability

### Accessibility
- Semantic HTML (h2, p, button)
- Color contrast meets WCAG AA
- Focus states on button (keyboard navigation)
- Alt text for icon (arrow in button)

---

## Summary

- 📐 **Responsive**: 2-column desktop, stacked mobile
- ✏️ **Editable**: Click to edit headline, description, button
- 🎨 **Themed**: Uses your color palette
- 🔒 **Lockable**: Prevent edits when presenting
- ⚡ **Responsive Typography**: Scales with viewport
- 📦 **Integrated**: Part of hero section

**Start editing your footer text now!** Click ✏️ Edit Footer and customize for your brand. ✨
