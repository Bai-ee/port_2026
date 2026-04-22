// Dev capture surface — keep out of search indexes.
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function CaptureLayout({ children }) {
  return children;
}
