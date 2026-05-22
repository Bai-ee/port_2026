# Brain Claude Phase Index

Use these prompts in order. Each phase assumes the previous phase is complete, reviewed, and approved.

## Source Of Truth

- `docs/BRAIN_FEATURE_PLAN.md`
- `docs/BRAIN_MASTER_PROMPT.md`

## Prompts

1. Phase 1 - Storage And Ingest Backbone
   - `docs/BRAIN_CLAUDE_PHASE_01_STORAGE_INGEST.md`

2. Phase 2 - Card UI
   - `docs/BRAIN_CLAUDE_PHASE_02_CARD_UI.md`

3. Phase 3 - Embeddings And Retrieval
   - `docs/BRAIN_CLAUDE_PHASE_03_EMBEDDINGS_RETRIEVAL.md`

4. Phase 4 - Strategy Builder Wiring
   - `docs/BRAIN_CLAUDE_PHASE_04_STRATEGY_BUILDER_WIRING.md`

5. Phase 5 - Document Upload Ingest
   - `docs/BRAIN_CLAUDE_PHASE_05_PDF_INGEST.md`

## Usage Rule

After each phase:

- verify acceptance criteria
- summarize files changed
- list tests run
- list residual risks
- stop
- wait for explicit approval before starting the next phase

Do not skip ahead. Do not add dependencies unless the active phase prompt says the relevant approval gate has already been approved.
