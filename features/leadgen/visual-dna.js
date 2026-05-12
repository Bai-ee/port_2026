export const DOMAIN_LABELS = {
  food: 'Food',
  product: 'Product',
  location: 'Location',
  lifestyle: 'Lifestyle',
  people: 'People',
  environment: 'Environment',
};

export function normalizeVisualDna(raw) {
  const dna = raw || {};
  const subjects = Array.isArray(dna.subjects) ? dna.subjects : [];
  return {
    domain: dna.domain || null,
    status: dna.status || (subjects.length ? 'draft' : 'empty'),
    globalRules: dna.globalRules || null,
    subjects,
    masterPromptBlock: dna.masterPromptBlock || '',
    updatedAt: dna.updatedAt || null,
  };
}

function formatSubjectForPrompt(subject) {
  if (!subject) return null;
  const parts = [];
  if (subject.label) parts.push(`When generating ${subject.label}:`);
  if (subject.promptBlock) parts.push(subject.promptBlock);
  const a = subject.analysis || {};
  if (Array.isArray(a.mustInclude) && a.mustInclude.length) {
    parts.push(`Must include: ${a.mustInclude.join(', ')}`);
  }
  if (Array.isArray(a.avoid) && a.avoid.length) {
    parts.push(`Avoid: ${a.avoid.join(', ')}`);
  }
  if (Array.isArray(a.bestAngles) && a.bestAngles.length) {
    parts.push(`Best angles: ${a.bestAngles.join(', ')}`);
  }
  return parts.filter(Boolean).join('\n');
}

export function buildVisualDnaPromptBlock(raw) {
  const dna = normalizeVisualDna(raw);
  if (!dna.domain || !dna.subjects.length) return '';

  const label = DOMAIN_LABELS[dna.domain] || dna.domain;
  const lines = [`${label} Visual DNA rules:`];
  if (dna.masterPromptBlock) lines.push(dna.masterPromptBlock);

  for (const subject of dna.subjects) {
    const block = formatSubjectForPrompt(subject);
    if (block) lines.push(block);
  }

  return lines.filter(Boolean).join('\n\n');
}

export function formatVisualDnaForBrief(raw) {
  const dna = normalizeVisualDna(raw);
  if (!dna.domain || !dna.subjects.length) return '';

  const label = DOMAIN_LABELS[dna.domain] || dna.domain;
  const rows = dna.subjects.map((s) => {
    const a = s.analysis || {};
    const includes = Array.isArray(a.mustInclude) ? a.mustInclude.slice(0, 5).join(', ') : '';
    const avoid = Array.isArray(a.avoid) ? a.avoid.slice(0, 4).join(', ') : '';
    return `| ${s.label || s.id || 'Subject'} | ${s.status || 'draft'} | ${includes || '—'} | ${avoid || '—'} |`;
  });

  return `### Visual DNA (${label})

Use this as client-specific subject accuracy guidance for generated imagery.

${dna.masterPromptBlock ? `**Global Rules:** ${dna.masterPromptBlock}\n` : ''}
| Subject | Status | Must Include | Avoid |
|---------|--------|--------------|-------|
${rows.join('\n')}

${buildVisualDnaPromptBlock(dna)}`;
}
