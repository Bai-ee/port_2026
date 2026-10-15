// Shared helpers for the WS8 (unowned public / shared files) migration tests. Not a test file.
// Reuses the WS7 scanner so the literal rules (black shadows are mode-agnostic, X6) are identical.

import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, scanFile, read, lineOf } from './ws7-helpers.js';

export { REPO_ROOT, scanFile, read, lineOf };

// Files no other workstream owned. Every colour literal in them goes through theme tokens
// or is listed in allowlists/ws8.json.
export const WS8_FILES = [
  'components/payments/SubscribeModal.jsx',
  'components/records/RecordsPage.jsx',
  'components/GlassTooltipLayer.jsx',
  'components/CalendarConnectModal.jsx',
  'app/oauth/authorize/page.jsx',
  'app/telegram-upload/[token]/page.jsx',
  'app/telegram-upload/[token]/TelegramUploadClient.jsx',
];

export function loadWs8Allowlist() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'lib/theme-migration/allowlists/ws8.json'), 'utf8'));
}
