// OAuth consent surface - keep out of search indexes.
export const metadata = {
  title: 'Connect to HITLOOP',
  robots: { index: false, follow: false, nocache: true },
};

export default function OAuthLayout({ children }) {
  return children;
}
