// The checked-in production theme definition (canonical baseline until the owner replaces it).
// Imported only by the lazy draft store, never by the main bundle (the main bundle uses the slim
// generated runtime data).

import productionJson from '../theme/production/production-theme.json' with { type: 'json' };
import { validateDefinition } from '../theme/validate.js';

const parsed = validateDefinition(productionJson);
if (!parsed.ok || !parsed.definition) {
  throw new Error(`lib/theme/production/production-theme.json is invalid: ${JSON.stringify(parsed.errors)}`);
}

export const PRODUCTION_DEFINITION = parsed.definition;
