// Exact-mirror render route: serves the ORIGINAL mirrored HTML with the
// current slot values injected. The theme ships byte-identical to the mirror
// — only tokenized text/images differ, and only when edited in /admin.
import fs from 'fs';
import path from 'path';
import { getPayload } from 'payload';
import config from '@payload-config';

export const dynamic = 'force-dynamic';

// process.cwd() = project root in `next dev` AND inside the Vercel lambda
// (with outputFileTracingIncludes shipping templates/ — see next.config.mjs).
// __dirname-relative paths break in the prod bundle.
const TEMPLATES_DIR = path.join(process.cwd(), 'templates');

const escapeHtml = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// Per-slot visual overrides → one inline style string (original theme style
// first, overrides after so they win).
function slotStyle(slot: any): string {
  const parts = [slot.baseStyle || ''];
  if (slot.hidden) parts.push('display:none !important');
  if (slot.kind === 'image') {
    if (slot.widthPx) parts.push(`width:${Number(slot.widthPx)}px`, 'height:auto');
    if (slot.fit && slot.fit !== 'default') parts.push(`object-fit:${slot.fit}`);
  } else {
    if (slot.fontSizePx) parts.push(`font-size:${Number(slot.fontSizePx)}px`);
    if (slot.textColor) parts.push(`color:${String(slot.textColor).replace(/[;{}]/g, '')}`);
    if (slot.bold) parts.push('font-weight:700');
  }
  if (slot.customCss) parts.push(String(slot.customCss).replace(/[{}<>]/g, ''));
  return parts.filter(Boolean).join(';');
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path: segs } = await params;
  const slug = !segs || !segs.length ? 'home' : segs.join('-').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();

  const payload = await getPayload({ config });
  const res = await payload.find({ collection: 'pages', where: { slug: { equals: slug } }, limit: 1, depth: 1 });
  const page = res.docs[0] as any;
  if (!page) return new Response('Not found', { status: 404 });

  const templatePath = path.join(TEMPLATES_DIR, page.sourceFile);
  if (!fs.existsSync(templatePath)) return new Response('Template missing', { status: 500 });
  let html = fs.readFileSync(templatePath, 'utf8');

  for (const slot of page.slots || []) {
    const mediaUrl = slot.kind === 'image' && slot.media && typeof slot.media === 'object' ? slot.media.url : null;
    const value = slot.kind === 'image'
      ? (mediaUrl || slot.value || '')
      : escapeHtml(slot.value || '');
    html = html.split(`{{slot:${slot.key}}}`).join(value);
    html = html.split(`{{slotstyle:${slot.key}}}`).join(escapeAttr(slotStyle(slot)));
    if (slot.kind === 'image') {
      // Replacement uploaded → disable the original responsive srcset so the
      // browser actually uses the new src. Untouched → original srcset back.
      // A width override also drops srcset — the browser would otherwise pick
      // a responsive variant and ignore the requested size.
      html = html.split(`{{slotset:${slot.key}}}`).join((mediaUrl || slot.widthPx) ? '' : (slot.srcset || ''));
    }
  }

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
