import { XCE_COLORS, XCE_TYPE } from '../xce-tokens';

// Uppercase tracked mono label. `right` renders a slot at the far end.
export default function SectionLabel({ id, children, right, style }) {
  return (
    <div
      id={id}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, ...style }}
    >
      <span style={{ ...XCE_TYPE.label, fontFamily: XCE_TYPE.mono, color: XCE_COLORS.inkSoft }}>{children}</span>
      {right || null}
    </div>
  );
}
