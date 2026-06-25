'use strict';

// seo-checklist.js — Reusable local-SEO checklist for the GBP Reputation card.
//
// Moved out of the Rosita's React page (SeoChecklist.jsx) into a client-agnostic
// module as the plan requires. Brand/site references are tokenized ({{brand}} /
// {{site}}) so any local business can reuse the same checklist definition.
//
// frequency ∈ 'once' | 'daily' | 'weekly' | 'monthly'

const GBP_SEO_CHECKLIST = [
  {
    id: 'website-foundations',
    title: 'Website Foundations',
    items: [
      { id: 'address-in-footer', label: 'Put your address in the footer of {{site}}', frequency: 'once' },
      { id: 'gbp-link-location-page', label: 'Link your GBP to your location page on {{site}}, not the home page', frequency: 'once' },
      { id: 'meta-title-keyword', label: 'Front-load your keyword in the meta title on {{site}}', frequency: 'once' },
      { id: 'h1-keyword-city', label: 'Your H1 tag on {{site}} should include your keyword and your city', frequency: 'once' },
      { id: 'descriptive-urls', label: 'Make {{site}} URLs descriptive — Google should know the topic from the slug', frequency: 'once' },
      { id: 'phone-above-fold', label: 'Your phone number should be visible on {{site}} without scrolling', frequency: 'once' },
      { id: 'site-indexed', label: "Make sure {{site}} is indexed — if Google can't find your pages, nothing else matters", frequency: 'weekly' },
    ],
  },
  {
    id: 'gbp-optimization',
    title: 'Google Business Profile',
    items: [
      { id: 'gbp-photo-weekly', label: 'Upload a new photo to your GBP every single week', frequency: 'weekly' },
      { id: 'respond-reviews-24h', label: 'Respond to every single review within 24 hours', frequency: 'daily' },
      { id: 'gbp-products', label: 'Fill out the product section on your GBP with your menu items or services', frequency: 'once' },
      { id: 'category-match-competitors', label: 'Make sure your GBP category matches the top 3 competitors ranking above you', frequency: 'monthly' },
      { id: 'gbp-updates-keyword-location', label: 'Include your keyword and location in every GBP update you post', frequency: 'weekly' },
      { id: 'ask-every-customer-review', label: 'Ask every single customer for a review — every single one', frequency: 'daily' },
    ],
  },
  {
    id: 'content-strategy',
    title: 'Content Strategy',
    items: [
      { id: 'stop-blog-posts', label: 'Stop writing generic blog posts on {{site}} — focus on service/location pages', frequency: 'once' },
      { id: 'target-service-city', label: 'Target "service + city" keywords on {{site}}, not "how to" keywords', frequency: 'once' },
      { id: 'no-duplicate-keyword-pages', label: 'Audit {{site}} — do not have two pages targeting the same keyword', frequency: 'once' },
    ],
  },
  {
    id: 'citations-links',
    title: 'Citations & Link Building',
    items: [
      { id: 'citation-yelp', label: 'Build citation on Yelp', frequency: 'once' },
      { id: 'citation-bbb', label: 'Build citation on BBB', frequency: 'once' },
      { id: 'citation-yellowpages', label: 'Build citation on YellowPages', frequency: 'once' },
      { id: 'citation-uber', label: 'Build citation on Uber / delivery platforms (if applicable)', frequency: 'once' },
      { id: 'citation-chamber', label: 'Get listed on your local Chamber of Commerce', frequency: 'once' },
      { id: 'bing-listing', label: 'Get listed on Bing — the LLMs are pulling from it', frequency: 'once' },
      { id: 'links-to-homepage', label: 'Build links to {{site}} homepage — 80-90% of links should go there', frequency: 'monthly' },
      { id: 'branded-anchor-text', label: 'Use "{{brand}}" as anchor text — branded anchors are safest and most effective', frequency: 'monthly' },
    ],
  },
  {
    id: 'maintenance',
    title: 'Weekly Maintenance',
    items: [
      { id: 'check-404-weekly', label: 'Check {{site}} for 404 errors weekly', frequency: 'weekly' },
    ],
  },
];

const ALL_ITEM_IDS = GBP_SEO_CHECKLIST.flatMap((c) => c.items.map((i) => i.id));
const CHECKLIST_TOTAL = ALL_ITEM_IDS.length;

function fillToken(label, { brand = 'your business', site = 'your website' } = {}) {
  return String(label).replace(/\{\{brand\}\}/g, brand).replace(/\{\{site\}\}/g, site);
}

/**
 * Resolve checklist completion + priority gaps for a client.
 * @param {string[]} completedIds  ids the client has finished
 * @param {object}   opts          { brand, site }
 * @returns { completed, total, priorityItems[] }
 *
 * priorityItems = highest-leverage incomplete items, daily/weekly first.
 */
function resolveChecklist(completedIds = [], opts = {}) {
  const done = new Set(completedIds);
  const freqRank = { daily: 0, weekly: 1, monthly: 2, once: 3 };
  const incomplete = GBP_SEO_CHECKLIST.flatMap((cat) =>
    cat.items
      .filter((i) => !done.has(i.id))
      .map((i) => ({ id: i.id, label: fillToken(i.label, opts), frequency: i.frequency, category: cat.title }))
  ).sort((a, b) => (freqRank[a.frequency] ?? 9) - (freqRank[b.frequency] ?? 9));

  return {
    completed: ALL_ITEM_IDS.filter((id) => done.has(id)).length,
    total: CHECKLIST_TOTAL,
    priorityItems: incomplete.slice(0, 4),
  };
}

module.exports = {
  GBP_SEO_CHECKLIST,
  CHECKLIST_TOTAL,
  ALL_ITEM_IDS,
  fillToken,
  resolveChecklist,
};
