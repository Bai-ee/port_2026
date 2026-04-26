'use strict';

function checkRobotsContentSignal(probes) {
  const p = probes.robotsTxt;
  if (!p || p.error || p.status !== 200) return { id: 'robots-content-signal', dimension: 'botAccess', status: 'na', weight: 2, evidence: {}, fixId: null };
  const hasSignal = /Content-Signal\s*:/i.test(p.body);
  const status = hasSignal ? 'pass' : 'fail';
  // Extract the signal value if present
  const match = p.body.match(/Content-Signal\s*:\s*([^\r\n]+)/i);
  return { id: 'robots-content-signal', dimension: 'botAccess', status, weight: 2, evidence: { signal: match?.[1]?.trim() || null }, fixId: status === 'fail' ? 'add-content-signal' : null };
}

function checkWebBotAuth(probes) {
  const p = probes.signatureAgentProbe;
  if (!p || p.error) return { id: 'web-bot-auth-supported', dimension: 'botAccess', status: 'na', weight: 1, evidence: { error: p?.error }, fixId: null };
  // Pass if server responds 2xx or 3xx (not blocking the agent header outright)
  // Fail only if server returns 4xx specifically to the Signature-Agent header probe
  const status = p.status > 0 && p.status < 400 ? 'pass' : 'fail';
  return { id: 'web-bot-auth-supported', dimension: 'botAccess', status, weight: 1, evidence: { statusCode: p.status }, fixId: status === 'fail' ? 'add-web-bot-auth' : null };
}

function runBotAccess(probes) {
  return [
    checkRobotsContentSignal(probes),
    checkWebBotAuth(probes),
  ];
}

module.exports = { runBotAccess };
