import { XCE_COLORS, XCE_NAV_HEIGHT, XCE_SHADOWS, XCE_TYPE } from '../xce-tokens';

// Mobile bottom nav. items: [{ value, label, icon }]. Position/visibility is the
// caller's job (wrap in a fixed/sticky shell); this renders the bar only and
// honours the iOS safe-area inset. Pad the page body by XCE_NAV_HEIGHT.
export default function BottomNav({ id, items, value, onChange }) {
  return (
    <nav
      id={id}
      aria-label="Content Engine sections"
      style={{
        display: 'flex',
        minHeight: XCE_NAV_HEIGHT,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: XCE_COLORS.surface,
        boxShadow: XCE_SHADOWS.nav,
      }}
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            aria-current={on ? 'page' : undefined}
            onClick={() => onChange && onChange(it.value)}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              border: 0,
              background: 'transparent',
              color: on ? XCE_COLORS.ink : XCE_COLORS.inkMuted,
              fontFamily: XCE_TYPE.mono,
              fontSize: 10,
              fontWeight: on ? 700 : 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {it.icon || null}
            {it.label}
          </button>
        );
      })}
    </nav>
  );
}
