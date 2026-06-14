import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const { logError } = require('../../../../api/_lib/observability.cjs');
const { checkRateLimit, getClientIp } = require('../../../../api/_lib/rate-limit.cjs');

const ALLOWED_EVENTS = new Set([
  'homepage_nav_click',
  'homepage_cta_click',
  'homepage_portfolio_click',
  'homepage_outbound_click',
  'homepage_button_click',
  'homepage_form_focus',
  'homepage_form_change',
  'homepage_scroll_depth',
  'homepage_web_vital',
]);

function text(value, max = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeParams(params = {}) {
  return {
    interactionType: text(params.interaction_type, 40),
    elementId: text(params.element_id, 80),
    elementText: text(params.element_text, 120),
    elementTag: text(params.element_tag, 24),
    section: text(params.section, 80),
    linkUrl: text(params.link_url, 220),
    outbound: Boolean(params.outbound),
    sourceEvent: text(params.source_event, 60),
    fieldId: text(params.field_id, 80),
    fieldName: text(params.field_name, 80),
    fieldType: text(params.field_type, 40),
    fieldLabel: text(params.field_label, 120),
    scrollDepth: number(params.scroll_depth, 0),
    metricName: text(params.metric_name, 24),
    metricValue: number(params.metric_value, 0),
    metricRating: text(params.metric_rating, 20),
    metricId: text(params.metric_id, 80),
  };
}

export async function POST(request) {
  // Rate limit: 200 analytics events per IP per hour
  const ip = getClientIp(request);
  const rl = await checkRateLimit({
    key: `anon:${ip}:analytics-homepage`,
    limit: 200,
    windowSeconds: 3600,
  });
  if (!rl.allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const eventName = text(body.eventName, 60);
    if (!ALLOWED_EVENTS.has(eventName)) {
      return NextResponse.json({ ok: false, error: 'Unsupported event' }, { status: 400 });
    }

    const params = sanitizeParams(body.params || {});
    await fb.adminDb.collection('homepage_events').add({
      eventName,
      ...params,
      pagePath: text(body.pagePath || '/', 120),
      pageTitle: text(body.pageTitle, 160),
      viewportWidth: number(body.viewport?.width, 0),
      viewportHeight: number(body.viewport?.height, 0),
      userAgent: text(request.headers.get('user-agent'), 220),
      createdAt: new Date(),
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    logError('homepage_analytics_event_error', { error: err.message });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
