'use client';

// Brief Studio - the "Admin only" panel a signed-out or non-admin visitor sees at
// ?tool=brief. Deliberately tiny and OUTSIDE the BriefStudio chunk: it makes no
// fetch, reads no storage and carries no client data, so the admin editor code
// is never even downloaded for a non-admin.

import React from 'react';
import { GLASS } from '../components/rail-ui';

export default function BriefAdminOnly({ signedIn = false, loading = false }) {
  return (
    <div
      id="brief-studio-admin-only-panel"
      role="status"
      style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 380, textAlign: 'center', fontFamily: GLASS.sans, color: GLASS.ink, lineHeight: 1.5 }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{loading ? 'Checking access…' : 'Admin only'}</div>
        {loading ? null : (
          <div style={{ fontSize: 13, color: GLASS.inkMute }}>
            The Client Brief studio is for HITLOOP admins. {signedIn ? 'This account does not have access.' : 'Sign in with an admin account to use it.'}
          </div>
        )}
      </div>
    </div>
  );
}
