import { createRequire } from 'module';
import { renderOutreachEmail } from '../../../../features/leadgen/email-template.js';

export const maxDuration = 120;

const require = createRequire(import.meta.url);
const fb                      = require('../../../../api/_lib/firebase-admin.cjs');
const { verifyRequestUser }   = require('../../../../api/_lib/auth.cjs');
const { callAnthropic }       = require('../../../../features/scout-intake/_anthropic-client.js');
const { logUsage, computeAnthropicCost } = require('../../../../api/_lib/usage-logger.cjs');

// ─── THEME EXTRACTION ─────────────────────────────────────────────────────────

function extractThemeFromDesignMd(designMd) {
  const hexPattern = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const hexes = [...(designMd || '').matchAll(hexPattern)].map(m => m[0]);

  // First hex hit = primary, second = accent (rough heuristic from DESIGN.MD structure)
  const primaryColor = hexes[0] || '#1a1a1a';
  const accentColor  = hexes[1] || '#2563eb';

  // Font family — look for common heading font mentions
  const fontMatch = (designMd || '').match(/\b(Inter|Montserrat|Playfair|Lato|Raleway|Poppins|Georgia|Merriweather|Open Sans|Source Sans)\b/i);
  const fontFamily = fontMatch ? fontMatch[1] : 'Inter';

  return { primaryColor, accentColor, fontFamily };
}

// ─── NOTE COMPOSER ────────────────────────────────────────────────────────────

async function composeNote(prospect) {
  const deficiencies = (prospect.quickAudit?.deficiencies || []).slice(0, 3).join(', ') || 'outdated design, slow load times, poor mobile experience';
  const before = prospect.generation?.readinessComparison?.before?.score ?? '';
  const after  = prospect.generation?.readinessComparison?.after?.score  ?? '';
  const scoreLine = (before && after) ? `AI Readiness improvement: ${before} → ${after}` : '';

  const prompt = `You are writing a brief, warm outreach note from Bryan Balli, a web developer, to a local business owner. Bryan speculatively built a modern preview website for their business to demonstrate what an upgrade could look like.

Business: ${prospect.name}
Vertical: ${prospect.vertical || 'local business'}
Location: ${prospect.address || ''}
Current website issues: ${deficiencies}
${scoreLine}

Write 3-4 sentences. Tone: confident but not pushy, specific to their business, mention one concrete improvement. Do NOT use exclamation marks excessively. Sign off with just "— Bryan"`;

  const model = 'claude-haiku-4-5';
  const result = await callAnthropic({
    model,
    max_tokens: 200,
    messages:   [{ role: 'user', content: prompt }],
  }, { apiKey: process.env.ANTHROPIC_API_KEY });

  const usage = result?.usage || {};
  await logUsage({
    module:       'leadgen',
    action:       'package.compose-note',
    provider:     'anthropic',
    model,
    inputTokens:  usage.input_tokens  || 0,
    outputTokens: usage.output_tokens || 0,
    costUsd:      computeAnthropicCost({
      model,
      inputTokens:  usage.input_tokens  || 0,
      outputTokens: usage.output_tokens || 0,
    }),
    placeId:      prospect.placeId || null,
    metadata:     { vertical: prospect.vertical || null },
  });

  return result.content?.[0]?.text?.trim() || `Hi, I built a modern preview site for ${prospect.name} — take a look and let me know if you'd like to chat.\n— Bryan`;
}

// ─── ROUTE ────────────────────────────────────────────────────────────────────

function makeReqShim(request) {
  return { headers: { authorization: request.headers.get('authorization'), Authorization: request.headers.get('authorization') } };
}

export async function POST(request) {
  try { await verifyRequestUser(makeReqShim(request)); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Unauthorized.' }) + '\n', { status: 401, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  let body;
  try { body = await request.json().catch(() => ({})); }
  catch { return new Response(JSON.stringify({ type: 'error', message: 'Invalid JSON.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }); }

  const placeId = String(body?.placeId || '').trim();
  if (!placeId) return new Response(JSON.stringify({ type: 'error', message: 'Provide placeId.' }) + '\n', { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } });

  const snap = await fb.adminDb.collection('leadgen_prospects').doc(placeId).get();
  if (!snap.exists) return new Response(JSON.stringify({ type: 'error', message: `Prospect not found: ${placeId}` }) + '\n', { status: 404, headers: { 'Content-Type': 'application/x-ndjson' } });

  const prospect = snap.data();

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      const emit = (obj) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
      };

      emit({ type: 'start', websiteUrl: prospect.website || prospect.name });

      try {
        // ── Step 1: Load + validate ───────────────────────────────────
        emit({ type: 'progress', stage: 'load', label: 'Loading prospect data…' });
        const previewUrl = prospect.generation?.previewUrl;
        if (!previewUrl) throw new Error('No previewUrl found — generate site first.');

        // ── Step 2: Thumbnail ─────────────────────────────────────────
        emit({ type: 'progress', stage: 'thumbnail', label: 'Resolving site thumbnail…' });
        const thumbnailUrl = prospect.generation?.mockupUrl || previewUrl;

        // ── Step 3: Theme ─────────────────────────────────────────────
        emit({ type: 'progress', stage: 'theme', label: 'Extracting site theme…' });
        const theme = extractThemeFromDesignMd(prospect.generation?.designMd);
        emit({ type: 'progress', stage: 'theme', label: `Theme: ${theme.primaryColor} · ${theme.accentColor} · ${theme.fontFamily}` });

        // ── Step 4: Compose note ──────────────────────────────────────
        emit({ type: 'progress', stage: 'compose', label: 'Writing personal note…' });
        const note = await composeNote(prospect);
        emit({ type: 'progress', stage: 'compose', label: 'Note drafted.' });

        // ── Step 5: Render email ──────────────────────────────────────
        emit({ type: 'progress', stage: 'render', label: 'Building postcard email…' });

        const emailSubject = `I built something for ${prospect.name}`;
        const readinessBefore = prospect.generation?.readinessComparison?.before?.score ?? null;
        const readinessAfter  = prospect.generation?.readinessComparison?.after?.score  ?? null;

        const emailHtml = renderOutreachEmail({
          businessName:   prospect.name,
          note,
          thumbnailUrl,
          previewUrl,
          originalSiteUrl: prospect.website || null,
          readinessBefore,
          readinessAfter,
          theme,
        });

        emit({ type: 'progress', stage: 'render', label: `Email rendered — ${(emailHtml.length / 1024).toFixed(1)}KB` });

        // ── Step 6: Persist ───────────────────────────────────────────
        emit({ type: 'progress', stage: 'persist', label: 'Saving package…' });

        await fb.adminDb.collection('leadgen_prospects').doc(placeId).update({
          stage:                       'packaged',
          'outreach.thumbnailUrl':     thumbnailUrl,
          'outreach.theme':            theme,
          'outreach.note':             note,
          'outreach.emailHtml':        emailHtml,
          'outreach.emailSubject':     emailSubject,
          'outreach.packagedAt':       new Date().toISOString(),
          'outreach.sentAt':           null,
          'outreach.sentTo':           null,
          'outreach.gmailMessageId':   null,
        });

        emit({
          type:   'done',
          status: 'succeeded',
          result: { thumbnailUrl, note, emailSubject },
        });

      } catch (err) {
        console.error('[package] error:', err);
        emit({ type: 'error', message: err.message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status:  200,
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
