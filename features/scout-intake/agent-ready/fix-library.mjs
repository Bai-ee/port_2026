// ESM standalone — browser-safe, no CJS dependency.
// fix-library.js (CJS) is the parallel version for Node test runner and index.js.
// Keep both in sync when fix entries change.

export const FIX_LIBRARY = {
  'add-robots-txt': {
    title: 'Add /robots.txt at site root',
    why: 'Crawlers and AI agents look for /robots.txt to understand crawl permissions.',
    prompt: 'Create a /robots.txt file at your site root. Minimum viable content:\n\nUser-agent: *\nAllow: /\n\nSitemap: https://yourdomain.com/sitemap.xml',
    snippet: 'User-agent: *\nAllow: /\n\nSitemap: https://yourdomain.com/sitemap.xml',
  },
  'fix-robots-txt': {
    title: 'Fix malformed /robots.txt',
    why: 'A robots.txt that cannot be parsed causes crawlers to ignore it entirely.',
    prompt: 'Ensure /robots.txt contains at least one valid "User-agent:" directive followed by "Allow:" or "Disallow:" lines.',
    snippet: 'User-agent: *\nAllow: /\n\nSitemap: https://yourdomain.com/sitemap.xml',
  },
  'add-sitemap-xml': {
    title: 'Add /sitemap.xml and reference it from robots.txt',
    why: 'Sitemaps let search engines and AI crawlers discover all indexable URLs.',
    prompt: 'Generate a sitemap.xml at /sitemap.xml and add a Sitemap: directive to your robots.txt.\n\nFor Next.js, add app/sitemap.ts:\n\nexport default function sitemap() {\n  return [\n    { url: \'https://yourdomain.com\', lastModified: new Date() },\n  ];\n}',
    snippet: '// app/sitemap.ts\nexport default function sitemap() {\n  return [\n    { url: \'https://yourdomain.com\', lastModified: new Date() },\n  ];\n}',
  },
  'add-link-header-sitemap': {
    title: 'Add Link header pointing to sitemap',
    why: 'RFC 8288 Link headers allow agents to discover the sitemap without parsing HTML.',
    prompt: 'Add a Link response header on your homepage:\n\nLink: </sitemap.xml>; rel="sitemap"\n\nFor Next.js in next.config.js:\n\nheaders: async () => [{\n  source: \'/\',\n  headers: [{ key: \'Link\', value: \'</sitemap.xml>; rel="sitemap"\' }]\n}]',
    snippet: '// next.config.js headers()\n{\n  source: \'/\',\n  headers: [{ key: \'Link\', value: \'</sitemap.xml>; rel="sitemap"\' }]\n}',
  },
  'add-api-catalog': {
    title: 'Add /.well-known/api-catalog (RFC 9727)',
    why: 'RFC 9727 api-catalog lets agents auto-discover API endpoints for this domain.',
    prompt: 'Create /.well-known/api-catalog as a JSON file:\n\n{\n  "apis": [\n    {\n      "title": "Your API",\n      "description": "Description of what this API does",\n      "humanURL": "https://yourdomain.com/docs",\n      "baseURL": "https://api.yourdomain.com"\n    }\n  ]\n}',
    snippet: '{\n  "apis": [\n    {\n      "title": "Your API",\n      "description": "...",\n      "humanURL": "https://yourdomain.com/docs",\n      "baseURL": "https://api.yourdomain.com"\n    }\n  ]\n}',
  },
  'add-llms-txt': {
    title: 'Add /llms.txt at site root',
    why: 'AI agents look for /llms.txt as a curated reading list of your site\'s most important content.',
    prompt: 'Create /llms.txt at your site root. Format:\n\n# Your Site Name\n\n> One sentence description of what this site is.\n\n## Key Pages\n\n- [Page Title](https://yourdomain.com/page): Brief description\n- [About](https://yourdomain.com/about): Who we are\n\n## Documentation\n\n- [Docs](https://yourdomain.com/docs): Full documentation',
    snippet: '# Site Name\n\n> Brief description.\n\n## Key Pages\n\n- [Home](https://yourdomain.com): Main page\n- [About](https://yourdomain.com/about): About us',
  },
  'add-markdown-negotiation': {
    title: 'Support Accept: text/markdown content negotiation',
    why: 'AI agents and LLMs prefer Markdown over HTML. Serving Markdown on request dramatically reduces token usage and parsing complexity.',
    prompt: 'Serve your homepage as Markdown when the request includes "Accept: text/markdown". In Next.js middleware:\n\nexport function middleware(req) {\n  const accept = req.headers.get(\'accept\') || \'\';\n  if (accept.includes(\'text/markdown\')) {\n    return NextResponse.rewrite(new URL(\'/api/page-as-markdown\', req.url));\n  }\n}',
    snippet: '// middleware.ts\nexport function middleware(req: NextRequest) {\n  const accept = req.headers.get(\'accept\') || \'\';\n  if (accept.includes(\'text/markdown\')) {\n    return NextResponse.rewrite(new URL(\'/api/page-as-markdown\', req.url));\n  }\n}',
  },
  'add-structured-data': {
    title: 'Add JSON-LD structured data to homepage',
    why: 'Structured data (Schema.org JSON-LD) helps AI agents understand entity relationships, organization context, and content type.',
    prompt: 'Add a <script type="application/ld+json"> block to your homepage:\n\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Your Company",\n  "url": "https://yourdomain.com",\n  "description": "What your company does"\n}\n</script>',
    snippet: '<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Your Company",\n  "url": "https://yourdomain.com"\n}\n</script>',
  },
  'add-content-signal': {
    title: 'Add Content-Signal directive to robots.txt',
    why: 'Content-Signal in robots.txt communicates AI-specific access policies beyond standard crawler rules.',
    prompt: 'Add Content-Signal directives to your robots.txt:\n\n# Content-Signal: ai-training=disallow, ai-inference=allow\n# Content-Signal: commercial-use=restricted\n\nThis signals your content policy to AI agents that respect Content-Signal.',
    snippet: '# robots.txt\nUser-agent: *\nAllow: /\n\n# Content-Signal: ai-training=disallow, ai-inference=allow\n\nSitemap: https://yourdomain.com/sitemap.xml',
  },
  'add-web-bot-auth': {
    title: 'Support HTTP Message Signatures for bot authentication (Signature-Agent)',
    why: 'Verifiable agent identity via HTTP Message Signatures lets you distinguish trusted AI agents from scrapers and apply per-agent policies.',
    prompt: 'Implement HTTP Message Signatures verification on your server. Agents will send a Signature-Agent header. See: https://www.ietf.org/archive/id/draft-ietf-httpbis-message-signatures-19.txt',
    snippet: '// Verify Signature-Agent header per HTTP Message Signatures draft\n// See IETF draft-ietf-httpbis-message-signatures',
  },
  'add-mcp-discovery': {
    title: 'Add /.well-known/mcp.json for MCP server discovery',
    why: 'MCP (Model Context Protocol) discovery lets AI agents find and connect to your MCP server automatically.',
    prompt: 'Create /.well-known/mcp.json:\n\n{\n  "mcpVersion": "1.0",\n  "servers": [\n    {\n      "name": "Your MCP Server",\n      "url": "https://mcp.yourdomain.com",\n      "transport": "http",\n      "description": "What this MCP server provides"\n    }\n  ]\n}',
    snippet: '{\n  "mcpVersion": "1.0",\n  "servers": [\n    {\n      "name": "Your MCP Server",\n      "url": "https://mcp.yourdomain.com",\n      "transport": "http"\n    }\n  ]\n}',
  },
  'add-agent-skills': {
    title: 'Add /.well-known/agent-skills.json',
    why: 'An agent-skills manifest tells AI agents what tasks and capabilities your service can perform on their behalf.',
    prompt: 'Create /.well-known/agent-skills.json:\n\n{\n  "schemaVersion": "1.0",\n  "skills": [\n    {\n      "id": "your-skill-id",\n      "name": "Skill Name",\n      "description": "What this skill does",\n      "inputSchema": {},\n      "outputSchema": {}\n    }\n  ]\n}',
    snippet: '{\n  "schemaVersion": "1.0",\n  "skills": [\n    {\n      "id": "your-skill-id",\n      "name": "Skill Name",\n      "description": "What this skill does"\n    }\n  ]\n}',
  },
  'add-x402-payment': {
    title: 'Add x402 payment protocol support',
    why: 'x402 enables AI agents to autonomously pay for API access using crypto micropayments, unlocking agentic commerce.',
    prompt: 'Implement x402 payment gating. Return HTTP 402 with WWW-Authenticate: x402 on paywalled resources:\n\nres.setHeader(\'WWW-Authenticate\', \'x402 realm="payment required", accepts="USDC"\');\nres.status(402).json({ error: \'Payment required\', x402Version: 1 });',
    snippet: '// Express / Next.js API route\nif (!hasPaidAccess(req)) {\n  res.setHeader(\'WWW-Authenticate\', \'x402 realm="payment required"\');\n  return res.status(402).json({ error: \'Payment required\' });\n}',
  },
  'add-oauth-discovery': {
    title: 'Add /.well-known/oauth-authorization-server (RFC 9728)',
    why: 'OAuth 2.0 server metadata lets AI agents discover your authorization endpoints and authenticate on behalf of users.',
    prompt: 'Create /.well-known/oauth-authorization-server:\n\n{\n  "issuer": "https://yourdomain.com",\n  "authorization_endpoint": "https://yourdomain.com/oauth/authorize",\n  "token_endpoint": "https://yourdomain.com/oauth/token",\n  "response_types_supported": ["code"],\n  "grant_types_supported": ["authorization_code", "client_credentials"]\n}',
    snippet: '{\n  "issuer": "https://yourdomain.com",\n  "authorization_endpoint": "https://yourdomain.com/oauth/authorize",\n  "token_endpoint": "https://yourdomain.com/oauth/token",\n  "response_types_supported": ["code"]\n}',
  },
};
