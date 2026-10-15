// Small inline tag marking a field whose value is owned by the Client Brain.
// Admin-only: callers pass isAdmin (or render only inside admin surfaces).
export default function ClientBrainOwnedTag({ isAdmin = true }) {
  if (!isAdmin) return null;
  return (
    <span
      className="client-brain-owned-field-tag"
      data-testid="client-brain-owned-field-tag"
      title="Editing writes back to the Client Brain"
      style={{
        display: 'inline-block',
        marginLeft: 6,
        padding: '1px 6px',
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, var(--t-text-strong) 18%, transparent)',
        background: 'color-mix(in srgb, var(--t-text-strong) 5%, transparent)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.4,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      From Client Brain
    </span>
  );
}
