import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { verifyRequestUser } = require('../../../../api/_lib/auth.cjs');
const { getDashboardBootstrap } = require('../../../../api/_lib/client-provisioning.cjs');
const fb = require('../../../../api/_lib/firebase-admin.cjs');

function makeReqShim(request) {
  return {
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  };
}

export async function GET(request) {
  let decoded;
  try {
    decoded = await verifyRequestUser(makeReqShim(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unauthorized.' },
      { status: 401 }
    );
  }

  try {
    let bootstrap = await getDashboardBootstrap(decoded.uid);

    // Auto-create sample brief for admin if missing
    const isAdmin = decoded.email === 'edittraxnft@gmail.com';
    if (isAdmin && bootstrap?.dashboardState && !bootstrap.dashboardState.scribe?.brief) {
      const clientId = bootstrap.userProfile?.clientId;
      if (clientId) {
        const now = new Date().toISOString();
        const sampleBrief = {
          headline: 'Admin Dashboard',
          summary: 'Welcome to the admin dashboard. This is a sample brief showing the dashboard capabilities.',
          createdAt: now,
          updatedAt: now,
        };

        // Update dashboard_state with sample brief
        await fb.adminDb.collection('dashboard_state').doc(clientId).set(
          {
            scribe: {
              brief: sampleBrief,
              cards: {},
              cost: { estimatedCostUsd: 0 },
            },
            updatedAt: fb.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        // Re-fetch bootstrap to include the new brief
        bootstrap = await getDashboardBootstrap(decoded.uid);
      }
    }

    return NextResponse.json(bootstrap, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unauthorized.' },
      { status: 401 }
    );
  }
}
