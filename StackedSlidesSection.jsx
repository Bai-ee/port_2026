import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createSharedParticleGalleryRenderer } from './sharedParticleGalleryRenderer';
import { BrainIcon } from './components/ui/brain';
import {
  Bot,
  BriefcaseBusiness,
  ChartColumnIncreasing,
  FolderKanban,
  Globe,
  LaptopMinimalCheck,
  MessageSquareMore,
  Search,
  Settings2,
  ShieldCheck,
  Workflow,
  ArrowRightLeft,
  Lock,
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

const MOBILE_SCROLL_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';
const NARROW_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';

const isTouchScrollDevice = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(MOBILE_SCROLL_MEDIA_QUERY).matches;

const isNarrowTouchViewport = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(NARROW_SCROLL_MEDIA_QUERY).matches;

const agencyLogos = [
  { src: '/img/agencies/publicis.png', alt: 'Publicis', scale: 2 },
  { src: '/img/agencies/epsilon.png', alt: 'Epsilon' },
  { src: '/img/agencies/conversant.png', alt: 'Conversant' },
  { src: '/img/agencies/ANNTAYLOR.png', alt: 'Ann Taylor', scale: 0.67 },
  { src: '/img/agencies/GAP.png', alt: 'Gap', scale: 2 },
  { src: '/img/agencies/MAZDA.png', alt: 'Mazda' },
  { src: '/img/agencies/alliance.png', alt: 'Alliance Data' },
];

const testimonials = [
  {
    quote: 'Transforms ideas into polished, high-impact experiences. Strong across devices, highly responsive, and consistently delivers under pressure.',
    name: 'Melissa Hsiao',
    title: 'Industry Lead',
    company: 'TikTok',
    img: '/img/melissa.jpg',
  },
  {
    quote: 'Rare ability to operate across both design and development. Pixel-perfect execution with deep technical ownership across platforms.',
    name: 'Jeanne Cheung',
    title: 'Director, Design Management',
    company: 'HBO Max',
    img: '/img/jeanne.jpg',
  },
  {
    quote: 'Brings expert-level creative and technical thinking across platforms. Pushes concepts further and executes with precision.',
    name: 'Eric Farias',
    title: 'Senior Art Director',
    company: 'Epsilon',
    img: '/img/eric.jpg',
  },
  {
    quote: 'A go-to for complex creative builds across desktop, mobile, and video. Combines technical depth with strong design instincts.',
    name: 'Vanessa D\'Amore',
    title: 'Sr. Product Manager (AI, SaaS, Integrations)',
    company: 'TST',
    img: '/img/vanessa.jpg',
  },
  {
    quote: 'A knowledge hub for custom creative systems, able to design, build, and troubleshoot across evolving tech stacks and environments.',
    name: 'Vanessa D\'Amore',
    title: 'Sr. Product Manager (AI, SaaS, Integrations)',
    company: 'TST',
    img: '/img/vanessa.jpg',
  },
  {
    quote: 'Moves seamlessly between concept and execution across devices, bringing clarity, speed, and craftsmanship to complex builds.',
    name: 'Eric Farias',
    title: 'Senior Art Director',
    company: 'Epsilon',
    img: '/img/eric.jpg',
  },
];

const workHistory = [
  {
    years: '2022 - Now',
    role: 'Founder & Consultant',
    company: 'Independent',
    type: 'Consulting',
    desc: 'Human-in-the-loop AI systems, interactive builds, and digital strategy for brands navigating AI adoption.',
  },
  {
    years: '2019 - 2022',
    role: 'Creative Technology Director',
    company: 'Studio Meridian',
    type: 'Full-time',
    desc: 'Led interactive experience development across web, installation, and emerging media for a boutique digital studio.',
  },
  {
    years: '2017 - 2019',
    role: 'Senior Interactive Producer',
    company: 'Carve Digital',
    type: 'Full-time',
    desc: 'Produced real-time data visualization and campaign microsites for Fortune 500 clients.',
  },
  {
    years: '2014 - 2017',
    role: 'Front-End Developer',
    company: 'Tactile Media',
    type: 'Full-time',
    desc: 'Built responsive marketing platforms and motion-rich interfaces for media and entertainment brands.',
  },
];

const slides = [
  {
    title: 'Section 1',
    bg: '#f5f1df',
    fg: '#2a2420',
    layout: 'grid',
    headlineText: 'Digital Media Consultant',
    supportText: 'Chat with Bryan',
    gridItems: Array(17).fill(null).map((_, i) => ({ id: i })),
    serviceItems: [
      { id: 0, label: 'Product Development' },
      { id: 1, label: 'Agentic Automation' },
      { id: 2, label: 'Decentralized Ecosystems' },
    ],
  },
];

const getInitials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

const FILTERS = ['Design', 'Websites', 'Content', 'Video', 'AI Workflows'];

const FILTER_WORK_LABEL = {
  default: 'Selected Work',
};

const SHARED_SUPPORT = 'Turn your website or idea into a working dashboard so we can get up to speed fast, automate where it makes sense, and focus on high-quality, personalized work.';

const FILTER_COPY = {
  default: {
    headline: 'YOUR BUSINESS, MAPPED',
    support: SHARED_SUPPORT,
  },
  'Design': {
    headline: 'DESIGN',
    support: SHARED_SUPPORT,
  },
  'Websites': {
    headline: 'WEBSITES',
    support: SHARED_SUPPORT,
  },
  'Content': {
    headline: 'CONTENT',
    support: SHARED_SUPPORT,
  },
  'Video': {
    headline: 'VIDEO',
    support: SHARED_SUPPORT,
  },
  'AI Workflows': {
    headline: 'AI WORKFLOWS',
    support: SHARED_SUPPORT,
  },
};

const PORTFOLIO_IMAGES = [
  '/img/port/frame_3.png',
  '/img/port/frame_5.png',
  '/img/port/fast_poker_ui_1.png',
  '/img/port/frame_1.png',
  '/img/port/frame_7.png',
  '/img/port/claire.png',
  '/img/port/cq_figma.png',
  '/img/port/cq_guide.png',
  '/img/port/viva.png',
];

const CMO_TABLE_ROWS = [
  { task: 'Bryan Balli',             value: 'Custom requests' },
  { task: 'Cross-Device Mockups',    value: 'Full Page Screenshots' },
  { task: 'Social Preview Check',    value: 'OG Meta Data Review' },
  { task: 'Brand Snapshot',          value: 'Core Design Tokens' },
  { task: 'SEO + AI Visibility',     value: 'Searchability Score' },
  { task: 'Brand tone',              value: "How you're being perceived" },
  { task: 'Competitor info',         value: 'How you compare' },
  { task: 'Signals',                 value: 'Geo, events & social' },
  { task: 'Marketing',               value: 'Signal based strategies' },
  { task: 'Agentic automation',      value: 'Advanced systems' },
  { task: 'Founders Brief',          value: 'Downloadable summary' },
];

const AUTOMATION_CAPABILITIES = [
  {
    badge: 'YB',
    badgeColor: '#0ea5e9',
    icon: 'chart',
    tablePreview: true,
    previewVideo: '/vid/dashboard.mov',
    title: 'Everything Starts With a Shared Dashboard',
    body: 'Get a clear read on your brand, with instant insight into your SEO, competitors, and what to prioritize.',
  },
  {
    badge: 'BI',
    badgeColor: '#8b5cf6',
    icon: 'book',
    previewImage: '/img/port/frame_8.png',
    previewVideo: '/vid/Executive_support.mov',
    title: 'Brand Identity & Design',
    body: 'Logos, visual systems, and brand kits, built to hold up across every surface your business shows up on.',
  },
  {
    badge: 'WL',
    badgeColor: '#0ea5e9',
    icon: 'laptop',
    previewImage: '/img/port/cq_figma.png',
    previewVideo: '/vid/knowledge_assistant.mov',
    title: 'Websites & Landing Pages',
    body: 'Designed, built, and optimized to convert. Sites that perform on every screen, at every stage.',
  },
  {
    badge: 'SC',
    badgeColor: '#14b8a6',
    icon: 'workflow',
    previewImage: '/img/port/frame_5.png',
    previewVideo: '/vid/creative_pipeline.mov',
    title: 'Social Media & Content',
    body: 'Posts, captions, and content strategy aligned to how your brand sounds and what your audience wants.',
  },
  {
    badge: 'VM',
    badgeColor: '#10b981',
    icon: 'settings',
    previewImage: '/img/port/frame_6.png',
    previewVideo: '/vid/Daily_operations.mov',
    title: 'Video & Motion',
    body: 'Short-form content, reels, and visual storytelling crafted to get watched, saved, and shared.',
  },
  {
    badge: 'SEO',
    badgeColor: '#f97316',
    icon: 'search',
    previewImage: '/img/port/claire.png',
    previewVideo: '/vid/ai_research.mov',
    title: 'SEO & Content Strategy',
    body: 'Search visibility and structured content growth — the long game, built to compound over time.',
  },
  {
    badge: 'EM',
    badgeColor: '#ec4899',
    icon: 'arrow',
    previewImage: '/img/port/edittrax.png',
    previewVideo: '/vid/email_marketing.mov',
    title: 'Email & Newsletter Systems',
    body: 'Campaigns, automated flows, and newsletters built to keep your audience close and revenue moving.',
  },
  {
    badge: 'AI',
    badgeColor: '#6366f1',
    icon: 'brain',
    previewImage: '/img/port/cq_guide.png',
    previewVideo: '/vid/company_brain.mov',
    title: 'AI Automation & Workflows',
    body: 'Custom systems that remove manual work and scale output, built around how your business actually runs.',
  },
  // --- Multi-Agent Intelligence Pipeline cards (reserved for future use) ---
  // {
  //   badge: 'MAP',
  //   badgeColor: '#0ea5e9',
  //   icon: 'bot',
  //   previewImage: '/img/port/frame_3.png',
  //   previewVideo: '/vid/dashboard.mov',
  //   title: 'Multi-Agent Intelligence Pipeline',
  //   body: 'A four-stage agent architecture — Scout, Scribe, Guardian, Reporter — runs automatically each day, taking raw market data from five sources and producing a founder-ready content brief with zero manual input.',
  // },
  // {
  //   badge: 'HSA',
  //   badgeColor: '#14b8a6',
  //   icon: 'search',
  //   previewImage: '/img/port/frame_5.png',
  //   previewVideo: '/vid/ai_research.mov',
  //   title: 'Hyperlocal Signal Aggregation',
  //   body: 'Scout pulls live data from X/Twitter, Instagram, Reddit, customer reviews, and weather APIs, normalizes them into a unified intelligence format, and trims context to ~5K tokens before synthesis — optimized to under $0.10 per full run.',
  // },
  // {
  //   badge: 'PCG',
  //   badgeColor: '#ec4899',
  //   icon: 'workflow',
  //   previewImage: '/img/port/edittrax.png',
  //   previewVideo: '/vid/creative_pipeline.mov',
  //   title: 'Platform-Specific Content Generation',
  //   body: "Scribe reads the day's brief and produces ready-to-publish drafts for Instagram, X/Twitter, Facebook, and Discord — each formatted to platform conventions and constrained by brand voice rules defined in client knowledge files.",
  // },
  // {
  //   badge: 'BSG',
  //   badgeColor: '#ef4444',
  //   icon: 'shield',
  //   previewImage: '/img/port/frame_4.png',
  //   previewVideo: '/vid/compliance.mov',
  //   title: 'Brand Safety & Quality Gate',
  //   body: 'Guardian runs four sequential validation checks on every piece of generated content: restricted term scanning, competitor mention detection, factual accuracy, and brand voice scoring — outputting a readiness verdict and 0–100 quality score before anything moves forward.',
  // },
  // {
  //   badge: 'FDB',
  //   badgeColor: '#f59e0b',
  //   icon: 'chart',
  //   previewImage: '/img/port/frame_7.png',
  //   previewVideo: '/vid/dashboard.mov',
  //   title: 'Founder-Facing Daily Brief',
  //   body: "Reporter transforms the day's intelligence, content drafts, and QA results into a formatted HTML briefing — with operational context, review insights, Reddit signals, competitor activity, and content opportunities — delivered to the admin dashboard on schedule.",
  // },
  // {
  //   badge: 'ADB',
  //   badgeColor: '#6366f1',
  //   icon: 'laptop',
  //   previewImage: '/img/port/critters_game1.png',
  //   previewVideo: '/vid/dashboard.mov',
  //   title: 'Admin Dashboard & Brief History',
  //   body: 'A real-time web dashboard surfaces the latest pipeline run: priority action, weather impact, content angle, Guardian verdict, and cost per run. A full archive of past runs lets the team compare briefs, track signal trends, and trigger fresh runs on demand.',
  // },
  // {
  //   badge: 'IGA',
  //   badgeColor: '#a855f7',
  //   icon: 'folder',
  //   previewImage: '/img/port/fast_poker_style.png',
  //   previewVideo: '/vid/creative_pipeline.mov',
  //   title: 'Image Generation & Asset Management',
  //   body: 'A canvas-based generator handles post image production — with configurable presets, logo placement controls, and live preview. Completed renders upload to Firebase Storage and attach automatically to the current brief run.',
  // },
  // {
  //   badge: 'KFC',
  //   badgeColor: '#10b981',
  //   icon: 'book',
  //   previewImage: '/img/port/frame_8.png',
  //   previewVideo: '/vid/company_brain.mov',
  //   title: 'Knowledge-File Client Configuration',
  //   body: 'The entire system adapts to a new client by swapping four JSON files: brand voice rules, intelligence config, business facts, and a restricted-terms glossary. No code changes required to onboard a new brand or vertical.',
  // },
];

const AUTOMATION_ICON_COMPONENTS = {
  arrow: ArrowRightLeft,
  book: BriefcaseBusiness,
  bot: Bot,
  brain: BrainIcon,
  chart: ChartColumnIncreasing,
  folder: FolderKanban,
  laptop: LaptopMinimalCheck,
  message: MessageSquareMore,
  search: Search,
  settings: Settings2,
  shield: ShieldCheck,
  workflow: Workflow,
};

const PARTICLE_DEFAULTS = {
  scale: 60,
  particleCount: 3000,
  particleSize: 1,
  speedMult: 0.5,
  animationSpeed: 6,
  hueSpeed: 0.15,
  waveAmplitude: 6,
  chaos: 0,
  saturation: 1,
  lightness: 1,
};

const PARTICLE_SLIDERS = [
  { key: 'scale',          label: 'Scale',        min: 5,     max: 60,   step: 1     },
  { key: 'particleCount',  label: 'Count',        min: 100,   max: 3000, step: 50    },
  { key: 'particleSize',   label: 'Size',         min: 0.02,  max: 1.0,  step: 0.01  },
  { key: 'speedMult',      label: 'Speed',        min: 0.01,  max: 0.5,  step: 0.005 },
  { key: 'animationSpeed', label: 'Anim Speed',   min: 0.1,   max: 6.0,  step: 0.1   },
  { key: 'hueSpeed',       label: 'Hue Speed',    min: 0.001, max: 0.15, step: 0.001 },
  { key: 'waveAmplitude',  label: 'Wave',         min: 0.0,   max: 6.0,  step: 0.1   },
  { key: 'chaos',          label: 'Chaos',        min: 0.0,   max: 5.0,  step: 0.05  },
  { key: 'saturation',     label: 'Saturation',   min: 0.0,   max: 1.0,  step: 0.01  },
  { key: 'lightness',      label: 'Lightness',    min: 0.1,   max: 1.0,  step: 0.01  },
];

const PRESET_KINDS = ['torus', 'vortex', 'lattice', 'sphere', 'ribbon', 'orbits', 'cloud', 'helix'];

// ── Homepage URL helpers ──────────────────────────────────────────────────────

function normalizeHomepageUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidHomepageUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  try {
    const url = new URL(normalizeHomepageUrl(trimmed));
    return url.hostname.includes('.') && url.hostname.length > 3;
  } catch {
    return false;
  }
}

const StackedSlidesSection = () => {
  const wrapperRef = useRef(null);
  const servicesViewportRef = useRef(null);
  const servicesCanvasRef = useRef(null);
  const stickyCTARef = useRef(null);
  const marqueeShellRef = useRef(null);
  const marqueeTrackRef = useRef(null);
  const marqueeSetRef = useRef(null);
  const agentMarqueeShellRef = useRef(null);
  const agentMarqueeTrackRef = useRef(null);
  const agentMarqueeSetRef = useRef(null);
  const [pokerHovered, setPokerHovered] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);
  const [filterCopy, setFilterCopy] = useState(FILTER_COPY.default);
  const [particleParams, setParticleParams] = useState(PARTICLE_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeMobileCapability, setActiveMobileCapability] = useState(null);
  const [homepageUrl, setHomepageUrl] = useState('');
  const [urlIsValid, setUrlIsValid] = useState(false);
  const router = useRouter();

  const handleHomepageUrlChange = (e) => {
    const val = e.target.value;
    setHomepageUrl(val);
    setUrlIsValid(isValidHomepageUrl(val));
  };

  const handleCreateDashboard = () => {
    if (!urlIsValid) return;
    const normalized = normalizeHomepageUrl(homepageUrl);
    const params = new URLSearchParams({ flow: 'homepage-create', url: normalized });
    router.push(`/login?${params.toString()}`);
  };

  // Three.js particle renderer for service thumbnails
  useEffect(() => {
    const viewport = servicesViewportRef.current;
    const canvas = servicesCanvasRef.current;
    if (!viewport || !canvas) return;

    const particleRenderer = createSharedParticleGalleryRenderer({
      canvas,
      container: viewport,
      getWindows: () => Array.from(viewport.querySelectorAll('[data-particle-window]')),
      params: particleParams,
    });

    let frameId = 0;
    let isLoopActive = false;
    let isVisible = false;

    const renderFrame = (time) => {
      if (!isLoopActive) return;
      particleRenderer.render(time * 0.001);
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const stopRenderLoop = () => {
      isLoopActive = false;
      if (frameId) { window.cancelAnimationFrame(frameId); frameId = 0; }
    };

    const startRenderLoop = () => {
      if (isLoopActive || !isVisible || document.hidden) return;
      isLoopActive = true;
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) { startRenderLoop(); return; }
        stopRenderLoop();
      },
      { root: null, threshold: 0, rootMargin: '100px 0px' }
    );

    const handleDocumentVisibility = () => {
      if (document.hidden) { stopRenderLoop(); return; }
      startRenderLoop();
    };

    // Pause WebGL loop while the user is actively scrolling on mobile
    // to prevent GPU contention and reduce scroll stutter.
    const onScrollStart = () => stopRenderLoop();
    const onScrollEnd = () => { if (isVisible && !document.hidden) startRenderLoop(); };
    ScrollTrigger.addEventListener('scrollStart', onScrollStart);
    ScrollTrigger.addEventListener('scrollEnd', onScrollEnd);

    document.addEventListener('visibilitychange', handleDocumentVisibility);
    visibilityObserver.observe(viewport);

    return () => {
      stopRenderLoop();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', handleDocumentVisibility);
      ScrollTrigger.removeEventListener('scrollStart', onScrollStart);
      ScrollTrigger.removeEventListener('scrollEnd', onScrollEnd);
      particleRenderer.dispose();
    };
  }, [particleParams]);

  useEffect(() => {
    if (!isTouchScrollDevice() || activeMobileCapability === null) return undefined;

    const closePreview = () => setActiveMobileCapability(null);
    const handlePointerDown = (event) => {
      if (!event.target.closest('[data-capability-card]')) {
        closePreview();
      }
    };

    window.addEventListener('scroll', closePreview, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown, true);

    return () => {
      window.removeEventListener('scroll', closePreview);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [activeMobileCapability]);

  useEffect(() => {
    const shell = marqueeShellRef.current;
    const track = marqueeTrackRef.current;
    const set = marqueeSetRef.current;
    if (!shell || !track || !set) return;

    let itemWidth = 0;
    let offset = 0;
    let frameId = 0;
    let measureFrameId = 0;
    let lastTime = 0;
    let isVisible = false;

    const applyTransform = () => {
      track.style.transform = `translate3d(${offset}px, 0, 0)`;
    };

    const measure = () => {
      itemWidth = set.getBoundingClientRect().width;
      if (!itemWidth) return;

      offset = itemWidth ? -((Math.abs(offset) % itemWidth)) : 0;
      applyTransform();
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrameId);
      measureFrameId = requestAnimationFrame(measure);
    };

    const stop = () => {
      if (!frameId) return;
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    };

    const tick = (time) => {
      if (!isVisible || document.hidden || !itemWidth) {
        stop();
        return;
      }

      if (!lastTime) {
        lastTime = time;
      }

      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      offset -= delta * (isTouchScrollDevice() ? 28 : 42);

      if (offset <= -itemWidth) {
        offset += itemWidth;
      }

      applyTransform();
      frameId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frameId || document.hidden || !isVisible || !itemWidth) return;
      lastTime = 0;
      frameId = requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }

      start();
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;

        if (isVisible) {
          start();
          return;
        }

        stop();
      },
      { root: null, threshold: 0, rootMargin: '120px 0px' }
    );

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null;

    const images = Array.from(set.querySelectorAll('img'));
    const onImageLoad = () => scheduleMeasure();

    images.forEach((image) => {
      if (!image.complete) {
        image.addEventListener('load', onImageLoad);
      }
    });

    resizeObserver?.observe(shell);
    resizeObserver?.observe(set);
    intersectionObserver.observe(shell);
    document.addEventListener('visibilitychange', handleVisibility);
    scheduleMeasure();

    return () => {
      stop();
      cancelAnimationFrame(measureFrameId);
      resizeObserver?.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      images.forEach((image) => image.removeEventListener('load', onImageLoad));
    };
  }, []);

  useEffect(() => {
    const shell = agentMarqueeShellRef.current;
    const track = agentMarqueeTrackRef.current;
    const set = agentMarqueeSetRef.current;
    if (!shell || !track || !set) return;

    let itemWidth = 0;
    let offset = 0;
    let frameId = 0;
    let measureFrameId = 0;
    let lastTime = 0;
    let isVisible = false;

    const applyTransform = () => {
      track.style.transform = `translate3d(${offset}px, 0, 0)`;
    };

    const measure = () => {
      itemWidth = set.getBoundingClientRect().width;
      if (!itemWidth) return;
      offset = itemWidth ? -((Math.abs(offset) % itemWidth)) : 0;
      applyTransform();
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrameId);
      measureFrameId = requestAnimationFrame(measure);
    };

    const stop = () => {
      if (!frameId) return;
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    };

    const tick = (time) => {
      if (!isVisible || document.hidden || !itemWidth) { stop(); return; }
      if (!lastTime) lastTime = time;
      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      offset -= delta * (isTouchScrollDevice() ? 28 : 42);
      if (offset <= -itemWidth) offset += itemWidth;
      applyTransform();
      frameId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frameId || document.hidden || !isVisible || !itemWidth) return;
      lastTime = 0;
      frameId = requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (document.hidden) { stop(); return; }
      start();
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) { start(); return; }
        stop();
      },
      { root: null, threshold: 0, rootMargin: '120px 0px' }
    );

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null;

    resizeObserver?.observe(shell);
    resizeObserver?.observe(set);
    intersectionObserver.observe(shell);
    document.addEventListener('visibilitychange', handleVisibility);
    scheduleMeasure();

    return () => {
      stop();
      cancelAnimationFrame(measureFrameId);
      resizeObserver?.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    const wrapper = wrapperRef.current;
    const isTouchPointer = isTouchScrollDevice() ||
      (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches);

    // Hover reveal list effect — images appended to body to escape transformed ancestor
    const hoverContainers = Array.from(wrapper.querySelectorAll('[data-hover-item]'));
    const hoverCleanups = [];

    hoverContainers.forEach((container) => {
      if (isTouchPointer) return;
      const videoSrc = container.getAttribute('data-hover-video-src');
      const src = container.querySelector('[data-hover-image]')?.src;
      const hasPlaceholder = Boolean(container.querySelector('[data-hover-placeholder]'));
      const isTablePreview = container.hasAttribute('data-hover-table');
      if (!videoSrc && !src && !hasPlaceholder && !isTablePreview) return;
      const preferredSide = container.getAttribute('data-hover-side') || 'left';

      const useNativeRatio = container.hasAttribute('data-hover-native-ratio');

      let image;
      if (videoSrc) {
        image = document.createElement('video');
        image.src = videoSrc;
        image.muted = true;
        image.loop = true;
        image.playsInline = true;
        image.preload = 'metadata';
        if (useNativeRatio) {
          image.addEventListener('loadedmetadata', () => {
            if (image.videoWidth && image.videoHeight) {
              image.style.aspectRatio = `${image.videoWidth} / ${image.videoHeight}`;
            }
          }, { once: true });
        }
      } else if (isTablePreview) {
        image = document.createElement('div');
        image.innerHTML = `
          <div style="padding:1.1rem;font-family:'Space Grotesk',system-ui,sans-serif;height:100%;box-sizing:border-box;display:flex;flex-direction:column;">
            <p style="margin:0 0 0.7rem;font-size:0.6rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(42,36,32,0.4);font-family:'Space Mono',monospace;">Your Business, Mapped</p>
            <table style="width:100%;border-collapse:collapse;font-size:0.78rem;flex:1;">
              <thead><tr style="border-bottom:1.5px solid rgba(42,36,32,0.15);">
                <th style="text-align:left;padding:0.3rem 0.4rem;font-weight:600;color:rgba(42,36,32,0.4);font-size:0.58rem;text-transform:uppercase;letter-spacing:0.06em;">What you Get</th>
                <th style="width:1.2rem;"></th>
                <th style="text-align:right;padding:0.3rem 0.4rem;font-weight:600;color:rgba(42,36,32,0.4);font-size:0.58rem;text-transform:uppercase;letter-spacing:0.06em;">What this means</th>
              </tr></thead>
              <tbody>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Bryan Balli</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Custom requests</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Style guide</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Cross-device visual audit</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Brand tone</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">How you&apos;re being perceived</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">SEO score</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Performance &amp; AI readiness</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Competitor info</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">How you compare</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Signals</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Geo, events &amp; social</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Marketing</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Signal based strategies</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Agentic automation</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Advanced systems</td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Brand brief</td><td style="padding:0.38rem 0.2rem;color:rgba(42,36,32,0.3);font-size:0.7rem;text-align:center;">→</td><td style="padding:0.38rem 0.4rem;text-align:right;color:rgba(42,36,32,0.65);font-weight:400;">Downloadable summary</td></tr>
              </tbody>
            </table>
          </div>`;
      } else if (src) {
        image = document.createElement('img');
        image.src = src;
      } else {
        image = document.createElement('div');
      }
      Object.assign(image.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: 'clamp(240px, 26vw, 420px)',
        aspectRatio: '16 / 9',
        zIndex: '9999',
        opacity: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        borderRadius: '1.25rem',
        boxShadow: '0 24px 80px rgba(0,0,0,0.42)',
      });
      if (videoSrc || src) {
        Object.assign(image.style, {
          objectFit: 'cover',
        });
      } else if (isTablePreview) {
        Object.assign(image.style, {
          background: '#f5f1df',
          border: '1px solid rgba(42, 36, 32, 0.12)',
          overflow: 'hidden',
        });
      } else {
        Object.assign(image.style, {
          background: 'rgba(255,255,255,0.94)',
          border: '1px solid rgba(42, 36, 32, 0.12)',
        });
      }
      document.body.appendChild(image);

      gsap.set(image, {
        xPercent: 0,
        yPercent: 0,
        autoAlpha: 0,
      });

      let firstEnter = false;
      const setX = gsap.quickTo(image, 'x', { duration: 0.4, ease: 'power3' });
      const setY = gsap.quickTo(image, 'y', { duration: 0.4, ease: 'power3' });

      const align = (point) => {
        const imageRect = image.getBoundingClientRect();
        const imageWidth = imageRect.width || Math.min(window.innerWidth * 0.26, 420);
        const imageHeight = imageRect.height || (imageWidth * 9) / 16;
        const cursorOffset = 20;
        const minX = 12;
        const minY = 12;
        const maxX = window.innerWidth - imageWidth - 12;
        const maxY = window.innerHeight - imageHeight - 12;
        const targetX = preferredSide === 'right'
          ? Math.min(Math.max(point.clientX + cursorOffset, minX), maxX)
          : Math.min(Math.max(point.clientX - imageWidth - cursorOffset, minX), maxX);
        const targetY = Math.min(Math.max(point.clientY - imageHeight - cursorOffset, minY), maxY);

        if (firstEnter) {
          setX(targetX, targetX);
          setY(targetY, targetY);
          firstEnter = false;
          return;
        }
        setX(targetX);
        setY(targetY);
      };

      const startFollow = () => document.addEventListener('mousemove', align);
      const stopFollow = () => document.removeEventListener('mousemove', align);

      const fade = gsap.to(image, {
        autoAlpha: 1,
        ease: 'none',
        paused: true,
        duration: 0.12,
        onReverseComplete: stopFollow,
      });

      const onEnter = (event) => {
        firstEnter = true;
        fade.play();
        startFollow();
        align(event);
        if (videoSrc) image.play().catch(() => {});
      };

      const onLeave = () => {
        fade.reverse();
        if (videoSrc) image.pause();
      };
      container.addEventListener('mouseenter', onEnter);
      container.addEventListener('mouseleave', onLeave);

      hoverCleanups.push(() => {
        container.removeEventListener('mouseenter', onEnter);
        container.removeEventListener('mouseleave', onLeave);
        stopFollow();
        fade.kill();
        if (videoSrc && image.tagName === 'VIDEO') image.pause();
        document.body.removeChild(image);
      });
    });

    // Calendly embed
    const calScript = document.createElement('script');
    calScript.type = 'text/javascript';
    calScript.src = 'https://assets.calendly.com/assets/external/widget.js';
    calScript.async = true;
    document.body.appendChild(calScript);

    return () => {
      hoverCleanups.forEach((cleanup) => cleanup());
      if (document.body.contains(calScript)) document.body.removeChild(calScript);
    };
  }, []);

  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (isNarrowTouchViewport()) return;

    const isTouch = isTouchScrollDevice();
    const wrapper = wrapperRef.current;

    const ctx = gsap.context(() => {
      const cardOffset = isTouch ? 18 : 26;
      const blockOffset = isTouch ? 24 : 34;
      const featuredHeader = wrapper.querySelector('[data-featured-work-label]');
      const gridCards = gsap.utils
        .toArray('#stacked-grid-row > *', wrapper)
        .filter((card) => card.getBoundingClientRect().top > window.innerHeight * 0.82);
      const revealBlocks = gsap.utils
        .toArray('[data-grid-window], #stacked-inline-footer, #inline-footer-value-block, #agency-marquee-shell, #inline-footer-bottom, #panel-additional-content-header', wrapper)
        .filter((block, index, all) => all.indexOf(block) === index);

      if (gridCards.length) {
        gsap.set(gridCards, { autoAlpha: 0, y: cardOffset, willChange: 'transform, opacity' });

        ScrollTrigger.batch(gridCards, {
          start: 'top 92%',
          end: 'bottom 64%',
          onEnter: (batch) => {
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              duration: isTouch ? 0.45 : 0.65,
              ease: 'power2.out',
              stagger: isTouch ? 0.045 : 0.07,
              overwrite: true,
            });
          },
          onLeaveBack: (batch) => {
            gsap.to(batch, {
              autoAlpha: 0,
              y: cardOffset,
              duration: 0.24,
              ease: 'power1.out',
              stagger: 0.03,
              overwrite: true,
            });
          },
        });
      }

      if (featuredHeader) {
        gsap.fromTo(
          featuredHeader,
          { autoAlpha: 0, y: blockOffset },
          {
            autoAlpha: 1,
            y: 0,
            duration: isTouch ? 0.45 : 0.65,
            ease: 'power2.out',
            overwrite: true,
            scrollTrigger: {
              trigger: featuredHeader,
              start: 'top 90%',
              toggleActions: 'play none none reverse',
              invalidateOnRefresh: true,
            },
          }
        );
      }

      revealBlocks.forEach((block) => {
        gsap.fromTo(
          block,
          { y: blockOffset, autoAlpha: 0.001 },
          {
            y: 0,
            autoAlpha: 1,
            duration: isTouch ? 0.45 : 0.65,
            ease: 'power2.out',
            overwrite: true,
            scrollTrigger: {
              trigger: block,
              start: 'top 94%',
              toggleActions: 'play none none reverse',
              invalidateOnRefresh: true,
            },
          }
        );
      });
    }, wrapper);

    return () => ctx.revert();
  }, []);

  // Capability section — header + cards fade up on scroll, runs on all devices
  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const wrapper = wrapperRef.current;
    const isTouch = isTouchScrollDevice();
    const offset = isTouch ? 18 : 26;

    const ctx = gsap.context(() => {
      const header = wrapper.querySelector('[data-capability-header]');
      const cards = gsap.utils.toArray('[data-capability-card]', wrapper);

      if (header) {
        gsap.set(header, { autoAlpha: 0, y: offset });
        gsap.to(header, {
          autoAlpha: 1,
          y: 0,
          duration: isTouch ? 0.45 : 0.65,
          ease: 'power2.out',
          overwrite: true,
          scrollTrigger: {
            trigger: header,
            start: 'top 90%',
            toggleActions: 'play none none reverse',
            invalidateOnRefresh: true,
          },
        });
      }

      if (!cards.length) return;

      gsap.set(cards, { autoAlpha: 0, y: offset, willChange: 'transform, opacity' });

      ScrollTrigger.batch(cards, {
        start: 'top 92%',
        onEnter: (batch) =>
          gsap.to(batch, {
            autoAlpha: 1,
            y: 0,
            duration: isTouch ? 0.45 : 0.6,
            ease: 'power2.out',
            stagger: isTouch ? 0.05 : 0.08,
            overwrite: true,
          }),
        onLeaveBack: (batch) =>
          gsap.to(batch, {
            autoAlpha: 0,
            y: offset,
            duration: 0.22,
            ease: 'power1.out',
            stagger: 0.03,
            overwrite: true,
          }),
      });
    }, wrapper);

    return () => ctx.revert();
  }, []);

  // Sticky CTA — appears just before #panel-hero-cta passes the nav,
  // disappears once #footer-cta scrolls into view.
  useLayoutEffect(() => {
    const sticky = stickyCTARef.current;
    if (!sticky) return;

    gsap.set(sticky, { autoAlpha: 0, pointerEvents: 'none' });

    const ctaST = ScrollTrigger.create({
      trigger: '#panel-hero-cta',
      start: 'bottom 72px',
      endTrigger: '#footer-cta',
      end: 'top bottom',
      onEnter: () => gsap.to(sticky, { autoAlpha: 1, pointerEvents: 'auto', duration: 0.22, ease: 'power2.out' }),
      onLeaveBack: () => gsap.to(sticky, { autoAlpha: 0, pointerEvents: 'none', duration: 0.18, ease: 'power2.in' }),
      onLeave: () => gsap.to(sticky, { autoAlpha: 0, pointerEvents: 'none', duration: 0.18, ease: 'power2.in' }),
      onEnterBack: () => gsap.to(sticky, { autoAlpha: 1, pointerEvents: 'auto', duration: 0.22, ease: 'power2.out' }),
    });

    return () => ctaST.kill();
  }, []);

  return (
    <section style={sectionStyle}>
      <style>{`
        :root {
          --font-grotesk: 'Space Grotesk', system-ui, sans-serif;
          --font-mono: 'Space Mono', monospace;
          --font-doto: 'Doto', monospace;
        }
        .font-doto {
          font-family: 'Doto', monospace;
        }
        /* Hide scroll-animated elements before GSAP ScrollTrigger initializes to prevent FOUC */
        [data-capability-header],
        [data-capability-card],
        [data-grid-window],
        #stacked-inline-footer,
        #inline-footer-value-block,
        #agency-marquee-shell,
        #inline-footer-bottom,
        #panel-additional-content-header {
          opacity: 0;
          visibility: hidden;
        }
        /* Narrow / touch viewports skip the GSAP ScrollTrigger reveal entirely
           (see isNarrowTouchViewport early-return), so force these elements
           visible on mobile or they stay hidden forever. Also unhide when the
           user prefers reduced motion. */
        @media (max-width: 767px), (prefers-reduced-motion: reduce) {
          [data-capability-header],
          [data-capability-card],
          [data-grid-window],
          #stacked-inline-footer,
          #inline-footer-value-block,
          #agency-marquee-shell,
          #inline-footer-bottom,
          #panel-additional-content-header {
            opacity: 1 !important;
            visibility: visible !important;
            transform: none !important;
          }
        }
        @media (max-width: 767px) {
          #stacked-grid-row {
            grid-template-columns: 1fr !important;
          }
          #stacked-grid-row > * {
            height: 250px !important;
            aspect-ratio: unset !important;
          }
          #testimonials-grid article {
            aspect-ratio: unset !important;
            height: auto !important;
            flex-direction: column !important;
          }
          [data-service-item] {
            height: auto !important;
          }
          [data-service-item] > div {
            aspect-ratio: 16 / 9 !important;
            flex: none !important;
          }
        }
        .section-header-block {
          cursor: default;
          transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .section-header-block:hover {
          opacity: 0.65;
        }
        .deliverables-toggle:hover {
          opacity: 0.7;
        }
        #inline-footer-bullet-list li:last-child {
          padding-bottom: 0 !important;
        }
        @media (max-width: 767px) {
          [data-label-heading] {
            color: #000000 !important;
          }
          [data-capability-grid] > div:last-child {
            grid-template-columns: 1fr !important;
          }
          [data-filter-dropdown] {
            justify-content: center;
          }
          #panel-hero-text-row {
            grid-template-columns: 1fr !important;
            gap: clamp(0.5rem, 2vw, 0.75rem) !important;
          }
          #panel-hero-headline-col {
            width: 100% !important;
            align-items: center !important;
          }
          #panel-hero-headline {
            display: none !important;
          }
          #panel-hero-cta,
          #footer-cta {
            width: 100% !important;
            justify-content: center !important;
            box-sizing: border-box !important;
          }
          #hero-cta-sticky {
            left: max(10vw, calc((100% - 810px) / 2)) !important;
            right: max(10vw, calc((100% - 810px) / 2)) !important;
            justify-content: center !important;
            box-sizing: border-box !important;
          }
          #hero-panel-filter-pills {
            gap: 0.4rem !important;
            padding-top: 0.45rem !important;
            padding-bottom: 0.5rem !important;
            justify-content: center;
          }
          #hero-panel-filter-pills .filter-chip {
            padding: 0.25rem 0.55rem !important;
            font-size: 0.58rem !important;
            border-radius: 999px !important;
            letter-spacing: 0.02em !important;
          }
        }
        .cmo-table-inner { display: none; }
        .cmo-table-outer { display: block; }
        .cmo-arrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.5rem;
          height: 1.5rem;
          border-radius: 999px;
          background: rgba(42, 36, 32, 0.06);
          color: rgba(42, 36, 32, 0.45);
          font-size: 0.7rem;
          cursor: default;
          transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
        }
        .cmo-arrow:hover {
          background: rgba(42, 36, 32, 0.14);
          color: rgba(42, 36, 32, 0.75);
          transform: scale(1.12);
        }
        .cmo-url-input-desktop { display: none !important; }
        .cmo-url-input-mobile { display: flex; }
        @media (min-width: 900px) {
          .cmo-url-input-desktop { display: flex !important; }
          .cmo-url-input-mobile { display: none !important; }
          #cmo-dashboard-card {
            grid-template-columns: auto 1fr !important;
            align-items: stretch !important;
          }
          #cmo-dashboard-card [data-hover-item] {
            pointer-events: none !important;
          }
          #cmo-dashboard-card .cmo-video-thumb {
            width: clamp(20.5rem, 7vw, 5rem) !important;
            grid-row: 1 / -1 !important;
            align-self: start !important;
          }
          #cmo-dashboard-table {
            grid-column: 2 / 3 !important;
          }
          .cmo-table-inner { display: flex; flex-direction: column; flex: 1; }
          .cmo-table-outer { display: none !important; }
          #cmo-dashboard-card > div:last-child {
            height: 100%;
            display: flex;
            flex-direction: column;
          }
          #cmo-dashboard-card .cmo-table-inner table {
            flex: 1;
          }
        }
      `}</style>
      <div id="stacked-slides-wrapper" ref={wrapperRef} style={wrapperStyle}>
        {slides.map((slide, index) => (
          <section
            key={slide.title}
            data-stack-panel
            style={{
              ...panelStyle,
              background: index === 0 ? 'rgba(245, 241, 223, 0.18)' : slide.bg,
              backdropFilter: index === 0 ? 'blur(24px)' : 'none',
              WebkitBackdropFilter: index === 0 ? 'blur(24px)' : 'none',
              boxShadow: index === 0 ? 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6)' : 'none',
              color: slide.fg,
            }}
          >
            <div style={contentStyle}>
              <div data-stack-inner style={innerStyle}>
                {slide.layout === 'grid' ? (
                  <div style={gridLayoutStyle}>
                    <div id="panel-hero-intro-centering" style={textCenteringStyle}>
                      <div id="panel-hero-text-row" style={textRowStyle}>
                        <div id="panel-hero-headline-col" style={textColumnStyle}>
                          <h2 id="panel-hero-headline" style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', fontWeight: 300, textAlign: 'left', margin: 0, whiteSpace: 'nowrap', visibility: 'hidden' }}>{slide.headlineText}</h2>
                        </div>
                        <div style={textColumnRightStyle}>
                          <a
                            id="panel-hero-cta"
                            href="https://calendly.com/bballi/30min"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cta-pill-btn"
                            style={{ ...heroCtaStyle, visibility: 'hidden' }}
                          >
                            <img src="/img/profile2_400x400.png?v=1774582808" style={ctaAvatarStyle} alt="" />
                            {slide.supportText}
                            <span style={ctaIconStyle}>↗</span>
                          </a>
                        </div>
                      </div>
                      <div id="hero-panel-filter-pills" style={filterDropdownStyle}>
                        {FILTERS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className="filter-chip"
                            style={{ ...filterChipStyle, ...(activeFilter === f ? filterChipActiveStyle : {}), visibility: 'hidden' }}
                            onClick={() => {
                              setActiveFilter(f);
                              setFilterCopy(FILTER_COPY[f] ?? FILTER_COPY.default);
                            }}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                    <section data-capability-grid style={capabilitySectionStyle}>
                      <div data-capability-header style={{ ...capabilitySectionHeaderStyle, maxWidth: 'none' }}>
                        <div id="agent-marquee-shell" ref={agentMarqueeShellRef} style={{ width: '100%', overflow: 'hidden', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
                          <div ref={agentMarqueeTrackRef} style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', backfaceVisibility: 'hidden', transform: 'translate3d(0, 0, 0)' }}>
                            <div ref={agentMarqueeSetRef} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                              <span style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(2rem, 8.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>CREATE YOUR DASHBOARD</span>
                            </div>
                            <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                              <span style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(2rem, 8.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>CREATE YOUR DASHBOARD</span>
                            </div>
                          </div>
                        </div>
                        {filterCopy.support && (
                          <p id="panel-capability-support" style={{ margin: '0.75rem 0 0', fontSize: 'clamp(1.15rem, 2vw, 1.6rem)', lineHeight: 1.4, color: 'rgba(42, 36, 32, 0.75)', fontWeight: 300, maxWidth: '68ch' }}>{filterCopy.support}</p>
                        )}
                      </div>
                      <div style={capabilityGridStyle}>
                        {AUTOMATION_CAPABILITIES.map((item, index) => {
                          const Icon = AUTOMATION_ICON_COMPONENTS[item.icon];
                          const isMobileCapabilityOpen = isTouchScrollDevice() && activeMobileCapability === item.title;
                          return (
                            <React.Fragment key={item.title}>
                            <article
                              data-capability-card
                              {...(!item.tablePreview && { 'data-hover-item': true })}
                              {...(!item.tablePreview && { 'data-hover-side': index % 2 === 0 ? 'left' : 'right' })}
                              {...(item.tablePreview ? { id: 'cmo-dashboard-card' } : {})}
                              style={{
                                ...(item.tablePreview ? capabilityCardTablePreviewStyle : capabilityCardStyle),
                                ...(item.tablePreview ? { gridColumn: '1 / -1' } : {}),
                                zIndex: isMobileCapabilityOpen ? 6 : 1,
                              }}
                              onClick={() => {
                                if (!isTouchScrollDevice()) return;
                                setActiveMobileCapability((current) => (current === item.title ? null : item.title));
                              }}
                            >
                              <div data-hover-placeholder aria-hidden="true" style={{ display: 'none' }} />
                              {isMobileCapabilityOpen ? (
                                <div style={mobileCapabilityPreviewStyle} aria-hidden="true">
                                  {item.tablePreview ? (
                                    <div style={{ width: '100%', height: '100%', background: '#f5f1df', borderRadius: '0.75rem', padding: '1rem', boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                                      <p style={{ margin: '0 0 0.6rem', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.4)', fontFamily: "'Space Mono', monospace" }}>Your Business, Mapped</p>
                                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', fontFamily: "'Space Grotesk', system-ui, sans-serif", flex: 1 }}>
                                        <thead>
                                          <tr style={{ borderBottom: '1px solid rgba(42,36,32,0.15)' }}>
                                            <th style={{ textAlign: 'left', padding: '0.28rem 0.4rem', fontWeight: 600, color: 'rgba(42,36,32,0.45)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>What you Get</th>
                                            <th style={{ width: '1.2rem' }} />
                                            <th style={{ textAlign: 'right', padding: '0.28rem 0.4rem', fontWeight: 600, color: 'rgba(42,36,32,0.45)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>What this means</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {CMO_TABLE_ROWS.map((row) => (
                                            <tr key={row.task} style={{ borderBottom: '1px solid rgba(42,36,32,0.07)' }}>
                                              <td style={{ padding: '0.38rem 0.4rem', color: '#2a2420', fontWeight: 500 }}>{row.task}</td>
                                              <td style={{ padding: '0.38rem 0.2rem', textAlign: 'center' }}>
                                                {row.task === 'Bryan Balli' || row.task === 'Cross-Device Mockups' || row.task === 'Social Preview Check' || row.task === 'Brand Snapshot' || row.task === 'SEO + AI Visibility' || row.task === 'Founders Brief' ? (
                                                  <span style={{ color: 'rgba(42,36,32,0.3)', fontSize: '0.7rem' }}>→</span>
                                                ) : (
                                                  <span className="cmo-arrow"><Lock size={12} /></span>
                                                )}
                                              </td>
                                              <td style={{ padding: '0.38rem 0.4rem', textAlign: 'right', color: 'rgba(42,36,32,0.65)', fontWeight: 400 }}>{row.value}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : item.previewVideo ? (
                                    <video
                                      src={item.previewVideo}
                                      autoPlay
                                      muted
                                      loop
                                      playsInline
                                      style={mobileCapabilityPreviewImageStyle}
                                    />
                                  ) : (
                                    <img src={item.previewImage} alt="" style={mobileCapabilityPreviewImageStyle} />
                                  )}
                                </div>
                              ) : null}
                              {item.tablePreview && (
                                <div
                                  data-hover-native-ratio
                                  data-hover-side="right"
                                  style={{ display: 'inline-block', flexShrink: 0, cursor: 'pointer' }}
                                >
                                  <video
                                    className="cmo-video-thumb"
                                    src={item.previewVideo}
                                    autoPlay
                                    muted
                                    loop
                                    playsInline
                                    style={{ width: 'clamp(3.5rem, 7vw, 5rem)', aspectRatio: 'auto', borderRadius: '0.5rem', objectFit: 'cover', display: 'block', flexShrink: 0, pointerEvents: 'none' }}
                                  />
                                </div>
                              )}
                              {!item.tablePreview ? (
                                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 'clamp(0.8rem, 1.5vw, 1rem)' }}>
                                  <div style={{ ...capabilityBadgeStyle, color: item.badgeColor, flexShrink: 0 }}>
                                    {Icon ? <Icon size={20} strokeWidth={2.1} /> : item.badge}
                                  </div>
                                  <div style={capabilityContentStyle}>
                                    <h4 style={capabilityCardTitleStyle}>{item.title}</h4>
                                    {item.body && <p style={capabilityCardBodyStyle}>{item.body}</p>}
                                  </div>
                                </div>
                              ) : (
                                <div style={capabilityContentStyle}>
                                  <h4 style={capabilityCardTitleStyle}>{item.title}</h4>
                                  {item.body && (
                                    <p style={{ ...capabilityCardBodyStyle, maxWidth: 'none' }}>{item.body}</p>
                                  )}
                                  <div id="cmo-url-input-row" className="cmo-url-input-desktop" onMouseEnter={(e) => e.stopPropagation()} onMouseLeave={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', padding: '0.35rem 0.35rem 0.35rem 0.75rem', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(42,36,32,0.12)', borderRadius: '999px', boxShadow: '0 1px 4px rgba(42,36,32,0.07)', gap: '0.5rem', position: 'relative', zIndex: 10, lineHeight: 1 }}>
                                    <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                                    <input
                                      value={homepageUrl}
                                      onChange={handleHomepageUrlChange}
                                      placeholder="Enter your website"
                                      style={{ flex: 1, alignSelf: 'center', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 1.2, fontSize: 'clamp(0.75rem, 1.1vw, 0.88rem)', color: 'rgba(42,36,32,0.75)', fontFamily: "'Space Grotesk', system-ui, sans-serif", minWidth: 0 }}
                                    />
                                    <button
                                      className="cta-pill-btn"
                                      onClick={handleCreateDashboard}
                                      disabled={!urlIsValid}
                                      style={urlIsValid ? { ...ctaStyle, flexShrink: 0 } : { ...ctaStyle, border: 'none', flexShrink: 0, background: 'rgba(255,255,255,0.72)', color: '#2a2420', boxShadow: '0 1px 4px rgba(42,36,32,0.1), inset 0 1px 0 rgba(255,255,255,0.6)', opacity: 0.65, cursor: 'default' }}
                                    >Get Dashboard<span style={ctaIconStyle}>↗</span></button>
                                  </div>
                                  <div className="cmo-table-inner" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
                                      <thead><tr><th style={{ textAlign: 'left', padding: '0.25rem 0.4rem', fontWeight: 600, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>What you Get</th><th style={{ width: '1.5rem' }} /><th style={{ textAlign: 'right', padding: '0.25rem 0.4rem', fontWeight: 600, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>What this means</th></tr></thead>
                                      <tbody>{CMO_TABLE_ROWS.map((row) => (<tr key={row.task} style={{ borderBottom: '1px solid rgba(42,36,32,0.07)' }}><td style={{ padding: '0.32rem 0.4rem', color: 'rgba(42,36,32,0.75)', fontWeight: 500 }}>{row.task}</td><td style={{ padding: '0.32rem 0.2rem', textAlign: 'center' }}>{row.task === 'Bryan Balli' || row.task === 'Cross-Device Mockups' || row.task === 'Social Preview Check' || row.task === 'Brand Snapshot' || row.task === 'SEO + AI Visibility' || row.task === 'Founders Brief' ? <span style={{ color: 'rgba(42,36,32,0.3)', fontSize: '0.7rem' }}>→</span> : <span className="cmo-arrow"><Lock size={12} /></span>}</td><td style={{ padding: '0.32rem 0.4rem', textAlign: 'right', color: 'rgba(42,36,32,0.65)', fontWeight: 400 }}>{row.value}</td></tr>))}</tbody>
                                    </table>
                                    <a id="cmo-no-website-hint-desktop" href="/login?flow=homepage-create" style={cmoNoWebsiteLinkStyle}>Don't Have a Website?</a>
                                  </div>
                                </div>
                              )}
                              {item.tablePreview && (
                                <div id="cmo-dashboard-table" className="cmo-table-outer" style={{ gridColumn: '1 / -1', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
                                    <thead><tr><th style={{ textAlign: 'left', padding: '0.25rem 0.4rem', fontWeight: 600, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>What you Get</th><th style={{ width: '1.5rem' }} /><th style={{ textAlign: 'right', padding: '0.25rem 0.4rem', fontWeight: 600, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>What this means</th></tr></thead>
                                    <tbody>{CMO_TABLE_ROWS.map((row) => (<tr key={row.task} style={{ borderBottom: '1px solid rgba(42,36,32,0.07)' }}><td style={{ padding: '0.32rem 0.4rem', color: 'rgba(42,36,32,0.75)', fontWeight: 500 }}>{row.task}</td><td style={{ padding: '0.32rem 0.2rem', textAlign: 'center' }}>{row.task === 'Bryan Balli' || row.task === 'Cross-Device Mockups' || row.task === 'Social Preview Check' || row.task === 'Brand Snapshot' || row.task === 'SEO + AI Visibility' || row.task === 'Founders Brief' ? <span style={{ color: 'rgba(42,36,32,0.3)', fontSize: '0.7rem' }}>→</span> : <span className="cmo-arrow"><Lock size={12} /></span>}</td><td style={{ padding: '0.32rem 0.4rem', textAlign: 'right', color: 'rgba(42,36,32,0.65)', fontWeight: 400 }}>{row.value}</td></tr>))}</tbody>
                                  </table>
                                  <div className="cmo-url-input-mobile" onMouseEnter={(e) => e.stopPropagation()} onMouseLeave={(e) => e.stopPropagation()} style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', padding: '0.35rem 0.35rem 0.35rem 0.75rem', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(42,36,32,0.12)', borderRadius: '999px', boxShadow: '0 1px 4px rgba(42,36,32,0.07)', gap: '0.5rem', position: 'relative', zIndex: 10, lineHeight: 1 }}>
                                    <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                                    <input
                                      value={homepageUrl}
                                      onChange={handleHomepageUrlChange}
                                      placeholder="Enter your website"
                                      style={{ flex: 1, alignSelf: 'center', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 1.2, fontSize: 'clamp(0.75rem, 1.1vw, 0.88rem)', color: 'rgba(42,36,32,0.75)', fontFamily: "'Space Grotesk', system-ui, sans-serif", minWidth: 0 }}
                                    />
                                    <button
                                      className="cta-pill-btn"
                                      onClick={handleCreateDashboard}
                                      disabled={!urlIsValid}
                                      style={urlIsValid ? { ...ctaStyle, flexShrink: 0 } : { ...ctaStyle, border: 'none', flexShrink: 0, background: 'rgba(255,255,255,0.72)', color: '#2a2420', boxShadow: '0 1px 4px rgba(42,36,32,0.1), inset 0 1px 0 rgba(255,255,255,0.6)', opacity: 0.65, cursor: 'default' }}
                                    >Get Dashboard<span style={ctaIconStyle}>↗</span></button>
                                  </div>
                                  <a id="cmo-no-website-hint" href="/login?flow=homepage-create" style={cmoNoWebsiteLinkStyle}>Don't Have a Website?</a>
                                </div>
                              )}
                            </article>
                            {item.tablePreview && (
                              <div id="panel-additional-content-header" style={{ ...capabilitySectionHeaderStyle, gridColumn: '1 / -1', borderTop: '1px solid rgba(42, 36, 32, 0.12)', paddingTop: 'clamp(1.25rem, 2.5vw, 1.85rem)', marginTop: 'clamp(1.25rem, 2.5vw, 1.85rem)' }}>
                                <span style={capabilityEyebrowStyle}>What I can take over next</span>
                                <p style={{ margin: '0.35rem 0 0', fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)', lineHeight: 1.55, color: 'rgba(42, 36, 32, 0.6)', fontWeight: 400 }}>Direct outcomes I can step into and run, so you can stop juggling and start shipping.</p>
                              </div>
                            )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </section>
                    <div data-grid-window style={gridWindowStyle}>
                      <div data-grid-inner style={gridInnerContainerStyle}>
                        {/* <div id="stacked-grid-row" style={gridRowStyle}>
                          {PORTFOLIO_IMAGES.map((src, index) => (
                            <div
                              key={src}
                              style={{ ...gridItemStyle, overflow: 'hidden', backgroundColor: 'rgba(42, 36, 32, 0.08)', border: '1px solid rgba(42, 36, 32, 0.2)', borderRadius: '0.5rem' }}
                            >
                              <img
                                src={src}
                                alt={`Project frame ${index + 1}`}
                                style={index === 0 ? gridFeatureImageStyle : gridFrameImageStyle}
                              />
                            </div>
                          ))}
                        </div> */}
                        {/* Testimonials */}
                        <div id="testimonials-section" style={testimonialsShellStyle}>
                          <div style={capabilitySectionHeaderStyle}>
                            <span style={capabilityEyebrowStyle}>Testimonials</span>
                            <p style={{ margin: '0.35rem 0 0', fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)', lineHeight: 1.55, color: 'rgba(42, 36, 32, 0.6)', fontWeight: 400 }}>Feedback from people I've worked with across agency, brand, and product teams.</p>
                          </div>
                          <div id="testimonials-grid" style={{ marginTop: 'clamp(1.25rem, 2.5vw, 2rem)', display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 1.5vw, 1rem)', width: '100%', minWidth: 0 }}>
                            {[testimonials[0], testimonials[1], testimonials[2], testimonials[3]].map((t) => (
                              <article key={t.name + t.company} style={{ ...secondaryQuoteItemStyle, width: '100%', boxSizing: 'border-box', overflow: 'hidden', aspectRatio: '19 / 6', flexDirection: 'row', alignItems: 'center', gap: 'clamp(1.5rem, 3vw, 2.5rem)', padding: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
                                <img src={t.img} alt={t.name} style={{ ...testimonialCardAvatarStyle, flexShrink: 0, width: 'clamp(2.5rem, 4vw, 3.5rem)', height: 'clamp(2.5rem, 4vw, 3.5rem)' }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ ...featuredQuoteTextStyle, fontSize: 'clamp(0.9rem, 1.4vw, 1.15rem)', margin: '0 0 0.65rem' }}>{t.quote}</p>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                    <span style={quoteAttributionNameStyle}>{t.name}</span>
                                    <span style={{ color: 'rgba(42,36,32,0.3)', fontSize: '0.75rem' }}>·</span>
                                    <span style={quoteAttributionRoleStyle}>{t.title}, {t.company}</span>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        </div>
                        {/* Inline footer */}
                        <div id="stacked-inline-footer" style={inlineFooterStyle}>
                          <div id="inline-footer-value-block" style={inlineFooterNewsletterStyle}>
                            <img src="/img/sig.png" alt="Bryan Balli signature" style={inlineFooterSignatureStyle} />

                            <p style={footerValueIntroStyle}>
                              &ldquo;With me in the loop, you get all the high-impact deliverables needed to launch your digital products and cross-platform marketing campaigns.&rdquo;
                            </p>
                            <p style={footerBridgeLabelStyle}>
                              But what matters most:
                            </p>

                            <ul id="inline-footer-bullet-list" style={footerBulletListStyle}>
                              <li style={footerBulletItemStyle}>Rough Ideas Ship</li>
                              <li style={footerBulletItemStyle}>Insights Become Strategy</li>
                              <li style={footerBulletItemStyle}>Designs Become Consistent</li>
                              <li style={footerBulletItemStyle}>Consistency Creates Confidence</li>
                            </ul>

                            <div style={inlineFooterInnerDividerStyle} />

                            <div id="inline-footer-credit-row" style={inlineFooterCreditRowStyle}>
                              <div style={inlineFooterCreditLineStyle}>
                                <span style={{ ...testimonialCardNameStyle, fontWeight: 400, lineHeight: 1.55, fontSize: 'clamp(0.9rem, 1.4vw, 1.15rem)' }}><strong style={{ fontWeight: 700 }}>Bryan Balli</strong> is an experienced Creative Technologist spanning engineering and creative roles at leading agencies and brands, from Chicago, San Francisco and on remote international teams.</span>
                              </div>
                              <a
                                id="footer-cta"
                                href="https://calendly.com/bballi/30min"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="cta-pill-btn"
                                style={ctaStyle}
                              >
                                <img src="/img/profile2_400x400.png?v=1774582808" style={ctaAvatarStyle} alt="" />
                                Chat with Bryan
                                <span style={ctaIconStyle}>↗</span>
                              </a>
                            </div>

                            <div id="agency-marquee-shell" ref={marqueeShellRef} style={agencyMarqueeShellStyle}>
                              <div ref={marqueeTrackRef} style={agencyMarqueeTrackStyle}>
                                <div ref={marqueeSetRef} style={agencyMarqueeSetStyle}>
                                  {agencyLogos.map((logo) => (
                                    <img key={`agency-a-${logo.alt}`} src={logo.src} alt={logo.alt} style={logo.scale ? { ...agencyLogoStyle, height: `${22 * logo.scale}px` } : agencyLogoStyle} />
                                  ))}
                                </div>
                                <div aria-hidden="true" style={agencyMarqueeSetStyle}>
                                  {agencyLogos.map((logo) => (
                                    <img key={`agency-b-${logo.alt}`} src={logo.src} alt="" style={logo.scale ? { ...agencyLogoStyle, height: `${22 * logo.scale}px` } : agencyLogoStyle} />
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div id="inline-footer-bottom" style={inlineFooterBottomStyle}>
                            <div style={inlineFooterLegalStyle}>
                              <a href="https://www.linkedin.com/in/bryanballi" style={inlineFooterLegalLinkStyle}>LinkedIn</a>
                              <a href="https://x.com/bai_ee" style={inlineFooterLegalLinkStyle}>𝕏</a>
                            </div>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 style={headingStyle}>{slide.title}</h2>
                    {slide.image ? (
                      <img src={slide.image} alt="" style={imageStyle} />
                    ) : (
                      <div style={copyWrapStyle}>
                        {slide.body.map((paragraph) => (
                          <p key={paragraph} style={paragraphStyle}>
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* Particle debug panel */}
      {settingsOpen && (
        <div style={debugPanelStyle}>
          <div style={debugPanelHeaderStyle}>
            <span style={debugPanelTitleStyle}>Particle Settings</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                style={debugPanelSmallBtnStyle}
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(particleParams, null, 2));
                }}
                title="Copy JSON"
              >
                Copy
              </button>
              <button
                type="button"
                style={debugPanelSmallBtnStyle}
                onClick={() => setParticleParams(PARTICLE_DEFAULTS)}
              >
                Reset
              </button>
              <button
                type="button"
                style={{ ...debugPanelSmallBtnStyle, padding: '0.2rem 0.45rem' }}
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
          </div>

          <div style={debugPanelPresetsStyle}>
            {slides[0].serviceItems.map((item, i) => (
              <span key={item.id} style={debugPresetTagStyle}>
                {item.label.split(' ')[0]}:{' '}
                <em>{item.id === 1 ? 'brain (svg)' : PRESET_KINDS[i % 2 === 0 ? 0 : 2]}</em>
              </span>
            ))}
          </div>

          <div style={debugSlidersStyle}>
            {PARTICLE_SLIDERS.map(({ key, label, min, max, step }) => (
              <div key={key} style={debugSliderRowStyle}>
                <div style={debugSliderLabelRowStyle}>
                  <span style={debugSliderLabelStyle}>{label}</span>
                  <span style={debugSliderValueStyle}>{particleParams[key]}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={particleParams[key]}
                  onChange={(e) => setParticleParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                  style={debugRangeStyle}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky CTA — mirrors #panel-hero-cta, shown via ScrollTrigger */}
      <a
        id="hero-cta-sticky"
        ref={stickyCTARef}
        href="https://calendly.com/bballi/30min"
        target="_blank"
        rel="noopener noreferrer"
        className="cta-pill-btn"
        style={{
          ...ctaStyle,
          position: 'fixed',
          top: '74px',
          right: 'max(10vw, calc((100% - 810px) / 2))',
          left: 'auto',
          zIndex: 240,
          visibility: 'hidden',
          opacity: 0,
        }}
      >
        <img src="/img/profile2_400x400.png?v=1774582808" style={ctaAvatarStyle} alt="" />
        Chat with Bryan
        <span style={ctaIconStyle}>↗</span>
      </a>
    </section>
  );
};

const sectionStyle = {
  position: 'relative',
  paddingBottom: 0,
};

const quoteSectionStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const quoteTextStyle = {
  margin: 0,
  fontSize: 'clamp(2rem, 5vw, 4.2rem)',
  fontWeight: 700,
  lineHeight: 1.08,
  letterSpacing: '-0.04em',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  color: '#2a2420',
  maxWidth: '18ch',
};

const wrapperStyle = {
  paddingTop: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const panelStyle = {
  width: '100%',
  minHeight: 'calc(100dvh - 64px)',
  display: 'flex',
  justifyContent: 'center',
  position: 'relative',
  boxSizing: 'border-box',
  overflow: 'visible',
  borderRadius: '1rem',
};

const contentStyle = {
  width: '100%',
  height: 'auto',
};

const innerStyle = {
  height: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

const headingStyle = {
  fontSize: 'max(2.8rem, min(8.4vw + 0.7rem, 7rem))',
  fontWeight: 700,
  margin: '0 auto',
  lineHeight: 0.9,
  letterSpacing: '-0.05em',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  textAlign: 'center',
};

const imageStyle = {
  width: 'min(40%, 27.2rem)',
  aspectRatio: '1 / 1',
  objectFit: 'cover',
  marginTop: '1.75rem',
  borderRadius: '0.75rem',
};

const copyWrapStyle = {
  width: 'min(33.6rem, 80%)',
  marginTop: '1.4rem',
};

const paragraphStyle = {
  maxWidth: '40ch',
  padding: '0 1.4rem',
  margin: '0 0 0.7rem',
  fontSize: '0.735rem',
  lineHeight: 1.55,
  textAlign: 'justify',
};

const gridWindowStyle = {
  overflow: 'visible',
};

const gridLayoutStyle = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  paddingTop: 0,
  paddingBottom: 'clamp(0.75rem, 1.5vw, 1.4rem)',
  paddingLeft: 'max(10vw, calc((100% - 810px) / 2))',
  paddingRight: 'max(10vw, calc((100% - 810px) / 2))',
  boxSizing: 'border-box',
};

const textCenteringStyle = {
  height: 'auto',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  paddingTop: 'clamp(0.5rem, 1.5vh, 1.25rem)',
  paddingBottom: 'clamp(0.5rem, 1.5vh, 1.25rem)',
  gap: 'clamp(0.35rem, 1vh, 0.75rem)',
};

const textRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'clamp(1.4rem, 2.8vw, 2.1rem)',
  alignItems: 'center',
  width: '100%',
};

const textColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
};

const textColumnRightStyle = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'flex-end',
  textAlign: 'right',
};

const supportTextStyle = {
  margin: 0,
  fontSize: 'clamp(0.7rem, 1.4vw, 0.91rem)',
  lineHeight: 1.6,
  fontWeight: 400,
  textAlign: 'justify',
  color: 'rgba(42, 36, 32, 0.8)',
};

const ctaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  padding: '0.5rem 0.75rem',
  fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const heroCtaStyle = {
  ...ctaStyle,
  width: 'min(100%, 14.75rem)',
};

const ctaAvatarStyle = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255,255,255,0.35)',
  flexShrink: 0,
  display: 'block',
};

const ctaIconStyle = {
  fontSize: '0.7rem',
  opacity: 0.75,
  marginLeft: '0.1rem',
};

const gridInnerContainerStyle = {
  width: '100%',
  overflowX: 'visible',
  paddingBottom: 'clamp(3rem, 6vw, 5rem)',
  boxSizing: 'border-box',
};

const gridRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
  marginTop: 0,
};

const capabilitySectionStyle = {
  width: '100%',
  marginTop: 0,
  paddingTop: 'clamp(0.6rem, 1.2vw, 1rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const capabilitySectionHeaderStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  marginBottom: 'clamp(1rem, 2vw, 1.5rem)',
  maxWidth: '44rem',
};

const capabilityEyebrowStyle = {
  fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontWeight: 700,
  letterSpacing: '-0.03em',
  textTransform: 'none',
  color: '#2a2420',
};

const capabilityHeadingStyle = {
  margin: 0,
  fontSize: 'clamp(1.3rem, 2.8vw, 2rem)',
  lineHeight: 1.08,
  letterSpacing: '-0.04em',
  fontWeight: 700,
  color: '#2a2420',
  textWrap: 'balance',
};

const capabilityGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 'clamp(0.75rem, 1.6vw, 1rem)',
  width: '100%',
};

const capabilityCardTablePreviewStyle = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  gap: 'clamp(0.8rem, 1.5vw, 1rem)',
  alignItems: 'start',
  padding: 'clamp(1rem, 2vw, 1.35rem)',
  minHeight: 'clamp(7rem, 14vw, 9rem)',
  borderRadius: '1.1rem',
  border: '1px solid rgba(212, 196, 171, 0.82)',
  background: 'rgba(255,255,255,0.5)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4)',
  boxSizing: 'border-box',
  overflow: 'visible',
};

const capabilityCardStyle = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  padding: 'clamp(1rem, 2vw, 1.35rem)',
  borderRadius: '1.1rem',
  border: '1px solid rgba(212, 196, 171, 0.82)',
  background: 'rgba(255,255,255,0.5)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4)',
  boxSizing: 'border-box',
  overflow: 'visible',
};

const capabilityCardFooterStyle = {
  display: 'flex',
  alignItems: 'center',
  marginTop: '0.85rem',
};

const capabilityBadgeStyle = {
  width: 'clamp(2.4rem, 4vw, 2.9rem)',
  height: 'clamp(2.4rem, 4vw, 2.9rem)',
  borderRadius: '0.85rem',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(42, 36, 32, 0.05)',
  fontSize: 'clamp(0.72rem, 1vw, 0.85rem)',
  fontWeight: 800,
  letterSpacing: '-0.02em',
  flexShrink: 0,
};

const capabilityContentStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  minWidth: 0,
};

const capabilityCardTitleStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
  lineHeight: 1.15,
  fontWeight: 700,
  letterSpacing: '-0.03em',
  color: '#2a2420',
};

const capabilityCardBodyStyle = {
  margin: 0,
  fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)',
  lineHeight: 1.55,
  color: 'rgba(42, 36, 32, 0.6)',
};

const mobileCapabilityPreviewStyle = {
  position: 'absolute',
  left: '50%',
  bottom: 'calc(100% + 0.7rem)',
  transform: 'translateX(-50%)',
  width: '90vw',
  aspectRatio: '16 / 9',
  borderRadius: '1.2rem',
  overflow: 'hidden',
  background: 'rgba(255, 255, 255, 0.96)',
  border: '1px solid rgba(212, 196, 171, 0.82)',
  boxShadow: '0 24px 80px rgba(42, 36, 32, 0.18)',
  zIndex: 10,
  pointerEvents: 'none',
};

const mobileCapabilityPreviewImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const gridItemStyle = {
  aspectRatio: '16 / 9',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const gridFrameImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const gridFeatureImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const gridPlaceholderStyle = {
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(42, 36, 32, 0.08)',
  borderRadius: '0.5rem',
  border: '1px solid rgba(42, 36, 32, 0.2)',
};

const testimonialCardStyle = {
  background: 'transparent',
  borderRadius: '0.5rem',
  aspectRatio: '16 / 9',
  padding: 'clamp(1.5rem, 4vw, 3rem)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 'clamp(0.75rem, 1.5vw, 1.25rem)',
  boxSizing: 'border-box',
  overflow: 'hidden',
  textAlign: 'center',
};

const testimonialCardQuoteStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 2.4vw, 1.75rem)',
  lineHeight: 1.4,
  letterSpacing: '-0.02em',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.82)',
  textWrap: 'balance',
};

const testimonialCardAuthorRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.6rem',
};

const testimonialCardAvatarStyle = {
  width: '2rem',
  height: '2rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '1px solid rgba(42, 36, 32, 0.14)',
  flexShrink: 0,
  display: 'block',
};

const testimonialCardMetaStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const testimonialCardNameStyle = {
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'rgba(42, 36, 32, 0.75)',
};

const testimonialCardCompanyStyle = {
  fontSize: 'clamp(0.72rem, 0.9vw, 0.8rem)',
  fontWeight: 400,
  letterSpacing: '0.02em',
  color: 'rgba(42, 36, 32, 0.38)',
};

const featuredWorkLabelStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2rem, 4vw, 3rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  paddingBottom: 'clamp(1rem, 2vw, 1.5rem)',
  boxSizing: 'border-box',
};

const featurePreviewSectionStyle = {
  width: '100%',
  marginBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
};

const featurePreviewGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
  gridAutoRows: 'clamp(3.8rem, 6vw, 5.6rem)',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
};

const featurePreviewCardStyle = {
  gridColumn: 'span 4',
  gridRow: 'span 3',
  borderRadius: '1rem',
  overflow: 'hidden',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.46)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.55), inset 0 1px 0 rgba(255,255,255,0.32)',
};

const featurePreviewCardWideStyle = {
  gridColumn: 'span 8',
};

const featurePreviewCardTallStyle = {
  gridRow: 'span 4',
};

const featurePreviewImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const deliverablesToggleStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
};

const filterDropdownStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: '0.5rem',
  paddingTop: 'clamp(0.35rem, 0.8vw, 0.6rem)',
  paddingBottom: 'clamp(0.35rem, 0.8vw, 0.6rem)',
};

const filterChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.38rem 0.85rem',
  background: 'rgba(42, 36, 32, 0.05)',
  border: '1px solid rgba(42, 36, 32, 0.15)',
  borderRadius: '2rem',
  fontFamily: "'Space Mono', monospace",
  fontSize: '0.72rem',
  fontWeight: 400,
  letterSpacing: '0.04em',
  color: 'rgba(42, 36, 32, 0.6)',
  cursor: 'pointer',
};

const filterChipActiveStyle = {
  background: '#2a2420',
  border: '1px solid #2a2420',
  color: '#f5f1df',
};

const servicesViewportStyle = {
  position: 'relative',
  width: '100%',
};

const servicesCanvasStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 2,
  filter: 'brightness(1.1) contrast(1.08)',
};

const servicesRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
};

const serviceItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(0.4rem, 0.8vw, 0.6rem)',
  height: 'clamp(130px, 16vh, 200px)',
  overflow: 'hidden',
};

const serviceVisualZoneStyle = {
  flex: 1,
  width: '100%',
  backgroundColor: 'transparent',
  borderRadius: '0.5rem',
  border: '1px solid rgba(42, 36, 32, 0.1)',
};


const serviceLabelStyle = {
  fontSize: 'clamp(0.7rem, 0.95vw, 0.82rem)',
  fontWeight: 500,
  letterSpacing: '0.01em',
  color: 'rgba(42, 36, 32, 0.65)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const hoverListStyle = {
  listStyle: 'none',
  width: '100%',
  margin: 0,
  padding: 0,
  marginTop: 'clamp(2rem, 4vw, 3rem)',
};

const hoverItemStyle = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '2.8rem 1fr auto',
  alignItems: 'center',
  gap: '0 clamp(0.75rem, 2vw, 1.75rem)',
  width: '100%',
  padding: 'clamp(1.2rem, 2.2vw, 1.8rem) 0',
  borderBottom: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const hoverItemIndexStyle = {
  fontSize: '0.65rem',
  fontFamily: "'Space Mono', monospace",
  fontWeight: 400,
  letterSpacing: '0.06em',
  color: 'rgba(42, 36, 32, 0.28)',
  fontVariantNumeric: 'tabular-nums',
  alignSelf: 'center',
};

const hoverItemTagStyle = {
  fontSize: '0.68rem',
  fontFamily: "'Space Mono', monospace",
  fontWeight: 400,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.35)',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
};

const hoverImageStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 'clamp(220px, 24vw, 360px)',
  height: 'clamp(220px, 24vw, 360px)',
  objectFit: 'cover',
  zIndex: 9999,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  borderRadius: '1.25rem',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.42)',
};

const hoverTextWrapStyle = {
  minWidth: 0,
};

const hoverTitleStyle = {
  margin: 0,
  color: '#2a2420',
  fontSize: 'clamp(1.1rem, 2vw, 2.2rem)',
  lineHeight: 1.08,
  fontWeight: 700,
  letterSpacing: '-0.04em',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};


const testimonialsShellStyle = {
  width: '100%',
  marginTop: 'clamp(1.25rem, 2.5vw, 1.85rem)',
  paddingTop: 'clamp(1.25rem, 2.5vw, 1.85rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const featuredQuoteStyle = {
  position: 'relative',
  padding: 'clamp(1.5rem, 3vw, 2.5rem)',
  background: 'rgba(42, 36, 32, 0.03)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  borderRadius: '0.75rem',
  marginBottom: 'clamp(1rem, 2vw, 1.5rem)',
  overflow: 'hidden',
};

const featuredQuoteMarkStyle = {
  position: 'absolute',
  top: '-0.5rem',
  left: 'clamp(1rem, 2vw, 1.75rem)',
  fontSize: 'clamp(5rem, 10vw, 8rem)',
  lineHeight: 1,
  color: 'rgba(42, 36, 32, 0.06)',
  fontFamily: 'Georgia, serif',
  pointerEvents: 'none',
  userSelect: 'none',
};

const featuredQuoteTextStyle = {
  margin: '0 0 clamp(1rem, 2vw, 1.5rem)',
  fontSize: 'clamp(1rem, 1.8vw, 1.3rem)',
  lineHeight: 1.6,
  fontWeight: 400,
  color: '#2a2420',
  letterSpacing: '-0.01em',
  maxWidth: '62ch',
  position: 'relative',
};

const quoteAttributionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const quoteAttributionNameStyle = {
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  fontWeight: 700,
  color: '#2a2420',
  letterSpacing: '-0.01em',
};

const quoteAttributionSepStyle = {
  fontSize: '0.75rem',
  color: 'rgba(42, 36, 32, 0.3)',
};

const quoteAttributionRoleStyle = {
  fontSize: 'clamp(0.75rem, 1vw, 0.85rem)',
  color: 'rgba(42, 36, 32, 0.45)',
};

const secondaryQuotesGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 'clamp(0.75rem, 1.5vw, 1rem)',
};

const secondaryQuoteItemStyle = {
  padding: 'clamp(1rem, 2vw, 1.5rem)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  borderRadius: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  boxSizing: 'border-box',
};

const secondaryQuoteTextStyle = {
  margin: 0,
  fontSize: 'clamp(0.82rem, 1.2vw, 0.95rem)',
  lineHeight: 1.65,
  color: 'rgba(42, 36, 32, 0.7)',
  fontStyle: 'italic',
  flexGrow: 1,
};

const workHistoryShellStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const workHistoryHeaderStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  marginBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
};

const workHistoryEyebrowStyle = {
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.2vw, 0.95rem)',
  color: 'rgba(42, 36, 32, 0.5)',
};

const workHistoryHeadlineStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: 1.1,
  color: '#2a2420',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

const workHistoryListStyle = {
  width: '100%',
};

const workHistoryItemStyle = {
  display: 'grid',
  gridTemplateColumns: 'clamp(6rem, 10vw, 9rem) 1fr auto',
  gap: '0 clamp(1rem, 2.5vw, 2rem)',
  padding: 'clamp(1rem, 2vw, 1.5rem) 0',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
  alignItems: 'start',
};

const workHistoryYearStyle = {
  fontSize: 'clamp(0.72rem, 1vw, 0.82rem)',
  color: 'rgba(42, 36, 32, 0.4)',
  letterSpacing: '0.02em',
  paddingTop: '0.2rem',
  whiteSpace: 'nowrap',
};

const workHistoryBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const workHistoryRoleRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const workHistoryRoleStyle = {
  fontSize: 'clamp(0.95rem, 1.5vw, 1.15rem)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#2a2420',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

const workHistoryCompanyStyle = {
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  color: 'rgba(42, 36, 32, 0.45)',
  fontWeight: 400,
};

const workHistoryDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '54ch',
};

const workHistoryBadgeStyle = {
  display: 'inline-block',
  padding: '0.25rem 0.7rem',
  background: 'rgba(42, 36, 32, 0.06)',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  borderRadius: '2rem',
  fontFamily: "'Space Mono', monospace",
  fontSize: '0.7rem',
  fontWeight: 400,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.5)',
  whiteSpace: 'nowrap',
  marginTop: '0.2rem',
};

const rateCardShellStyle = {
  width: '100%',
  background: 'none',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  paddingBottom: 0,
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const rateCardHeaderStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  marginBottom: 'clamp(2rem, 4vw, 3rem)',
};

const rateCardEyebrowStyle = {
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.2vw, 0.95rem)',
  color: 'rgba(42, 36, 32, 0.5)',
};

const rateCardHeadlineStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: 1.1,
  color: '#2a2420',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

const rateCardSubtextStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '52ch',
};

const processStepsStyle = {
  width: '100%',
  marginBottom: 'clamp(2rem, 4vw, 3rem)',
};

const processStepItemStyle = {
  display: 'grid',
  gridTemplateColumns: '3rem 1fr',
  gap: '0 clamp(1rem, 2.5vw, 2rem)',
  padding: 'clamp(1.1rem, 2vw, 1.6rem) 0',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
  alignItems: 'start',
};

const processStepNumStyle = {
  fontSize: 'clamp(1.6rem, 2.8vw, 2.4rem)',
  fontWeight: 700,
  letterSpacing: '-0.04em',
  lineHeight: 1,
  color: 'rgba(42, 36, 32, 0.1)',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  paddingTop: '0.1rem',
};

const processStepBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const processStepTitleStyle = {
  fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#2a2420',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  lineHeight: 1.2,
};

const processStepDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '52ch',
};

const textBryanRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '1rem',
  padding: 'clamp(1.2rem, 2.5vw, 2rem) 0',
  flexWrap: 'wrap',
};

const textBryanBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.65rem 1.3rem',
  background: '#2a2420',
  color: '#f5f1df',
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  fontWeight: 600,
  letterSpacing: '0.02em',
  textDecoration: 'none',
  borderRadius: '2rem',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const textBryanHintStyle = {
  fontSize: '0.72rem',
  color: 'rgba(42, 36, 32, 0.38)',
  letterSpacing: '0.02em',
};

const processToPackagesDividerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  marginBottom: 'clamp(1.5rem, 3vw, 2rem)',
};

const processToPackagesLabelStyle = {
  fontSize: '0.68rem',
  fontFamily: "'Space Mono', monospace",
  fontWeight: 400,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.35)',
  whiteSpace: 'nowrap',
};

const rateCardGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 'clamp(1rem, 2vw, 1.5rem)',
};

const rateCardItemStyle = {
  background: 'none',
  border: '1px solid rgba(42, 36, 32, 0.2)',
  borderRadius: '0.5rem',
  padding: 'clamp(1.5rem, 3vw, 2rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  boxSizing: 'border-box',
};

const rateCardNameStyle = {
  margin: 0,
  fontSize: 'clamp(1.2rem, 2vw, 1.6rem)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#7a6a3a',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

const rateCardPriceRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.3rem',
};

const rateCardPriceStyle = {
  fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  color: '#2a2420',
};

const rateCardUnitStyle = {
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  color: 'rgba(42, 36, 32, 0.45)',
};

const rateCardDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  lineHeight: 1.55,
  color: 'rgba(42, 36, 32, 0.55)',
  flexGrow: 1,
};

const rateCardBadgeStyle = {
  display: 'inline-block',
  padding: '0.3rem 0.8rem',
  background: 'rgba(42, 36, 32, 0.08)',
  borderRadius: '2rem',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'rgba(42, 36, 32, 0.6)',
  alignSelf: 'flex-start',
};

const rateCardCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.45rem 1.6rem 0.45rem 0.45rem',
  borderRadius: '2rem',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  fontSize: 'clamp(0.9rem, 1.3vw, 1rem)',
  fontWeight: 700,
  textDecoration: 'none',
  cursor: 'pointer',
  marginTop: '0.5rem',
  whiteSpace: 'nowrap',
};

const contactCardStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  marginBottom: 'clamp(2rem, 4vw, 3rem)',
  background: '#2a2420',
  borderRadius: '1.25rem',
  padding: 'clamp(2.5rem, 5vw, 4rem) clamp(2rem, 4vw, 3.5rem)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'clamp(2rem, 4vw, 4rem)',
  boxSizing: 'border-box',
  flexWrap: 'wrap',
};

const contactCardLeftStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  flex: '1 1 auto',
  maxWidth: '32rem',
};

const contactCardEyebrowStyle = {
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.2vw, 0.95rem)',
  color: 'rgba(245, 241, 223, 0.55)',
  letterSpacing: '0.01em',
};

const contactCardHeadlineStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3.5vw, 3rem)',
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: '-0.03em',
  color: '#f5f1df',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

const contactCardSubtextStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  lineHeight: 1.6,
  color: 'rgba(245, 241, 223, 0.55)',
};

const contactCardRightStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'clamp(1rem, 2vw, 1.75rem)',
  flexShrink: 0,
  flexWrap: 'wrap',
};

const contactCardPrimaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.45rem 1.6rem 0.45rem 0.45rem',
  fontSize: 'clamp(0.9rem, 1.3vw, 1rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: '2rem',
  boxShadow: '0 0 14px 3px rgba(0,200,228,0.22), 0 2px 6px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const contactCardSecondaryLinkStyle = {
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  fontWeight: 500,
  color: 'rgba(245, 241, 223, 0.65)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const inlineFooterStyle = {
  width: '100%',
  paddingTop: 'clamp(2.5rem, 5vw, 4.5rem)',
  paddingBottom: 'clamp(3rem, 6vw, 5rem)',
  boxSizing: 'border-box',
};

const inlineFooterDividerStyle = {
  width: '100%',
  height: '1px',
  background: 'rgba(42, 36, 32, 0.12)',
  margin: 'clamp(2.5rem, 5vw, 4rem) 0',
};

const inlineFooterNewsletterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'clamp(1rem, 2vw, 1.55rem)',
  textAlign: 'center',
  width: '100%',
  maxWidth: '46rem',
  margin: '0 auto',
};

const inlineFooterHeadingStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 1.8vw, 1.3rem)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  color: '#2a2420',
};

const inlineFooterSignatureStyle = {
  width: 'min(110px, 31vw)',
  height: 'auto',
  display: 'block',
};

const inlineFooterSubStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.88rem)',
  color: 'rgba(42, 36, 32, 0.5)',
  maxWidth: '36ch',
};

const aboutMeBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  maxWidth: '54ch',
};

const aboutMeQuoteStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 2.4vw, 1.75rem)',
  lineHeight: 1.4,
  letterSpacing: '-0.02em',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.82)',
  textAlign: 'center',
  textWrap: 'balance',
};

const aboutMeBylineStyle = {
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  fontWeight: 500,
  letterSpacing: '0.01em',
  color: 'rgba(42, 36, 32, 0.4)',
};

const footerValueIntroStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 2.4vw, 1.75rem)',
  lineHeight: 1.36,
  letterSpacing: '-0.02em',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.82)',
  textAlign: 'center',
  maxWidth: '32ch',
  textWrap: 'balance',
};

const footerValueFollowStyle = {
  margin: 0,
  fontSize: 'clamp(0.95rem, 1.5vw, 1.1rem)',
  lineHeight: 1.4,
  color: '#2a2420',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  textAlign: 'center',
  maxWidth: '36ch',
};

const footerBridgeLabelStyle = {
  margin: 0,
  fontSize: 'clamp(0.9rem, 1.4vw, 1.15rem)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'rgba(42, 36, 32, 0.75)',
  textAlign: 'center',
  marginTop: 'clamp(0.15rem, 0.4vw, 0.35rem)',
};

const footerBulletListStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: '42rem',
  textAlign: 'center',
};

const footerBulletItemStyle = {
  fontSize: 'clamp(0.9rem, 1.4vw, 1.15rem)',
  lineHeight: 1.45,
  color: 'rgba(42, 36, 32, 0.74)',
  padding: '0.85rem 0',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
};

const footerBulletMarkStyle = {};

const footerClosingStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.42)',
  fontWeight: 500,
  fontStyle: 'italic',
  letterSpacing: '0.01em',
  textAlign: 'center',
  width: '100%',
  maxWidth: '54ch',
};

const inlineFooterFormStyle = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.5rem',
  width: '100%',
  maxWidth: '420px',
};

const inlineFooterInputStyle = {
  flex: 1,
  padding: '0.75rem 1rem',
  background: 'rgba(42, 36, 32, 0.04)',
  border: '1px solid rgba(42, 36, 32, 0.15)',
  borderRadius: '0.5rem',
  color: '#2a2420',
  fontSize: '0.88rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const inlineFooterSubmitStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.45rem 1.6rem 0.45rem 0.45rem',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: '2rem',
  boxShadow: '0 0 14px 3px rgba(0,200,228,0.22), 0 2px 6px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
  fontSize: 'clamp(0.9rem, 1.3vw, 1rem)',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const agencyMarqueeShellStyle = {
  width: '100%',
  maxWidth: '325px',
  overflow: 'hidden',
  maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
};

const agencyMarqueeTrackStyle = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  transform: 'translate3d(0, 0, 0)',
};

const agencyMarqueeSetStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '2rem',
  paddingRight: '2rem',
  flexShrink: 0,
};

const agencyLogoStyle = {
  height: '22px',
  width: 'auto',
  display: 'block',
  opacity: 0.45,
  filter: 'grayscale(1)',
  flexShrink: 0,
};

const inlineFooterCreditRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'clamp(1rem, 2vw, 1.4rem)',
  width: '100%',
  maxWidth: '42rem',
};

const inlineFooterCreditLineStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  width: '100%',
  justifyContent: 'center',
  textAlign: 'center',
};

const inlineFooterInnerDividerStyle = {
  width: '100%',
  maxWidth: '42rem',
  height: '1px',
  background: 'rgba(42, 36, 32, 0.12)',
  margin: 0,
};

const inlineFooterBottomStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.75rem',
  marginTop: 'clamp(1.5rem, 3vw, 2.5rem)',
};

const inlineFooterCopyrightStyle = {
  fontSize: '0.78rem',
  color: 'rgba(42, 36, 32, 0.35)',
};

const inlineFooterLegalStyle = {
  display: 'flex',
  gap: '1.5rem',
};

const inlineFooterLegalLinkStyle = {
  fontSize: '1.4rem',
  color: 'rgba(42, 36, 32, 0.4)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const cmoTableHeadingStyle = {
  margin: '0 0 0.6rem',
  fontSize: 'clamp(0.65rem, 0.8vw, 0.75rem)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.55)',
  fontFamily: "'Space Mono', monospace",
};

const cmoNoWebsiteLinkStyle = {
  display: 'block',
  margin: '0.85rem 0 0',
  textAlign: 'center',
  fontSize: '0.7rem',
  fontWeight: 400,
  letterSpacing: '0.02em',
  textTransform: 'none',
  color: 'rgba(42, 36, 32, 0.6)',
  fontFamily: "'Space Mono', monospace",
  textDecoration: 'underline',
  textDecorationThickness: '0.5px',
  textUnderlineOffset: '3px',
  cursor: 'pointer',
};

const cmoTableFootingStyle = {
  margin: '0.85rem 0 0',
  textAlign: 'center',
  fontSize: 'clamp(0.65rem, 0.8vw, 0.75rem)',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.55)',
  fontFamily: "'Space Mono', monospace",
};

const inlineFooterPoweredByStyle = {
  flexBasis: '100%',
  textAlign: 'center',
  margin: '0.75rem 0 0',
  fontFamily: "'Space Mono', monospace",
  fontSize: 'clamp(0.7rem, 1vw, 0.82rem)',
  letterSpacing: '0.04em',
  color: 'rgba(42, 36, 32, 0.5)',
  fontWeight: 400,
};

const particleGearButtonStyle = {
  position: 'absolute',
  top: '0.5rem',
  right: '0.5rem',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.75rem',
  height: '1.75rem',
  background: 'rgba(42, 36, 32, 0.55)',
  border: '1px solid rgba(42, 36, 32, 0.2)',
  borderRadius: '0.4rem',
  color: 'rgba(245, 241, 223, 0.8)',
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
};

const debugPanelStyle = {
  position: 'fixed',
  top: '50%',
  right: '1.25rem',
  transform: 'translateY(-50%)',
  zIndex: 10000,
  width: '260px',
  background: 'rgba(18, 15, 12, 0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.875rem',
  boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
  backdropFilter: 'blur(16px)',
  color: '#f5f1df',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: '0.8rem',
  overflow: 'hidden',
};

const debugPanelHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const debugPanelTitleStyle = {
  fontSize: '0.75rem',
  fontFamily: "'Space Mono', monospace",
  fontWeight: 400,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(245,241,223,0.6)',
};

const debugPanelSmallBtnStyle = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.3rem',
  color: 'rgba(245,241,223,0.7)',
  fontSize: '0.68rem',
  padding: '0.2rem 0.6rem',
  cursor: 'pointer',
};

const debugPanelPresetsStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.35rem',
  padding: '0.6rem 1rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const debugPresetTagStyle = {
  fontSize: '0.65rem',
  color: 'rgba(245,241,223,0.4)',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: '0.25rem',
  padding: '0.1rem 0.4rem',
};

const debugSlidersStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  padding: '0.5rem 1rem 1rem',
  maxHeight: '60vh',
  overflowY: 'auto',
};

const debugSliderRowStyle = {
  paddingTop: '0.55rem',
  paddingBottom: '0.1rem',
};

const debugSliderLabelRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '0.25rem',
};

const debugSliderLabelStyle = {
  fontSize: '0.72rem',
  color: 'rgba(245,241,223,0.65)',
};

const debugSliderValueStyle = {
  fontSize: '0.7rem',
  fontVariantNumeric: 'tabular-nums',
  color: 'rgba(245,241,223,0.45)',
};

const debugRangeStyle = {
  width: '100%',
  accentColor: '#f5f1df',
  cursor: 'pointer',
};

export default StackedSlidesSection;
