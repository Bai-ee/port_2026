# Campaign Model

Status: implemented as the durable Campaign Manifest above Strategy Builder schedules.

## Principle

The planning unit is a campaign, not a post.

A campaign exists to strengthen long-term positioning. Posts, assets, hooks, and daily references are execution details beneath that campaign.

## Required Role

The Marketing Strategy Framework sits between Client Brain and Strategy Builder:

```text
Client Brain
  -> Marketing Strategy Framework
  -> Campaign Manifests
  -> Strategy Builder
  -> Editorial Strategy Engine
  -> Calendar and Post Queue
```

Client Brain provides approved positioning, audiences, topics, proof, voice, and constraints. Campaigns turn that approved understanding into durable editorial work.

## Campaign Fields

Each campaign can define:

- strategic objective
- positioning objective
- target audience
- supported Client Brain topics
- supporting projects
- allocation percentage
- asset library
- narrative buckets
- keywords
- daily signal triggers
- editorial formats
- fallback
- campaign duration
- weekly focus
- success metrics
- priority
- status: `active`, `paused`, or `complete`

## Asset Library

Campaign assets are reusable content objects, not one-time posts.

Supported asset types:

- screenshot
- video
- image
- design file
- case study
- story
- thread
- quote
- historic work
- current work

Each asset carries metadata for campaign, narrative, projects, topics, platforms, keywords, associated Client Brain decisions, evergreen score, freshness score, prepared copy, and media hints.

## Runtime Use

Strategy Builder creates the calendar from Campaign Manifests and the embedded Schedule Policy. The Editorial Strategy Engine uses campaigns and assets to decide whether today's scheduled content should remain, adapt, swap within the campaign, or rarely be interrupted.

## Operator Rule

A campaign should not be changed because a trend is active. A campaign should be changed only when the operator updates Client Brain decisions or approves a strategic shift.
