import { NextResponse } from 'next/server';
import { createRequire } from 'module';

// Agent-ready probes: 11 parallel HTTP calls, 5s timeout each.
// Typically completes in 5–10s. 30s gives comfortable headroom.
export const maxDuration = 30;

const require = createRequire(import.meta.url);
const { runAgentReady } = require('../../../../features/scout-intake/agent-ready/index');

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

/**
 * POST /api/intelligence/agent-ready
 *
 * Public endpoint — no auth required.
 * Scans any URL for AI agent readiness and returns the full result.
 *
 * Body: { url: string }
 * Response: { ok, score, dimensions, verdict, checks, findings, highlights }
 */
export async function POST(request) {
  let url;
  try {
    const body = await request.json();
    url = typeof body.url === 'string' ? body.url.trim() : '';
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!url) return json({ error: 'url is required.' }, 400);

  // Normalise — prepend https:// if scheme missing
  const websiteUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  try {
    new URL(websiteUrl);
  } catch {
    return json({ error: 'Invalid URL.' }, 400);
  }

  let result;
  try {
    result = await runAgentReady({ websiteUrl });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : 'Scan failed.' }, 500);
  }

  return json({ ok: result.ok, ...result });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}
