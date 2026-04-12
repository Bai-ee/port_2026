You are implementing a production-safe multi-tenant client dashboard platform inside this repository.

Before doing any work, read this reference document fully and treat it as the source of truth:

- `/Users/bballi/Documents/Repos/Bballi_Portfolio/docs/CLIENT_PLATFORM_REFERENCE_PLAN.md`

## Your role

You are not here to freestyle product architecture.
You are here to execute the plan precisely, in phases, while preserving production viability.

## Primary objective

Transform the current prototype into a scalable client platform where:

- a new signup creates a distinct client/account
- the signup captures onboarding inputs
- an initial brief run is queued automatically
- dashboard state is normalized
- runtime execution is server-owned and admin-controlled
- the system can scale to multiple clients and multiple model providers

## Critical constraints

1. Do not proceed past a phase gate without stopping.
2. Do not make end users responsible for running briefs.
3. Do not rely on local filesystem artifacts as production state.
4. Do not preserve hardcoded single-client runtime assumptions.
5. Do not couple dashboard rendering to raw pipeline outputs.
6. Prefer implementation choices that survive scale, even if the MVP only uses a subset of them immediately.

## Framework guidance

The reference plan recommends moving toward Next.js as the long-term full-stack architecture.

Your job is to choose the safest implementation path that preserves progress and minimizes throwaway work.

That means:

- if a phased migration is safer, do that
- if a backend-first normalization inside the current repo is the correct first step, do that
- do not perform a reckless full rewrite unless the phase explicitly calls for it

## Phase execution rules

You must work in strict sequence.

At the end of each phase:

- stop
- summarize exactly what changed
- summarize risks/open questions
- state whether the acceptance criteria from the reference plan are met
- do not begin the next phase until explicitly asked

## Required working style

- inspect the existing codebase first
- preserve working functionality unless the phase explicitly replaces it
- implement the smallest correct durable solution, not a temporary hack
- if you encounter a design conflict with the existing code, explain it clearly and choose the option that best matches the reference plan
- if you must make an assumption, document it in the phase summary

## Phase 1 you should execute now

Execute **Phase 1 — Normalize backend foundation** from the reference plan.

Phase 1 deliverables:

- normalized schema for `users`, `clients`, `client_configs`, `brief_runs`, and `dashboard_state`
- Firebase Admin server utilities
- authenticated server endpoints
- admin authorization model
- idempotent client provisioning
- queue lifecycle contract with statuses and retry fields

Phase 1 acceptance criteria:

- new signup creates exactly one client
- retrying provisioning cannot create duplicate clients
- initial run is queued, not executed inline
- dashboard can read normalized bootstrap data

## Existing implementation context

Assume there is already partial work in this repo for:

- Firebase auth
- Firestore-backed user records
- protected dashboards
- a portable scout/brief runtime that is still too single-client and too file-oriented

You must inspect the actual repo state and improve it to match Phase 1 instead of rewriting blindly.

## What not to do in Phase 1

Do not yet:

- build full ingestion logic
- generalize all provider internals
- build the full admin UI
- build client config editing UI
- wire recurring reruns
- expose manual run controls to clients

## Expected output at the end of Phase 1

When you stop, provide:

1. files changed
2. schema introduced or changed
3. exact API routes added/updated
4. idempotency behavior
5. anything still blocking Phase 2

Now begin with Phase 1 only.
