// Per-tool share metadata for the standalone Studio page.
//
// The Studio is one route (`/dashboard/studio`) that swaps tools via `?tool=`,
// so a shared link needs its social preview resolved from that param rather
// than from the route. `generateMetadata` in ./page.jsx reads the param and
// looks it up here; `StudioPage.jsx` reads the same param on the client to pick
// which tool to mount. Keep the ids in this map in sync with the `qTool`
// switch in StudioPage.jsx — adding a tool means adding one entry here.
//
// Images live at /public/img/og/studio-<slug>.jpg and should be 1200x630.

export const STUDIO_DEFAULT_TOOL = 'mockup';

export const STUDIO_TOOLS_META = {
  mockup: {
    title: 'Mockup Studio',
    description:
      'Turn any live website into a 3D device mockup video. Real HTML in a real scene, keyframed camera, GPU render.',
    image: '/img/og/studio-mockup.jpg',
    imageAlt: 'HITLOOP Mockup Studio — a live website rendered as a 3D device mockup',
  },
  cloth: {
    title: 'HOLO PAPER',
    description:
      'A real-time cloth and holographic foil simulator. Grab it, fling it, rumple it, then export the motion as video.',
    image: '/img/og/studio-holo-paper.jpg',
    imageAlt: 'HITLOOP HOLO PAPER — a holographic foil cloth simulation',
  },
  paint: {
    title: 'Paint Studio',
    description:
      'A procedural wallpaper studio. Generative pattern systems you can dial in and export.',
    image: '/img/og/studio-paint.jpg',
    imageAlt: 'HITLOOP Paint Studio — procedural generative wallpaper',
  },
  loop: {
    title: 'Loop Studio',
    description:
      'A browser-only audio loop slicer. Drop a track, find the loop, cut it clean — nothing leaves your machine.',
    image: '/img/og/studio-loop.jpg',
    imageAlt: 'HITLOOP Loop Studio — browser-based audio loop slicer',
  },
  remix: {
    title: 'Video Remix',
    description:
      'Build a 720×720 music-video remix from your own clip folders — pick the look, the mix, the overlays, then render it off-platform.',
    image: '/img/og/studio-remix.jpg',
    imageAlt: 'HITLOOP Video Remix — a square music-video remix builder',
  },
  invoice: {
    title: 'Invoice Studio',
    description:
      'A live-editable invoice canvas. Build it, edit it in place, print or download it — the invoice is rendered entirely in your browser, nothing is uploaded.',
    image: '/img/og/studio-invoice.jpg',
    imageAlt: 'HITLOOP Invoice Studio — a live-editable invoice canvas',
  },
};

// Normalize an arbitrary `?tool=` value to a known tool id.
export const resolveStudioTool = (raw) => {
  const id = Array.isArray(raw) ? raw[0] : raw;
  return id && Object.hasOwn(STUDIO_TOOLS_META, id) ? id : STUDIO_DEFAULT_TOOL;
};
