# Brand Guide v2 — Claude Code Handoff

Everything Claude Code needs to implement the Brand Guide v2 expansion is in this folder.

## Start here

Read these files in this order:

1. **`DESIGN.md`** — Full architecture: pipeline phases, schema, gap definitions, vision modules, prompt templates, file changes, API changes, migration, and 5-sprint implementation plan
2. **`SCHEMA.json`** — Formal JSON Schema for the v2 Brand DNA output (~60 fields, 14 sections)
3. **`EXISTING-CODE-MAP.md`** — Map of every existing file in the v1 system with line counts and responsibilities

## Vision skill prompts (ready to deploy)

These `.md` files are the system prompts for Claude vision analysis. Each one tells Claude what to extract from a specific image type. They go in `features/scout-intake/skills/` and are loaded by the corresponding `.js` vision module.

- `vision-logo.md` — Logo analysis (enhanced v1 — adds logo_type, containment, suggested_icons)
- `vision-site.md` — Homepage screenshot analysis (NEW)
- `vision-mood.md` — Mood board / reference image analysis (NEW)
- `vision-photo.md` — Brand photography direction extraction (NEW)
- `vision-competitor.md` — Competitor screenshot differentiation mapping (NEW)
- `vision-palette.md` — Color palette extraction from uploaded images (NEW)

## Sprint-by-sprint prompts for Claude Code

### Sprint 1: Schema + Core Mapper
```
Read docs/brand-guide-v2/DESIGN.md sections 1-3 and EXISTING-CODE-MAP.md.
Implement the v2 schema in features/scout-intake/modules/brand-system.js:
- Bump SCHEMA_VERSION to 2
- Expand GAP_DEFS with phase tagging (phase 1/2/3)
- Add all new gap definitions from DESIGN.md section 3
- Expand mapPipelineToBrandSystem() to populate new fields
- Build buildBrandSystemJsonV2() matching SCHEMA.json
- Add fieldForGap() mappings for all new gap IDs
- Keep backward compatibility with v1 schema
```

### Sprint 2: Vision Modules
```
Read docs/brand-guide-v2/DESIGN.md section 4 and all vision-*.md files.
Create vision analysis modules following the pattern in brand-system-vision.js:
- Copy each vision-*.md to features/scout-intake/skills/
- Create matching .js modules in features/scout-intake/modules/
- Each module: loads skill prompt, calls callAnthropic(), parses JSON response
- Use claude-sonnet-4-20250514 model, 1500 max tokens
- Follow the exact pattern from brand-system-vision.js
```

### Sprint 3: Prompt Templates
```
Read docs/brand-guide-v2/DESIGN.md section 5.
Create features/scout-intake/prompt-templates/ with:
- index.js (template registry)
- brand-poster.js (upgrade v1 buildMasterPrompt)
- storyboard.js, product-shots.js, web-design.js, character-sheet.js, social-media.js
- Each exports: { buildPrompt(brandGuideJson) → string }
```

### Sprint 4: API + Frontend
```
Read docs/brand-guide-v2/DESIGN.md sections 6-8.
Update app/api/brand-system/chat/route.js:
- Handle new gap IDs, multi-image uploads, phase routing
- Wire up new vision modules for each asset type
- Support Phase 5 template selection
Update app/api/brand-system/scan/route.js:
- Load homepage screenshot URLs for Phase 1
Update components/dashboard/BrandSystemTerminal.jsx:
- Add Phase 1 UI (screenshot viewer + feedback)
- Add multi-file upload for Phase 2
- Add template selector for Phase 5
- Update phase counter from 3 → 5
```

### Sprint 5: Polish + Testing
```
Read docs/brand-guide-v2/DESIGN.md section 10.
- End-to-end test with real brand data
- Tune vision prompts for extraction quality
- Tune prompt templates for generation quality
- Implement skip logic and conditional gaps
- Verify source attribution accuracy
- Optimize with parallel vision calls
```
