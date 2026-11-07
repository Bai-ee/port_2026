import '@hitloop/styles/theme/theme.generated.css';
import '@hitloop/styles/dashboard/08-ui-kit-interactions.css';
import './prototype.css';

export const metadata = {
  title: 'Life Timeline — HITLOOP prototype',
  description: 'An isolated interaction prototype using sample imagery and generated metadata.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
