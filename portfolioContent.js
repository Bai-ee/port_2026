export const workHistory = [
  {
    years: '2022 — Now',
    role: 'Founder & Consultant',
    company: 'Independent',
    type: 'Consulting',
    desc: 'Human-in-the-loop AI systems, interactive builds, and digital strategy for brands navigating AI adoption.',
  },
  {
    years: '2019 — 2022',
    role: 'Creative Technology Director',
    company: 'Studio Meridian',
    type: 'Full-time',
    desc: 'Led interactive experience development across web, installation, and emerging media for a boutique digital studio.',
  },
  {
    years: '2017 — 2019',
    role: 'Senior Interactive Producer',
    company: 'Carve Digital',
    type: 'Full-time',
    desc: 'Produced real-time data visualization and campaign microsites for Fortune 500 clients.',
  },
  {
    years: '2014 — 2017',
    role: 'Front-End Developer',
    company: 'Tactile Media',
    type: 'Full-time',
    desc: 'Built responsive marketing platforms and motion-rich interfaces for media and entertainment brands.',
  },
];

export const testimonials = [
  {
    quote: 'Bryan is a great design partner who works with you to understand and deliver your brand vision. He has a sharp eye for detail, thinks about the bigger picture, and elevates the overall brand experience.',
    name: 'Sam',
    title: 'Founder',
    company: 'Onward',
    featured: true,
  },
  {
    quote: 'Brings a rare combination of technical depth and design instinct. Moves fast without cutting corners.',
    name: 'Rashid A.',
    title: 'Creative Director',
    company: 'Hossy',
    featured: false,
  },
  {
    quote: 'Understood our AI workflow challenges before we finished explaining them. That is the human-in-the-loop difference.',
    name: 'Claire B.',
    title: 'Head of Product',
    company: 'Carduvy',
    featured: false,
  },
  {
    quote: 'Shipped our interactive campaign on time, on brand, and over expectations.',
    name: 'Marco T.',
    title: 'Marketing Lead',
    company: 'HEC',
    featured: false,
  },
];

export const benefits = [
  { index: '01', title: 'Builds that move as fast as the idea', tag: 'Speed' },
  { index: '02', title: 'One person accountable across design, code, and ship', tag: 'Accountability' },
  { index: '03', title: 'AI outputs reviewed before they touch your brand', tag: 'Quality Control' },
  { index: '04', title: 'Strategy that adjusts when the brief changes at 11pm', tag: 'Adaptability' },
  { index: '05', title: 'Technical execution that matches the vision in your head', tag: 'Precision' },
];

export const processSteps = [
  {
    step: '01',
    title: 'Text me your ideas',
    desc: 'Screenshots, rough sketches, a voice note. No polished brief needed.',
  },
  {
    step: '02',
    title: 'Get honest feedback on scope',
    desc: 'I respond with direct input: what is realistic, what I would cut, and roughly what it will take.',
  },
  {
    step: '03',
    title: 'Pick a structure and start',
    desc: 'Choose a package or set up something custom. First deliverable usually lands within a week.',
  },
];

export const plans = [
  { name: 'The Starter', price: '~$800', unit: '/project', desc: 'Single deliverable, audit, or strategy session.', badge: 'Standard rate', cta: 'Get Started' },
  { name: 'The Builder', price: '~$2,400', unit: '/project', desc: 'Multi-phase build with revision and handoff.', badge: 'Most popular', cta: 'Get Started' },
  { name: 'The Operator', price: '~$3,800', unit: '/mo', desc: 'Ongoing human-in-the-loop support, builds, and iteration cycles.', badge: 'Save vs. hourly', cta: 'Get Started' },
  { name: 'The Partner', price: 'Custom', unit: '', desc: 'Embedded collaboration across strategy, builds, and systems.', badge: 'Best value', cta: "Let's Talk" },
];

export const portfolioPages = [
  {
    id: 'work',
    navLabel: 'Work',
    eyebrow: 'Featured Work',
    title: 'Featured Work',
    summary: 'Interactive builds, launch systems, and campaign surfaces designed to move fast without losing craft.',
    previewImage: 'https://picsum.photos/seed/balli-work/900/1200',
  },
  {
    id: 'value',
    navLabel: 'Value',
    eyebrow: 'What You Get',
    title: 'What You Get With Me In The Loop',
    summary: 'A tighter feedback loop between design, implementation, and AI-assisted production quality.',
    previewImage: 'https://picsum.photos/seed/balli-value/900/1200',
  },
  {
    id: 'experience',
    navLabel: 'Experience',
    eyebrow: 'Background',
    title: 'Selected Experience',
    summary: 'A mix of consulting, creative technology leadership, and hands-on frontend execution.',
    previewImage: 'https://picsum.photos/seed/balli-experience/900/1200',
  },
  {
    id: 'clients',
    navLabel: 'Clients',
    eyebrow: 'Social Proof',
    title: 'What Clients Say',
    summary: 'Signals from teams that needed speed, taste, and technical judgment in the same room.',
    previewImage: 'https://picsum.photos/seed/balli-clients/900/1200',
  },
  {
    id: 'engage',
    navLabel: 'Engage',
    eyebrow: 'The Process',
    title: 'How To Engage',
    summary: 'Simple entry points, clear package options, and a direct line to scope the work honestly.',
    previewImage: 'https://picsum.photos/seed/balli-engage/900/1200',
  },
  {
    id: 'contact',
    navLabel: 'Contact',
    eyebrow: 'Get Started',
    title: 'Ready To Work Together?',
    summary: 'Book a call, send a text, or subscribe for updates on tools, builds, and human-AI collaboration.',
    previewImage: 'https://picsum.photos/seed/balli-contact/900/1200',
  },
];

export const portfolioPageMap = Object.fromEntries(
  portfolioPages.map((page) => [page.id, page])
);
