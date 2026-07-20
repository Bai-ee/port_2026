// Creative Brief + Estimate draft helpers — Suggested Post extraction,
// line-item/add-on parsing, custom-brief starter HTML, and PDF/download
// filename helpers. Extracted from DashboardPage.jsx module scope
// (Phase 2 decomposition) — move-only, no behavior change.

// Extract the "Suggested Post" caption the Creative Brief flow scribes into the
// onboarding summary (a single labeled string). Returns '' when absent.
export const CB_SUMMARY_LABELS = ['Headline', 'What This Site Is', "What's Missing", 'Biggest Risk', 'The Opportunity', 'Decision', 'Suggested Post'];
export function parseBriefSuggestedPost(raw) {
  if (!raw) return '';
  let collecting = false;
  const out = [];
  for (const ln of String(raw).split('\n')) {
    const t = ln.trim();
    if (!t) continue;
    const isLabel = CB_SUMMARY_LABELS.find((L) => t.toLowerCase().startsWith(`${L.toLowerCase()}:`));
    if (isLabel) {
      if (collecting) break; // next section reached
      if (isLabel === 'Suggested Post') {
        collecting = true;
        const after = t.slice(t.indexOf(':') + 1).trim();
        if (after) out.push(after);
      }
      continue;
    }
    if (collecting) out.push(t);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
export function sanitizeBriefHtmlForStandalone(rawHtml) {
  const html = String(rawHtml || '');
  if (!html || typeof window === 'undefined' || typeof window.DOMParser !== 'function') return html;
  try {
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script').forEach((node) => node.remove());
    doc.querySelectorAll('*').forEach((node) => {
      for (const attr of Array.from(node.attributes || [])) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      }
    });
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  }
}
export function formatEstimateMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : '0';
}
export function formatEstimateLineItems(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows
    .map((item) => [
      item?.label || '',
      item?.description || '',
      formatEstimateMoney(item?.unitPrice ?? item?.price),
      formatEstimateMoney(item?.quantity || 1),
    ].join(' | '))
    .join('\n');
}
export function parseEstimateLineItems(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line, index) => {
      const [label, description, unitPrice, quantity] = line.split('|').map((part) => part.trim());
      if (!label) return null;
      return {
        id: `line-${index + 1}`,
        label,
        description: description || '',
        unitPrice: Number(unitPrice || 0),
        quantity: Number(quantity || 1) || 1,
      };
    })
    .filter(Boolean);
}
export function formatEstimateAddOns(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows
    .map((item) => [
      item?.label || '',
      item?.description || '',
      formatEstimateMoney(item?.price ?? item?.unitPrice),
    ].join(' | '))
    .join('\n');
}
export function parseEstimateAddOns(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line, index) => {
      const [label, description, price] = line.split('|').map((part) => part.trim());
      if (!label) return null;
      return {
        id: `addon-${index + 1}`,
        label,
        description: description || '',
        price: Number(price || 0),
      };
    })
    .filter(Boolean);
}
export function buildDefaultEstimateBriefDraft(client) {
  const companyName = client?.companyName || client?.businessName || client?.name || 'Client';
  return {
    offerSummary: `Website redesign and launch support for ${companyName}.`,
    pricingModel: 'line_items',
    currency: 'USD',
    lineItemsText: [
      'Website redesign | Client-facing homepage redesign based on the generated preview, responsive layout, conversion structure, and launch-ready handoff. | 4500 | 1',
      'Launch QA and handoff | Final review, mobile checks, metadata review, and implementation notes for launch. | 750 | 1',
    ].join('\n'),
    timeline: '2-4 weeks after approval',
    scopeText: [
      'Homepage redesign based on the generated preview direction.',
      'Responsive implementation guidance for desktop, tablet, and mobile.',
      'Conversion-focused page structure, primary CTA treatment, and handoff notes.',
    ].join('\n'),
    exclusionsText: [
      'Third-party platform fees, paid media, and hosting subscriptions are not included unless listed as line items.',
      'New brand identity, logo design, or custom photography are separate unless explicitly included.',
    ].join('\n'),
    termsText: [
      'Estimate is valid for 14 days.',
      'Final production scope may adjust if new requirements are added after approval.',
    ].join('\n'),
    paymentScheduleText: [
      '50% due to begin work.',
      '50% due before final handoff or launch.',
    ].join('\n'),
    optionalAddOnsText: [
      'Monthly maintenance | Small content updates, uptime checks, and light technical support. | 650',
      'SEO content support | Monthly content and AI-search visibility improvements. | 1200',
    ].join('\n'),
    estimateTone: 'clear, direct, premium, client-facing',
    sendMessageInstructions: 'Write a concise email that references the preview URL and next step.',
  };
}
export function hydrateEstimateBriefDraft(config, client) {
  const fallback = buildDefaultEstimateBriefDraft(client);
  const next = config || {};
  return {
    ...fallback,
    ...next,
    lineItemsText: Array.isArray(next.lineItems) ? formatEstimateLineItems(next.lineItems) : (next.lineItemsText || fallback.lineItemsText),
    scopeText: Array.isArray(next.scope) ? next.scope.join('\n') : (next.scopeText || fallback.scopeText),
    exclusionsText: Array.isArray(next.exclusions) ? next.exclusions.join('\n') : (next.exclusionsText || fallback.exclusionsText),
    termsText: Array.isArray(next.terms) ? next.terms.join('\n') : (next.termsText || fallback.termsText),
    paymentScheduleText: Array.isArray(next.paymentSchedule) ? next.paymentSchedule.join('\n') : (next.paymentScheduleText || fallback.paymentScheduleText),
    optionalAddOnsText: Array.isArray(next.optionalAddOns) ? formatEstimateAddOns(next.optionalAddOns) : (next.optionalAddOnsText || fallback.optionalAddOnsText),
  };
}
export function buildEstimateBriefConfigPayload(draft) {
  return {
    enabled: true,
    offerSummary: draft.offerSummary || '',
    pricingModel: draft.pricingModel || 'line_items',
    currency: draft.currency || 'USD',
    lineItems: parseEstimateLineItems(draft.lineItemsText),
    timeline: draft.timeline || '',
    scope: String(draft.scopeText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    exclusions: String(draft.exclusionsText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    terms: String(draft.termsText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    paymentSchedule: String(draft.paymentScheduleText || '').split(/\n+/).map((item) => item.trim()).filter(Boolean),
    optionalAddOns: parseEstimateAddOns(draft.optionalAddOnsText),
    estimateTone: draft.estimateTone || '',
    sendMessageInstructions: draft.sendMessageInstructions || '',
  };
}
export function briefSlugify(value, fallback = 'custom-brief') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '');
  return slug || fallback;
}
export function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export function titlePdfFileName(value, fallback = 'Custom Brief') {
  const base = String(value || fallback)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  const safeBase = base || fallback;
  return `${safeBase.slice(0, 120)}.pdf`;
}
export function withDownloadParam(url) {
  const value = String(url || '');
  if (!value) return '';
  return `${value}${value.includes('?') ? '&' : '?'}download=1`;
}
export function buildCustomBriefStarterHtml(client) {
  const clientName = escapeHtmlText(client?.companyName || client?.name || client?.dashboardTitle || 'Client Name');
  const prepared = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${clientName} Custom Brief</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Doto:wght@900&family=Space+Grotesk:wght@300;400;600&family=Space+Mono&display=swap" rel="stylesheet">
  <style>
    :root { --ink:#0a0a0a; --soft:#5a5346; --line:rgba(212,196,171,.65); --card:rgba(255,255,255,.45); }
    * { box-sizing: border-box; }
    body { margin:0; color:var(--ink); font-family:'Space Grotesk',sans-serif; background:radial-gradient(700px 420px at 0% 4%, rgba(255,120,90,.22) 0%, transparent 65%),radial-gradient(620px 380px at 100% 18%, rgba(176,90,255,.18) 0%, transparent 65%),linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%); }
    .cover { min-height:100vh; padding:40px; display:flex; flex-direction:column; justify-content:space-between; }
    .top { display:flex; justify-content:space-between; gap:24px; font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.12em; text-transform:uppercase; }
    h1 { font-family:'Doto',monospace; font-size:clamp(56px,14vw,180px); line-height:.82; margin:0; text-transform:uppercase; }
    .sub { max-width:760px; font-size:clamp(20px,3vw,36px); line-height:1.1; color:var(--soft); }
    section { padding:80px 40px; }
    .card { border:1px solid var(--line); background:var(--card); border-radius:18px; padding:28px; max-width:1000px; }
    .label { font-family:'Space Mono',monospace; font-size:12px; letter-spacing:.18em; text-transform:uppercase; color:var(--soft); }
    h2 { font-size:clamp(32px,7vw,86px); line-height:.9; margin:16px 0; font-family:'Doto',monospace; text-transform:uppercase; }
  </style>
</head>
<body>
  <main>
    <div class="cover">
      <div class="top"><span>Bryan Balli</span><span>Prepared ${prepared}</span></div>
      <h1>${clientName}</h1>
      <p class="sub">Custom project brief. Replace this text with the recommendation, estimate, and next steps.</p>
    </div>
    <section>
      <div class="card">
        <div class="label">Recommendation</div>
        <h2>Project Direction</h2>
        <p>Paste the final brief content here. Keep the language clear, direct, and easy to act on.</p>
      </div>
    </section>
  </main>
</body>
</html>`;
}
