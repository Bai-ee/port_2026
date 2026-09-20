// Realistic sample invoice in the "It's Raw Poke" grammar (see
// clients/BRIEF_TEMPLATE_PROMPT.md): POS + hosting categories with
// sub-items, a numeric standalone design fee, monthly/one-time/deposit
// totals, a recommendation with chips, and a how-it-works flow. Committed
// (rather than a throwaway script) so the fixture render stays reproducible.

export const SAMPLE_INVOICE = {
  invoiceNumber: 'INV-2026-0902-9F3K',
  status: 'sent',
  issueDate: '2026-09-02',
  dueDate: '2026-09-16',
  currency: 'USD',
  from: {
    name: 'Bryan Balli',
    email: 'bryanballi@gmail.com',
    phone: '(619) 555-0142',
    site: 'https://hitloop.agency',
    address: 'San Diego, CA',
  },
  billTo: {
    name: "It's Raw Poke",
    contact: 'Dana Cruz, Owner',
    email: 'dana@itsrawpoke.com',
    address: '4210 Voltaire St, San Diego, CA 92107',
  },
  projectTitle: 'Website Updates',
  projectSubtitle: 'w/ Online Ordering & Pickup',
  categories: [
    {
      id: 'pos',
      name: 'Point-of-Sale',
      items: [
        {
          id: 'square-restaurants',
          name: 'Square for Restaurants',
          costLabel: '$0-79/mo',
          subItems: [
            { name: 'Point of sale app', cost: 'Included' },
            { name: 'Online ordering', cost: 'Included' },
            { name: 'Kitchen app', cost: '$20-30/mo' },
          ],
        },
      ],
    },
    {
      id: 'hosting',
      name: 'Website Hosting',
      items: [
        {
          id: 'basic-square-site',
          name: 'Basic Square Website',
          costLabel: '$0-29/mo',
          subItems: [
            { name: 'Hosting', cost: 'Included' },
            { name: 'Remove Square branding', cost: '$29/mo' },
          ],
        },
      ],
    },
  ],
  standaloneItems: [
    {
      id: 'design-setup',
      name: 'Design + setup',
      note: 'One-time build: menu import, online ordering flow, and launch QA.',
      qty: 1,
      unitPrice: 4000,
    },
  ],
  totals: {
    monthlyLabel: 'Monthly Recurring',
    monthlyValue: '$20-109',
    oneTimeLabel: '1-Time Design + Set Up',
    oneTimeValue: '$4K',
    deposit: 1500,
    depositLabel: 'Deposit to begin',
  },
  recommendation: {
    name: 'Square for Restaurants POS + Basic Square Website',
    body: 'After looking at all four options, I think Square for Restaurants is a good fit for online ordering and pickup, with a Basic Square Website to get started.',
    chips: [
      'Customers order from the website',
      'Scheduled pickup times',
      'Orders can be changed / edited',
      '$0/mo to start',
      'No contract',
    ],
  },
  flowSteps: [
    { platform: 'Square Online', color: 'blue', label: 'Visits site', tech: 'itsrawpoke.square.site' },
    { platform: 'Square Online', color: 'blue', label: 'Picks food, time, pays', tech: 'Square Online (free)' },
    { platform: 'Square POS + KDS', color: 'purple', label: 'Order hits the shop', tech: 'iPad + kitchen tablet' },
    { platform: 'Customer', color: 'green', label: '"It\'s ready" text', tech: 'Auto SMS' },
  ],
  terms: [
    'Estimate is valid for 14 days.',
    '50% due to begin work, 50% due before launch.',
    'Monthly recurring fees are billed directly by Square, not Hitloop.',
  ],
  notes: 'Happy to walk through this on a call before you sign off.',
  payment: {
    method: 'Zelle or Venmo',
    instructions: 'Deposit due before work begins; balance due at launch.',
    link: 'https://venmo.com/bballi',
  },
  meta: {
    preparedBy: 'Bryan Balli',
  },
};

export default SAMPLE_INVOICE;
