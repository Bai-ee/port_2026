import TelegramUploadClient from './TelegramUploadClient.jsx';

export const metadata = { title: 'Upload your video', robots: { index: false, follow: false } };

export default async function TelegramUploadPage({ params }) {
  const { token } = await params;
  return (
    <main id="telegram-upload-page" data-section="telegram-upload" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#fff', color: '#111', fontFamily: 'system-ui, sans-serif' }}>
      <TelegramUploadClient token={token} />
    </main>
  );
}
