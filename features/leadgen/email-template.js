const CALENDLY_URL = 'https://calendly.com/bryanballi';

// ── HITLOOP BRIEF KIT — email-safe ──────────────────────────────────────────
// Matches the Email Digest renderer (app/api/admin/daily-digest/route.js), which
// is the proven, deliverability-tested port of the BRIEF tab in
// public/docs/dashboard-modal-component-style-guide.html (.brief-kit scope).
// Warm-cream surfaces, Doto display numerals, Space Mono micro-labels, Space
// Grotesk body. Web fonts load via @import where supported (Apple Mail); Gmail
// strips them and falls back to the mono/sans stacks, preserving the character.
const T = {
  bg:    '#fbf8f0',
  card:  '#fffdf7',
  ink:   '#12100c',
  soft:  '#5a5346',
  light: '#8a8070',
  line:  '#e7ddc8',
  dash:  'rgba(18,16,12,0.10)',
  accent:'#b8542e',
  fDisp: "'Doto','Space Mono','Courier New',monospace",
  fBody: "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  fMono: "'Space Mono','Courier New',monospace",
};

// Page background — warm cream → cool mint → light blue. Bulletproof background:
//   • Gmail / most webmail read the hosted JPG via the <td background> attribute
//     + inline background-image:url() (Gmail does NOT render CSS gradients, but
//     DOES render background images on table cells).
//   • Apple Mail / iOS layer the JPG over the CSS gradient (identical look; the
//     gradient also covers the moment before the image loads).
//   • Outlook (Windows) uses the VML <v:background> block injected after <body>.
//   • Any client that drops all of the above falls back to the PAGE_BG solid.
// The JPG must be at a public URL — lights up in Gmail once deployed (Gmail can't
// fetch localhost). Local preview / Apple Mail show the CSS-gradient fallback.
const PAGE_BG = '#f2f7f7'; // flat fallback (mid stop)
const PAGE_GRAD = `linear-gradient(145deg, #f8eee7 0%, #f2f7f7 49%, #e7edf1 100%), ${PAGE_BG}`;
const BG_IMG = 'https://hitloop.agency/img/leadgen-email-bg.jpg';
const PAGE_BG_IMAGE = `url('${BG_IMG}'), ${PAGE_GRAD}`;
// Circle logo (already deployed at hitloop.agency). TODO: ship an optimized
// ~80px copy — the source is 554KB, heavier than a 26px mark needs.
const LOGO_IMG = 'https://hitloop.agency/img/circle_logo.png';

function mini(text) {
  return `<div style="font-family:${T.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${T.light};margin:0 0 9px;">${text}</div>`;
}
// Section: top hairline + Doto display title + body.
function section(title, body) {
  return `<div style="border-top:1px solid ${T.line};padding-top:30px;margin-top:30px;">
    <div class="sec-title" style="font-family:${T.fDisp};font-weight:900;font-size:30px;line-height:.95;letter-spacing:-.005em;text-transform:uppercase;color:${T.ink};margin:0 0 18px;">${title}</div>
    ${body}
  </div>`;
}

/**
 * Render the lead-gen outreach brief — a cold-prospect pitch showing a
 * speculatively-built preview site, in the HITLOOP BRIEF kit (warm-cream)
 * aesthetic, matching the Email Digest renderer.
 *
 * @param theme  Per-prospect colors from their generated site. Unused for the
 *               shell (fixed HITLOOP brand by design); kept for caller compat
 *               (app/api/leadgen/package/route.js passes it).
 */
export function renderOutreachEmail({
  businessName,
  note,
  thumbnailUrl,
  previewUrl,
  originalSiteUrl,
  readinessBefore,
  readinessAfter,
  theme = {}, // eslint-disable-line no-unused-vars -- reserved; shell is fixed brand
  calendlyUrl = CALENDLY_URL,
}) {
  const noteHtml = String(note || '').replace(/\n{2,}/g, '<br /><br />').replace(/\n/g, '<br />');

  // ── Note — brief pull quote (.pull: heavy left rule, light weight) ───────────
  const noteSection = section('Why I built this',
    `<p style="font-family:${T.fBody};font-weight:300;font-size:18px;line-height:1.4;border-left:3px solid ${T.ink};padding:2px 0 2px 16px;margin:0;color:${T.ink};">${noteHtml}</p>`);

  // ── Before / after — two preview cards (.kit-paper) ──────────────────────────
  const beforeAfter = (originalSiteUrl || previewUrl) ? section('Before / after',
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
      ${originalSiteUrl ? `<td class="ba-cell" width="50%" valign="top" style="padding-right:7px;">
        ${mini('Current site')}
        <a href="${originalSiteUrl}" style="display:block;border:1px solid ${T.line};border-radius:12px;overflow:hidden;text-decoration:none;background:${T.card};">
          <img src="https://api.screenshotone.com/take?url=${encodeURIComponent(originalSiteUrl)}&viewport_width=600&viewport_height=400&format=jpg&quality=70" width="100%" style="display:block;border:0;" alt="Your current website" />
        </a></td>` : ''}
      <td class="ba-cell" width="${originalSiteUrl ? '50%' : '100%'}" valign="top" ${originalSiteUrl ? 'style="padding-left:7px;"' : ''}>
        ${mini('New preview &middot; HITLOOP')}
        <a href="${previewUrl}" style="display:block;border:1px solid ${T.accent};border-radius:12px;overflow:hidden;text-decoration:none;background:${T.card};">
          <img src="${thumbnailUrl}" width="100%" style="display:block;border:0;" alt="Your new preview site" />
        </a></td>
    </tr></table>`) : '';

  // ── AI readiness — Doto stat cells (dStatCells idiom) ────────────────────────
  const readiness = (readinessBefore != null && readinessAfter != null) ? section('AI readiness',
    `<div style="font-size:0;line-height:0;">
      <div style="display:inline-block;vertical-align:top;width:48%;min-width:140px;margin:0 2% 0 0;background:${T.card};border:1px solid ${T.line};border-radius:14px;padding:18px 16px;box-sizing:border-box;">
        <div style="font-family:${T.fDisp};font-weight:900;font-size:44px;line-height:1;letter-spacing:-.02em;color:${T.accent};">${readinessBefore}</div>
        <div style="margin-top:9px;font-family:${T.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${T.light};">Current site</div>
      </div>
      <div style="display:inline-block;vertical-align:top;width:48%;min-width:140px;background:${T.card};border:1px solid ${T.line};border-radius:14px;padding:18px 16px;box-sizing:border-box;">
        <div style="font-family:${T.fDisp};font-weight:900;font-size:44px;line-height:1;letter-spacing:-.02em;color:${T.ink};">${readinessAfter}</div>
        <div style="margin-top:9px;font-family:${T.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${T.light};">With HITLOOP</div>
      </div>
    </div>
    <div style="margin-top:12px;font-family:${T.fMono};font-size:11px;letter-spacing:.04em;color:${T.soft};">Readiness lift <strong style="color:${T.ink};">+${readinessAfter - readinessBefore}</strong> points after the rebuild.</div>`) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>A preview built for ${businessName}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
body{margin:0;padding:0;background:${PAGE_BG};}
a{text-decoration:none;}
@media only screen and (max-width:600px){
  .container{padding:28px 18px !important;}
  .hero-title{font-size:46px !important;}
  .sec-title{font-size:26px !important;}
  .ba-cell{display:block !important;width:100% !important;padding:0 0 14px 0 !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};background-image:${PAGE_BG_IMAGE};-webkit-font-smoothing:antialiased;">
  <!--[if gte mso 9]>
  <v:background xmlns:v="urn:schemas-microsoft-com:vml" fill="t">
    <v:fill type="frame" src="${BG_IMG}" color="${PAGE_BG}" />
  </v:background>
  <![endif]-->
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" bgcolor="${PAGE_BG}" background="${BG_IMG}" style="background-color:${PAGE_BG};background-image:${PAGE_BG_IMAGE};background-size:cover;background-position:top center;background-repeat:no-repeat;">
    <tr><td align="center" background="${BG_IMG}" style="padding:0;background-color:${PAGE_BG};background-image:${PAGE_BG_IMAGE};background-size:cover;background-position:top center;background-repeat:no-repeat;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;">
        <tr><td class="container" style="padding:40px 32px;">

          <!-- Provenance header — logo + origin -->
          <div style="padding-bottom:16px;margin-bottom:26px;border-bottom:1px solid ${T.line};">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>
              <td valign="middle">
                <img src="${LOGO_IMG}" width="26" height="26" style="display:inline-block;vertical-align:middle;border-radius:50%;border:0;" alt="HITLOOP" />
                <span style="font-family:${T.fMono};font-size:13px;font-weight:700;letter-spacing:.18em;color:${T.ink};vertical-align:middle;margin-left:9px;">HITLOOP</span>
              </td>
              <td align="right" valign="middle">
                <span style="font-family:${T.fMono};font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${T.light};">hitloop.agency</span>
              </td>
            </tr></table>
          </div>

          <!-- Hero -->
          <div style="padding-bottom:8px;">
            <div class="hero-title" style="font-family:${T.fDisp};font-weight:900;font-size:56px;line-height:.84;letter-spacing:-.03em;text-transform:uppercase;color:${T.ink};margin:0 0 4px;">A preview<br>for ${businessName}</div>
          </div>

          <!-- Hero preview image -->
          <div style="margin-top:22px;">
            <a href="${previewUrl}" style="display:block;border:1px solid ${T.line};border-radius:16px;overflow:hidden;">
              <img src="${thumbnailUrl}" width="576" style="display:block;width:100%;border:0;" alt="Preview of your new website" />
            </a>
          </div>

          <!-- Sections -->
          ${noteSection}
          ${beforeAfter}
          ${readiness}

          <!-- CTA -->
          <div style="border-top:1px solid ${T.line};padding-top:30px;margin-top:30px;text-align:center;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="14%" strokecolor="${T.accent}" fillcolor="${T.accent}">
            <w:anchorlock/><center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Book a 15-min call</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${calendlyUrl}" style="background:${T.accent};border-radius:8px;color:#ffffff;display:inline-block;font-family:${T.fBody};font-size:15px;font-weight:700;letter-spacing:.01em;padding:15px 40px;text-decoration:none;-webkit-text-size-adjust:none;">Book a 15-min call &rarr;</a>
            <!--<![endif]-->
            <div style="margin-top:14px;font-family:${T.fMono};font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:${T.light};">Or just reply to this email</div>
          </div>

          <!-- Footer -->
          <div style="border-top:1.5px solid ${T.line};padding-top:22px;margin-top:32px;">
            <div style="font-family:${T.fMono};font-size:10px;letter-spacing:.08em;color:${T.soft};margin-bottom:8px;"><strong style="color:${T.ink};letter-spacing:.12em;">HITLOOP</strong> &middot; Bryan Balli &middot; DeKalb, IL</div>
            <div style="font-family:${T.fMono};font-size:10px;letter-spacing:.06em;">
              <a href="https://hitloop.agency" style="color:${T.accent};">hitloop.agency</a> &nbsp;&middot;&nbsp;
              <a href="${calendlyUrl}" style="color:${T.accent};">Book a call</a> &nbsp;&middot;&nbsp;
              <span style="color:${T.light};">Not interested? Reply and let me know.</span>
            </div>
          </div>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
