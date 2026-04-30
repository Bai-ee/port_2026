// newsletter-renderer.js — HTML email renderer for the Newsletter module
//
// Takes Newsletter Scribe output and produces a self-contained HTML email
// with inline CSS (email clients strip <style> blocks and ignore external CSS).
//
// Design principles:
//   - Table-based layout for email client compatibility (Outlook, Gmail, Apple Mail)
//   - Inline styles on every element — no classes, no <style> block reliance
//   - Max width 600px (email standard)
//   - System fonts with web-safe fallbacks
//   - Dark-on-light for readability
//   - Clean, editorial feel — not a marketing blast
//
// The rendered HTML is saved to data/newsletter/{clientId}/latest-newsletter.html
// and served via /api/dashboard/newsletter-preview for the dashboard card iframe.

const { getNewsletterSchema } = require('./newsletter-schema.cjs');

// ── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert newlines and basic markdown-style bold (**text**) to HTML.
 * Keeps it simple — this is email HTML, not a full markdown parser.
 */
function formatContent(text) {
  if (!text) return '';
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p style="margin:0 0 16px 0;line-height:1.6;">')
    .replace(/\n- /g, '<br>&#8226; ')
    .replace(/\n/g, '<br>');
}

/**
 * Format a date for the newsletter header.
 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ── Color palette (inline, email-safe) ──────────────────────────────────────

const COLORS = {
  bg: '#f8f7f4',
  cardBg: '#ffffff',
  ink: '#1a1a1a',
  inkSoft: '#5a5a5a',
  inkMuted: '#8a8a8a',
  accent: '#2563eb',
  accentLight: '#eff6ff',
  border: '#e5e5e5',
  divider: '#eeeeee',
  heroAccent: '#1e40af',
  ctaBg: '#f0fdf4',
  ctaBorder: '#bbf7d0',
  ctaAccent: '#166534',
  metricsBg: '#fafaf9',
};

// ── Section renderers ───────────────────────────────────────────────────────

function renderHeader(clientName, date, alertLevel) {
  const alertBadge = alertLevel === 'CRITICAL'
    ? `<span style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:11px;font-weight:700;letter-spacing:0.05em;padding:3px 10px;border-radius:3px;margin-left:12px;">CRITICAL</span>`
    : alertLevel === 'IMPORTANT'
      ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;letter-spacing:0.05em;padding:3px 10px;border-radius:3px;margin-left:12px;">IMPORTANT</span>`
      : '';

  return `
    <tr>
      <td style="padding:40px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:${COLORS.inkMuted};padding-bottom:16px;">
              ${esc(clientName)} &middot; Intelligence Brief${alertBadge}
            </td>
          </tr>
          <tr>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:${COLORS.ink};line-height:1.2;padding-bottom:8px;">
              Your Weekly Brief
            </td>
          </tr>
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:${COLORS.inkMuted};padding-bottom:24px;">
              ${formatDate(date)}
            </td>
          </tr>
          <tr>
            <td style="border-bottom:2px solid ${COLORS.ink};padding:0;line-height:0;font-size:0;">&nbsp;</td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderHeroStory(content) {
  if (!content) return '';
  return `
    <tr>
      <td style="padding:32px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;padding-bottom:12px;">
              Lead Story
            </td>
          </tr>
          <tr>
            <td style="font-family:Georgia,'Times New Roman',serif;font-size:17px;color:${COLORS.ink};line-height:1.65;">
              <p style="margin:0 0 16px 0;line-height:1.65;">${formatContent(content)}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderQuickHits(content) {
  if (!content) return '';
  return `
    <tr>
      <td style="padding:28px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:1px solid ${COLORS.divider};padding-top:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;padding-bottom:14px;">
                    Quick Hits
                  </td>
                </tr>
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:${COLORS.ink};line-height:1.7;">
                    <p style="margin:0 0 12px 0;line-height:1.7;">${formatContent(content)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderMetrics(content) {
  if (!content) return '';
  return `
    <tr>
      <td style="padding:28px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:1px solid ${COLORS.divider};padding-top:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.metricsBg};border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;padding-bottom:12px;">
                          Metrics Snapshot
                        </td>
                      </tr>
                      <tr>
                        <td style="font-family:'Courier New',Courier,monospace;font-size:13px;color:${COLORS.ink};line-height:1.8;">
                          ${formatContent(content)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderUpcoming(content) {
  if (!content) return '';
  return `
    <tr>
      <td style="padding:28px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:1px solid ${COLORS.divider};padding-top:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;padding-bottom:14px;">
                    On the Radar
                  </td>
                </tr>
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:${COLORS.ink};line-height:1.7;">
                    <p style="margin:0 0 12px 0;line-height:1.7;">${formatContent(content)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderCta(content) {
  if (!content) return '';
  return `
    <tr>
      <td style="padding:28px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:1px solid ${COLORS.divider};padding-top:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.ctaBg};border:1px solid ${COLORS.ctaBorder};border-radius:8px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.ctaAccent};font-weight:700;padding-bottom:10px;">
                          This Week's Move
                        </td>
                      </tr>
                      <tr>
                        <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;color:${COLORS.ctaAccent};line-height:1.6;font-weight:500;">
                          ${formatContent(content)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderFooter(clientName) {
  return `
    <tr>
      <td style="padding:32px 40px 40px 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:2px solid ${COLORS.ink};padding-top:20px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:${COLORS.inkMuted};line-height:1.5;">
                    Generated by Scout &middot; ${esc(clientName)}<br>
                    This newsletter was produced from automated intelligence gathering. All claims are sourced from Scout data.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ── Section router (maps schema keys to renderers) ──────────────────────────

const SECTION_RENDERERS = {
  hero_story: renderHeroStory,
  quick_hits: renderQuickHits,
  metrics_snapshot: renderMetrics,
  upcoming: renderUpcoming,
  cta: renderCta,
};

/**
 * Fallback renderer for custom sections not in the default schema.
 * Uses a generic block layout with the section's display label.
 */
function renderGenericSection(content, displayLabel) {
  if (!content) return '';
  return `
    <tr>
      <td style="padding:28px 40px 0 40px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-top:1px solid ${COLORS.divider};padding-top:28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.accent};font-weight:700;padding-bottom:14px;">
                    ${esc(displayLabel)}
                  </td>
                </tr>
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:${COLORS.ink};line-height:1.7;">
                    <p style="margin:0 0 12px 0;line-height:1.7;">${formatContent(content)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

// ── Main render function ────────────────────────────────────────────────────

/**
 * Render a complete newsletter email from Scribe output.
 *
 * @param {object} options
 * @param {object}      options.content     - Parsed Scribe content keyed by section key
 * @param {string}      options.clientName  - Display name of the client
 * @param {string}      options.alertLevel  - CRITICAL | IMPORTANT | QUIET
 * @param {Date|string} options.date        - Newsletter date
 * @param {object}      [options.config]    - Client config (for schema resolution)
 * @returns {string} Complete HTML email document
 */
function renderNewsletterHtml({ content, clientName, alertLevel, date, config = {} }) {
  const schema = getNewsletterSchema(config);

  // Render each section in schema order
  const sectionHtml = schema
    .map((section) => {
      const sectionContent = content?.[section.key];
      const renderer = SECTION_RENDERERS[section.key];
      if (renderer) return renderer(sectionContent);
      return renderGenericSection(sectionContent, section.displayLabel || section.key);
    })
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${esc(clientName)} — Intelligence Brief</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    /* Reset for email clients */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.bg};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper for background color -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.bg};">
    <tr>
      <td align="center" style="padding:24px 16px;">

        <!-- Inner card (600px max, white background) -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${COLORS.cardBg};border-radius:12px;border:1px solid ${COLORS.border};box-shadow:0 1px 3px rgba(0,0,0,0.04);">

          ${renderHeader(clientName, date, alertLevel)}
          ${sectionHtml}
          ${renderFooter(clientName)}

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Render a generic newsletter template with sample placeholder content.
 * Used for the dashboard preview tab before any real newsletter has been generated.
 *
 * @param {object} options
 * @param {string} options.clientName - Display name of the client
 * @returns {string} Complete HTML email document with sample content
 */
function renderGenericTemplate({ clientName = 'Your Brand' } = {}) {
  return renderNewsletterHtml({
    clientName,
    alertLevel: 'QUIET',
    date: new Date(),
    config: {},
    content: {
      hero_story: 'This is where your lead story will appear — the most important finding from your latest Scout intelligence cycle, turned into a narrative your subscribers will actually want to read.\n\nEvery claim in this section is grounded in real data from your Scout pipeline. No speculation, no filler — just the signal that matters most right now.',
      quick_hits: '**Competitor launched a new feature** — Early traction on social, worth monitoring for positioning implications.\n\n**Community mention on Reddit** — Organic thread in your target subreddit with positive sentiment and 40+ upvotes.\n\n**Review trend shift** — Three new reviews this week skewing positive on a feature you recently updated.\n\n**Category search volume up 12%** — Seasonal uptick aligns with your content calendar window.',
      metrics_snapshot: 'Brand Mentions: 7 this cycle (top sentiment: positive)\nReview Sentiment: 4.2 avg across platforms\nCompetitor Signals: 3 detected\nCommunity Engagement: Steady, 2 new threads',
      upcoming: 'Product launch window opens in 8 days — content pipeline should be loaded by end of week.\n\nIndustry awareness date on the 15th — opportunity for thought leadership post if angle is ready.',
      cta: 'This week, publish one piece of content that positions you ahead of the competitor feature launch. Use the community thread as social proof — quote it, don\'t link it. The review momentum gives you permission to lead with confidence rather than aspiration.',
    },
  });
}

module.exports = { renderNewsletterHtml, renderGenericTemplate };
