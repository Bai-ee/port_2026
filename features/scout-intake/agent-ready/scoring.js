'use strict';

function scoreDimension(checks) {
  if (!checks.length) return null;
  const total = checks.reduce((s, c) => s + c.weight, 0);
  if (!total) return null;
  const passing = checks.filter((c) => c.status === 'pass').reduce((s, c) => s + c.weight, 0);
  return Math.round((passing / total) * 100);
}

function overallScore(dimensions) {
  const values = Object.values(dimensions).filter((v) => v != null);
  if (!values.length) return 0;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function verdictFor(score) {
  if (score >= 80) return 'Agent-ready';
  if (score >= 50) return 'Partially ready';
  return 'Not agent-ready';
}

module.exports = { scoreDimension, overallScore, verdictFor };
