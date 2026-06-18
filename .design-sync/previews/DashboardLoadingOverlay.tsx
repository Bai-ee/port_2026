import { DashboardLoadingOverlay } from 'bballi-portfolio';
export function Default() {
  return (
    <div style={{ background: '#0a0a0f', minHeight: '300px', position: 'relative' }}>
      <DashboardLoadingOverlay show={true} message="Loading your dashboard…" />
    </div>
  );
}
