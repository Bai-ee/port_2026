// social-preview-adapter.mjs — Converts siteMeta → sections[] for renderMiniBriefHtml.
//
// Input shape (from DashboardPage):
//   siteMeta — dashboardState.siteMeta
//     { title, description, siteName, ogImage, ogImageAlt, type, locale,
//       themeColor, favicon, appleTouchIcon, canonical }
//   siteName — hostname string (or empty)

function verdictFrom(meta) {
  if (!meta) return 'partial';
  const missing = [];
  if (!meta.title)       missing.push('title');
  if (!meta.description) missing.push('description');
  if (!meta.ogImage)     missing.push('og:image');
  if (missing.length === 0) return 'ready';
  if (missing.includes('og:image') || missing.length >= 2) return 'blocked';
  return 'partial';
}

function readinessLabel(meta) {
  const v = verdictFrom(meta);
  if (v === 'ready')   return 'Share-ready — all critical meta tags present';
  if (v === 'blocked') return 'Blocked — missing critical open-graph fields';
  return 'Partial — some metadata fields missing';
}

/**
 * Converts siteMeta into a sections[] payload for renderMiniBriefHtml.
 *
 * @param {{ siteMeta: object|null, siteName?: string }} opts
 */
export function socialPreviewAdapter({ siteMeta, siteName } = {}) {
  const subtitle = `Open-graph & metadata audit${siteName ? ` · ${siteName}` : ''}`;

  if (!siteMeta) {
    return {
      eyebrow:  'Social Preview',
      title:    'Social & Share Preview',
      subtitle,
      status:   'empty',
      sections: [],
    };
  }

  const sections = [];

  // 1. Readiness verdict
  sections.push({
    type:    'readiness',
    label:   verdictFrom(siteMeta) === 'ready' ? 'READY' : verdictFrom(siteMeta) === 'blocked' ? 'BLOCKED' : 'PARTIAL',
    verdict: verdictFrom(siteMeta),
    title:   readinessLabel(siteMeta),
    description: siteMeta.description || undefined,
  });

  // 2. OG coverage metric grid
  const gridItems = [
    { k: 'Title',          v: siteMeta.title       || 'Missing' },
    { k: 'Description',    v: siteMeta.description || 'Missing' },
    { k: 'OG Image',       v: siteMeta.ogImage     ? 'Present' : 'Missing' },
    { k: 'OG Image Alt',   v: siteMeta.ogImageAlt  || '—' },
    { k: 'OG Type',        v: siteMeta.type        || '—' },
    { k: 'Locale',         v: siteMeta.locale      || '—' },
    { k: 'Canonical',      v: siteMeta.canonical   || '—' },
    { k: 'Theme Color',    v: siteMeta.themeColor  || '—' },
    { k: 'Favicon',        v: siteMeta.favicon     ? 'Present' : 'Missing' },
    { k: 'Apple Touch',    v: siteMeta.appleTouchIcon ? 'Present' : '—' },
  ].filter((row) => row.v !== '—' || row.k === 'Canonical');
  sections.push({
    type:    'metric-grid',
    eyebrow: 'Metadata Coverage',
    title:   'Open-graph & meta tags',
    items:   gridItems,
  });

  // 3. Missing-field findings
  const findings = [];
  if (!siteMeta.title)       findings.push({ severity: 'high',   text: 'Missing <title> tag — required for every search result and share card.' });
  if (!siteMeta.description) findings.push({ severity: 'high',   text: 'Missing meta description — affects both SERP click-through and share card copy.' });
  if (!siteMeta.ogImage)     findings.push({ severity: 'high',   text: 'No og:image — most social platforms will show a blank preview card.' });
  if (!siteMeta.canonical)   findings.push({ severity: 'medium', text: 'Canonical URL not set — may cause duplicate-content issues on paginated routes.' });
  if (!siteMeta.themeColor)  findings.push({ severity: 'low',    text: 'No theme-color meta tag — browser chrome won\'t adopt brand color on mobile.' });
  if (!siteMeta.appleTouchIcon) findings.push({ severity: 'low', text: 'No apple-touch-icon — iOS home-screen bookmarks will use a screenshot fallback.' });
  if (siteMeta.ogImage && !siteMeta.ogImageAlt) findings.push({ severity: 'low', text: 'og:image present but og:image:alt missing — reduces accessibility of share cards.' });

  if (findings.length > 0) {
    sections.push({
      type:    'finding-list',
      eyebrow: 'Issues',
      title:   `${findings.length} metadata issue${findings.length !== 1 ? 's' : ''} found`,
      items:   findings,
    });
  }

  // 4. Full meta values (stat rows)
  const statRows = [
    siteMeta.title       && { k: 'Title',       v: siteMeta.title },
    siteMeta.description && { k: 'Description', v: siteMeta.description.length > 120 ? siteMeta.description.slice(0, 120) + '…' : siteMeta.description },
    siteMeta.ogImage     && { k: 'OG Image',    v: siteMeta.ogImage.length > 80 ? '…' + siteMeta.ogImage.slice(-80) : siteMeta.ogImage },
    siteMeta.canonical   && { k: 'Canonical',   v: siteMeta.canonical.length > 80 ? '…' + siteMeta.canonical.slice(-80) : siteMeta.canonical },
    siteMeta.siteName    && { k: 'Site Name',   v: siteMeta.siteName },
    siteMeta.type        && { k: 'OG Type',     v: siteMeta.type },
    siteMeta.locale      && { k: 'Locale',      v: siteMeta.locale },
    siteMeta.themeColor  && { k: 'Theme Color', v: siteMeta.themeColor },
  ].filter(Boolean);
  if (statRows.length > 0) {
    sections.push({
      type:    'stat-rows',
      eyebrow: 'Extracted Values',
      title:   'Raw metadata from page',
      rows:    statRows,
    });
  }

  const hasData = !!(siteMeta.title || siteMeta.description || siteMeta.ogImage);

  return {
    eyebrow:  'Social Preview',
    title:    'Social & Share Preview',
    subtitle,
    status:   hasData ? 'ready' : 'partial',
    sections,
  };
}
