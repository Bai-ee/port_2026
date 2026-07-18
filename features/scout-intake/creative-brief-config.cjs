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

const CONFIG_DOC_PATH = { collection: 'system_flags', doc: 'creative_brief_config' };

function defaultCreativeBriefConfig() {
  const include = {};
  const order = {};
  for (const group of CREATIVE_BRIEF_GROUPS) {
    order[group.key] = group.items.map((i) => i.id);
    for (const item of group.items) include[item.id] = true;
  }
  return { include, order };
}

// Merge a raw stored doc onto defaults: unknown ids dropped, missing ids get
// their default (on, default position appended in registry order).
function normalizeCreativeBriefConfig(raw) {
  const def = defaultCreativeBriefConfig();
  const include = { ...def.include };
  const rawInclude = raw && typeof raw.include === 'object' ? raw.include : {};
  for (const id of Object.keys(include)) {
    if (typeof rawInclude[id] === 'boolean') include[id] = rawInclude[id];
  }
  const order = {};
  const rawOrder = raw && typeof raw.order === 'object' ? raw.order : {};
  for (const group of CREATIVE_BRIEF_GROUPS) {
    const defIds = def.order[group.key];
    const saved = Array.isArray(rawOrder[group.key]) ? rawOrder[group.key].filter((id) => defIds.includes(id)) : [];
    order[group.key] = [...saved, ...defIds.filter((id) => !saved.includes(id))];
  }
  return { include, order };
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
  CONFIG_DOC_PATH,
  defaultCreativeBriefConfig,
  normalizeCreativeBriefConfig,
  loadCreativeBriefConfig,
};
