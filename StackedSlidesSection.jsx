'use client';
import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ReelPlayer from './ReelPlayer';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { createSharedParticleGalleryRenderer } from './sharedParticleGalleryRenderer';
import { BrainIcon } from './components/ui/brain';
import SubscribeModal from './components/payments/SubscribeModal';
import DeliverableHoverCard from './components/home/DeliverableHoverCards';
import AnchorLavaShader from './components/home/AnchorLavaShader';
import { scrambleMask, scrambleTextTo } from './components/home/scrambleText';
import UpRightArrow from './components/UpRightArrow';
import CreateCaseStudyModal from './CreateCaseStudyModal';
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
  Check,
  Blocks,
  Gamepad2,
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

// Marquee logos are sized by optical AREA, not by height: matching heights makes
// a 6.6:1 wordmark (Greystripe) tower over a 1:1 crest (Publicis) in ink, and
// matching areas alone shrinks the long wordmarks to nothing. So each `scale`
// solves height = sqrt(TARGET_AREA / aspect) off the 22px base, clamped to
// 18-32px so no mark gets unreadable or oversized. Target area ≈ 2000px².
// Recompute `scale` with that formula when adding a logo; `w`/`h` stay the
// PNG's intrinsic size (Next/Image needs the real ratio).
// Rendered height is AGENCY_LOGO_BASE_HEIGHT * scale. `bearing` is each PNG's
// own transparent margin in SOURCE px [left, right], measured off the alpha
// channel; the render pulls it back out with a negative margin so the visible
// gap between marks is the flex gap for every pair, not "gap + whatever padding
// that particular file happened to ship with".
const AGENCY_LOGO_BASE_HEIGHT = 14.7;
const agencyLogos = [
  // 1.05:1 crest + two lines of type — the tallest mark on the strip.
  { src: '/img/agencies/publicis.png', alt: 'Publicis', scale: 1.45, w: 105, h: 100, bearing: [2, 5] },
  { src: '/img/agencies/epsilon.png', alt: 'Epsilon', scale: 1.06, w: 175, h: 48, bearing: [0, 1] },
  { src: '/img/agencies/conversant.png', alt: 'Conversant', scale: 0.87, w: 228, h: 42 },
  { src: '/img/agencies/alliance.png', alt: 'Alliance Data', scale: 1.01, w: 201, h: 50, bearing: [3, 3] },
  // Widest mark (6.6:1), ink flush to both edges — so the shortest of the set.
  { src: '/img/agencies/greystripe.png', alt: 'Greystripe Media', scale: 0.82, w: 265, h: 40 },
  // Stacked mark + wordmark on an opaque plate: reads heavier than a transparent
  // wordmark at the same area, so it sits a step below the formula.
  { src: '/img/agencies/valueclick.png', alt: 'ValueClick', scale: 1.22, w: 161, h: 76 },
];

// Public source for every quote below. LinkedIn exposes no permalink to an
// individual recommendation, so the profile section is the closest citation.
const LINKEDIN_RECOMMENDATIONS_URL = 'https://www.linkedin.com/in/bryanballi/details/recommendations/';

// Quotes are condensed from each recommender's LinkedIn recommendation.
// `linkedinUrl` is the recommender's own profile — the per-quote citation.
const testimonials = [
  {
    quote: 'Transforms ideas into polished, high-impact experiences. Strong across devices, highly responsive, and consistently delivers under pressure.',
    name: 'Melissa Hsiao',
    title: 'Industry Lead',
    company: 'TikTok',
    img: '/img/melissa.jpg',
    linkedinUrl: 'https://www.linkedin.com/in/melissahsiao/',
  },
  {
    quote: 'Rare ability to operate across both design and development. Pixel-perfect execution with deep technical ownership across platforms.',
    name: 'Jeanne Cheung',
    title: 'Director, Design Management',
    company: 'HBO Max',
    img: '/img/jeanne.jpg',
    linkedinUrl: 'https://www.linkedin.com/in/jeannecheung/',
  },
  {
    quote: 'Brings expert-level creative and technical thinking across platforms. Pushes concepts further and executes with precision.',
    name: 'Eric Farias',
    title: 'Senior Art Director',
    company: 'Epsilon',
    img: '/img/eric.jpg',
    linkedinUrl: 'https://www.linkedin.com/in/ericfarias/',
  },
  {
    quote: 'A go-to for complex creative builds across desktop, mobile, and video. Combines technical depth with strong design instincts.',
    name: 'Vanessa D\'Amore',
    title: 'Sr. Product Manager (AI, SaaS, Integrations)',
    company: 'TST',
    img: '/img/vanessa.jpg',
    linkedinUrl: 'https://www.linkedin.com/in/vdamore/',
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
    supportText: 'Meet With Your Human',
    gridItems: Array(17).fill(null).map((_, i) => ({ id: i })),
    serviceItems: [
      { id: 0, label: 'Product Development' },
      { id: 1, label: 'Agentic Automation' },
      { id: 2, label: 'Decentralized Ecosystems' },
    ],
  },
];

const getInitials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

const FILTERS = ['Design', 'Websites', 'Content', 'Video', 'AI Workflows', 'Blockchain'];

const FILTER_WORK_LABEL = {
  default: 'Selected Work',
};

const INTRO_SIGNATURE = 'Creative Lead';

const INTRO_LEAD = 'My background spans art direction, front-end development, creative technology, and digital marketing.';

// Icon-only social marks beside the signature. Inline SVG: lucide dropped its
// Twitter/LinkedIn glyphs.
const XLogo = (props) => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// The previous path ran to x=24.78 — past the 24-wide viewBox — so the right
// edge of the "in" mark was sliced flat. This one closes at exactly x=24, and
// the box drops 13 -> 12 because the new path fills all 24 units where the old
// one only covered ~22, keeping the mark's rendered size the same.
const LinkedInLogo = (props) => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M4.98 3.5C4.98 4.881 3.87 6 2.5 6S0 4.881 0 3.5 1.12 1 2.5 1s2.48 1.119 2.48 2.5zM5 8H0v16h5V8zm7.982 0H8.014v16h4.968v-8.399c0-4.67 6.029-5.052 6.029 0V24H24V13.869c0-7.88-8.922-7.593-11.018-3.714V8z" />
  </svg>
);

const INTRO_SOCIALS = [
  { label: 'X', href: 'https://x.com/bai_ee', icon: XLogo },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/bryanballi', icon: LinkedInLogo },
];

const INTRO_COPY_PRIMARY = 'At HITLOOP, I guide projects from early direction through launch, growth, and support. Providing hands-on design, development, and marketing solutions.';
const INTRO_COPY_SECONDARY = 'Share your website or email below to get onboarded with a project dashboard or onboarding call.';

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
  '/img/port/frame_3.webp',
  '/img/port/frame_5.webp',
  '/img/port/fast_poker_ui_1.webp',
  '/img/port/frame_1.webp',
  '/img/port/frame_7.webp',
  '/img/port/claire.webp',
  '/img/port/cq_figma.webp',
  '/img/port/cq_guide.webp',
  '/img/port/viva.webp',
];

// ── PREVIOUS ONBOARD NOW deliverable rows — kept for rollback ──────────────
// Superseded by the outcome-framed rows below (5 items instead of 7 feature
// names). Restore by swapping this block back in for the ONBOARD NOW group
// in CMO_TABLE_ROWS; the Daily Brief group is unchanged and lives in both.
//
// const CMO_TABLE_ROWS_PREVIOUS_ONBOARD = [
//   { task: 'ONBOARD NOW',            value: "I take a look at your existing site design, features, and performance. ", bold: true },
//   { task: 'Creative Brief',         value: 'A downloadable document of your brand, website, and content.', sub: true },
//   { task: 'Website Scan',           value: "A fast review of your site's design, performance, user experience, and opportunities before making any changes.", sub: true },
//   { task: 'Ownership', value: "See what's portable, what's platform-dependent, and what you actually own before deciding to rebuild or migrate.", sub: true },
//   { task: 'Video Mockup',           value: 'See your brand in motion with a short social-ready video built from your current website.', sub: true },
//   { task: 'Device Views',           value: 'Preview your homepage across desktop, tablet, and mobile.', sub: true },
//   { task: 'Social Preview',         value: 'See how your brand appears when someone shares your website.', sub: true },
//   { task: 'Post Concept',           value: 'A finished post concept generated from your brief, ready to publish or refine.', sub: true },
// ];

const CMO_TABLE_ROWS = [
  { task: 'DASHBOARD',              value: 'Onboarding Brief', bold: true },
  { task: 'What I see',             value: 'Concise read on positioning, design, messaging.', sub: true },
  { task: 'What AI Sees',           value: 'Agent Readiness & SEO score.', sub: true },
  { task: 'Screenshots',            value: 'Cross-device screen captures and mockups.', sub: true },
  { task: 'Key insight',            value: 'The one thing most worth fixing.', sub: true },
  { task: 'Daily Brief',            value: 'Ongoing Support', bold: true },
  { task: 'Marketing',              value: 'Track positioning, competitors, offers, and content openings, then turn that into useful next steps.', sub: true },
  { task: 'Creative',               value: 'Keep the look, voice, and direction consistent as new assets, posts, and campaigns get made.', sub: true },
  { task: 'Social Media',           value: 'Know what to post, when to post, and why, without rebuilding the plan every day.', sub: true },
  { task: 'Web',                    value: 'Keep an eye on your site experience, share previews, SEO basics, and the fixes that affect trust.', sub: true },
  { task: 'Automation',             value: 'Connect the repeated work so updates, briefs, content, and reporting take less manual effort.', sub: true },
];

// Maps deliverable table rows to their hard-coded HITLOOP hover preview card.
// Rows not listed (Website Scan, Website Ownership Review, Daily Brief + its director sub-rows) have no preview.
const TASK_TO_CARD = {
  'ONBOARD NOW': 'creative-brief',
  'Creative Brief': 'creative-brief',
  'Social Preview': 'social-preview',
  'Device Views': 'device-mockups',
  'Video Mockup': 'video-post',
  'Post Concept': 'post-me',
};

const isSubFirst = (arr, i) => arr[i].sub && (i === 0 || !arr[i - 1].sub);
const isSubLast = (arr, i) => arr[i].sub && (i === arr.length - 1 || !arr[i + 1].sub);

// Connector for Director sub rows — lives in the icon column so the trunk sits
// directly under the Daily Executive Brief lock and flows up into it, with
// rounded branch elbows reaching toward each Director label (aggregation read).
const BriefConnector = ({ first, last }) => (
  <span className={`cmo-conn${first ? ' cmo-conn--first' : ''}${last ? ' cmo-conn--last' : ''}`} aria-hidden="true">
    {first ? (
      <svg className="cmo-conn-arrow" width="11" height="7" viewBox="0 0 11 7" fill="none">
        <path d="M1 6 L5.5 1 L10 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : null}
  </span>
);

// Index of the "Daily Brief" section header. Everything after it is its
// collapsible director sub-rows (Marketing, Creative, Social Media, …).
const DAILY_BRIEF_INDEX = CMO_TABLE_ROWS.findIndex((r) => r.task === 'Daily Brief');

// Index of the "DASHBOARD" section header. Its sub-rows run up to the Daily
// Brief header and collapse under the same click-to-expand pattern.
const DASHBOARD_INDEX = CMO_TABLE_ROWS.findIndex((r) => r.task === 'DASHBOARD');

// Shared body for the deliverables table (desktop + mobile variants). Both
// "DASHBOARD" and "Daily Brief" are click-to-expand section headers, collapsed
// by default: each hides its own sub-rows until opened, and Daily Brief's long
// description collapses to a chevron. DASHBOARD keeps its description and shows
// the chevron beside it. Row hover is disabled (data-no-hover on desktop rows).
function CmoTableRows({ dailyBriefOpen, onToggleDaily, dashboardOpen, onToggleDashboard, variant }) {
  return CMO_TABLE_ROWS.map((row, ri, arr) => {
    if (ri > DAILY_BRIEF_INDEX && !dailyBriefOpen) return null;
    if (ri > DASHBOARD_INDEX && ri < DAILY_BRIEF_INDEX && !dashboardOpen) return null;
    const isDaily = row.task === 'Daily Brief';
    const isDashboard = row.task === 'DASHBOARD';
    const isToggle = isDaily || isDashboard;
    const isOpen = isDaily ? dailyBriefOpen : dashboardOpen;
    const variantProps = variant === 'desktop'
      ? { 'data-no-hover': true }
      : { 'data-sub': row.sub || undefined, 'data-sublast': isSubLast(arr, ri) || undefined };
    return (
      <tr
        key={row.task}
        {...variantProps}
        data-daily={isDaily || undefined}
        data-dashboard={isDashboard || undefined}
        onClick={isToggle ? (isDaily ? onToggleDaily : onToggleDashboard) : undefined}
        role={isToggle ? 'button' : undefined}
        aria-expanded={isToggle ? isOpen : undefined}
        style={{ borderBottom: (row.task === 'Daily Brief' || row.task === 'DASHBOARD' || (row.sub && !isSubLast(arr, ri))) ? 'none' : '1px solid rgba(42,36,32,0.07)', cursor: isToggle ? 'pointer' : undefined }}
      >
        <td style={{ padding: '0.7rem 0.2rem', textAlign: 'center', verticalAlign: 'middle', position: 'relative' }}>{row.task === 'DASHBOARD' ? <Check size={18} strokeWidth={3} color="#2f6fed" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : row.sub ? <BriefConnector first={isSubFirst(arr, ri)} last={isSubLast(arr, ri)} /> : <span className="cmo-arrow" aria-hidden="true"><Lock size={12} /></span>}</td>
        <td style={{ padding: row.sub ? '0.7rem 0.4rem 0.7rem 1.1rem' : '0.7rem 0.4rem', color: row.sub ? 'rgba(42,36,32,0.55)' : 'rgba(42,36,32,0.75)', fontWeight: row.bold ? 700 : (row.sub ? 400 : 500) }}>{row.task === 'DASHBOARD' ? 'Dashboard' : row.task}</td>
        <td style={{ padding: '0.7rem 0.4rem 0.7rem 0.6rem', textAlign: 'left', color: row.sub ? 'rgba(42,36,32,0.48)' : 'rgba(42,36,32,0.65)', fontWeight: row.bold ? 700 : 400 }}>{isToggle ? (
          <span style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <span>{row.value}</span>
            <span style={{ display: 'inline-flex', flexShrink: 0, marginTop: 2, transition: 'transform 0.15s ease', transform: isOpen ? 'rotate(180deg)' : 'none', color: 'rgba(42,36,32,0.5)' }} aria-hidden="true"><svg width="15" height="15" viewBox="0 0 12 12" fill="none"><polyline points="2,4 6,8 10,4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          </span>
        ) : row.value}</td>
      </tr>
    );
  });
}

// Bryan's ABOUT block: identity column (eyebrow, name, role, discipline tags)
// beside the copy column, split at 900px to match the deliverables card's own
// desktop breakpoint. Rendered once inside #cmo-dashboard-card, above the URL
// input. Grid + divider live in the panel stylesheet (#cmo-about-split).
const ABOUT_HEADING_COPY = 'I\u2019m Bryan Balli';
const ABOUT_HEADING_SCRAMBLE_MS = 700;
const ABOUT_HEADING_REVERSE_MS = 450; // scrambling back out is quicker than resolving in

function HitloopAboutBlock() {
  const aboutHeadingRef = useRef(null);

  // Same scramble effect as the hero subheadline, played whenever the about
  // heading enters the viewport and reversed whenever it leaves — in either
  // scroll direction.
  useLayoutEffect(() => {
    const node = aboutHeadingRef.current;
    if (!node) return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const maskCopy = () => scrambleMask(ABOUT_HEADING_COPY, { preserveWhitespace: true });

    // Swap in a same-length, space-preserving mask so there is no layout shift
    // and no flash of the final copy before the reveal. The mask stays fully
    // transparent — the scramble fades up as it resolves.
    node.textContent = maskCopy();
    gsap.set(node, { opacity: 0 });

    let cancelScramble = null;
    const stopScramble = () => {
      if (cancelScramble) cancelScramble();
      cancelScramble = null;
      gsap.killTweensOf(node);
    };

    // Resolve the mask into the real copy, fading up as it locks in.
    const revealIn = () => {
      stopScramble();
      gsap.to(node, {
        opacity: 1,
        duration: ABOUT_HEADING_SCRAMBLE_MS / 1000,
        ease: 'power1.out',
      });
      cancelScramble = scrambleTextTo(node, ABOUT_HEADING_COPY, {
        durationMs: ABOUT_HEADING_SCRAMBLE_MS,
        preserveWhitespace: true,
      });
    };

    // Dissolve the copy back into a mask and fade out, so the next entry from
    // either direction replays the reveal.
    const reverseOut = () => {
      stopScramble();
      gsap.to(node, {
        opacity: 0,
        duration: ABOUT_HEADING_REVERSE_MS / 1000,
        ease: 'power1.in',
      });
      cancelScramble = scrambleTextTo(node, maskCopy(), {
        durationMs: ABOUT_HEADING_REVERSE_MS,
        preserveWhitespace: true,
      });
    };

    const trigger = ScrollTrigger.create({
      trigger: node,
      start: 'top 85%',
      end: 'bottom 15%',
      onEnter: revealIn,
      onEnterBack: revealIn,
      onLeave: reverseOut,
      onLeaveBack: reverseOut,
    });

    return () => {
      stopScramble();
      trigger.kill();
      gsap.set(node, { clearProps: 'opacity' });
      node.textContent = ABOUT_HEADING_COPY;
    };
  }, []);

  return (
    <div id="cmo-about-split">
      <div id="cmo-about-identity-col">
        <div id="cmo-about-identity-header" style={aboutIdentityHeaderStyle}>
          {/* Shell owns the sizing: a replaced <img> ignores align-items:stretch
              and falls back to its intrinsic box, so below 900px the shell is the
              flex item that stretches to the name + role stack and the image just
              fills it. */}
          <span id="cmo-about-avatar-shell" style={aboutIdentityAvatarShellStyle}>
            <Image
              id="cmo-about-avatar"
              src="/img/profile2_400x400.png"
              width={72}
              height={72}
              alt="Bryan Balli"
              style={aboutIdentityAvatarStyle}
            />
          </span>
          <div id="cmo-about-identity-textstack" style={aboutIdentityTextStackStyle}>
            <h2 id="cmo-about-heading" ref={aboutHeadingRef} style={aboutHeadingStyle}>{ABOUT_HEADING_COPY}</h2>
            <div id="cmo-about-signature-row" style={aboutSignatureRowStyle}>
              {/* <span id="cmo-about-signature-dot" aria-hidden="true" style={aboutSignatureDotStyle} /> */}
              <span id="cmo-about-signature" style={aboutSignatureStyle}>{INTRO_SIGNATURE}</span>
              <span id="cmo-about-signature-divider" aria-hidden="true" style={aboutSignatureDividerStyle} />
              <div id="cmo-about-signature-socials" style={aboutSignatureSocialsRowStyle}>
                {INTRO_SOCIALS.map(({ label, href, icon: Icon }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={label}
                    title={label}
                    className="about-signature-social-link"
                    style={aboutSignatureSocialStyle}
                    onMouseEnter={(e) => e.stopPropagation()}
                    onMouseLeave={(e) => e.stopPropagation()}
                  >
                    <Icon />
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p id="cmo-about-lead" style={aboutLeadStyle}>{INTRO_LEAD}</p>
        <div id="cmo-about-previously-block" style={{ width: '100%' }}>
          <div id="cmo-about-previously-row" style={aboutPreviouslyRowStyle}>
            <span id="cmo-about-previously-label" style={aboutPreviouslyLabelStyle}>previously at</span>
            <span id="cmo-about-previously-rule" aria-hidden="true" style={aboutPreviouslyRuleStyle} />
          </div>
          <div id="cmo-about-agency-marquee" style={aboutAgencyMarqueeShellStyle}>
            <div style={aboutAgencyMarqueeTrackStyle}>
              {[0, 1].map((copy) => (
                <div key={copy} aria-hidden={copy > 0 ? 'true' : undefined} style={agencyMarqueeSetStyle}>
                  {agencyLogos.map((logo) => (
                    <Image
                      key={`about-agency-${copy}-${logo.alt}`}
                      src={logo.src}
                      alt={copy > 0 ? '' : logo.alt}
                      width={logo.w}
                      height={logo.h}
                      style={agencyLogoImgStyle(logo)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div id="cmo-about-divider" aria-hidden="true" />
      <div id="cmo-about-copy-col">
        <p id="cmo-about-mission-statement" style={aboutMissionStatementStyle}>{INTRO_COPY_PRIMARY}</p>
        <p style={aboutCopyCtaLineStyle}>{INTRO_COPY_SECONDARY}</p>
      </div>
    </div>
  );
}

const AUTOMATION_CAPABILITIES = [
  {
    badge: 'BI',
    badgeColor: '#8b5cf6',
    icon: 'book',
    previewImage: '/img/port/frame_8.webp',
    previewVideo: '/vid/Executive_support.mp4',
    title: 'Brand Identity & Design',
    body: 'Logos, visual systems, and brand kits, built to hold up across every surface your business shows up on.',
  },
  {
    badge: 'WL',
    badgeColor: '#0ea5e9',
    icon: 'laptop',
    previewImage: '/img/port/cq_figma.webp',
    previewVideo: '/vid/knowledge_assistant.mp4',
    title: 'Websites & Landing Pages',
    body: 'Designed, built, and optimized to convert. Sites that perform on every screen, at every stage.',
  },
  {
    badge: 'SC',
    badgeColor: '#14b8a6',
    icon: 'workflow',
    previewImage: '/img/port/frame_5.webp',
    previewVideo: '/vid/creative_pipeline.mp4',
    title: 'Social Media & Content',
    body: 'Posts, captions, and content strategy aligned to how your brand sounds and what your audience wants.',
  },
  {
    badge: 'VM',
    badgeColor: '#10b981',
    icon: 'settings',
    previewImage: '/img/port/frame_6.webp',
    previewVideo: '/vid/Daily_operations.mp4',
    title: 'Video & Motion',
    body: 'Short-form content, reels, and visual storytelling crafted to get watched, saved, and shared.',
  },
  {
    badge: 'SEO',
    badgeColor: '#f97316',
    icon: 'search',
    previewImage: '/img/port/claire.webp',
    previewVideo: '/vid/ai_research.mp4',
    title: 'SEO & Content Strategy',
    body: 'Search visibility and structured content growth: the long game, built to compound over time.',
  },
  {
    badge: 'EM',
    badgeColor: '#ec4899',
    icon: 'arrow',
    previewImage: '/img/port/edittrax.webp',
    previewVideo: '/vid/email_marketing.mp4',
    title: 'Email & Newsletter Systems',
    body: 'Campaigns, automated flows, and newsletters built to keep your audience close and revenue moving.',
  },
  {
    badge: 'DB',
    badgeColor: '#f59e0b',
    icon: 'chart',
    previewImage: '/img/port/frame_7.webp',
    previewVideo: '/vid/dashboard.mp4',
    title: 'Daily Briefs',
    body: 'Automated daily intelligence briefings that surface what matters: competitor moves, content opportunities, and operational signals, delivered to your dashboard every morning.',
  },
  {
    badge: 'AI',
    badgeColor: '#6366f1',
    icon: 'brain',
    previewImage: '/img/port/cq_guide.webp',
    previewVideo: '/vid/company_brain.mp4',
    title: 'AI Automation & Workflows',
    body: 'Custom systems that remove manual work and scale output, built around how your business actually runs.',
  },
  {
    badge: 'BC',
    badgeColor: '#f97316',
    icon: 'blocks',
    previewImage: '/img/port/frame_3.webp',
    title: 'Blockchain',
    body: 'Web3 product design, token UX, and smart contract interfaces, built for clarity in a space where trust is everything.',
  },
  {
    badge: 'GM',
    badgeColor: '#a855f7',
    icon: 'gamepad',
    previewImage: '/img/port/critters_game1.webp',
    title: 'Gaming',
    body: 'Game UI, interactive experiences, and player-facing systems designed to keep users engaged and coming back.',
  },
  // --- Multi-Agent Intelligence Pipeline cards (reserved for future use) ---
  // {
  //   badge: 'MAP',
  //   badgeColor: '#0ea5e9',
  //   icon: 'bot',
  //   previewImage: '/img/port/frame_3.webp',
  //   previewVideo: '/vid/dashboard.mp4',
  //   title: 'Multi-Agent Intelligence Pipeline',
  //   body: 'A four-stage agent architecture — Scout, Scribe, Guardian, Reporter — runs automatically each day, taking raw market data from five sources and producing a founder-ready content brief with zero manual input.',
  // },
  // {
  //   badge: 'HSA',
  //   badgeColor: '#14b8a6',
  //   icon: 'search',
  //   previewImage: '/img/port/frame_5.webp',
  //   previewVideo: '/vid/ai_research.mp4',
  //   title: 'Hyperlocal Signal Aggregation',
  //   body: 'Scout pulls live data from X/Twitter, Instagram, Reddit, customer reviews, and weather APIs, normalizes them into a unified intelligence format, and trims context to ~5K tokens before synthesis — optimized to under $0.10 per full run.',
  // },
  // {
  //   badge: 'PCG',
  //   badgeColor: '#ec4899',
  //   icon: 'workflow',
  //   previewImage: '/img/port/edittrax.webp',
  //   previewVideo: '/vid/creative_pipeline.mp4',
  //   title: 'Platform-Specific Content Generation',
  //   body: "Scribe reads the day's brief and produces ready-to-publish drafts for Instagram, X/Twitter, Facebook, and Discord — each formatted to platform conventions and constrained by brand voice rules defined in client knowledge files.",
  // },
  // {
  //   badge: 'BSG',
  //   badgeColor: '#ef4444',
  //   icon: 'shield',
  //   previewImage: '/img/port/frame_4.webp',
  //   previewVideo: '/vid/compliance.mov',
  //   title: 'Brand Safety & Quality Gate',
  //   body: 'Guardian runs four sequential validation checks on every piece of generated content: restricted term scanning, competitor mention detection, factual accuracy, and brand voice scoring — outputting a readiness verdict and 0–100 quality score before anything moves forward.',
  // },
  // {
  //   badge: 'FDB',
  //   badgeColor: '#f59e0b',
  //   icon: 'chart',
  //   previewImage: '/img/port/frame_7.webp',
  //   previewVideo: '/vid/dashboard.mp4',
  //   title: 'Founder-Facing Daily Brief',
  //   body: "Reporter transforms the day's intelligence, content drafts, and QA results into a formatted HTML briefing — with operational context, review insights, Reddit signals, competitor activity, and content opportunities — delivered to the admin dashboard on schedule.",
  // },
  // {
  //   badge: 'ADB',
  //   badgeColor: '#6366f1',
  //   icon: 'laptop',
  //   previewImage: '/img/port/critters_game1.webp',
  //   previewVideo: '/vid/dashboard.mp4',
  //   title: 'Admin Dashboard & Brief History',
  //   body: 'A real-time web dashboard surfaces the latest pipeline run: priority action, weather impact, content angle, Guardian verdict, and cost per run. A full archive of past runs lets the team compare briefs, track signal trends, and trigger fresh runs on demand.',
  // },
  // {
  //   badge: 'IGA',
  //   badgeColor: '#a855f7',
  //   icon: 'folder',
  //   previewImage: '/img/port/fast_poker_style.webp',
  //   previewVideo: '/vid/creative_pipeline.mp4',
  //   title: 'Image Generation & Asset Management',
  //   body: 'A canvas-based generator handles post image production — with configurable presets, logo placement controls, and live preview. Completed renders upload to Firebase Storage and attach automatically to the current brief run.',
  // },
  // {
  //   badge: 'KFC',
  //   badgeColor: '#10b981',
  //   icon: 'book',
  //   previewImage: '/img/port/frame_8.webp',
  //   previewVideo: '/vid/company_brain.mp4',
  //   title: 'Knowledge-File Client Configuration',
  //   body: 'The entire system adapts to a new client by swapping four JSON files: brand voice rules, intelligence config, business facts, and a restricted-terms glossary. No code changes required to onboard a new brand or vertical.',
  // },
  {
    badge: 'YB',
    badgeColor: '#0ea5e9',
    icon: 'chart',
    tablePreview: true,
    previewVideo: '/vid/dashboard.mp4',
    title: "Onboard now, save time later.",
    // No body — the card runs heading straight into the URL input. Previous
    // copy, kept for rollback:
    //   "Every website serves a different purpose, whether it's building an identity, publishing content, selling products, or helping people find your work. My goal is to retain the integrity of your brand and give you a system to own."
    //   "I’ll take a look, understand what you’re trying to do, and help figure out what makes sense next."
    body: '',
  },
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
  blocks: Blocks,
  gamepad: Gamepad2,
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

// Classify the hero input: a website URL/domain, an email address, or a free-text
// brand name / idea. Lets a user without a website spin up a dashboard from an
// email or a name/idea instead.
function classifyHomepageInput(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return { kind: 'empty', value: '' };
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(trimmed)) return { kind: 'email', value: trimmed.toLowerCase() };
  const looksUrl = /^https?:\/\//i.test(trimmed) || (!/\s/.test(trimmed) && /\.[a-z]{2,}$/i.test(trimmed));
  if (looksUrl && isValidHomepageUrl(trimmed)) return { kind: 'url', value: normalizeHomepageUrl(trimmed) };
  if (trimmed.length >= 2) return { kind: 'idea', value: trimmed };
  return { kind: 'empty', value: '' };
}

const StackedSlidesSection = () => {
  const wrapperRef = useRef(null);
  const servicesViewportRef = useRef(null);
  const servicesCanvasRef = useRef(null);
  const marqueeShellRef = useRef(null);
  const marqueeTrackRef = useRef(null);
  const marqueeSetRef = useRef(null);
  const agentMarqueeShellRef = useRef(null);
  const agentMarqueeTrackRef = useRef(null);
  const agentMarqueeSetRef = useRef(null);
  const peekCard1Ref = useRef(null);
  const peekCard2Ref = useRef(null);
  const peekCard3Ref = useRef(null);
  const peekCard4Ref = useRef(null);

  const [pokerHovered, setPokerHovered] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null);
  const [filterCopy, setFilterCopy] = useState(FILTER_COPY.default);
  const [particleParams, setParticleParams] = useState(PARTICLE_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeMobileCapability, setActiveMobileCapability] = useState(null);
  const [dailyBriefOpen, setDailyBriefOpen] = useState(false); // deliverables table: Daily Brief section collapsed by default
  const [dashboardOpen, setDashboardOpen] = useState(false); // deliverables table: DASHBOARD section collapsed by default
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [caseStudyImage, setCaseStudyImage] = useState(null);
  const CMO_PLACEHOLDER_URL = 'yourwebsite.com';
  const [homepageUrl, setHomepageUrl] = useState('');
  const [urlIsValid, setUrlIsValid] = useState(false);
  // Desktop-only hover preview: floats a static HITLOOP deliverable card next to
  // the hovered table row. { id, top, left } or null.
  // Hover-preview cards. Each consecutive hover alternates the side it slides in
  // from (right → over the right of the table, left → over the left), and the
  // previous card slides back off its own side as the new one slides in.
  const [hoverCards, setHoverCards] = useState([]); // [{ key, id, top, left, offX, rot, shown }]
  const cardTimer = useRef(null);
  const cardKey = useRef(0);
  const lastSide = useRef(null);
  const raf2 = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const placeRowCard = (rect, side) => {
    const CARD_W = 380;
    const CARD_H = 460;
    const M = 8;
    let top = rect.top + rect.height / 2 - CARD_H / 2;
    top = Math.max(M, Math.min(top, window.innerHeight - CARD_H - M));
    let left = side === 'right' ? rect.right - 130 : rect.left - CARD_W + 130;
    left = Math.min(left, window.innerWidth - CARD_W - M);
    left = Math.max(left, M);
    return { top, left, offX: side === 'right' ? 88 : -88, rot: side === 'right' ? 3.2 : -3.2 };
  };
  const showRowCard = (e, task) => {
    if (isTouchScrollDevice()) return;
    const id = TASK_TO_CARD[task];
    if (!id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side = 'right'; // keep every card on the right (no left/right alternation)
    lastSide.current = side;
    const { top, left, offX, rot } = placeRowCard(rect, side);
    const key = (cardKey.current += 1);
    if (cardTimer.current) { clearTimeout(cardTimer.current); cardTimer.current = null; }
    // Existing cards start sliding out; the new one mounts off-screen on its side.
    setHoverCards((prev) => [...prev.map((c) => ({ ...c, shown: false })), { key, id, top, left, offX, rot, shown: false }]);
    raf2(() => setHoverCards((prev) => prev.map((c) => (c.key === key ? { ...c, shown: true } : c))));
    // After the slide completes, drop everything but the newest card.
    cardTimer.current = setTimeout(() => {
      setHoverCards((prev) => prev.filter((c) => c.key === key));
      cardTimer.current = null;
    }, 760);
  };
  const hideRowCard = () => {
    setHoverCards((prev) => prev.map((c) => ({ ...c, shown: false })));
    if (cardTimer.current) clearTimeout(cardTimer.current);
    cardTimer.current = setTimeout(() => { setHoverCards([]); cardTimer.current = null; }, 760);
  };
  // "Get Your Dashboard" hover image (dash.png pop) disabled for now — handlers
  // removed from the button. Kept commented for easy restore.
  // const showDashHover = (e) => {
  //   if (isTouchScrollDevice()) return;
  //   const rect = e.currentTarget.getBoundingClientRect();
  //   const M = 10;
  //   const imgW = Math.min(620, Math.round(window.innerWidth * 0.46));
  //   const tableEl = typeof document !== 'undefined' ? document.querySelector('.cmo-table-inner') : null;
  //   const anchor = tableEl ? tableEl.getBoundingClientRect() : rect;
  //   let left = anchor.left - imgW + 24;
  //   left = Math.min(left, window.innerWidth - imgW - M);
  //   left = Math.max(left, M);
  //   let top = anchor.top - Math.round(imgW * 0.05);
  //   top = Math.max(M, Math.min(top, window.innerHeight - 220));
  //   const key = (cardKey.current += 1);
  //   if (cardTimer.current) { clearTimeout(cardTimer.current); cardTimer.current = null; }
  //   setHoverCards((prev) => [...prev.map((c) => ({ ...c, shown: false })), { key, kind: 'image', src: '/img/dash.png', imgW, top, left, offX: -88, rot: -3.2, shown: false }]);
  //   raf2(() => setHoverCards((prev) => prev.map((c) => (c.key === key ? { ...c, shown: true } : c))));
  //   cardTimer.current = setTimeout(() => { setHoverCards((prev) => prev.filter((c) => c.key === key)); cardTimer.current = null; }, 760);
  // };
  const [showCmoModal, setShowCmoModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const handler = () => setShowCmoModal(true);
    window.addEventListener('openOnboardModal', handler);
    return () => window.removeEventListener('openOnboardModal', handler);
  }, []);

  useEffect(() => {
    if (!showCmoModal) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowCmoModal(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('cmo-modal-open');
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.body.classList.remove('cmo-modal-open');
    };
  }, [showCmoModal]);

  const handleHomepageUrlChange = (e) => {
    const val = e.target.value;
    setHomepageUrl(val);
    // Valid when the input is a website OR a substantive name/idea.
    setUrlIsValid(classifyHomepageInput(val).kind !== 'empty');
  };

  // Booking modal for visitors who don't have a website to scan. Uses the
  // Calendly popup widget (widget.js/widget.css are injected on mount); falls
  // back to the hosted page if the widget script was blocked or hasn't loaded.
  const openCalendlyBooking = (email) => {
    const calendlyUrl = 'https://calendly.com/bballi/30min';
    const calendly = typeof window !== 'undefined' ? window.Calendly : null;
    if (calendly?.initPopupWidget) {
      calendly.initPopupWidget(email ? { url: calendlyUrl, prefill: { email } } : { url: calendlyUrl });
      return;
    }
    const href = email ? `${calendlyUrl}?email=${encodeURIComponent(email)}` : calendlyUrl;
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const handleCreateDashboard = () => {
    const input = classifyHomepageInput(homepageUrl);
    if (input.kind === 'empty' || homepageUrl === CMO_PLACEHOLDER_URL) return;
    // No website means no site scan to run: an email (or free-text) submission
    // books an intro call instead of provisioning a dashboard.
    if (input.kind !== 'url') {
      setShowCmoModal(false);
      openCalendlyBooking(input.kind === 'email' ? input.value : '');
      return;
    }
    const params = new URLSearchParams({ flow: 'homepage-create', url: input.value });
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
                <th style="text-align:left;padding:0.3rem 0.4rem;font-weight:900;color:rgba(42,36,32,0.4);font-size:0.58rem;text-transform:uppercase;letter-spacing:0.06em;font-family:'Doto','Space Mono',monospace;">Access</th>
                <th style="width:1.2rem;"></th>
              </tr></thead>
              <tbody>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Onboarding Brief</td><td style="padding:0.38rem 0.2rem;text-align:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2f6fed" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg></td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Executive Brief</td><td style="padding:0.38rem 0.2rem;text-align:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:rgba(42,36,32,0.45);"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Market Brief</td><td style="padding:0.38rem 0.2rem;text-align:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:rgba(42,36,32,0.45);"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Creative Brief</td><td style="padding:0.38rem 0.2rem;text-align:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:rgba(42,36,32,0.45);"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Strategy Brief</td><td style="padding:0.38rem 0.2rem;text-align:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:rgba(42,36,32,0.45);"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></td></tr>
                <tr style="border-bottom:1px solid rgba(42,36,32,0.07);"><td style="padding:0.38rem 0.4rem;color:#2a2420;font-weight:500;">Website Developer Brief</td><td style="padding:0.38rem 0.2rem;text-align:center;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:rgba(42,36,32,0.45);"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></td></tr>
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

    // Popup widget needs Calendly's own stylesheet or the modal renders bare.
    const calStyles = document.createElement('link');
    calStyles.rel = 'stylesheet';
    calStyles.href = 'https://assets.calendly.com/assets/external/widget.css';
    document.head.appendChild(calStyles);

    return () => {
      hoverCleanups.forEach((cleanup) => cleanup());
      if (document.body.contains(calScript)) document.body.removeChild(calScript);
      if (document.head.contains(calStyles)) document.head.removeChild(calStyles);
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
        .toArray('[data-grid-window], #stacked-inline-footer, #inline-footer-value-block, #agency-marquee-shell, #inline-footer-seo-nav, #inline-footer-bottom', wrapper)
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

      gsap.set(cards, { autoAlpha: 1, y: 0, willChange: 'auto' });
    }, wrapper);

    return () => ctx.revert();
  }, []);


  useLayoutEffect(() => {
    const cta = document.getElementById('panel-hero-cta');
    if (!cta) return;

    const navH = () => document.getElementById('founders-top-strip')?.offsetHeight ?? 64;

    // EXPERIMENT: trigger directly off the url input row itself (a stable
    // element that's never reparented) instead of a same-position sentinel,
    // using its own bottom edge — so the CTA only appears once that row is
    // genuinely fully behind the nav, not just as soon as it starts touching it.
    const urlInputRow = document.getElementById('hero-url-input-row');

    let origParent   = null;
    let origNext     = null;
    let spacer       = null;
    let pinned       = false;
    let widthStyle   = null;
    let pinnedWidth  = 0;

    // Re-run on every resize while pinned so the CTA keeps tracking the row's
    // right edge / nav height instead of freezing at whatever viewport width
    // it was pinned at — and swaps into the centered mobile layout live if
    // the resize crosses the breakpoint, instead of only on next scroll cycle.
    const positionPinnedCta = () => {
      if (!pinned || !origParent) return;
      const isMobileNow = window.innerWidth <= 767;
      const wr = origParent.getBoundingClientRect();
      const h  = navH();
      Object.assign(cta.style, {
        // A bit more clearance below the nav strip than the old +10 — it was
        // crashing into the nav on entrance.
        top: `${h + 20}px`,
        left: isMobileNow ? '50%' : 'auto',
        right: isMobileNow ? 'auto' : `${Math.max(0, window.innerWidth - wr.right)}px`,
        transform: isMobileNow ? 'translateX(-50%)' : 'none',
        justifyContent: isMobileNow ? 'center' : '',
      });
      // Desktop: inject a <style> tag instead — React re-renders reset inline style.width='auto'
      //          and strip the !important flag, but a stylesheet !important survives that.
      // Mobile: width is CSS-driven (max-content) — no px lock needed.
      widthStyle?.parentNode?.removeChild(widthStyle);
      widthStyle = null;
      cta.style.removeProperty('width');
      if (!isMobileNow) {
        widthStyle = document.createElement('style');
        widthStyle.textContent = `#panel-hero-cta { width: ${pinnedWidth}px !important; box-sizing: border-box !important; }`;
        document.head.appendChild(widthStyle);
      }
    };

    const doPin = () => {
      if (pinned) return;
      // Guard against ScrollTrigger evaluating "already past the trigger
      // point" at mount/refresh time on short viewports (mobile) — that pins
      // the CTA immediately on load, before the user has scrolled at all.
      // A real scroll-triggered pin always happens after scrollY moves.
      if (window.scrollY < 8) return;
      origParent = cta.parentNode;
      origNext   = cta.nextSibling;
      const arrowEl    = document.getElementById('nav-scroll-top-arrow');
      const settingsEl = document.getElementById('nav-scroll-top-settings');
      if (arrowEl)    arrowEl.style.display    = '';
      if (settingsEl) settingsEl.style.display = 'none';

      // Spacer is only an insertion anchor for unpin — never a layout element.
      // The CTA is position:absolute at every width (see the #panel-hero-cta rule),
      // so removing it can't shift the row, and a display:none spacer can't be
      // counted as a flex item eating a gutter's worth of the input row's width.
      spacer = document.createElement('div');
      pinnedWidth = cta.getBoundingClientRect().width;
      spacer.style.cssText = 'display:none;';
      origParent.insertBefore(spacer, cta);
      // Pinned markers drive the CSS that closes the row's now-pointless flex
      // gap and sizes the centered mobile pill (see the #panel-hero-cta rules).
      cta.dataset.ctaPinned = 'true';
      origParent.dataset.ctaPinned = 'true';

      Object.assign(cta.style, {
        position: 'fixed',
        zIndex: '240',
        margin: '0',
        visibility: 'visible',
        pointerEvents: 'auto',
      });
      document.body.appendChild(cta);
      pinned = true;
      positionPinnedCta();
      // Animate the entrance (fade + slight drop) instead of an instant pop —
      // position/top/right above are already final, this only tweens opacity/y.
      gsap.fromTo(cta, { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out', overwrite: true });
    };

    const hideScrollBtn = () => {
      const arrowEl    = document.getElementById('nav-scroll-top-arrow');
      const settingsEl = document.getElementById('nav-scroll-top-settings');
      if (arrowEl)    arrowEl.style.display    = 'none';
      if (settingsEl) settingsEl.style.display = '';
    };

    const doUnpin = () => {
      if (!pinned || !origParent) return;
      widthStyle?.parentNode?.removeChild(widthStyle);
      widthStyle = null;
      cta.style.removeProperty('width');
      ['position','top','zIndex','margin','left','right','transform','justifyContent','opacity','visibility','pointerEvents']
        .forEach(p => { cta.style[p] = ''; });
      delete cta.dataset.ctaPinned;
      delete origParent.dataset.ctaPinned;
      origParent.insertBefore(cta, spacer);
      spacer?.parentNode?.removeChild(spacer);
      spacer    = null;
      origParent = null;
      origNext   = null;
      pinned     = false;
    };

    // Trigger's own bottom edge crossing navH()+10 from the viewport top means
    // the row has fully scrolled behind the nav, not just started touching it.
    const st = urlInputRow ? ScrollTrigger.create({
      trigger: urlInputRow,
      start: () => `bottom top+=${navH() + 10}`,
      end: () => ScrollTrigger.maxScroll(window),
      invalidateOnRefresh: true,
      onEnter:     doPin,
      onLeaveBack: () => { doUnpin(); hideScrollBtn(); },
    }) : null;

    const firstSection = document.getElementById('panel-grid-layout');
    const stFooter = firstSection ? ScrollTrigger.create({
      trigger: firstSection,
      start: 'bottom bottom',
      invalidateOnRefresh: true,
      onLeave:     doUnpin,
      onEnterBack: doPin,
    }) : null;

    const handleResize = () => positionPinnedCta();
    window.addEventListener('resize', handleResize);

    // Force a re-measure once the layout has actually settled (fonts, the
    // hero's 100dvh sizing, etc.) — creating these triggers before that can
    // make GSAP evaluate the wrong initial state on short/mobile viewports.
    const refreshId = requestAnimationFrame(() => ScrollTrigger.refresh());

    return () => {
      cancelAnimationFrame(refreshId);
      st?.kill();
      stFooter?.kill();
      window.removeEventListener('resize', handleResize);
      doUnpin();
      hideScrollBtn();
    };
  }, []);


  return (
    <section style={sectionStyle}>
      {hoverCards.length > 0 && typeof document !== 'undefined'
        ? createPortal(
            <>
              {hoverCards.map((c) => (
                <div key={c.key} style={{ position: 'fixed', top: c.top, left: c.left, zIndex: 99999, pointerEvents: 'none' }}>
                  {c.kind === 'image' ? (
                    <img
                      src={c.src}
                      alt=""
                      aria-hidden="true"
                      style={{
                        display: 'block',
                        width: c.imgW,
                        height: 'auto',
                        borderRadius: '14px',
                        boxShadow: '0 30px 90px rgba(0,0,0,0.34), 0 4px 14px rgba(0,0,0,0.12)',
                        transformOrigin: c.rot >= 0 ? 'center left' : 'center right',
                        transition: 'opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1), transform 0.72s cubic-bezier(0.22, 1, 0.36, 1)',
                        opacity: c.shown ? 1 : 0,
                        transform: c.shown ? `translateX(0) rotate(${c.rot}deg) scale(0.8)` : `translateX(${c.offX}px) rotate(${c.rot * 1.8}deg) scale(0.8)`,
                      }}
                    />
                  ) : (
                    <DeliverableHoverCard id={c.id} shown={c.shown} rot={c.rot} offX={c.offX} />
                  )}
                </div>
              ))}
            </>,
            document.body
          )
        : null}
      <style>{`
        :root {
          --font-grotesk: 'Space Grotesk', system-ui, sans-serif;
          --font-mono: 'Space Mono', monospace;
          --font-doto: 'Doto', monospace;
        }
        .font-doto {
          font-family: 'Doto', monospace;
        }
        /* Testimonial attribution + source links point at the LinkedIn originals. */
        .testimonial-author-link,
        #testimonials-linkedin-source-link {
          text-decoration: none;
          border-bottom: 1px solid transparent;
          transition: border-color 0.2s ease, color 0.2s ease;
        }
        .testimonial-author-link:hover {
          border-bottom-color: rgba(42, 36, 32, 0.35);
        }
        #testimonials-linkedin-source-link:hover {
          color: #2a2420;
          border-bottom-color: rgba(42, 36, 32, 0.35);
        }
        .about-signature-social-link {
          color: rgba(42, 36, 32, 0.4);
          transition: color 0.15s ease;
        }
        .about-signature-social-link:hover {
          color: #6d4aff;
        }
        /* Hide scroll-animated elements before GSAP ScrollTrigger initializes to prevent FOUC */
        #stacked-slides-wrapper [data-capability-header],
        #stacked-slides-wrapper [data-grid-window],
        #stacked-slides-wrapper #stacked-inline-footer,
        #stacked-slides-wrapper #inline-footer-value-block,
        #stacked-slides-wrapper #agency-marquee-shell,
        #stacked-slides-wrapper #inline-footer-seo-nav,
        #stacked-slides-wrapper #inline-footer-bottom {
          opacity: 0;
          visibility: hidden;
        }
        /* Narrow / touch viewports skip the GSAP ScrollTrigger reveal entirely
           (see isNarrowTouchViewport early-return), so force these elements
           visible on mobile or they stay hidden forever. Also unhide when the
           user prefers reduced motion. */
        @media (max-width: 767px), (prefers-reduced-motion: reduce) {
          #stacked-slides-wrapper [data-capability-header],
          #stacked-slides-wrapper [data-grid-window],
          #stacked-slides-wrapper #stacked-inline-footer,
          #stacked-slides-wrapper #inline-footer-value-block,
          #stacked-slides-wrapper #agency-marquee-shell,
          #stacked-slides-wrapper #inline-footer-seo-nav,
          #stacked-slides-wrapper #inline-footer-bottom {
            opacity: 1 !important;
            visibility: visible !important;
            transform: none !important;
          }
        }
        @media (max-width: 767px) {
          #panel-grid-layout,
          #panel-capabilities-layout {
            padding-left: max(2.5vw, 10px) !important;
            padding-right: max(2.5vw, 10px) !important;
          }
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
        /* Desktop-only row hover for the deliverables table (the .cmo-table-inner
           table is hidden below 900px, so this never fires on mobile). */
        .cmo-table-inner table tbody tr td {
          transition: background 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .cmo-table-inner table tbody tr:not([data-no-hover]) {
          cursor: pointer;
        }
        .cmo-table-inner table tbody tr:not([data-no-hover]):hover td {
          background: rgba(42, 36, 32, 0.045);
        }
        .cmo-table-inner table tbody tr:not([data-no-hover]):hover td:first-child {
          border-top-left-radius: 0.5rem;
          border-bottom-left-radius: 0.5rem;
        }
        .cmo-table-inner table tbody tr:not([data-no-hover]):hover td:last-child {
          border-top-right-radius: 0.5rem;
          border-bottom-right-radius: 0.5rem;
        }
        #inline-footer-bullet-list li:last-child {
          padding-bottom: 0 !important;
        }
        @media (max-width: 767px) {
          #testimonials-marquee-shell > div > div,
          #agent-marquee-shell > div > div,
          #footer-marquee-shell > div > div,
          #agency-marquee-shell > div > div { padding-right: 2rem !important; gap: 2rem !important; }
          [data-label-heading] {
            color: #000000 !important;
          }
          #capability-cards-grid {
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
          #panel-hero-cta {
            width: max-content !important;
            max-width: calc(100vw - 2rem) !important;
            align-self: center !important;
            padding: 0.5rem 3.75rem !important;
          }
          #onboarding-table-section { border-top: none !important; }
          #footer-contact-cta {
            width: 100% !important;
            justify-content: center !important;
            box-sizing: border-box !important;
          }
          /* ── Onboarding card / table overflow fix ── */
          #dashboard-stack-shell {
            overflow: visible;
            padding-top: 35px !important;
          }
          /* Cards static-lifted on mobile — no interaction needed */
          #dash-peek-card-1 { transform: translateY(-46px) rotate(-3.2deg) !important; }
          #dash-peek-card-2 { transform: translateY(-46px) rotate(1.2deg) !important; }
          #dash-peek-card-3 { transform: translateY(-46px) rotate(-1.4deg) !important; }
          #cmo-dashboard-card { margin-top: -40px !important; }
          #onboarding-table-section { margin-top: 2.5rem !important; }
          [data-peek-card] {
            width: 33% !important;
            min-width: 0 !important;
          }
          #cmo-dashboard-card,
          [data-capability-card] {
            overflow: hidden !important;
            max-width: 100% !important;
            box-sizing: border-box !important;
          }
          /* Kill table layout engine on mobile so flex/block can take over */
          #cmo-dashboard-table table,
          #cmo-dashboard-table thead,
          #cmo-dashboard-table tbody {
            display: block !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
          #cmo-dashboard-table thead th:nth-child(1),
          #cmo-dashboard-table thead th:nth-child(3) { display: none !important; }
          #cmo-dashboard-table thead th:nth-child(2) {
            display: block !important;
            width: 100% !important;
            text-align: center !important;
          }
          /* Grid layout: icon col spans name+description rows so trunk is unbroken */
          #cmo-dashboard-table tbody tr {
            display: grid !important;
            grid-template-columns: 2rem 1fr !important;
            width: 100% !important;
            box-sizing: border-box !important;
          }
          #cmo-dashboard-table tbody td { display: block !important; }
          #cmo-dashboard-table tbody td:nth-child(1) {
            grid-column: 1 !important;
            grid-row: 1 / 3 !important;
            position: relative !important;
            padding: 1.1rem 0.2rem !important;
          }
          #cmo-dashboard-table tbody td:nth-child(2) {
            grid-column: 2 !important;
            grid-row: 1 !important;
            min-width: 0 !important;
            padding-top: 1.1rem !important;
            padding-bottom: 0.35rem !important;
            font-weight: 700 !important;
            color: #2a2420 !important;
          }
          #cmo-dashboard-table tbody td:nth-child(3) {
            grid-column: 2 !important;
            grid-row: 2 !important;
            box-sizing: border-box !important;
            padding: 0 0.4rem 1.1rem 0.4rem !important;
            font-size: 0.78rem !important;
            line-height: 1.5 !important;
            color: rgba(42,36,32,0.6) !important;
          }
          /* Sub-row descriptions: clear the connector elbow arm (extends ~0.55rem into col 2) */
          #cmo-dashboard-table tbody tr[data-sub] td:nth-child(3) {
            padding-left: 1.1rem !important;
          }
          /* The two toggle rows (Dashboard / Daily Brief) carry a value + chevron,
             not a description — keep both on the same grid row as their label,
             right-aligned, instead of dropping to the row below it. */
          #cmo-dashboard-table tbody tr[data-daily],
          #cmo-dashboard-table tbody tr[data-dashboard] {
            grid-template-columns: 2rem 1fr auto !important;
          }
          #cmo-dashboard-table tbody tr[data-daily] td:nth-child(2),
          #cmo-dashboard-table tbody tr[data-dashboard] td:nth-child(2) {
            grid-row: 1 !important;
          }
          #cmo-dashboard-table tbody tr[data-daily] td:nth-child(3),
          #cmo-dashboard-table tbody tr[data-dashboard] td:nth-child(3) {
            grid-column: 3 !important;
            grid-row: 1 !important;
            display: flex !important;
            align-items: center !important;
            padding: 1.1rem 0.2rem 0.35rem 0 !important;
          }
          #cmo-dashboard-table .cmo-conn--last::before { bottom: calc(50% + 11px) !important; }
          .cmo-url-input-mobile .cmo-table-submit-label { display: none; }
          .cmo-url-input-mobile .cta-pill-btn {
            width: 2.6rem;
            height: 2.6rem;
            padding: 0;
            gap: 0;
            justify-content: center;
            flex-shrink: 0;
          }
          #footer-url-input-row .footer-submit-label { display: none; }
          #footer-url-input-row .cta-pill-btn {
            width: 2.6rem;
            height: 2.6rem;
            padding: 0;
            gap: 0;
            justify-content: center;
            flex-shrink: 0;
          }
          .cmo-url-input-desktop .cta-pill-btn {
            padding: 0.5rem 0.75rem;
          }
        }
        .cmo-table-inner { display: none; }
        .cmo-table-outer { display: block; }
        #onboarding-table-section { border-top: none !important; }
        /* Director sub-row connector — lives in the icon column so the trunk
           sits under the Daily Executive Brief lock and flows up into it, with
           rounded branch elbows reaching toward each Director label. */
        .cmo-conn {
          position: absolute;
          inset: 0;
          pointer-events: none;
          color: rgba(42, 36, 32, 0.38);
        }
        /* Trunk — solid, overlaps row borders top + bottom so it reads as one
           unbroken line through every sub row. */
        .cmo-conn::before {
          content: '';
          position: absolute;
          left: calc(50% - 0.75px);
          top: -1px;
          bottom: -1px;
          width: 1.5px;
          background: #a39e93;
        }
        .cmo-conn--first::before { top: -0.62rem; }      /* climb up into the lock */
        .cmo-conn--last::before { bottom: calc(50% + 11px); }  /* stop at the top of the last curve — smooth bend, no tail */
        /* Branch elbow — clean quarter-round off the trunk reaching the label. */
        .cmo-conn::after {
          content: '';
          position: absolute;
          left: calc(50% - 0.75px);
          top: calc(50% - 12px);
          width: calc(50% + 0.55rem);
          height: 12px;
          border-left: 1.5px solid #a39e93;
          border-bottom: 1.5px solid #a39e93;
          border-bottom-left-radius: 12px;
        }
        .cmo-conn-arrow {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          top: -0.55rem;
          color: #a39e93;
        }
        .cmo-arrow {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: rgba(42, 36, 32, 0.75);
          font-size: 0.7rem;
          cursor: default;
        }
        #cmo-about-split {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: clamp(1.25rem, 3vw, 2rem);
          width: 100%;
          align-items: start;
          padding: clamp(0.75rem, 2vw, 1.5rem) 0 clamp(1rem, 2.5vw, 1.5rem);
          box-sizing: border-box;
        }
        @media (max-width: 899px) {
          #cmo-about-split {
            padding-bottom: 0;
          }
        }
        #cmo-about-identity-col {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          /* Tightened so the profile reads as one grouped unit (avatar/name/
             role, paragraph, previously-at) rather than loose fragments. */
          gap: clamp(0.55rem, 1vw, 0.85rem);
          min-width: 0;
        }
        #cmo-about-copy-col {
          display: flex;
          flex-direction: column;
          gap: clamp(0.9rem, 1.8vw, 1.35rem);
          min-width: 0;
        }
        /* Divider is its own equal-width grid track (not a border on the copy
           column) so the grid gap applies identically on both sides of it,
           guaranteeing the line sits exactly centered and both text columns
           get the same usable width, instead of the old border-left +
           padding-left approach which was asymmetric. */
        #cmo-about-divider {
          display: none;
        }
        /* Below the 900px split there is no left/right column pair, so the
           identity block is a compact intro only: the background line, the
           "previously at" label and the agency marquee are two-column-only
           content and stay hidden at EVERY width under 900px (tablet band and
           phone band alike). !important since both are inline-styled. */
        @media (max-width: 899px) {
          #cmo-about-lead,
          #cmo-about-previously-block {
            display: none !important;
          }
        }
        /* Below the 900px two-column split (tablet band + phone alike) the
           identity block reads as one left-justified unit: avatar hard left,
           "I'm Bryan Balli" and "CREATIVE LEAD" stacked directly beside it.
           !important since the alignment is inline-styled. The ≥900 two-column
           orientation is untouched — it aligns against the copy column. */
        @media (max-width: 899px) {
          /* Below the split the table block leads with the URL input, so its
             divider would draw a hairline directly above that pill. */
          #cmo-dashboard-table { border-top: none !important; padding-top: 0 !important; }
          #cmo-about-identity-header {
            justify-content: flex-start !important;
            align-items: flex-start !important;
            gap: clamp(0.5rem, 2.5vw, 1rem) !important;
            /* Mirrors aboutHeadingStyle's font-size; the avatar sizes off it. */
            --about-heading-size: clamp(1.2rem, 5.8vw, 2.1rem);
          }
          /* Avatar matches the height of the name + role stack. Computed from the
             type scale rather than align-items:stretch: the shell's width would
             then depend on its stretched height while the stack's width depends
             on the shell's width, and the circular resolution blew it up to 128px.
             --about-heading-size is re-declared for the phone band below. */
          #cmo-about-avatar-shell {
            --about-stack-gap: clamp(0.3rem, 0.6vw, 0.4rem);
            --about-role-line: calc(1.25 * clamp(0.8rem, 1vw, 0.88rem));
            width: calc(var(--about-heading-size) + var(--about-stack-gap) + var(--about-role-line)) !important;
            height: calc(var(--about-heading-size) + var(--about-stack-gap) + var(--about-role-line)) !important;
            align-self: flex-start !important;
          }
          #cmo-about-identity-textstack {
            align-items: flex-start !important;
            flex: 0 0 auto;
          }
          #cmo-about-heading {
            text-align: left !important;
          }
          #cmo-about-signature-row {
            justify-content: flex-start !important;
          }
        }
        /* Phone (≤767px): scale the name up to absorb the width freed by the
           hidden two-column content; the avatar tracks it through the shared var. */
        @media (max-width: 767px) {
          #cmo-about-heading {
            font-size: clamp(1.35rem, 8vw, 2.3rem) !important;
          }
          #cmo-about-identity-header {
            --about-heading-size: clamp(1.35rem, 8vw, 2.3rem);
          }
        }
        /* Sub-360px: tighten the role row so the dot + CREATIVE LEAD + socials
           stay on one line beside the avatar instead of wrapping. */
        @media (max-width: 360px) {
          #cmo-about-signature-row {
            gap: 0.35rem !important;
          }
          #cmo-about-signature-socials {
            gap: 0.45rem !important;
          }
        }
        @media (min-width: 900px) {
          #cmo-about-split {
            /* Asymmetric split — the left profile block is compact and
               narrower, the right message block is the wider, dominant
               element. The 1px divider track auto-repositions with it. */
            grid-template-columns: minmax(0, 0.42fr) 1px minmax(0, 0.58fr);
            gap: clamp(2rem, 4vw, 3.25rem);
            align-items: center;
          }
          #cmo-about-divider {
            display: block;
            align-self: stretch;
            background: rgba(42, 36, 32, 0.12);
          }
        }
        /* EXPERIMENT (revert by deleting this block + the two doPin/doUnpin
           opacity/visibility lines below): hide "Book a Call with Bryan" from
           the homepage hero row on desktop — it only appears once pinned
           (i.e. once the URL input row scrolls out of view), driven by the
           existing sentinel/ScrollTrigger pin mechanism further up this file.
           Taking it out of flow here (rather than display:none) lets
           #hero-url-input-row's flex:1 fill the freed width automatically,
           and keeps it measurable so the pin code's getBoundingClientRect()
           sizing still works. */
        /* #panel-hero-cta is hidden at EVERY width until the scroll pin reveals it
           (HomePage.jsx sets the same opacity/visibility to prevent FOUC), so it is
           taken out of flow at every width too. Left in flow below 900px it was an
           invisible ~240px hole that stopped #hero-url-input-row from stretching. */
        #panel-hero-text-row {
          position: relative;
          /* Only one in-flow item lives here now (plus the display:none spacer the
             pin inserts), so a flex gap would just be a dead gutter. */
          gap: 0 !important;
        }
        #panel-hero-cta {
          position: absolute;
          top: 50%;
          right: 0;
          transform: translateY(-50%);
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 0.25s ease;
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
        /* ── Automations Modal ─────────────────────────────────────────────── */
        @property --cta-angle { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
        @keyframes cmoMarqueeScroll { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        @keyframes agentMarquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        @keyframes cmoModalFadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes cmoModalPopIn { from { opacity:0; transform: scale(0.96) translateY(8px); } to { opacity:1; transform: scale(1) translateY(0); } }
        #cmo-modal-overlay {
          position: fixed; inset: 0; z-index: 100000;
          background: rgba(255,255,255,0.6);
          backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
          display: flex; align-items: center; justify-content: center;
          padding: 20px; box-sizing: border-box;
          animation: cmoModalFadeIn 180ms ease-out;
          overflow-y: auto;
        }
        @media (max-width: 600px) {
          #cmo-modal-overlay { align-items: center; justify-content: center; padding: 16px; min-height: 100dvh; }
          .testimonials-port-img { aspect-ratio: 16 / 10 !important; }
          #dashboard-stack-shell { padding-top: 44px !important; }
          .dash-peek-card { width: calc(100% / 3) !important; max-height: 120px !important; }
          .dash-peek-card img { height: calc(100% - 24px) !important; }
          #dash-peek-card-1 { left: 66.667% !important; }
          #dash-peek-card-2 { left: 33.333% !important; }
          #dash-peek-card-3 { left: 0% !important; }
        }
        #cmo-auth-card {
          position: relative; width: 100%; max-width: 44rem;
          padding: clamp(1.25rem,5vw,2rem); border-radius: 1.1rem; box-sizing: border-box;
          background: rgba(255,255,255,1); border: 1px solid rgba(212,196,171,0.82);
          backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
          box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4),
            0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15);
          display: flex; flex-direction: column;
          animation: cmoModalPopIn 220ms cubic-bezier(0.2,0.8,0.2,1);
          font-family: 'Space Grotesk', system-ui, sans-serif;
        }
        #cmo-auth-brand-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 0.75rem; margin-bottom: 0.8rem;
        }
        #cmo-auth-sig { width: 2.75rem; height: 2.75rem; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.35); display: block; }
        #cmo-auth-eyebrow {
          font-family: 'Space Mono', monospace; font-size: 0.82rem;
          letter-spacing: 0.14em; text-transform: uppercase;
          color: rgba(42,36,32,0.44); font-weight: 700;
        }
        #cmo-auth-back-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 2.4rem; height: 2.4rem; border-radius: 999px;
          background: rgba(255,255,255,0.34); border: 1px solid rgba(42,36,32,0.12);
          color: rgba(42,36,32,0.58); font-family: 'Space Mono', monospace;
          font-size: 1.05rem; line-height: 1; cursor: pointer; padding: 0;
          transition: background 160ms ease, color 160ms ease;
        }
        #cmo-auth-back-btn:hover { background: rgba(255,255,255,0.6); color: #2a2420; }
        @media (max-width: 600px) {
          .cmo-submit-label { display: none; }
          #cmo-url-pill-submit {
            width: 2.6rem; height: 2.6rem;
            padding: 0; gap: 0;
            justify-content: center;
            flex-shrink: 0;
          }
          .cmo-submit-arrow { font-size: 1rem; }
        }
        #cmo-modal-marquee {
          position: relative; width: 100%; flex-shrink: 0; overflow: hidden;
          pointer-events: none; margin: 25px 0;
          mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 6%, black 94%, transparent 100%);
        }
        #cmo-modal-marquee .cmo-marquee-track {
          display: flex; align-items: center; width: max-content;
          will-change: transform; animation: cmoMarqueeScroll 36s linear infinite;
        }
        #cmo-modal-marquee .cmo-marquee-item {
          font-family: 'Doto', 'Space Mono', monospace; font-size: clamp(2rem,8vw,5rem);
          font-weight: 700; letter-spacing: -0.02em; line-height: 1.05;
          color: rgba(42,36,32,0.82); white-space: nowrap;
        }
        #cmo-modal-marquee .cmo-marquee-dot { font-family: 'Doto', monospace; color: rgba(42,36,32,0.35); padding: 0 0.3rem; }
        @media (prefers-reduced-motion: reduce) { #cmo-modal-marquee .cmo-marquee-track { animation: none; } }
        @media (max-width: 640px) {
          #cmo-modal-marquee { margin: 0; padding: 0; }
          #cmo-modal-marquee .cmo-marquee-item { font-size: max(2.2rem, 11vw); }
          #cmo-modal-table-wrap { display: none; }
        }
        [data-hover-floater] { display: none !important; }
        #cmo-modal-table-wrap { width: 100%; margin-top: 0.65rem; }
        #cmo-modal-table { width: 100%; border-collapse: collapse; }
        #cmo-modal-table thead th {
          font-family: 'Space Mono', monospace; font-size: 0.58rem; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.08em; color: rgba(42,36,32,0.4);
          padding: 0.28rem 0.4rem; border-bottom: 1px solid rgba(42,36,32,0.1);
        }
        .cmo-td-task { padding: 0.38rem 0.4rem; color: rgba(42,36,32,0.82); font-weight: 500; font-size: 0.88rem; }
        .cmo-td-mark { padding: 0.38rem 0.2rem; text-align: center; }
        .cmo-td-value { padding: 0.38rem 0.4rem; text-align: right; color: rgba(42,36,32,0.6); font-size: 0.82rem; }
        .cmo-td-arrow { color: rgba(42,36,32,0.3); font-size: 0.7rem; }
        #cmo-modal-table tbody tr { border-bottom: 1px solid rgba(42,36,32,0.07); }
        #cmo-url-row {
          display: flex; align-items: stretch; gap: 0.5rem; width: 100%;
          box-sizing: border-box; margin-top: 0.75rem;
        }
        #cmo-url-pill {
          display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0;
          box-sizing: border-box;
          padding: 0.35rem 0.35rem 0.35rem 0.9rem;
          background: rgba(255,255,255,0.55); border: 1px solid rgba(42,36,32,0.14);
          border-radius: 999px; box-shadow: 0 1px 4px rgba(42,36,32,0.07);
          transition: border-color 160ms ease, box-shadow 160ms ease;
        }
        #cmo-url-pill:focus-within { border-color: rgba(42,36,32,0.28); box-shadow: 0 0 0 3px rgba(42,36,32,0.06); }
        #cmo-modal-url-input {
          flex: 1; min-width: 0; border: none; outline: none; background: transparent;
          padding: 0; margin: 0; font-family: 'Space Grotesk', system-ui, sans-serif;
          font-size: clamp(0.85rem,1.1vw,0.95rem); color: #2a2420; line-height: 1.2;
        }
        #cmo-modal-url-input::placeholder { color: rgba(42,36,32,0.45); }
        #cmo-url-pill-submit {
          display: inline-flex; align-items: center; gap: 0.35rem; flex-shrink: 0;
          border-radius: 999px; padding: 0.5rem 0.75rem; line-height: 1;
          font-family: 'Space Grotesk', system-ui, sans-serif; font-size: clamp(0.8rem, 1.1vw, 0.875rem); font-weight: 700;
          letter-spacing: 0.01em; cursor: pointer;
          transition: transform 160ms ease, filter 160ms ease;
        }
        /* Primary CTA — solid blue gradient + animated comet border (.cta-pill-btn::before) */
        .cmo-url-pill-submit-active {
          border: none;
          background: linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
          color: #fff; box-shadow: 0 2px 6px rgba(139,92,246,0.28); opacity: 1;
        }
        .cmo-url-pill-submit-active:hover { transform: translateY(-1px); filter: brightness(1.05); }
        /* Secondary CTA — static gradient border, no animated comet */
        .cmo-url-pill-submit-idle {
          border: 1px solid transparent;
          background: linear-gradient(#ffffff,#ffffff) padding-box,
            linear-gradient(90deg, hsla(185,100%,45%,0.5) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%) border-box;
          color: #2a2420; box-shadow: 0 1px 4px rgba(42,36,32,0.07); opacity: 1;
        }
        .cmo-url-pill-submit-idle::before { display: none; }
        .cmo-url-pill-submit-idle:hover { filter: brightness(0.99); }
        #cmo-modal-footer-row {
          display: flex; justify-content: space-between; align-items: center;
          gap: 1rem; margin-top: 0.65rem; width: 100%;
        }
        #cmo-url-warning {
          font-family: 'Space Mono', monospace; font-size: 0.72rem;
          color: rgba(180,35,24,0.7); letter-spacing: 0.03em;
        }
        #cmo-signin-link {
          display: inline-flex; align-items: center; justify-content: center;
          flex-shrink: 0; padding: 0.5rem 1.25rem; border-radius: 999px;
          font-family: 'Space Mono', monospace; font-size: 0.72rem; font-weight: 700;
          text-decoration: none; letter-spacing: 0.08em; text-transform: uppercase;
          white-space: nowrap; transition: transform 160ms ease, filter 160ms ease, color 160ms ease;
        }
        @media (max-width: 600px) {
          #cmo-url-row { flex-direction: column; align-items: stretch; gap: 0.5rem; }
          #cmo-signin-link { padding: 0.85rem 1.25rem; }
        }
        /* No animated comet border on buttons inside the website input pills */
        #hero-url-input-row .cta-pill-btn::before,
        #cmo-url-input-row .cta-pill-btn::before,
        #footer-url-input-row .cta-pill-btn::before,
        .cmo-url-input-mobile .cta-pill-btn::before { display: none; }
        /* Exception: the hero pill is the page's primary on-load CTA, so it keeps
           the comet border until a valid site/email flips it to the ready state. */
        #hero-url-input-row .cta-pill-btn[data-cta-state="idle"]::before { display: block; }
        /* Footer nav links inactive until their pages ship — LinkedIn/X stay live (matches main) */
        #inline-footer-seo-nav a,
        #inline-footer-bottom a {
          pointer-events: none;
          opacity: 0.4;
          cursor: default;
          text-decoration: none;
        }
        #inline-footer-bottom a[href*="linkedin"],
        #inline-footer-bottom a[href*="x.com"] {
          pointer-events: auto;
          opacity: 1;
          cursor: pointer;
        }
        @media (max-width: 767px), (prefers-reduced-motion: reduce) {
          #cmo-modal-overlay, #cmo-auth-card { animation: none; }
        }
        /* xsmall + mobile only: the labelled button leaves too little room for the
           input, so it collapses to an arrow circle (keeping its state styling).
           Tablet and up keep the "Onboard Now" label. */
        @media (max-width: 767px) {
          #hero-url-input-row button .hero-onboard-label { display: none; }
          #hero-url-input-row button {
            width: 2.6rem;
            min-width: 2.6rem;
            height: 2.6rem;
            padding: 0 !important;
            gap: 0;
            justify-content: center;
            flex-shrink: 0;
          }
          #hero-url-input-row button > span { margin-left: 0 !important; }
        }
        /* Tablet: both pills stay on one row, but "Book a Call" only takes its
           natural width so the input pill absorbs every remaining pixel. */
        @media (min-width: 768px) and (max-width: 1024px) {
          #panel-hero-cta {
            flex: 0 1 auto !important;
            min-width: 0 !important;
            width: auto !important;
            max-width: 100% !important;
            padding-left: clamp(0.75rem, 2vw, 1.5rem) !important;
            padding-right: clamp(0.75rem, 2vw, 1.5rem) !important;
            justify-content: center !important;
            overflow: hidden;
          }
        }
        /* Mobile: the input pill owns the row outright. */
        @media (max-width: 767px) {
          #panel-hero-text-row { flex-wrap: wrap !important; }
          #hero-url-input-row {
            flex: 1 1 100% !important;
            width: 100% !important;
          }
          #panel-hero-cta {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            justify-content: center !important;
          }
          /* Once pinned it's a floating bar centered by JS (left:50% + translateX),
             so it shouldn't run edge to edge the way the row-width version does. */
          #panel-hero-cta[data-cta-pinned] {
            width: 88% !important;
            max-width: 88% !important;
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
              background: index === 0 ? 'rgba(245, 241, 223, 0.38)' : slide.bg,
              backdropFilter: index === 0 ? 'blur(24px)' : 'none',
              WebkitBackdropFilter: index === 0 ? 'blur(24px)' : 'none',
              boxShadow: index === 0 ? 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6)' : 'none',
              color: slide.fg,
            }}
          >
            <div style={contentStyle}>
              <div data-stack-inner style={innerStyle}>
                {slide.layout === 'grid' ? (
                  <div id="panel-grid-layout" style={{ ...gridLayoutStyle, paddingBottom: 'clamp(5.75rem, 1.5vw, 1.4rem)' }}>
                    <div id="panel-hero-intro-centering" style={{ ...textCenteringStyle, marginTop: 'clamp(1.5rem, 3vw, 3rem)', marginBottom: 'clamp(1.5rem, 3vw, 3rem)' }}>
                      <div id="panel-hero-text-row" style={{ ...textRowStyle, display: 'flex', alignItems: 'center', gap: 'clamp(0.5rem, 1.5vw, 1rem)', width: '100%' }}>
                        <div id="hero-url-input-row" onMouseEnter={(e) => e.stopPropagation()} onMouseLeave={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, minWidth: 0, height: '3.25rem', boxSizing: 'border-box', padding: '0.35rem 0.35rem 0.35rem 0.75rem', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(42,36,32,0.12)', borderRadius: '999px', boxShadow: '0 1px 4px rgba(42,36,32,0.07)', gap: '0.5rem', position: 'relative', zIndex: 10, lineHeight: 1 }}>
                          <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                          <input value={homepageUrl} onChange={handleHomepageUrlChange} placeholder="Enter your website or email" style={{ flex: 1, alignSelf: 'center', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 1.2, fontSize: 'clamp(0.75rem, 1.1vw, 0.88rem)', color: 'rgba(42,36,32,0.75)', fontFamily: "'Space Grotesk', system-ui, sans-serif", minWidth: 0 }} />
                          {/* Primary on-load CTA: loud gradient + comet border while empty,
                              calm white "ready" state once a valid site/email is entered. */}
                          <button id="hero-onboard-cta" className="cta-pill-btn" data-cta-state={urlIsValid ? 'ready' : 'idle'} onClick={handleCreateDashboard} disabled={!urlIsValid} style={urlIsValid ? { ...ctaSecondaryStyle, flexShrink: 0, opacity: 1, padding: '0.75rem 0.75rem' } : { ...ctaStyle, flexShrink: 0, opacity: 1, cursor: 'default', padding: '0.75rem 0.75rem' }}><span className="hero-onboard-label">Onboard Now</span><UpRightArrow style={ctaIconStyle} /></button>
                        </div>
                        <a
                          id="panel-hero-cta"
                          href="https://calendly.com/bballi/30min"
                          target="_blank"
                          rel="noopener noreferrer"
                          className={urlIsValid ? undefined : 'cta-pill-btn'}
                          style={urlIsValid
                            ? { ...ctaSecondaryStyle, cursor: 'pointer', textDecoration: 'none', flexShrink: 0, height: '3.25rem', boxSizing: 'border-box', alignSelf: 'center' }
                            : { ...heroCtaStyle, cursor: 'pointer', border: 'none', textDecoration: 'none', flexShrink: 0, height: '3.25rem', boxSizing: 'border-box', alignSelf: 'center' }}
                        >
                          <Image src="/img/profile2_400x400.png" width={28} height={28} style={ctaAvatarStyle} alt="" />
                          Book a Call with Bryan
                          <UpRightArrow style={ctaIconStyle} />
                        </a>
                      </div>
                    </div>
                    <div data-capability-header style={{ ...capabilitySectionHeaderStyle, maxWidth: 'none', marginBottom: 0 }}>
                      <div id="testimonials-marquee-shell" style={{ width: '100%', overflow: 'hidden', margin: 'calc(clamp(24px, 5vw, 75px) - clamp(1.5rem, 3vw, 3rem)) 0 clamp(24px, 5vw, 75px)', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 28s linear infinite' }}>
                          {[0, 1].map((i) => (
                            <div key={i} aria-hidden={i > 0 ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                              {['HELLO', '•', 'HELLO', '•'].map((w, j) => (
                                <span key={j} style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(1.6rem, 28.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>{w}</span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <section id="onboarding-table-section" data-capability-grid style={capabilitySectionStyle}>
                      <div id="onboarding-table-grid" style={{ ...capabilityGridStyle, marginTop: 0 }}>
                        {AUTOMATION_CAPABILITIES.filter((item) => item.tablePreview).map((item, index) => {
                          const Icon = AUTOMATION_ICON_COMPONENTS[item.icon];
                          const isMobileCapabilityOpen = isTouchScrollDevice() && activeMobileCapability === item.title;
                          return (
                            <React.Fragment key={item.title}>
                            {item.tablePreview ? (
                              <div
                                id="dashboard-stack-shell"
                                style={{ position: 'relative', gridColumn: '1 / -1', paddingTop: '70px', zIndex: isMobileCapabilityOpen ? 6 : 1 }}
                              >
                                {[
                                  { ref: peekCard3Ref, id: 'dash-peek-card-3', left: '0%',  rotate: '-1.4deg', objPos: 'top center', label: '', img: '/img/ss3.png', height: '190px', topOffset: '0', bg: '#fcfaf4' },
                                  { ref: peekCard2Ref, id: 'dash-peek-card-2', left: '33%', rotate: '1.2deg',  objPos: 'top center', label: '', img: '/img/clairecalls_ss.png', height: '168px', topOffset: '0', bg: '#fcfaf4' },
                                  { ref: peekCard1Ref, id: 'dash-peek-card-1', left: '66%', rotate: '-3.2deg', objPos: 'top center', label: '', img: '/img/ss1.png', height: '200px', topOffset: '0', bg: '#fcfaf4' },
                                ].map(({ ref: cardRef, id, left, rotate, objPos, label, img, height, topOffset, bg }, i) => (
                                  <div
                                    key={id}
                                    ref={cardRef}
                                    data-peek-card
                                    className="dash-peek-card"
                                    id={id}
                                    onMouseEnter={() => { if (isTouchScrollDevice()) return; gsap.to(cardRef.current, { y: -46, duration: 0.38, ease: 'power2.out' }); }}
                                    onMouseLeave={() => { if (isTouchScrollDevice()) return; gsap.to(cardRef.current, { y: 0,   duration: 0.48, ease: 'power2.inOut' }); }}
                                    style={{
                                      position: 'absolute',
                                      top: topOffset,
                                      left,
                                      width: 'clamp(180px, 33%, 400px)',
                                      height,
                                      zIndex: i + 1,
                                      borderRadius: '10px',
                                      border: '1px solid rgba(200,200,200,0.85)',
                                      background: bg || '#fcfaf4',
                                      overflow: 'hidden',
                                      cursor: 'pointer',
                                      willChange: 'transform',
                                      boxSizing: 'border-box',
                                      transform: `rotate(${rotate})`,
                                      boxShadow: '0 6px 20px rgba(0,0,0,0.09), 0 1px 0 rgba(255,255,255,0.85)',
                                    }}
                                  >
                                    <Image src={img} alt="" fill sizes="(max-width: 768px) 33vw, 400px" style={{ objectFit: 'contain', objectPosition: objPos, pointerEvents: 'none', userSelect: 'none' }} />
                                  </div>
                                ))}
                                <article
                                  data-capability-card
                                  id="cmo-dashboard-card"
                                  style={{ ...capabilityCardTablePreviewStyle, position: 'relative', zIndex: 10 }}
                                  onClick={() => {
                                    if (!isTouchScrollDevice()) return;
                                    setActiveMobileCapability((current) => (current === item.title ? null : item.title));
                                  }}
                                >
                                  <div data-hover-placeholder aria-hidden="true" style={{ display: 'none' }} />
                                  {isMobileCapabilityOpen ? (
                                    <div style={mobileCapabilityPreviewStyle} aria-hidden="true">
                                      <div style={{ width: '100%', height: '100%', background: '#f5f1df', borderRadius: '0.75rem', padding: '1rem', boxSizing: 'border-box', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                                        <p style={{ margin: '0 0 0.6rem', fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.4)', fontFamily: "'Space Mono', monospace" }}>Your Business, Mapped</p>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', fontFamily: "'Space Grotesk', system-ui, sans-serif", flex: 1 }}>
                                          <thead><tr style={{ borderBottom: '1px solid rgba(42,36,32,0.15)' }}><th style={{ width: '1.2rem' }} /><th style={{ textAlign: 'left', padding: '0.28rem 0.4rem', fontWeight: 900, color: 'rgba(42,36,32,0.45)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: "'Doto', 'Space Mono', monospace" }}>Access</th></tr></thead>
                                          <tbody>{CMO_TABLE_ROWS.map((row, ri, arr) => (<tr key={row.task} style={{ borderBottom: (row.task === 'Daily Brief' || row.task === 'DASHBOARD' || (row.sub && !isSubLast(arr, ri))) ? 'none' : '1px solid rgba(42,36,32,0.07)' }}><td style={{ padding: '0.38rem 0.2rem', textAlign: 'center', position: 'relative' }}>{row.task === 'DASHBOARD' ? <Check size={18} strokeWidth={3} color="#2f6fed" style={{ display: 'inline-block', verticalAlign: 'middle' }} /> : row.sub ? <BriefConnector first={isSubFirst(arr, ri)} last={isSubLast(arr, ri)} /> : <span className="cmo-arrow" aria-hidden="true"><Lock size={12} /></span>}</td><td style={{ padding: row.sub ? '0.38rem 0.4rem 0.38rem 0.9rem' : '0.38rem 0.4rem', color: row.sub ? 'rgba(42,36,32,0.55)' : '#2a2420', fontWeight: row.bold ? 700 : (row.sub ? 400 : 500) }}>{row.task === 'DASHBOARD' ? 'Dashboard' : row.task}</td></tr>))}</tbody>
                                        </table>
                                      </div>
                                    </div>
                                  ) : null}
                                  <div style={capabilityContentStyle}>
                                    <HitloopAboutBlock />
                                    {item.body && <p id="cmo-card-onboard-body" style={{ ...capabilityCardBodyStyle, maxWidth: 'none', textAlign: 'left' }}>{item.body}</p>}
                                    <div id="cmo-url-input-row" className="cmo-url-input-desktop" onMouseEnter={(e) => e.stopPropagation()} onMouseLeave={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.85rem', height: '3.25rem', boxSizing: 'border-box', padding: '0.35rem 0.35rem 0.35rem 0.75rem', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(42,36,32,0.12)', borderRadius: '999px', boxShadow: '0 1px 4px rgba(42,36,32,0.07)', gap: '0.5rem', position: 'relative', zIndex: 10, lineHeight: 1 }}>
                                      <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                                      <input value={homepageUrl} onChange={handleHomepageUrlChange} placeholder="Enter your website or email" style={{ flex: 1, alignSelf: 'center', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 1.2, fontSize: 'clamp(0.75rem, 1.1vw, 0.88rem)', color: 'rgba(42,36,32,0.75)', fontFamily: "'Space Grotesk', system-ui, sans-serif", minWidth: 0 }} />
                                      <span id="cmo-dashboard-cta-hover-shell" style={{ display: 'inline-flex', flexShrink: 0, cursor: 'pointer' }}><button className="cta-pill-btn" onClick={handleCreateDashboard} disabled={!urlIsValid} style={urlIsValid ? { ...ctaStyle, flexShrink: 0, boxShadow: 'none', padding: '0.75rem 0.75rem' } : { ...ctaStyle, border: '1px solid transparent', flexShrink: 0, background: 'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(90deg, hsla(185,100%,45%,0) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%) border-box', color: '#2a2420', boxShadow: 'none', opacity: 1, cursor: 'pointer', padding: '0.75rem 0.75rem' }}>Onboard Now<UpRightArrow style={ctaIconStyle} /></button></span>
                                    </div>
                                    <div className="cmo-table-inner" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '0px solid rgba(42,36,32,0.1)' }}>
                                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
                                        <colgroup><col style={{ width: '2rem' }} /><col style={{ width: '26%' }} /><col /></colgroup>
                                        <thead><tr><th aria-hidden="true" /><th style={{ textAlign: 'left', padding: '0.25rem 0.4rem', fontWeight: 900, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Doto', 'Space Mono', monospace" }}>Access</th><th style={{ textAlign: 'left', padding: '0.25rem 0.4rem', fontWeight: 900, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Doto', 'Space Mono', monospace" }}>What you get</th></tr></thead>
                                        <tbody><CmoTableRows dailyBriefOpen={dailyBriefOpen} onToggleDaily={() => setDailyBriefOpen((v) => !v)} dashboardOpen={dashboardOpen} onToggleDashboard={() => setDashboardOpen((v) => !v)} variant="desktop" /></tbody>
                                      </table>
                                    </div>
                                  </div>
                                  <div id="cmo-dashboard-table" className="cmo-table-outer" style={{ gridColumn: '1 / -1', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                                    <div className="cmo-url-input-mobile" onMouseEnter={(e) => e.stopPropagation()} onMouseLeave={(e) => e.stopPropagation()} style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', height: '3.25rem', boxSizing: 'border-box', padding: '0.35rem 0.35rem 0.35rem 0.75rem', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(42,36,32,0.12)', borderRadius: '999px', boxShadow: '0 1px 4px rgba(42,36,32,0.07)', gap: '0.5rem', position: 'relative', zIndex: 10, lineHeight: 1 }}>
                                      <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                                      <input value={homepageUrl} onChange={handleHomepageUrlChange} placeholder="Enter your website or email" style={{ flex: 1, alignSelf: 'center', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 1.2, fontSize: 'clamp(0.75rem, 1.1vw, 0.88rem)', color: 'rgba(42,36,32,0.75)', fontFamily: "'Space Grotesk', system-ui, sans-serif", minWidth: 0 }} />
                                      <button className="cta-pill-btn" onClick={handleCreateDashboard} disabled={!urlIsValid} style={urlIsValid ? { ...ctaStyle, flexShrink: 0, boxShadow: 'none', padding: '0.75rem 0.75rem' } : { ...ctaStyle, border: '1px solid transparent', flexShrink: 0, background: 'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(90deg, hsla(185,100%,45%,0) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%) border-box', color: '#2a2420', boxShadow: 'none', opacity: 1, cursor: 'default', padding: '0.75rem 0.75rem' }}><span className="cmo-table-submit-label">Onboard Now</span><UpRightArrow className="cmo-table-submit-arrow" style={ctaIconStyle} /></button>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'clamp(0.82rem, 1.1vw, 0.95rem)', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
                                    <colgroup><col style={{ width: '2rem' }} /><col style={{ width: '26%' }} /><col /></colgroup>
                                      <thead><tr><th style={{ width: '1.5rem' }} /><th style={{ textAlign: 'left', padding: '0.25rem 0.4rem', fontWeight: 900, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Doto', 'Space Mono', monospace" }}>Get</th><th style={{ textAlign: 'left', padding: '0.25rem 0.4rem', fontWeight: 900, color: 'rgba(42,36,32,0.4)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: "'Doto', 'Space Mono', monospace" }}>What you get</th></tr></thead>
                                      <tbody><CmoTableRows dailyBriefOpen={dailyBriefOpen} onToggleDaily={() => setDailyBriefOpen((v) => !v)} dashboardOpen={dashboardOpen} onToggleDashboard={() => setDashboardOpen((v) => !v)} variant="mobile" /></tbody>
                                    </table>
                                  </div>
                                  <div id="cmo-dashboard-card-anchor-footer" style={aboutAnchorFooterStyle} aria-hidden="true">
                                    <AnchorLavaShader />
                                  </div>
                                </article>
                              </div>
                            ) : (
                              <article
                                data-capability-card
                                style={{ ...capabilityCardStyle, zIndex: isMobileCapabilityOpen ? 6 : 1 }}
                                onClick={() => {
                                  if (!isTouchScrollDevice()) return;
                                  setActiveMobileCapability((current) => (current === item.title ? null : item.title));
                                }}
                              >
                                {isMobileCapabilityOpen ? (
                                  <div style={mobileCapabilityPreviewStyle} aria-hidden="true">
                                    {item.previewVideo ? (
                                      <video src={item.previewVideo} autoPlay muted loop playsInline style={mobileCapabilityPreviewImageStyle} />
                                    ) : (
                                      <Image src={item.previewImage} alt="" fill sizes="90vw" style={{ objectFit: 'cover', display: 'block' }} />
                                    )}
                                  </div>
                                ) : null}
                                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 'clamp(0.8rem, 1.5vw, 1rem)' }}>
                                  <div style={capabilityContentStyle}>
                                    <h4 style={capabilityCardTitleStyle}>{item.title}</h4>
                                    {item.body && <p style={capabilityCardBodyStyle}>{item.body}</p>}
                                  </div>
                                  <div style={{ ...capabilityBadgeStyle, color: item.badgeColor, flexShrink: 0 }}>
                                    {Icon ? <Icon size={20} strokeWidth={2.1} /> : item.badge}
                                  </div>
                                </div>
                              </article>
                            )}
                            {item.tablePreview && null}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </section>
                    <section data-capability-grid style={capabilitySectionStyle}>
                      <div id="iship-marquee-shell" style={{ width: '100%', overflow: 'hidden', margin: 'clamp(24px, 5vw, 75px) 0', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 28s linear infinite' }}>
                          {[0, 1].map((i) => (
                            <div key={i} aria-hidden={i > 0 ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                              {['RECENTLY SHIPPED', '•', 'RECENTLY SHIPPED', '•'].map((w, j) => (
                                <span key={j} style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(1.6rem, 28.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>{w}</span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div id="testimonials-section" style={{ ...testimonialsShellStyle, marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
                        <div id="testimonials-grid" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(0.75rem, 1.5vw, 1rem)', width: '100%', minWidth: 0 }}>
                          {[
                            { type: 'image', src: PORTFOLIO_IMAGES[0] },
                            { type: 'testimonial', data: testimonials[0] },
                            { type: 'image', src: PORTFOLIO_IMAGES[5] },
                            { type: 'testimonial', data: testimonials[1] },
                            { type: 'image', src: PORTFOLIO_IMAGES[1] },
                            { type: 'testimonial', data: testimonials[2] },
                            { type: 'image', src: PORTFOLIO_IMAGES[3] },
                            { type: 'testimonial', data: testimonials[3] },
                            { type: 'image', src: PORTFOLIO_IMAGES[8] },
                          ].map((item, itemIndex) => item.type === 'image' ? (
                            <div
                              key={item.src}
                              id={`portfolio-sample-thumb-${itemIndex}`}
                              className="testimonials-port-img"
                              // Create Case Study modal click temporarily disabled — see
                              // CreateCaseStudyModal.jsx / caseStudyImage state below.
                              // onClick={() => setCaseStudyImage(item.src)}
                              style={{ position: 'relative', width: '100%', borderRadius: '0.75rem', overflow: 'hidden', border: '1px solid rgba(42,36,32,0.1)', aspectRatio: '16 / 5', boxSizing: 'border-box' }}
                            >
                              <Image src={item.src} alt="" fill sizes="(max-width: 768px) 100vw, 50vw" style={{ objectFit: 'cover' }} />
                            </div>
                          ) : (
                            <article key={item.data.name + item.data.company} style={{ ...secondaryQuoteItemStyle, width: '100%', boxSizing: 'border-box', overflow: 'hidden', aspectRatio: '19 / 6', flexDirection: 'row', alignItems: 'center', gap: 'clamp(1.5rem, 3vw, 2.5rem)', padding: 'clamp(1.5rem, 3vw, 2.5rem)' }}>
                              <Image src={item.data.img} alt={item.data.name} width={56} height={56} style={{ ...testimonialCardAvatarStyle, flexShrink: 0, width: 'clamp(2.5rem, 4vw, 3.5rem)', height: 'clamp(2.5rem, 4vw, 3.5rem)' }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ ...featuredQuoteTextStyle, fontSize: 'clamp(0.9rem, 1.4vw, 1.15rem)', margin: '0 0 0.65rem' }}>{item.data.quote}</p>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                  <a
                                    className="testimonial-author-link"
                                    href={item.data.linkedinUrl}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow"
                                    title={`${item.data.name} on LinkedIn`}
                                    style={quoteAttributionNameStyle}
                                  >{item.data.name}</a>
                                  <span style={{ color: 'rgba(42,36,32,0.3)', fontSize: '0.75rem' }}>·</span>
                                  <span style={quoteAttributionRoleStyle}>{item.data.title}, {item.data.company}</span>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                        <div id="testimonials-linkedin-source-row" style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginTop: 'clamp(0.75rem, 1.5vw, 1rem)' }}>
                          <a
                            id="testimonials-linkedin-source-link"
                            href={LINKEDIN_RECOMMENDATIONS_URL}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            style={testimonialsSourceLinkStyle}
                          >See all recommendations on LinkedIn →</a>
                        </div>
                      </div>
                    </section>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ))}
      </div>

      {/* reel video section */}
      <div id="section-break-spacer" style={{ width: '100%', boxSizing: 'border-box', padding: 'clamp(3rem, 6vw, 5rem) clamp(1rem, 4vw, 3rem)' }}>
        <ReelPlayer />
      </div>

      {/* second blurry panel — capability cards + footer */}
      <section id="capabilities-panel" data-stack-panel style={{ ...panelStyle, minHeight: 'auto', background: 'rgba(245, 241, 223, 0.38)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6)', color: '#2a2420' }}>
        <div style={contentStyle}>
          <div data-stack-inner style={innerStyle}>
            <div id="panel-capabilities-layout" style={gridLayoutStyle}>
              <section id="capability-cards-section" data-capability-grid style={capabilitySectionStyle}>
                <div id="capability-cards-grid" style={{ ...capabilityGridStyle, marginTop: '5.75rem' }}>
                  {AUTOMATION_CAPABILITIES.filter((item) => !item.tablePreview).map((item) => {
                    const Icon = AUTOMATION_ICON_COMPONENTS[item.icon];
                    const isMobileCapabilityOpen = isTouchScrollDevice() && activeMobileCapability === item.title;
                    return (
                      <article
                        key={item.title}
                        data-capability-card
                        style={{ ...capabilityCardStyle, zIndex: isMobileCapabilityOpen ? 6 : 1 }}
                        onClick={() => {
                          if (!isTouchScrollDevice()) return;
                          setActiveMobileCapability((current) => (current === item.title ? null : item.title));
                        }}
                      >
                        {isMobileCapabilityOpen ? (
                          <div style={mobileCapabilityPreviewStyle} aria-hidden="true">
                            {item.previewVideo ? (
                              <video src={item.previewVideo} autoPlay muted loop playsInline style={mobileCapabilityPreviewImageStyle} />
                            ) : (
                              <Image src={item.previewImage} alt="" fill sizes="90vw" style={{ objectFit: 'cover', display: 'block' }} />
                            )}
                          </div>
                        ) : null}
                        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start', gap: 'clamp(0.8rem, 1.5vw, 1rem)' }}>
                          <div style={capabilityContentStyle}>
                            <h4 style={capabilityCardTitleStyle}>{item.title}</h4>
                            {item.body && <p style={capabilityCardBodyStyle}>{item.body}</p>}
                          </div>
                          <div style={{ ...capabilityBadgeStyle, color: item.badgeColor, flexShrink: 0 }}>
                            {Icon ? <Icon size={20} strokeWidth={2.1} /> : item.badge}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
              <div data-grid-window style={gridWindowStyle}>
                <div data-grid-inner style={gridInnerContainerStyle}>
                  {/* Inline footer */}
                  <div id="stacked-inline-footer" style={inlineFooterStyle}>
                    <div id="inline-footer-value-block" style={inlineFooterNewsletterStyle}>
                      <div id="footer-marquee-shell" style={{ width: '100%', overflow: 'hidden', marginBottom: 'clamp(24px, 5vw, 75px)', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 28s linear infinite' }}>
                          {[0, 1].map((i) => (
                            <div key={i} aria-hidden={i > 0 ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                              {['CONTACT', '•', 'CONTACT', '•'].map((w, j) => (
                                <span key={j} style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(1.6rem, 28.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>{w}</span>
                              ))}
                            </div>
                          ))}
                        </div>
                      </div>
                      <Image src="/img/sig.png" alt="Bryan Balli signature" width={276} height={208} style={inlineFooterSignatureStyle} />

                      <div id="footer-cta-input-row" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'clamp(0.5rem, 1.5vw, 1rem)', width: '100%', marginTop: 'clamp(1.25rem, 2.5vw, 2rem)', marginBottom: 0 }}>
                        <div id="footer-url-input-row" onMouseEnter={(e) => e.stopPropagation()} onMouseLeave={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, minWidth: 'min(100%, 18rem)', height: '3.25rem', boxSizing: 'border-box', padding: '0.35rem 0.35rem 0.35rem 0.75rem', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(42,36,32,0.12)', borderRadius: '999px', boxShadow: '0 1px 4px rgba(42,36,32,0.07)', gap: '0.5rem', position: 'relative', zIndex: 10, lineHeight: 1 }}>
                          <Globe size={15} strokeWidth={1.5} style={{ flexShrink: 0, alignSelf: 'center', color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                          <input value={homepageUrl} onChange={handleHomepageUrlChange} placeholder="Enter your website or email" style={{ flex: 1, alignSelf: 'center', border: 'none', outline: 'none', background: 'transparent', padding: 0, margin: 0, lineHeight: 1.2, fontSize: 'clamp(0.75rem, 1.1vw, 0.88rem)', color: 'rgba(42,36,32,0.75)', fontFamily: "'Space Grotesk', system-ui, sans-serif", minWidth: 0 }} />
                          <button className="cta-pill-btn" onClick={handleCreateDashboard} disabled={!urlIsValid} style={urlIsValid ? { ...ctaStyle, flexShrink: 0, boxShadow: 'none', padding: '0.75rem 0.75rem' } : { ...ctaStyle, border: '1px solid transparent', flexShrink: 0, background: 'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(90deg, hsla(185,100%,45%,0) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%) border-box', color: '#2a2420', boxShadow: 'none', opacity: 1, cursor: 'default', padding: '0.75rem 0.75rem' }}><span className="footer-submit-label">Onboard Now</span><UpRightArrow style={ctaIconStyle} /></button>
                        </div>
                        <a
                          id="footer-contact-cta"
                          href="https://calendly.com/bballi/30min"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cta-pill-btn"
                          style={{ ...heroCtaStyle, textDecoration: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, alignSelf: 'center' }}
                        >
                          <Image src="/img/profile2_400x400.png" width={28} height={28} style={ctaAvatarStyle} alt="" />
                          Book a Call with Bryan
                          <UpRightArrow style={ctaIconStyle} />
                        </a>
                      </div>
                      <p id="footer-previously-at" style={{ margin: '0.5rem 0 0.35rem', textAlign: 'center', fontSize: '0.7rem', letterSpacing: '0.06em', color: 'rgba(42,36,32,0.32)', fontFamily: "'Space Mono', monospace" }}>previously at…</p>
                      <a id="agency-marquee-shell" ref={marqueeShellRef} href="https://www.linkedin.com/in/bryanballi/" target="_blank" rel="noopener noreferrer" style={{ ...agencyMarqueeShellStyle, cursor: 'pointer', textDecoration: 'none', display: 'block' }}>
                        <div ref={marqueeTrackRef} style={agencyMarqueeTrackStyle}>
                          <div ref={marqueeSetRef} style={agencyMarqueeSetStyle}>
                            {agencyLogos.map((logo) => (
                              <Image key={`agency-a-${logo.alt}`} src={logo.src} alt={logo.alt} width={logo.w} height={logo.h} style={agencyLogoImgStyle(logo)} />
                            ))}
                          </div>
                          <div aria-hidden="true" style={agencyMarqueeSetStyle}>
                            {agencyLogos.map((logo) => (
                              <Image key={`agency-b-${logo.alt}`} src={logo.src} alt="" width={logo.w} height={logo.h} style={agencyLogoImgStyle(logo)} />
                            ))}
                          </div>
                        </div>
                      </a>
                    </div>
                    {/* Footer nav links temporarily disabled — bringing back later.
                    <div id="inline-footer-seo-nav" style={inlineFooterSeoNavStyle}>
                      <div style={inlineFooterNavColStyle}>
                        <span style={inlineFooterNavHeadingStyle}>Work</span>
                        <a href="/work" style={inlineFooterNavLinkStyle}>Featured Projects</a>
                        <a href="/case-studies" style={inlineFooterNavLinkStyle}>Case Studies</a>
                        <a href="/process" style={inlineFooterNavLinkStyle}>Process</a>
                      </div>
                      <div style={inlineFooterNavColStyle}>
                        <span style={inlineFooterNavHeadingStyle}>Services</span>
                        <a href="/services/ai-design-consulting" style={inlineFooterNavLinkStyle}>AI Design Consulting</a>
                        <a href="/services/web-development" style={inlineFooterNavLinkStyle}>Web Development</a>
                        <a href="/services/brand-identity" style={inlineFooterNavLinkStyle}>Brand Identity</a>
                        <a href="/services/design-systems" style={inlineFooterNavLinkStyle}>Design Systems</a>
                        <a href="/services/seo-geo" style={inlineFooterNavLinkStyle}>SEO &amp; GEO</a>
                      </div>
                      <div style={inlineFooterNavColStyle}>
                        <span style={inlineFooterNavHeadingStyle}>FAQ</span>
                        <a href="/faq#what-is-a-creative-technologist" style={inlineFooterNavLinkStyle}>What Is a Creative Technologist?</a>
                        <a href="/faq#ai-design-engineer" style={inlineFooterNavLinkStyle}>What Is an AI Design Engineer?</a>
                        <a href="/faq#how-i-work" style={inlineFooterNavLinkStyle}>How I Work</a>
                        <a href="/faq#pricing" style={inlineFooterNavLinkStyle}>Pricing &amp; Engagements</a>
                        <a href="/faq#turnaround" style={inlineFooterNavLinkStyle}>Turnaround &amp; Availability</a>
                      </div>
                      <div style={inlineFooterNavColStyle}>
                        <span style={inlineFooterNavHeadingStyle}>Company</span>
                        <a href="/about" style={inlineFooterNavLinkStyle}>About</a>
                        <a href="/how-it-works" style={inlineFooterNavLinkStyle}>How It Works</a>
                        <a href="/contact" style={inlineFooterNavLinkStyle}>Contact</a>
                        <a href="https://calendly.com/bballi/30min" target="_blank" rel="noopener noreferrer" style={inlineFooterNavLinkStyle}>Book a Call</a>
                      </div>
                    </div>
                    */}

                    <div id="inline-footer-bottom" style={inlineFooterBottomStyle}>
                      <span style={inlineFooterCopyrightStyle}>© 2026 Bryan Balli · All rights reserved</span>
                      <div style={inlineFooterLegalStyle}>
                        <a href="https://www.linkedin.com/in/bryanballi" style={inlineFooterLegalLinkStyle}>LinkedIn</a>
                        <a href="https://x.com/bai_ee" style={inlineFooterLegalLinkStyle}>𝕏</a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

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

      {showCmoModal && (
        <div
          id="cmo-modal-overlay"
          onClick={() => setShowCmoModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Onboard Now"
        >
          <div id="cmo-auth-card" onClick={(e) => e.stopPropagation()}>
            <div id="cmo-auth-brand-row">
              <Image id="cmo-auth-sig" src="/img/profile2_400x400.png" width={44} height={44} alt="" aria-hidden="true" />
              <span id="cmo-auth-eyebrow">ONBOARDING</span>
              <button type="button" id="cmo-auth-back-btn" onClick={() => setShowCmoModal(false)} aria-label="Close">✕</button>
            </div>

            <div id="cmo-modal-marquee" aria-label="CREATE DASHBOARD">
              <div className="cmo-marquee-track">
                {Array.from({ length: 8 }).map((_, i) => (
                  <span key={i} className="cmo-marquee-item" aria-hidden={i > 0 ? 'true' : undefined}>
                    CREATE DASHBOARD
                    <span className="cmo-marquee-dot">·</span>
                  </span>
                ))}
              </div>
            </div>


            <div id="cmo-url-row">
              <form
                id="cmo-url-pill"
                onSubmit={(e) => { e.preventDefault(); handleCreateDashboard(); }}
                onMouseEnter={(e) => e.stopPropagation()}
                onMouseLeave={(e) => e.stopPropagation()}
              >
                <Globe size={16} strokeWidth={1.6} style={{ flexShrink: 0, color: urlIsValid ? 'rgba(42,36,32,0.6)' : 'rgba(42,36,32,0.4)' }} />
                <input
                  id="cmo-modal-url-input"
                  value={homepageUrl}
                  onChange={handleHomepageUrlChange}
                  placeholder="Enter your website or email"
                />
                <button
                  type="submit"
                  id="cmo-url-pill-submit"
                  disabled={!urlIsValid}
                  className={urlIsValid ? 'cta-pill-btn cmo-url-pill-submit-active' : 'cta-pill-btn cmo-url-pill-submit-idle'}
                >
                  <span className="cmo-submit-label">Get Dashboard</span>
                  <UpRightArrow className="cmo-submit-arrow" />
                </button>
              </form>
              <a
                id="cmo-signin-link"
                href="/login"
                className={urlIsValid ? 'cta-pill-btn cmo-url-pill-submit-idle' : 'cta-pill-btn cmo-url-pill-submit-active'}
              >SIGN IN</a>
            </div>

            <div id="cmo-modal-footer-row">
              <span id="cmo-url-warning">* You must be a client to change website later.</span>
            </div>
          </div>
        </div>
      )}

      <SubscribeModal open={subscribeOpen} onClose={() => setSubscribeOpen(false)} />
      <CreateCaseStudyModal image={caseStudyImage} onClose={() => setCaseStudyImage(null)} />
    </section>
  );
};

const sectionStyle = {
  position: 'relative',
  paddingBottom: 0,
  width: '100%',
  boxSizing: 'border-box',
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
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
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
  lineHeight: 1,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: 'none',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const heroCtaStyle = {
  ...ctaStyle,
  width: 'auto',
  alignSelf: 'flex-end',
};

// Secondary CTA look: white background + static gradient border (no comet animation).
const ctaSecondaryStyle = {
  ...ctaStyle,
  background: 'linear-gradient(#ffffff, #ffffff) padding-box, linear-gradient(90deg, hsla(185,100%,45%,0) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%) border-box',
  border: '1px solid transparent',
  color: '#2a2420',
  boxShadow: 'none',
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
  fontSize: '0.95rem',
  opacity: 0.9,
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
  paddingTop: 0,
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
  marginTop: 'clamp(2rem, 4vw, 4rem)',
};

const capabilityCardTablePreviewStyle = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(0.8rem, 1.5vw, 1rem)',
  padding: 'clamp(1rem, 2vw, 1.35rem)',
  borderRadius: '1.1rem',
  border: '1px solid rgba(42,36,32,0.1)',
  // No bottom border: the anchor band is the card's bottom edge now, and the
  // hairline showed as a light line under the dark band (overflow clips at the
  // padding box, so the band can never paint over a border).
  borderBottomWidth: 0,
  background: 'rgba(255,255,255,1)',
  // Inset highlight only: the old `0 1px 0` outer shadow drew a straight hairline
  // that poked out past the rounded bottom corners once the anchor band landed.
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4)',
  boxSizing: 'border-box',
  overflow: 'hidden',
};

const capabilityCardStyle = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  padding: 'clamp(1rem, 2vw, 1.35rem)',
  borderRadius: '1.1rem',
  border: '1px solid rgba(42,36,32,0.1)',
  background: 'rgba(255,255,255,1)',
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
  width: '100%',
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
  border: '1px solid rgba(42,36,32,0.1)',
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

const aboutIdentityHeaderStyle = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 'clamp(0.75rem, 1.2vw, 1rem)',
  alignSelf: 'stretch',
  width: '100%',
};

const aboutIdentityAvatarShellStyle = {
  display: 'block',
  width: 'clamp(2.25rem, 4vw, 3.25rem)',
  height: 'clamp(2.25rem, 4vw, 3.25rem)',
  flexShrink: 0,
};

const aboutIdentityAvatarStyle = {
  width: '100%',
  height: '100%',
  borderRadius: '50%',
  objectFit: 'cover',
  display: 'block',
  boxShadow: '0 4px 14px rgba(42, 36, 32, 0.16)',
};

const aboutIdentityTextStackStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(0.3rem, 0.6vw, 0.4rem)',
  alignItems: 'flex-start',
  minWidth: 0,
};

const aboutHeadingStyle = {
  margin: 0,
  fontSize: 'clamp(1.2rem, 5.8vw, 2.1rem)',
  lineHeight: 1,
  fontWeight: 700,
  letterSpacing: '-0.035em',
  color: '#2a2420',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const aboutSignatureRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const aboutSignatureDotStyle = {
  // Sized in em off the same clamp as the label + #cmo-about-lead paragraph, so
  // the dot tracks the role text instead of drifting at other viewport widths.
  fontSize: 'clamp(0.8rem, 1vw, 0.88rem)',
  width: '0.5em',
  height: '0.5em',
  borderRadius: '50%',
  background: '#2a2420',
  flexShrink: 0,
};

const aboutSignatureStyle = {
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  // Reads as body copy, not a label: same size, weight, case and tracking as
  // aboutLeadStyle ("My background spans…"), only a touch darker.
  fontSize: 'clamp(0.8rem, 1vw, 0.88rem)',
  fontStyle: 'normal',
  fontWeight: 400,
  letterSpacing: 'normal',
  textTransform: 'none',
  color: 'rgba(42, 36, 32, 0.52)',
};

const aboutSignatureDividerStyle = {
  width: '1px',
  height: '0.8rem',
  background: 'rgba(42, 36, 32, 0.16)',
  flexShrink: 0,
};

const aboutSignatureSocialsRowStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.6rem',
};

const aboutSignatureSocialStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
  cursor: 'pointer',
  pointerEvents: 'auto',
  flexShrink: 0,
};

const aboutLeadStyle = {
  margin: 0,
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 'clamp(0.8rem, 1vw, 0.88rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.46)',
  textAlign: 'justify',
};

// Solid ink band closing the "I'm Bryan Balli" card — no copy, purely a visual
// anchor. Negative margins bleed it past the card's own padding so it meets the
// card edges and picks up the bottom corner radius.
const aboutAnchorFooterStyle = {
  marginTop: 'clamp(0.75rem, 1.5vw, 1.15rem)',
  marginLeft: 'calc(-1 * clamp(1rem, 2vw, 1.35rem))',
  marginRight: 'calc(-1 * clamp(1rem, 2vw, 1.35rem))',
  marginBottom: 'calc(-1 * clamp(1rem, 2vw, 1.35rem))',
  height: 'clamp(2.75rem, 5vw, 4.25rem)',
  // Positioning context + clip for the AnchorLavaShader canvas child, so the
  // canvas fills the band and is cut by the bottom corner radius below.
  position: 'relative',
  overflow: 'hidden',
  // Retained as the reduced-motion / no-WebGL fallback: AnchorLavaShader returns
  // null in those cases, otherwise its canvas paints over this gradient.
  // MUST stay in step with LAVA_BRAND_STOPS in components/home/lavaShaderEngine.js
  // (the shader's own default ramp) or the swap from this gradient to the canvas
  // becomes a visible colour jump. This is the one copy that cannot import it.
  // NOTE: deliberately no longer the same ramp as the primary CTA border and
  // Book-a-Call pill, which run a more saturated 90deg variant.
  background: 'linear-gradient(100deg, #adaed9 0%, #fbfaf3 52%, #d3a4c3 100%)',
  borderRadius: '0 0 1.1rem 1.1rem',
  // No boxShadow here — same class of bug as the parent card's old outer
  // shadow: a straight hairline that pokes out past the rounded bottom
  // corners instead of following the radius.
};

const aboutPreviouslyRowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  width: '100%',
  margin: '0 0 0.5rem',
};

const aboutPreviouslyLabelStyle = {
  margin: 0,
  flexShrink: 0,
  fontSize: '0.7rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.4)',
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
};

const aboutPreviouslyRuleStyle = {
  flex: 1,
  height: '1px',
  background: 'rgba(42, 36, 32, 0.14)',
};

const aboutAgencyMarqueeShellStyle = {
  width: '100%',
  maxWidth: '325px',
  overflow: 'hidden',
  maskImage: 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)',
};

const aboutAgencyMarqueeTrackStyle = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  willChange: 'transform',
  animation: 'agentMarquee 28s linear infinite',
};

const aboutMissionStatementStyle = {
  margin: 0,
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 'clamp(1.05rem, 1.7vw, 1.4rem)',
  lineHeight: 1.45,
  letterSpacing: '-0.015em',
  fontWeight: 500,
  color: 'rgba(42, 36, 32, 0.88)',
  textAlign: 'justify',
};

const aboutCopyCtaLineStyle = {
  margin: 0,
  fontFamily: "'Space Grotesk', system-ui, sans-serif",
  fontSize: 'clamp(0.8rem, 1vw, 0.88rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.46)',
  textAlign: 'justify',
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

const testimonialsSourceLinkStyle = {
  fontSize: 'clamp(0.75rem, 1vw, 0.85rem)',
  color: 'rgba(42, 36, 32, 0.55)',
  textDecoration: 'none',
  letterSpacing: '-0.01em',
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
  height: `${AGENCY_LOGO_BASE_HEIGHT}px`,
  width: 'auto',
  display: 'block',
  opacity: 0.45,
  filter: 'grayscale(1)',
  flexShrink: 0,
};

// Single source for every marquee copy (about block, panel, inline footer).
const agencyLogoImgStyle = (logo) => {
  const height = AGENCY_LOGO_BASE_HEIGHT * (logo.scale ?? 1);
  const sourceToRendered = height / logo.h;
  const [bearingLeft = 0, bearingRight = 0] = logo.bearing ?? [];
  return {
    ...agencyLogoStyle,
    width: 'auto',
    height: `${height.toFixed(2)}px`,
    marginLeft: `${(-bearingLeft * sourceToRendered).toFixed(2)}px`,
    marginRight: `${(-bearingRight * sourceToRendered).toFixed(2)}px`,
  };
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
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.75rem',
  paddingTop: 'clamp(1rem, 2vw, 1.5rem)',
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
  fontSize: '0.82rem',
  color: 'rgba(42, 36, 32, 0.4)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const inlineFooterSeoNavStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'clamp(2rem, 5vw, 4rem)',
  padding: 'clamp(2rem, 4vw, 3rem) 0',
  borderTop: '1px solid rgba(42, 36, 32, 0.1)',
  marginTop: '50px',
};

const inlineFooterNavColStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.7rem',
  flex: '1 1 120px',
};

const inlineFooterNavHeadingStyle = {
  fontSize: '0.68rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.35)',
  marginBottom: '0.2rem',
};

const inlineFooterNavLinkStyle = {
  fontSize: 'clamp(0.82rem, 1.1vw, 0.9rem)',
  color: 'rgba(42, 36, 32, 0.6)',
  textDecoration: 'none',
  cursor: 'pointer',
  lineHeight: 1.4,
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

// ── Dashboard contact + capabilities panel ──────────────────────────────────
// Renders the SAME capability-cards-section + contact footer as the homepage
// (StackedSlidesSection above), reusing the identical module-scope styles/data
// so the two stay in lockstep. The only intentional difference: the website
// URL-input pill (#footer-url-input-row) is omitted — dashboard users are
// already signed in. Used by DashboardPage in place of <SiteFooter />.
export function ContactCapabilitiesPanel() {
  const marqueeShellRef = useRef(null);
  const marqueeTrackRef = useRef(null);
  const marqueeSetRef = useRef(null);

  // "previously at…" agency-logo marquee — copied from StackedSlidesSection so
  // the scroll behavior is identical (IntersectionObserver-gated, visibility-paused).
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

    const applyTransform = () => { track.style.transform = `translate3d(${offset}px, 0, 0)`; };
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
    const handleVisibility = () => { if (document.hidden) { stop(); return; } start(); };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) { start(); return; }
        stop();
      },
      { root: null, threshold: 0, rootMargin: '120px 0px' }
    );
    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null;
    const images = Array.from(set.querySelectorAll('img'));
    const onImageLoad = () => scheduleMeasure();
    images.forEach((image) => { if (!image.complete) image.addEventListener('load', onImageLoad); });

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

  return (
    <section
      id="dashboard-contact-capabilities"
      style={{ ...panelStyle, minHeight: 'auto', background: 'transparent', boxShadow: 'none', color: '#2a2420' }}
    >
      <style>{`
        @keyframes agentMarquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } }
        @media (max-width: 767px) {
          #dashboard-contact-capabilities #footer-contact-cta { width: 100% !important; justify-content: center !important; box-sizing: border-box !important; }
          #dashboard-contact-capabilities #agency-marquee-shell > div > div { padding-right: 2rem !important; gap: 2rem !important; }
        }
        #dashboard-contact-capabilities #panel-capabilities-layout { padding-left: 0 !important; padding-right: 0 !important; }
      `}</style>
      <div style={contentStyle}>
        <div style={innerStyle}>
          <div id="panel-capabilities-layout" style={gridLayoutStyle}>
            <div data-grid-window style={gridWindowStyle}>
              <div data-grid-inner style={gridInnerContainerStyle}>
                <div id="stacked-inline-footer" style={inlineFooterStyle}>
                  <div id="inline-footer-value-block" style={inlineFooterNewsletterStyle}>
                    <div id="footer-marquee-shell" style={{ width: '100%', overflow: 'hidden', marginBottom: 'clamp(24px, 5vw, 75px)', maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 28s linear infinite' }}>
                        {[0, 1].map((i) => (
                          <div key={i} aria-hidden={i > 0 ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                            {['CONTACT', '•', 'CONTACT', '•'].map((w, j) => (
                              <span key={j} style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(1.6rem, 28.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>{w}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                    <Image src="/img/sig.png" alt="Bryan Balli signature" width={276} height={208} style={inlineFooterSignatureStyle} />

                    <div id="footer-cta-input-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 'clamp(0.5rem, 1.5vw, 1rem)', width: '100%', marginTop: 'clamp(1.25rem, 2.5vw, 2rem)', marginBottom: 0 }}>
                      <a
                        id="footer-contact-cta"
                        href="https://calendly.com/bballi/30min"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cta-pill-btn"
                        style={{ ...heroCtaStyle, textDecoration: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, alignSelf: 'center' }}
                      >
                        <Image src="/img/profile2_400x400.png" width={28} height={28} style={ctaAvatarStyle} alt="" />
                        Book a Call with Bryan
                        <UpRightArrow style={ctaIconStyle} />
                      </a>
                    </div>
                    <p id="footer-capabilities-summary" style={{ ...supportTextStyle, marginTop: 'clamp(1rem, 2vw, 1.5rem)', marginBottom: 'clamp(0.75rem, 1.5vw, 1.25rem)', textAlign: 'left' }}>
                      <strong style={{ color: '#2a2420' }}>Bryan Balli</strong> · Creative Lead @ HITLOOP
                    </p>
                    <p id="footer-previously-at" style={{ margin: '0.5rem 0 0.35rem', textAlign: 'center', fontSize: '0.7rem', letterSpacing: '0.06em', color: 'rgba(42,36,32,0.32)', fontFamily: "'Space Mono', monospace" }}>previously at…</p>
                    <a id="agency-marquee-shell" ref={marqueeShellRef} href="https://www.linkedin.com/in/bryanballi/" target="_blank" rel="noopener noreferrer" style={{ ...agencyMarqueeShellStyle, cursor: 'pointer', textDecoration: 'none', display: 'block' }}>
                      <div ref={marqueeTrackRef} style={agencyMarqueeTrackStyle}>
                        <div ref={marqueeSetRef} style={agencyMarqueeSetStyle}>
                          {agencyLogos.map((logo) => (
                            <Image key={`agency-a-${logo.alt}`} src={logo.src} alt={logo.alt} width={logo.w} height={logo.h} style={agencyLogoImgStyle(logo)} />
                          ))}
                        </div>
                        <div aria-hidden="true" style={agencyMarqueeSetStyle}>
                          {agencyLogos.map((logo) => (
                            <Image key={`agency-b-${logo.alt}`} src={logo.src} alt="" width={logo.w} height={logo.h} style={agencyLogoImgStyle(logo)} />
                          ))}
                        </div>
                      </div>
                    </a>
                  </div>
                  {/* Footer nav links temporarily disabled — bringing back later.
                  <div id="inline-footer-seo-nav" style={inlineFooterSeoNavStyle}>
                    <div style={inlineFooterNavColStyle}>
                      <span style={inlineFooterNavHeadingStyle}>Work</span>
                      <a href="/work" style={inlineFooterNavLinkStyle}>Featured Projects</a>
                      <a href="/case-studies" style={inlineFooterNavLinkStyle}>Case Studies</a>
                      <a href="/process" style={inlineFooterNavLinkStyle}>Process</a>
                    </div>
                    <div style={inlineFooterNavColStyle}>
                      <span style={inlineFooterNavHeadingStyle}>Services</span>
                      <a href="/services/ai-design-consulting" style={inlineFooterNavLinkStyle}>AI Design Consulting</a>
                      <a href="/services/web-development" style={inlineFooterNavLinkStyle}>Web Development</a>
                      <a href="/services/brand-identity" style={inlineFooterNavLinkStyle}>Brand Identity</a>
                      <a href="/services/design-systems" style={inlineFooterNavLinkStyle}>Design Systems</a>
                      <a href="/services/seo-geo" style={inlineFooterNavLinkStyle}>SEO &amp; GEO</a>
                    </div>
                    <div style={inlineFooterNavColStyle}>
                      <span style={inlineFooterNavHeadingStyle}>FAQ</span>
                      <a href="/faq#what-is-a-creative-technologist" style={inlineFooterNavLinkStyle}>What Is a Creative Technologist?</a>
                      <a href="/faq#ai-design-engineer" style={inlineFooterNavLinkStyle}>What Is an AI Design Engineer?</a>
                      <a href="/faq#how-i-work" style={inlineFooterNavLinkStyle}>How I Work</a>
                      <a href="/faq#pricing" style={inlineFooterNavLinkStyle}>Pricing &amp; Engagements</a>
                      <a href="/faq#turnaround" style={inlineFooterNavLinkStyle}>Turnaround &amp; Availability</a>
                    </div>
                    <div style={inlineFooterNavColStyle}>
                      <span style={inlineFooterNavHeadingStyle}>Company</span>
                      <a href="/about" style={inlineFooterNavLinkStyle}>About</a>
                      <a href="/how-it-works" style={inlineFooterNavLinkStyle}>How It Works</a>
                      <a href="/contact" style={inlineFooterNavLinkStyle}>Contact</a>
                      <a href="https://calendly.com/bballi/30min" target="_blank" rel="noopener noreferrer" style={inlineFooterNavLinkStyle}>Book a Call</a>
                    </div>
                  </div>
                  */}
                  <div id="inline-footer-bottom" style={inlineFooterBottomStyle}>
                    <span style={inlineFooterCopyrightStyle}>© 2026 Bryan Balli · All rights reserved</span>
                    <div style={inlineFooterLegalStyle}>
                      <a href="https://www.linkedin.com/in/bryanballi" style={inlineFooterLegalLinkStyle}>LinkedIn</a>
                      <a href="https://x.com/bai_ee" style={inlineFooterLegalLinkStyle}>𝕏</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
