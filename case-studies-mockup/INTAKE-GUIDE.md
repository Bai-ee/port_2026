# Case Study Intake Guide

Everything you need to gather per client to fill one case study. Match the fields in `case-studies-data.json`. Structure is the **classic 5-part**: Client → Challenge → Approach → Results → Quote, with a metrics strip up top.

## What this folder contains

- **`sample-case-study.html`** — the approved sample (Fernwood Roasters, a fictional composite). Fully hardcoded; open it directly to see the target look.
- **`case-study-template.html`** — the reusable, data-driven version. Renders any client from the JSON. Open `case-study-template.html?client=<slug>` (e.g. `?client=viva-acid`). Opened as a plain file it shows the built-in Fernwood data; served over http it loads the JSON.
- **`case-studies-data.json`** — one entry per client. Fernwood is filled as the reference; the 7 real clients are stubbed with `TODO`s.
- **`index.html`** — the case-studies landing grid that links from the homepage.

## The 30-minute gather, per client

### 1. Cover / positioning
- **Client name** (headline — use `\n` to control the line break, e.g. `"Viva\nAcid"`)
- **Industry tag** (2-4 words, e.g. "DTC Coffee · Retail")
- **One-line positioning** — the single sentence that says who they are + your biggest result. This is the most important sentence on the page.
- **Meta strip (4):** Client · Industry · Services delivered · Engagement length/status

### 2. Metrics strip — 4 hero numbers
Pick the four most impressive, defensible numbers. Format for punch: `3.4×`, `+112%`, `28%`, `40hrs`. Each gets a short label. If you only have three strong ones, it's fine to repeat a softer qualitative metric — but four numbers reads best.
> Rule: every number must be something the client would confirm on the record.

### 3. Challenge (the "before")
- A short punchy title (2 lines, `\n` for the break)
- 2 short paragraphs: the starting problem, and what they actually needed
- 3-4 tag chips naming the pain points ("Dormant email list", "No cadence")

### 4. Approach (what you did)
- A 2-line title
- **3-4 steps**, each a bold action + one sentence. Keep it about the *system*, not the tools.

### 5. Results (the "after")
- A 2-line title + a comparison label ("vs. prior 6 months")
- **3-5 result bars.** Each: a name, a `val` (the real figure shown), and `pct` 0-100 (just the visual bar fill — set the biggest win to 100 and scale the rest by eye)
- 2 short paragraphs: what changed + the takeaway

### 6. Quote
- One testimonial sentence + attribution ("Name · Role, Company"). If you don't have a real quote yet, mark it TODO and ship without the section rather than inventing one.

## Images to collect (per client)

| Slot | Field | Ratio | What it is |
|---|---|---|---|
| Hero | `heroImage` | 16:9 | Best single brand/product/storefront shot |
| Challenge | `challenge.image` | 4:5 | "Before" — old feed screenshot, tired analytics |
| Approach ×2 | `approach.images[0..1]` | flexible | System/calendar visual + sample deliverables |
| Gallery ×6 | `gallery[]` | square-ish | Best output: posts, video stills, emails, brand details |

**How images work:** leave a field `""` to render a labeled dashed placeholder (great for approval before assets exist). Drop in a path or URL to swap the real image in — no code change. Put files in a `case-studies-mockup/images/` folder and reference like `"images/viva-hero.jpg"`.

## Automation — where this can be largely hands-off

Most of the copy already lives in the system. To draft a client's JSON quickly:

1. **Positioning, challenge, approach, quote candidates** → pull from that client's **Client Brain** (`clients/{clientId}/client_brain/current`) and their **executive/marketing brief**. The Brain already holds voice, positioning, and services; the brief holds the problem framing.
2. **Metrics + result bars** → pull from **Web Stats** (GA4), the **Email Digest** analytics, and social engagement numbers already collected per client.
3. **Gallery + hero images** → the client's **Saved Assets** / archived media from the Video Remix + Studio cards.

A future step: a small script that reads a client's Brain + latest brief + stats and emits a pre-filled `case-studies-data.json` entry with `TODO`s only where a human number or quote is genuinely needed. Say the word and I'll draft it (read-only — pulls data, writes JSON, touches no app code).

## Publishing (when approved)

These are standalone mockup files under `case-studies-mockup/`. To go live on the site they'd become a route (e.g. `app/case-studies/[slug]`) rendering the same markup with the brief kit's real components. That's a code change — I'll only do it on your explicit go-ahead per the project rules.
