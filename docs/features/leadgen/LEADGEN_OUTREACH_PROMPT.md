# Lead Gen Outreach Pipeline — PACKAGE & SEND

> **AS-BUILT UPDATE — 2026-06-25 (email redesign).** The PACKAGE/SEND pipeline,
> Firestore schema, routes, and UI below are accurate. The **email template
> visual design changed** and supersedes §5 + "Email Template Spec" (those
> describe the original prospect-themed postcard, kept for history).
>
> `features/leadgen/email-template.js` now renders in the **HITLOOP BRIEF kit**
> (warm-cream), matching the Email Digest renderer (`app/api/admin/daily-digest/route.js`):
> - **Tokens:** bg `#f2f7f7` · cards `#fffdf7` · ink `#12100c` · terracotta accent
>   `#b8542e`. Doto display headline, Space Mono micro-labels, Space Grotesk body
>   (web fonts via `@import`; Gmail/Outlook strip → system mono/sans fallback).
> - **Layout:** compact provenance header (circle logo + `HITLOOP` + `hitloop.agency`)
>   → Doto hero "A preview for {business}" → hero preview image → `Why I built this`
>   (pull-quote note) → `Before / after` (two cards) → `AI readiness` (Doto stat
>   cells) → terracotta CTA → HITLOOP footer. **No dotted mono eyebrows** (removed
>   as an AI-design tell).
> - **Background = bulletproof gradient** `#f8eee7 → #f2f7f7 → #e7edf1`: hosted JPG
>   `public/img/leadgen-email-bg.jpg` via `<td background>` attr + inline
>   `background-image:url()` + CSS-gradient fallback + Outlook `<v:background>` VML +
>   `#f2f7f7` solid fallback. ⚠️ Gmail does **not** render CSS gradients — it shows
>   the JPG (once deployed; the file 404s on prod until then) else the solid. Apple
>   Mail / iOS / most webmail show the CSS gradient immediately.
> - **`theme` param** is still accepted (package route passes it) but **unused** for
>   the shell — the brand is fixed. Drop or rewire if per-prospect theming returns.
> - **Footer/brand:** HITLOOP · Bryan Balli · hitloop.agency (was bryanballi.com).
>
> **New files (not in the original manifest):**
> - `app/api/leadgen/email-preview/route.js` — dev-only visual harness. Open
>   `localhost:3000/api/leadgen/email-preview` (toggles `?before=0`, `?readiness=0`).
> - `public/img/leadgen-email-bg.jpg` — page-background gradient (7KB).
>
> **Open follow-ups:** (1) deploy so the bg JPG resolves in Gmail; (2) the header
> logo points at `circle_logo.png` (554KB) — ship an optimized ~80px copy.

## Objective

Build the outreach leg of the lead-gen pipeline. Two new buttons appear inline on every prospect row in `LeadGenDashboard.jsx`:

1. **PACKAGE** — generates a postcard-style HTML email themed to match the prospect's generated preview site, with a thumbnail, personal note, before/after comparison, and Calendly CTA.
2. **SEND** — sends the packaged email to the prospect via Gmail API (OAuth2) from `bryanballi@gmail.com`.

The pipeline stage progresses: `ready → packaged → contacted`.

---

## Architecture Overview

```
PACKAGE button click
  → POST /api/leadgen/package  (streams NDJSON)
    1. Capture thumbnail screenshot of previewUrl → upload to Firebase Storage → thumbnailUrl
    2. Extract theme (colors, fonts) from generation.designMd
    3. Claude composes a short personalized note
    4. Render postcard HTML email with inline CSS
    5. Persist to Firestore: outreach.* fields
    6. Update stage → "packaged"

SEND button click (only visible after packaging)
  → Preview modal opens showing rendered email
  → Operator reviews / optionally edits note
  → Clicks "Send to Owner"
  → POST /api/leadgen/send
    1. Read outreach.emailHtml from Firestore
    2. Build MIME message with inline thumbnail image
    3. Gmail API users.messages.send
    4. Update stage → "contacted", set outreach.sentAt
```

---

## Detailed Specifications

### 1. Firestore Schema Additions

Add these fields to each `leadgen_prospects` document:

```js
{
  // ... existing fields ...
  stage: 'packaged',  // NEW stage between 'ready' and 'contacted'

  outreach: {
    thumbnailUrl: 'https://firebasestorage...',     // Screenshot of preview site
    thumbnailBase64: '...',                          // Base64 fallback for email embedding
    theme: {
      primaryColor: '#1a365d',
      accentColor: '#e53e3e',
      fontFamily: 'Inter',
    },
    note: 'Hi Dr. Martinez, I noticed your practice...',  // AI-composed, editable
    emailHtml: '<html>...</html>',                         // Complete postcard email
    emailSubject: 'I built something for [Business Name]',
    packagedAt: '2026-05-07T...',
    sentAt: null,                                          // Set on send
    sentTo: null,                                          // Recipient email used
    gmailMessageId: null,                                  // Gmail API response ID
  }
}
```

### 2. Update constants.js

**File:** `features/leadgen/constants.js`

Add `'packaged'` to `PIPELINE_STAGES` between `'ready'` and `'contacted'`:

```js
export const PIPELINE_STAGES = [
  'discovered',
  'scored',
  'onboarding',
  'auditing',
  'audited',
  'generating',
  'ready',
  'packaged',   // ← NEW
  'contacted',
];
```

Also update `VISIBLE_STAGES` in `LeadGenDashboard.jsx`:

```js
const VISIBLE_STAGES = ['discovered', 'scored', 'audited', 'ready', 'packaged', 'contacted'];
```

And add to `STAGE_LABELS`:

```js
packaged: 'Packaged',
```

---

### 3. API Route: `/api/leadgen/package/route.js`

**Streaming NDJSON endpoint. Follows the same pattern as `generate-site/route.js`.**

```
POST /api/leadgen/package
Body: { placeId: string }
Auth: Bearer token (verifyRequestUser)
Response: application/x-ndjson stream
```

**Steps (each emits a progress event):**

#### Step 1: Load prospect from Firestore
- Read the prospect doc by `placeId`
- Validate `stage === 'ready'` and `generation.previewUrl` exists
- Emit: `{ type: 'progress', stage: 'load', label: 'Loading prospect data…' }`

#### Step 2: Capture thumbnail
- Use the existing Vercel preview URL
- Capture a screenshot using one of these approaches (in priority order):
  - **Option A (preferred):** Call a headless browser service (e.g., `https://api.screenshotone.com` or similar) with the `previewUrl` to get a 1200×630 PNG (OG image dimensions)
  - **Option B (fallback):** If the `onboard.multiDeviceView.desktopUrl` already exists on the prospect (from earlier analysis), use that as the thumbnail
  - **Option C (simplest):** Use the `generation.mockupUrl` if available from the mockup generation step
- Upload the screenshot buffer to Firebase Storage at `leadgen-thumbnails/{placeId}.png`
- Get the public download URL
- Emit: `{ type: 'progress', stage: 'thumbnail', label: 'Capturing site thumbnail…' }`

#### Step 3: Extract theme from DESIGN.MD
- Parse `generation.designMd` (the stored creative brief) to extract:
  - `primaryColor` — look for the primary brand color hex
  - `accentColor` — look for accent/CTA color hex
  - `fontFamily` — look for the heading font family name
- Fallback defaults: `primaryColor: '#1a1a1a'`, `accentColor: '#2563eb'`, `fontFamily: 'Inter'`
- Emit: `{ type: 'progress', stage: 'theme', label: 'Extracting site theme…' }`

#### Step 4: Compose personalized note via Claude
- Call Anthropic API (claude-haiku-4-5 for speed/cost) with a prompt like:

```
You are writing a brief, warm outreach note from Bryan Balli, a web developer, to a
local business owner. Bryan speculatively built a modern preview website for their
business to demonstrate what an upgrade could look like.

Business: {prospect.name}
Vertical: {prospect.vertical}
Location: {prospect.address}
Current website issues: {summarize top 3 deficiencies from prospect.quickAudit.deficiencies}
AI Readiness improvement: {prospect.generation.readinessComparison.before.score} → {prospect.generation.readinessComparison.after.score}

Write 3-4 sentences. Tone: confident but not pushy, specific to their business,
mention one concrete improvement. Do NOT use exclamation marks excessively.
Sign off with just "— Bryan"

Example output:
"Hi Dr. Martinez, I came across your practice online and noticed your current site
isn't mobile-friendly and loads slowly on phones — two things that cost you patients
searching on the go. I took the liberty of building a modern preview to show what's
possible: faster load times, mobile-first design, and structured data so AI assistants
can recommend your practice. Take a look and let me know if you'd like to chat.
— Bryan"
```

- Emit: `{ type: 'progress', stage: 'compose', label: 'Writing personal note…' }`

#### Step 5: Render postcard HTML email
- Build a self-contained HTML email using **inline CSS only** (no external stylesheets — email clients strip them)
- The design should feel like a physical postcard:
  - **Card container:** max-width 600px, centered, rounded corners (border-radius on outer table for Outlook compat), subtle shadow via border
  - **Header strip:** Uses `primaryColor` as background, white text showing "A preview built for [Business Name]"
  - **Thumbnail hero:** The captured screenshot, full-width, clickable — links to `generation.previewUrl`
  - **Note section:** The AI-composed note on a clean white background
  - **Before / After section:** Two-column (stacked on mobile) showing:
    - Left: "Your current site" with a small screenshot or placeholder linking to `prospect.website`
    - Right: "Your new preview" with thumbnail linking to `previewUrl`
    - Below: AI Readiness score improvement badge (e.g., "AI Readiness: 22 → 87")
  - **CTA button:** `accentColor` background, white text: "Book a 15-min Call" → links to `https://calendly.com/bryanballi` (or whatever the Calendly URL is)
  - **Footer:** Small text: "Built by Bryan Balli · bryanballi.com · Reply to this email anytime"
- Use `fontFamily` from the theme for headings; fallback to system fonts
- **Email HTML compatibility notes:**
  - Use `<table>` layout (not flexbox/grid)
  - All CSS must be inline `style=""` attributes
  - Use `<!--[if mso]>` conditionals for Outlook width fixes
  - Images need `display: block` and explicit width/height
  - Background colors via `bgcolor` attribute as fallback
  - Test with: Gmail, Apple Mail, Outlook (the big 3)

- Emit: `{ type: 'progress', stage: 'render', label: 'Building postcard email…' }`

#### Step 6: Persist to Firestore
- Write all `outreach.*` fields to the prospect document
- Update `stage` to `'packaged'`
- Emit: `{ type: 'done', status: 'succeeded', result: { thumbnailUrl, note, emailSubject } }`

---

### 4. API Route: `/api/leadgen/send/route.js`

**Non-streaming JSON endpoint.**

```
POST /api/leadgen/send
Body: { placeId: string, recipientEmail?: string, editedNote?: string }
Auth: Bearer token
Response: JSON { success: true, messageId: string }
```

**Steps:**

#### Step 1: Load prospect + outreach data
- Validate `outreach.emailHtml` exists
- Determine recipient: use `recipientEmail` from body, or fall back to `prospect.email`
- If no email available, return 400 error

#### Step 2: (Optional) Re-render email if note was edited
- If `editedNote` differs from stored `outreach.note`, re-render the email HTML with the new note and update Firestore

#### Step 3: Build MIME message
- Construct a `multipart/mixed` MIME message:
  - `From: Bryan Balli <bryanballi@gmail.com>`
  - `To: {recipientEmail}`
  - `Subject: {outreach.emailSubject}`
  - `Content-Type: text/html` body with the postcard HTML
  - Inline the thumbnail as a `Content-ID` attachment for reliable rendering (optional — can also use the hosted Firebase Storage URL)
- Base64url-encode the entire MIME string for Gmail API

#### Step 4: Send via Gmail API
- Use `googleapis` npm package
- Auth: OAuth2 with stored refresh token
  - Credentials from env vars: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`
  - Token endpoint: `https://oauth2.googleapis.com/token`
- Call `gmail.users.messages.send({ userId: 'me', requestBody: { raw: base64urlMessage } })`
- Capture `messageId` from response

#### Step 5: Update Firestore
- Set `outreach.sentAt`, `outreach.sentTo`, `outreach.gmailMessageId`
- Update `stage → 'contacted'`

---

### 5. Gmail OAuth2 Setup

**Environment variables needed:**

```env
GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxx
GMAIL_REFRESH_TOKEN=xxx
```

**One-time setup instructions:**

1. Go to Google Cloud Console → APIs & Services → Credentials
2. Use the existing OAuth 2.0 client (same project as Firebase) or create a new one
3. Add `https://www.googleapis.com/auth/gmail.send` to the scopes
4. Generate a refresh token using the OAuth Playground or a one-time auth flow
5. Store in `.env.local`

**Implementation:** Create a helper at `features/leadgen/gmail-client.js`:

```js
import { google } from 'googleapis';

export function getGmailClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export function buildMimeMessage({ to, subject, htmlBody, fromName = 'Bryan Balli', fromEmail = 'bryanballi@gmail.com' }) {
  const boundary = `boundary_${Date.now()}`;
  const mime = [
    `From: ${fromName} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="UTF-8"`,
    ``,
    htmlBody,
  ].join('\r\n');

  // Gmail API expects base64url encoding
  return Buffer.from(mime).toString('base64url');
}
```

---

### 6. UI Changes: LeadGenDashboard.jsx

#### 6a. Add icons import

Add to the existing lucide-react import:

```js
import { ..., Package, Send } from 'lucide-react';
```

#### 6b. Modify the action column in prospect rows

Replace the current action column (lines ~696–717) with:

```jsx
<span className="leadgen-col leadgen-col-action">
  {/* Original website link */}
  {p.website ? (
    <a href={normalizeUrl(p.website)} target="_blank" rel="noopener noreferrer"
       onClick={(e) => e.stopPropagation()}
       className="leadgen-row-action-link"
       aria-label={`Open ${p.name} website`}>
      <ArrowUpRight size={14} strokeWidth={2} />
    </a>
  ) : (
    <ArrowUpRight size={14} strokeWidth={2} style={{ opacity: 0.3 }} />
  )}

  {/* PACKAGE button — visible when stage is 'ready' */}
  {p.stage === 'ready' && p.generation?.previewUrl ? (
    <button
      className="leadgen-row-action-btn leadgen-row-action-btn--package"
      onClick={(e) => { e.stopPropagation(); handlePackage(p.placeId); }}
      aria-label={`Package outreach for ${p.name}`}
      title="Package outreach email"
    >
      <Package size={13} strokeWidth={2} />
    </button>
  ) : null}

  {/* SEND button — visible when stage is 'packaged' */}
  {p.stage === 'packaged' && p.outreach?.emailHtml ? (
    <button
      className="leadgen-row-action-btn leadgen-row-action-btn--send"
      onClick={(e) => { e.stopPropagation(); handleSendPreview(p); }}
      aria-label={`Send package to ${p.name}`}
      title="Preview & send to owner"
    >
      <Send size={13} strokeWidth={2} />
    </button>
  ) : null}

  <ChevronDown size={13} strokeWidth={2} className="leadgen-row-chev" />
</span>
```

#### 6c. Widen the action column

Update the CSS grid template from:

```css
grid-template-columns: 2fr 1fr 0.7fr 0.7fr 1fr 1.4fr 0.4fr;
```

to:

```css
grid-template-columns: 2fr 1fr 0.7fr 0.7fr 1fr 1.2fr 0.8fr;
```

(Shrink location slightly, give action more room for the new buttons.)

#### 6d. Add handler functions

```js
// PACKAGE — opens the streaming module panel
function handlePackage(placeId) {
  setModulePanel({
    placeId,
    moduleId: 'outreach-package',
    moduleLabel: 'Package Outreach',
    endpoint: '/api/leadgen/package',
  });
}

// SEND — opens the preview/send modal
const [sendModal, setSendModal] = useState(null);

function handleSendPreview(prospect) {
  setSendModal(prospect);
}
```

#### 6e. Action button styles

```css
.leadgen-row-action-btn {
  background: transparent;
  border: 1px solid rgba(0,0,0,0.10);
  width: 26px; height: 26px;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #777;
  transition: all 160ms ease;
}

.leadgen-row-action-btn--package:hover {
  background: rgba(37, 99, 235, 0.08);
  border-color: rgba(37, 99, 235, 0.3);
  color: #2563eb;
}

.leadgen-row-action-btn--send:hover {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}
```

---

### 7. Send Preview Modal Component

**New file:** `components/dashboard/leadgen/SendPreviewModal.jsx`

A modal that shows the operator what the email will look like before sending.

**Layout:**

```
┌─────────────────────────────────────────────┐
│  Preview: Outreach to {Business Name}    [X]│
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │   Email preview (iframe)            │    │
│  │   - Renders outreach.emailHtml      │    │
│  │   - Read-only visual preview        │    │
│  │                                     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─ Editable Note ─────────────────────┐    │
│  │ "Hi Dr. Martinez, I noticed..."     │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Sending to: [email input, pre-filled]      │
│                                             │
│  [Cancel]              [Send to Owner →]    │
└─────────────────────────────────────────────┘
```

**Props:**

```js
{ open, prospect, onClose, getIdToken }
```

**Behavior:**
- Pre-fills recipient with `prospect.email`
- Allows editing the note (textarea, pre-filled with `prospect.outreach.note`)
- "Send to Owner" button:
  1. Shows confirmation state ("Sending…")
  2. POSTs to `/api/leadgen/send` with `{ placeId, recipientEmail, editedNote }`
  3. On success: closes modal, Firestore `onSnapshot` auto-updates the row
  4. On error: shows inline error message

**Styling:** Match the existing modal style from `CampaignBuilderModal.jsx`:
- Same backdrop blur, border-radius: 18px shell, font stack
- Same field/button component classes (`.leadgen-field`, `.leadgen-btn`, etc.)

---

### 8. Module Panel Integration

The `LeadgenModulePanel.jsx` already handles arbitrary streaming endpoints. The PACKAGE button uses it via `setModulePanel` — no changes needed to the panel itself. Just make sure the `/api/leadgen/package` endpoint emits NDJSON in the same shape:

```js
{ type: 'progress', stage: 'load',      label: 'Loading prospect data…' }
{ type: 'progress', stage: 'thumbnail', label: 'Capturing site thumbnail…' }
{ type: 'progress', stage: 'theme',     label: 'Extracting site theme…' }
{ type: 'progress', stage: 'compose',   label: 'Writing personal note…' }
{ type: 'progress', stage: 'render',    label: 'Building postcard email…' }
{ type: 'progress', stage: 'persist',   label: 'Saving package…' }
{ type: 'done', status: 'succeeded', result: { thumbnailUrl, note, emailSubject } }
```

The panel will display these as terminal lines + progress indicators.

---

## File Manifest

| Action | Path | Purpose |
|--------|------|---------|
| CREATE | `app/api/leadgen/package/route.js` | Package generation endpoint (NDJSON stream) |
| CREATE | `app/api/leadgen/send/route.js` | Gmail send endpoint (JSON) |
| CREATE | `features/leadgen/gmail-client.js` | Gmail OAuth2 helper + MIME builder |
| CREATE | `features/leadgen/email-template.js` | HTML email renderer (now HITLOOP brief style — see as-built note up top) |
| CREATE | `app/api/leadgen/email-preview/route.js` | Dev-only visual harness for the email (added 2026-06-25) |
| CREATE | `public/img/leadgen-email-bg.jpg` | Page-background gradient image, 7KB (added 2026-06-25) |
| CREATE | `components/dashboard/leadgen/SendPreviewModal.jsx` | Email preview + send modal |
| MODIFY | `features/leadgen/constants.js` | Add 'packaged' stage |
| MODIFY | `components/dashboard/LeadGenDashboard.jsx` | Add PACKAGE/SEND buttons, handlers, modal |
| MODIFY | `.env.local` | Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN |

---

## Email Template Spec: `features/leadgen/email-template.js`

Export a single function:

```js
export function renderOutreachEmail({ businessName, note, thumbnailUrl, previewUrl, originalSiteUrl, readinessBefore, readinessAfter, theme, calendlyUrl })
```

Returns a complete HTML string. Key requirements:

- **Table-based layout** (email client compatibility)
- **All CSS inline** via `style=""` attributes
- **Max-width 600px**, centered with `margin: 0 auto`
- **Mobile responsive** via `@media` in a `<style>` tag (Gmail supports this)
- **Image handling:** `<img>` tags with explicit `width`, `height`, `display: block`, `border: 0`
- **CTA button:** Bulletproof button pattern (VML for Outlook):

```html
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="14%" strokecolor="{accentColor}" fillcolor="{accentColor}">
<w:anchorlock/>
<center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Book a 15-min Call</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-->
<a href="{calendlyUrl}" style="background-color:{accentColor};border-radius:6px;color:#ffffff;display:inline-block;font-size:15px;font-weight:bold;padding:12px 32px;text-decoration:none;">
  Book a 15-min Call
</a>
<!--<![endif]-->
```

- **Footer:** Muted text, includes physical address for CAN-SPAM compliance (use: "DeKalb, IL")
- **Unsubscribe:** Not strictly required for one-to-one emails sent via personal Gmail, but good practice — include a "Not interested? Just reply and let me know." line

---

## Implementation Order

1. `features/leadgen/constants.js` — add 'packaged' stage
2. `features/leadgen/gmail-client.js` — Gmail OAuth2 + MIME helper
3. `features/leadgen/email-template.js` — postcard HTML renderer
4. `app/api/leadgen/package/route.js` — package endpoint
5. `app/api/leadgen/send/route.js` — send endpoint
6. `components/dashboard/leadgen/SendPreviewModal.jsx` — preview modal
7. `components/dashboard/LeadGenDashboard.jsx` — buttons + handlers + modal integration
8. Test end-to-end with a real prospect in 'ready' stage

---

## Environment Setup Checklist

- [ ] `npm install googleapis` (for Gmail API)
- [ ] Create or reuse Google Cloud OAuth2 credentials with `gmail.send` scope
- [ ] Generate refresh token and add to `.env.local`
- [ ] Set Calendly URL (confirm `https://calendly.com/bryanballi` or update)
- [ ] Firebase Storage is NOT yet set up in this project. For the thumbnail, use one of these alternatives:
  - **Simplest:** Skip screenshot capture entirely. Use the existing `generation.mockupUrl` (already stored from the mockup generation step) as the thumbnail image. This avoids adding a new storage dependency.
  - **If screenshot is needed:** Use a third-party screenshot API (screenshotone.com, urlbox.io) and store the returned URL directly in `outreach.thumbnailUrl` — no Firebase Storage needed.
  - **Full setup (optional):** Add `@google-cloud/storage` or `firebase/storage`, configure a Storage bucket, and upload screenshots there.

## Key Codebase Patterns to Follow

- **Auth pattern:** Use `const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs')` (CommonJS require via `createRequire`)
- **Anthropic client:** `const { callAnthropic } = require('../../../../features/scout-intake/_anthropic-client.js')` — signature is `callAnthropic(params, { apiKey })` where params is the raw Messages API body
- **Firebase admin:** `const fb = require('../../../../api/_lib/firebase-admin.cjs')` — access Firestore via `fb.adminDb`
- **Streaming pattern:** All streaming endpoints return `new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })` — emit objects with `JSON.stringify(obj) + '\n'`
- **Module panel:** Set `modulePanel` state with `{ placeId, moduleId, moduleLabel, endpoint }` — the panel defaults to `/api/leadgen/module` if no endpoint given

---

## Testing Notes

- **Package endpoint:** Test with a prospect that has `stage: 'ready'` and `generation.previewUrl` set. Verify NDJSON stream events appear in the module panel.
- **Email rendering:** Open `outreach.emailHtml` in a browser tab to visual-check the postcard. Test in Litmus or Email on Acid for cross-client rendering.
- **Gmail send:** Test with your own email first (`bryanballi@gmail.com` → `bryanballi@gmail.com`). Check spam score. Verify the thumbnail renders inline.
- **Stage progression:** Confirm Firestore `onSnapshot` updates the dashboard row when stage changes from `ready → packaged → contacted`.
