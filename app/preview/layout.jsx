// Internal preview surfaces (brief, intake-modal, scout-config) — never
// index. Preview routes are dev/staging tools and must not appear in search.
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// Preview surfaces keep their own hardcoded light palettes, so they are pinned
// to the light theme (exception X8): the shell paints the light page colour and
// re-scopes every --t-* token, whatever the viewer's theme preference is.
export default function PreviewLayout({ children }) {
  return (
    <div
      id="preview-theme-pin-shell"
      data-theme-scope="light"
      style={{ minHeight: '100dvh', background: 'var(--t-page)', color: 'var(--t-text-default)' }}
    >
      {children}
    </div>
  );
}
