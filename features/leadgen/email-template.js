const CALENDLY_URL = 'https://calendly.com/bryanballi';

export function renderOutreachEmail({
  businessName,
  note,
  thumbnailUrl,
  previewUrl,
  originalSiteUrl,
  readinessBefore,
  readinessAfter,
  theme = {},
  calendlyUrl = CALENDLY_URL,
}) {
  const primary = theme.primaryColor || '#1a1a1a';
  const accent  = theme.accentColor  || '#2563eb';
  const font    = theme.fontFamily   || 'Inter';
  const fontStack = `'${font}', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;

  const scoreBar = (readinessBefore != null && readinessAfter != null)
    ? `<tr><td align="center" style="padding: 16px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="display:inline-table;">
          <tr>
            <td style="background:#f1f5f9;border-radius:20px;padding:8px 20px;font-family:${fontStack};font-size:13px;color:#64748b;white-space:nowrap;">
              AI Readiness&nbsp;
              <span style="color:#ef4444;font-weight:700;">${readinessBefore}</span>
              &nbsp;→&nbsp;
              <span style="color:#10b981;font-weight:700;">${readinessAfter}</span>
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  const beforeAfter = (originalSiteUrl || previewUrl)
    ? `<tr><td style="padding: 24px 32px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            ${originalSiteUrl ? `<td width="48%" valign="top" style="padding-right:8px;">
              <div style="font-family:${fontStack};font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Your current site</div>
              <a href="${originalSiteUrl}" style="display:block;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;text-decoration:none;">
                <img src="https://api.screenshotone.com/take?url=${encodeURIComponent(originalSiteUrl)}&viewport_width=600&viewport_height=400&format=jpg&quality=70" width="100%" style="display:block;border:0;" alt="Current site" />
              </a>
            </td>` : ''}
            <td width="${originalSiteUrl ? '48%' : '100%'}" valign="top" ${originalSiteUrl ? 'style="padding-left:8px;"' : ''}>
              <div style="font-family:${fontStack};font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Your new preview</div>
              <a href="${previewUrl}" style="display:block;border:2px solid ${accent};border-radius:8px;overflow:hidden;text-decoration:none;">
                <img src="${thumbnailUrl}" width="100%" style="display:block;border:0;" alt="New preview" />
              </a>
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<title>A preview built for ${businessName}</title>
<style>
  @media only screen and (max-width: 600px) {
    .email-card { border-radius: 0 !important; }
    .email-body { padding: 20px 16px !important; }
    .before-after-cell { display: block !important; width: 100% !important; padding: 0 0 16px 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f8fafc;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="email-card"
             style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;max-width:600px;width:100%;">

        <!-- Header strip -->
        <tr>
          <td bgcolor="${primary}" style="background:${primary};padding:20px 32px;">
            <p style="margin:0;font-family:${fontStack};font-size:13px;color:rgba(255,255,255,0.7);letter-spacing:0.04em;text-transform:uppercase;">Built for you</p>
            <h1 style="margin:4px 0 0;font-family:${fontStack};font-size:22px;font-weight:700;color:#ffffff;line-height:1.3;">A preview site for ${businessName}</h1>
          </td>
        </tr>

        <!-- Thumbnail hero -->
        <tr>
          <td style="padding:0;">
            <a href="${previewUrl}" style="display:block;text-decoration:none;">
              <img src="${thumbnailUrl}" width="600" style="display:block;width:100%;border:0;max-width:600px;" alt="Preview of your new website" />
            </a>
          </td>
        </tr>

        <!-- Note -->
        <tr>
          <td class="email-body" style="padding:28px 32px 8px;">
            <p style="margin:0;font-family:${fontStack};font-size:16px;line-height:1.7;color:#1e293b;">${note.replace(/\n/g, '<br />')}</p>
          </td>
        </tr>

        <!-- Before / after + score -->
        ${beforeAfter}
        ${scoreBar}

        <!-- CTA -->
        <tr>
          <td align="center" style="padding:32px 32px 28px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="13%" strokecolor="${accent}" fillcolor="${accent}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:sans-serif;font-size:15px;font-weight:bold;">Book a 15-min Call</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <a href="${calendlyUrl}" style="background-color:${accent};border-radius:8px;color:#ffffff;display:inline-block;font-family:${fontStack};font-size:15px;font-weight:700;padding:13px 36px;text-decoration:none;-webkit-text-size-adjust:none;">Book a 15-min Call →</a>
            <!--<![endif]-->
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 32px;"><div style="border-top:1px solid #f1f5f9;"></div></td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px 28px;">
            <p style="margin:0 0 4px;font-family:${fontStack};font-size:13px;color:#94a3b8;line-height:1.6;">
              Built by <strong style="color:#64748b;">Bryan Balli</strong> · <a href="https://bryanballi.com" style="color:${accent};text-decoration:none;">bryanballi.com</a> · Reply to this email anytime.
            </p>
            <p style="margin:0;font-family:${fontStack};font-size:12px;color:#cbd5e1;">
              Not interested? Just reply and let me know. · DeKalb, IL
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
