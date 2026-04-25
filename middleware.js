import { NextResponse } from 'next/server';

const MD_MAP = {
  '/':                              '/md/index.md',
  '/about':                         '/md/about.md',
  '/work':                          '/md/work.md',
  '/contact':                       '/md/contact.md',
  '/faq':                           '/md/faq.md',
  '/gallery':                       '/md/gallery.md',
  '/how-it-works':                  '/md/how-it-works.md',
  '/process':                       '/md/process.md',
  '/case-studies':                  '/md/case-studies.md',
  '/services/web-development':      '/md/services-web-development.md',
  '/services/brand-identity':       '/md/services-brand-identity.md',
  '/services/design-systems':       '/md/services-design-systems.md',
  '/services/seo-geo':              '/md/services-seo-geo.md',
  '/services/ai-design-consulting': '/md/services-ai-design-consulting.md',
};

export function middleware(request) {
  const accept = request.headers.get('accept') || '';
  if (!accept.includes('text/markdown')) return NextResponse.next();

  const { pathname } = request.nextUrl;
  const mdPath = MD_MAP[pathname];
  if (!mdPath) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = mdPath;
  const response = NextResponse.rewrite(url);
  response.headers.set('Content-Type', 'text/markdown; charset=utf-8');
  response.headers.set('Vary', 'Accept');
  return response;
}

export const config = {
  matcher: ['/((?!_next|api|md|img|vid|favicon|robots|sitemap|llms).*)'],
};
