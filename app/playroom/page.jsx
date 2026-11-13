import PlayroomClient from './PlayroomClient';

export const metadata = {
  title: 'Playroom',
  appleWebApp: { capable: true, title: 'Playroom', statusBarStyle: 'black-translucent' },
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#f6e7d8',
};

export default function PlayroomPage() {
  return <PlayroomClient />;
}
