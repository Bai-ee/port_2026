# Source Library: brain layout

Status: phase 1 live (2026-11-19). Phase 2 (HITLOOP writes analysis docs and updates MASTER_BRAIN.md) is not built.

## Why

The owner keeps a company brain outside HITLOOP (built in ChatGPT; reference copy:
Critters Quest, NAS `Critters Quest/brain-backups/2026-11-19/brain`). The Source Library now
stores files in the same folder layout. The Critters Quest brain can be imported as it is,
added to in HITLOOP, and downloaded again as the same kind of folder. The result is a growing
archive used for marketing insight and strategy.

The Source Library does **not** change the HITLOOP Client Brain (`clients/{id}/client_brain/current`)
and it does not edit the external brain.

## Layout

| Path | Role | Rule |
|---|---|---|
| `MASTER_BRAIN.md` | master | exact name, root |
| `INDEX.md` | index | exact name, root |
| `manifest.json` | manifest | exact name, root |
| `STRATEGY_WORKING_BRIEF.md` | brief | UPPER_CASE `.md` at root |
| `2026-11-19-<slug>.md` / `.json` | analysis | dated `.md`/`.json` at root |
| `sources/...` | source | raw evidence, stored byte-for-byte |
| `versions/<label>/...` | version | snapshots of earlier files |

A loose file that is not one of the root documents is raw evidence. It is filed as
`sources/<today>-<slug>.<ext>`. A file already named with a date keeps its name.
Pasted text and imported URLs are also filed as sources. Their text is saved to Storage so they
export as files.

The code for all of this is `features/knowledge-base/brain-layout.js`, which is pure and has tests.

## Upload

- **Folder pick.** The "Or a Brain Folder" picker in the card sends each file with its path. The
  folder that was picked is dropped from the path, so `brain/INDEX.md` becomes `INDEX.md`.
- **Unchanged file.** If the same path is uploaded again with the same sha256, it is skipped.
- **Changed file.** It becomes the current item. The old item moves to
  `versions/<date>-before-<name>/<path>` and is kept, both in search and in the export.
- **Ignored files.** Hidden and system files (`.DS_Store`, `__MACOSX`) are skipped.
- **Limit.** The cap is 500 items per client. It was 100.

New item fields: `brainPath`, `brainRole`, `brainDate`, `versionLabel`, `sha256`.
Items saved before this change have no `brainPath`. They show as `legacy` sources named after
their file or title. Nothing is migrated.

## Source IDs

When `sources/*source-register.md` exists, its table maps IDs to files: the first column is the
ID (D1, X1–X11) and the other columns link to files. The item list shows those IDs.

## Download

`GET /api/dashboard/knowledge-base/brain?format=zip|manifest|index`

- **Zip.** `<project>-brain-<date>/` contains every file byte-for-byte, including versions.
- **INDEX.md.** The uploaded INDEX.md is kept as written. Files it does not link yet are listed
  under "Added in HITLOOP". If no INDEX.md was uploaded, one is generated.
- **manifest.json.** It is regenerated from the exported bytes, in the reference shape
  (`schema_version`, `project`, `files[{path, bytes, sha256}]`), so the hashes always match.
- **Size limit.** The download is limited to 4 MB, because of the Vercel response size limit.

## MCP

The owner MCP (ChatGPT and Claude connectors) can list, read, upload and edit brain files:
`source_library_list`, `source_library_read` and `source_library_save`. They call the same routes as the
card, so the filing and versioning rules above apply as they are. For an edit, save the full new content to
the same path with the `expectedSha256` you read. The old copy is kept in `versions/`. See
[HITLOOP-MCP-SERVER.md](../../source-of-truth/HITLOOP-MCP-SERVER.md).

## Search

`searchKnowledgeBase` fetches twice as many results and re-ranks them by role:
- master, analysis and brief docs move up a little;
- index and manifest files move down;
- version snapshots only fill the results when nothing current does.

Every consumer of `getKnowledgeBaseRuntimeContext` gets this ranking without any changes.

## Costs

Ingest is unchanged. Each file is chunked and embedded with OpenAI `text-embedding-3-small`, which
costs cents per brain. Importing and exporting make no LLM calls.
