'use strict';

// clone-demo.cjs — HITLOOP-hosted live demo of a recreated site (Site
// Recreate card, Phase 5b). The exact-mirror overlay templates + slots are
// published INTO HITLOOP's own stores at build time:
//
//   clone_pages/{jobId}__{slug}   — Firestore: slug, title, sourceFile, slots[]
//   clients/{clientId}/site-clone/{jobId}/templates/<file>.html — Storage:
//     tokenized HTML with asset refs rewritten to the job's static Vercel
//     preview origin (so the demo needs no asset hosting of its own)
//
// `/sites/{jobId}/...` (app/sites route) renders template + current slot
// values per request — same substitution contract as the downloadable Payload
// project's render route. The card's inline content editor writes slot values
// back via `save-slots`; the demo updates on next load. This is the hosted
// demo/WYSIWYG path; the Payload zip remains the "own it" artifact.
//
// Firestore doc IDs are deterministic (`{jobId}__{slug}`) so reads are direct
// gets — no queries, no composite indexes (the listCloneJobs lesson).

const fb = require('./firebase-admin.cjs');
const { saveBufferArtifact } = require('./storage-artifacts.cjs');

const PAGES_COLLECTION = 'clone_pages';

const pageDocId = (jobId, slug) => `${jobId}__${slug}`;

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** Rewrite root-relative /assets/ refs inside HTML to the preview origin. */
function pointAssetsAt(html, previewOrigin) {
  const origin = String(previewOrigin || '').replace(/\/$/, '');
  if (!origin) return html;
  return html
    .split('"/assets/').join(`"${origin}/assets/`)
    .split("'/assets/").join(`'${origin}/assets/`)
    .split('(/assets/').join(`(${origin}/assets/`)
    .split(', /assets/').join(`, ${origin}/assets/`);
}

/** Rewrite a bare srcset string ("/assets/a.jpg 165w, /assets/b.jpg 360w"). */
function pointSrcsetAt(srcset, previewOrigin) {
  const origin = String(previewOrigin || '').replace(/\/$/, '');
  if (!origin) return srcset;
  return String(srcset).split(',').map((part) => {
    const [url, ...desc] = part.trim().split(/\s+/);
    return [url.startsWith('/assets/') ? `${origin}${url}` : url, ...desc].join(' ');
  }).join(', ');
}

/**
 * Publish a built overlay as a HITLOOP-hosted demo.
 *
 * @param {object} args
 * @param {string} args.jobId
 * @param {string} args.clientId
 * @param {Array<{slug,title,sourceFile,slots,html}>} args.pages tokenized pages (html included)
 * @param {string} args.previewOrigin static preview URL that serves /assets/*
 * @param {(line:string)=>void} [args.log]
 * @returns {Promise<{url:string, pageCount:number, slotCount:number}>}
 */
async function publishCloneDemo({ jobId, clientId, pages, previewOrigin, log = () => {} }) {
  if (!jobId || !clientId) throw new Error('publishCloneDemo: jobId and clientId are required.');
  if (!previewOrigin) throw new Error('publishCloneDemo: previewOrigin (static preview URL) is required — the demo serves assets from it.');

  // Internal links must stay inside the demo prefix — `/catering` would
  // otherwise resolve against the HITLOOP app itself.
  const base = `/sites/${jobId}`;
  const slugs = pages.map((p) => p.slug).filter((s) => s !== 'home');
  const rewriteLinks = (html) => {
    let out = html.split('href="/"').join(`href="${base}/"`);
    for (const slug of slugs) {
      out = out.split(`href="/${slug}"`).join(`href="${base}/${slug}"`);
    }
    return out;
  };

  let slotCount = 0;
  for (const pg of pages) {
    const storagePath = `clients/${clientId}/site-clone/${jobId}/templates/${pg.sourceFile}`;
    await saveBufferArtifact({
      storagePath,
      buffer: Buffer.from(rewriteLinks(pointAssetsAt(pg.html, previewOrigin)), 'utf8'),
      contentType: 'text/html; charset=utf-8',
      metadata: { jobId, clientId, slug: pg.slug },
    });
    await fb.adminDb.collection(PAGES_COLLECTION).doc(pageDocId(jobId, pg.slug)).set({
      jobId,
      clientId,
      slug: pg.slug,
      title: pg.title,
      sourceFile: pg.sourceFile,
      templatePath: storagePath,
      // Image slot values/srcsets are /assets/… paths — point them at the
      // preview origin too, or the demo's <img> tags 404 on the hitloop host.
      slots: pg.slots.map((s) => ({
        key: s.key,
        kind: s.kind,
        label: s.label || '',
        value: s.kind === 'image' && String(s.value || '').startsWith('/assets/')
          ? `${String(previewOrigin).replace(/\/$/, '')}${s.value}`
          : (s.value || ''),
        srcset: s.srcset ? pointSrcsetAt(s.srcset, previewOrigin) : '',
        baseStyle: pointAssetsAt(s.baseStyle || '', previewOrigin),
      })),
      updatedAt: new Date().toISOString(),
    });
    slotCount += pg.slots.length;
    log(`demo: published /${pg.slug === 'home' ? '' : pg.slug} (${pg.slots.length} slots)`);
  }
  // No trailing slash — Next 308-redirects `/sites/x/` to `/sites/x`.
  return { url: `/sites/${jobId}`, pageCount: pages.length, slotCount };
}

async function getClonePage(jobId, slug) {
  const snap = await fb.adminDb.collection(PAGES_COLLECTION).doc(pageDocId(jobId, slug)).get();
  return snap.exists ? snap.data() : null;
}

/** All pages of a demo — single equality filter, no composite index needed. */
async function listClonePages(jobId) {
  const snap = await fb.adminDb.collection(PAGES_COLLECTION).where('jobId', '==', jobId).limit(100).get();
  return snap.docs.map((d) => d.data()).sort((a, b) => (a.slug === 'home' ? -1 : b.slug === 'home' ? 1 : a.slug.localeCompare(b.slug)));
}

/**
 * Apply slot value edits from the card's content editor.
 * @param {string} jobId
 * @param {string} slug
 * @param {Array<{key:string, value:string}>} edits
 */
async function saveClonePageSlots({ jobId, slug, edits }) {
  const ref = fb.adminDb.collection(PAGES_COLLECTION).doc(pageDocId(jobId, slug));
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Demo page ${slug} not found for job ${jobId}.`);
  const byKey = new Map((edits || []).map((e) => [String(e.key), String(e.value ?? '')]));
  const slots = (snap.data().slots || []).map((s) => (byKey.has(s.key) ? { ...s, value: byKey.get(s.key) } : s));
  await ref.update({ slots, updatedAt: new Date().toISOString() });
  return { updated: byKey.size, slotCount: slots.length };
}

// Per-instance template cache — templates are immutable per publish, so a
// short TTL only exists to pick up re-publishes.
const templateCache = new Map(); // storagePath -> {html, at}
const TEMPLATE_TTL_MS = 60_000;

async function loadTemplate(storagePath) {
  const hit = templateCache.get(storagePath);
  if (hit && Date.now() - hit.at < TEMPLATE_TTL_MS) return hit.html;
  const [buf] = await fb.adminStorage.bucket().file(storagePath).download();
  const html = buf.toString('utf8');
  templateCache.set(storagePath, { html, at: Date.now() });
  return html;
}

/**
 * Render a demo page: template + current slot values. Returns null when the
 * page doesn't exist. Same substitution contract as the Payload project's
 * render route (text escaped; image src raw; srcset cleared when overridden —
 * the demo editor only edits values, so srcset always restores the original).
 */
async function renderClonePage(jobId, slug) {
  const page = await getClonePage(jobId, slug);
  if (!page) return null;
  let html = await loadTemplate(page.templatePath);
  for (const slot of page.slots || []) {
    const value = slot.kind === 'image' ? (slot.value || '') : escapeHtml(slot.value || '');
    html = html.split(`{{slot:${slot.key}}}`).join(value);
    // Style hook: original inline style back (templates created before the
    // style-token era simply have no {{slotstyle:…}} to replace — harmless).
    html = html.split(`{{slotstyle:${slot.key}}}`).join(
      String(slot.baseStyle || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    );
    if (slot.kind === 'image') {
      html = html.split(`{{slotset:${slot.key}}}`).join(slot.srcset || '');
    }
  }
  return html;
}

module.exports = {
  publishCloneDemo,
  getClonePage,
  listClonePages,
  saveClonePageSlots,
  renderClonePage,
};
