import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { isAllowedUsageModule } from '../../../../../features/discogs-ingest/draft-builder.js';
import { workerAuthStatus } from '../../../../../features/discogs-ingest/service.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { logUsage } = require('../../../../../api/_lib/usage-logger.cjs');

export async function POST(request) {
  const auth = workerAuthStatus(request);
  if (auth === 503) return NextResponse.json({ error: 'Worker token not configured' }, { status: 503 });
  if (auth !== 200) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const b = (await request.json().catch(() => null)) || {};
  if (!isAllowedUsageModule(b.module)) return NextResponse.json({ error: "module must start with 'discogs-'" }, { status: 400 });
  if (!b.provider || !b.model) return NextResponse.json({ error: 'provider and model are required' }, { status: 400 });
  const id = await logUsage({
    module: b.module, action: b.action, provider: b.provider, model: b.model,
    inputTokens: b.inputTokens, outputTokens: b.outputTokens, calls: b.calls,
    imageCount: b.imageCount, costUsd: b.costUsd, runId: b.runId, metadata: b.metadata,
  });
  if (!id) return NextResponse.json({ error: 'usage log write failed' }, { status: 502 });
  return NextResponse.json({ ok: true, id });
}
