# HITLOOP Merge Program - 2026-09-20

## Decision

Adopt a staged integration program: preserve every local source, integrate one
bounded feature lane at a time on a branch based on current production, and
only then promote it to `main` after its checks pass.

Do not merge every non-live branch directly into `main`. The repository has
several branches based on old production snapshots, local uncommitted work, and
external repositories with different deployment targets. A broad merge would
reintroduce stale code and make a failed build difficult to diagnose.

## Live Baseline And Scope

- Live baseline: `origin/main` at `4ea390ee87264d2c5ba804d2dcd89891615edb7f`.
- This is an exhaustive inventory of the HITLOOP integration family: every
  local/remote `port_2026` branch, the current HITLOOP working tree, and every
  nearby repository with a direct archive, Arweave, X-content, Studio, or
  Edittrax relationship.
- It is not a claim that every unrelated game, trading, client-site, or
  experimental repository under `/Users/bballi/Documents/Repos` belongs in
  HITLOOP.
- "Graph-ready" means Git history can be moved onto a production-based
  integration branch. It does not mean build-tested or production-ready.

## Options Considered

| Option | Upside | Downside | Decision |
| --- | --- | --- | --- |
| Merge all feature branches into `main` | Fastest apparent path | Mixes stale bases, untested work, and unrelated scopes | Reject |
| Rebuild every feature from scratch | Cleanest theoretical history | Discards useful implementation and loses momentum | Reject |
| Stage preserved sources into production-based integration branches | Each lane is reviewable, testable, and reversible | Requires disciplined sequencing | Choose |

What we are giving up: a single "merge everything" event. In exchange, each
feature gets a known source, owner, test gate, and rollback point.

## Source Status Legend

| Status | Meaning | Action |
| --- | --- | --- |
| INTEGRATE | Current-enough source with a bounded purpose | Create a production-based integration branch and validate |
| REBASE | Valuable source with commits behind live | Rebase or selectively transplant onto `origin/main` first |
| SNAPSHOT | Local uncommitted work | Preserve before switching or rebasing |
| HARVEST | Old branch with a few unique commits | Inspect commits individually; never merge the branch wholesale |
| ALREADY_LIVE | No commits unique from `origin/main` | No merge work required |
| EXTERNAL | Separate application/service | Maintain an integration contract, not a Git merge |

## Complete HITLOOP Branch Register

### Direct Feature Sources

| Priority | Source | Live divergence (behind/ahead) | Status | What it contains | Next safe action |
| --- | --- | ---: | --- | --- | --- |
| P0 | `origin/claude/archive-poc-finalization-6qmg7k` | 0 / 45 | INTEGRATE | Archive control plane, worker command APIs, human Jev review, approval-gated Arweave workflow, static viewer, build fixes | Branch from this exact head; run archive tests and a production build |
| P0 | `/Users/bballi/Documents/Repos/assetManager` `origin/feat/archive-master-plan` | external; local is 8 commits behind | EXTERNAL | NAS-side worker, SQLite state, hashing, dedupe, analysis, Jev boundary, re-hash-and-upload behavior | Update worker checkout separately; never merge its UI/code into HITLOOP |
| P1 | `origin/claude/archive-poc-finalization-f0u17f` | 22 / 51 | REBASE | X day view, Archive Inbox, archive-to-content-package bridge, Jev taxonomy export | Rebase onto live after P0; resolve its Dashboard/X-content divergence deliberately |
| P1 | `feat/brief-rendered-scrape-phase-1` | 22 / 46 | REBASE + SNAPSHOT | Email scheduler, rendered brief scrape, dashboard recovery, home work, Paint Studio, X-content frontend | Snapshot dirty work; use as source for focused lanes, not a direct merge |
| P1 | local untracked Studio source | not committed | SNAPSHOT | Invoice Studio, standalone Looper, Loop Studio, SP-16 export, Edittrax player, loopcore service | Preserve in WIP snapshot, then split by product boundary |
| P2 | `onboarding-brief` | 236 / 9 | HARVEST | Onboarding Brief generator, launch flags, locked feature card | Port only after modernizing against current Dashboard APIs |
| P2 | `production` | 236 / 6 | HARVEST | Earlier launch flags and homepage/dashboard copy | Treat as an ancestor/source for `onboarding-brief`, not a merge branch |
| P2 | `snapshot/studio-worktree-20260804` | 35 / 1 | HARVEST | Historical Studio renderer/video-export snapshot | Mine only missing files or tests; commit message explicitly says not for merge |
| P3 | `origin/claude/hitloop-capabilities-audit-7gjd5p` | 155 / 1 | HARVEST | Marketing/capabilities audit document | Copy the document only if still useful |
| P3 | `origin/claude/hitloop-repo-confirm-9m0p49` | 270 / 5 | HARVEST | Brief welcome/copy changes | Reapply only after visual review |

### Relationship Rules That Prevent Duplicate Merges

- `origin/main` is an ancestor of the P0 archive control-plane branch. This
  branch is the only direct, graph-clean candidate today.
- `origin/fix/email-digest-phase-0-1` is already an ancestor of
  `feat/brief-rendered-scrape-phase-1`; do not merge it separately.
- The current feature branch and the archive-to-X branch have diverged. The
  current branch has one unique X-content frontend commit; the Archive Inbox
  branch has six unique commits, including the day view and archive bridge.
  Preserve both while resolving their overlapping Dashboard/X-content changes.
- The local working tree adds additional changes and untracked files beyond the
  current branch. Its source is not represented by any remote branch yet.

### Already Live Or Fully Absorbed Branches

These have no commits unique from `origin/main`; do not merge them again:

- `archive/pre-production-main`
- `backup/pre-creative-brief-20260619`
- `claude/inspiring-brattain-48426b`
- `codex/daily-email-production-fix`
- `codex/daily-video-approval-fix`
- `codex/launch-docs-pipeline-audit`
- `codex/launch-hardening`
- `codex/main-optimization-sync`
- `codex/production-hardening-pass`
- `codex/production-optimization`
- `development`
- `feat/client-brain-voice-fidelity`
- `feat/digest-granular-toggles-hosted-brief-link`
- `feat/social-auto-publish`
- `fix/studio-render-card-reliability`
- `lead-generation`
- `og-meta-82628-live`, `og-meta-82628b-live`, `og-meta-82628f-live`,
  `og-meta-82628s-live`, and `og-meta-82628v-live`
- `portfolio-site`
- `prelaunch-hardening`

Local `main` is 57 commits behind `origin/main`; use `origin/main` as the
baseline, never local `main`.

## Local Working Tree Register

The current worktree contains both modified tracked files and untracked source.
It needs a WIP snapshot before any branch operation.

| Lane | High-confidence source | Merge destination | Notes |
| --- | --- | --- | --- |
| Invoice Studio | `app/dashboard/studio/invoice/`, `features/invoices/`, `app/preview/invoice/`, `components/dashboard/InvoiceBuilderCard.jsx` | `codex/feature/studio-invoice` | Public editor and local-first model; review all admin/PDF boundaries |
| Looper and audio export | `app/looper/`, `components/looper/`, `app/dashboard/studio/loop/`, `app/dashboard/studio/LoopStudio.jsx` | `codex/feature/studio-looper` | Split browser Web Audio from optional Python service |
| Loopcore service | `services/loopcore/` | `codex/feature/loopcore-service` | External runtime/deployment concern; do not commit ignored virtual environments |
| Edittrax player and SP-16 | `edittrax_player/`, `public/edittrax-player/`, `public/sp16/`, related scripts/routes | `codex/feature/studio-edittrax-export` | Keep static-player asset copy deliberate and test export packaging |
| Paint/wallpaper maker | `app/dashboard/studio/paint/` plus Studio shell changes | `codex/feature/studio-paint` | Has focused unit tests, but they have not run in this worktree |
| Studio shell/remix | `app/dashboard/studio/page.jsx`, `StudioPage.jsx`, rail UI, remix routes | `codex/feature/studio-shell-remix` | Shared dependency for Invoice, Paint, and Looper; integrate before individual tools if required |
| Homepage experiments | root `Header.jsx`, `HeroHeadline.jsx`, `HomePage.jsx`, `StackedSlidesSection.jsx`, `ox.jsx` | `codex/feature/home-layout-experiments` | Product choice required; last production lane |
| Email/digest | `features/email-digest/`, admin/worker routes, dashboard panels | covered by X/brief integration source | Do not resurrect the old digest branch separately |
| Brief rendered scrape | `features/scout-intake/`, brief APIs, tests | `codex/feature/brief-rendered-scrape` | Keep separate from homepage work |
| Dashboard recovery | dashboard failure APIs/components and lifecycle helpers | `codex/feature/dashboard-recovery` | Isolate from Studio changes before promotion |
| X content engine | `features/x-content-inventory/`, dashboard panels, scripts | `codex/feature/x-content-engine` | Reconcile with the Archive Inbox branch |

The current untracked source includes a 525 MB `services/loopcore/` directory,
but the observed source files are small. Before creating a polished feature
commit, verify its virtual environment and generated outputs are ignored.

## External Repository Register

| Repository | Status | Relationship to HITLOOP | Required action |
| --- | --- | --- | --- |
| `/Users/bballi/Documents/Repos/assetManager` | EXTERNAL, P0 | Durable NAS Archive Worker; outbound client of HITLOOP archive APIs | Update, test, configure its control URL/token; no code merge into HITLOOP |
| `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator` | EXTERNAL reference | Existing ArDrive Turbo, Arweave, and Underground Existence precedent | Reuse proven patterns selectively; do not merge its independent application |
| `/Users/bballi/Documents/Repos/CQ_X_Algo/x-post-optimizer` | EXTERNAL reference | Separate Critters Quest X-post optimizer | Mine ideas only, no code merge |
| `/Users/bballi/Documents/Repos/EditTraxV2/edittrax_dapp` | EXTERNAL reference | Separate Tezos marketplace, not the static Edittrax player source | No merge; treat current player files as their own HITLOOP lane |
| `/Users/bballi/Documents/Repos/agent_master_repo/assetManagement` | OUT OF SCOPE | Remote is `Bai-ee/editFiles`, not the Archive Worker repo | Do not confuse with `assetManager` |

Other nearby repositories were discovered but have no direct HITLOOP/`port_2026`
relationship in this review. They remain out of scope until a specific feature
or integration contract identifies them.

## P0 Archive Readiness Contract

The archive system is a two-repository pipeline:

`NAS originals -> assetManager worker -> HITLOOP archive review -> human approval -> worker re-hash -> Arweave/Turbo -> manifest/viewer -> Archive Inbox -> X content package -> human-written story -> scheduler`

Non-negotiable rules:

- NAS originals are read-only.
- SHA-256 identifies content; a source path is private provenance.
- The worker initiates outbound calls; HITLOOP never mounts the NAS.
- Human approval gates permanent publishing.
- The worker re-hashes bytes immediately before Arweave upload.
- The social package must never contain private NAS paths.
- A human writes the story and resolves rights before scheduling.

TwelveLabs: the operator confirms the credential exists. This checkout only has
`.env.local`, and no TwelveLabs-named variable was visible without exposing
secrets. Record the actual runtime location and variable name during the P0
environment check; do not print the secret or commit it.

## Integration Sequence

1. Snapshot the current HITLOOP working tree on a dated WIP branch. This is a
   preservation commit, not a PR or merge candidate.
2. Create a local tag for the live baseline and a dedicated P0 archive
   integration branch at `origin/claude/archive-poc-finalization-6qmg7k`.
3. Update the `assetManager` checkout to its remote P0 worker head in its own
   branch/worktree. Preserve its dirty `.gitignore` before updating.
4. Validate the archive lane in increasing-risk order: unit tests, HITLOOP
   production build, worker typecheck/tests, local fixture scan, authenticated
   control-plane handshake, one small NAS collection, then optional
   TwelveLabs/Arweave live steps.
5. Once P0 is proven, create the Archive Inbox/X-content integration branch
   from current production, transplant the six archive-to-X commits, then
   reconcile the one current-branch X frontend commit deliberately.
6. Split WIP source into Studio shell, Invoice, Paint, Looper, Edittrax, brief
   scrape, dashboard recovery, and homepage branches. Each branch begins from
   the latest promoted integration branch, never an old snapshot.
7. Promote exactly one validated lane to `main` at a time. Tag the resulting
   production commit before starting the next lane.

## Promotion Gate For Every Lane

- Branch is based on current `origin/main`.
- Scope and owner are documented in this file.
- Focused tests pass, plus `npm run build` for HITLOOP UI/API changes.
- No secrets, NAS paths, generated audits, local databases, or virtual
  environments are staged accidentally.
- A preview smoke check covers the user-visible route/API touched.
- Merge commit/PR records test results and rollback commit.

## Immediate Branch Plan

| Branch | Create from | Purpose | Do not merge until |
| --- | --- | --- | --- |
| `codex/wip/hitloop-local-snapshot-20260920` | current dirty worktree | Preserve all current HITLOOP source | It is split into focused feature commits |
| `codex/integration/archive-control-plane` | `origin/claude/archive-poc-finalization-6qmg7k` | P0 archive control plane | Archive build/tests and small-worker validation pass |
| `codex/integration/archive-inbox-x-content` | current production, with selected P1 commits | Archive-to-X bridge | P0 shape is stable and X divergence is resolved |
| `codex/feature/studio-*` | latest promoted Studio shell/integration branch | Invoice, Paint, Looper, Edittrax lanes | Their focused test and route checks pass |
| `codex/feature/home-layout-experiments` | current production after functional lanes | Optional homepage direction | A layout is selected and visual QA passes |

## First Action

Create the WIP snapshot branch now. It gives every subsequent operation a safe
rollback point and makes it possible to split the work without risking the
untracked Studio source.
