function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeList(input, fallback = []) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/\n+/);
  const list = raw.map((item) => cleanString(item)).filter(Boolean);
  return list.length ? list : fallback;
}

function normalizeLineItems(input, fallback = []) {
  const rows = Array.isArray(input) ? input : [];
  const normalized = rows
    .map((item, index) => {
      const quantity = money(item?.quantity || 1) || 1;
      const unitPrice = money(item?.unitPrice ?? item?.price ?? 0);
      return {
        id: cleanString(item?.id, `line-${index + 1}`),
        label: cleanString(item?.label || item?.name, `Line item ${index + 1}`),
        description: cleanString(item?.description),
        quantity,
        unitPrice,
        total: money(quantity * unitPrice),
      };
    })
    .filter((item) => item.label && item.unitPrice >= 0);
  return normalized.length ? normalized : fallback;
}

function normalizeAddOns(input) {
  const rows = Array.isArray(input) ? input : [];
  return rows
    .map((item, index) => ({
      id: cleanString(item?.id, `addon-${index + 1}`),
      label: cleanString(item?.label || item?.name),
      description: cleanString(item?.description),
      price: money(item?.price ?? item?.unitPrice ?? 0),
    }))
    .filter((item) => item.label);
}

function parseContentJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function defaultLineItems() {
  return [
    {
      id: 'website-redesign',
      label: 'Website redesign',
      description: 'Client-facing homepage redesign based on the generated preview, including responsive layout, conversion structure, and launch-ready handoff.',
      quantity: 1,
      unitPrice: 4500,
      total: 4500,
    },
    {
      id: 'launch-qa',
      label: 'Launch QA and handoff',
      description: 'Final review, mobile checks, metadata review, and implementation notes for launch.',
      quantity: 1,
      unitPrice: 750,
      total: 750,
    },
  ];
}

export function buildDefaultEstimateConfig(context = {}) {
  const clientName = cleanString(context.clientName || context.prospect?.name, 'Client');
  return {
    enabled: true,
    offerSummary: `Website redesign and launch support for ${clientName}.`,
    pricingModel: 'line_items',
    currency: 'USD',
    lineItems: defaultLineItems(),
    timeline: '2-4 weeks after approval',
    scope: [
      'Homepage redesign based on the generated preview direction.',
      'Responsive implementation guidance for desktop, tablet, and mobile.',
      'Conversion-focused page structure, primary CTA treatment, and handoff notes.',
    ],
    exclusions: [
      'Third-party platform fees, paid media, and hosting subscriptions are not included unless listed as line items.',
      'New brand identity, logo design, or custom photography are separate unless explicitly included.',
    ],
    terms: [
      'Estimate is valid for 14 days.',
      'Final production scope may adjust if new requirements are added after approval.',
    ],
    paymentSchedule: [
      '50% due to begin work.',
      '50% due before final handoff or launch.',
    ],
    optionalAddOns: [
      {
        id: 'maintenance',
        label: 'Monthly maintenance',
        description: 'Small content updates, uptime checks, and light technical support.',
        price: 650,
      },
      {
        id: 'seo-content',
        label: 'SEO content support',
        description: 'Monthly content and AI-search visibility improvements.',
        price: 1200,
      },
    ],
    estimateTone: 'clear, direct, premium, client-facing',
    sendMessageInstructions: 'Write a concise email that references the preview URL and next step.',
  };
}

export function normalizeEstimateConfig(config = {}, context = {}) {
  const fallback = buildDefaultEstimateConfig(context);
  const merged = { ...fallback, ...(config || {}) };
  return {
    ...merged,
    enabled: merged.enabled !== false,
    offerSummary: cleanString(merged.offerSummary, fallback.offerSummary),
    pricingModel: cleanString(merged.pricingModel, fallback.pricingModel),
    currency: cleanString(merged.currency, fallback.currency).toUpperCase().slice(0, 3),
    lineItems: normalizeLineItems(merged.lineItems, fallback.lineItems),
    timeline: cleanString(merged.timeline, fallback.timeline),
    scope: normalizeList(merged.scope, fallback.scope),
    exclusions: normalizeList(merged.exclusions, fallback.exclusions),
    terms: normalizeList(merged.terms, fallback.terms),
    paymentSchedule: normalizeList(merged.paymentSchedule, fallback.paymentSchedule),
    optionalAddOns: normalizeAddOns(merged.optionalAddOns || fallback.optionalAddOns),
    estimateTone: cleanString(merged.estimateTone, fallback.estimateTone),
    sendMessageInstructions: cleanString(merged.sendMessageInstructions, fallback.sendMessageInstructions),
  };
}

export function buildEstimateContext({ prospect, config = {}, overrides = {}, generatedByUid = null } = {}) {
  const generation = prospect?.generation || {};
  const content = parseContentJson(generation.contentJson);
  const copy = content.copy || {};
  const clientName = cleanString(prospect?.name, 'Client');
  const context = {
    prospect,
    clientName,
    website: prospect?.website || '',
    previewUrl: generation.previewUrl || '',
    readinessComparison: generation.readinessComparison || null,
    designMd: generation.designMd || '',
    content,
    generatedByUid,
  };
  const estimateConfig = normalizeEstimateConfig({ ...(config || {}), ...(overrides || {}) }, context);
  return { ...context, estimateConfig, primaryServices: Array.isArray(copy.serviceNames) ? copy.serviceNames.slice(0, 5) : [] };
}

export function generateEstimate({ prospect, config = {}, overrides = {}, generatedByUid = null } = {}) {
  const context = buildEstimateContext({ prospect, config, overrides, generatedByUid });
  const cfg = context.estimateConfig;
  const lineItems = normalizeLineItems(cfg.lineItems, defaultLineItems());
  const subtotal = money(lineItems.reduce((sum, item) => sum + money(item.total), 0));
  const discounts = Array.isArray(cfg.discounts) ? cfg.discounts : [];
  const normalizedDiscounts = discounts
    .map((item, index) => ({
      id: cleanString(item?.id, `discount-${index + 1}`),
      label: cleanString(item?.label || item?.name, `Discount ${index + 1}`),
      amount: Math.abs(money(item?.amount || 0)),
    }))
    .filter((item) => item.amount > 0);
  const discountTotal = normalizedDiscounts.reduce((sum, item) => sum + item.amount, 0);
  const total = money(subtotal - discountTotal);
  const cmp = context.readinessComparison;
  const hasComparison = cmp?.before?.score != null && cmp?.after?.score != null;
  const proof = {
    previewUrl: context.previewUrl || null,
    readinessBefore: hasComparison ? Number(cmp.before.score) : null,
    readinessAfter: hasComparison ? Number(cmp.after.score) : null,
    readinessImprovement: hasComparison ? Number(cmp.improvement ?? (Number(cmp.after.score) - Number(cmp.before.score))) : null,
  };
  const proofPoints = [
    context.previewUrl ? `Preview site: ${context.previewUrl}` : null,
    hasComparison ? `AI readiness improvement: ${proof.readinessBefore} -> ${proof.readinessAfter} (+${proof.readinessImprovement} points)` : null,
    context.primaryServices.length ? `Site content reviewed across ${context.primaryServices.length} detected service area${context.primaryServices.length === 1 ? '' : 's'}.` : null,
  ].filter(Boolean);
  const subject = `Estimate and preview for ${context.clientName}`;
  const body = [
    `Hi ${context.clientName},`,
    '',
    `I put together the estimate for ${cfg.offerSummary.toLowerCase()}`,
    context.previewUrl ? `You can review the generated preview here: ${context.previewUrl}` : null,
    hasComparison ? `The preview also improves AI readiness from ${proof.readinessBefore} to ${proof.readinessAfter}, which gives us a clear before/after story for the work.` : null,
    '',
    `Estimated total: ${formatCurrency(total, cfg.currency)}.`,
    `Timeline: ${cfg.timeline}.`,
    '',
    'The next step is approval of the estimate so I can lock scope and schedule the kickoff.',
  ].filter((line) => line !== null).join('\n');

  return {
    title: 'Website Redesign Estimate',
    clientName: context.clientName,
    website: context.website || null,
    generatedAt: new Date().toISOString(),
    generatedByUid,
    pricingModel: cfg.pricingModel,
    currency: cfg.currency,
    summary: cfg.offerSummary,
    proof,
    proofPoints,
    lineItems,
    subtotal,
    discounts: normalizedDiscounts,
    total,
    timeline: cfg.timeline,
    scope: cfg.scope,
    exclusions: cfg.exclusions,
    terms: cfg.terms,
    paymentSchedule: cfg.paymentSchedule,
    optionalAddOns: cfg.optionalAddOns,
    nextStep: 'Approve estimate to schedule kickoff and finalize implementation details.',
    sendMessage: { subject, body },
    templateConfigSnapshot: cfg,
  };
}

export function formatCurrency(value, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(money(value));
  } catch {
    return `$${money(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

export default generateEstimate;
