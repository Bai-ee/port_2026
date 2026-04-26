'use strict';

// Each check: { id, dimension, status, weight, evidence, fixId }

function checkRobotsTxtPresent(probes) {
  const p = probes.robotsTxt;
  if (!p || p.error) return { id: 'robots-txt-present', dimension: 'discoverability', status: 'na', weight: 2, evidence: { error: p?.error }, fixId: null };
  const status = p.status === 200 ? 'pass' : 'fail';
  return { id: 'robots-txt-present', dimension: 'discoverability', status, weight: 2, evidence: { statusCode: p.status }, fixId: status === 'fail' ? 'add-robots-txt' : null };
}

function checkRobotsTxtParseable(probes) {
  const p = probes.robotsTxt;
  if (!p || p.error || p.status !== 200) return { id: 'robots-txt-parseable', dimension: 'discoverability', status: 'na', weight: 1, evidence: {}, fixId: null };
  const hasDirective = /User-agent\s*:/i.test(p.body);
  const status = hasDirective ? 'pass' : 'fail';
  return { id: 'robots-txt-parseable', dimension: 'discoverability', status, weight: 1, evidence: { excerpt: p.body.slice(0, 200) }, fixId: status === 'fail' ? 'fix-robots-txt' : null };
}

function checkSitemapReachable(probes) {
  const p = probes.sitemapXml;
  if (!p || p.error) return { id: 'sitemap-xml-reachable', dimension: 'discoverability', status: 'na', weight: 2, evidence: { error: p?.error }, fixId: null };
  const status = p.status === 200 ? 'pass' : 'fail';
  return { id: 'sitemap-xml-reachable', dimension: 'discoverability', status, weight: 2, evidence: { statusCode: p.status }, fixId: status === 'fail' ? 'add-sitemap-xml' : null };
}

function checkLinkHeaderSitemap(probes) {
  const p = probes.homepageHeaders;
  if (!p || p.error) return { id: 'link-header-sitemap', dimension: 'discoverability', status: 'na', weight: 1, evidence: { error: p?.error }, fixId: null };
  const linkHeader = p.headers?.link || '';
  const hasSitemapLink = /rel\s*=\s*["']?sitemap["']?/i.test(linkHeader);
  const status = hasSitemapLink ? 'pass' : 'fail';
  return { id: 'link-header-sitemap', dimension: 'discoverability', status, weight: 1, evidence: { linkHeader: linkHeader || null }, fixId: status === 'fail' ? 'add-link-header-sitemap' : null };
}

function checkApiCatalog(probes) {
  const p = probes.apiCatalog;
  if (!p || p.error) return { id: 'api-catalog-wellknown', dimension: 'discoverability', status: 'na', weight: 2, evidence: { error: p?.error }, fixId: null };
  if (p.status !== 200) return { id: 'api-catalog-wellknown', dimension: 'discoverability', status: 'fail', weight: 2, evidence: { statusCode: p.status }, fixId: 'add-api-catalog' };
  let parseable = false;
  try { JSON.parse(p.body); parseable = true; } catch {}
  const status = parseable ? 'pass' : 'warn';
  return { id: 'api-catalog-wellknown', dimension: 'discoverability', status, weight: 2, evidence: { statusCode: p.status, parseable }, fixId: parseable ? null : 'add-api-catalog' };
}

function runDiscoverability(probes) {
  return [
    checkRobotsTxtPresent(probes),
    checkRobotsTxtParseable(probes),
    checkSitemapReachable(probes),
    checkLinkHeaderSitemap(probes),
    checkApiCatalog(probes),
  ];
}

module.exports = { runDiscoverability };
