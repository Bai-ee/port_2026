// Auth surface — keep out of search indexes.
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function LoginLayout({ children }) {
  return children;
}
