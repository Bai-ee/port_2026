// Server wrapper for the Studio. Exists ONLY so each tool (`?tool=cloth`,
// `?tool=loop`, …) can carry its own social preview image + description when a
// link is shared — the studio itself is the client component it renders.
import StudioPage from './StudioPage';
import { STUDIO_TOOLS_META, STUDIO_DEFAULT_TOOL, resolveStudioTool } from './studio-tools-meta';

export async function generateMetadata({ searchParams }) {
  const params = await searchParams;
  const toolId = resolveStudioTool(params?.tool);
  const meta = STUDIO_TOOLS_META[toolId];
  // `mockup` is the param-less default URL (StudioPage.switchTool deletes the
  // param for it), so its canonical carries no query.
  const canonical = toolId === STUDIO_DEFAULT_TOOL
    ? '/dashboard/studio'
    : `/dashboard/studio?tool=${toolId}`;

  return {
    title: meta.title,
    description: meta.description,
    // The dashboard layout marks its whole subtree noindex; the Studio is a
    // public, shareable tool, so it opts back in.
    robots: { index: true, follow: true },
    alternates: { canonical },
    openGraph: {
      type: 'website',
      siteName: 'HITLOOP',
      url: canonical,
      title: `${meta.title} | HITLOOP`,
      description: meta.description,
      images: [{ url: meta.image, width: 1200, height: 630, alt: meta.imageAlt, type: 'image/jpeg' }],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@bai_ee',
      creator: '@bai_ee',
      title: `${meta.title} | HITLOOP`,
      description: meta.description,
      images: [{ url: meta.image, alt: meta.imageAlt }],
    },
  };
}

export default function StudioRoute() {
  return <StudioPage />;
}
