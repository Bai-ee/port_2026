# Onboarding Questions — Canonical Source of Truth

This document is the editable source of truth for the entry-flow onboarding survey that appears over the dashboard-creation modal after a user signs up or submits a website.

Edit this file when you want to change a question, option label, order, or whether it influences the AI analysis. After editing, hand-sync the change into `onboarding/questions.config.js` (same keys, same order).

## Rules

- Every step is individually skippable. There is also a global skip-all.
- Steps may be single-select, multi-select, text, or a generated summary card.
- `influencesAnalysis: true` marks steps whose answers feed the answer-dependent pipeline stages (synthesize). Changing this flag changes what the analysis waits on — confirm before flipping.
- The `id` field is stable. Renaming an `id` is a breaking change (stored answers key off it).
- `value` strings on option items are stable for the same reason.
- Copy (`eyebrow`, `title`, `helper`, option `label`) is free to edit.

## Steps

### 1. Stage

- `id`: `stage`
- `eyebrow`: `SET CONTEXT`
- `title`: `Where are you at right now?`
- `selectType`: `single`
- `influencesAnalysis`: `true`
- Options:
  - `idea` — Just an idea
  - `early` — Early (some work started)
  - `in_progress` — In progress (needs direction)
  - `live` — Live but needs improvement
  - `scaling` — Scaling / optimizing

### 2. Intent

- `id`: `intent`
- `eyebrow`: `INTENT`
- `title`: `What are you trying to get done?`
- `helper`: `Pick any that apply.`
- `selectType`: `multi`
- `influencesAnalysis`: `true`
- Options:
  - `launch_new` — Launch something new
  - `improve_existing` — Improve what I already have
  - `fix_issues` — Fix specific issues
  - `build_content` — Build content / visuals
  - `automate` — Automate workflows
  - `not_sure` — Not sure — need direction

### 3. Services

- `id`: `services`
- `eyebrow`: `SERVICES`
- `title`: `What do you think you need?`
- `helper`: `Pick anything. You can change this later.`
- `selectType`: `multi`
- `influencesAnalysis`: `true`
- Options:
  - `branding` — Branding (logo, identity)
  - `website` — Website / landing page
  - `product_ui` — App / product UI
  - `social_content` — Social content / marketing assets
  - `video_motion` — Video / motion
  - `ai_automation` — AI / automation setup
  - `ongoing_creative` — Ongoing creative support

### 4. Priority

- `id`: `priority`
- `eyebrow`: `PRIORITY`
- `title`: `What matters most right now?`
- `selectType`: `single`
- `influencesAnalysis`: `true`
- Options:
  - `speed` — Speed (need this fast)
  - `quality` — Quality (needs to be right)
  - `cost` — Cost (budget matters most)
  - `direction` — Direction (I need help figuring it out)

### 5. Current state

- `id`: `currentState`
- `eyebrow`: `CURRENT STATE`
- `title`: `What do you already have?`
- `selectType`: `single`
- `influencesAnalysis`: `true`
- Options:
  - `nothing` — Nothing yet
  - `rough_ideas` — Rough ideas / notes
  - `designs` — Designs / assets
  - `working_product` — A working site or product
  - `existing_team` — Existing team / devs

### 6. Biggest problem

- `id`: `blocker`
- `eyebrow`: `BIGGEST PROBLEM`
- `title`: `What's slowing you down right now?`
- `selectType`: `text`
- `maxLength`: `500`
- `influencesAnalysis`: `true`

### 7. Output expectation

- `id`: `outputExpectation`
- `eyebrow`: `OUTPUT`
- `title`: `What would a win look like?`
- `selectType`: `single`
- `influencesAnalysis`: `true`
- Options:
  - `launchable` — Something I can launch
  - `showable` — Something I can show / pitch
  - `better_performance` — Something that performs better
  - `fully_managed` — Something fully managed for me

### 8. Timeline

- `id`: `timeline`
- `eyebrow`: `TIMELINE`
- `title`: `When do you want to move?`
- `selectType`: `single`
- `influencesAnalysis`: `false`
- Options:
  - `asap` — ASAP
  - `few_weeks` — Within a few weeks
  - `exploring` — Just exploring
  - `not_sure` — Not sure yet

### 9. Budget

- `id`: `budget`
- `eyebrow`: `BUDGET`
- `title`: `Budget range (optional)`
- `selectType`: `single`
- `influencesAnalysis`: `false`
- Options:
  - `under_1k` — Under $1k
  - `1k_5k` — $1–5k
  - `5k_15k` — $5–15k
  - `15k_plus` — $15k+
  - `not_sure` — Not sure yet

### 10. Handoff summary

- `id`: `summary`
- `kind`: `summary`
- `eyebrow`: `NEXT STEP`
- `title`: `Here's where you're at`
- Not a question. Generated card that recaps stage, primary need, blocker, and priority, followed by 3 recommended next-step bullets seeded from the user's answers.
