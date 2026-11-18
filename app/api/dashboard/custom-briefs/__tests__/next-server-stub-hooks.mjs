// Test-only ESM resolve hook: plain `node --test` cannot resolve the
// extensionless `next/server` specifier the route imports, so map it to a
// minimal NextResponse (json() + status/headers) for route-level tests.
const STUB = `export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('content-type', 'application/json');
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return { url: `data:text/javascript,${encodeURIComponent(STUB)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
