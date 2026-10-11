# Telegram intake audit (track D)

## What the web does today
- **Library tab** (X Content Engine, `inventory`) reads `x_content_packages/{id}` via `features/x-content-inventory/store.js` (`readInventory`). One doc = one ContentPackage. The collection is **global, not client-scoped** (store.js header); the only per-client pieces are thumbs (`content-thumbs/<clientId>/...`) and bucket/folder docs.
- Media refs on a package: `assetRefs[]`. The Library's media resolver (`thumbs.js resolveMediaUrlsBatch`) understands `ev:<path>` (EditVideos bucket) and `publish-staging/...` (HITLOOP default bucket, token URL).
- There is **no direct browser upload into the Library**. Web upload paths are: `create-upload-session`/`complete-upload` in `app/api/dashboard/media/route.js` (signed upload to the EditVideos source bucket + `media_assets` index; this is Video Remix/Media Library, admin-mutated, not the X Library) and `capture-client-story` (`client-capture.js buildClientPackage`, metadata only, `assetRefs` supplied by caller). `api/_lib/storage-artifacts.cjs saveBufferArtifact` is the generic buffer-to-default-bucket helper.

## Chosen reuse
- **Register:** `upsertPackage(pkg, {returnPackages:false})` from `features/x-content-inventory/store.js` (validated by `validatePackage`; merge write; idempotent per id). Telegram builds the package like `buildClientPackage`: series `C6`, engine `client`, pillar `building-now`, story `[add your memory]` placeholder, `effort:'10-min'`.
- **Bytes:** default HITLOOP bucket (`adminStorage.bucket()`), path `publish-staging/telegram/<clientId>/<intakeId>/<n>-<fileUniqueId>.<ext>` (deterministic: a retry overwrites, no orphan). Not the EditVideos bucket, not `media_assets`, no NAS, no render path.
- **Required fields:** id, series, pillar, title, story, mediaState, effort, rights (schema `REQUIRED_FIELDS`).
- **Rights/approval:** `RIGHTS_STATES` has no `unknown`. Mapped to `rights:'client-approval-needed'` + `approval:{state:'needed'}` + extra `rightsDeclared:'unknown'`. Item cannot be matched/posted until a human sets rights and approves.
- **Client scoping:** the collection is global, so intake adds `clientId` on the package (extra field, ignored by validation) and in the storage path. Client-scoped Library reads beyond the owner pilot are the orchestrator's concern; the field is there to filter on.
- **Provenance:** `provenance:{transport:'telegram', chatId, messageId, messageIds, mediaGroupId, intakeId, assets:[{fileUniqueId,messageId,storagePath,contentType,bytes,sha256}]}`. Caption/answer: `context:{caption,note,treatAs:'data'}`.

## Caveats for the orchestrator
- The bot must route main-keyboard button texts before calling `handleMessage`, else a text reply while a context question is open could be swallowed as context.
- No lease around an intake doc; a dispatcher overlap on the same album is harmless (deterministic ids, idempotent upsert) but may double-send a message.
