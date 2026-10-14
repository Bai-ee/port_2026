'use strict';

// brain-sync.cjs — the Client Brain is the source of truth for strategy fields.
//
// One ownership manifest per settings store maps each Brain-owned card field
// to exactly ONE home section in CLIENT_BRAIN.md. Two directions, never a loop:
//   Brain -> card:  syncBrainToSystem() writes the projection into every store
//                   when an approved Brain is approved or injected.
//   card -> Brain:  writeCardEditsToBrain() rewrites the home section of each
//                   field the operator changed, then recompiles the Markdown.
// Items a card cannot show (past its cap, or filtered out such as an
// unsupported platform) stay in the Brain on write-back. A value the Brain only
// derives (no explicit home section yet) fills an empty field but never
// replaces one an operator tuned.
//
// Stores: marketingBrief (client_configs.marketingBriefConfig, Market Signals +
// Listening), digest (digest_config/{clientId}), brandOverview
// (dashboard_state.snapshot.brandOverview + client_configs mirror).
// Pure helpers are exported for tests; Firestore lives in the async functions.

const {
  parseFrontmatter,
  parseSections,
  firstSection,
  field,
  normalizeKey,
  cleanList,
  parseSearchQueryRows,
  setMarkdownField,
  setFrontmatterValues,
} = require('./markdown.cjs');
const { normalizeSearchTerms } = require('../scout-intake/search-term-normalizer.js');

const ALLOWED_SOURCE_PLATFORMS = new Set(['web', 'x', 'reddit', 'instagram', 'youtube', 'tiktok', 'hackernews']);
const DEFAULT_DIGEST_TONE = 'concise, professional, direct';

const SECTIONS = {
  identity: { section: 'Identity Intelligence', sectionAliases: ['Identity'] },
  market: { section: 'Market Intelligence', sectionAliases: ['Market'] },
  discovery: { section: 'Discovery Intelligence', sectionAliases: ['Discovery'] },
  authority: { section: 'Authority Intelligence', sectionAliases: ['Authority'] },
  content: { section: 'Content Intelligence', sectionAliases: ['Content'] },
  opportunity: { section: 'Opportunity Intelligence', sectionAliases: ['Opportunity'] },
  strategy: { section: 'Strategy Document', sectionAliases: [] },
};

const text = (max) => (v) => String(v || '').trim().slice(0, max);
const handleList = (cap) => (list) => cleanList(list, { maxItems: cap, maxLen: 120 });
// Prose list items keep their commas; array items are each one whole value.
const proseList = (cap, maxLen = 240) => (list) => cleanList(
  Array.isArray(list) ? list.map((item) => `- ${String(item || '').replace(/^[-*]\s+/, '')}`) : list,
  { maxItems: cap, maxLen, keepBullets: true },
);
// Dotted keys ('campaign.ctaText') address nested store fields.
const getPath = (obj, key) => String(key).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function toNested(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const parts = key.split('.');
    let node = out;
    parts.slice(0, -1).forEach((k) => { node = node[k] = node[k] || {}; });
    node[parts[parts.length - 1]] = value;
  }
  return out;
}
const cleanXHandle = (v) => String(v ?? '').trim()
  .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);

const toList = (v) => (Array.isArray(v) ? v : String(v || '').split(/\s*[;\n]\s*|,\s+/)).map((s) => String(s || '').trim()).filter(Boolean);

/* ------------------------------------------------------------ derivations */

const sec = (sections, s) => firstSection(sections, [s.section, ...s.sectionAliases]);

function deriveSearchRows(sections) {
  const disc = sec(sections, SECTIONS.discovery);
  const market = sec(sections, SECTIONS.market);
  const keywords = cleanList(field(disc, ['Keywords']) || field(market, ['Search Keywords', 'Keywords']), { maxItems: 8 });
  const topics = cleanList(field(market, ['Topics To Monitor', 'Topics']), { maxItems: 8 });
  const competitors = cleanList(field(market, ['Competitors', 'Direct Competitors']), { maxItems: 8 });
  return [
    keywords.length && { label: 'BRAND', query: keywords.join(' OR '), goal: 'Find current mentions, questions, and language around the client and its offers.' },
    topics.length && { label: 'CATEGORY', query: topics.join(' OR '), goal: 'Find market conversations, timely angles, and category language worth acting on.' },
    competitors.length && { label: 'COMPETITORS', query: competitors.join(' OR '), goal: 'Track competitor positioning, offers, launches, and audience reactions.' },
  ].filter(Boolean);
}

function deriveSourceFocus(sections) {
  const id = sec(sections, SECTIONS.identity);
  const positioning = String(field(id, ['Positioning', 'One Liner', 'One-Liner']) || '').trim();
  const audience = cleanList(field(id, ['Primary Audience', 'Audience', 'Who Hires Them']), { maxItems: 4 });
  return [positioning, audience.length ? `Audience: ${audience.join(', ')}.` : ''].filter(Boolean).join('\n');
}

function deriveReviewerContext(sections) {
  const id = sec(sections, SECTIONS.identity);
  const name = String(field(id, ['Name']) || '').trim();
  const positioning = String(field(id, ['Positioning', 'One Liner', 'One-Liner']) || '').trim();
  return [name, positioning].filter(Boolean).join(': ');
}

function deriveDoNotSay(sections) {
  return cleanList(field(sec(sections, SECTIONS.content), ['Do Not Say', 'Banned Words']), { maxItems: 20, keepBullets: true });
}

function deriveDigestTone(sections) {
  const voice = String(field(sec(sections, SECTIONS.content), ['Voice', 'Tone', 'Writing Style']) || '').trim();
  return (voice.split(/(?<=[.!?])\s+/)[0] || '').replace(/\.$/, '');
}

function deriveIndustry(sections) {
  return cleanList(field(sec(sections, SECTIONS.identity), ['Category To Own', 'Categories To Own', 'Category']), { maxItems: 1 })[0] || '';
}

function derivePrimaryUrl(sections) {
  return String(field(sec(sections, SECTIONS.identity), ['Primary Url', 'Website', 'URL']) || '').trim();
}

function deriveBusinessModel(sections) {
  const offers = cleanList(field(sec(sections, SECTIONS.identity), ['Offers', 'Services', 'What They Sell']), { maxItems: 6 });
  return offers.length ? `Offers: ${offers.join('; ')}.` : '';
}

/* -------------------------------------------------------------- manifests */

// `normalize` must match the owning save route's own normalization so a synced
// value never reads as a fresh operator edit.
const MARKET_SIGNALS_FIELDS = [
  { key: 'brandName', kind: 'scalar', ...SECTIONS.identity, field: 'Name', normalize: text(120) },
  { key: 'brandXHandle', kind: 'scalar', ...SECTIONS.identity, field: 'X Handle', fieldAliases: ['Twitter Handle'],
    normalize: (v) => String(v || '').trim().replace(/^@+/, '').slice(0, 40) },
  { key: 'brandKeywords', kind: 'list', ...SECTIONS.discovery, field: 'Keywords', fieldAliases: ['Search Keywords'],
    normalize: (list) => normalizeSearchTerms(list, { max: 12 }) },
  { key: 'categoryTerms', kind: 'list', ...SECTIONS.market, field: 'Topics To Monitor', fieldAliases: ['Topics'],
    normalize: (list) => normalizeSearchTerms(list, { max: 12 }) },
  { key: 'competitors', kind: 'list', ...SECTIONS.market, field: 'Competitors', fieldAliases: ['Direct Competitors'], normalize: handleList(20) },
  { key: 'kols', kind: 'list', ...SECTIONS.discovery, field: 'Watch Lists', fieldAliases: ['Watchlists', 'KOL Watchlist', 'KOLs'], normalize: handleList(20) },
  { key: 'instagramHandles', kind: 'list', ...SECTIONS.discovery, field: 'Instagram Handles', normalize: handleList(20) },
  { key: 'sourcePlatforms', kind: 'list', ...SECTIONS.discovery, field: 'Primary Platforms', fieldAliases: ['Platforms'],
    normalize: (list) => [...new Set(list.map((p) => String(p || '').trim().toLowerCase()).filter((p) => ALLOWED_SOURCE_PLATFORMS.has(p)))].slice(0, 10) },
  { key: 'searches', kind: 'rows', ...SECTIONS.discovery, field: 'Search Queries',
    normalize: (rows) => (Array.isArray(rows) ? rows : [])
      .map((row, i) => ({
        label: String(row?.label || `SEARCH ${i + 1}`).replace(/\s+/g, ' ').trim().slice(0, 60),
        query: String(row?.query || '').replace(/\s+/g, ' ').trim().slice(0, 600),
        goal: String(row?.goal || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      }))
      .filter((row) => row.query)
      .slice(0, 8),
    derive: deriveSearchRows },
  { key: 'sourceFocus', kind: 'scalar', ...SECTIONS.discovery, field: 'Source Focus', normalize: text(1000), derive: deriveSourceFocus },
  { key: 'scoutInstructions', kind: 'scalar', ...SECTIONS.discovery, field: 'Scout Instructions', normalize: text(6000) },
  { key: 'scribeTone', kind: 'scalar', ...SECTIONS.content, field: 'Voice', fieldAliases: ['Tone', 'Writing Style'], normalize: text(4000) },
  { key: 'scribeHardConstraints', kind: 'list', prose: true, ...SECTIONS.content, field: 'Hard Constraints',
    normalize: proseList(20), derive: deriveDoNotSay },
  { key: 'guardianReviewerContext', kind: 'scalar', ...SECTIONS.content, field: 'Reviewer Context', normalize: text(800), derive: deriveReviewerContext },
  // Guardian rejects false claims, so its patterns live with Prohibited Claims.
  { key: 'guardianRestrictedPatterns', kind: 'list', ...SECTIONS.authority, field: 'Prohibited Claims', fieldAliases: ['Claims Prohibited'],
    normalize: proseList(30) },
  // Opportunity Signals query rows keep their on/off state in the Brain.
  { key: 'opportunitySignals.queries', kind: 'rows', rowKeys: ['label', 'query', 'enabled'], ...SECTIONS.opportunity, field: 'Opportunity Queries',
    normalize: (rows) => (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        label: String(row?.label || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        query: String(row?.query || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        enabled: row?.enabled !== false && String(row?.enabled).toLowerCase() !== 'false',
      }))
      .filter((row) => row.query)
      .slice(0, 10) },
  // X growth profile (X Strategy): own handle shares its home with brandXHandle.
  { key: 'xGrowth.ownHandle', kind: 'scalar', ...SECTIONS.identity, field: 'X Handle', fieldAliases: ['Twitter Handle'], normalize: cleanXHandle },
  { key: 'xGrowth.benchmarkHandles', kind: 'list', ...SECTIONS.market, field: 'Benchmark Accounts',
    normalize: (list) => [...new Set(list.map(cleanXHandle).filter(Boolean))].slice(0, 8) },
];

const DIGEST_FIELDS = [
  { key: 'tone', kind: 'scalar', ...SECTIONS.content, field: 'Email Tone', normalize: text(200), derive: deriveDigestTone,
    emptyValues: [DEFAULT_DIGEST_TONE] },
  { key: 'extraInstructions', kind: 'scalar', ...SECTIONS.content, field: 'Email Instructions', normalize: text(2000) },
  { key: 'contactUrl', kind: 'scalar', ...SECTIONS.identity, field: 'Contact Url', normalize: text(500) },
];

const BRAND_OVERVIEW_FIELDS = [
  { key: 'positioning', kind: 'scalar', ...SECTIONS.identity, field: 'Positioning', fieldAliases: ['One Liner', 'One-Liner'], normalize: text(600) },
  { key: 'targetAudience', kind: 'joined', ...SECTIONS.identity, field: 'Primary Audience', fieldAliases: ['Audience', 'Who Hires Them'],
    normalize: (v) => toList(v).join(', ').slice(0, 600) },
  { key: 'headline', kind: 'scalar', ...SECTIONS.identity, field: 'Strategic One-Liner', normalize: text(200) },
  { key: 'summary', kind: 'scalar', ...SECTIONS.identity, field: 'Mission', normalize: text(1000) },
  { key: 'businessModel', kind: 'scalar', ...SECTIONS.identity, field: 'Business Model', normalize: text(600), derive: deriveBusinessModel },
  { key: 'industry', kind: 'scalar', ...SECTIONS.identity, field: 'Industry', normalize: text(100), derive: deriveIndustry },
];

const linesOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/\n+|;\s*/)).map((s) => String(s || '').replace(/^[-*]\s+/, '').trim()).filter(Boolean);

// dashboard_state.strategyBuilder.config — operational fields (days, cadence,
// post times, signals, sources) stay card-owned.
const STRATEGY_BUILDER_FIELDS = [
  { key: 'vertical', kind: 'scalar', ...SECTIONS.identity, field: 'Industry', normalize: text(100), derive: deriveIndustry },
  { key: 'campaign.ctaText', kind: 'first', ...SECTIONS.content, field: 'Calls To Action', fieldAliases: ['CTAs'], normalize: text(80) },
  { key: 'campaign.ctaUrl', kind: 'scalar', ...SECTIONS.content, field: 'CTA Url', normalize: text(300), derive: derivePrimaryUrl },
  { key: 'campaign.guardrails', kind: 'joined', joiner: '\n', split: linesOf, ...SECTIONS.content, field: 'Hard Constraints',
    normalize: (v) => linesOf(v).join('\n').slice(0, 500), derive: deriveDoNotSay },
  { key: 'editorial.operatorPreferences.avoidTopics', kind: 'list', ...SECTIONS.content, field: 'Topics To Avoid',
    normalize: (list) => cleanList(list, { maxItems: 20, maxLen: 120 }) },
  { key: 'editorial.operatorPreferences.preferredNarratives', kind: 'list', ...SECTIONS.content, field: 'Content Pillars', fieldAliases: ['Pillars'],
    normalize: (list) => cleanList(list, { maxItems: 20, maxLen: 120 }) },
];

/* ------------------------------------------- X Strategy: document + tracks */

// Strategy document (x_strategy_docs). One `### <title>` field per section under
// `## Strategy Document`. Keys/titles mirror STRATEGY_DOC_SECTIONS in
// features/x-strategy/strategy-doc.js (a test enforces parity; that module is
// ESM so it can't be required here).
const STRATEGY_DOC_FIELD_DEFS = [
  ['thesis', 'Thesis'], ['audience', 'Audience'], ['tracks', 'Tracks'], ['formats', 'Formats'],
  ['rules', 'Rules'], ['algorithm', 'Algorithm'], ['decisions', 'Decisions'], ['open', 'Open questions'],
];
const STRATEGY_DOC_FIELDS = STRATEGY_DOC_FIELD_DEFS.map(([key, title]) => ({
  key, kind: 'scalar', ...SECTIONS.strategy, field: title,
  normalize: (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim().slice(0, 2000),
}));

// `key: value | key: value` bullet rows. Keys are matched case-insensitively with
// punctuation ignored ("postsPerDay" = "posts per day" = "posts-per-day").
const rowKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function parseKeyedRows(text, maxItems = 20) {
  return String(text || '').split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l))
    .map((line) => {
      const f = {};
      line.replace(/^[-*]\s+/, '').split('|').forEach((seg) => {
        const m = seg.match(/^\s*([A-Za-z][A-Za-z0-9 _-]*?)\s*:\s*(.*?)\s*$/);
        if (m) f[rowKey(m[1])] = m[2];
      });
      return f;
    })
    .slice(0, maxItems);
}
const splitItems = (v) => String(v || '').split(/\s*[;,]\s*/).map((s) => s.trim()).filter(Boolean);
const num = (v) => { const n = parseFloat(String(v ?? '').replace('%', '')); return Number.isFinite(n) ? n : undefined; };
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;
const lower = (v) => String(v || '').trim().toLowerCase();

// Content tracks. Brain row: `label: Design | share: 50% | topics: a; b | benchmarks: h1; h2`.
// share accepts "50", "50%" or "0.5" (a bare value <= 1 is a fraction); stored 0-1.
function parseShare(v) {
  const n = num(v);
  if (n === undefined) return undefined;
  return /%/.test(String(v)) || n > 1 ? n / 100 : n;
}
function parseTrackRows(text) {
  return parseKeyedRows(text, 12).map((f) => ({
    label: f.label || '',
    share: parseShare(f.share),
    topics: splitItems(f.topics),
    benchmarks: splitItems(f.benchmarks),
  }));
}
function normalizeTrackRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const share = Number(r?.share);
    return {
      label: String(r?.label || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      ...(r?.share != null && Number.isFinite(share) ? { share: round(Math.min(1, Math.max(0, share)), 3) } : {}),
      topics: [...new Set((Array.isArray(r?.topics) ? r.topics : []).map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 12),
      benchmarks: [...new Set((Array.isArray(r?.benchmarks) ? r.benchmarks : [])
        .map((h) => String(h).trim().replace(/^@/, '').toLowerCase()).filter(Boolean))].slice(0, 3),
    };
  }).filter((r) => r.label).slice(0, 6);
}
const formatTrackRow = (r) => [
  `label: ${r.label}`,
  r.share != null && `share: ${round(r.share * 100, 1)}%`,
  r.topics.length && `topics: ${r.topics.join('; ')}`,
  r.benchmarks.length && `benchmarks: ${r.benchmarks.join('; ')}`,
].filter(Boolean).join(' | ');

// Does `a` already reflect every row of `b` (matched by key, compared on the fields both define)?
function rowsReflect(a, b, keyFn, fieldsEqual) {
  return (b || []).every((rb) => {
    const ra = (a || []).find((x) => keyFn(x) === keyFn(rb));
    return ra && fieldsEqual(ra, rb);
  });
}
const sameSet = (x, y) => same([...(x || [])].sort(), [...(y || [])].sort());
const tracksEqual = (a, b) => rowsReflect(a, b, (r) => lower(r.label), (ra, rb) =>
  (ra.share == null || rb.share == null || Math.abs(ra.share - rb.share) < 0.002)
  && sameSet(ra.topics, rb.topics) && sameSet(ra.benchmarks, rb.benchmarks));

// Track targets. Brain row:
//   `track: Design | postsPerDay: 2 | original-showcase: 30 | original-text: 20 | reply: 30 | quote: 15 | self-quote: 5 | video: 40`
// (type values are percents). MAPPED onto the plan: postsPerDay only (split across the
// track's engines -> engineTargets.engines.*, and the all-track sum -> plan.authoredPerDay).
// The per-type and video shares have no per-track home in the plan schema (typeFloors /
// typeCaps are global slot counts; normalizeContentTracks drops unknown track fields),
// so they stay Brain-only and are carried through write-back untouched.
const TARGET_SHARE_KEYS = ['original-showcase', 'original-text', 'reply', 'quote', 'self-quote', 'video'];
function parseTargetRows(text) {
  return parseKeyedRows(text, 12).map((f) => {
    const row = { track: f.track || '', postsPerDay: num(f.postsperday) };
    for (const k of TARGET_SHARE_KEYS) { const n = num(f[rowKey(k)]); if (n !== undefined) row[k] = n; }
    return row;
  });
}
function normalizeTargetRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const out = { track: String(r?.track || '').replace(/\s+/g, ' ').trim().slice(0, 60) };
    const ppd = Number(r?.postsPerDay);
    if (r?.postsPerDay != null && Number.isFinite(ppd)) out.postsPerDay = round(Math.min(20, Math.max(0, ppd)), 1);
    for (const k of TARGET_SHARE_KEYS) {
      const n = Number(r?.[k]);
      if (r?.[k] != null && Number.isFinite(n)) out[k] = round(Math.min(100, Math.max(0, n)), 1);
    }
    return out;
  }).filter((r) => r.track).slice(0, 6);
}
const formatTargetRow = (r) => [
  `track: ${r.track}`,
  r.postsPerDay != null && `postsPerDay: ${r.postsPerDay}`,
  ...TARGET_SHARE_KEYS.filter((k) => r[k] != null).map((k) => `${k}: ${r[k]}`),
].filter(Boolean).join(' | ');
// Mapped field only; postsPerDay within half a post (engine rounding is lossy).
const targetsEqual = (a, b) => rowsReflect(a, b, (r) => lower(r.track), (ra, rb) =>
  ra.postsPerDay == null || rb.postsPerDay == null || Math.abs(ra.postsPerDay - rb.postsPerDay) <= 0.5);

const CONTENT_TRACKS_FIELDS = [
  { key: 'contentTracks', kind: 'rows', ...SECTIONS.content, field: 'Content Tracks',
    parse: parseTrackRows, normalize: normalizeTrackRows, format: formatTrackRow, equals: tracksEqual },
];
const TRACK_TARGETS_FIELDS = [
  { key: 'trackTargets', kind: 'rows', ...SECTIONS.content, field: 'Track Targets',
    parse: parseTargetRows, normalize: normalizeTargetRows, format: formatTargetRow, equals: targetsEqual,
    rowId: (r) => lower(r.track), carry: TARGET_SHARE_KEYS },
];

// contentTracks is written before trackTargets (targets look tracks up by label).
const TARGETS = {
  marketingBrief: MARKET_SIGNALS_FIELDS,
  digest: DIGEST_FIELDS,
  brandOverview: BRAND_OVERVIEW_FIELDS,
  strategyBuilder: STRATEGY_BUILDER_FIELDS,
  strategyDoc: STRATEGY_DOC_FIELDS,
  contentTracks: CONTENT_TRACKS_FIELDS,
  trackTargets: TRACK_TARGETS_FIELDS,
};

const MANIFEST_KEYS = MARKET_SIGNALS_FIELDS.map((s) => s.key);

/* ------------------------------------------------------------- projection */

function readRaw(sections, spec) {
  const value = field(sec(sections, spec), [spec.field, ...(spec.fieldAliases || [])]);
  if (spec.kind === 'scalar') return String(value || '').trim();
  if (spec.kind === 'rows') return spec.parse ? spec.parse(value) : parseSearchQueryRows(value, { maxItems: 50 });
  // A joined field is one prose value split into bullets: let a bullet carry the
  // whole value so the round trip never truncates it.
  return cleanList(value, { maxItems: 200, maxLen: spec.kind === 'joined' ? 1000 : 240, keepBullets: Boolean(spec.prose) || spec.kind === 'joined' || spec.kind === 'first' });
}

const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : !String(v || '').trim());
const isEmptyFor = (spec, v) => isEmpty(v) || (spec.emptyValues || []).includes(v);

// Brain Markdown -> { values, raw, origin } for every field in `fields` the
// Brain can fill. A field the Brain has nothing for is omitted (never blanked).
function projectFields(markdown, fields) {
  const { body } = parseFrontmatter(markdown);
  const sections = parseSections(body);
  const values = {};
  const raw = {};
  const origin = {};
  for (const spec of fields) {
    const r = readRaw(sections, spec);
    raw[spec.key] = r;
    let value = isEmpty(r) ? null : spec.normalize(spec.kind === 'first' ? r[0] : r);
    let from = 'brain';
    if ((value == null || isEmpty(value)) && spec.derive) {
      value = spec.normalize(spec.derive(sections));
      from = 'derived';
    }
    if (value == null || isEmpty(value)) continue;
    values[spec.key] = value;
    origin[spec.key] = from;
  }
  return { values, raw, origin };
}

const projectMarketSignals = (markdown) => projectFields(markdown, MARKET_SIGNALS_FIELDS);

/* ------------------------------------------------------------- write-back */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keyOf = (v) => String(v || '').trim().toLowerCase().replace(/^@+/, '');

function normalizeEdit(spec, value) {
  if (spec.kind === 'scalar' || spec.kind === 'joined' || spec.kind === 'first') return spec.normalize(value);
  if (spec.kind === 'rows') return spec.normalize(value);
  return spec.normalize(Array.isArray(value) ? value : cleanList(value, { maxItems: 200, keepBullets: Boolean(spec.prose) }));
}

function sectionBody(spec, value, raw, projected, { keepOverflow = true } = {}) {
  if (spec.kind === 'scalar') return value;
  if (spec.kind === 'joined') return (spec.split || toList)(value).map((item) => `- ${item}`).join('\n');
  if (spec.kind === 'first') {
    const rest = (Array.isArray(raw) ? raw : []).slice(1).filter((item) => keyOf(item) !== keyOf(value));
    return [value, ...rest].filter(Boolean).map((item) => `- ${item}`).join('\n');
  }
  if (spec.kind === 'rows' && spec.format) return value.map((row) => `- ${spec.format(row)}`).join('\n');
  if (spec.kind === 'rows') {
    const keys = spec.rowKeys || ['label', 'query', 'goal'];
    return value.map((row) => `- ${keys
      .filter((k) => k !== 'enabled' || row.enabled === false)
      .filter((k) => k === 'enabled' || String(row[k] ?? '').trim())
      .map((k) => `${k}: ${String(row[k]).replace(/\|/g, '/')}`)
      .join(' | ')}`).join('\n');
  }
  // Keep Brain items the card never showed: ones it filters out (unsupported
  // platform, prose-length term) and, unless keepOverflow is off, ones past
  // its cap.
  const shown = new Set((projected || []).map(keyOf));
  const filteredOut = (item) => isEmpty(spec.normalize([item]));
  const kept = (Array.isArray(raw) ? raw : [])
    .filter((item) => !shown.has(keyOf(item)))
    .filter((item) => keepOverflow || filteredOut(item));
  const seen = new Set();
  return [...value, ...kept]
    .filter((item) => { const k = keyOf(item); if (!k || seen.has(k)) return false; seen.add(k); return true; })
    .map((item) => `- ${item}`)
    .join('\n');
}

// Rewrite the home section of every field in `edits` whose value differs from
// what the Brain currently projects. Returns the new Markdown and the keys it
// changed (empty when nothing differs).
//   adopt: settings adoption — write the settings' own list items (unnormalized,
//   so nothing is lost from the Brain) and keep only Brain items the card
//   filters out, so the first sync reproduces the settings exactly.
function applyCardEditsToMarkdown(markdown, edits = {}, fields = MARKET_SIGNALS_FIELDS, { adopt = false } = {}) {
  const { values: projected, raw } = projectFields(markdown, fields);
  let next = String(markdown || '');
  const changed = [];
  for (const spec of fields) {
    if (!Object.prototype.hasOwnProperty.call(edits, spec.key)) continue;
    const value = normalizeEdit(spec, edits[spec.key]);
    const current = projected[spec.key] ?? (['scalar', 'joined', 'first'].includes(spec.kind) ? '' : []);
    // Row fields with an `equals` hook compare only what the store can hold, both ways.
    if (spec.equals ? spec.equals(value, current) && spec.equals(current, value) : same(value, current)) continue;
    // Clearing a field the Brain only derives (no home section yet), or setting
    // a store default, is not an edit.
    if (isEmptyFor(spec, value) && isEmpty(raw[spec.key])) continue;
    let written = adopt && spec.kind === 'list'
      ? proseList(200)(Array.isArray(edits[spec.key]) ? edits[spec.key] : cleanList(edits[spec.key], { maxItems: 200 }))
      : value;
    // Brain-only row fields (`carry`) survive a write-back that cannot represent them.
    if (spec.carry) {
      written = written.map((row) => {
        const old = (projected[spec.key] || []).find((r) => spec.rowId(r) === spec.rowId(row));
        return old ? { ...Object.fromEntries(spec.carry.filter((k) => old[k] != null).map((k) => [k, old[k]])), ...row } : row;
      });
    }
    next = setMarkdownField(next, spec, sectionBody(spec, written, raw[spec.key], projected[spec.key], { keepOverflow: !adopt }));
    changed.push(spec.key);
  }
  return { markdown: next, changed };
}

// Fields whose value changed between two saved configs — only these count as
// operator edits. A whole-form save never pushes untouched stale values.
function changedManifestFields(prior = {}, next = {}, fields = MARKET_SIGNALS_FIELDS) {
  const out = {};
  for (const spec of fields) {
    const b = getPath(next, spec.key);
    if (b === undefined) continue;
    if (!same(normalizeEdit(spec, getPath(prior, spec.key)), normalizeEdit(spec, b))) out[spec.key] = b;
  }
  return out;
}

/* --------------------------------------------------------- scoutConfig mirror */

// Mirror the canonical brand identity into scoutConfig (external scouts read
// it, not marketingBriefConfig). Shared by the config route and the sync.
function buildScoutConfigMirror(marketingBriefConfig, { priorScoutConfig = null, priorSourceWebsiteUrl = null } = {}) {
  const quoteTerm = (t) => (/\s/.test(t) && !/^".*"$/.test(t) ? `"${t}"` : t);
  const quotedKeywords = (marketingBriefConfig.brandKeywords || []).map(quoteTerm);
  if (priorScoutConfig) {
    const mirror = { brandKeywords: quotedKeywords, categoryTerms: marketingBriefConfig.categoryTerms || [] };
    if (marketingBriefConfig.brandName) mirror.clientName = marketingBriefConfig.brandName;
    if (priorScoutConfig.reddit) mirror.reddit = { mentionQueries: quotedKeywords };
    return mirror;
  }
  if (!priorSourceWebsiteUrl) {
    return {
      clientName: marketingBriefConfig.brandName || '',
      brandKeywords: quotedKeywords,
      categoryTerms: marketingBriefConfig.categoryTerms || [],
      competitors: [],
      industry: '',
      reddit: { subreddits: [], mentionQueries: quotedKeywords },
    };
  }
  return null;
}

// Brain values to write into a store: derived values only fill empty fields.
function planTargetWrite(fields, markdown, current = {}) {
  const { values, origin } = projectFields(markdown, fields);
  for (const spec of fields) {
    if (origin[spec.key] === 'derived' && !isEmptyFor(spec, getPath(current, spec.key))) delete values[spec.key];
  }
  // Compare against the normalized current value: whitespace or legacy
  // formatting the card itself would normalize on save is not a change.
  const specOf = Object.fromEntries(fields.map((s) => [s.key, s]));
  const normalizedCurrent = (k) => {
    const cur = getPath(current, k);
    return isEmpty(cur) ? cur : normalizeEdit(specOf[k], cur);
  };
  for (const k of Object.keys(values)) {
    const eq = specOf[k].equals ? specOf[k].equals(normalizedCurrent(k) || [], values[k]) : same(normalizedCurrent(k), values[k]);
    if (eq) delete values[k];
  }
  const diff = Object.keys(values)
    .map((k) => ({ field: k, from: getPath(current, k) ?? null, to: values[k], origin: origin[k] }));
  return { values, diff };
}

/* -------------------------------------------------------------- Firestore */

function lazyStore() {
  return require('./store.cjs');
}
function lazyFb() {
  return require('../../api/_lib/firebase-admin.cjs');
}


/* ------------------------------------------- X Strategy plan/doc write logic */

// The x-strategy modules are ESM; load them lazily from this CJS file.
async function loadStrategyModules() {
  const [planStore, docStore, seed, tracks, engineQuota] = await Promise.all([
    import('../x-strategy/plan-store.js'),
    import('../x-strategy/strategy-doc-store.js'),
    import('../x-strategy/strategy-doc-seed.js'),
    import('../x-strategy/content-tracks.js'),
    import('../x-content-inventory/engine-quota.js'),
  ]);
  return {
    createFirestorePlanStore: planStore.createFirestorePlanStore,
    createFirestoreStrategyDocStore: docStore.createFirestoreStrategyDocStore,
    SEED_STRATEGY_SECTIONS: seed.SEED_STRATEGY_SECTIONS,
    tracksOf: tracks.tracksOf,
    mergeEngineConfig: engineQuota.mergeEngineConfig,
  };
}

const slugId = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
const isInvalid = (err) => err && (err.code === 'invalid' || /^Bad |^Every engine|^At most|^Duplicate|needs a label|^Engine /.test(err.message || ''));
const errorWarnings = (err, prefix) => (err.errors?.length ? err.errors : [err.message]).map((m) => `${prefix}: ${m}`);

// Merge Brain track rows into the plan's existing tracks (matched by label,
// case-insensitive; id slug as fallback). Engines and promotions always stay as
// they are; tracks the Brain doesn't list are kept (their engines must have an owner).
function mergeBrainTracks(existing, rows) {
  const tracks = (existing || []).map((t) => ({ ...t }));
  for (const row of rows || []) {
    const hit = tracks.find((t) => lower(t.label) === lower(row.label)) || tracks.find((t) => t.id === slugId(row.label));
    const patch = { label: row.label, topics: row.topics, benchmarks: row.benchmarks, ...(row.share != null ? { share: row.share } : {}) };
    if (hit) Object.assign(hit, patch);
    else tracks.push({ id: slugId(row.label), engines: [], promotions: [], share: 0, ...patch });
  }
  return tracks;
}

// Write Brain track rows through the versioned plan save. Validation failure =>
// nothing written, warnings returned. `planStore` = createFirestorePlanStore / memory store.
async function writeBrainTracksToPlan(planStore, clientId, rows, { tracksOf }) {
  const doc = await planStore.get(clientId);
  const existing = Array.isArray(doc?.plan?.contentTracks) ? doc.plan.contentTracks : tracksOf(doc);
  const contentTracks = mergeBrainTracks(existing, rows);
  try {
    // 'client-brain' is not in plan-state's source enum, so it is recorded as the actor + reason.
    await planStore.apply(clientId, {
      changes: { contentTracks }, by: 'client-brain', source: 'manual', reason: 'client-brain: content tracks',
      expectedVersion: doc?.version ?? 0,
    });
    return { warnings: [] };
  } catch (err) {
    if (isInvalid(err)) return { warnings: errorWarnings(err, 'contentTracks kept as-is') };
    throw err;
  }
}

// engineTargets.engines are per engine; a track's postsPerDay is split across its
// engines by the same weights track-profile.js uses (targetPerDay, else weeklyMin/7).
// Daily engines get targetPerDay, weekly-quota engines (weeklyMin set) get weeklyMin,
// both clamped to the engine's own caps.
function engineOverridesForTrack(track, postsPerDay, cfg) {
  const weekly = (e) => (cfg.engines[e] ?? {}).weeklyMin != null;
  const weightOf = (e) => {
    const c = cfg.engines[e] ?? {};
    if (c.targetPerDay > 0) return c.targetPerDay;
    if (c.weeklyMin > 0) return c.weeklyMin / 7;
    return 1;
  };
  const engines = (track.engines || []).filter((e) => cfg.engines[e]);
  const total = engines.reduce((sum, e) => sum + weightOf(e), 0);
  const out = {};
  if (!total) return out;
  for (const e of engines) {
    const c = cfg.engines[e];
    const part = (postsPerDay * weightOf(e)) / total;
    if (weekly(e)) {
      const w = Math.round(part * 7);
      out[e] = { weeklyMin: c.weeklyMax != null ? Math.min(w, c.weeklyMax) : w };
    } else {
      const t = Math.round(part);
      out[e] = { targetPerDay: Math.min(c.maxPerDay ?? t, Math.max(c.minPerDay ?? 0, t)) };
    }
  }
  return out;
}

// Plan -> Brain-shaped rows (postsPerDay only; the per-type shares aren't in the plan).
function trackTargetsFromPlan(planOrDoc, { tracksOf, mergeEngineConfig }) {
  const plan = planOrDoc?.plan && typeof planOrDoc.plan === 'object' ? planOrDoc.plan : planOrDoc;
  if (!Array.isArray(plan?.contentTracks)) return [];
  const cfg = mergeEngineConfig(plan.engineTargets && typeof plan.engineTargets === 'object' ? plan.engineTargets : {});
  // Only tracks whose engines carry explicit plan targets: engine defaults are
  // not an operator setting, so they are never adopted over the Brain.
  const explicit = plan.engineTargets?.engines || {};
  return tracksOf(plan).filter((t) => t.engines.some((e) => explicit[e])).map((t) => ({
    track: t.label,
    postsPerDay: round(t.engines.reduce((sum, e) => {
      const c = cfg.engines[e] ?? {};
      return sum + (c.weeklyMin != null ? c.weeklyMin / 7 : (c.targetPerDay ?? 0));
    }, 0), 1),
  }));
}

async function writeBrainTargetsToPlan(planStore, clientId, rows, { tracksOf, mergeEngineConfig }) {
  const doc = await planStore.get(clientId);
  const plan = doc?.plan || {};
  const tracks = tracksOf(doc);
  const cfg = mergeEngineConfig(plan.engineTargets || {});
  const warnings = [];
  const engines = { ...((plan.engineTargets || {}).engines || {}) };
  const covered = new Set();
  for (const row of rows || []) {
    const track = tracks.find((t) => lower(t.label) === lower(row.track));
    if (!track) { warnings.push(`trackTargets: no track named "${row.track}" (add it under Content Tracks first)`); continue; }
    if (row.postsPerDay == null) continue;
    const over = engineOverridesForTrack(track, row.postsPerDay, cfg);
    if (!Object.keys(over).length) { warnings.push(`trackTargets: track "${row.track}" has no engines; postsPerDay not mapped`); continue; }
    for (const [e, o] of Object.entries(over)) engines[e] = { ...(engines[e] || {}), ...o };
    covered.add(track.id);
  }
  if (!covered.size) return { warnings };
  const changes = { engineTargets: { ...(plan.engineTargets || {}), engines } };
  // Every track set => the daily total is their sum.
  const rowFor = (t) => (rows || []).find((r) => lower(r.track) === lower(t.label) && r.postsPerDay != null);
  const allSet = tracks.every((t) => rowFor(t));
  const total = allSet ? Math.round(tracks.reduce((sum, t) => sum + rowFor(t).postsPerDay, 0)) : null;
  const attempt = (c) => planStore.apply(clientId, {
    changes: c, by: 'client-brain', source: 'manual', reason: 'client-brain: track targets', expectedVersion: doc?.version ?? 0,
  });
  try {
    await attempt(total ? { ...changes, authoredPerDay: total } : changes);
  } catch (err) {
    if (!isInvalid(err)) throw err;
    if (!total) return { warnings: [...warnings, ...errorWarnings(err, 'trackTargets kept as-is')] };
    try {
      await attempt(changes);
      warnings.push(...errorWarnings(err, `authoredPerDay ${total} not applied`));
    } catch (err2) {
      if (!isInvalid(err2)) throw err2;
      return { warnings: [...warnings, ...errorWarnings(err2, 'trackTargets kept as-is')] };
    }
  }
  return { warnings };
}

const STORES = {
  async marketingBrief(fb, clientId) {
    const ref = fb.adminDb.collection('client_configs').doc(clientId);
    const data = (await ref.get()).data() || {};
    return {
      current: data.marketingBriefConfig || {},
      async write(values) {
        const nextConfig = { ...(data.marketingBriefConfig || {}), ...values };
        const payload = {
          marketingBriefConfig: {
            ...(data.marketingBriefConfig ? {} : { enabled: true }),
            ...toNested(values),
            clientBrainSync: { fields: Object.keys(values), syncedAtIso: new Date().toISOString() },
          },
          updatedAt: fb.FieldValue.serverTimestamp(),
        };
        const mirror = buildScoutConfigMirror(nextConfig, {
          priorScoutConfig: data.scoutConfig || null,
          priorSourceWebsiteUrl: data.sourceInputs?.websiteUrl || null,
        });
        if (mirror) payload.scoutConfig = mirror;
        await ref.set(payload, { merge: true });
      },
    };
  },
  async digest(fb, clientId) {
    const ref = fb.adminDb.collection('digest_config').doc(clientId);
    const data = (await ref.get()).data() || {};
    return {
      current: data,
      async write(values) {
        await ref.set({ ...toNested(values), updatedAt: fb.FieldValue.serverTimestamp() }, { merge: true });
      },
    };
  },
  async strategyBuilder(fb, clientId) {
    const ref = fb.adminDb.collection('dashboard_state').doc(clientId);
    const data = (await ref.get()).data() || {};
    return {
      current: data.strategyBuilder?.config || {},
      async write(values) {
        // set+merge deep-merges: operational config (days, cadence, signals) and
        // editorial campaigns are untouched.
        await ref.set({ strategyBuilder: { config: toNested(values) } }, { merge: true });
      },
    };
  },
  async brandOverview(fb, clientId) {
    const dashRef = fb.adminDb.collection('dashboard_state').doc(clientId);
    const data = (await dashRef.get()).data() || {};
    return {
      current: data.snapshot?.brandOverview || {},
      async write(values) {
        // set+merge deep-merges nested maps: other snapshot / brandOverview
        // sub-fields survive. Mirrored to client_configs for the brief pipeline.
        // The positioning bridge is NOT run here: it makes a paid model call.
        const brandOverview = { ...values, source: 'client-brain', updatedAtIso: new Date().toISOString() };
        await dashRef.set({ snapshot: { brandOverview } }, { merge: true });
        await fb.adminDb.collection('client_configs').doc(clientId).set({ snapshot: { brandOverview } }, { merge: true });
      },
    };
  },
  async strategyDoc(fb, clientId) {
    const m = await loadStrategyModules();
    const docStore = m.createFirestoreStrategyDocStore(fb.adminDb);
    const doc = await docStore.get(clientId);
    return {
      current: doc?.sections || {},
      async write(values) {
        try {
          // Goes through the doc store's save so its history is kept. The Brain overwrites
          // even a confirmed doc. 'client-brain' is not in DOC_SOURCES, so it is the actor;
          // source 'manual' (a first save also confirms a draft; Brain content is owner-approved).
          await docStore.apply(clientId, {
            sections: values, by: 'client-brain', source: 'manual', reason: 'client-brain sync',
            expectedVersion: doc?.version ?? 0, base: m.SEED_STRATEGY_SECTIONS,
          });
          return { warnings: [] };
        } catch (err) {
          if (err.code === 'invalid') return { warnings: errorWarnings(err, 'strategyDoc kept as-is') };
          throw err;
        }
      },
    };
  },
  async contentTracks(fb, clientId) {
    const m = await loadStrategyModules();
    const planStore = m.createFirestorePlanStore(fb.adminDb);
    const doc = await planStore.get(clientId);
    const explicit = Array.isArray(doc?.plan?.contentTracks) ? doc.plan.contentTracks : [];
    return {
      current: { contentTracks: normalizeTrackRows(explicit) },
      write: (values) => writeBrainTracksToPlan(planStore, clientId, values.contentTracks, m),
    };
  },
  async trackTargets(fb, clientId) {
    const m = await loadStrategyModules();
    const planStore = m.createFirestorePlanStore(fb.adminDb);
    const doc = await planStore.get(clientId);
    return {
      current: { trackTargets: trackTargetsFromPlan(doc, m) },
      write: (values) => writeBrainTargetsToPlan(planStore, clientId, values.trackTargets, m),
    };
  },
};

// Approved Brain -> every store it owns. dryRun returns the per-store diff
// without writing.
async function syncBrainToSystem(clientId, { dryRun = false, brain: brainIn = null, targets = Object.keys(TARGETS) } = {}) {
  if (!clientId) return { skipped: 'no-client' };
  const brain = brainIn || await lazyStore().readClientBrainDoc(clientId);
  if (!brain) return { skipped: 'no-brain' };
  if (brain.status !== 'approved') return { skipped: 'not-approved' };
  if (!brain.markdownSource) return { skipped: 'no-markdown' };

  const fb = lazyFb();
  const result = { dryRun, targets: {} };
  for (const name of targets) {
    const store = await STORES[name](fb, clientId);
    const { values, diff } = planTargetWrite(TARGETS[name], brain.markdownSource, store.current);
    const written = !dryRun && diff.length > 0;
    const outcome = written ? await store.write(values) : null;
    result.targets[name] = { diff, written, ...(outcome?.warnings?.length ? { warnings: outcome.warnings } : {}) };
  }
  return result;
}

// Operator edits from a card save -> the Brain's Markdown home sections ->
// recompile. Keeps the Brain's approval status. Returns { mode, changed }.
async function writeCardEditsToBrain(clientId, edits = {}, target = 'marketingBrief') {
  const store = lazyStore();
  const brain = await store.readClientBrainDoc(clientId);
  if (!brain || !brain.markdownSource) return { mode: 'legacy', changed: [] };
  const { markdown, changed } = applyCardEditsToMarkdown(brain.markdownSource, edits, TARGETS[target]);
  if (!changed.length) return { mode: 'markdown', changed };
  const stamped = setFrontmatterValues(markdown, {
    status: brain.status || 'draft',
    updatedAt: new Date().toISOString().slice(0, 10),
  });
  await store.compileAndSaveClientBrainMarkdown(clientId, stamped, { reason: `card-edit:${target}` });
  return { mode: 'markdown', changed };
}

// Shape a card-save payload for the manifest. strategyDoc: a doc ({sections}) or a
// sections map. contentTracks / trackTargets: a plan (or plan doc), a bare rows array,
// or an object already keyed `contentTracks` / `trackTargets`.
function cardView(target, x, mods) {
  if (target === 'strategyDoc') return x?.sections ?? x ?? {};
  if (target !== 'contentTracks' && target !== 'trackTargets') return x || {};
  if (Array.isArray(x)) return { [target]: x };
  if (x && Array.isArray(x[target])) return x;
  if (target === 'contentTracks') {
    const plan = x?.plan && typeof x.plan === 'object' ? x.plan : x;
    return { contentTracks: Array.isArray(plan?.contentTracks) ? plan.contentTracks : [] };
  }
  return { trackTargets: mods ? trackTargetsFromPlan(x, mods) : [] };
}

// Card save helper: diff prior vs next for one store and write the operator's
// changes into the Brain. Never throws (the card save already succeeded).
async function recordCardEdits(clientId, target, prior, next) {
  try {
    const mods = ['contentTracks', 'trackTargets'].includes(target) ? await loadStrategyModules() : null;
    const view = (x) => cardView(target, x, mods);
    const edits = changedManifestFields(view(prior), view(next), TARGETS[target]);
    if (!Object.keys(edits).length) return { mode: 'none', changed: [] };
    return await writeCardEditsToBrain(clientId, edits, target);
  } catch (err) {
    return { mode: 'error', changed: [], error: err.message };
  }
}

// Pure: fold a client's current settings into the Brain Markdown so its first
// sync loses nothing an operator tuned. A setting is adopted ONLY into a Brain
// section that is empty (no explicit value; a derived value counts as empty).
// Where the Brain already has a value, the Brain wins and the first sync pushes
// it to the card. Brain items a card can't show are kept (same rule as write-back).
// `storeValues` = { marketingBrief: {...}, digest: {...}, brandOverview: {...} }.
// Two stores can share one home (Identity › Industry = brandOverview.industry
// and strategyBuilder.vertical): the first store to adopt it wins, and the
// first sync then pushes that value to the other.
function adoptSettingsIntoMarkdown(markdown, storeValues = {}) {
  let next = String(markdown || '');
  const changes = [];
  const adoptedHomes = new Set();
  const homeOf = (spec) => `${normalizeKey(spec.section)}|${normalizeKey(spec.field)}`;
  for (const [target, fields] of Object.entries(TARGETS)) {
    const current = storeValues[target] || {};
    const { raw: brainRaw } = projectFields(next, fields);
    const edits = {};
    for (const spec of fields) {
      const cur = getPath(current, spec.key);
      if (isEmptyFor(spec, cur) || adoptedHomes.has(homeOf(spec)) || !isEmpty(brainRaw[spec.key])) continue;
      edits[spec.key] = cur;
    }
    for (const key of Object.keys(edits)) adoptedHomes.add(homeOf(fields.find((s) => s.key === key)));
    const before = projectFields(next, fields);
    const { markdown: md, changed } = applyCardEditsToMarkdown(next, edits, fields, { adopt: true });
    const after = projectFields(md, fields);
    for (const key of changed) {
      const spec = fields.find((s) => s.key === key);
      const dropped = spec.kind === 'list'
        ? (before.raw[key] || []).filter((item) => !(after.raw[key] || []).some((x) => keyOf(x) === keyOf(item)))
        : [];
      changes.push({ target, field: key, brain: before.values[key] ?? null, settings: after.values[key] ?? null, droppedFromBrain: dropped });
    }
    next = md;
  }
  return { markdown: next, changes };
}

async function readStoreValues(clientId) {
  const fb = lazyFb();
  const out = {};
  for (const name of Object.keys(TARGETS)) out[name] = (await STORES[name](fb, clientId)).current;
  return out;
}

// One-time per client: adopt current settings into the Brain before its first
// sync. dryRun (default) reports; apply recompiles the Brain and stamps
// settingsAdoptedAt so it never runs twice.
async function adoptSettingsIntoBrain(clientId, { dryRun = true, brain: brainIn = null } = {}) {
  const store = lazyStore();
  const brain = brainIn || await store.readClientBrainDoc(clientId);
  if (!brain) return { skipped: 'no-brain' };
  if (!brain.markdownSource) return { skipped: 'no-markdown' };
  if (brain.settingsAdoptedAt) return { skipped: 'already-adopted', settingsAdoptedAt: brain.settingsAdoptedAt };
  const { markdown, changes } = adoptSettingsIntoMarkdown(brain.markdownSource, await readStoreValues(clientId));
  if (dryRun) return { dryRun: true, changes };
  const settingsAdoptedAt = new Date().toISOString();
  if (changes.length) {
    const stamped = setFrontmatterValues(markdown, { status: brain.status || 'draft', updatedAt: settingsAdoptedAt.slice(0, 10) });
    await store.compileAndSaveClientBrainMarkdown(clientId, stamped, { reason: 'adopt' });
  }
  const saved = await store.saveClientBrain(clientId, { settingsAdoptedAt });
  return { dryRun: false, changes, brain: saved };
}

// X Strategy profile save hook: own handle / benchmark accounts -> Brain.
function recordXGrowthEdits(clientId, prior, next) {
  return recordCardEdits(clientId, 'marketingBrief', { xGrowth: prior || {} }, { xGrowth: next || {} });
}

// Approve / inject entry point. Keeps the Markdown frontmatter's status in
// step with the Brain doc (so an export / re-inject never silently un-approves
// it); for an approved Brain, adopts current settings once, then syncs.
// Approved Brain's Track Targets rows (incl. per-type shares the plan cannot
// hold) for the X Strategy evaluation. [] when absent / unapproved.
async function readApprovedTrackTargets(clientId) {
  const brain = await lazyStore().readClientBrainDoc(clientId);
  if (!brain || brain.status !== 'approved' || !brain.markdownSource) return [];
  return projectFields(brain.markdownSource, TRACK_TARGETS_FIELDS).values.trackTargets || [];
}

async function onBrainStatusChanged(clientId, brain) {
  if (!brain) return { skipped: 'no-brain' };
  if (brain.markdownSource) {
    const { frontmatter } = parseFrontmatter(brain.markdownSource);
    if (frontmatter.status !== brain.status) {
      const markdownSource = setFrontmatterValues(brain.markdownSource, { status: brain.status });
      await lazyStore().saveClientBrain(clientId, { markdownSource });
      brain = { ...brain, markdownSource };
    }
  }
  if (brain.status !== 'approved' || !brain.markdownSource) return syncBrainToSystem(clientId, { brain });
  let adoption = null;
  if (!brain.settingsAdoptedAt) {
    adoption = await adoptSettingsIntoBrain(clientId, { dryRun: false, brain });
    if (adoption.brain) brain = adoption.brain;
  }
  const sync = await syncBrainToSystem(clientId, { brain });
  return { ...sync, adoption: adoption && { changes: adoption.changes } };
}

module.exports = {
  readApprovedTrackTargets,
  TARGETS,
  MARKET_SIGNALS_FIELDS,
  DIGEST_FIELDS,
  BRAND_OVERVIEW_FIELDS,
  STRATEGY_BUILDER_FIELDS,
  STRATEGY_DOC_FIELDS,
  CONTENT_TRACKS_FIELDS,
  TRACK_TARGETS_FIELDS,
  MANIFEST_KEYS,
  projectFields,
  projectMarketSignals,
  planTargetWrite,
  applyCardEditsToMarkdown,
  changedManifestFields,
  buildScoutConfigMirror,
  syncBrainToSystem,
  writeCardEditsToBrain,
  recordCardEdits,
  recordXGrowthEdits,
  adoptSettingsIntoMarkdown,
  adoptSettingsIntoBrain,
  onBrainStatusChanged,
  readStoreValues,
  mergeBrainTracks,
  writeBrainTracksToPlan,
  writeBrainTargetsToPlan,
  trackTargetsFromPlan,
  engineOverridesForTrack,
  cardView,
};
