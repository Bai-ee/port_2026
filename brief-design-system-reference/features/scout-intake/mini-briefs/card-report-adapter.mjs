// card-report-adapter.mjs - Converts a dashboard card shape into the shared
// mini-brief report format used by Social Preview.

const SEV_MAP = {
  critical: 'high',
  high: 'high',
  warning: 'medium',
  warn: 'medium',
  medium: 'medium',
  low: 'low',
  info: 'info',
};

const EMPTY_VALUES = new Set([
  '',
  '-',
  '--',
  '\u2014',
  'pending',
  'not provided',
  'no data',
  'no output yet',
]);

function flattenValue(value) {
  if (value == null || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(flattenValue).filter(Boolean).join(' ');
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  if (typeof value === 'object') {
    if (value.props && Object.prototype.hasOwnProperty.call(value.props, 'children')) {
      return flattenValue(value.props.children);
    }
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toLocaleString();
      } catch {}
    }
    if (typeof value.seconds === 'number') {
      try {
        return new Date(value.seconds * 1000).toLocaleString();
      } catch {}
    }
    if (typeof value.title === 'string') return value.title;
    if (typeof value.label === 'string') return value.label;
    if (typeof value.status === 'string') return value.status;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function cleanText(value) {
  return flattenValue(value).replace(/\s+/g, ' ').trim();
}

function hasValue(value) {
  const text = cleanText(value).toLowerCase();
  return !EMPTY_VALUES.has(text);
}

function verdictFromStatus(status, analyzerReadiness) {
  const raw = `${status || ''} ${analyzerReadiness || ''}`.toLowerCase();
  if (!raw.trim()) return 'partial';
  if (raw.includes('error') || raw.includes('critical') || raw.includes('work is needed') || raw.includes('blocked')) {
    return 'blocked';
  }
  if (raw.includes('partial') || raw.includes('queued') || raw.includes('coming soon') || raw.includes('not run') || raw.includes('needs')) {
    return 'partial';
  }
  if (raw.includes('live') || raw.includes('ready') || raw.includes('available') || raw.includes('passed') || raw.includes('healthy')) {
    return 'ready';
  }
  return 'partial';
}

function labelFromVerdict(verdict, status) {
  if (status) {
    const firstWord = cleanText(status).split(/[\s,.!]+/)[0];
    if (firstWord) return firstWord.toUpperCase();
  }
  if (verdict === 'ready') return 'READY';
  if (verdict === 'blocked') return 'BLOCKED';
  return 'PARTIAL';
}

function normalizeRows(rows = []) {
  const sections = [];
  let current = { title: 'Card Fields', rows: [] };

  const flush = () => {
    if (current.rows.length > 0) {
      sections.push({ ...current });
    }
  };

  for (const row of rows || []) {
    if (!row) continue;
    if (row.isHeader) {
      flush();
      current = { title: cleanText(row.label) || 'Details', rows: [] };
      continue;
    }
    if (row.isAuditRow) {
      const status = cleanText(row.status);
      current.rows.push({
        k: cleanText(row.label) || 'Field',
        v: [row.tier && cleanText(row.tier), status].filter(Boolean).join(' / ') || '-',
      });
      continue;
    }
    current.rows.push({
      k: cleanText(row.label) || 'Field',
      v: cleanText(row.value) || '-',
    });
  }
  flush();
  return sections;
}

function mapFindings(findings = []) {
  if (!Array.isArray(findings)) return [];
  return findings.map((finding, index) => ({
    severity: SEV_MAP[finding?.severity] || 'info',
    text: cleanText(finding?.label || finding?.text || finding?.title || finding?.id) || `Finding ${index + 1}`,
    detail: cleanText(finding?.detail || finding?.description || finding?.whyItMatters) || undefined,
  }));
}

export function cardReportAdapter({ card, siteName } = {}) {
  const title = cleanText(card?.title) || 'Card Report';
  const label = cleanText(card?.label || card?.category) || 'Dashboard Card';
  const status = cleanText(card?.readinessBadge?.label || card?.footerLeft || card?.analyzer?.readiness);
  const verdict = verdictFromStatus(status, card?.analyzer?.readiness);
  const rows = Array.isArray(card?.rows) ? card.rows : [];
  const rowSections = normalizeRows(rows);
  const findingItems = mapFindings(card?.analyzer?.findings);
  const highlights = Array.isArray(card?.analyzer?.highlights)
    ? card.analyzer.highlights.map(cleanText).filter(Boolean)
    : [];

  const sections = [{
    type: 'readiness',
    label: labelFromVerdict(verdict, status),
    verdict,
    title: [status || 'Report generated', cleanText(card?.footerRight)].filter(Boolean).join(' / '),
    description: cleanText(card?.description) || undefined,
  }];

  if (highlights.length > 0) {
    sections.push({
      type: 'prose',
      eyebrow: 'Highlights',
      title: 'What stands out',
      body: highlights.slice(0, 3).join(' '),
    });
  }

  if (findingItems.length > 0) {
    sections.push({
      type: 'finding-list',
      eyebrow: 'Findings',
      title: `${findingItems.length} issue${findingItems.length === 1 ? '' : 's'} identified`,
      items: findingItems,
    });
  }

  rowSections.forEach((section) => {
    sections.push({
      type: 'stat-rows',
      eyebrow: 'Details',
      title: section.title,
      rows: section.rows,
    });
  });

  if (sections.length === 1 && rows.length === 0) {
    sections.push({
      type: 'prose',
      eyebrow: 'Overview',
      title: 'No card data captured yet',
      body: cleanText(card?.description) || 'Run or configure this card to populate the report.',
    });
  }

  const hasSubstantiveData = rows.some((row) => hasValue(row?.value) || hasValue(row?.status)) || findingItems.length > 0 || highlights.length > 0;

  return {
    eyebrow: label,
    title,
    subtitle: `Single page card report${siteName ? ` / ${siteName}` : ''}`,
    status: hasSubstantiveData ? 'ready' : 'partial',
    sections,
  };
}
