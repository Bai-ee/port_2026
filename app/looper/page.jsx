import LooperLandingPage from '../../components/looper/LooperLandingPage';

export const metadata = {
  title: 'Looper | HITLOOP',
  description: 'Turn any track into seamless, beat-accurate loops — drop a file and watch real BPM and downbeat analysis run live, then land straight in Loop Studio.',
  alternates: { canonical: '/looper' },
  openGraph: {
    title: 'Looper | HITLOOP',
    description: 'Turn any track into seamless, beat-accurate loops — drop a file and watch real BPM and downbeat analysis run live.',
    url: '/looper',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export default function LooperRoute() {
  return <LooperLandingPage />;
}
