// Client Brief - Studio deep link. Pure and browser-safe. The dashboard keeps
// impersonation in sessionStorage (not shared with the Studio tab it opens), so
// the launcher puts the client in the URL as `?as=<clientId>` and the Studio
// reads it back as its default client.

export const BRIEF_STUDIO_PATH = '/dashboard/studio';

export function briefStudioHref({ clientId, briefSlug } = {}) {
  const params = new URLSearchParams({ tool: 'brief' });
  const as = String(clientId || '').trim();
  if (as) params.set('as', as);
  const slug = String(briefSlug || '').trim();
  if (slug) params.set('brief', slug);
  return `${BRIEF_STUDIO_PATH}?${params.toString()}`;
}

// Reads the default client + brief to open from the Studio URL's search string.
export function readBriefStudioParams(search) {
  const params = new URLSearchParams(String(search || ''));
  return {
    clientId: (params.get('as') || '').trim(),
    briefSlug: (params.get('brief') || '').trim(),
  };
}
