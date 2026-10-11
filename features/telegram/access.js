// Telegram access gate. Every inbound update and every scheduled send calls this; a revoked or non-pilot binding
// gets nothing but linking help. Wraps the existing owner-pilot gate so Telegram can never widen access.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let pilot = null;
function pilotGate() {
  if (!pilot) pilot = require('../../api/_lib/pilot-access.cjs');
  return pilot;
}

/**
 * @param {{status?:string, uid?:string, clientId?:string}|null} binding
 * @param {object} env
 * @param {{requirePilotOwner?:Function}} [deps]  injectable for tests
 * @returns {{ok:true, uid:string, clientId:string}|{ok:false, reason:string}}
 */
export function checkBindingAccess(binding, env = process.env, deps = {}) {
  if (!binding) return { ok: false, reason: 'unbound' };
  if (binding.status !== 'active') return { ok: false, reason: 'revoked' };
  if (!binding.uid || !binding.clientId) return { ok: false, reason: 'incomplete-binding' };
  const gate = deps.requirePilotOwner || pilotGate().requirePilotOwner;
  try {
    const { uid, clientId } = gate({ clientId: binding.clientId }, { uid: binding.uid }, env);
    return { ok: true, uid, clientId };
  } catch (err) {
    return { ok: false, reason: err?.code || 'pilot-denied' };
  }
}

export default checkBindingAccess;
