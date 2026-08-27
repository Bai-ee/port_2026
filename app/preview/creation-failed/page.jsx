'use client';

// TEMPORARY visual harness for DashboardCreationFailedModal — mounts the real
// component with a mock creationFailure projection so the card can be reviewed
// without triggering an actual failed provisioning run. Safe to delete.

import { useState } from 'react';
import DashboardCreationFailedModal from '../../../components/dashboard/DashboardCreationFailedModal';

const MOCK_CREATION_FAILURE = {
  status: 'open',
  incidentId: 'preview-incident',
  runId: 'run_preview_0001',
  failedAt: '2026-08-26T22:01:28.000Z',
  publicCode: 'HIT-5AUD7B',
  publicStage: 'Site capture',
  publicMessage: 'The site did not respond to our capture request.',
  notification: { status: 'not_configured' },
};

export default function CreationFailedPreviewPage() {
  const [bypassed, setBypassed] = useState(false);
  return (
    <main id="creation-failed-preview-page" style={{ minHeight: '100dvh', background: '#cfc7cc', padding: '2rem', fontFamily: '"Space Mono", monospace', color: '#2a2420' }}>
      {bypassed ? (
        <p id="creation-failed-preview-bypassed">
          Gate lifted — in the real dashboard this is where the unpopulated dashboard renders.{' '}
          <button type="button" onClick={() => setBypassed(false)}>Show modal again</button>
        </p>
      ) : null}
      <DashboardCreationFailedModal
        creationFailure={bypassed ? null : MOCK_CREATION_FAILURE}
        websiteUrl="broken-site-for-test.invalid"
        onRequestDeleteAccount={() => {}}
        onContinueAnyway={() => setBypassed(true)}
      />
    </main>
  );
}
