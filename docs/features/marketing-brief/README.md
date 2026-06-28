# Marketing Brief / Market Signals

Status: active feature docs. The launch source of truth treats Executive / Market Brief as real launch-surface code, while broader Market Signals controls remain admin/gated.

## Start Here

1. `MARKETING_BRIEF_HANDOFF.md` — implementation handoff, data flow, config route, rendering, caveats, and next work.
2. `../../source-of-truth/MARKET-SIGNALS-AND-SCOUT-PROJECTION.md` — canonical market-signal projection and Scout/Scribe/Guardian behavior.
3. `../../source-of-truth/EXECUTIVE-BRIEFS-RUN-BRIEFS-WIRING.md` — Run Briefs card wiring, named previews, run actions, and Executive Brief breadcrumbs.
4. `../../company-brain/DOWNSTREAM_CONTEXT_USAGE.md` — how Client Brain defaults and feedback promotion interact with this card.
5. `../../company-brain/CLIENT_BRAIN_DECISION_ENGINE.md` — decision/default/override model behind Brain-seeded card settings.

## Current Integration Points

- Config route: `app/api/dashboard/marketing-brief/config/route.js`
- Run route: `app/api/dashboard/marketing-brief/run/route.js`
- Runtime: `features/not-the-rug-brief/runtime.js`
- Scout config loader: `features/not-the-rug-brief/config-loader.js`
- Dashboard state output: `dashboard_state/{clientId}.marketingBrief`

## Client Brain Behavior

Marketing Brief / Market Signals is the first structured-default consumer of Client Brain:

- `GET /api/dashboard/marketing-brief/config` loads approved Client Brain defaults and fills only empty config fields.
- Manual card settings remain authoritative for the card.
- `POST /api/dashboard/marketing-brief/config` saves the card config and promotes durable values back into Client Brain as `feedback` decisions.
- Promotion refreshes `decisionAcquisition`, `completion`, and `missingDecisionQueue`.

Precedence:

```text
manual card setting
  > approved Client Brain decision
  > company/default template
  > hardcoded fallback
```

## What Not To Do

- Do not make downstream consumers parse `CLIENT_BRAIN.md` directly.
- Do not overwrite user-edited Marketing Brief fields with Brain defaults.
- Do not re-read raw `agentData` from consumers; use the canonical projection documented in `MARKET-SIGNALS-AND-SCOUT-PROJECTION.md`.
