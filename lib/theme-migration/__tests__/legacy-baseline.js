// The migration parity tests prove the WS7/WS8 token substitution was
// lossless: the tokens resolve to the exact legacy literals they replaced.
// That proof is pinned to the theme that shipped with the migration
// (frozen in fixtures/), so the production theme can change look freely.

import fs from 'node:fs';
import { buildProductionOutputs } from '../../theme/production/build-outputs.js';

const text = fs.readFileSync(new URL('./fixtures/legacy-baseline-theme.json', import.meta.url), 'utf8');
const out = buildProductionOutputs(text);
if (!out.ok) throw new Error('legacy baseline fixture failed to build');

export const legacyRuntime = JSON.parse(out.files.runtime);
