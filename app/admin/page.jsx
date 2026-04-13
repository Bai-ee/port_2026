import { createRequire } from 'module';
import OpsOverviewPage from '../../OpsOverviewPage';

const require = createRequire(import.meta.url);
const { buildOpsOverview } = require('../../api/_lib/ops-overview.cjs');

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function AdminRoute() {
  try {
    const initialData = await buildOpsOverview();
    return <OpsOverviewPage initialData={initialData} />;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load ops overview.';
    return <OpsOverviewPage initialError={message} />;
  }
}
