'use strict';

// pagespeed.js — PageSpeed Insights source module for the intelligence layer
//
// Self-contained: fetches the PSI API, normalizes the result, and translates
// it into a validated SourceRecord. Registered by intelligence-runner.cjs.

const { logInfo, logWarn } = require('../../api/_lib/observability.cjs');

// ── PSI API fetch ─────────────────────────────────────────────────────────────

const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PROBE_REDIRECT_LIMIT = 5;
const PROBE_TIMEOUT_MS = 10_000;
const HTML_CONTENT_TYPE_RE = /text\/html|application\/xhtml\+xml/i;

const ARWEAVE_HOST_RE = /(^|\.)((arweave|ar-io)\.(net|dev)|arweave\.dev)$/i;
const IPFS_HOST_RE = /(^|\.)ipfs(\.|$)|(^|\.)ipns(\.|$)|(^|\.)dweb\.link$|(^|\.)nftstorage\.link$|(^|\.)pinata\.cloud$/i;
const ICP_HOST_RE = /(^|\.)icp0\.io$|(^|\.)ic0\.app$/i;
const REDIRECTOR_HOST_RE = /(^|\.)linktr\.ee$|(^|\.)lnk\.bio$|(^|\.)beacons\.ai$|(^|\.)bit\.ly$|(^|\.)tinyurl\.com$/i;
const VERCEL_HOST_RE = /(^|\.)vercel\.app$/i;
const NETLIFY_HOST_RE = /(^|\.)netlify\.app$/i;
const CLOUDFLARE_PAGES_HOST_RE = /(^|\.)pages\.dev$/i;
const GITHUB_PAGES_HOST_RE = /(^|\.)github\.io$/i;
const WIX_HOST_RE = /(^|\.)wixsite\.com$|(^|\.)wixstudio\.com$|(^|\.)editorx\.io$/i;
const SHOPIFY_HOST_RE = /(^|\.)myshopify\.com$/i;
const SQUARESPACE_HOST_RE = /(^|\.)squarespace\.com$/i;
const WEBFLOW_HOST_RE = /(^|\.)webflow\.io$/i;
const GODADDY_HOST_RE = /(^|\.)godaddysites\.com$|(^|\.)secureserver\.net$|(^|\.)myftpupload\.com$/i;

const SEO_RED_FLAG_AUDIT_IDS = new Set([
  'meta-description', 'document-title', 'canonical', 'is-crawlable',
  'robots-txt', 'hreflang', 'image-alt', 'http-status-code', 'link-text',
]);

const INSIGHT_AUDIT_MAP = {
  'render-blocking-resources': 'Render-blocking',
  'uses-optimized-images':     'Image delivery',
  'uses-webp-images':          'Next-gen images',
  'font-display':              'Font display',
  'legacy-javascript':         'Legacy JS',
  'uses-http2':                'Modern HTTP',
  'unsized-images':            'Unsized images',
  'lcp-lazy-loaded':           'LCP lazy-loaded',
};

const DIAGNOSTIC_AUDIT_MAP = {
  'dom-size':                    'DOM nodes',
  'bootup-time':                 'JS bootup',
  'mainthread-work-breakdown':   'Main thread',
  'total-byte-weight':           'Total bytes',
  'network-requests':            'Requests',
};

const SKIP_SCORE_MODES = new Set(['notApplicable', 'manual', 'informative']);

function toScore(val) {
  if (val == null) return null;
  return Math.round(val * 100);
}

function normalizeWebsiteUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

function classifyHostType(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return 'unknown';
  if (ARWEAVE_HOST_RE.test(host)) return 'arweave-gateway';
  if (IPFS_HOST_RE.test(host)) return 'ipfs-gateway';
  if (ICP_HOST_RE.test(host)) return 'icp-gateway';
  if (REDIRECTOR_HOST_RE.test(host)) return 'redirector-service';
  return 'standard';
}

function classifyHostService(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return null;
  if (ARWEAVE_HOST_RE.test(host)) return 'Arweave';
  if (IPFS_HOST_RE.test(host)) return 'IPFS';
  if (ICP_HOST_RE.test(host)) return 'Internet Computer (ICP)';
  if (REDIRECTOR_HOST_RE.test(host)) return 'Redirector service';
  return null;
}

function headerValue(headers, name) {
  if (!headers?.get) return '';
  return String(headers.get(name) || '').trim();
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function classifyHostingProvider({ hostname, headers } = {}) {
  const host = String(hostname || '').toLowerCase();
  const server = headerValue(headers, 'server').toLowerCase();
  const poweredBy = headerValue(headers, 'x-powered-by').toLowerCase();
  const servedBy = `${headerValue(headers, 'x-servedby')} ${headerValue(headers, 'x-served-by')}`.toLowerCase();

  if (!host && !server && !poweredBy && !servedBy) {
    return { provider: null, providerKind: null, providerConfidence: null, providerEvidence: [] };
  }

  const hostnameRules = [
    { re: VERCEL_HOST_RE,            provider: 'Vercel',              kind: 'deployment-platform', confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: NETLIFY_HOST_RE,           provider: 'Netlify',             kind: 'deployment-platform', confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: CLOUDFLARE_PAGES_HOST_RE,  provider: 'Cloudflare Pages',    kind: 'deployment-platform', confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: GITHUB_PAGES_HOST_RE,      provider: 'GitHub Pages',        kind: 'deployment-platform', confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: WIX_HOST_RE,               provider: 'Wix',                 kind: 'site-builder',        confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: SHOPIFY_HOST_RE,           provider: 'Shopify',             kind: 'commerce-platform',   confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: SQUARESPACE_HOST_RE,       provider: 'Squarespace',         kind: 'site-builder',        confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: WEBFLOW_HOST_RE,           provider: 'Webflow',             kind: 'site-builder',        confidence: 'high', evidence: `final hostname matches ${host}` },
    { re: GODADDY_HOST_RE,           provider: 'GoDaddy',             kind: 'hosting-provider',    confidence: 'high', evidence: `final hostname matches ${host}` },
  ];
  for (const rule of hostnameRules) {
    if (rule.re.test(host)) {
      return {
        provider: rule.provider,
        providerKind: rule.kind,
        providerConfidence: rule.confidence,
        providerEvidence: [rule.evidence],
      };
    }
  }

  const headerRules = [
    {
      test: () => Boolean(headerValue(headers, 'x-vercel-id')),
      provider: 'Vercel',
      kind: 'deployment-platform',
      confidence: 'high',
      evidence: ['response header x-vercel-id present'],
    },
    {
      test: () => Boolean(headerValue(headers, 'x-nf-request-id')),
      provider: 'Netlify',
      kind: 'deployment-platform',
      confidence: 'high',
      evidence: ['response header x-nf-request-id present'],
    },
    {
      test: () => Boolean(headerValue(headers, 'x-shopid') || headerValue(headers, 'x-sorting-hat-podid')),
      provider: 'Shopify',
      kind: 'commerce-platform',
      confidence: 'high',
      evidence: uniqueStrings([
        headerValue(headers, 'x-shopid') ? 'response header x-shopid present' : null,
        headerValue(headers, 'x-sorting-hat-podid') ? 'response header x-sorting-hat-podid present' : null,
      ]),
    },
    {
      test: () => Boolean(headerValue(headers, 'x-wix-request-id')) || server.includes('pepyaka'),
      provider: 'Wix',
      kind: 'site-builder',
      confidence: headerValue(headers, 'x-wix-request-id') ? 'high' : 'medium',
      evidence: uniqueStrings([
        headerValue(headers, 'x-wix-request-id') ? 'response header x-wix-request-id present' : null,
        server.includes('pepyaka') ? `server header reports ${server}` : null,
      ]),
    },
    {
      test: () => servedBy.includes('squarespace') || server.includes('squarespace'),
      provider: 'Squarespace',
      kind: 'site-builder',
      confidence: 'medium',
      evidence: uniqueStrings([
        servedBy.includes('squarespace') ? `x-servedby indicates Squarespace (${servedBy.trim()})` : null,
        server.includes('squarespace') ? `server header reports ${server}` : null,
      ]),
    },
    {
      test: () => Boolean(headerValue(headers, 'x-webflow-request-id')) || poweredBy.includes('webflow') || server.includes('webflow'),
      provider: 'Webflow',
      kind: 'site-builder',
      confidence: headerValue(headers, 'x-webflow-request-id') ? 'high' : 'medium',
      evidence: uniqueStrings([
        headerValue(headers, 'x-webflow-request-id') ? 'response header x-webflow-request-id present' : null,
        poweredBy.includes('webflow') ? `x-powered-by reports ${poweredBy}` : null,
        server.includes('webflow') ? `server header reports ${server}` : null,
      ]),
    },
    {
      test: () => server.includes('secureserver'),
      provider: 'GoDaddy',
      kind: 'hosting-provider',
      confidence: 'medium',
      evidence: [`server header reports ${server}`],
    },
    {
      test: () => Boolean(headerValue(headers, 'x-github-request-id')),
      provider: 'GitHub Pages',
      kind: 'deployment-platform',
      confidence: 'medium',
      evidence: ['response header x-github-request-id present'],
    },
  ];
  for (const rule of headerRules) {
    if (rule.test()) {
      return {
        provider: rule.provider,
        providerKind: rule.kind,
        providerConfidence: rule.confidence,
        providerEvidence: rule.evidence,
      };
    }
  }

  return { provider: null, providerKind: null, providerConfidence: null, providerEvidence: [] };
}

function isHtmlLike(contentType) {
  return HTML_CONTENT_TYPE_RE.test(String(contentType || ''));
}

function detectBlockedBy(status, headers) {
  if (!headers) return null;
  const server = String(headers.get('server') || '').toLowerCase();
  const via = String(headers.get('via') || '').toLowerCase();
  const cfMitigated = String(headers.get('cf-mitigated') || '').toLowerCase();
  if ((status === 403 || status === 429) && (server.includes('cloudflare') || cfMitigated)) return 'cloudflare';
  if ((status === 403 || status === 429) && server.includes('cloudfront')) return 'cloudfront';
  if ((status === 403 || status === 429) && via.includes('akamai')) return 'akamai';
  if (status === 401) return 'auth-wall';
  return null;
}

function classifyProbeError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const causeCode = String(err?.cause?.code || '').toLowerCase();
  const blob = `${causeCode} ${msg}`;

  if (blob.includes('enotfound') || blob.includes('eai_again') || blob.includes('dns')) return 'dns_unreachable';
  if (blob.includes('self signed') || blob.includes('certificate') || blob.includes('tls') || blob.includes('ssl')) return 'tls_or_cert_error';
  if (blob.includes('timeout') || blob.includes('aborted') || blob.includes('timed out')) return 'timeout';
  if (blob.includes('connreset') || blob.includes('socket hang up') || blob.includes('networkerror')) return 'network_error';
  return 'request_failed';
}

async function runPreflightProbe(websiteUrl) {
  const normalized = normalizeWebsiteUrl(websiteUrl);
  const inputUrl = normalized || String(websiteUrl || '').trim();
  let currentUrl = inputUrl;
  const redirects = [];
  const seen = new Set();

  for (let hop = 0; hop <= PROBE_REDIRECT_LIMIT; hop += 1) {
    const currentHost = (() => {
      try { return new URL(currentUrl).hostname; } catch { return ''; }
    })();
    const hostType = classifyHostType(currentHost);
    const hostService = classifyHostService(currentHost);

    let res;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'user-agent': 'Mozilla/5.0 (compatible; ScoutAudit/1.0; +https://example.com/bot)',
        },
      });
    } catch (err) {
      return {
        inputUrl,
        resolvedUrl: currentUrl,
        redirectCount: redirects.length,
        redirectChain: redirects,
        hostType,
        hostService,
        probeStatus: 'error',
        probeErrorCode: classifyProbeError(err),
        probeError: err?.message || String(err),
      };
    }

    const status = res.status;
    const location = res.headers.get('location');
    const contentType = res.headers.get('content-type') || null;
    const server = res.headers.get('server') || null;
    const blockedBy = detectBlockedBy(status, res.headers);
    const provider = classifyHostingProvider({ hostname: currentHost, headers: res.headers });

    if (status >= 300 && status < 400) {
      if (!location) {
        try { res.body?.cancel?.(); } catch { /* ignore */ }
        return {
          inputUrl,
          resolvedUrl: currentUrl,
          redirectCount: redirects.length,
          redirectChain: redirects,
          hostType,
          hostService,
          hostingProvider: provider.provider,
          providerKind: provider.providerKind,
          providerConfidence: provider.providerConfidence,
          providerEvidence: provider.providerEvidence,
          finalStatus: status,
          contentType,
          server,
          blockedBy,
          htmlLike: isHtmlLike(contentType),
          probeStatus: 'error',
          probeErrorCode: 'redirect_missing_location',
          probeError: `Redirect response ${status} missing Location header`,
        };
      }

      let nextUrl = null;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        try { res.body?.cancel?.(); } catch { /* ignore */ }
        return {
          inputUrl,
          resolvedUrl: currentUrl,
          redirectCount: redirects.length,
          redirectChain: redirects,
          hostType,
          hostService,
          hostingProvider: provider.provider,
          providerKind: provider.providerKind,
          providerConfidence: provider.providerConfidence,
          providerEvidence: provider.providerEvidence,
          finalStatus: status,
          contentType,
          server,
          blockedBy,
          htmlLike: isHtmlLike(contentType),
          probeStatus: 'error',
          probeErrorCode: 'redirect_invalid_location',
          probeError: `Redirect location could not be resolved: ${location}`,
        };
      }

      redirects.push({
        status,
        from: currentUrl,
        to: nextUrl,
      });
      try { res.body?.cancel?.(); } catch { /* ignore */ }

      if (seen.has(nextUrl)) {
        return {
          inputUrl,
          resolvedUrl: currentUrl,
          redirectCount: redirects.length,
          redirectChain: redirects,
          hostType,
          hostService,
          hostingProvider: provider.provider,
          providerKind: provider.providerKind,
          providerConfidence: provider.providerConfidence,
          providerEvidence: provider.providerEvidence,
          finalStatus: status,
          contentType,
          server,
          blockedBy,
          htmlLike: isHtmlLike(contentType),
          probeStatus: 'error',
          probeErrorCode: 'forwarding_loop',
          probeError: 'Redirect loop detected during preflight probe.',
        };
      }

      seen.add(currentUrl);
      currentUrl = nextUrl;
      continue;
    }

    try { res.body?.cancel?.(); } catch { /* ignore */ }
    return {
      inputUrl,
      resolvedUrl: currentUrl,
      redirectCount: redirects.length,
      redirectChain: redirects,
      hostType,
      hostService,
      hostingProvider: provider.provider,
      providerKind: provider.providerKind,
      providerConfidence: provider.providerConfidence,
      providerEvidence: provider.providerEvidence,
      finalStatus: status,
      contentType,
      server,
      blockedBy,
      htmlLike: isHtmlLike(contentType),
      probeStatus: 'ok',
    };
  }

  return {
    inputUrl,
    resolvedUrl: currentUrl,
    redirectCount: redirects.length,
    redirectChain: redirects,
    hostType: (() => {
      try { return classifyHostType(new URL(currentUrl).hostname); } catch { return 'unknown'; }
    })(),
    hostService: (() => {
      try { return classifyHostService(new URL(currentUrl).hostname); } catch { return null; }
    })(),
    ...(() => {
      try {
        const provider = classifyHostingProvider({ hostname: new URL(currentUrl).hostname, headers: null });
        return {
          hostingProvider: provider.provider,
          providerKind: provider.providerKind,
          providerConfidence: provider.providerConfidence,
          providerEvidence: provider.providerEvidence,
        };
      } catch {
        return { hostingProvider: null, providerKind: null, providerConfidence: null, providerEvidence: [] };
      }
    })(),
    probeStatus: 'error',
    probeErrorCode: 'redirect_chain_excessive',
    probeError: `Redirect chain exceeded ${PROBE_REDIRECT_LIMIT} hops.`,
  };
}

function classifyPsiFailure({ websiteUrl, errorMessage, apiStatus = null, probe = null } = {}) {
  const msg = String(errorMessage || '').toLowerCase();
  const ctx = probe || {};
  const hostType = ctx.hostType || (() => {
    try { return classifyHostType(new URL(websiteUrl || '').hostname); } catch { return 'unknown'; }
  })();

  if (ctx.probeErrorCode === 'forwarding_loop') {
    return {
      failureCode: 'forwarding_loop',
      failureClass: 'site',
      failureReason: 'The domain appears to redirect in a loop before reaching a crawlable page.',
    };
  }
  if (ctx.probeErrorCode === 'redirect_chain_excessive') {
    return {
      failureCode: 'redirect_chain_excessive',
      failureClass: 'site',
      failureReason: 'The domain forwards through too many redirects before the audit can settle on a page.',
    };
  }
  if (ctx.probeErrorCode === 'dns_unreachable') {
    return {
      failureCode: 'dns_unreachable',
      failureClass: 'site',
      failureReason: 'The domain did not resolve during the audit preflight check.',
    };
  }
  if (ctx.probeErrorCode === 'tls_or_cert_error') {
    return {
      failureCode: 'tls_or_cert_error',
      failureClass: 'site',
      failureReason: 'The site has a TLS or certificate issue that blocked the audit preflight.',
    };
  }
  if (hostType === 'arweave-gateway') {
    return {
      failureCode: 'arweave_or_gateway_host',
      failureClass: 'measurement',
      failureReason: 'The site resolves through an Arweave gateway, which can limit consistent Lighthouse measurements.',
    };
  }
  if (hostType === 'ipfs-gateway') {
    return {
      failureCode: 'ipfs_or_gateway_host',
      failureClass: 'measurement',
      failureReason: 'The site resolves through an IPFS-style gateway, which can limit consistent Lighthouse measurements.',
    };
  }
  if (hostType === 'icp-gateway') {
    return {
      failureCode: 'icp_or_gateway_host',
      failureClass: 'measurement',
      failureReason: 'The site resolves through Internet Computer (ICP) hosting, which can limit consistent Lighthouse measurements.',
    };
  }
  if (ctx.blockedBy || ctx.finalStatus === 401 || ctx.finalStatus === 403) {
    return {
      failureCode: ctx.finalStatus === 401 ? 'login_wall' : 'bot_blocked',
      failureClass: 'measurement',
      failureReason: ctx.finalStatus === 401
        ? 'The site appears to require authentication before the audit can load it.'
        : `The site appears to block automated audit traffic${ctx.blockedBy ? ` (${ctx.blockedBy})` : ''}.`,
    };
  }
  if (ctx.finalStatus === 429 || apiStatus === 429 || msg.includes('429')) {
    return {
      failureCode: 'rate_limited',
      failureClass: 'measurement',
      failureReason: 'The PageSpeed request was rate-limited before the audit could complete.',
    };
  }
  if (ctx.finalStatus >= 500 && ctx.finalStatus < 600) {
    return {
      failureCode: 'origin_5xx',
      failureClass: 'site',
      failureReason: `The site returned HTTP ${ctx.finalStatus} during the preflight check.`,
    };
  }
  if (ctx.finalStatus && ctx.finalStatus >= 400 && ctx.finalStatus < 500) {
    return {
      failureCode: 'origin_http_error',
      failureClass: 'site',
      failureReason: `The site returned HTTP ${ctx.finalStatus} before Lighthouse could audit it.`,
    };
  }
  if (ctx.contentType && !ctx.htmlLike) {
    return {
      failureCode: 'non_html_response',
      failureClass: 'measurement',
      failureReason: 'The resolved URL did not return HTML, so Lighthouse could not run a normal page audit.',
    };
  }
  if (ctx.redirectCount >= 2) {
    return {
      failureCode: 'redirect_chain_excessive',
      failureClass: 'site',
      failureReason: 'The domain forwards through multiple redirects, which reduced audit reliability.',
    };
  }
  if (msg.includes('timeout') || msg.includes('timed out') || ctx.probeErrorCode === 'timeout') {
    return {
      failureCode: 'timeout_origin_slow',
      failureClass: 'measurement',
      failureReason: 'The page was reachable, but the audit timed out before Lighthouse could finish rendering it.',
    };
  }
  if ((apiStatus && apiStatus >= 500) || msg.includes('psi api error') || msg.includes('psi http 5')) {
    return {
      failureCode: 'pagespeed_api_error',
      failureClass: 'measurement',
      failureReason: 'The PageSpeed API returned an upstream error before audit data was available.',
    };
  }
  return {
    failureCode: 'unknown',
    failureClass: 'measurement',
    failureReason: 'The audit could not complete and did not return enough detail to classify the failure precisely.',
  };
}

function buildDiagnosticsContext({ websiteUrl, probe, failure = null, runtimeError = null, meta = null } = {}) {
  const resolvedUrl = meta?.finalUrl || meta?.finalDisplayedUrl || probe?.resolvedUrl || websiteUrl || '';
  const fallbackProvider = (() => {
    try {
      return classifyHostingProvider({ hostname: new URL(resolvedUrl || websiteUrl || '').hostname, headers: null });
    } catch {
      return { provider: null, providerKind: null, providerConfidence: null, providerEvidence: [] };
    }
  })();
  return {
    inputUrl: websiteUrl || '',
    resolvedUrl,
    redirectCount: probe?.redirectCount ?? 0,
    redirectChain: Array.isArray(probe?.redirectChain) ? probe.redirectChain : [],
    hostType: probe?.hostType || (() => {
      try { return classifyHostType(new URL(resolvedUrl || websiteUrl || '').hostname); } catch { return 'unknown'; }
    })(),
    hostService: probe?.hostService || (() => {
      try { return classifyHostService(new URL(resolvedUrl || websiteUrl || '').hostname); } catch { return null; }
    })(),
    hostingProvider: probe?.hostingProvider || fallbackProvider.provider || null,
    providerKind: probe?.providerKind || fallbackProvider.providerKind || null,
    providerConfidence: probe?.providerConfidence || fallbackProvider.providerConfidence || null,
    providerEvidence: Array.isArray(probe?.providerEvidence) && probe.providerEvidence.length
      ? probe.providerEvidence
      : fallbackProvider.providerEvidence,
    httpStatus: probe?.finalStatus ?? null,
    contentType: probe?.contentType || null,
    server: probe?.server || null,
    blockedBy: probe?.blockedBy || null,
    probeStatus: probe?.probeStatus || null,
    probeErrorCode: probe?.probeErrorCode || null,
    probeError: probe?.probeError || null,
    failureCode: failure?.failureCode || null,
    failureClass: failure?.failureClass || null,
    failureReason: failure?.failureReason || null,
    runtimeErrorCode: runtimeError?.code || null,
    runtimeErrorMessage: runtimeError?.message || null,
  };
}

function stripMdLinks(str) {
  return String(str || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

function formatBytes(bytes) {
  if (bytes == null) return null;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000)     return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function extractCwv(loadingExperience) {
  if (!loadingExperience) return null;
  const metrics = loadingExperience.metrics || {};
  function getMetric(key) {
    const m = metrics[key];
    if (!m) return null;
    return { p75: m.percentile ?? null, category: m.category || null, displayValue: m.percentile != null ? String(m.percentile) : null };
  }
  return {
    lcp:  getMetric('LARGEST_CONTENTFUL_PAINT_MS'),
    inp:  getMetric('INTERACTION_TO_NEXT_PAINT'),
    cls:  getMetric('CUMULATIVE_LAYOUT_SHIFT_SCORE'),
    ttfb: getMetric('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
    originFallback: loadingExperience.origin_fallback === true,
  };
}

function labCategory(metric, value) {
  if (value == null) return null;
  if (metric === 'lcp') {
    if (value <= 2500) return 'FAST';
    if (value <= 4000) return 'AVERAGE';
    return 'SLOW';
  }
  if (metric === 'cls') {
    if (value <= 0.1)  return 'FAST';
    if (value <= 0.25) return 'AVERAGE';
    return 'SLOW';
  }
  return null;
}

function extractLabCwv(audits) {
  if (!audits) return null;
  const lcp  = audits['largest-contentful-paint'];
  const cls  = audits['cumulative-layout-shift'];
  const ttfb = audits['server-response-time'];
  return {
    lcp:  lcp?.numericValue  != null ? { p75: Math.round(lcp.numericValue),  category: labCategory('lcp', lcp.numericValue),  displayValue: lcp.displayValue  || null, source: 'lab' } : null,
    cls:  cls?.numericValue  != null ? { p75: Math.round(cls.numericValue * 1000) / 1000, category: labCategory('cls', cls.numericValue), displayValue: cls.displayValue || null, source: 'lab' } : null,
    ttfb: ttfb?.numericValue != null ? { p75: Math.round(ttfb.numericValue), displayValue: ttfb.displayValue || null, source: 'lab' } : null,
  };
}

function extractOpportunities(audits) {
  if (!audits) return [];
  const out = [];
  for (const [id, audit] of Object.entries(audits)) {
    if (audit.details?.type !== 'opportunity') continue;
    const savings = audit.details?.overallSavingsMs ?? 0;
    if (savings > 0) out.push({ id, title: audit.title || id, savingsMs: Math.round(savings) });
  }
  return out.sort((a, b) => b.savingsMs - a.savingsMs).slice(0, 15);
}

function extractCategoryFailures(audits, auditRefs, topN) {
  if (!audits || !auditRefs?.length) return [];
  return auditRefs
    .map((ref) => audits[ref.id])
    .filter((a) => a && a.score !== null && a.score < 1 && !SKIP_SCORE_MODES.has(a.scoreDisplayMode))
    .map((a) => ({
      id: a.id,
      title: a.title || a.id,
      description: stripMdLinks(a.description || '').slice(0, 120),
    }))
    .slice(0, topN);
}

function extractSeoRedFlags(audits) {
  if (!audits) return [];
  const out = [];
  for (const id of SEO_RED_FLAG_AUDIT_IDS) {
    const a = audits[id];
    if (!a) continue;
    if (a.score === 0 || (a.score == null && !SKIP_SCORE_MODES.has(a.scoreDisplayMode))) {
      out.push({ id, title: a.title || id, description: stripMdLinks(a.description || '').slice(0, 120) });
    }
  }
  return out;
}

function extractInsights(audits) {
  if (!audits) return [];
  const out = [];
  for (const [auditId, label] of Object.entries(INSIGHT_AUDIT_MAP)) {
    const a = audits[auditId];
    if (!a) continue;
    const value = a.displayValue || (a.numericValue != null ? String(Math.round(a.numericValue)) : null);
    if (value != null) out.push({ id: auditId, label, value, score: a.score ?? null });
  }
  return out;
}

function extractDiagnostics(audits) {
  if (!audits) return [];
  const out = [];
  for (const [auditId, label] of Object.entries(DIAGNOSTIC_AUDIT_MAP)) {
    const a = audits[auditId];
    if (!a) continue;
    let value;
    if (auditId === 'network-requests' && a.details?.items?.length != null) {
      value = String(a.details.items.length);
    } else if (auditId === 'total-byte-weight' && a.numericValue != null) {
      value = formatBytes(a.numericValue);
    } else {
      value = a.displayValue || (a.numericValue != null ? String(Math.round(a.numericValue)) : null);
    }
    if (value != null) out.push({ id: auditId, label, value });
  }
  return out;
}

function extractThirdParties(audits, topN) {
  if (!audits) return [];
  const tps = audits['third-party-summary'];
  if (!tps?.details?.items?.length) return [];
  return tps.details.items
    .filter((item) => item.entity)
    .sort((a, b) => (b.blockingTime ?? 0) - (a.blockingTime ?? 0))
    .slice(0, topN)
    .map((item) => ({
      entity: String(item.entity),
      blockingMs:    item.blockingTime != null ? Math.round(item.blockingTime) : null,
      sizeFormatted: formatBytes(item.size),
    }));
}

function extractMeta(raw) {
  const lr = raw.lighthouseResult || {};
  const warnings = Array.isArray(lr.runWarnings) ? lr.runWarnings.filter(Boolean) : [];
  return {
    lighthouseVersion: lr.lighthouseVersion || null,
    fetchTime:         lr.fetchTime || null,
    totalDurationMs:   lr.timing?.total != null ? Math.round(lr.timing.total) : null,
    requestedUrl:      lr.requestedUrl || null,
    finalUrl:          lr.finalUrl || null,
    finalDisplayedUrl: lr.finalDisplayedUrl || null,
    warnings,
  };
}

/**
 * Fetch and normalize a PSI audit for the given URL.
 * @returns {Promise<{ ok: boolean, seoAudit: object|null, error: string|null }>}
 */
async function fetchPsiAudit(websiteUrl) {
  const apiKey = process.env.PAGESPEED_API_KEY || '';
  if (!apiKey) {
    logWarn('pagespeed_api_key_missing', { websiteUrl, mode: 'anonymous' });
  }

  const probe = await runPreflightProbe(websiteUrl);

  const params = new URLSearchParams({ url: websiteUrl, strategy: 'mobile' });
  ['performance', 'accessibility', 'best-practices', 'seo'].forEach((c) => params.append('category', c));
  if (apiKey) params.set('key', apiKey);

  const requestUrl = `${PSI_API}?${params.toString()}`;
  logInfo('pagespeed_fetch_start', {
    websiteUrl,
    mode: apiKey ? 'authenticated' : 'anonymous',
  });

  let raw;
  try {
    const res = await fetch(requestUrl, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) {
      const failure = classifyPsiFailure({ websiteUrl, errorMessage: `PSI HTTP ${res.status}: ${text.slice(0, 200)}`, apiStatus: res.status, probe });
      return {
        ok: false,
        seoAudit: null,
        error: `PSI HTTP ${res.status}: ${text.slice(0, 200)}`,
        failure,
        diagnosticsContext: buildDiagnosticsContext({ websiteUrl, probe, failure }),
      };
    }
    raw = JSON.parse(text);
  } catch (err) {
    const failure = classifyPsiFailure({ websiteUrl, errorMessage: err.message, probe });
    return {
      ok: false,
      seoAudit: null,
      error: err.message,
      failure,
      diagnosticsContext: buildDiagnosticsContext({ websiteUrl, probe, failure }),
    };
  }

  if (raw.error) {
    const msg = raw.error.message || JSON.stringify(raw.error).slice(0, 200);
    const failure = classifyPsiFailure({ websiteUrl, errorMessage: `PSI API error: ${msg}`, apiStatus: raw.error.code || null, probe });
    return {
      ok: false,
      seoAudit: null,
      error: `PSI API error: ${msg}`,
      failure,
      diagnosticsContext: buildDiagnosticsContext({ websiteUrl, probe, failure }),
    };
  }

  const runtimeErr = raw.lighthouseResult?.runtimeError;
  const isPartial  = Boolean(runtimeErr?.code && runtimeErr.code !== 'NO_ERROR');
  if (isPartial) {
    logWarn('pagespeed_runtime_error', {
      websiteUrl,
      runtimeCode: runtimeErr.code,
      runtimeMessage: runtimeErr.message || null,
    });
  }

  const categories = raw.lighthouseResult?.categories || {};
  const audits     = raw.lighthouseResult?.audits     || {};
  const loadingExp = raw.loadingExperience?.metrics ? raw.loadingExperience : raw.originLoadingExperience || null;

  const meta = extractMeta(raw);
  const failure = isPartial
    ? classifyPsiFailure({ websiteUrl, errorMessage: runtimeErr?.message || runtimeErr?.code, probe })
    : null;
  const diagnosticsContext = buildDiagnosticsContext({ websiteUrl, probe, failure, runtimeError: runtimeErr, meta });

  const seoAudit = {
    fetchedAt:  new Date().toISOString(),
    websiteUrl,
    scores: {
      performance:   toScore(categories.performance?.score),
      seo:           toScore(categories.seo?.score),
      accessibility: toScore(categories.accessibility?.score),
      bestPractices: toScore(categories['best-practices']?.score),
    },
    coreWebVitals:    extractCwv(loadingExp),
    labCoreWebVitals: extractLabCwv(audits),
    opportunities:    extractOpportunities(audits),
    seoRedFlags:      extractSeoRedFlags(audits),
    a11yFailures:     extractCategoryFailures(audits, categories.accessibility?.auditRefs,         8),
    bpFailures:       extractCategoryFailures(audits, categories['best-practices']?.auditRefs,     6),
    insights:         extractInsights(audits),
    diagnostics:      extractDiagnostics(audits),
    thirdParties:     extractThirdParties(audits, 5),
    meta,
    status: isPartial ? 'partial' : 'ok',
    runtimeError: isPartial ? { code: runtimeErr.code, message: runtimeErr.message || null } : null,
    diagnosticsContext,
    error:  null,
  };

  return { ok: true, seoAudit, error: null, failure: null, diagnosticsContext };
}

// ── Translation helpers ────────────────────────────────────────────────────────

function buildSummary(seoAudit) {
  const { scores, coreWebVitals, labCoreWebVitals, opportunities, runtimeError } = seoAudit;

  if (runtimeError) {
    const code = runtimeError.code || 'UNKNOWN';
    return `Partial audit — Lighthouse could not fully render the page (${code}). Category scores may be incomplete.`;
  }

  const parts = [];

  if (scores?.performance != null) {
    const label = scores.performance >= 90 ? 'excellent' : scores.performance >= 50 ? 'moderate' : 'poor';
    parts.push(`Mobile performance is ${label} at ${scores.performance}/100`);
  }
  if (scores?.seo != null) {
    const label = scores.seo >= 90 ? 'strong' : scores.seo >= 70 ? 'moderate' : 'weak';
    parts.push(`SEO fundamentals are ${label} at ${scores.seo}/100`);
  }

  const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
  if (lcp?.p75 != null) {
    parts.push(`LCP is ${(lcp.p75 / 1000).toFixed(1)}s${lcp.category ? ` (${lcp.category})` : ''}`);
  }

  if (opportunities?.length) {
    const n = opportunities.length;
    parts.push(`${n} optimization opportunit${n === 1 ? 'y' : 'ies'} identified`);
  }

  return parts.length
    ? parts.join('. ') + '.'
    : 'PageSpeed audit completed — no score data available.';
}

function buildSignals(seoAudit) {
  const signals = [];
  const { scores, coreWebVitals, labCoreWebVitals, opportunities, seoRedFlags, a11yFailures, bpFailures, runtimeError } = seoAudit;

  if (runtimeError) {
    signals.push(`Partial audit: ${runtimeError.code} — ${runtimeError.message || 'Lighthouse could not fully load the page'}`);
  }

  if (scores?.performance  != null) signals.push(`Mobile performance score ${scores.performance}/100`);
  if (scores?.seo          != null) signals.push(`SEO score ${scores.seo}/100`);
  if (scores?.accessibility != null) signals.push(`Accessibility score ${scores.accessibility}/100`);
  if (scores?.bestPractices != null) signals.push(`Best practices score ${scores.bestPractices}/100`);

  const lcp = coreWebVitals?.lcp?.p75 != null ? coreWebVitals.lcp : labCoreWebVitals?.lcp;
  if (lcp?.p75 != null) {
    const src = lcp.source === 'lab' ? ' (lab)' : '';
    signals.push(`LCP is ${(lcp.p75 / 1000).toFixed(1)}s — ${lcp.category || 'unrated'}${src}`);
  }
  const inp = coreWebVitals?.inp;
  if (inp?.p75 != null) {
    signals.push(`INP is ${inp.p75}ms — ${inp.category || 'unrated'}`);
  }
  const cls = coreWebVitals?.cls?.p75 != null ? coreWebVitals.cls : labCoreWebVitals?.cls;
  if (cls?.p75 != null) {
    const src = cls.source === 'lab' ? ' (lab)' : '';
    signals.push(`CLS is ${Number(cls.p75).toFixed(2)}${src}`);
  }

  (opportunities || []).slice(0, 5).forEach((op) => {
    signals.push(`Top fix: ${op.title} — saves ${op.savingsMs}ms`);
  });

  if (seoRedFlags?.length) {
    seoRedFlags.slice(0, 3).forEach((flag) => {
      const id = typeof flag === 'string' ? flag : (flag.id || 'unknown');
      signals.push(`SEO flag failing: ${id}`);
    });
  } else if (scores?.seo != null) {
    signals.push('No critical SEO flags found');
  }

  (a11yFailures || []).slice(0, 3).forEach((flag) => {
    signals.push(`Accessibility flag failing: ${flag.title || flag.id}`);
  });

  (bpFailures || []).slice(0, 2).forEach((flag) => {
    signals.push(`Best practices flag failing: ${flag.title || flag.id}`);
  });

  return signals;
}

// ── Core translation ───────────────────────────────────────────────────────────

/**
 * Translate a PSI audit result into a SourceRecord.
 * Explicit field-by-field mapping — never a blind spread.
 *
 * @param {{ ok: boolean, seoAudit: object|null, error: string|null }} psiResult
 * @param {string} websiteUrl
 * @param {number|null} durationMs
 * @returns {object} SourceRecord
 */
function seoAuditToSourceRecord(psiResult, websiteUrl, durationMs) {
  if (!psiResult.ok) {
    const diagnosticsContext = psiResult.diagnosticsContext || buildDiagnosticsContext({
      websiteUrl,
      failure: psiResult.failure || classifyPsiFailure({ websiteUrl, errorMessage: psiResult.error }),
    });
    const failure = psiResult.failure || {
      failureCode: diagnosticsContext.failureCode || 'unknown',
      failureClass: diagnosticsContext.failureClass || 'measurement',
      failureReason: diagnosticsContext.failureReason || psiResult.error || 'PSI audit failed.',
    };
    return {
      id:              'pagespeed-insights',
      provider:        'google-pagespeed-v5',
      version:         '1.0.0',
      status:          'error',
      enabled:         true,
      fetchedAt:       new Date().toISOString(),
      durationMs:      typeof durationMs === 'number' ? durationMs : null,
      cost:            { usd: 0, quotaUnits: 1, model: null, inputTokens: null, outputTokens: null },
      summary:         failure.failureReason
        ? `PSI audit failed: ${failure.failureReason}`
        : `PSI audit failed: ${psiResult.error || 'unknown error'}`,
      signals:         [],
      facts: {
        strategy: 'mobile',
        websiteUrl,
        auditStatus: 'error',
        diagnosticsContext,
        failureCode: failure.failureCode,
        failureClass: failure.failureClass,
        failureReason: failure.failureReason,
      },
      nextRefreshHint: 'manual',
      error:           psiResult.error || 'PSI audit failed.',
    };
  }

  const a = psiResult.seoAudit;

  return {
    id:              'pagespeed-insights',
    provider:        'google-pagespeed-v5',
    version:         '1.0.0',
    status:          'live',
    enabled:         true,
    fetchedAt:       a.fetchedAt,
    durationMs:      a.meta?.totalDurationMs != null ? a.meta.totalDurationMs : (typeof durationMs === 'number' ? durationMs : null),
    cost:            { usd: 0, quotaUnits: 1, model: null, inputTokens: null, outputTokens: null },
    summary:         buildSummary(a),
    signals:         buildSignals(a),
    facts: {
      strategy:        'mobile',
      websiteUrl:       a.websiteUrl,
      scores:           a.scores           || null,
      coreWebVitals:    a.coreWebVitals    || null,
      labCoreWebVitals: a.labCoreWebVitals || null,
      opportunities:    a.opportunities    || [],
      seoRedFlags:      a.seoRedFlags      || [],
      a11yFailures:     a.a11yFailures     || [],
      bpFailures:       a.bpFailures       || [],
      insights:         a.insights         || [],
      diagnostics:      a.diagnostics      || [],
      thirdParties:     a.thirdParties     || [],
      lighthouseMeta:   a.meta             || null,
      runtimeError:     a.runtimeError     || null,
      diagnosticsContext: a.diagnosticsContext || null,
      auditStatus:      a.status,
    },
    nextRefreshHint: 'manual',
    error:           null,
  };
}

// ── Source module export ───────────────────────────────────────────────────────

module.exports = {
  defaultEnabled: true,

  /**
   * Fetch and return a PageSpeed Insights SourceRecord.
   * @param {{ websiteUrl: string }} clientData
   * @returns {Promise<object>} SourceRecord
   */
  async fetch(clientData) {
    const websiteUrl = String(clientData?.websiteUrl || '').trim();
    if (!websiteUrl) throw new Error('pagespeed.fetch: websiteUrl is required');

    const startMs    = Date.now();
    const psiResult  = await fetchPsiAudit(websiteUrl);
    const durationMs = Date.now() - startMs;

    return seoAuditToSourceRecord(psiResult, websiteUrl, durationMs);
  },

  seoAuditToSourceRecord,
  classifyHostType,
  classifyHostService,
  classifyHostingProvider,
  classifyPsiFailure,
  buildDiagnosticsContext,
};
