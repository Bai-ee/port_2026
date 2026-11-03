# Invoice Studio — 2026-10-13 session handoff (merge brief)

Audience: the agent merging this work. Read this end to end before touching git.
SSOT for the feature: [`docs/source-of-truth/INVOICE-STUDIO.md`](../source-of-truth/INVOICE-STUDIO.md) — this session's changes are NOT yet reflected there (see §6).

## 0. TL;DR

- **One production bug fix (urgent):** every invoice publish 500s on `main` with `resolvePaymentQr is not defined`. Nothing has saved since 2026-09-02.
- **Three features:** auto-load latest saved invoice in Studio (signed-in, not admin-only), bank-transfer payment fields (Studio + legacy card), "Open Studio" launchers on the dashboard card/modal.
- All uncommitted, on branch `codex/wip/archive-x-localhost-test` (HEAD `d0fb19fc`, **57 commits behind `origin/main` e4bce520**, 0 ahead).
- Exact invoice-only diff: [`INVOICE-STUDIO-2026-10-13-SESSION.patch`](INVOICE-STUDIO-2026-10-13-SESSION.patch) — **verified to `git apply --check` cleanly onto `origin/main`**.

## 1. ⚠️ Do NOT sweep in unrelated dirty files

The checkout has OTHER uncommitted work that is not part of this session. Leave it alone:

```
api/_lib/editvideos-bridge.cjs          (not this session)
app/api/dashboard/media/route.js        (not this session)
app/api/worker/pre-digest-video/route.js (not this session)
docs/plans/*.md untracked (CONTENT-*, TELEGRAM-*, DAILY-CONTENT-LOOP-*, VIDEO-REMIX-*, ACTIVE-CONTENT-SYSTEM-PLAN) (not this session)
```

This session's files (and only these):

| File | Change |
|---|---|
| `app/api/dashboard/custom-briefs/route.js` | **Bug fix** — hoist `DEFAULT_FROM` / `resolvePaymentQr` declarations out of the first `if (kind === 'invoice')` block |
| `app/dashboard/studio/invoice/rail/InvoiceRail.jsx` | Saved-invoices gated on signed-in (not admin); auto-load newest; marker helpers |
| `app/dashboard/studio/invoice/useInvoiceDraft.js` | `openedSavedRef` race guard |
| `app/dashboard/studio/invoice/rail/PaymentCard.jsx` | Bank-transfer fields (Add / Remove) |
| `app/dashboard/studio/invoice/invoice-fields.js` | 4 `payment.bank.*` field-catalog entries; `bank=` part in `structureKey()` |
| `app/dashboard/studio/invoice/__tests__/invoice-fields.test.js` | Field count 63 → 67 + the 4 new paths |
| `features/invoices/model.js` | `normalizePayment()` → `bank: normalizeBank()` |
| `features/invoices/render.js` | `buildPayment()` renders `#invoice-payment-bank` above method/QR |
| `components/dashboard/InvoiceBuilderCard.jsx` | Legacy card: bank inputs (`#invoice-builder-bank-panel`) + `#invoice-builder-open-studio-link` |
| `DashboardPage.jsx` | `invoice-builder` card: `footerAction` OPEN STUDIO (4 lines) |

`DashboardPage.jsx` is the only touched file that also changed on `main` since HEAD; the hunk is local to the `invoice-builder` card object and the patch still applies cleanly.

## 2. Recommended merge plan

1. Branch from fresh `origin/main` (e.g. `fix/invoice-publish-and-bank-transfer`) in a **git worktree** — never `npm run build` in the main checkout while `next dev` runs (memory: builds clobber `.next`).
2. `git apply docs/plans/INVOICE-STUDIO-2026-10-13-SESSION.patch`.
3. **Commit 1 (ship first, standalone):** `app/api/dashboard/custom-briefs/route.js` only — `fix(invoices): hoist publish-route imports out of block scope`. This restores publishing in prod.
4. **Commit 2:** Studio auto-load + signed-in Saved invoices (`InvoiceRail.jsx`, `useInvoiceDraft.js`).
5. **Commit 3:** bank transfer (`model.js`, `render.js`, `invoice-fields.js` + test, `PaymentCard.jsx`, `InvoiceBuilderCard.jsx` bank panel).
6. **Commit 4:** launchers (`DashboardPage.jsx` footerAction, `InvoiceBuilderCard.jsx` toolbar link).
   - `InvoiceBuilderCard.jsx` carries hunks for both 3 and 4 — use `git add -p`.
7. Run verification (§5), then PR. Deploy only with owner approval.

## 3. The bug fix — detail

`POST /api/dashboard/custom-briefs` (kind `invoice`): `let DEFAULT_FROM; let resolvePaymentQr;` were declared inside the first `if (kind === 'invoice') { … }` (dynamic imports), but read in a **second, sibling** `if (kind === 'invoice')` block (render call, `resolvePaymentQr(invoiceModel.payment?.qr)` + `defaultFrom: DEFAULT_FROM`). Block scope → `ReferenceError` → caught → 500 `{"error":"resolvePaymentQr is not defined"}`. The PDF/Firestore write never ran. Introduced by `15f04a56` (2026-09-20). Present on `origin/main` today.

Fix moves both `let`s up beside the other route-level `let`s (`invoiceModel`, `invoicePdfHeightPx`…). No behavior change otherwise.

Verified live on localhost: publish of `clients/bryan-balli-WUoltG84/custom_briefs/invoiceinv20260902912` succeeded after the fix (updatedAt 2026-10-13T17:40:07Z, issue 2026-10-13, due 2026-10-18, PDF generated), public page shows the new dates.

**Gap:** no regression test exists for this route's invoice path. Worth adding one (a POST with `kind:'invoice', preview:true` would have caught it — preview returns before the PDF/write but after the render call).

## 4. Features — contracts to preserve

### 4a. Auto-load + Saved invoices for signed-in users (`InvoiceRail.jsx`)
- Saved invoices card + list fetch gated on `isSignedIn = Boolean(user)` (was `isAdmin`). Safe: `GET /api/dashboard/custom-briefs` is `verifyRequestUser`-gated and scoped to the caller's own client. **Publish stays admin-only** (POST is `verifyAdminRequest`); the divider reads "Admin" for admins, "Saved" otherwise.
- Auto-load: once per page load, after `draft.ready` and the list resolves, opens `savedInvoices[0]` (newest, server-sorted by updatedAt) quietly (no card opens). Skips when:
  - `draft.dirty`;
  - localStorage `invoice-studio-autoload-v1` already equals `<briefSlug>@<updatedAt>`;
  - the local draft's `invoiceNumber` equals the newest's (keeps unpublished local edits).
- After a successful publish, the marker is written for the returned brief so the user's own publish never triggers a revert.
- ⚠️ A data-loss bug was found and fixed mid-session: before the `invoiceNumber` guard + publish-marker, a reload after publishing reverted unpublished local edits. Keep both guards.
- `useInvoiceDraft.js`: `openedSavedRef` — `isAdmin` resolves after `user` (AuthContext `adminReady`), which re-runs the draft's initial `load()`; without the guard that re-run clobbered the auto-loaded invoice.
- Known limit: list only includes `public: true` briefs (route filter); a private-saved invoice won't auto-load.

### 4b. Bank transfer
- Model: `payment.bank = { bankName, accountNumber, routingAch, routingWire }` (all `cleanString`, free text so leading zeros survive). Always present after normalize.
- Render: `#invoice-payment-bank` card **above** the method/QR rows; each row only when set; whole card omitted when all empty → **byte-identical output for invoices without bank** (golden-fixture tests still pass).
- Studio canvas: each row is an `editableField` (`payment.bank.*`, type `text`); `structureKey()` includes a `bank=` presence bitmask so adding/removing a row re-renders the canvas (value-only edits don't).
- Studio rail: "Add bank transfer" reveals 4 inputs + "Remove bank transfer" (clears all 4); hint text warns the link is public.
- Legacy `InvoiceBuilderCard`: 4 inputs above Payment method; preview goes through the server render, so it shows the block.
- No separate on/off toggle yet (owner asked about one; not built). Hiding = clear fields, or the Payment section eye.
- **Owner's real bank details are NOT in source.** They exist only in the owner's browser-local Studio draft on `localhost:3001` (unpublished, by owner choice). Do not add them to `features/invoices/default-draft.js` or any tracked file. The exported patch was checked: contains none of them.

### 4c. Launchers
- `DashboardPage.jsx` `invoice-builder` card: `footerAction: { label: 'OPEN STUDIO', onClick: window.open('/dashboard/studio?tool=invoice','_blank') }` — same pattern as the Holo Paper card; renders on tile + list row with `stopPropagation`.
- `InvoiceBuilderCard.jsx` toolbar: `<a id="invoice-builder-open-studio-link" target="_blank">Open Studio ↗</a>` next to "+ New Invoice" (wrapped in `#invoice-builder-toolbar-actions`).
- Note: legacy card and Studio keep **separate drafts** (legacy = in-memory; Studio = localStorage `invoice-studio-draft-v2`). They only converge through publish → Saved invoices.

## 5. Verification

Done this session:
- `node --test app/dashboard/studio/invoice/__tests__/*.test.* features/invoices/__tests__/*.test.* app/dashboard/studio/invoice/holo/__tests__/*.test.*` → **275/275 pass**.
- Server render check: bank block present, above Venmo, empty rows absent.
- Live (localhost:3001, Chrome): canvas date edit → draft; publish succeeds after fix; bank block renders on canvas above Venmo; survives reload.
- Dashboard + Studio routes return 200 after edits.

NOT done — merging agent should run:
- Full `npm test` (only invoice/holo scope was run).
- `npm run build` **in an isolated worktree** (+ `npm run smoke:routes`).
- Manual: both OPEN STUDIO launchers; legacy card bank inputs → Refresh preview; Studio "Add/Remove bank transfer"; publish → PDF shows bank block; non-admin signed-in user sees Saved invoices but no Publish.

## 6. Docs to update on merge

`docs/source-of-truth/INVOICE-STUDIO.md`:
- §1 architecture / §7 area: auto-load contract (§4a above) and the `invoice-studio-autoload-v1` key.
- §2 canonical shape: `payment.bank`.
- Field catalog count 63 → 67.
- §4 privacy note: Saved invoices now signed-in (own client only); Publish still admin.
- Legacy card now has bank fields + Studio launcher (retirement decision still open).

## 7. Open owner decisions (do not act on without asking)

- Separate "Show bank transfer" on/off toggle (offered, not approved).
- Retire legacy `InvoiceBuilderCard` vs keep both editors.
- Publishing the bank-detail invoice publicly (owner chose: keep local for now).
- Deploy timing for the publish fix.
