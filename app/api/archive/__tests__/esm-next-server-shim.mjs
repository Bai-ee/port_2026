// Node's ESM resolver (unlike CommonJS require()) does not infer a missing
// extension, so a route.js file's `import { NextResponse } from 'next/server'`
// fails with ERR_MODULE_NOT_FOUND when the route module is imported directly
// by `node --test` — Next's own bundler resolves this at build time, but the
// test runner never goes through it. This registers a loader hook that maps
// the bare `next/server` specifier to `next/server.js` and is a no-op for
// every other specifier.
//
// Side-effect only: `import '../../../__tests__/esm-next-server-shim.mjs';`
// before dynamically importing any archive route.js file directly.
import { register } from 'node:module';

const loaderSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/server') {
    return nextResolve('next/server.js', context);
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);
