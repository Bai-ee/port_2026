# Google Business Profile Reputation Card Plan

## Goal

Create a Hitloop dashboard card for restaurants and local businesses that monitors Google Business Profile reputation health, highlights reviews that need attention, drafts reply copy, and surfaces local SEO checklist gaps.

The first version should behave as a diagnostic and drafting card. Publishing replies back to Google Business Profile should be a later phase with explicit user approval.

## Source Features

This card should reuse concepts from `Claude_Rositas_GBP`:

- Review display, reply status, suggested replies, and AI edit flow from `/Users/bballi/Documents/Repos/Claude_Rositas_GBP/src/pages/Reviews.jsx`.
- Local SEO checklist categories and progress model from `/Users/bballi/Documents/Repos/Claude_Rositas_GBP/src/pages/SeoChecklist.jsx`.
- Strategy hub concepts from `/Users/bballi/Documents/Repos/Claude_Rositas_GBP/src/pages/Strategy.jsx`, especially signal detection and daily content priority framing.

## Card Definition

Add a new card to `/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-contract.js`.

```js
{
  id: 'gbp-reputation',
  navLabel: 'REPUTATION',
  navTitle: 'Google Business Profile Reputation',
  category: 'content',
  role: 'local-reputation',
  sourceField: 'externalSignals.googleBusinessProfile',
  analyzer: { impl: 'gbp-reputation', required: false },
  analyzerSkills: ['gbp-review-audit'],
  copy: {
    short: { min: 80, max: 180 },
    expanded: { min: 300, max: 750 },
  },
  qualityScaling: true,
  tier: 'paid',
  actionClass: 'diagnose',
  sources: ['gbp.reviews', 'gbp.profile', 'gbp.localSeoChecklist'],
  missingStateRules: [
    {
      id: 'gbp-not-connected',
      when: 'externalSignals.googleBusinessProfile is null',
      reason: 'Google Business Profile is not connected for this client.',
      offer: 'Connect GBP so Hitloop can monitor reviews, profile completeness, and local SEO tasks.',
    },
    {
      id: 'reviews-need-reply',
      when: 'googleBusinessProfile.unrepliedCount > 0',
      reason: 'Some customer reviews do not have owner replies.',
      offer: 'Draft and review owner responses before publishing.',
    },
  ],
}
```

Add static fallback copy to `/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/card-static-copy.js`.

```js
'gbp-reputation': {
  description: 'Reviews Google Business Profile reputation health, flags reviews that need replies, and suggests the next local SEO action.',
  placeholderLabel: 'LOCAL REPUTATION',
},
```

## Normalized Data Shape

Normalize Google Business Profile data before it reaches the card.

```js
{
  connected: true,
  locationName: 'Rosita's',
  profileUrl: 'https://...',
  ratingAverage: 4.6,
  reviewCount: 184,
  unrepliedCount: 7,
  negativeUnrepliedCount: 2,
  newestReviews: [],
  reviewsNeedingReply: [],
  negativeReviews: [],
  suggestedReplies: [],
  profileHealth: {
    hasWebsite: true,
    hasPhone: true,
    hasHours: true,
    hasPhotos: true,
    hasRecentPosts: false,
    hasMenuOrProducts: true,
  },
  seoChecklist: {
    completed: 9,
    total: 18,
    priorityItems: []
  },
  priorityAction: {
    label: 'Reply to 2 negative reviews',
    reason: 'Negative unreplied reviews are the highest reputation risk.',
    severity: 'high'
  }
}
```

If GBP is not connected, return:

```js
{
  connected: false,
  setupRequired: true,
  priorityAction: {
    label: 'Connect Google Business Profile',
    reason: 'No live reputation data is available yet.',
    severity: 'setup'
  }
}
```

## Analyzer Responsibilities

Create a `gbp-reputation` analyzer that:

- Counts total reviews, unreplied reviews, and negative unreplied reviews.
- Identifies the highest priority review response task.
- Produces a simple reputation risk level: `healthy`, `attention`, `urgent`, or `setup`.
- Summarizes recent sentiment from review ratings and comments.
- Generates reply draft inputs for Scribe.
- Checks profile completeness signals such as website, phone, hours, photos, posts, and menu/products.
- Maps local SEO checklist gaps into priority actions.
- Returns setup-needed output when GBP is unavailable.

The analyzer should be deterministic where possible. Use Scribe only for human-facing copy and reply drafts.

## Suggested Reply Logic

Start with rule-based templates from the Rosita's review flow:

- Positive review: thank the customer, reinforce the brand experience, invite them back.
- Neutral review: acknowledge the feedback, show appreciation, invite a better next visit.
- Negative review: apologize, avoid arguing, move resolution to a private channel.

Then pass the selected draft through Hitloop Scribe to match the client's brand tone.

Do not publish replies in v1. The card should generate copy for review.

## UI Behavior

### Tile Face

Show:

- Average rating.
- Total review count.
- Unreplied review count.
- Reputation status.
- Highest priority action.

Example:

```txt
4.6 rating across 184 reviews. 7 reviews need replies, including 2 negative reviews. First action: reply to the negative reviews before posting new promotions.
```

### Expanded Modal

Show:

- Reviews needing reply.
- Suggested reply drafts.
- Profile health checklist.
- Local SEO checklist progress.
- Priority next steps.
- Setup instructions when GBP is not connected.

Keep this card focused on "what needs attention now." Avoid turning v1 into a full review CRM.

## Integration Phases

### Phase 1: Contract and Mock Data

- Add card contract entry.
- Add static fallback copy.
- Add mock normalized GBP payload.
- Render tile and expanded modal from mock data.

### Phase 2: Analyzer

- Implement `gbp-reputation` analyzer.
- Add unit tests for connected, disconnected, healthy, and urgent states.
- Confirm copy budgets work through Scribe.

### Phase 3: Imported GBP Payloads

- Support manually imported or stored GBP review/profile JSON.
- Normalize reviews from the Rosita's app shape.
- Populate `externalSignals.googleBusinessProfile`.

### Phase 4: Google Business Profile OAuth

- Add client-level GBP connection state.
- Pull location profile, reviews, replies, and posts.
- Store only normalized data needed by dashboard cards.
- Handle token expiration and missing permissions cleanly.

### Phase 5: AI Reply Drafting and Guardian

- Generate reply drafts through Scribe.
- Run Guardian-style checks before showing copy as ready.
- Flag risky replies that mention competitors, overpromise, or sound defensive.

### Phase 6: Optional Publishing

- Add explicit approval flow to publish a reply to GBP.
- Require a human confirmation for every publish action.
- Store publish history and errors.

## Acceptance Criteria

The card is ready for v1 when it can:

- Render in the existing Hitloop dashboard card/modal system.
- Degrade cleanly when GBP is not connected.
- Identify unreplied reviews.
- Prioritize negative unreplied reviews above positive reviews.
- Produce suggested reply drafts.
- Surface profile and local SEO gaps.
- Produce a clear priority action.
- Avoid publishing to GBP automatically.

## Implementation Notes

- Treat this as a paid/local-business card unless product packaging changes.
- Use the existing Hitloop card contract and Scribe flow instead of creating a new dashboard page.
- Keep Google OAuth and reply publishing separate from v1 to reduce risk.
- Reuse Rosita's checklist content, but move checklist definitions into a reusable module rather than embedding them in a React page.
