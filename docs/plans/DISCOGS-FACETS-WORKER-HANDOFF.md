# Discogs facets: worker handoff (for the Discogs/assetManager thread)

Goal: new records arrive in HITLOOP with facets (genre/style/people/label/era) so the Content Engine v2 matcher can use them. No extra Discogs spend: the data is already in the release JSON the worker fetches.

## What HITLOOP already accepts (done, `features/discogs-ingest/draft-builder.js`)
`POST discogs/draft` now also reads these OPTIONAL fields. Unknown or invalid values are dropped, never rejected, so the worker can ship any subset:

| Field | Type | Source in the Discogs release JSON |
|---|---|---|
| `genres` | string[] | `rel.genres` (e.g. `["Electronic"]`) |
| `styles` | string[] | `rel.styles` (e.g. `["Acid House","Deep House"]`) |
| `artists` | string[] | `rel.artists[].name`, cleaned with `cleanName` (one entry per artist; today `artist` is a comma-joined string) |
| `formats` | string[] | `rel.formats[].name` + `descriptions` (e.g. `["Vinyl","12\""]`) |
| `country` | string | `rel.country` |
| `tracklist` | string[] or `{title}[]` | `rel.tracklist[].title` (max 60 entries kept) |

Facets are built from `artists` (fallback: `artist`), `label`, `year`, `genres` + `styles`; gear only when a style names it (e.g. "TB-303"). `formats`, `country`, `tracklist` are validated and parsed but not yet mapped to a facet field (no field exists in Facets v1).

## Where the data already lives in assetManager
- `lib/discogs/publish.ts`: `releaseFacts(rel)` receives the full release JSON (`rel`) and returns only artist/title/label/catno/year. Extend it (and the `ReleaseFacts` type) to also return `genres`, `styles`, `artists`, `formats`, `country`, `tracklist`.
- `lib/discogs/publish.ts`: `buildDraftBody(facts, ...)` builds the HTTP body. Add the fields there (apply `stripEmoji` to strings).
- `lib/discogs/matcher.ts` already reads `formats` and `country` from search results (lines ~51-101), but search results carry no `genres`/`styles` reliably, so use the release fetch, not the search hit.
- `lib/discogs/publish-cli.ts` line ~253 calls `buildDraftBody`; no change needed there beyond passing the richer facts.

## Behavior to expect
- Re-publishing an existing release refreshes machine facets; owner edits (`humanEdits`) and story/status are never overwritten.
- Existing packages: use `node scripts/discogs/backfill-facets.mjs` (dry run, offline by default; `--discogs` and `--write` are owner-only).
- Do not edit HITLOOP from the worker side; only add request fields.
