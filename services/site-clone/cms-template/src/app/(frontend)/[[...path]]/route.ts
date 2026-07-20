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
    if (slot.kind === 'image') {
      // Replacement uploaded → disable the original responsive srcset so the
      // browser actually uses the new src. Untouched → original srcset back.
      html = html.split(`{{slotset:${slot.key}}}`).join(mediaUrl ? '' : (slot.srcset || ''));
    }
  }

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
