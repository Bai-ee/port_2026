# Hitloop.Agency — Brief Generator Master Prompt

Use this prompt with Claude (Code or Cowork) to generate a new client brief from the template. Copy this entire prompt, fill in the variables at the top, and run it.

---

## Prompt

```
You are building a client-facing estimate/pitch brief for HITLOOP.AGENCY using an existing HTML template. The brief is a single self-contained HTML file with all images base64 encoded inline. No external dependencies except Google Fonts CDN.

## CLIENT VARIABLES (fill these in)

CLIENT_NAME: [e.g., "It's Raw Poke"]
CLIENT_COVER_HEADLINE: [e.g., "It's Raw Poke" — the big text on the cover page, can be multi-line with <br>]
PROJECT_TITLE: [e.g., "Website Updates"]
PROJECT_SUBTITLE: [e.g., "w/ Online Ordering & Pickup"]
PREPARED_DATE: [e.g., "June 1, 2026"]

### Estimate Line Items
Fill in each section. Delete rows you don't need. Add rows as needed.

CATEGORY_1_NAME: [e.g., "Point-of-Sale"]
CATEGORY_1_ITEMS:
  - name: [e.g., "Square for Restaurants"], cost: [e.g., "$0–79/mo"]
    sub_items:
      - name: [e.g., "Point of sale app"], cost: [e.g., "Included"]
      - name: [e.g., "Online ordering"], cost: [e.g., "Included"]
      - name: [e.g., "Kitchen app"], cost: [e.g., "$20–30/mo"]

CATEGORY_2_NAME: [e.g., "Website Hosting"]
CATEGORY_2_ITEMS:
  - name: [e.g., "Basic Square Website"], cost: [e.g., "$0–29/mo"]
    sub_items:
      - name: [e.g., "Hosting"], cost: [e.g., "Included"]
      - name: [e.g., "Remove Square branding"], cost: [e.g., "$29/mo"]

STANDALONE_ITEMS:
  - name: [e.g., "Design + setup"], cost: [e.g., "$3–5K"]

### Totals
MONTHLY_LABEL: [e.g., "Monthly Recurring"]
MONTHLY_VALUE: [e.g., "$20–109"]
ONETIME_LABEL: [e.g., "1-Time Design + Set Up"]
ONETIME_VALUE: [e.g., "$3–5K"]
DEPOSIT_VALUE: [e.g., "$1.5K"]

### Recommendation
RECOMMENDATION_NAME: [e.g., "Square for Restaurants POS + Basic Square Website"]
RECOMMENDATION_BODY: [e.g., "After looking at all four options, I think Square for Restaurants is a good solution for online ordering and pickup point of sale, with a Basic Square Website to get started."]
RECOMMENDATION_CHIPS: [e.g., "Customers order from the website", "Scheduled pickup times", "Orders can be changed / edited", "$0/mo to start", "No contract"]

### How It Works Flow (horizontal cards with arrows)
FLOW_STEPS:
  - platform: [e.g., "Square Online"], color: [blue/purple/green], label: [e.g., "Visits site"], tech: [e.g., "itsrawpoke.square.site"]
  - platform: [e.g., "Square Online"], color: [blue], label: [e.g., "Picks food, time, pays"], tech: [e.g., "Square Online (free)"]
  - platform: [e.g., "Square POS + KDS"], color: [blue], label: [e.g., "Order hits the shop"], tech: [e.g., "iPad + kitchen tablet"]
  - platform: [e.g., "Customer"], color: [green], label: [e.g., '"It''s ready" text'], tech: [e.g., "Auto SMS"]

### Detail Sections (optional — include if you want deep-dive option cards)
OPTIONS:
  - label: [e.g., "Option A · Recommended"]
    name: [e.g., "Square for Restaurants"]
    price: [e.g., "Free–$69"]
    unit: [e.g., "Per month · No contract · Cancel anytime"]
    description: [e.g., "Three pieces that all talk to each other..."]
    software_stack:
      - name: [item], detail: [description], cost: [price]
    hardware_stack:
      - name: [item], detail: [description], cost: [price]
    totals:
      - label: [e.g., "Monthly"], value: [e.g., "$20–30"]
    detail_chips:
      - text: [e.g., "No contract"], type: [green/red/neutral]

### Section Cover Pages (optional — full-viewport dividers between sections)
COVER_PAGES:
  - headline: [e.g., "Website Updates"]
  - headline: [e.g., "Tech Stack Options"]

### Payment Links
ZELLE_LINK: [e.g., "mailto:bryanballi@gmail.com?subject=Zelle%20Payment"]
VENMO_LINK: [e.g., "https://venmo.com/bballi"]
PAYPAL_LINK: [e.g., "https://paypal.me/bryanballi"]
CALENDLY_LINK: [e.g., "https://calendly.com/bballi/30min"]

## TEMPLATE RULES

### Design System
- Fonts: Doto (headlines, 900 weight, uppercase), Space Grotesk (body, 300-600), Space Mono (labels, mono)
- Background: warm gradient (peach/purple/pink radial gradients over #fefdf9)
- Inverted sections for estimates: #0a0a0a background, #fefdf9 text, rgba(255,255,255,0.15) borders
- All text in inverted sections: uniform 13px, no size/weight variance except big Doto totals
- Cards: rgba(255,255,255,0.45) background, rgba(212,196,171,0.65) border, 18px radius
- Pros: green background rgba(22,101,52,0.06), green border, green + tag
- Cons: red background rgba(220,38,38,0.06), red border, red − tag

### Cover Pages (every brief has these)
- Full viewport height (min-height: 100vh)
- Top-left: Bryan Balli + Prepared [date]
- Top-right: HITLOOP.AGENCY ↗ (linked to https://hitloop.agency)
- Center: Big Doto headline (up to 240px)
- Bottom: subtitle or description

### Estimate Section
- Dark inverted background stretching full width
- RECOMMENDATIONS label
- Line items: category headers → items with costs → sub-items indented
- Big totals: Monthly Recurring (pinned left) / 1-Time (pinned right) in Doto ~96px
- Deposit: centered label → big Doto value → payment pills → Meet with Bryan CTA
- Payment pills: 36px height, border-radius 999px, rgba(255,255,255,0.08) bg
- Meet with Bryan CTA: gradient pill (purple→pink→orange), profile photo avatar (36px circle), animated comet border, links to Calendly

### CTA Button (Meet with Bryan)
```css
background: linear-gradient(100deg, #7a5cff 0%, #a855f7 25%, #d946ef 50%, #ec4899 75%, #f97316 100%);
```
Animated comet border using @property --cta-angle, conic-gradient, mask-composite: exclude, 2.4s linear infinite spin.

### Images
Base64 encode these two images inline (from the repo):
- `public/img/profile2_400x400.png` → resize to 96x96 for CTA avatar
- `public/img/sig.png` → signature mark for cover pages (height: 24-28px, opacity: 0.5)

If the images aren't available, use the base64 strings from the reference brief at:
`clients/fast-poker/its-raw-poke/platform-brief.html`

### Copy Rules
- First person: "I think", "I recommend" — never "we"
- Middle school reading level
- No jargon: "kitchen screen" not "KDS", "card swipe fee" not "processing rate"
- Concise: if you can remove words and keep the meaning, remove them
- No emojis

### Responsive
- All flex rows: flex-wrap: wrap with gap
- Small screens (max-width: 600px): totals stack centered, payment pills stretch full width, CTA goes full width
- Cover page text scales with clamp()

### Output
Generate a single self-contained HTML file. All CSS inline in a <style> block. All images as base64 data URIs. Google Fonts loaded via <link>. No JavaScript required (except the CSS @property animation).

Save to: clients/[client-slug]/[project-slug]/[name]-brief.html

## REFERENCE
The complete reference implementation is at:
clients/fast-poker/its-raw-poke/platform-brief.html

Read that file first. Use its exact CSS, structure, and patterns. Only change the content based on the variables above.
```

---

## Quick Start Examples

### Web Design Estimate
```
CLIENT_NAME: Ocean Beach Brewing
CLIENT_COVER_HEADLINE: Ocean<br>Beach<br>Brewing
PROJECT_TITLE: Website Redesign
PROJECT_SUBTITLE: w/ E-Commerce & Tap List
CATEGORY_1_NAME: Website Build
CATEGORY_1_ITEMS:
  - name: Custom Website, cost: $4–8K
    sub_items:
      - name: Design, cost: Included
      - name: Development, cost: Included
      - name: Hosting (Vercel), cost: $20/mo
MONTHLY_VALUE: $20
ONETIME_VALUE: $4–8K
DEPOSIT_VALUE: $2K
```

### Brand Identity Package
```
CLIENT_NAME: Coastal Coffee Co
CLIENT_COVER_HEADLINE: Coastal<br>Coffee Co
PROJECT_TITLE: Brand Identity
PROJECT_SUBTITLE: w/ Web Presence
CATEGORY_1_NAME: Brand Design
CATEGORY_1_ITEMS:
  - name: Logo + Identity System, cost: $2–4K
    sub_items:
      - name: Logo design, cost: Included
      - name: Color palette + typography, cost: Included
      - name: Brand guidelines PDF, cost: Included
CATEGORY_2_NAME: Web Presence
CATEGORY_2_ITEMS:
  - name: Landing Page, cost: $1.5–3K
MONTHLY_VALUE: $0–20
ONETIME_VALUE: $3.5–7K
DEPOSIT_VALUE: $1.5K
```

### SEO + Marketing Retainer
```
CLIENT_NAME: SD Poke Collective
CLIENT_COVER_HEADLINE: SD Poke<br>Collective
PROJECT_TITLE: SEO + Marketing
PROJECT_SUBTITLE: Monthly Retainer
CATEGORY_1_NAME: Monthly Services
CATEGORY_1_ITEMS:
  - name: SEO Management, cost: $500/mo
    sub_items:
      - name: Keyword research, cost: Included
      - name: On-page optimization, cost: Included
      - name: Monthly reporting, cost: Included
  - name: Social Media, cost: $300/mo
MONTHLY_VALUE: $800
ONETIME_VALUE: $1.5K setup
DEPOSIT_VALUE: $800
```
