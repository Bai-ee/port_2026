import { renderOutreachEmail } from '../../../../features/leadgen/email-template.js';

// Dev-only visual harness for the lead-gen outreach postcard.
// Open http://localhost:3000/api/leadgen/email-preview to eyeball the rendered
// email with mock data before any real send. Query toggles:
//   ?before=0     hide the "current site" half of before/after
//   ?readiness=0  hide the AI-readiness readout
export async function GET(request) {
  const url = new URL(request.url);
  const showBefore    = url.searchParams.get('before')    !== '0';
  const showReadiness = url.searchParams.get('readiness') !== '0';

  const html = renderOutreachEmail({
    businessName:   "Rosita's Taqueria",
    note:           "Hi — I noticed your site isn't mobile-friendly and takes a few seconds to load, which costs you walk-ins searching nearby. So I built a fast, modern preview for Rosita's to show what an upgrade looks like — menu, hours, and tap-to-call all front and center. Take a look and tell me what you think.\n\n— Bryan",
    thumbnailUrl:   'https://picsum.photos/seed/rosita-new/600/420',
    previewUrl:     'https://hitloop.agency',
    originalSiteUrl: showBefore ? 'https://example.com' : null,
    readinessBefore: showReadiness ? 41 : null,
    readinessAfter:  showReadiness ? 88 : null,
    theme:          {},
  });

  return new Response(html, {
    status:  200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
