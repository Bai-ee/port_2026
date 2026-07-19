// Creative Brief composer config — which elements the new-signup Creative
// Brief ('onboarding' composition) renders, and in what order. Backs the
// admin-bucket "Brief Composer" card (mirrors the Email Digest card's
// include-toggles + per-group order pattern).
//
// Stored globally (new signups have no per-client config yet) at
// system_flags/creative_brief_config: { include: {id: bool}, order: {group: [ids]} }.
// A missing/partial doc normalizes to today's exact output (all on, as-built
// order), so absence of config is always zero-risk.
//
// Consumed by app/api/dashboard/brief-preview/route.js (renderCreativeBriefSummary
// assembles keyed fragments per this config). ⚠️ CommonJS — the dashboard client
// must NOT import this file (same import.meta/Fast-Refresh trap as
// features/gbp-reputation); the admin route serializes the registry instead.

// Groups of elements. 'pages' orders the brief's body pages; each page's own
// elements group orders/gates the blocks inside that page; 'cover' gates the
// cover blocks (signature/package swap order inside the handoff row).
const CREATIVE_BRIEF_GROUPS = [
  {
    key: 'cover',
    label: 'Cover',
    items: [
      { id: 'cover-mockup', label: 'Device mockup (top-right)', desc: 'The multi-device homepage mockup pinned to the cover.' },
      { id: 'cover-signature', label: 'Your Human signature', desc: 'Signature + name/role block in the cover handoff row.' },
      { id: 'cover-deliverables', label: 'Deliverables Snapshot', desc: 'The "what you get" list with thumbnails + downloads.' },
    ],
  },
  {
    key: 'pages',
    label: 'Brief pages',
    items: [
      { id: 'intro-split', label: 'You’re Onboarded + Key Insight', desc: 'The intro split page directly below the cover.' },
      { id: 'featured-post', label: 'Featured Post + Deliverables', desc: 'Suggested Post as a real X card, deliverables grid beneath.' },
      { id: 'website-status', label: 'Your Website Status', desc: 'Site audit: what this site is, gaps, risk, opportunity, decision.' },
      { id: 'contact', label: 'Contact Your Human', desc: 'Closing page: contact CTA, signature, What We Offer services.' },
    ],
  },
  {
    key: 'intro-split',
    label: 'Intro page elements',
    items: [
      { id: 'onboarded-copy', label: 'You’re Onboarded copy', desc: 'The "Hit Loop starts by doing the work" welcome column.' },
      { id: 'key-insight', label: 'Key Insight', desc: 'The oversized headline verdict tile.' },
    ],
  },
  {
    key: 'featured-post',
    label: 'Featured Post elements',
    items: [
      { id: 'post-card', label: 'Featured Post card', desc: 'Suggested Post caption as an X post mock with video.' },
      { id: 'deliverables-grid', label: 'Deliverables grid', desc: 'Every render asset as a downloadable D01…D06 cell.' },
    ],
  },
  {
    key: 'website-status',
    label: 'Website Status elements',
    items: [
      { id: 'wtis-lead', label: 'What This Site Is', desc: 'The full-width lead read of the site.' },
      { id: 'social-share', label: 'Social Share', desc: 'Share-card preview + captured/missing social tag checklist.' },
      { id: 'whats-missing', label: 'What’s Missing', desc: 'Gap checklist.' },
      { id: 'biggest-risk', label: 'Biggest Risk', desc: 'Risk callout.' },
      { id: 'opportunity', label: 'The Opportunity', desc: 'Opportunity tiles + copy.' },
      { id: 'decision', label: 'The Decision', desc: 'Decision pull-quote + tags.' },
    ],
  },
  {
    key: 'contact',
    label: 'Contact page elements',
    items: [
      { id: 'contact-block', label: 'Contact CTA + signature', desc: 'Meet-with-a-Human / email actions and the signature block.' },
      { id: 'services', label: 'What We Offer', desc: 'The S01…S10 services grid.' },
    ],
  },
];

// ── Simple layout (v2) ────────────────────────────────────────────────────────
// The redesigned "hyper simple" brief. Separate id namespace (sb-) so classic
// toggles never collide, and a fresh install of this layout starts with ALL
// content on. Items with hasHeading also register an `<id>:heading` include
// (default on) so the section heading toggles independently of its content.
// defaultOff items start off (spec removals) but stay available to re-enable.
const SIMPLE_BRIEF_GROUPS = [
  {
    key: 'sb-header',
    label: 'Header (cover)',
    items: [
      { id: 'sb-header-cta', label: 'Meet with a Human CTA', desc: 'The pinned gradient CTA at the top of the brief.' },
      { id: 'sb-header-status', label: 'Onboarding complete status', desc: 'Small status label under the brief title.' },
      { id: 'sb-header-weather', label: 'Weather line', desc: 'Local weather strip above the title.' },
      { id: 'sb-header-mockup', label: 'Device mockup (top-right)', desc: 'The multi-device homepage mockup pinned to the cover.' },
      { id: 'sb-header-contact-card', label: 'Your Human contact card', desc: 'Bryan Balli, Creative Lead — with LinkedIn / X links.' },
      { id: 'sb-header-snapshot', label: 'Deliverables Snapshot list', desc: 'Cover list of assets (duplicates the Your Deliverables section).', defaultOff: true },
      { id: 'sb-header-meta', label: 'Meta row (date · site · title · account)', desc: 'The four-column metadata strip.', defaultOff: true },
      { id: 'sb-header-marquee', label: 'Brand letters marquee', desc: 'The oversized decorative brand letters.', defaultOff: true },
    ],
  },
  {
    key: 'sb-pages',
    label: 'Brief sections',
    items: [
      { id: 'sb-deliverables', label: 'Your Deliverables', desc: 'Compact rows: thumbnail · label · one-line description · download.', hasHeading: true },
      { id: 'sb-key-insight', label: 'Key Insight', desc: 'The single most important read of the site.', hasHeading: true },
      { id: 'sb-positioning', label: 'Current Positioning', desc: 'What the site is and who it serves.', hasHeading: true },
      { id: 'sb-decision', label: 'The Decision', desc: 'The main strategic question, visually distinct.', hasHeading: true },
      { id: 'sb-clarify', label: 'What to Clarify Next', desc: 'Numbered practical action list (distills Missing + Opportunity until the generator emits it directly).', hasHeading: true },
      { id: 'sb-missing', label: 'What’s Missing', desc: 'Numbered gap list. Overlaps Clarify Next — off by default.', hasHeading: true, defaultOff: true },
      { id: 'sb-opportunity', label: 'The Opportunity', desc: 'Opportunity copy + numbered points. Overlaps Clarify Next — off by default.', hasHeading: true, defaultOff: true },
      { id: 'sb-onboarded', label: 'You’re Onboarded copy', desc: 'The classic welcome/handoff paragraphs.', hasHeading: true, defaultOff: true },
      { id: 'sb-featured-post', label: 'Featured Post', desc: 'Suggested Post as a real X card with the brand video.', hasHeading: true },
      { id: 'sb-social-share', label: 'Social Share check', desc: 'Share-card preview + captured/missing tag checklist.', hasHeading: true },
      { id: 'sb-risk', label: 'Biggest Risk', desc: 'The risk callout from the analysis.', hasHeading: true },
      { id: 'sb-services', label: 'What We Offer', desc: 'The S01…S10 services grid.', hasHeading: true },
      { id: 'sb-contact', label: 'Contact Your Human', desc: 'Closing contact section with Meet with Bryan CTA.', hasHeading: true },
    ],
  },
  {
    key: 'sb-deliverables',
    label: 'Deliverable cards',
    items: [
      { id: 'sb-deliverables-intro', label: 'Supporting copy line', desc: '“Your site has been reviewed, captured, and prepared for sharing.”' },
      { id: 'sb-d-video', label: 'D · Brand Video', desc: 'Your site in motion.' },
      { id: 'sb-d-mockup', label: 'D · Device Mockup', desc: 'Homepage device mockup.' },
      { id: 'sb-d-desktop', label: 'D · Desktop View', desc: 'Full desktop capture.' },
      { id: 'sb-d-tablet', label: 'D · Tablet View', desc: 'Tablet capture.' },
      { id: 'sb-d-mobile', label: 'D · Mobile View', desc: 'Mobile capture.' },
      { id: 'sb-d-social', label: 'D · Social Preview', desc: 'Social sharing preview.' },
    ],
  },
  {
    key: 'sb-footer',
    label: 'Footer',
    items: [
      { id: 'sb-footer-line', label: 'Brief title line', desc: '“<CLIENT> Creative Brief · Vol. 01”.' },
      { id: 'sb-footer-generated', label: 'Generated date', desc: 'Short “Generated July 18, 2026” form (no long timestamp).' },
      { id: 'sb-footer-client-id', label: 'Client id', desc: 'Raw internal client id.', defaultOff: true },
    ],
  },
];

const CREATIVE_BRIEF_LAYOUTS = ['classic', 'simple'];
const ALL_GROUP_SETS = [CREATIVE_BRIEF_GROUPS, SIMPLE_BRIEF_GROUPS];

const CONFIG_DOC_PATH = { collection: 'system_flags', doc: 'creative_brief_config' };

function defaultCreativeBriefConfig() {
  const include = {};
  const order = {};
  for (const groups of ALL_GROUP_SETS) {
    for (const group of groups) {
      order[group.key] = group.items.map((i) => i.id);
      for (const item of group.items) {
        include[item.id] = !item.defaultOff;
        if (item.hasHeading) include[`${item.id}:heading`] = true;
      }
    }
  }
  return { layout: 'classic', include, order };
}

// Merge a raw stored doc onto defaults: unknown ids dropped, missing ids get
// their default (default position appended in registry order).
function normalizeCreativeBriefConfig(raw) {
  const def = defaultCreativeBriefConfig();
  const include = { ...def.include };
  const rawInclude = raw && typeof raw.include === 'object' ? raw.include : {};
  for (const id of Object.keys(include)) {
    if (typeof rawInclude[id] === 'boolean') include[id] = rawInclude[id];
  }
  const order = {};
  const rawOrder = raw && typeof raw.order === 'object' ? raw.order : {};
  for (const groups of ALL_GROUP_SETS) {
    for (const group of groups) {
      const defIds = def.order[group.key];
      const saved = Array.isArray(rawOrder[group.key]) ? rawOrder[group.key].filter((id) => defIds.includes(id)) : [];
      order[group.key] = [...saved, ...defIds.filter((id) => !saved.includes(id))];
    }
  }
  const layout = CREATIVE_BRIEF_LAYOUTS.includes(raw?.layout) ? raw.layout : def.layout;
  return { layout, include, order };
}

// Read + normalize the stored config. Any failure returns defaults so the
// brief always renders.
async function loadCreativeBriefConfig(adminDb) {
  try {
    const snap = await adminDb.collection(CONFIG_DOC_PATH.collection).doc(CONFIG_DOC_PATH.doc).get();
    return normalizeCreativeBriefConfig(snap.exists ? snap.data() : null);
  } catch {
    return defaultCreativeBriefConfig();
  }
}

module.exports = {
  CREATIVE_BRIEF_GROUPS,
  SIMPLE_BRIEF_GROUPS,
  CREATIVE_BRIEF_LAYOUTS,
  CONFIG_DOC_PATH,
  defaultCreativeBriefConfig,
  normalizeCreativeBriefConfig,
  loadCreativeBriefConfig,
};
