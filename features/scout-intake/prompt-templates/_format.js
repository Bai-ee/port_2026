'use strict';

// Shared formatting helpers for prompt templates.

function colorSwatches(arr, label) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const items = arr.map((c) => {
    const parts = [c.hex];
    if (c.name) parts.push(`(${c.name})`);
    if (c.usage) parts.push(`— ${c.usage}`);
    return parts.join(' ');
  });
  return label ? `${label}: ${items.join(' · ')}` : items.join(' · ');
}

function gradients(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.map((g) => `${g.name}: ${(g.stops || []).join(' → ')} at ${g.direction}`).join(' · ');
}

function pairings(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.map((p) => `${p.name} (${p.foreground} on ${p.background})`).join(' · ');
}

function typeSpec(spec, label) {
  if (!spec) return null;
  const parts = [];
  if (spec.font_family || spec.fontFamily) parts.push(spec.font_family || spec.fontFamily);
  if (spec.weight) parts.push(spec.weight);
  if (spec.style) parts.push(spec.style);
  if (spec.case) parts.push(`case: ${spec.case}`);
  if (spec.letter_spacing) parts.push(`tracking: ${spec.letter_spacing}`);
  if (spec.line_height) parts.push(`leading: ${spec.line_height}`);
  const val = parts.join(', ');
  return label ? `${label}: ${val}` : val;
}

function souls(arr) {
  if (!Array.isArray(arr) || !arr.length) return '[3 soul descriptors]';
  return arr.join(' / ');
}

function list(arr, prefix = '•') {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.map((item) => `${prefix} ${item}`).join('\n');
}

function section(title, lines) {
  const content = lines.filter(Boolean).join('\n');
  if (!content) return null;
  return `${title}\n${content}`;
}

module.exports = { colorSwatches, gradients, pairings, typeSpec, souls, list, section };
