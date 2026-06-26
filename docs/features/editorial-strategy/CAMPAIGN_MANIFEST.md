# Campaign Manifest

Status: active scheduling object inside the Marketing Strategy Framework.

## Principle

The Campaign Manifest is the object Strategy Builder schedules.

The Editorial Strategy Engine never builds campaigns. It decides how to express today's active campaign.

## Shape

Each manifest should define:

- name
- strategic objective
- positioning objective
- duration
- priority
- allocation percentage
- narratives
- projects
- prepared assets
- signal triggers
- editorial formats
- fallback
- success metrics

## Example

```json
{
  "name": "Creative Systems",
  "strategicObjective": "Own cross-medium creative execution.",
  "duration": {
    "startDate": "2026-06-26",
    "endDate": "2026-09-30"
  },
  "priority": 0.95,
  "allocationPct": 25,
  "narrativeBuckets": [
    "Brand Translation",
    "Production Constraints",
    "AI Workflow",
    "Design Engineering"
  ],
  "supportingProjects": [
    "Critters Quest",
    "HITLOOP",
    "Enterprise Work"
  ],
  "dailySignalTriggers": [
    "AI workflow discussions",
    "Game UI",
    "Typography",
    "Design systems"
  ],
  "editorialFormats": [
    "Production Notes",
    "Constraint of the Week",
    "Behind the Build"
  ],
  "fallback": "Evergreen Brand Translation",
  "successMetrics": [
    "Founder engagement",
    "Qualified DMs",
    "Saves"
  ]
}
```

## Scheduling Role

Strategy Builder uses manifests to decide:

- which campaigns appear in the calendar
- how often each campaign appears
- which narratives rotate through the week
- which editorial formats are eligible
- which prepared assets can support the post
- what fallback content should be used when daily signals are weak

## Daily Editorial Role

The Editorial Strategy Engine uses the active manifest to decide:

- whether to keep the scheduled post unchanged
- whether to adapt the hook
- whether to select another asset from the same campaign
- whether a rare interruption is justified

It should not create a new campaign from daily market noise.
