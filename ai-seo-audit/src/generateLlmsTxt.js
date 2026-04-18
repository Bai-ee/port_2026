// generateLlmsTxt.js — Generate a spec-compliant /llms.txt from an audit result.
//
// Spec: https://llmstxt.org
// Format:
//   # H1 title
//   > blockquote summary
//   ## Section
//   - [Title](url) : description
//
// Public API:
//   generateLlmsTxt(auditResult, options?) → string
//
// Does NOT modify the audit result — reads from rawSignals only.

/**
 * Generate a spec-compliant llms.txt file from an audit result.
 *
 * @param {object} auditResult - Output of runAiSeoAudit
 * @param {object} [options]
 * @param {string} [options.websiteUrl] - Override URL (defaults to rawSignals.technical.canonical)
 * @returns {string}
 */
export function generateLlmsTxt(auditResult, options = {}) {
  const raw       = auditResult?.rawSignals || {};
  const technical = raw.technical || {};
  const schema    = raw.schema    || {};
  const llmsTxt   = raw.llmsTxt  || {};

  const siteUrl = options.websiteUrl
    || technical.canonical
    || auditResult?.websiteUrl
    || '';

  const hostname = siteUrl ? (() => {
    try { return new URL(siteUrl).hostname; } catch { return siteUrl; }
  })() : 'this site';

  const lines = [];

  // ── H1 title ──────────────────────────────────────────────────────────────
  // Prefer: existing llms.txt h1 → schema org name → hostname
  const orgName = schema.orgData?.name;
  const h1 = llmsTxt.h1 || orgName || hostname;
  lines.push(`# ${h1}`);
  lines.push('');

  // ── Blockquote summary ────────────────────────────────────────────────────
  // Prefer: meta description → existing llms.txt summary → generic fallback
  const summary = technical.metaDescription
    || llmsTxt.summary
    || `This is the llms.txt file for ${hostname}.`;
  lines.push(`> ${summary}`);
  lines.push('');

  // ── ## Docs section ───────────────────────────────────────────────────────
  // Use existing llms.txt sections if found, else placeholder.
  lines.push('## Docs');
  lines.push('');

  const existingSections = llmsTxt.sections || {};
  const docLinks = Object.values(existingSections).flat().slice(0, 10);

  if (docLinks.length > 0) {
    for (const link of docLinks) {
      if (link.url && link.title) {
        const desc = link.description ? ` : ${link.description}` : '';
        lines.push(`- [${link.title}](${link.url})${desc}`);
      }
    }
  } else {
    // Placeholder — site owner should replace with real links
    if (siteUrl) {
      lines.push(`- [Homepage](${siteUrl}) : Main page`);
    }
    lines.push('');
    lines.push('<!-- TODO: Add links to your key pages here. -->');
    lines.push('<!-- Example: - [About](https://example.com/about) : About page -->');
  }
  lines.push('');

  // ── ## API section ────────────────────────────────────────────────────────
  // Emit if SoftwareApplication or API schema is present; else placeholder stub.
  const hasSoftwareApp = (schema.types || []).some((t) =>
    ['SoftwareApplication', 'APIReference', 'WebAPI'].includes(t)
  );
  const softwareSchema = hasSoftwareApp
    ? (schema.allSchemas || []).find((s) => {
        const types = Array.isArray(s['@type']) ? s['@type'] : [s['@type']];
        return types.some((t) => ['SoftwareApplication', 'APIReference', 'WebAPI'].includes(String(t).split('/').pop()));
      })
    : null;

  lines.push('## API');
  lines.push('');
  if (softwareSchema) {
    const appName = softwareSchema.name || h1;
    const appUrl  = softwareSchema.url || softwareSchema['@id'] || siteUrl;
    lines.push(`- [${appName} API](${appUrl}) : API reference`);
  } else {
    lines.push('<!-- TODO: Add links to your API docs here if applicable. -->');
  }
  lines.push('');

  // ── ## Optional section ───────────────────────────────────────────────────
  // sameAs links from Organization schema — up to 6.
  const sameAs = schema.orgData?.sameAs;
  const sameAsLinks = Array.isArray(sameAs)
    ? sameAs.slice(0, 6)
    : (typeof sameAs === 'string' ? [sameAs] : []);

  if (sameAsLinks.length > 0) {
    lines.push('## Optional');
    lines.push('');
    for (const link of sameAsLinks) {
      if (typeof link === 'string' && link.startsWith('http')) {
        const label = labelFromUrl(link);
        lines.push(`- [${label}](${link})`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelFromUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('linkedin'))   return 'LinkedIn';
    if (host.includes('twitter'))    return 'Twitter / X';
    if (host.includes('x.com'))      return 'Twitter / X';
    if (host.includes('facebook'))   return 'Facebook';
    if (host.includes('instagram'))  return 'Instagram';
    if (host.includes('youtube'))    return 'YouTube';
    if (host.includes('github'))     return 'GitHub';
    if (host.includes('wikidata'))   return 'Wikidata';
    if (host.includes('wikipedia'))  return 'Wikipedia';
    if (host.includes('crunchbase')) return 'Crunchbase';
    return host;
  } catch {
    return url;
  }
}
