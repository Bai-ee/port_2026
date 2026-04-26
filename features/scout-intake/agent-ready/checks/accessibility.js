'use strict';

function checkLlmsTxt(probes) {
  const p = probes.llmsTxt;
  if (!p || p.error) return { id: 'llms-txt-present', dimension: 'accessibility', status: 'na', weight: 3, evidence: { error: p?.error }, fixId: null };
  const status = p.status === 200 ? 'pass' : 'fail';
  return { id: 'llms-txt-present', dimension: 'accessibility', status, weight: 3, evidence: { statusCode: p.status }, fixId: status === 'fail' ? 'add-llms-txt' : null };
}

function checkMarkdownNegotiation(probes) {
  const p = probes.markdownNegotiation;
  if (!p || p.error) return { id: 'markdown-content-negotiation', dimension: 'accessibility', status: 'na', weight: 3, evidence: { error: p?.error }, fixId: null };
  if (!p.ok) return { id: 'markdown-content-negotiation', dimension: 'accessibility', status: 'na', weight: 3, evidence: { statusCode: p.status }, fixId: null };
  const ct = p.headers?.['content-type'] || '';
  const isMarkdown = ct.includes('text/markdown') || ct.includes('text/x-markdown');
  // Also accept if body starts with markdown-like content (# heading or frontmatter)
  const bodyLooksMarkdown = !isMarkdown && /^(#|---|\*\*|>\s)/m.test((p.body || '').slice(0, 500));
  const status = isMarkdown || bodyLooksMarkdown ? 'pass' : 'fail';
  return { id: 'markdown-content-negotiation', dimension: 'accessibility', status, weight: 3, evidence: { contentType: ct, bodyLooksMarkdown }, fixId: status === 'fail' ? 'add-markdown-negotiation' : null };
}

function checkStructuredData(probes) {
  const html = probes.homepageHtml || '';
  if (!html) return { id: 'structured-data-present', dimension: 'accessibility', status: 'na', weight: 2, evidence: {}, fixId: null };
  const hasJsonLd = /<script[^>]+type\s*=\s*["']application\/ld\+json["']/i.test(html);
  const status = hasJsonLd ? 'pass' : 'fail';
  return { id: 'structured-data-present', dimension: 'accessibility', status, weight: 2, evidence: { hasJsonLd }, fixId: status === 'fail' ? 'add-structured-data' : null };
}

function runAccessibility(probes) {
  return [
    checkLlmsTxt(probes),
    checkMarkdownNegotiation(probes),
    checkStructuredData(probes),
  ];
}

module.exports = { runAccessibility };
