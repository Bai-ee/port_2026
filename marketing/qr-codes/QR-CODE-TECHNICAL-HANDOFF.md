# HitLoop Flyer QR Code — Technical Handoff

**For:** Web developer
**Prepared:** 2026-09-22
**Assets:** `marketing/qr-codes/` (`hitloop-qr-flyer.png`, `hitloop-qr-flyer.svg`, `README.md`)

---

## 1. Objective

Print flyers carry a QR code that sends people to `hitloop.agency`. We need to attribute those visitors — and any resulting signups — to the flyer, and surface that attribution in the existing **HitLoop Daily digest email**. No new tracking infrastructure is required; this rides on the GA4 + digest pipeline already in the repo.

## 2. The encoded URL (the whole tracking mechanism)

A QR code is just an encoded URL. The tracking is entirely in the query string:

```
https://hitloop.agency/?utm_source=flyer&utm_medium=qr&utm_campaign=print_flyer
```

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `utm_source` | `flyer` | Origin = printed flyer |
| `utm_medium` | `qr` | Channel = QR scan |
| `utm_campaign` | `print_flyer` | Named campaign (change per flyer batch/location to compare) |

GA4 automatically reads standard `utm_*` params on the landing URL and maps them to **session source / session medium / session campaign** at session start. Nothing needs to parse them manually.

## 3. How attribution flows (already wired — verify, don't rebuild)

1. **gtag is already loaded site-wide.** `app/layout.jsx` injects `googletagmanager.com/gtag/js` and fires `gtag('config', GA_ID)` when `GA_ID` is set. `GA_ID = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` → `G-9BK5DVFGBC` (GA4 property `532567174`).
2. **A QR scan loads the homepage with the `utm_*` params.** GA4 records that `page_view` with session source/medium `flyer / qr`.
3. **The daily digest already reports traffic by source/medium.** `app/api/admin/daily-digest/route.js` runs a GA4 `runReport` with dimensions `sessionSource` + `sessionMedium` (see `getGA4Metrics()`, the "Traffic sources" report). QR traffic appears there as a **`flyer / qr`** row — sessions + users — with **zero code changes**.
4. **Signup attribution is already possible.** The digest and GA4 both track the `sign_up` event (`lib/analytics.js` `events.SIGN_UP`). Because the `sign_up` event shares the visitor's session, GA4 attributes those conversions to `flyer / qr` in **Reports → Acquisition → Traffic acquisition** (filter session source/medium) or **Explore** with a source/medium breakdown.

Net: the flyer's visitors and their signups are attributable today, and visible in the digest's Traffic-sources section, because the digest reads GA4 by source/medium and GA4 auto-tags UTM. **No code change is needed to make the current single flyer code work.**

## 4. What the developer should actually verify / consider

Required sanity checks (should already pass):
- Confirm the homepage doesn't strip or redirect away `utm_*` params before GA4 initializes (e.g. a canonicalizing redirect that drops the query string would break attribution). Test: scan → open GA4 **Realtime** → confirm the session shows source `flyer`, medium `qr`.
- Confirm consent/cookie handling doesn't block gtag for these visitors in a way that silently zeroes the numbers.

Optional enhancements (only if we want more than GA4's default UTM attribution):
- **Mark `sign_up` as a GA4 key event / conversion** (if not already) so flyer-attributed signups roll up cleanly in Acquisition reports.
- **Add a dedicated "flyer / qr" line to the digest email**, distinct from the general Traffic-sources list, if we want it called out rather than sitting in the ranked source list. This is a presentation change in `buildEmailHtml` within `daily-digest/route.js` — cosmetic, not required for tracking.
- **Server-side redirect option (only if UTM-in-URL is undesirable):** point the QR at a short path like `/go/flyer` that 302-redirects to the homepage while appending the `utm_*` params server-side (and optionally logs the hit). Keeps the printed URL short and lets us change the destination without reprinting. Not necessary for tracking — the direct UTM URL already works.

⚠️ **Do not** rely on manually parsing `utm_*` in app code for this — GA4's built-in UTM handling is the source of truth the digest reads.

## 5. Scaling to multiple tracked codes

To compare flyers, designs, or physical locations, change **only** `utm_campaign` (or add `utm_content`) and regenerate the image — everything else stays identical. Each distinct value becomes its own row in GA4 and the digest.

```
# per location
https://hitloop.agency/?utm_source=flyer&utm_medium=qr&utm_campaign=print_flyer&utm_content=cafe_downtown
# per event
https://hitloop.agency/?utm_source=flyer&utm_medium=qr&utm_campaign=conf_2026
```

Keep `utm_source=flyer` and `utm_medium=qr` constant so all flyer traffic still aggregates under one channel while `campaign`/`content` splits it.

## 6. QR asset specifications

| Property | Value |
|----------|-------|
| Encoded data | `https://hitloop.agency/?utm_source=flyer&utm_medium=qr&utm_campaign=print_flyer` |
| Error correction | **Level H (~30% recovery)** — required so the centered logo doesn't break scanning |
| Module (dark) color | Deep brand indigo `#1a0b5e` on white — high contrast for reliable print scanning |
| Center overlay | HitLoop "H" mark (`public/img/H_Logo.png`) on a white rounded plate (~24% of code width) |
| PNG | `hitloop-qr-flyer.png`, 1600×1600 px, 600 DPI, rounded modules |
| SVG | `hitloop-qr-flyer.svg`, vector modules + embedded logo bitmap; scales to any flyer/poster size |
| Verification | Both files programmatically decoded and confirmed to resolve to the exact URL above, **with** the logo overlay in place |

Print guidance: keep the white **quiet zone** (border) around the code — don't crop it. Minimum printed size ~2 cm / 0.8 in square; larger for distant scanning. Don't recolor to low-contrast combinations or the scan reliability drops.

## 7. Testing checklist

- [ ] Scan the printed proof with 2–3 phones (iOS Camera + Android) → lands on `hitloop.agency` homepage.
- [ ] URL bar shows the `utm_*` params intact after any redirects.
- [ ] GA4 **Realtime** shows the session as source `flyer` / medium `qr`.
- [ ] Complete a test signup from that session → confirm it attributes to `flyer / qr` in GA4 Acquisition.
- [ ] Next digest email's Traffic-sources section lists the `flyer / qr` row.

## 8. Key repo references

- `app/layout.jsx` — gtag / GA4 bootstrap (`NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` = `G-9BK5DVFGBC`).
- `lib/analytics.js` — GA4 event helpers (`events.SIGN_UP`, etc.).
- `app/api/admin/daily-digest/route.js` — `getGA4Metrics()` → `trafficSources` (dimensions `sessionSource`, `sessionMedium`); `buildEmailHtml()` renders the digest. GA4 property `532567174`.

*No code was modified to produce these assets — they are static image files under `marketing/qr-codes/`.*
