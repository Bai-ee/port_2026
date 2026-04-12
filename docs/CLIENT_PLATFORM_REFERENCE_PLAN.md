# Client Dashboard Platform Reference Plan

## Purpose

This document is the source of truth for evolving the current portfolio/Firebase prototype into a production-safe client dashboard platform.

The goal is not to overbuild. The goal is to ensure the MVP works in production without forcing a structural rewrite as soon as:

- more clients sign up
- more dashboards exist
- more providers are added
- more briefing modules or add-ons are sold

This plan must keep the MVP practical while avoiding dead-end architecture.

## Decisions Already Made

### Product / tenancy

- One signed-up user maps to one client and one dashboard.
- Only internal admins can access multiple client dashboards.
- End users do not manually run briefs.
- Brief runs are:
  - initiated automatically on successful signup
  - optionally initiated later by internal admins
  - optionally automated later based on pricing tiers and add-on activation

### Signup inputs

Each signup initially provides:

1. A website URL that the system will use as a primary discovery/input source.
2. A description of an idea the user wants to explore.
3. Optional static images that represent current progress or a target design direction.

### Provider strategy

The system must not be locked to a single model provider.

Near-term providers:

- Anthropic / Claude for MVP
- Kimi
- MiniMax
- OpenAI

Therefore provider access must be abstracted behind a runtime interface, even if Claude is the first implementation.

### Run frequency

MVP behavior:

- one initial run per signup
- no automatic recurring reruns by default
- additional runs only via internal admin action for now

Future behavior:

- add-on or tier-based automation can enable additional runs

### Failure UX

If initial provisioning or the first brief run fails:

- the dashboard remains in `provisioning`
- retry is pending
- the user does not get exposed to internal system details

### Client editing

For MVP:

- no full client config editor
- limited ability later to update website URL or onboarding inputs

### Delivery model

Implementation must proceed with strict phase gates.

- Claude must stop after each milestone
- the user reviews
- then Claude proceeds to the next phase

## Stack Decision

### Recommendation: migrate toward Next.js, but do it as a controlled platform migration

Short answer:

- Yes, the long-term system should move to Next.js or another unified full-stack framework.
- No, the team should not do an uncontrolled “rewrite everything at once.”

### Why Next.js is recommended

The product you are building is no longer just a frontend site.

It now requires:

- authenticated dashboards
- protected server-side APIs
- admin-only operational panels
- server-triggered provisioning
- queued background processing
- model/provider orchestration
- artifact rendering and persistence

A single full-stack framework is a better fit than a Vite SPA plus ad hoc API functions.

### Why a reckless rewrite is not recommended

The current repo already contains:

- public homepage/portfolio UX
- Firebase auth integration
- dashboard UI work
- initial scout runtime port

The correct move is:

- preserve the current public UX as a product surface
- move platform features into a normalized app architecture
- phase the migration deliberately

### Final recommendation

Build the platform on a Next.js architecture.

However, execution should be phased:

1. stabilize the backend/data model and queue contract
2. migrate dashboard/auth/admin surfaces into Next.js
3. either keep the marketing site in the same app or move it after platform stabilization

If Claude can execute a careful migration without destabilizing the live site, Next.js should be the target architecture.

## Production-Safe MVP Principles

The MVP must behave like a small version of the final platform, not a throwaway prototype.

Therefore the MVP must avoid:

- hardcoded single-client runtimes
- local filesystem artifact storage as the production source of truth
- synchronous signup-to-brief execution
- direct client reads from raw pipeline outputs
- model/provider logic embedded in UI code
- user-facing run controls for operational workflows

The MVP should instead include:

- normalized tenant model
- queue-based run initiation
- server-owned execution
- persistent dashboard state projection
- provider abstraction
- admin control plane

## Required Architecture

### Core entities

#### `users/{uid}`

Represents the signed-in person.

Fields:

- `uid`
- `email`
- `displayName`
- `clientId`
- `role` (`owner`, `member`, `admin`)
- `onboardingStatus`
- `websiteUrl`
- `createdAt`
- `lastLoginAt`
- `updatedAt`

#### `clients/{clientId}`

Represents the tenant/account.

Fields:

- `clientId`
- `companyName`
- `websiteUrl`
- `normalizedHost`
- `dashboardTitle`
- `dashboardDescription`
- `status` (`provisioning`, `active`, `paused`, `error`)
- `onboardingStatus`
- `activeModules`
- `activeAddOns`
- `pricingTier`
- `providerStrategy`
- `ownerUid`
- `latestRunId`
- `latestRunStatus`
- `createdAt`
- `updatedAt`

#### `clients/{clientId}/members/{uid}`

Maps members to a client.

Fields:

- `uid`
- `email`
- `displayName`
- `role`
- `status`
- `createdAt`
- `updatedAt`

#### `client_configs/{clientId}`

The source of truth for pipeline behavior.

Fields:

- `clientId`
- `sourceInputs`
  - `websiteUrl`
  - `ideaDescription`
  - `uploadedImageRefs`
- `ingestionConfig`
- `briefConfig`
- `dashboardConfig`
- `providerConfig`
- `moduleFlags`
- `createdAt`
- `updatedAt`

This is mandatory. The current hardcoded `not-the-rug` runtime must be refactored to consume this model.

#### `brief_runs/{runId}`

Canonical job records.

Fields:

- `runId`
- `clientId`
- `trigger` (`signup`, `admin`, `scheduled`, `addon`)
- `source` (`system`, `admin`)
- `status` (`queued`, `running`, `succeeded`, `failed`, `cancelled`)
- `pipelineType`
- `attempts`
- `workerLease`
- `requestedByUid`
- `createdAt`
- `startedAt`
- `completedAt`
- `updatedAt`
- `error`
- `summary`
- `artifactRefs`
- `providerUsage`
- `moduleSnapshot`

#### `dashboard_state/{clientId}`

The only normalized state the client dashboard should read.

Fields:

- `clientId`
- `status`
- `headline`
- `summaryCards`
- `latestInsights`
- `latestRunId`
- `latestRunStatus`
- `updatedAt`
- `provisioningState`
- `errorState`

This projection layer is required so dashboard rendering remains stable even if the pipeline internals change.

## Runtime / Execution Model

### Required separation

#### User flow

- user signs up
- auth user is created
- client record is created
- client config shell is created
- initial run is queued
- dashboard shows `provisioning`

#### Admin/system flow

- worker claims queued run
- worker loads `client_config`
- worker performs ingestion + inference + summarization
- worker writes normalized output
- worker updates `dashboard_state`
- worker marks run `succeeded` or `failed`

### Why this matters

Signup must never block on long-running work.

A production-safe system cannot execute full brief generation inline during user signup.

## Provider Architecture

Provider support must be abstracted immediately.

Even if Anthropic is the first provider used, runtime code must support a provider adapter shape such as:

- `generateText`
- `generateStructuredOutput`
- `estimateCost`
- `normalizeUsage`
- `providerName`

The system must support selecting providers per:

- global environment
- client config
- module
- price tier

## Ingestion Strategy

The specific ingestion logic can evolve later, but the platform plumbing must support these input types now:

- website URL
- freeform founder idea/description
- uploaded reference images

Do not hardcode the MVP to website-only assumptions.

The ingestion pipeline should eventually support:

- website discovery
- page scrape/extract
- metadata capture
- brand/design reference capture
- optional linked-source discovery

## Storage Strategy

### Do not use local files as the production source of truth

Local file output is acceptable only for local development/debugging.

Production persistence should be:

- Firestore for structured state
- Firebase Storage for larger rendered artifacts if needed

Examples of persistent artifacts:

- structured brief JSON
- dashboard projection state
- rendered HTML briefs
- generated images
- run logs / error summaries

## Security / Roles

### End user permissions

An end user can:

- sign in
- access their own dashboard
- read their own normalized dashboard state

An end user cannot:

- run the brief pipeline manually
- inspect internal queue state
- access any other client

### Admin permissions

An internal admin can:

- inspect all clients
- inspect queued/running/failed runs
- manually retry runs
- access all dashboards

## Phase Plan

### Phase 0 — Architecture lock

Goal:

- lock architecture and execution constraints before implementation expands further

Deliverables:

- this reference plan
- master execution prompt
- milestone acceptance criteria

Claude must stop here for review.

### Phase 1 — Normalize backend foundation

Goal:

- establish scalable multi-tenant data model and job contract

Required deliverables:

- `users`, `clients`, `client_configs`, `brief_runs`, `dashboard_state` schema
- Firebase Admin server utilities
- authenticated server endpoints
- admin authorization model
- idempotent client provisioning
- queue lifecycle contract with statuses and retry fields

Acceptance criteria:

- new signup creates exactly one client
- same signup cannot duplicate clients on retry
- initial run is queued, not executed inline
- dashboard can read normalized bootstrap data

Claude must stop here for review.

### Phase 2 — Refactor runtime to generic client engine

Goal:

- replace the one-off `not-the-rug` runtime with a client-config-driven engine

Required deliverables:

- remove hardcoded single-client assumptions
- introduce config-driven client runtime
- provider abstraction layer
- local-dev compatibility retained

Acceptance criteria:

- runtime can execute against any client config
- no code path assumes `clientId = not-the-rug`
- provider selection is abstracted

Claude must stop here for review.

### Phase 3 — Worker execution path

Goal:

- convert queued runs into reliable execution

Required deliverables:

- worker/runner endpoint or service
- run claim/lease logic
- retries / failure handling
- writes to `brief_runs` and `dashboard_state`

Acceptance criteria:

- queued run can move to `running` then `succeeded` or `failed`
- retries do not duplicate final state
- failed runs expose admin-visible status without leaking internals to end users

Claude must stop here for review.

### Phase 4 — Dashboard data contract

Goal:

- make the dashboard read only from normalized state

Required deliverables:

- dashboard bootstrap tied to `dashboard_state`
- provisioning UI state
- retry pending UI state
- stable loading/error handling

Acceptance criteria:

- dashboard does not depend on raw runtime artifact structure
- provisioning users see correct status
- client dashboard remains stable even if the pipeline internals change

Claude must stop here for review.

### Phase 5 — Admin control plane

Goal:

- internal operational visibility and manual recovery

Required deliverables:

- admin client list
- run queue list
- failed run inspection
- retry trigger
- limited client config inspection

Acceptance criteria:

- internal admins can operate the system without touching Firestore manually

Claude must stop here for review.

### Phase 6 — Optional Next.js migration completion

Goal:

- unify dashboard/admin/auth/backend into a full-stack app if not already completed earlier

Required deliverables:

- final framework structure
- routing migration
- environment handling
- deployment normalization

Acceptance criteria:

- production runtime and app stack are coherent
- no split-brain between Vite client app and server platform

Claude must stop here for review.

## Recommended Immediate Next Implementation

If only one implementation slice is approved next, it should be:

1. formalize `client_configs/{clientId}`
2. normalize `brief_runs` schema
3. build idempotent provisioning fully around those records
4. create a real `dashboard_state/{clientId}` projection contract

This is the highest-leverage backend slice and the least likely to be thrown away later.

## Non-Negotiables For Claude

Claude must not:

- add user-facing run controls for MVP
- keep a hardcoded single-client runtime
- rely on local file artifacts as production state
- couple dashboard rendering to raw brief internals
- proceed past a phase gate without stopping for review

Claude must:

- preserve production viability
- prefer additive migration over destabilizing rewrites
- explicitly call out schema and architectural tradeoffs
- implement idempotency and failure handling where provisioning or job creation occurs
