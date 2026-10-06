import RecordsPage from '../../components/records/RecordsPage';

const TITLE = 'Records: your collection, archived and posted';
const DESC = 'Photo of the label, video of it playing, and your story. Matched on Discogs, added to your collection, cut into finished 1:1 and 9:16 clips and scheduled to X. Join the waitlist.';

export const metadata = {
  title: 'Records',
  description: DESC,
  alternates: { canonical: '/records' },
  openGraph: { title: `${TITLE} | HITLOOP`, description: DESC, url: '/records', type: 'website' },
  twitter: { card: 'summary_large_image', title: `${TITLE} | HITLOOP`, description: DESC },
  robots: { index: true, follow: true },
};

export default function RecordsRoute() {
  return <RecordsPage />;
}
