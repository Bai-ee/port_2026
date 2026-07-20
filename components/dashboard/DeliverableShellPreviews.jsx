'use client';

// Deliverable shell visuals — SINGLE SOURCE OF TRUTH. Each deliverable card's
// face and its tile-detail modal image cell must show the SAME preview. These
// components render that visual once and are used from both places (card
// placeholder + modal image cell). `domId` is parameterized so the modal copy
// never collides with the card's DOM id while both are mounted. Returns null
// when the underlying asset is missing; the caller then falls back to the
// empty-state label.
// Extracted from DashboardPage.jsx's renderCrossDeviceTrioShell / renderStudioVideoShell.

export function CrossDeviceTrioShell({ domId = 'cross-device-trio-shell', deviceScreenshots }) {
  if (!(deviceScreenshots.desktop || deviceScreenshots.tablet || deviceScreenshots.mobile)) return null;
  return (
    <div className="cross-device-trio" id={domId}>
      {deviceScreenshots.desktop && (
        <span className="cross-device-frame cross-device-frame--desktop">
          <img className="cross-device-img" src={deviceScreenshots.desktop} alt="Desktop full-page capture" loading="lazy" />
        </span>
      )}
      {deviceScreenshots.tablet && (
        <span className="cross-device-frame cross-device-frame--tablet">
          <img className="cross-device-img" src={deviceScreenshots.tablet} alt="Tablet full-page capture" loading="lazy" />
        </span>
      )}
      {deviceScreenshots.mobile && (
        <span className="cross-device-frame cross-device-frame--mobile">
          <img className="cross-device-img" src={deviceScreenshots.mobile} alt="Mobile full-page capture" loading="lazy" />
        </span>
      )}
    </div>
  );
}

export function StudioVideoShell({ latestStudioVideoUrl, observeOffscreenVideoPause }) {
  if (!latestStudioVideoUrl) return null;
  return (
    <video
      key={latestStudioVideoUrl}
      className="tile-studio-video"
      src={latestStudioVideoUrl}
      ref={observeOffscreenVideoPause}
      autoPlay
      muted
      loop
      playsInline
    />
  );
}
