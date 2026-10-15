// Schema migrations. v1 is the only version today; the registry is ready for v2.
// MIGRATIONS[n] upgrades a raw version-n document to version n+1.

import { SCHEMA_VERSION } from './constants.js';
import { validateDefinition } from './validate.js';
import { isPlainObject } from './util.js';

export const MIGRATIONS = Object.freeze({});

export function migrate(raw) {
  const fail = (code, message, fromVersion = null) => ({
    ok: false,
    definition: null,
    fromVersion,
    toVersion: SCHEMA_VERSION,
    steps: [],
    errors: [{ path: 'version', code, message }],
  });
  if (!isPlainObject(raw)) {
    return { ...fail('NOT_AN_OBJECT', 'a theme definition must be a JSON object'), errors: [{ path: '', code: 'NOT_AN_OBJECT', message: 'a theme definition must be a JSON object' }] };
  }
  const from = raw.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return fail('BAD_VERSION', '"version" must be a positive integer');
  }
  if (from > SCHEMA_VERSION) {
    return fail('UNSUPPORTED_VERSION', `version ${from} is newer than the supported version ${SCHEMA_VERSION}`, from);
  }
  let doc = raw;
  const steps = [];
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (typeof step !== 'function') return fail('NO_MIGRATION', `no migration registered from version ${v}`, from);
    doc = step(doc);
    steps.push(`v${v} -> v${v + 1}`);
  }
  const v = validateDefinition(doc);
  return {
    ok: v.ok,
    definition: v.definition,
    fromVersion: from,
    toVersion: SCHEMA_VERSION,
    steps,
    errors: v.errors,
  };
}
