'use strict';

function checkMcpDiscovery(probes) {
  const p = probes.mcpJson;
  if (!p || p.error) return { id: 'mcp-discovery', dimension: 'capabilities', status: 'na', weight: 3, evidence: { error: p?.error }, fixId: null };
  if (p.status !== 200) return { id: 'mcp-discovery', dimension: 'capabilities', status: 'fail', weight: 3, evidence: { statusCode: p.status }, fixId: 'add-mcp-discovery' };
  let parsed = null;
  try { parsed = JSON.parse(p.body); } catch {}
  const valid = parsed !== null && typeof parsed === 'object';
  const status = valid ? 'pass' : 'warn';
  return { id: 'mcp-discovery', dimension: 'capabilities', status, weight: 3, evidence: { statusCode: p.status, valid }, fixId: valid ? null : 'add-mcp-discovery' };
}

function checkAgentSkillsManifest(probes) {
  const direct = probes.agentSkills;
  // Also check if mcp.json references agent-skills
  const mcpBody = probes.mcpJson?.body || '';
  const referencedInMcp = mcpBody.includes('agent-skills');

  if ((!direct || direct.error) && !referencedInMcp) {
    return { id: 'agent-skills-manifest', dimension: 'capabilities', status: 'na', weight: 2, evidence: { error: direct?.error }, fixId: null };
  }

  if (referencedInMcp && (!direct || direct.status !== 200)) {
    return { id: 'agent-skills-manifest', dimension: 'capabilities', status: 'warn', weight: 2, evidence: { referencedInMcp: true, directStatus: direct?.status }, fixId: 'add-agent-skills' };
  }

  if (!direct || direct.error) return { id: 'agent-skills-manifest', dimension: 'capabilities', status: 'na', weight: 2, evidence: {}, fixId: null };

  if (direct.status !== 200) return { id: 'agent-skills-manifest', dimension: 'capabilities', status: 'fail', weight: 2, evidence: { statusCode: direct.status }, fixId: 'add-agent-skills' };

  let parsed = null;
  try { parsed = JSON.parse(direct.body); } catch {}
  const valid = parsed !== null && typeof parsed === 'object';
  const status = valid ? 'pass' : 'warn';
  return { id: 'agent-skills-manifest', dimension: 'capabilities', status, weight: 2, evidence: { statusCode: direct.status, valid }, fixId: valid ? null : 'add-agent-skills' };
}

function checkX402Payment(probes) {
  const p = probes.x402Probe;
  if (!p || p.error) return { id: 'x402-payment-supported', dimension: 'capabilities', status: 'na', weight: 1, evidence: { error: p?.error }, fixId: null };
  const isX402 = p.status === 402 && /x402/i.test(p.headers?.['www-authenticate'] || '');
  const status = isX402 ? 'pass' : 'fail';
  return { id: 'x402-payment-supported', dimension: 'capabilities', status, weight: 1, evidence: { statusCode: p.status, wwwAuthenticate: p.headers?.['www-authenticate'] || null }, fixId: status === 'fail' ? 'add-x402-payment' : null };
}

function checkOauthDiscovery(probes) {
  const p = probes.oauthDiscovery;
  if (!p || p.error) return { id: 'oauth-discovery', dimension: 'capabilities', status: 'na', weight: 1, evidence: { error: p?.error }, fixId: null };
  if (p.status !== 200) return { id: 'oauth-discovery', dimension: 'capabilities', status: 'fail', weight: 1, evidence: { statusCode: p.status }, fixId: 'add-oauth-discovery' };
  let parsed = null;
  try { parsed = JSON.parse(p.body); } catch {}
  const valid = parsed !== null && typeof parsed === 'object' && 'issuer' in parsed;
  const status = valid ? 'pass' : 'warn';
  return { id: 'oauth-discovery', dimension: 'capabilities', status, weight: 1, evidence: { statusCode: p.status, valid }, fixId: valid ? null : 'add-oauth-discovery' };
}

function runCapabilities(probes) {
  return [
    checkMcpDiscovery(probes),
    checkAgentSkillsManifest(probes),
    checkX402Payment(probes),
    checkOauthDiscovery(probes),
  ];
}

module.exports = { runCapabilities };
