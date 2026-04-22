// Internal preview surfaces (brief, intake-modal, scout-config) — never
// index. Preview routes are dev/staging tools and must not appear in search.
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function PreviewLayout({ children }) {
  return children;
}
